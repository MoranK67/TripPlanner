-- M1.4: RPCs for business operations (PROJECT_PLAN §6.3, §7.1).
--
-- All RPCs are SECURITY INVOKER: RLS applies, so another user's rows are simply "not found".
-- Executable by `authenticated` only.
--
-- ERROR CONTRACT — stable codes for the data layer (src/data maps them to AppError kinds, §4.6).
-- The error `message` is exactly the code; `details` holds a machine-readable reason;
-- `hint` is English text for logs only (never shown to users).
--
-- | message          | SQLSTATE | AppError kind      | raised by                                         |
-- |------------------|----------|--------------------|---------------------------------------------------|
-- | TP_OVERLAP       | 23P01    | conflict_overlap   | place_activity                                    |
-- | TP_OUT_OF_RANGE  | P0001    | out_of_range       | place_activity, trigger validate_activity_in_trip |
-- | TP_LIMIT         | P0001    | validation         | import_activities (> 200 items)                   |
-- | TP_VALIDATION    | P0001    | validation         | all RPCs (malformed arguments)                    |
-- | TP_NOT_FOUND     | P0002    | not_found          | all RPCs, triggers (row missing or not accessible)|
--
-- Errors without a TP_ code that plain table writes can still produce:
--   23P01 exclusion_violation (constraint activities_no_overlap)  -> conflict_overlap
--   23514 check_violation, 23502 not_null_violation, 22P02/22007/22008 bad input -> validation
--   42501 insufficient_privilege / RLS violation                   -> not_found (treat as no access)
--
-- `details` values: TP_VALIDATION → 'activity_id' | 'scheduled_date' | 'start_minute' |
--   'items' | 'item:<n>:name' | 'item:<n>:duration_minutes' | 'item:<n>:color' | 'trip_id' |
--   'name' | 'invalid_date' | 'invalid_start_minute' | 'invalid_end_minute' |
--   'end_not_after_start' | 'too_long' (the last five match TripWindowError in
--   src/domain/placement.ts); TP_OUT_OF_RANGE → 'outside_trip_window';
--   TP_OVERLAP → 'overlap'; TP_LIMIT → 'too_many_items'; TP_NOT_FOUND → 'trip' | 'activity'.

-- ---------------------------------------------------------------------------------------------
-- Internal: raise helper so every RPC formats errors the same way.
-- ---------------------------------------------------------------------------------------------
create function private.raise_tp(code text, reason text, info text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = case raise_tp.code
                when 'TP_OVERLAP' then '23P01'
                when 'TP_NOT_FOUND' then 'P0002'
                else 'P0001'
              end,
    message = raise_tp.code,
    detail = raise_tp.reason,
    hint = coalesce(raise_tp.info, '');
end;
$$;

revoke all on function private.raise_tp(text, text, text) from public, anon;
grant execute on function private.raise_tp(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- place_activity(activity_id, scheduled_date, start_minute) -> activities row
-- Places or moves an activity. Checks in the same order as canPlace() in src/domain:
-- malformed input (TP_VALIDATION) → outside the window (TP_OUT_OF_RANGE) → overlap (TP_OVERLAP).
-- Lock order trip → activity (same as update_trip_window) to avoid deadlocks.
-- ---------------------------------------------------------------------------------------------
create function public.place_activity(
  activity_id uuid,
  scheduled_date date,
  start_minute integer
)
returns public.activities
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_trip_id uuid;
  v_trip public.trips;
  v_activity public.activities;
begin
  if place_activity.activity_id is null then
    perform private.raise_tp('TP_VALIDATION', 'activity_id', 'activity_id is required');
  end if;
  if place_activity.scheduled_date is null then
    perform private.raise_tp('TP_VALIDATION', 'scheduled_date', 'scheduled_date is required');
  end if;
  if place_activity.start_minute is null
     or place_activity.start_minute not between 0 and 1410
     or place_activity.start_minute % 30 <> 0 then
    perform private.raise_tp('TP_VALIDATION', 'start_minute',
      'start_minute must be 0..1410 and a multiple of 30');
  end if;

  select a.trip_id into v_trip_id
  from public.activities a
  where a.id = place_activity.activity_id;
  if not found then
    perform private.raise_tp('TP_NOT_FOUND', 'activity');
  end if;

  select * into v_trip from public.trips t where t.id = v_trip_id for share;
  if not found then
    perform private.raise_tp('TP_NOT_FOUND', 'trip');
  end if;

  select * into v_activity
  from public.activities a
  where a.id = place_activity.activity_id
  for update;
  if not found then
    perform private.raise_tp('TP_NOT_FOUND', 'activity');
  end if;

  if not private.fits_trip_window(
    v_trip.start_date, v_trip.start_minute, v_trip.end_date, v_trip.end_minute,
    place_activity.scheduled_date, place_activity.start_minute, v_activity.duration_minutes
  ) then
    perform private.raise_tp('TP_OUT_OF_RANGE', 'outside_trip_window');
  end if;

  if exists (
    select 1
    from public.activities o
    where o.trip_id = v_activity.trip_id
      and o.id <> v_activity.id
      and o.scheduled_date = place_activity.scheduled_date
      and int4range(o.start_minute, o.start_minute + o.duration_minutes)
          && int4range(place_activity.start_minute,
                       place_activity.start_minute + v_activity.duration_minutes)
  ) then
    perform private.raise_tp('TP_OVERLAP', 'overlap');
  end if;

  begin
    update public.activities a
    set scheduled_date = place_activity.scheduled_date,
        start_minute = place_activity.start_minute
    where a.id = v_activity.id
    returning * into v_activity;
  exception
    -- A concurrent transaction placed something there after our check.
    when exclusion_violation then
      perform private.raise_tp('TP_OVERLAP', 'overlap');
  end;

  return v_activity;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- unplace_activity(activity_id) -> activities row
-- Moves an activity to the end of the bank (bank_position = max + 1 in the trip).
-- Already in the bank: returned unchanged.
-- ---------------------------------------------------------------------------------------------
create function public.unplace_activity(activity_id uuid)
returns public.activities
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_trip_id uuid;
  v_activity public.activities;
  v_position double precision;
begin
  if unplace_activity.activity_id is null then
    perform private.raise_tp('TP_VALIDATION', 'activity_id', 'activity_id is required');
  end if;

  select a.trip_id into v_trip_id
  from public.activities a
  where a.id = unplace_activity.activity_id;
  if not found then
    perform private.raise_tp('TP_NOT_FOUND', 'activity');
  end if;

  -- Serialises bank appends within the trip (same lock as the activity insert trigger).
  perform 1 from public.trips t where t.id = v_trip_id for update;
  if not found then
    perform private.raise_tp('TP_NOT_FOUND', 'trip');
  end if;

  select * into v_activity
  from public.activities a
  where a.id = unplace_activity.activity_id
  for update;
  if not found then
    perform private.raise_tp('TP_NOT_FOUND', 'activity');
  end if;

  if v_activity.scheduled_date is null then
    return v_activity;
  end if;

  select coalesce(max(a.bank_position), 0) + 1 into v_position
  from public.activities a
  where a.trip_id = v_trip_id;

  update public.activities a
  set scheduled_date = null,
      start_minute = null,
      bank_position = v_position
  where a.id = v_activity.id
  returning * into v_activity;

  return v_activity;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- import_activities(trip_id, items) -> setof activities (in input order)
-- items: JSON array of { "name": text, "duration_minutes": int, "color"?: "#RRGGBB" }.
-- All-or-nothing; at most 200 items (TP_LIMIT); an empty array inserts nothing.
-- Colours come from trips.color_cursor via the BEFORE INSERT trigger, one step per item, so
-- import and single inserts share one rule. Items are appended to the bank in input order.
-- ---------------------------------------------------------------------------------------------
create function public.import_activities(trip_id uuid, items jsonb)
returns setof public.activities
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
  v_item jsonb;
  v_index bigint;
  v_name text;
  v_duration integer;
  v_color text;
  v_row public.activities;
begin
  if import_activities.trip_id is null then
    perform private.raise_tp('TP_VALIDATION', 'trip_id', 'trip_id is required');
  end if;
  if import_activities.items is null or jsonb_typeof(import_activities.items) <> 'array' then
    perform private.raise_tp('TP_VALIDATION', 'items', 'items must be a JSON array');
  end if;

  v_count := jsonb_array_length(import_activities.items);
  if v_count > 200 then
    perform private.raise_tp('TP_LIMIT', 'too_many_items',
      format('%s items; at most 200 can be imported at once', v_count));
  end if;

  perform 1 from public.trips t where t.id = import_activities.trip_id for update;
  if not found then
    perform private.raise_tp('TP_NOT_FOUND', 'trip');
  end if;

  -- Validate everything first so a bad item reports its (1-based) index and nothing is
  -- inserted. Nested IFs, because SQL does not guarantee short-circuit evaluation of OR and the
  -- casts below must only run on values already known to be well-formed.
  for v_item, v_index in
    select e.value, e.ordinality from jsonb_array_elements(import_activities.items)
      with ordinality as e(value, ordinality)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      perform private.raise_tp('TP_VALIDATION', format('item:%s:name', v_index),
        'each item must be a JSON object');
    end if;

    if jsonb_typeof(v_item -> 'name') is distinct from 'string' then
      perform private.raise_tp('TP_VALIDATION', format('item:%s:name', v_index),
        'name must be a string of 1..60 characters');
    end if;
    if char_length(v_item ->> 'name') not between 1 and 60 then
      perform private.raise_tp('TP_VALIDATION', format('item:%s:name', v_index),
        'name must be a string of 1..60 characters');
    end if;

    if jsonb_typeof(v_item -> 'duration_minutes') is distinct from 'number'
       or (v_item ->> 'duration_minutes') !~ '^[0-9]{1,4}$' then
      perform private.raise_tp('TP_VALIDATION', format('item:%s:duration_minutes', v_index),
        'duration_minutes must be an integer 30..1440 and a multiple of 30');
    end if;
    v_duration := (v_item ->> 'duration_minutes')::integer;
    if v_duration not between 30 and 1440 or v_duration % 30 <> 0 then
      perform private.raise_tp('TP_VALIDATION', format('item:%s:duration_minutes', v_index),
        'duration_minutes must be an integer 30..1440 and a multiple of 30');
    end if;

    if jsonb_typeof(v_item -> 'color') is not null
       and jsonb_typeof(v_item -> 'color') <> 'null' then
      if jsonb_typeof(v_item -> 'color') <> 'string' then
        perform private.raise_tp('TP_VALIDATION', format('item:%s:color', v_index),
          'color must be #RRGGBB or omitted');
      end if;
      if (v_item ->> 'color') !~ '^#[0-9A-Fa-f]{6}$' then
        perform private.raise_tp('TP_VALIDATION', format('item:%s:color', v_index),
          'color must be #RRGGBB or omitted');
      end if;
    end if;
  end loop;

  for v_item in
    select e.value from jsonb_array_elements(import_activities.items)
      with ordinality as e(value, ordinality)
    order by e.ordinality
  loop
    v_name := v_item ->> 'name';
    v_duration := (v_item ->> 'duration_minutes')::integer;
    v_color := v_item ->> 'color';  -- NULL → assigned from the cursor by the trigger

    insert into public.activities (trip_id, name, duration_minutes, color)
    values (import_activities.trip_id, v_name, v_duration, v_color)
    returning * into v_row;

    return next v_row;
  end loop;

  return;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- update_trip_window(trip_id, start_date, start_minute, end_date, end_minute, name)
--   -> jsonb { "trip": <trips row, snake_case columns>, "moved_count": <integer> }
-- Updates the trip (name optional: NULL keeps it). Placed activities that no longer fit are
-- moved to the bank by trigger unplace_out_of_range_activities; moved_count is how many (FR-2.6).
-- Window errors use TP_VALIDATION with the TripWindowError reason in `details`.
-- ---------------------------------------------------------------------------------------------
create function public.update_trip_window(
  trip_id uuid,
  start_date date,
  start_minute integer,
  end_date date,
  end_minute integer,
  name text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_trip public.trips;
  v_moved integer;
begin
  if update_trip_window.trip_id is null then
    perform private.raise_tp('TP_VALIDATION', 'trip_id', 'trip_id is required');
  end if;
  if update_trip_window.start_date is null or update_trip_window.end_date is null then
    perform private.raise_tp('TP_VALIDATION', 'invalid_date', 'start_date and end_date are required');
  end if;
  if update_trip_window.start_minute is null
     or update_trip_window.start_minute not between 0 and 1410
     or update_trip_window.start_minute % 30 <> 0 then
    perform private.raise_tp('TP_VALIDATION', 'invalid_start_minute',
      'start_minute must be 0..1410 and a multiple of 30');
  end if;
  if update_trip_window.end_minute is null
     or update_trip_window.end_minute not between 30 and 1440
     or update_trip_window.end_minute % 30 <> 0 then
    perform private.raise_tp('TP_VALIDATION', 'invalid_end_minute',
      'end_minute must be 30..1440 and a multiple of 30');
  end if;
  if (update_trip_window.end_date, update_trip_window.end_minute)
     <= (update_trip_window.start_date, update_trip_window.start_minute) then
    perform private.raise_tp('TP_VALIDATION', 'end_not_after_start', 'trip must end after it starts');
  end if;
  if update_trip_window.end_date - update_trip_window.start_date > 89 then
    perform private.raise_tp('TP_VALIDATION', 'too_long', 'a trip can be at most 90 days');
  end if;
  if update_trip_window.name is not null
     and char_length(update_trip_window.name) not between 1 and 50 then
    perform private.raise_tp('TP_VALIDATION', 'name', 'name must be 1..50 characters');
  end if;

  select * into v_trip
  from public.trips t
  where t.id = update_trip_window.trip_id
  for update;
  if not found then
    perform private.raise_tp('TP_NOT_FOUND', 'trip');
  end if;

  -- The trip row is locked, and placing/inserting activities needs that lock too, so this
  -- count equals what the trigger moves.
  select count(*)::integer into v_moved
  from public.activities a
  where a.trip_id = v_trip.id
    and a.scheduled_date is not null
    and not private.fits_trip_window(
      update_trip_window.start_date, update_trip_window.start_minute,
      update_trip_window.end_date, update_trip_window.end_minute,
      a.scheduled_date, a.start_minute, a.duration_minutes
    );

  update public.trips t
  set start_date = update_trip_window.start_date,
      start_minute = update_trip_window.start_minute,
      end_date = update_trip_window.end_date,
      end_minute = update_trip_window.end_minute,
      name = coalesce(update_trip_window.name, t.name)
  where t.id = v_trip.id
  returning * into v_trip;

  return jsonb_build_object('trip', to_jsonb(v_trip), 'moved_count', v_moved);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Privileges: RPCs for authenticated only.
-- ---------------------------------------------------------------------------------------------
revoke all on function public.place_activity(uuid, date, integer) from public, anon;
revoke all on function public.unplace_activity(uuid) from public, anon;
revoke all on function public.import_activities(uuid, jsonb) from public, anon;
revoke all on function public.update_trip_window(uuid, date, integer, date, integer, text)
  from public, anon;

grant execute on function public.place_activity(uuid, date, integer) to authenticated;
grant execute on function public.unplace_activity(uuid) to authenticated;
grant execute on function public.import_activities(uuid, jsonb) to authenticated;
grant execute on function public.update_trip_window(uuid, date, integer, date, integer, text)
  to authenticated;
