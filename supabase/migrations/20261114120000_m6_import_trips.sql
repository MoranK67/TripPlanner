-- M6.6a: import_trips RPC — restore a whole backup file (FR-8.1/FR-8.2, DEC-033) atomically.
--
-- import_trips(trips jsonb) -> jsonb { "trips": [ { "trip": <trips row>, "activity_count": int } ] }
--
-- Input: JSON array (1..50 trips, at most 2000 activities in total) of
--   { "name": text, "start_date": "YYYY-MM-DD", "start_minute": int, "end_date": "YYYY-MM-DD",
--     "end_minute": int, "color_cursor": int >= 0,
--     "activities": [ { "name": text, "duration_minutes": int, "color": "#RRGGBB",
--                       "scheduled_date": "YYYY-MM-DD" | null, "start_minute": int | null } ] }
-- The client (src/domain/backup.ts) has already cleaned the file; the RPC re-validates
-- everything and rejects instead of repairing.
--
-- Behaviour:
--   * Everything is validated before anything is written, so validation errors never depend on
--     database state and report the first bad field.
--   * Then, per trip in array order: INSERT the trip (owner = caller, RLS applies), INSERT its
--     activities in array order with their explicit colour and placement, then set
--     color_cursor = given % 10. The activity insert trigger (assign_activity_defaults) advances
--     the cursor once per activity; the final UPDATE overrides that, so the file's cursor wins.
--   * bank_position = 1-based index of the activity in its trip's array, so the bank keeps the
--     file order of the unplaced activities (placed ones get a position too; it is unused).
--   * Placements are checked by the existing trigger/constraint: outside the window
--     TP_OUT_OF_RANGE, overlap TP_OVERLAP (re-raised from 23P01). The hint names the trip and
--     item. Any error aborts the whole call: nothing is stored (one transaction).
--   * Add-only: never touches existing trips. No ids in the input; new rows always.
--
-- ERROR CONTRACT additions (the full contract is in 20261112140400_m1_hardening.sql):
-- | message          | SQLSTATE | details                                                       |
-- |------------------|----------|---------------------------------------------------------------|
-- | TP_LIMIT         | P0001    | 'too_many_trips' (> 50) | 'too_many_activities' (> 2000 total)  |
-- | TP_VALIDATION    | P0001    | 'trips' (not an array, or empty) | 'trip:<n>' (not an object,  |
-- |                  |          | or activities not an array) | 'trip:<n>:name' |                 |
-- |                  |          | 'trip:<n>:<TripWindowError>' | 'trip:<n>:color_cursor' |         |
-- |                  |          | 'trip:<n>:item:<m>' (not an object) |                         |
-- |                  |          | 'trip:<n>:item:<m>:name|duration_minutes|color|               |
-- |                  |          |   scheduled_date|start_minute'                                |
-- | TP_OUT_OF_RANGE  | P0001    | 'outside_trip_window'                                         |
-- | TP_OVERLAP       | 23P01    | 'overlap'                                                     |
-- <n>, <m> are 1-based. TripWindowError = invalid_date | invalid_start_minute |
-- invalid_end_minute | end_not_after_start | too_long (same order of checks as
-- validateTripWindow in src/domain/placement.ts). Names must be non-blank, like the domain guards.
-- Exactly one of scheduled_date / start_minute set → the missing one is reported.

-- ---------------------------------------------------------------------------------------------
-- Internal: JSON value → date / integer, NULL when malformed. Never raise, so validation can
-- report the field instead of a cast error. PL/pgSQL with nested IFs (no constant folding, no
-- reliance on AND short-circuit).
-- ---------------------------------------------------------------------------------------------
create function private.json_iso_date(value jsonb)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text;
  v_year integer;
  v_month integer;
  v_day integer;
begin
  if jsonb_typeof(json_iso_date.value) is distinct from 'string' then
    return null;
  end if;
  v_text := json_iso_date.value #>> '{}';
  if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return null;
  end if;
  v_year := substr(v_text, 1, 4)::integer;
  v_month := substr(v_text, 6, 2)::integer;
  v_day := substr(v_text, 9, 2)::integer;
  if v_year < 1 or v_month not between 1 and 12 or v_day < 1 then
    return null;
  end if;
  if v_day > extract(day from make_date(v_year, v_month, 1) + interval '1 month - 1 day') then
    return null;
  end if;
  return make_date(v_year, v_month, v_day);
end;
$$;

-- Non-negative JSON integer with at most 9 digits (no sign, fraction or exponent), else NULL.
create function private.json_uint(value jsonb)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if jsonb_typeof(json_uint.value) is distinct from 'number' then
    return null;
  end if;
  if (json_uint.value #>> '{}') !~ '^[0-9]{1,9}$' then
    return null;
  end if;
  return (json_uint.value #>> '{}')::integer;
end;
$$;

revoke all on function private.json_iso_date(jsonb) from public, anon;
revoke all on function private.json_uint(jsonb) from public, anon;
grant execute on function private.json_iso_date(jsonb) to authenticated;
grant execute on function private.json_uint(jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- import_trips
-- ---------------------------------------------------------------------------------------------
create function public.import_trips(trips jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_trip_count integer;
  v_activity_total bigint;
  v_t jsonb;
  v_n bigint;
  v_a jsonb;
  v_m bigint;
  v_p text;
  v_name text;
  v_start_date date;
  v_end_date date;
  v_start_minute integer;
  v_end_minute integer;
  v_int integer;
  v_has_date boolean;
  v_has_minute boolean;
  v_trip public.trips;
  v_count integer;
  v_result jsonb := '[]'::jsonb;
  v_message text;
  v_detail text;
begin
  if import_trips.trips is null or jsonb_typeof(import_trips.trips) <> 'array' then
    perform private.raise_tp('TP_VALIDATION', 'trips', 'trips must be a JSON array');
  end if;

  v_trip_count := jsonb_array_length(import_trips.trips);
  if v_trip_count = 0 then
    perform private.raise_tp('TP_VALIDATION', 'trips', 'trips must not be empty');
  end if;
  if v_trip_count > 50 then
    perform private.raise_tp('TP_LIMIT', 'too_many_trips',
      format('%s trips; at most 50 can be imported at once', v_trip_count));
  end if;

  select coalesce(sum(jsonb_array_length(e.value -> 'activities')), 0) into v_activity_total
  from jsonb_array_elements(import_trips.trips) as e(value)
  where jsonb_typeof(e.value) = 'object'
    and jsonb_typeof(e.value -> 'activities') = 'array';
  if v_activity_total > 2000 then
    perform private.raise_tp('TP_LIMIT', 'too_many_activities',
      format('%s activities; at most 2000 can be imported at once', v_activity_total));
  end if;

  -- 1. Validate everything (1-based indexes in details).
  for v_t, v_n in
    select e.value, e.ordinality
    from jsonb_array_elements(import_trips.trips) with ordinality as e(value, ordinality)
  loop
    v_p := format('trip:%s', v_n);

    if jsonb_typeof(v_t) <> 'object' then
      perform private.raise_tp('TP_VALIDATION', v_p, 'each trip must be a JSON object');
    end if;
    if jsonb_typeof(v_t -> 'activities') is distinct from 'array' then
      perform private.raise_tp('TP_VALIDATION', v_p, 'activities must be a JSON array');
    end if;

    if jsonb_typeof(v_t -> 'name') is distinct from 'string' then
      perform private.raise_tp('TP_VALIDATION', v_p || ':name', 'name must be 1..50 characters');
    end if;
    v_name := v_t ->> 'name';
    if char_length(v_name) not between 1 and 50 or v_name ~ '^\s*$' then
      perform private.raise_tp('TP_VALIDATION', v_p || ':name', 'name must be 1..50 characters, not blank');
    end if;

    v_start_date := private.json_iso_date(v_t -> 'start_date');
    v_end_date := private.json_iso_date(v_t -> 'end_date');
    if v_start_date is null or v_end_date is null then
      perform private.raise_tp('TP_VALIDATION', v_p || ':invalid_date', 'dates must be YYYY-MM-DD');
    end if;
    v_start_minute := private.json_uint(v_t -> 'start_minute');
    if v_start_minute is null or v_start_minute > 1410 or v_start_minute % 30 <> 0 then
      perform private.raise_tp('TP_VALIDATION', v_p || ':invalid_start_minute',
        'start_minute must be 0..1410 and a multiple of 30');
    end if;
    v_end_minute := private.json_uint(v_t -> 'end_minute');
    if v_end_minute is null or v_end_minute not between 30 and 1440 or v_end_minute % 30 <> 0 then
      perform private.raise_tp('TP_VALIDATION', v_p || ':invalid_end_minute',
        'end_minute must be 30..1440 and a multiple of 30');
    end if;
    if (v_end_date, v_end_minute) <= (v_start_date, v_start_minute) then
      perform private.raise_tp('TP_VALIDATION', v_p || ':end_not_after_start',
        'trip must end after it starts');
    end if;
    if v_end_date - v_start_date > 89 then
      perform private.raise_tp('TP_VALIDATION', v_p || ':too_long', 'a trip can be at most 90 days');
    end if;

    if private.json_uint(v_t -> 'color_cursor') is null then
      perform private.raise_tp('TP_VALIDATION', v_p || ':color_cursor',
        'color_cursor must be a non-negative integer');
    end if;

    for v_a, v_m in
      select e.value, e.ordinality
      from jsonb_array_elements(v_t -> 'activities') with ordinality as e(value, ordinality)
    loop
      v_p := format('trip:%s:item:%s', v_n, v_m);

      if jsonb_typeof(v_a) <> 'object' then
        perform private.raise_tp('TP_VALIDATION', v_p, 'each activity must be a JSON object');
      end if;

      if jsonb_typeof(v_a -> 'name') is distinct from 'string' then
        perform private.raise_tp('TP_VALIDATION', v_p || ':name', 'name must be 1..60 characters');
      end if;
      v_name := v_a ->> 'name';
      if char_length(v_name) not between 1 and 60 or v_name ~ '^\s*$' then
        perform private.raise_tp('TP_VALIDATION', v_p || ':name',
          'name must be 1..60 characters, not blank');
      end if;

      v_int := private.json_uint(v_a -> 'duration_minutes');
      if v_int is null or v_int not between 30 and 1440 or v_int % 30 <> 0 then
        perform private.raise_tp('TP_VALIDATION', v_p || ':duration_minutes',
          'duration_minutes must be an integer 30..1440 and a multiple of 30');
      end if;

      if jsonb_typeof(v_a -> 'color') is distinct from 'string' then
        perform private.raise_tp('TP_VALIDATION', v_p || ':color', 'color must be #RRGGBB');
      end if;
      if (v_a ->> 'color') !~ '^#[0-9A-Fa-f]{6}$' then
        perform private.raise_tp('TP_VALIDATION', v_p || ':color', 'color must be #RRGGBB');
      end if;

      -- Missing key or JSON null = not set.
      v_has_date := coalesce(jsonb_typeof(v_a -> 'scheduled_date'), 'null') <> 'null';
      v_has_minute := coalesce(jsonb_typeof(v_a -> 'start_minute'), 'null') <> 'null';
      if v_has_date then
        if private.json_iso_date(v_a -> 'scheduled_date') is null then
          perform private.raise_tp('TP_VALIDATION', v_p || ':scheduled_date',
            'scheduled_date must be YYYY-MM-DD or null');
        end if;
      end if;
      if v_has_minute then
        v_int := private.json_uint(v_a -> 'start_minute');
        if v_int is null or v_int > 1410 or v_int % 30 <> 0 then
          perform private.raise_tp('TP_VALIDATION', v_p || ':start_minute',
            'start_minute must be 0..1410 and a multiple of 30, or null');
        end if;
      end if;
      if v_has_date and not v_has_minute then
        perform private.raise_tp('TP_VALIDATION', v_p || ':start_minute',
          'start_minute is required when scheduled_date is set');
      end if;
      if v_has_minute and not v_has_date then
        perform private.raise_tp('TP_VALIDATION', v_p || ':scheduled_date',
          'scheduled_date is required when start_minute is set');
      end if;
    end loop;
  end loop;

  -- 2. Write. One exception block (one subtransaction) around all writes, only to add the trip
  --    and item to the hint of placement errors and to map 23P01 to TP_OVERLAP.
  v_n := 0;
  v_m := 0;
  begin
    for v_t, v_n in
      select e.value, e.ordinality
      from jsonb_array_elements(import_trips.trips) with ordinality as e(value, ordinality)
    loop
      v_m := 0;
      insert into public.trips (name, start_date, start_minute, end_date, end_minute)
      values (
        v_t ->> 'name',
        private.json_iso_date(v_t -> 'start_date'),
        private.json_uint(v_t -> 'start_minute'),
        private.json_iso_date(v_t -> 'end_date'),
        private.json_uint(v_t -> 'end_minute')
      )
      returning * into v_trip;

      for v_a, v_m in
        select e.value, e.ordinality
        from jsonb_array_elements(v_t -> 'activities') with ordinality as e(value, ordinality)
      loop
        insert into public.activities (
          trip_id, name, duration_minutes, color, scheduled_date, start_minute, bank_position
        )
        values (
          v_trip.id,
          v_a ->> 'name',
          private.json_uint(v_a -> 'duration_minutes'),
          v_a ->> 'color',
          private.json_iso_date(v_a -> 'scheduled_date'),
          private.json_uint(v_a -> 'start_minute'),
          v_m
        );
      end loop;
      v_count := jsonb_array_length(v_t -> 'activities');
      v_m := 0;

      -- After the inserts: assign_activity_defaults advanced the cursor once per activity.
      update public.trips t
      set color_cursor = private.json_uint(v_t -> 'color_cursor') % cardinality(private.palette())
      where t.id = v_trip.id
      returning * into v_trip;

      v_result := v_result || jsonb_build_array(
        jsonb_build_object('trip', to_jsonb(v_trip), 'activity_count', v_count));
    end loop;
  exception
    when exclusion_violation then
      perform private.raise_tp('TP_OVERLAP', 'overlap',
        format('trip:%s:item:%s overlaps an earlier activity of the trip', v_n, v_m));
    when raise_exception then
      get stacked diagnostics
        v_message = message_text, v_detail = pg_exception_detail;
      if v_message = 'TP_OUT_OF_RANGE' then
        perform private.raise_tp('TP_OUT_OF_RANGE', v_detail,
          format('trip:%s:item:%s is outside the trip window', v_n, v_m));
      end if;
      raise;
  end;

  return jsonb_build_object('trips', v_result);
end;
$$;

revoke all on function public.import_trips(jsonb) from public, anon;
grant execute on function public.import_trips(jsonb) to authenticated;
