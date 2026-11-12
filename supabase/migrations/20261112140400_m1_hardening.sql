-- M1 hardening (follow-up to M1.1–M1.4 after security review). The earlier migrations are
-- applied and frozen; everything here is additive or CREATE OR REPLACE.
--
--   1. activities.bank_position must be finite (PostgREST accepts "NaN"/"Infinity", which would
--      poison max() + 1 bank appends).
--   2. Default privileges: new public tables no longer hand TRUNCATE/REFERENCES/TRIGGER/MAINTAIN
--      to anon/authenticated/service_role; leftovers on existing tables removed from
--      service_role (DEC-019: service_role has no table rights).
--   3. trips.timezone limited to 64 characters (reserved column, but writable by clients).
--   4. import_activities: a non-object item reports `item:<n>` (was `item:<n>:name`).
--   5. TP_NOT_FOUND now uses SQLSTATE P0001 instead of P0002 (see "SQLSTATE choice" below).
--   6. Error contract restated below, including plain-write codes.
--
-- =============================================================================================
-- ERROR CONTRACT (supersedes the header of 20261112140300_m1_4_rpcs.sql)
-- message = the code exactly; details = machine-readable reason; hint = English, logs only.
--
-- | message          | SQLSTATE | HTTP | AppError kind    | details                                   |
-- |------------------|----------|------|------------------|-------------------------------------------|
-- | TP_OVERLAP       | 23P01    | 400  | conflict_overlap | 'overlap'                                 |
-- | TP_OUT_OF_RANGE  | P0001    | 400  | out_of_range     | 'outside_trip_window'                     |
-- | TP_LIMIT         | P0001    | 400  | validation       | 'too_many_items'                          |
-- | TP_VALIDATION    | P0001    | 400  | validation       | see list below                            |
-- | TP_NOT_FOUND     | P0001    | 400  | not_found        | 'trip' | 'activity'                       |
--
-- TP_VALIDATION details: 'activity_id' | 'scheduled_date' | 'start_minute' | 'trip_id' |
--   'items' | 'item:<n>' (item is not a JSON object) | 'item:<n>:name' |
--   'item:<n>:duration_minutes' | 'item:<n>:color' | 'name' | 'invalid_date' |
--   'invalid_start_minute' | 'invalid_end_minute' | 'end_not_after_start' | 'too_long'
--   (the last five equal TripWindowError in src/domain/placement.ts). <n> is 1-based.
--
-- Plain table writes (no TP_ code) can also produce:
-- | SQLSTATE              | meaning                                  | AppError kind / handling        |
-- |-----------------------|------------------------------------------|---------------------------------|
-- | 23P01                 | activities_no_overlap violated           | conflict_overlap                |
-- | 23514, 23502          | check / not-null violation               | validation                      |
-- | 22P02, 22007, 22008   | malformed uuid/number/date input         | validation                      |
-- | 22003                 | numeric out of range (e.g. smallint)     | validation                      |
-- | 42501                 | RLS violation / missing privilege        | not_found (treat as no access)  |
-- | 40P01                 | deadlock detected                        | retryable (retry once, else unknown) |
-- | 55P03                 | lock_timeout (8 s on API roles)          | retryable                       |
-- | 57014                 | statement_timeout / query cancelled      | retryable                       |
-- PostgREST maps 40*, 55*, 57* to HTTP 500, so retry decisions must use the SQLSTATE (`code`),
-- not the HTTP status.
--
-- SQLSTATE choice for TP_NOT_FOUND: PostgREST maps P0001 → 400 but P0* (incl. P0002) → 500,
-- which would look like a server crash. PostgREST's `PTxyz` convention (e.g. PT404 → HTTP 404)
-- was rejected: it couples SQL errors to one HTTP gateway, and a 404 from /rest/v1/rpc/... is
-- also what PostgREST returns for a missing function (PGRST202), so status alone would be
-- ambiguous. The data layer maps by `message` anyway; P0001 keeps every TP_* business error
-- a uniform 4xx.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 1. bank_position finite. NaN is greater than every number in Postgres, so `< 'Infinity'`
--    rejects NaN as well.
-- ---------------------------------------------------------------------------------------------
alter table public.activities
  add constraint activities_bank_position_finite
  check (bank_position > '-Infinity'::double precision
         and bank_position < 'Infinity'::double precision);

-- ---------------------------------------------------------------------------------------------
-- 2. Privileges
-- ---------------------------------------------------------------------------------------------
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables from anon, authenticated, service_role;

revoke all on table public.profiles, public.trips, public.activities from service_role;

-- ---------------------------------------------------------------------------------------------
-- 3. trips.timezone length (IANA names are well under 64 characters).
-- ---------------------------------------------------------------------------------------------
alter table public.trips
  add constraint trips_timezone_length
  check (timezone is null or char_length(timezone) <= 64);

-- ---------------------------------------------------------------------------------------------
-- 5. TP_NOT_FOUND → SQLSTATE P0001 (raise_tp and the two triggers that raise it directly).
--    CREATE OR REPLACE keeps existing grants and trigger bindings.
-- ---------------------------------------------------------------------------------------------
create or replace function private.raise_tp(code text, reason text, info text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = case raise_tp.code when 'TP_OVERLAP' then '23P01' else 'P0001' end,
    message = raise_tp.code,
    detail = raise_tp.reason,
    hint = coalesce(raise_tp.info, '');
end;
$$;

create or replace function private.assign_activity_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cursor integer;
begin
  select t.color_cursor into v_cursor
  from public.trips t
  where t.id = new.trip_id
  for update;

  if not found then
    perform private.raise_tp('TP_NOT_FOUND', 'trip', 'The trip does not exist or is not accessible.');
  end if;

  if new.color is null then
    new.color := private.palette_color(v_cursor);
  end if;

  if new.bank_position is null then
    select coalesce(max(a.bank_position), 0) + 1 into new.bank_position
    from public.activities a
    where a.trip_id = new.trip_id;
  end if;

  update public.trips t
  set color_cursor = (v_cursor + 1) % cardinality(private.palette())
  where t.id = new.trip_id;

  return new;
end;
$$;

create or replace function private.validate_activity_in_trip()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_trip record;
begin
  -- Bank activities, and half-set placements (rejected by activities_placement_complete).
  if new.scheduled_date is null or new.start_minute is null then
    return new;
  end if;

  select t.start_date, t.start_minute, t.end_date, t.end_minute into v_trip
  from public.trips t
  where t.id = new.trip_id
  for share;

  if not found then
    perform private.raise_tp('TP_NOT_FOUND', 'trip', 'The trip does not exist or is not accessible.');
  end if;

  if not private.fits_trip_window(
    v_trip.start_date, v_trip.start_minute, v_trip.end_date, v_trip.end_minute,
    new.scheduled_date, new.start_minute, new.duration_minutes
  ) then
    perform private.raise_tp('TP_OUT_OF_RANGE', 'outside_trip_window', format(
      'Activity %s (%s min at minute %s on %s) is outside the trip window.',
      new.id, new.duration_minutes, new.start_minute, new.scheduled_date
    ));
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. import_activities: non-object item → details 'item:<n>'. Otherwise unchanged.
-- ---------------------------------------------------------------------------------------------
create or replace function public.import_activities(trip_id uuid, items jsonb)
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
      perform private.raise_tp('TP_VALIDATION', format('item:%s', v_index),
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
