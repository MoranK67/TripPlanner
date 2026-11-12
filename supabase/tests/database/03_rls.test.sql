-- M1.3 RLS: can_access_trip and the policies of PROJECT_PLAN §6.4, with two users (A, B) and anon.
-- Run with supabase/tests/run-db-tests.mjs (prepends _helpers.sql; everything is rolled back).
--
-- Pattern: act as a user, capture results into variables, tests.clear_auth(), then assert.

create function tests.test_01_can_access_trip()
returns setof text
language plpgsql
as $fn$
declare
  t_a uuid := tests.make_trip(tests.user_a());
  v_owner_viewer boolean;
  v_owner_editor boolean;
  v_owner_bad_role boolean;
  v_other boolean;
  v_missing boolean;
  v_no_user boolean;
begin
  perform tests.authenticate_as(tests.user_a());
  v_owner_viewer := private.can_access_trip(t_a, 'viewer');
  v_owner_editor := private.can_access_trip(t_a, 'editor');
  v_owner_bad_role := private.can_access_trip(t_a, 'admin');
  v_missing := private.can_access_trip('00000000-0000-4000-8000-000000000000', 'viewer');
  perform tests.clear_auth();

  perform tests.authenticate_as(tests.user_b());
  v_other := private.can_access_trip(t_a, 'viewer');
  perform tests.clear_auth();

  v_no_user := private.can_access_trip(t_a, 'viewer');  -- postgres, auth.uid() is null

  return next ok(v_owner_viewer, 'owner has viewer access');
  return next ok(v_owner_editor, 'owner has editor access');
  return next ok(not v_owner_bad_role, 'unknown role denies');
  return next ok(not v_missing, 'missing trip denies');
  return next ok(not v_other, 'another user has no access');
  return next ok(not v_no_user, 'no user (auth.uid() null) has no access');

  return next ok(not has_function_privilege('anon', 'private.can_access_trip(uuid, text)', 'EXECUTE'),
    'anon cannot execute can_access_trip');
  return next ok(not has_schema_privilege('anon', 'private', 'USAGE'), 'anon has no usage on schema private');
  return next ok(
    exists (select 1 from pg_proc where oid = 'private.can_access_trip(uuid, text)'::regprocedure and prosecdef),
    'can_access_trip is SECURITY DEFINER');
end;
$fn$;

create function tests.test_02_select_isolation()
returns setof text
language plpgsql
as $fn$
declare
  t_a uuid := tests.make_trip(tests.user_a(), p_name => 'A trip');
  t_b uuid := tests.make_trip(tests.user_b(), p_name => 'B trip');
  v_a_trips text[];
  v_a_acts text[];
  v_a_profiles uuid[];
  v_b_trips text[];
  v_b_acts text[];
  v_b_sees_a integer;
begin
  perform tests.make_activity(t_a, 'A bank');
  perform tests.make_activity(t_a, 'A placed', 60, '2026-03-02', 600);
  perform tests.make_activity(t_b, 'B bank');

  perform tests.authenticate_as(tests.user_a());
  select array_agg(name order by name) into v_a_trips from public.trips;
  select array_agg(name order by name) into v_a_acts from public.activities;
  select array_agg(id) into v_a_profiles from public.profiles;
  perform tests.clear_auth();

  perform tests.authenticate_as(tests.user_b());
  select array_agg(name order by name) into v_b_trips from public.trips;
  select array_agg(name order by name) into v_b_acts from public.activities;
  select count(*)::integer into v_b_sees_a from public.activities where trip_id = t_a;
  perform tests.clear_auth();

  return next is(v_a_trips, array['A trip'], 'A sees only own trips');
  return next is(v_a_acts, array['A bank', 'A placed'], 'A sees only own activities');
  return next is(v_a_profiles, array[tests.user_a()], 'A sees only own profile');
  return next is(v_b_trips, array['B trip'], 'B does not see A''s trips');
  return next is(v_b_acts, array['B bank'], 'B does not see A''s activities');
  return next is(v_b_sees_a, 0, 'B gets nothing when filtering by A''s trip id');
end;
$fn$;

create function tests.test_03_writes_isolation()
returns setof text
language plpgsql
as $fn$
declare
  t_a uuid := tests.make_trip(tests.user_a(), p_name => 'A trip');
  act_a uuid := tests.make_activity(t_a, 'A act', 60, '2026-03-02', 600);
  v_upd_trip integer;
  v_del_trip integer;
  v_upd_act integer;
  v_del_act integer;
  v_upd_profile integer;
  v_ins_act text;
  v_ins_trip text;
  v_ins_profile text;
  v_del_profile text;
  v_owner_change text;
begin
  perform tests.authenticate_as(tests.user_b());
  update public.trips set name = 'Hacked' where id = t_a;
  get diagnostics v_upd_trip = row_count;
  delete from public.trips where id = t_a;
  get diagnostics v_del_trip = row_count;
  update public.activities set name = 'Hacked' where id = act_a;
  get diagnostics v_upd_act = row_count;
  delete from public.activities where id = act_a;
  get diagnostics v_del_act = row_count;
  update public.profiles set display_name = 'Hacked' where id = tests.user_a();
  get diagnostics v_upd_profile = row_count;
  v_ins_act := tests.err_full(format(
    $q$insert into public.activities (trip_id, name, duration_minutes) values (%L, 'Intruder', 60)$q$, t_a));
  v_ins_trip := tests.err(format(
    $q$insert into public.trips (owner_id, name, start_date, start_minute, end_date, end_minute) values (%L, 'Fake', '2026-03-01', 0, '2026-03-02', 600)$q$,
    tests.user_a()));
  v_ins_profile := tests.err(format($q$insert into public.profiles (id) values (%L)$q$, gen_random_uuid()));
  v_del_profile := tests.err(format($q$delete from public.profiles where id = %L$q$, tests.user_b()));
  v_owner_change := tests.err(format($q$update public.trips set owner_id = %L$q$, tests.user_b()));
  perform tests.clear_auth();

  return next is(v_upd_trip, 0, 'B cannot update A''s trip');
  return next is(v_del_trip, 0, 'B cannot delete A''s trip');
  return next is(v_upd_act, 0, 'B cannot update A''s activity');
  return next is(v_del_act, 0, 'B cannot delete A''s activity');
  return next is(v_upd_profile, 0, 'B cannot update A''s profile');
  return next is(v_ins_act, 'P0002 TP_NOT_FOUND [trip]', 'B cannot add an activity to A''s trip');
  return next is(v_ins_trip, '42501 new row violates row-level security policy for table "trips"',
    'B cannot create a trip owned by A');
  return next is(v_ins_profile, '42501 permission denied for table profiles', 'profiles cannot be inserted by users');
  return next is(v_del_profile, '42501 permission denied for table profiles', 'profiles cannot be deleted by users');
  return next is(v_owner_change, '42501 permission denied for table trips', 'trips.owner_id cannot be changed');

  return next is((select name from public.trips where id = t_a), 'A trip', 'A''s trip unchanged');
  return next is((select name from public.activities where id = act_a), 'A act', 'A''s activity unchanged');
  return next is((select count(*)::integer from public.activities where trip_id = t_a), 1, 'no activity added to A''s trip');
  return next is((select color_cursor from public.trips where id = t_a), 1, 'A''s colour cursor untouched by B''s attempt');
end;
$fn$;

create function tests.test_04_owner_crud()
returns setof text
language plpgsql
as $fn$
declare
  v_trip public.trips;
  v_act public.activities;
  v_upd integer;
  v_profile_upd integer;
  v_left integer;
begin
  perform tests.authenticate_as(tests.user_a());
  -- INSERT … RETURNING, as supabase-js .insert().select() sends it (SELECT policy on new row).
  insert into public.trips (name, start_date, start_minute, end_date, end_minute)
  values ('Mine', '2026-04-01', 480, '2026-04-03', 1200)
  returning * into v_trip;
  insert into public.activities (trip_id, name, duration_minutes)
  values (v_trip.id, 'Mine', 90)
  returning * into v_act;
  update public.activities set scheduled_date = '2026-04-02', start_minute = 600 where id = v_act.id;
  get diagnostics v_upd = row_count;
  update public.profiles set display_name = 'Me' where id = tests.user_a();
  get diagnostics v_profile_upd = row_count;
  delete from public.trips where id = v_trip.id;
  select count(*)::integer into v_left from public.activities where id = v_act.id;
  perform tests.clear_auth();

  return next ok(v_trip.id is not null, 'owner can insert a trip with RETURNING');
  return next is(v_act.color, '#FFD6E0', 'owner can insert an activity with RETURNING (auto colour)');
  return next is(v_upd, 1, 'owner can place own activity by UPDATE');
  return next is(v_profile_upd, 1, 'user can update own profile');
  return next is((select display_name from public.profiles where id = tests.user_a()), 'Me', 'profile updated');
  return next is(v_left, 0, 'owner can delete own trip (activities cascade)');
end;
$fn$;

create function tests.test_05_anon_denied()
returns setof text
language plpgsql
as $fn$
declare
  t_a uuid := tests.make_trip(tests.user_a());
  v_select text;
  v_insert text;
  v_rpc text;
begin
  perform tests.authenticate_anon();
  v_select := tests.err('select count(*) from public.trips');
  v_insert := tests.err($q$insert into public.trips (name, start_date, start_minute, end_date, end_minute) values ('x', '2026-03-01', 0, '2026-03-02', 600)$q$);
  v_rpc := tests.err(format('select public.unplace_activity(%L)', gen_random_uuid()));
  perform tests.clear_auth();

  return next is(v_select, '42501 permission denied for table trips', 'anon cannot read trips');
  return next is(v_insert, '42501 permission denied for table trips', 'anon cannot insert trips');
  return next is(v_rpc, '42501 permission denied for function unplace_activity', 'anon cannot call RPCs');
end;
$fn$;

create function tests.test_06_rpcs_respect_rls()
returns setof text
language plpgsql
as $fn$
declare
  t_a uuid := tests.make_trip(tests.user_a());
  act_a uuid := tests.make_activity(t_a, 'A act');
  placed_a uuid := tests.make_activity(t_a, 'A placed', 60, '2026-03-02', 600);
  v_place text;
  v_unplace text;
  v_import text;
  v_window text;
begin
  perform tests.authenticate_as(tests.user_b());
  v_place := tests.err_full(format($q$select public.place_activity(%L, '2026-03-02', 720)$q$, act_a));
  v_unplace := tests.err_full(format('select public.unplace_activity(%L)', placed_a));
  v_import := tests.err_full(format($q$select * from public.import_activities(%L, '[{"name":"x","duration_minutes":60}]')$q$, t_a));
  v_window := tests.err_full(format($q$select public.update_trip_window(%L, '2026-03-01', 0, '2026-03-02', 600)$q$, t_a));
  perform tests.clear_auth();

  return next is(v_place, 'P0002 TP_NOT_FOUND [activity]', 'B cannot place A''s activity');
  return next is(v_unplace, 'P0002 TP_NOT_FOUND [activity]', 'B cannot unplace A''s activity');
  return next is(v_import, 'P0002 TP_NOT_FOUND [trip]', 'B cannot import into A''s trip');
  return next is(v_window, 'P0002 TP_NOT_FOUND [trip]', 'B cannot change A''s trip window');
  return next is((select scheduled_date from public.activities where id = act_a), null::date, 'A''s bank activity still in the bank');
  return next is((select start_minute::integer from public.activities where id = placed_a), 600, 'A''s placed activity unchanged');
  return next is((select end_date from public.trips where id = t_a), '2026-03-03'::date, 'A''s trip window unchanged');
end;
$fn$;
