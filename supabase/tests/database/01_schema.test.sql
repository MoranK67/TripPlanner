-- M1.1 schema: tables, check constraints, exclusion constraint, defaults, cascades, privileges.
-- Run with supabase/tests/run-db-tests.mjs (prepends _helpers.sql; everything is rolled back).

create function tests.test_01_tables_and_extension()
returns setof text
language plpgsql
as $fn$
begin
  return next has_table('public', 'profiles', 'profiles exists');
  return next has_table('public', 'trips', 'trips exists');
  return next has_table('public', 'activities', 'activities exists');
  return next ok(
    exists (select 1 from pg_extension where extname = 'btree_gist'),
    'btree_gist is installed'
  );
  return next is(
    (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'trips_owner_start_idx'),
    'CREATE INDEX trips_owner_start_idx ON public.trips USING btree (owner_id, start_date)',
    'trips (owner_id, start_date) index');
  return next is(
    (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'activities_trip_date_idx'),
    'CREATE INDEX activities_trip_date_idx ON public.activities USING btree (trip_id, scheduled_date)',
    'activities (trip_id, scheduled_date) index');
  return next is(
    (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'activities_trip_bank_idx'),
    'CREATE INDEX activities_trip_bank_idx ON public.activities USING btree (trip_id, bank_position) WHERE (scheduled_date IS NULL)',
    'activities (trip_id, bank_position) bank index');
  return next ok(
    exists (select 1 from pg_constraint where conname = 'activities_no_overlap' and contype = 'x'),
    'activities_no_overlap exclusion constraint exists');
end;
$fn$;

create function tests.test_02_rls_enabled_and_forced()
returns setof text
language plpgsql
as $fn$
begin
  return next is(
    (select count(*)::integer from pg_class c
     where c.oid in ('public.profiles'::regclass, 'public.trips'::regclass, 'public.activities'::regclass)
       and c.relrowsecurity and c.relforcerowsecurity),
    3,
    'RLS is enabled and forced on profiles, trips, activities'
  );
end;
$fn$;

create function tests.test_03_privileges()
returns setof text
language plpgsql
as $fn$
declare
  v_table text;
  v_priv text;
begin
  foreach v_table in array array['public.profiles', 'public.trips', 'public.activities'] loop
    foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      return next ok(
        not has_table_privilege('anon', v_table, v_priv),
        format('anon has no %s on %s', v_priv, v_table)
      );
    end loop;
    return next ok(
      not has_table_privilege('authenticated', v_table, 'TRUNCATE'),
      format('authenticated has no TRUNCATE on %s', v_table)
    );
    return next ok(
      has_table_privilege('authenticated', v_table, 'SELECT'),
      format('authenticated can SELECT %s', v_table)
    );
  end loop;

  return next ok(has_table_privilege('authenticated', 'public.trips', 'INSERT, DELETE'), 'authenticated can insert/delete trips');
  return next ok(has_table_privilege('authenticated', 'public.activities', 'INSERT, DELETE'), 'authenticated can insert/delete activities');
  return next ok(not has_table_privilege('authenticated', 'public.profiles', 'INSERT'), 'authenticated cannot insert profiles');
  return next ok(not has_table_privilege('authenticated', 'public.profiles', 'DELETE'), 'authenticated cannot delete profiles');

  -- Column-level UPDATE: ids, ownership and timestamps are not writable.
  return next ok(not has_column_privilege('authenticated', 'public.trips', 'owner_id', 'UPDATE'), 'trips.owner_id not updatable');
  return next ok(not has_column_privilege('authenticated', 'public.trips', 'id', 'UPDATE'), 'trips.id not updatable');
  return next ok(not has_column_privilege('authenticated', 'public.trips', 'created_at', 'UPDATE'), 'trips.created_at not updatable');
  return next ok(has_column_privilege('authenticated', 'public.trips', 'name', 'UPDATE'), 'trips.name updatable');
  return next ok(not has_column_privilege('authenticated', 'public.activities', 'trip_id', 'UPDATE'), 'activities.trip_id not updatable');
  return next ok(has_column_privilege('authenticated', 'public.activities', 'start_minute', 'UPDATE'), 'activities.start_minute updatable');
  return next ok(not has_column_privilege('authenticated', 'public.profiles', 'id', 'UPDATE'), 'profiles.id not updatable');
  return next ok(has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE'), 'profiles.display_name updatable');
end;
$fn$;

create function tests.test_04_profile_checks()
returns setof text
language plpgsql
as $fn$
begin
  return next is(
    tests.violated(format($q$update public.profiles set locale = 'en' where id = %L$q$, tests.user_a())),
    '23514 profiles_locale_supported', 'locale must be he');
  return next is(
    tests.violated(format($q$update public.profiles set display_name = '' where id = %L$q$, tests.user_a())),
    '23514 profiles_display_name_length', 'display_name cannot be empty');
  return next is(
    tests.violated(format($q$update public.profiles set display_name = repeat('x', 61) where id = %L$q$, tests.user_a())),
    '23514 profiles_display_name_length', 'display_name max 60');
  return next is(
    tests.violated(format($q$update public.profiles set display_name = repeat('א', 60) where id = %L$q$, tests.user_a())),
    'ok', 'display_name of 60 chars is fine');
end;
$fn$;

create function tests.test_05_trip_checks()
returns setof text
language plpgsql
as $fn$
declare
  a uuid := tests.user_a();
  ins text := $q$insert into public.trips (owner_id, name, start_date, start_minute, end_date, end_minute) values (%L, %L, %L, %s, %L, %s)$q$;
begin
  return next is(tests.violated(format(ins, a, '', '2026-03-01', 0, '2026-03-02', 600)),
    '23514 trips_name_length', 'empty trip name rejected');
  return next is(tests.violated(format(ins, a, repeat('x', 51), '2026-03-01', 0, '2026-03-02', 600)),
    '23514 trips_name_length', '51-char trip name rejected');
  return next is(tests.violated(format(ins, a, repeat('ש', 50), '2026-03-01', 0, '2026-03-02', 600)),
    'ok', '50-char Hebrew trip name accepted');
  return next is(tests.violated(format(ins, a, 'T', '2026-03-01', 15, '2026-03-02', 600)),
    '23514 trips_start_minute_valid', 'start minute off the grid rejected');
  return next is(tests.violated(format(ins, a, 'T', '2026-03-01', 1440, '2026-03-02', 600)),
    '23514 trips_start_minute_valid', 'start minute 1440 rejected');
  return next is(tests.violated(format(ins, a, 'T', '2026-03-01', -30, '2026-03-02', 600)),
    '23514 trips_start_minute_valid', 'negative start minute rejected');
  return next is(tests.violated(format(ins, a, 'T', '2026-03-01', 1410, '2026-03-02', 1440)),
    'ok', 'start 23:30, end 24:00 accepted');
  return next is(tests.violated(format(ins, a, 'T', '2026-03-01', 0, '2026-03-02', 0)),
    '23514 trips_end_minute_valid', 'end minute 0 rejected');
  return next is(tests.violated(format(ins, a, 'T', '2026-03-01', 0, '2026-03-02', 1470)),
    '23514 trips_end_minute_valid', 'end minute 1470 rejected');
  return next is(tests.violated(format(ins, a, 'T', '2026-03-01', 0, '2026-03-02', 45)),
    '23514 trips_end_minute_valid', 'end minute off the grid rejected');
  return next is(tests.violated(format(ins, a, 'T', '2026-03-01', 600, '2026-03-01', 600)),
    '23514 trips_end_after_start', 'end equal to start rejected');
  return next is(tests.violated(format(ins, a, 'T', '2026-03-01', 600, '2026-03-01', 570)),
    '23514 trips_end_after_start', 'single-day trip ending before start rejected');
  return next is(tests.violated(format(ins, a, 'T', '2026-03-02', 0, '2026-03-01', 1440)),
    '23514 trips_end_after_start', 'end date before start date rejected');
  return next is(tests.violated(format(ins, a, 'T', '2026-03-01', 600, '2026-03-01', 630)),
    'ok', 'single-day trip of 30 minutes accepted');
  return next is(tests.violated(format(ins, a, 'T', '2026-01-01', 0, '2026-03-31', 1440)),
    'ok', '90-day trip (end - start = 89) accepted');
  return next is(tests.violated(format(ins, a, 'T', '2026-01-01', 0, '2026-04-01', 30)),
    '23514 trips_max_90_days', '91-day trip rejected');
  return next is(tests.violated(format(ins, a, 'T', '2028-02-28', 0, '2028-03-01', 1440)),
    'ok', 'leap-day trip accepted');
  return next is(tests.violated(format(ins, a, 'T', '2026-12-31', 0, '2027-01-01', 1440)),
    'ok', 'year-boundary trip accepted');
end;
$fn$;

create function tests.test_06_trip_defaults()
returns setof text
language plpgsql
as $fn$
declare
  v_trip public.trips;
begin
  -- owner_id defaults to auth.uid() for an app user.
  perform tests.authenticate_as(tests.user_a());
  insert into public.trips (name, start_date, start_minute, end_date, end_minute)
  values ('Defaults', '2026-05-01', 0, '2026-05-02', 1440)
  returning * into v_trip;
  perform tests.clear_auth();

  return next is(v_trip.owner_id, tests.user_a(), 'owner_id defaults to auth.uid()');
  return next is(v_trip.color_cursor, 0, 'color_cursor defaults to 0');
  return next ok(v_trip.timezone is null, 'timezone is null (reserved)');
  return next ok(v_trip.created_at is not null and v_trip.updated_at is not null, 'timestamps set');
  return next is(
    tests.violated(format('update public.trips set color_cursor = -1 where id = %L', v_trip.id)),
    '23514 trips_color_cursor_non_negative', 'color_cursor cannot be negative');
end;
$fn$;

create function tests.test_07_activity_checks()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a(), '2026-03-01', 0, '2026-03-03', 1440);
  ins text := $q$insert into public.activities (trip_id, name, duration_minutes, color) values (%L, %L, %s, %L)$q$;
begin
  return next is(tests.violated(format(ins, t, '', 60, '#FFD6E0')),
    '23514 activities_name_length', 'empty activity name rejected');
  return next is(tests.violated(format(ins, t, repeat('x', 61), 60, '#FFD6E0')),
    '23514 activities_name_length', '61-char activity name rejected');
  return next is(tests.violated(format(ins, t, repeat('🎡', 60), 60, '#FFD6E0')),
    'ok', '60 emoji (code points) accepted');
  return next is(tests.violated(format(ins, t, 'Mixed עברית English', 60, '#FFD6E0')),
    'ok', 'mixed Hebrew/English name accepted');
  return next is(tests.violated(format(ins, t, 'A', 0, '#FFD6E0')),
    '23514 activities_duration_valid', 'duration 0 rejected');
  return next is(tests.violated(format(ins, t, 'A', 45, '#FFD6E0')),
    '23514 activities_duration_valid', 'duration off the grid rejected');
  return next is(tests.violated(format(ins, t, 'A', 1470, '#FFD6E0')),
    '23514 activities_duration_valid', 'duration over 24 h rejected');
  return next is(tests.violated(format(ins, t, 'A', 1440, '#FFD6E0')),
    'ok', '24 h duration accepted');
  return next is(tests.violated(format(ins, t, 'A', 60, 'red')),
    '23514 activities_color_format', 'non-hex colour rejected');
  return next is(tests.violated(format(ins, t, 'A', 60, '#FFD6E')),
    '23514 activities_color_format', 'short hex colour rejected');
  return next is(tests.violated(format(ins, t, 'A', 60, '#abcdef')),
    'ok', 'lower-case hex colour accepted (format only)');

  return next is(
    tests.violated(format($q$insert into public.activities (trip_id, name, duration_minutes, scheduled_date) values (%L, 'A', 60, '2026-03-01')$q$, t)),
    '23514 activities_placement_complete', 'date without start minute rejected');
  return next is(
    tests.violated(format($q$insert into public.activities (trip_id, name, duration_minutes, start_minute) values (%L, 'A', 60, 600)$q$, t)),
    '23514 activities_placement_complete', 'start minute without date rejected');
  return next is(
    tests.violated(format($q$insert into public.activities (trip_id, name, duration_minutes, scheduled_date, start_minute) values (%L, 'A', 60, '2026-03-01', 615)$q$, t)),
    '23514 activities_start_minute_valid', 'start minute off the grid rejected');
end;
$fn$;

-- activities_within_day is shadowed by the validate trigger (which fires first and raises
-- TP_OUT_OF_RANGE); disable the trigger inside this test to prove the constraint on its own.
create function tests.test_08_activity_within_day_constraint()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a(), '2026-03-01', 0, '2026-03-03', 1440);
begin
  alter table public.activities disable trigger activities_20_validate_in_trip;
  return next is(
    tests.violated(format($q$insert into public.activities (trip_id, name, duration_minutes, scheduled_date, start_minute) values (%L, 'A', 60, '2026-03-02', 1410)$q$, t)),
    '23514 activities_within_day', 'crossing midnight rejected by the check constraint');
  return next is(
    tests.violated(format($q$insert into public.activities (trip_id, name, duration_minutes, scheduled_date, start_minute) values (%L, 'A', 30, '2026-03-02', 1410)$q$, t)),
    'ok', 'ending exactly at 24:00 accepted');
  return next is(
    tests.violated(format($q$insert into public.activities (trip_id, name, duration_minutes, scheduled_date, start_minute) values (%L, 'A', 30, '2026-03-03', 1440)$q$, t)),
    '23514 activities_start_minute_valid', 'start minute 1440 rejected by the check constraint');
  alter table public.activities enable trigger activities_20_validate_in_trip;
end;
$fn$;

create function tests.test_09_no_overlap_constraint()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a(), '2026-03-01', 0, '2026-03-03', 1440);
  t2 uuid := tests.make_trip(tests.user_a(), '2026-03-01', 0, '2026-03-03', 1440, 'Other trip');
  ins text := $q$insert into public.activities (trip_id, name, duration_minutes, scheduled_date, start_minute) values (%L, 'A', %s, %L, %s)$q$;
begin
  perform tests.make_activity(t, 'Museum', 120, '2026-03-02', 600);   -- 10:00–12:00

  return next is(tests.violated(format(ins, t, 60, '2026-03-02', 660)),
    '23P01 activities_no_overlap', 'overlapping range on the same day rejected');
  return next is(tests.violated(format(ins, t, 300, '2026-03-02', 540)),
    '23P01 activities_no_overlap', 'range containing another rejected');
  return next is(tests.violated(format(ins, t, 30, '2026-03-02', 600)),
    '23P01 activities_no_overlap', 'same start rejected');
  return next is(tests.violated(format(ins, t, 60, '2026-03-02', 720)),
    'ok', 'starting exactly at another''s end accepted (half-open)');
  return next is(tests.violated(format(ins, t, 60, '2026-03-02', 540)),
    'ok', 'ending exactly at another''s start accepted (half-open)');
  return next is(tests.violated(format(ins, t, 120, '2026-03-03', 600)),
    'ok', 'same time on another day accepted');
  return next is(tests.violated(format(ins, t2, 120, '2026-03-02', 600)),
    'ok', 'same time in another trip accepted');
  return next is(
    tests.violated(format($q$insert into public.activities (trip_id, name, duration_minutes) values (%L, 'Bank 1', 120), (%L, 'Bank 2', 120)$q$, t, t)),
    'ok', 'bank activities never conflict');
end;
$fn$;

create function tests.test_10_cascades()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a());
  t_b uuid := tests.make_trip(tests.user_b());
begin
  perform tests.make_activity(t, 'A1');
  perform tests.make_activity(t, 'A2', 60, '2026-03-02', 600);
  perform tests.make_activity(t_b, 'B1');

  delete from public.trips where id = t;
  return next is((select count(*)::integer from public.activities where trip_id = t), 0,
    'deleting a trip deletes its activities');

  delete from auth.users where id = tests.user_b();
  return next is((select count(*)::integer from public.profiles where id = tests.user_b()), 0,
    'deleting an auth user deletes the profile');
  return next is((select count(*)::integer from public.trips where id = t_b), 0,
    'deleting an auth user deletes their trips');
  return next is((select count(*)::integer from public.activities where trip_id = t_b), 0,
    '... and their activities');
end;
$fn$;
