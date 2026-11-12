-- M1.2: triggers and internal helpers (PROJECT_PLAN §6.3).
--
-- Internal functions live in schema `private`, which is not exposed through the Data API, so
-- they can never be called as RPCs. Trigger functions are SECURITY INVOKER (RLS applies to the
-- caller) except handle_new_user, which must write profiles on behalf of the auth service.
--
-- Triggers on activities, in firing order (Postgres fires same-event triggers by name):
--   BEFORE INSERT                 activities_10_assign_defaults   colour + bank_position + cursor
--   BEFORE INSERT/UPDATE (placing) activities_20_validate_in_trip  TP_OUT_OF_RANGE
--   BEFORE UPDATE                 activities_90_set_updated_at
-- Triggers on trips:
--   BEFORE UPDATE                 trips_90_set_updated_at
--   AFTER UPDATE OF window cols   trips_unplace_out_of_range      moves activities to the bank
--
-- Error codes raised here (full list in the M1.4 migration header):
--   TP_OUT_OF_RANGE (P0001), TP_NOT_FOUND (P0002).

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- Functions get EXECUTE for PUBLIC by default; every function below is revoked explicitly and
-- granted to authenticated only where an invoker-rights caller needs it.

-- ---------------------------------------------------------------------------------------------
-- Palette (same values and order as PALETTE in src/domain/constants.ts).
-- ---------------------------------------------------------------------------------------------
create function private.palette()
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select array[
    '#FFD6E0', '#FFE3C2', '#FFF1B5', '#D6F2C9', '#C8EBE3',
    '#CDE5FF', '#DAD4FA', '#F3D3F2', '#FCD5C8', '#E6E1DA'
  ]::text[];
$$;

-- Colour for a cursor, wrapping around like paletteColorAt() in src/domain/guards.ts.
create function private.palette_color(color_cursor integer)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select (private.palette())[
    ((palette_color.color_cursor % cardinality(private.palette())) + cardinality(private.palette()))
      % cardinality(private.palette()) + 1
  ];
$$;

-- Always NULL. Used as the column DEFAULT of values that a BEFORE INSERT trigger fills in
-- (activities.color, activities.bank_position), so generated types mark them optional on insert.
-- A literal `DEFAULT NULL` would not work: Postgres does not record it as a default.
create function private.filled_by_trigger()
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select null::text;
$$;

-- ---------------------------------------------------------------------------------------------
-- Placement bounds — the single DB definition of "fits the trip window".
-- Mirrors fitsDay() / dayBounds() in src/domain: the date is a trip day, the first day starts at
-- the trip start minute, the last day ends at the trip end minute, other days are 00:00–24:00;
-- the half-open range [start, start + duration) must lie inside those bounds (so it can never
-- cross midnight).
-- ---------------------------------------------------------------------------------------------
create function private.fits_trip_window(
  trip_start_date date,
  trip_start_minute integer,
  trip_end_date date,
  trip_end_minute integer,
  scheduled_date date,
  start_minute integer,
  duration_minutes integer
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select fits_trip_window.scheduled_date between fits_trip_window.trip_start_date
                                             and fits_trip_window.trip_end_date
    and fits_trip_window.start_minute >= case
          when fits_trip_window.scheduled_date = fits_trip_window.trip_start_date
            then fits_trip_window.trip_start_minute
          else 0
        end
    and fits_trip_window.start_minute + fits_trip_window.duration_minutes <= case
          when fits_trip_window.scheduled_date = fits_trip_window.trip_end_date
            then fits_trip_window.trip_end_minute
          else 1440
        end;
$$;

revoke all on function private.palette() from public, anon;
revoke all on function private.palette_color(integer) from public, anon;
revoke all on function private.filled_by_trigger() from public, anon;
revoke all on function private.fits_trip_window(date, integer, date, integer, date, integer, integer)
  from public, anon;
-- Needed by invoker-rights triggers/RPCs and by the column defaults below.
grant execute on function private.palette() to authenticated;
grant execute on function private.palette_color(integer) to authenticated;
grant execute on function private.filled_by_trigger() to authenticated;
grant execute on function private.fits_trip_window(date, integer, date, integer, date, integer, integer)
  to authenticated;

-- ---------------------------------------------------------------------------------------------
-- set_updated_at
-- ---------------------------------------------------------------------------------------------
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public, anon;

create trigger trips_90_set_updated_at
  before update on public.trips
  for each row execute function private.set_updated_at();

create trigger activities_90_set_updated_at
  before update on public.activities
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- handle_new_user: creates the profile row for every new auth user.
-- SECURITY DEFINER because the auth service (supabase_auth_admin) inserts into auth.users and
-- has no rights on public.profiles. Owner `postgres` has BYPASSRLS.
-- ---------------------------------------------------------------------------------------------
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 60), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Users created before this migration (e.g. via the dashboard) get their profile now.
insert into public.profiles (id)
select u.id from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------------------------
-- assign_activity_defaults (BEFORE INSERT on activities) — atomic colour assignment.
--
-- Every new activity advances trips.color_cursor by one (wrapping at the palette size), whether
-- or not a colour was supplied — same rule as the prototype. When `color` is NULL the activity
-- gets palette_color(cursor). When `bank_position` is NULL it is appended (max + 1 in the trip).
-- The trip row is locked FOR UPDATE, so concurrent inserts into one trip are serialised and two
-- activities never read the same cursor. import_activities relies on this trigger as well.
-- Invoker rights: a trip the caller cannot edit is invisible here → TP_NOT_FOUND.
-- ---------------------------------------------------------------------------------------------
create function private.assign_activity_defaults()
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
    raise exception using
      errcode = 'P0002',
      message = 'TP_NOT_FOUND',
      detail = 'trip',
      hint = 'The trip does not exist or is not accessible.';
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

revoke all on function private.assign_activity_defaults() from public, anon;

alter table public.activities
  alter column color set default private.filled_by_trigger(),
  alter column bank_position set default private.filled_by_trigger()::double precision;

create trigger activities_10_assign_defaults
  before insert on public.activities
  for each row execute function private.assign_activity_defaults();

-- ---------------------------------------------------------------------------------------------
-- validate_activity_in_trip (BEFORE INSERT/UPDATE on activities)
-- A placed activity must lie inside its trip's window (fits_trip_window); otherwise
-- TP_OUT_OF_RANGE. The trip row is locked FOR SHARE so a concurrent window change
-- (update_trip_window) cannot slip between this check and the commit.
-- ---------------------------------------------------------------------------------------------
create function private.validate_activity_in_trip()
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
    raise exception using
      errcode = 'P0002',
      message = 'TP_NOT_FOUND',
      detail = 'trip',
      hint = 'The trip does not exist or is not accessible.';
  end if;

  if not private.fits_trip_window(
    v_trip.start_date, v_trip.start_minute, v_trip.end_date, v_trip.end_minute,
    new.scheduled_date, new.start_minute, new.duration_minutes
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'TP_OUT_OF_RANGE',
      detail = 'outside_trip_window',
      hint = format(
        'Activity %s (%s min at minute %s on %s) is outside the trip window.',
        new.id, new.duration_minutes, new.start_minute, new.scheduled_date
      );
  end if;

  return new;
end;
$$;

revoke all on function private.validate_activity_in_trip() from public, anon;

create trigger activities_20_validate_in_trip
  before insert or update of trip_id, scheduled_date, start_minute, duration_minutes
  on public.activities
  for each row execute function private.validate_activity_in_trip();

-- ---------------------------------------------------------------------------------------------
-- unplace_out_of_range_activities (AFTER UPDATE of the window on trips) — FR-2.6.
-- Placed activities that no longer fit the new window go back to the bank, appended after the
-- current max bank_position in timetable order (date, start minute).
-- ---------------------------------------------------------------------------------------------
create function private.unplace_out_of_range_activities()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_base double precision;
begin
  select coalesce(max(a.bank_position), 0) into v_base
  from public.activities a
  where a.trip_id = new.id;

  with moved as (
    select a.id,
           row_number() over (order by a.scheduled_date, a.start_minute, a.id) as rn
    from public.activities a
    where a.trip_id = new.id
      and a.scheduled_date is not null
      and not private.fits_trip_window(
        new.start_date, new.start_minute, new.end_date, new.end_minute,
        a.scheduled_date, a.start_minute, a.duration_minutes
      )
  )
  update public.activities a
  set scheduled_date = null,
      start_minute = null,
      bank_position = v_base + moved.rn
  from moved
  where a.id = moved.id;

  return null;
end;
$$;

revoke all on function private.unplace_out_of_range_activities() from public, anon;

create trigger trips_unplace_out_of_range
  after update of start_date, start_minute, end_date, end_minute on public.trips
  for each row
  when (
    (old.start_date, old.start_minute, old.end_date, old.end_minute)
      is distinct from (new.start_date, new.start_minute, new.end_date, new.end_minute)
  )
  execute function private.unplace_out_of_range_activities();
