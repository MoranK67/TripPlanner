-- M1.2 triggers: handle_new_user, set_updated_at, colour/bank defaults,
-- validate_activity_in_trip, unplace_out_of_range_activities.
-- Run with supabase/tests/run-db-tests.mjs (prepends _helpers.sql; everything is rolled back).

create function tests.test_01_handle_new_user()
returns setof text
language plpgsql
as $fn$
declare
  v_id uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  v_profile public.profiles;
begin
  select * into v_profile from public.profiles where id = tests.user_a();
  return next ok(found, 'profile created for a new auth user');
  return next is(v_profile.locale, 'he', 'profile locale defaults to he');
  return next ok(v_profile.display_name is null, 'no display_name without metadata');

  perform tests.create_auth_user(v_id, 'pgtap-user-c@trip-planner.invalid',
    jsonb_build_object('display_name', '  ' || repeat('n', 70) || '  '));
  select * into v_profile from public.profiles where id = v_id;
  return next is(v_profile.display_name, repeat('n', 60),
    'display_name taken from metadata, trimmed and cut to 60 chars');
end;
$fn$;

create function tests.test_02_set_updated_at()
returns setof text
language plpgsql
as $fn$
declare
  t uuid;
  a uuid;
  v_old timestamptz := '2000-01-01 00:00:00+00';
begin
  insert into public.trips (owner_id, name, start_date, start_minute, end_date, end_minute, created_at, updated_at)
  values (tests.user_a(), 'Old', '2026-03-01', 0, '2026-03-02', 1440, v_old, v_old)
  returning id into t;
  insert into public.activities (trip_id, name, duration_minutes, created_at, updated_at)
  values (t, 'Old', 60, v_old, v_old)
  returning id into a;

  -- The insert trigger advanced the trip's colour cursor (an UPDATE), so reset it first.
  update public.trips set updated_at = v_old where id = t;
  return next is((select updated_at from public.trips where id = t), now(),
    'any UPDATE sets trips.updated_at = now() (even an explicit value is overridden)');

  update public.activities set name = 'New' where id = a;
  return next is((select updated_at from public.activities where id = a), now(),
    'UPDATE sets activities.updated_at');
  return next is((select created_at from public.activities where id = a), v_old,
    'created_at unchanged');
end;
$fn$;

create function tests.test_03_colour_assignment()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a());
  v_colors text[];
  v_expected text[] := array[
    '#FFD6E0', '#FFE3C2', '#FFF1B5', '#D6F2C9', '#C8EBE3',
    '#CDE5FF', '#DAD4FA', '#F3D3F2', '#FCD5C8', '#E6E1DA',
    '#FFD6E0', '#FFE3C2'
  ];
  i integer;
  v_first uuid;
begin
  for i in 1..12 loop
    perform tests.make_activity(t, 'A' || i);
  end loop;
  select array_agg(color order by bank_position) into v_colors
  from public.activities where trip_id = t;

  return next is(v_colors, v_expected, 'colours follow the palette in order and wrap after 10');
  return next is((select color_cursor from public.trips where id = t), 2,
    'cursor advanced once per activity, modulo palette size');

  insert into public.activities (trip_id, name, duration_minutes, color)
  values (t, 'Chosen colour', 60, '#123456');
  return next is((select color from public.activities where trip_id = t and name = 'Chosen colour'),
    '#123456', 'an explicit colour is kept');
  return next is((select color_cursor from public.trips where id = t), 3,
    'an explicit colour still advances the cursor (prototype rule)');

  -- Cursor 3 → fourth palette colour (mint).
  perform tests.make_activity(t, 'Next');
  return next is((select color from public.activities where trip_id = t and name = 'Next'),
    '#D6F2C9', 'next auto colour continues from the cursor');

  -- (Insert first: a volatile insert inside a WHERE is not visible to that same query.)
  v_first := tests.make_activity(tests.make_trip(tests.user_a()), 'First in new trip');
  return next is((select color from public.activities where id = v_first),
    '#FFD6E0', 'a new trip starts at the first palette colour');
end;
$fn$;

create function tests.test_04_bank_position_default()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a());
  v_positions double precision[];
  v_only uuid;
begin
  perform tests.make_activity(t, 'P1');
  perform tests.make_activity(t, 'P2');
  insert into public.activities (trip_id, name, duration_minutes, bank_position)
  values (t, 'Explicit', 60, 10.5);
  perform tests.make_activity(t, 'P3');

  select array_agg(bank_position order by created_at, bank_position) into v_positions
  from public.activities where trip_id = t;
  return next is(v_positions, array[1, 2, 10.5, 11.5]::double precision[],
    'bank_position defaults to max + 1; an explicit value is kept');

  -- Both columns carry a (NULL-valued) default so generated types make them optional on insert.
  return next is(
    (select array_agg(column_name::text order by column_name) from information_schema.columns
     where table_schema = 'public' and table_name = 'activities'
       and column_name in ('color', 'bank_position') and column_default like '%filled_by_trigger()%'),
    array['bank_position', 'color'], 'color and bank_position default to private.filled_by_trigger()');

  v_only := tests.make_activity(tests.make_trip(tests.user_a()), 'Only');
  return next is((select bank_position from public.activities where id = v_only),
    1::double precision, 'first activity of a trip gets bank_position 1');
end;
$fn$;

create function tests.test_05_insert_into_missing_trip()
returns setof text
language plpgsql
as $fn$
begin
  return next is(
    tests.err_full($q$insert into public.activities (trip_id, name, duration_minutes) values ('00000000-0000-4000-8000-000000000000', 'X', 60)$q$),
    'P0001 TP_NOT_FOUND [trip]', 'inserting into a missing trip raises TP_NOT_FOUND');
end;
$fn$;

-- Trip: 2026-03-01 09:00 → 2026-03-03 18:00 (first/middle/last day).
create function tests.test_06_validate_activity_in_trip()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a(), '2026-03-01', 540, '2026-03-03', 1080);
  ins text := $q$insert into public.activities (trip_id, name, duration_minutes, scheduled_date, start_minute) values (%L, %L, %s, %L, %s)$q$;
  oor text := 'P0001 TP_OUT_OF_RANGE [outside_trip_window]';
begin
  return next is(tests.err_full(format(ins, t, 'x', 60, '2026-02-28', 600)), oor, 'day before the trip rejected');
  return next is(tests.err_full(format(ins, t, 'x', 60, '2026-03-04', 600)), oor, 'day after the trip rejected');
  return next is(tests.err_full(format(ins, t, 'x', 60, '2026-03-01', 510)), oor, 'first day before the start minute rejected');
  return next is(tests.err_full(format(ins, t, 'a', 60, '2026-03-01', 540)), 'ok', 'first day at the start minute accepted');
  return next is(tests.err_full(format(ins, t, 'b', 30, '2026-03-01', 1410)), 'ok', 'first day may end at 24:00');
  return next is(tests.err_full(format(ins, t, 'x', 60, '2026-03-01', 1410)), oor, 'crossing midnight rejected (TP_OUT_OF_RANGE)');
  return next is(tests.err_full(format(ins, t, 'c', 1440, '2026-03-02', 0)), 'ok', '24 h activity on a full middle day at 00:00 accepted');
  return next is(tests.err_full(format(ins, t, 'x', 1440, '2026-03-01', 540)), oor, '24 h activity on a partial first day rejected');
  return next is(tests.err_full(format(ins, t, 'd', 60, '2026-03-03', 1020)), 'ok', 'last day ending exactly at the end minute accepted');
  return next is(tests.err_full(format(ins, t, 'x', 60, '2026-03-03', 1050)), oor, 'last day past the end minute rejected');
  return next is(tests.err_full(format(ins, t, 'e', 30, '2026-03-03', 0)), 'ok', 'last day from 00:00 accepted');
  return next is(tests.err_full(format(ins, t, 'f', 60, null, 'null')), 'ok', 'bank activity is not validated against the window');

  -- UPDATE paths: moving, and lengthening a placed activity.
  return next is(
    tests.err_full(format($q$update public.activities set scheduled_date = '2026-03-05' where trip_id = %L and name = 'd'$q$, t)),
    oor, 'moving outside the trip by UPDATE rejected');
  return next is(
    tests.err_full(format($q$update public.activities set duration_minutes = 120 where trip_id = %L and name = 'd'$q$, t)),
    oor, 'lengthening past the trip end rejected');
  return next is(
    tests.violated(format($q$update public.activities set duration_minutes = 120 where trip_id = %L and name = 'a'$q$, t)),
    'ok', 'lengthening into free time accepted');
  return next is(
    tests.violated(format($q$update public.activities set duration_minutes = 180 where trip_id = %L and name = 'e'$q$, t)),
    'ok', 'lengthening on the last day within bounds accepted');
  perform tests.make_activity(t, 'g', 60, '2026-03-03', 180);
  return next is(
    tests.violated(format($q$update public.activities set duration_minutes = 240 where trip_id = %L and name = 'e'$q$, t)),
    '23P01 activities_no_overlap', 'lengthening into a neighbour rejected by the exclusion constraint');
end;
$fn$;

create function tests.test_07_single_day_and_24h_trips()
returns setof text
language plpgsql
as $fn$
declare
  t_single uuid := tests.make_trip(tests.user_a(), '2026-06-10', 600, '2026-06-10', 900);
  t_full uuid := tests.make_trip(tests.user_a(), '2026-06-10', 0, '2026-06-11', 1440);
  ins text := $q$insert into public.activities (trip_id, name, duration_minutes, scheduled_date, start_minute) values (%L, 'x', %s, %L, %s)$q$;
  oor text := 'P0001 TP_OUT_OF_RANGE [outside_trip_window]';
begin
  return next is(tests.err_full(format(ins, t_single, 300, '2026-06-10', 600)), 'ok', 'single-day trip: exactly the window accepted');
  return next is(tests.err_full(format(ins, t_single, 30, '2026-06-10', 570)), oor, 'single-day trip: before start rejected');
  return next is(tests.err_full(format(ins, t_single, 30, '2026-06-10', 900)), oor, 'single-day trip: at end rejected');
  return next is(tests.err_full(format(ins, t_full, 1440, '2026-06-11', 0)), 'ok', 'trip ending 24:00: last day fully usable');
  return next is(tests.err_full(format(ins, t_full, 1440, '2026-06-10', 0)), 'ok', 'trip starting 00:00: first day fully usable');
  return next is(tests.err_full(format(ins, t_full, 30, '2026-06-12', 0)), oor, 'no "next day" after a trip ending 24:00');
end;
$fn$;

create function tests.test_08_unplace_out_of_range_activities()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a(), '2026-03-01', 540, '2026-03-05', 1080);
  v_bank1 uuid := tests.make_activity(t, 'bank-1');                       -- position 1
  v_keep uuid := tests.make_activity(t, 'keep', 60, '2026-03-03', 600);   -- position 2
  v_late uuid := tests.make_activity(t, 'late', 60, '2026-03-05', 900);   -- position 3
  v_first uuid := tests.make_activity(t, 'first', 60, '2026-03-01', 540); -- position 4
  v_day5 uuid := tests.make_activity(t, 'day5', 60, '2026-03-05', 600);   -- position 5
  v_day2 uuid := tests.make_activity(t, 'day2', 120, '2026-03-02', 1320); -- position 6
begin
  -- Renaming does not touch placements.
  update public.trips set name = 'Renamed' where id = t;
  return next is(
    (select count(*)::integer from public.activities where trip_id = t and scheduled_date is not null),
    5, 'changing only the name moves nothing');

  -- Extending moves nothing.
  update public.trips set start_date = '2026-02-28', end_minute = 1440 where id = t;
  return next is(
    (select count(*)::integer from public.activities where trip_id = t and scheduled_date is not null),
    5, 'extending the window moves nothing');

  -- Shrink: 2026-03-02 10:00 → 2026-03-04 23:00. Out: first (03-01), day5, late (03-05).
  -- day2 (03-02 22:00–24:00) and keep (03-03) stay.
  update public.trips
  set start_date = '2026-03-02', start_minute = 600, end_date = '2026-03-04', end_minute = 1380
  where id = t;

  return next is(
    (select array_agg(name order by name) from public.activities where trip_id = t and scheduled_date is not null),
    array['day2', 'keep'], 'activities inside the new window stay placed');
  return next is(
    (select array_agg(name order by bank_position) from public.activities where trip_id = t and scheduled_date is null),
    array['bank-1', 'first', 'day5', 'late'],
    'moved activities are appended to the bank in timetable order');
  return next is(
    (select array_agg(bank_position order by bank_position) from public.activities
     where trip_id = t and scheduled_date is null and name <> 'bank-1'),
    array[7, 8, 9]::double precision[], 'moved activities get max + 1, + 2, + 3');
  return next ok(
    (select bool_and(start_minute is null) from public.activities where trip_id = t and scheduled_date is null),
    'moved activities have no start minute');

  -- Shrinking the last-day end below an activity's end (day2 ends 24:00 on the new first day).
  update public.trips set end_date = '2026-03-02', end_minute = 1380 where id = t;
  return next is(
    (select array_agg(name order by name) from public.activities where trip_id = t and scheduled_date is not null),
    null::text[], 'activity ending after the new end minute is moved too');
end;
$fn$;
