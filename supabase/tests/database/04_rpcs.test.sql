-- M1.4 RPCs: place_activity, unplace_activity, import_activities, update_trip_window and the
-- TP_* error contract. Calls are made as user A (role authenticated), like the app does.
-- Run with supabase/tests/run-db-tests.mjs (prepends _helpers.sql; everything is rolled back).

create function tests.test_01_rpc_privileges()
returns setof text
language plpgsql
as $fn$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.place_activity(uuid, date, integer)',
    'public.unplace_activity(uuid)',
    'public.import_activities(uuid, jsonb)',
    'public.update_trip_window(uuid, date, integer, date, integer, text)'
  ] loop
    return next ok(has_function_privilege('authenticated', v_fn, 'EXECUTE'), 'authenticated can execute ' || v_fn);
    return next ok(not has_function_privilege('anon', v_fn, 'EXECUTE'), 'anon cannot execute ' || v_fn);
    return next ok(
      not (select prosecdef from pg_proc where oid = v_fn::regprocedure),
      v_fn || ' is SECURITY INVOKER');
  end loop;
end;
$fn$;

-- Trip: 2026-03-01 09:00 → 2026-03-03 18:00.
create function tests.test_02_place_activity()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a(), '2026-03-01', 540, '2026-03-03', 1080);
  museum uuid := tests.make_activity(t, 'Museum', 120);
  lunch uuid := tests.make_activity(t, 'Lunch', 60);
  full_day uuid := tests.make_activity(t, 'Full day', 1440);
  v_row public.activities;
  v_moved public.activities;
  v_adjacent text;
  v_overlap text;
  v_same_slot_move text;
  v_out_before text;
  v_out_after_end text;
  v_midnight text;
  v_full_day_first text;
  v_full_day_middle text;
  v_bad_minute text;
  v_neg_minute text;
  v_null_date text;
  v_null_id text;
  v_missing text;
begin
  perform tests.authenticate_as(tests.user_a());
  v_row := public.place_activity(museum, '2026-03-02', 600);                   -- 10:00–12:00
  v_adjacent := tests.err_full(format($q$select public.place_activity(%L, '2026-03-02', 720)$q$, lunch));  -- 12:00
  v_overlap := tests.err_full(format($q$select public.place_activity(%L, '2026-03-02', 660)$q$, lunch));
  -- Moving onto a range overlapping its own old position is fine.
  v_same_slot_move := tests.err_full(format($q$select public.place_activity(%L, '2026-03-02', 570)$q$, museum));
  v_out_before := tests.err_full(format($q$select public.place_activity(%L, '2026-03-01', 510)$q$, lunch));
  v_out_after_end := tests.err_full(format($q$select public.place_activity(%L, '2026-03-03', 1050)$q$, lunch));
  v_midnight := tests.err_full(format($q$select public.place_activity(%L, '2026-03-02', 1410)$q$, lunch));
  v_full_day_first := tests.err_full(format($q$select public.place_activity(%L, '2026-03-01', 0)$q$, full_day));
  v_bad_minute := tests.err_full(format($q$select public.place_activity(%L, '2026-03-02', 615)$q$, lunch));
  v_neg_minute := tests.err_full(format($q$select public.place_activity(%L, '2026-03-02', -30)$q$, lunch));
  v_null_date := tests.err_full(format($q$select public.place_activity(%L, null, 600)$q$, lunch));
  v_null_id := tests.err_full($q$select public.place_activity(null, '2026-03-02', 600)$q$);
  v_missing := tests.err_full($q$select public.place_activity('00000000-0000-4000-8000-000000000000', '2026-03-02', 600)$q$);
  perform tests.clear_auth();

  return next is(v_row.id, museum, 'place_activity returns the activity row');
  return next is(v_row.scheduled_date, '2026-03-02'::date, 'scheduled_date set');
  return next is(v_row.start_minute::integer, 600, 'start_minute set');
  return next is(v_adjacent, 'ok', 'adjacent placement (starts at the other''s end) allowed');
  return next is(v_overlap, '23P01 TP_OVERLAP [overlap]', 'overlap raises TP_OVERLAP (SQLSTATE 23P01)');
  return next is(v_same_slot_move, 'ok', 'moving within its own old range allowed');
  return next is(v_out_before, 'P0001 TP_OUT_OF_RANGE [outside_trip_window]', 'before trip start raises TP_OUT_OF_RANGE');
  return next is(v_out_after_end, 'P0001 TP_OUT_OF_RANGE [outside_trip_window]', 'past trip end raises TP_OUT_OF_RANGE');
  return next is(v_midnight, 'P0001 TP_OUT_OF_RANGE [outside_trip_window]', 'crossing midnight raises TP_OUT_OF_RANGE');
  return next is(v_full_day_first, 'P0001 TP_OUT_OF_RANGE [outside_trip_window]', '24 h activity on a partial day raises TP_OUT_OF_RANGE');
  return next is(v_bad_minute, 'P0001 TP_VALIDATION [start_minute]', 'off-grid minute raises TP_VALIDATION');
  return next is(v_neg_minute, 'P0001 TP_VALIDATION [start_minute]', 'negative minute raises TP_VALIDATION');
  return next is(v_null_date, 'P0001 TP_VALIDATION [scheduled_date]', 'missing date raises TP_VALIDATION');
  return next is(v_null_id, 'P0001 TP_VALIDATION [activity_id]', 'missing id raises TP_VALIDATION');
  return next is(v_missing, 'P0001 TP_NOT_FOUND [activity]', 'unknown activity raises TP_NOT_FOUND');
  return next is((select start_minute::integer from public.activities where id = museum), 570, 'museum moved to 09:30');
  return next is((select start_minute::integer from public.activities where id = lunch), 720, 'lunch stayed at its first valid slot');

  -- 24 h activity on a full middle day: needs the day empty.
  update public.activities set scheduled_date = null, start_minute = null where trip_id = t;
  perform tests.authenticate_as(tests.user_a());
  v_full_day_middle := tests.err_full(format($q$select public.place_activity(%L, '2026-03-02', 0)$q$, full_day));
  perform tests.clear_auth();
  return next is(v_full_day_middle, 'ok', '24 h activity placeable on a full day at 00:00');
end;
$fn$;

create function tests.test_03_unplace_activity()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a());
  b1 uuid := tests.make_activity(t, 'bank');                          -- position 1
  p1 uuid := tests.make_activity(t, 'placed', 60, '2026-03-02', 600);  -- position 2
  v_row public.activities;
  v_again public.activities;
  v_bank public.activities;
  v_null text;
begin
  perform tests.authenticate_as(tests.user_a());
  v_row := public.unplace_activity(p1);
  v_again := public.unplace_activity(p1);
  v_bank := public.unplace_activity(b1);
  v_null := tests.err_full('select public.unplace_activity(null)');
  perform tests.clear_auth();

  return next ok(v_row.scheduled_date is null and v_row.start_minute is null, 'placement cleared');
  return next is(v_row.bank_position, 3::double precision, 'bank_position = max + 1');
  return next is(v_again.bank_position, 3::double precision, 'unplacing a bank activity is a no-op');
  return next is(v_bank.bank_position, 1::double precision, 'bank activity keeps its position');
  return next is(v_null, 'P0001 TP_VALIDATION [activity_id]', 'missing id raises TP_VALIDATION');
end;
$fn$;

create function tests.test_04_import_activities()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a());
  v_rows public.activities[];
  v_empty integer;
  v_200 integer;
  v_201 text;
  v_not_array text;
  v_bad_name text;
  v_long_name text;
  v_bad_duration text;
  v_string_duration text;
  v_fraction text;
  v_bad_color text;
  v_not_object text;
  v_null_trip text;
begin
  perform tests.make_activity(t, 'existing');   -- cursor 1, bank_position 1

  perform tests.authenticate_as(tests.user_a());
  select array_agg(r order by r.bank_position) into v_rows
  from public.import_activities(t, '[
    {"name": "Louvre", "duration_minutes": 180},
    {"name": "קפה", "duration_minutes": 30, "color": "#123456"},
    {"name": "Seine walk", "duration_minutes": 90, "color": null}
  ]') r;
  select count(*)::integer into v_empty from public.import_activities(t, '[]');
  select count(*)::integer into v_200 from public.import_activities(t,
    (select jsonb_agg(jsonb_build_object('name', 'n' || g, 'duration_minutes', 30)) from generate_series(1, 200) g));
  v_201 := tests.err_full(format('select public.import_activities(%L, %L)', t,
    (select jsonb_agg(jsonb_build_object('name', 'n' || g, 'duration_minutes', 30)) from generate_series(1, 201) g)));
  v_not_array := tests.err_full(format($q$select public.import_activities(%L, '{"name":"x"}')$q$, t));
  v_bad_name := tests.err_full(format($q$select public.import_activities(%L, '[{"name":"ok","duration_minutes":60},{"name":"","duration_minutes":60}]')$q$, t));
  v_long_name := tests.err_full(format('select public.import_activities(%L, %L)', t,
    jsonb_build_array(jsonb_build_object('name', repeat('x', 61), 'duration_minutes', 60))));
  v_bad_duration := tests.err_full(format($q$select public.import_activities(%L, '[{"name":"x","duration_minutes":45}]')$q$, t));
  v_string_duration := tests.err_full(format($q$select public.import_activities(%L, '[{"name":"x","duration_minutes":"60"}]')$q$, t));
  v_fraction := tests.err_full(format($q$select public.import_activities(%L, '[{"name":"x","duration_minutes":60.5}]')$q$, t));
  v_bad_color := tests.err_full(format($q$select public.import_activities(%L, '[{"name":"x","duration_minutes":60},{"name":"y","duration_minutes":60},{"name":"z","duration_minutes":60,"color":"blue"}]')$q$, t));
  v_not_object := tests.err_full(format($q$select public.import_activities(%L, '["x"]')$q$, t));
  v_null_trip := tests.err_full($q$select public.import_activities(null, '[]')$q$);
  perform tests.clear_auth();

  return next is(array_length(v_rows, 1), 3, 'three activities imported');
  return next is(
    array[(v_rows[1]).name, (v_rows[2]).name, (v_rows[3]).name], array['Louvre', 'קפה', 'Seine walk'],
    'returned in input order');
  return next is(
    array[(v_rows[1]).bank_position, (v_rows[2]).bank_position, (v_rows[3]).bank_position],
    array[2, 3, 4]::double precision[], 'appended to the bank after existing activities');
  return next is(
    array[(v_rows[1]).color, (v_rows[2]).color, (v_rows[3]).color], array['#FFE3C2', '#123456', '#D6F2C9'],
    'colours continue from the cursor; explicit colour kept; null colour auto-assigned');
  return next ok(
    (select bool_and(scheduled_date is null) from unnest(v_rows) r), 'imported activities are in the bank');
  return next is(v_empty, 0, 'empty array imports nothing');
  return next is(v_200, 200, '200 items accepted');
  return next is(v_201, 'P0001 TP_LIMIT [too_many_items]', '201 items raise TP_LIMIT');
  return next is(v_not_array, 'P0001 TP_VALIDATION [items]', 'non-array raises TP_VALIDATION');
  return next is(v_bad_name, 'P0001 TP_VALIDATION [item:2:name]', 'empty name reports the item index');
  return next is(v_long_name, 'P0001 TP_VALIDATION [item:1:name]', '61-char name rejected');
  return next is(v_bad_duration, 'P0001 TP_VALIDATION [item:1:duration_minutes]', 'off-grid duration rejected');
  return next is(v_string_duration, 'P0001 TP_VALIDATION [item:1:duration_minutes]', 'string duration rejected');
  return next is(v_fraction, 'P0001 TP_VALIDATION [item:1:duration_minutes]', 'fractional duration rejected');
  return next is(v_bad_color, 'P0001 TP_VALIDATION [item:3:color]', 'bad colour reports the item index');
  return next is(v_not_object, 'P0001 TP_VALIDATION [item:1]', 'non-object item reports item:<n>');
  return next is(v_null_trip, 'P0001 TP_VALIDATION [trip_id]', 'missing trip id raises TP_VALIDATION');
  return next is((select count(*)::integer from public.activities where trip_id = t), 204,
    'failed imports inserted nothing (1 + 3 + 200)');
  return next is((select color_cursor from public.trips where id = t), 204 % 10,
    'cursor advanced once per imported activity');
end;
$fn$;

create function tests.test_05_update_trip_window()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a(), '2026-03-01', 540, '2026-03-05', 1080, 'Paris');
  v_result jsonb;
  v_extend jsonb;
  v_rename_only jsonb;
  v_end_before text;
  v_equal text;
  v_too_long text;
  v_bad_start text;
  v_bad_end text;
  v_bad_name text;
  v_null_date text;
  v_missing text;
  ins text := 'P0001 TP_VALIDATION [%s]';
begin
  perform tests.make_activity(t, 'stay', 60, '2026-03-03', 600);
  perform tests.make_activity(t, 'early', 60, '2026-03-01', 540);
  perform tests.make_activity(t, 'late', 60, '2026-03-05', 960);
  perform tests.make_activity(t, 'bank');

  perform tests.authenticate_as(tests.user_a());
  v_extend := public.update_trip_window(t, '2026-02-27', 0, '2026-03-06', 1440);
  v_result := public.update_trip_window(t, '2026-03-02', 480, '2026-03-04', 1200, 'Paris 2');
  v_rename_only := public.update_trip_window(t, '2026-03-02', 480, '2026-03-04', 1200, null);
  v_end_before := tests.err_full(format($q$select public.update_trip_window(%L, '2026-03-02', 600, '2026-03-01', 600)$q$, t));
  v_equal := tests.err_full(format($q$select public.update_trip_window(%L, '2026-03-02', 600, '2026-03-02', 600)$q$, t));
  v_too_long := tests.err_full(format($q$select public.update_trip_window(%L, '2026-01-01', 0, '2026-04-01', 30)$q$, t));
  v_bad_start := tests.err_full(format($q$select public.update_trip_window(%L, '2026-03-01', 1440, '2026-03-02', 600)$q$, t));
  v_bad_end := tests.err_full(format($q$select public.update_trip_window(%L, '2026-03-01', 0, '2026-03-02', 0)$q$, t));
  v_bad_name := tests.err_full(format($q$select public.update_trip_window(%L, '2026-03-01', 0, '2026-03-02', 600, '')$q$, t));
  v_null_date := tests.err_full(format($q$select public.update_trip_window(%L, null, 0, '2026-03-02', 600)$q$, t));
  v_missing := tests.err_full($q$select public.update_trip_window('00000000-0000-4000-8000-000000000000', '2026-03-01', 0, '2026-03-02', 600)$q$);
  perform tests.clear_auth();

  return next is((v_extend ->> 'moved_count')::integer, 0, 'extending moves nothing');
  return next is((v_result ->> 'moved_count')::integer, 2, 'moved_count reports activities sent to the bank');
  return next is(v_result -> 'trip' ->> 'name', 'Paris 2', 'returned trip has the new name');
  return next is(v_result -> 'trip' ->> 'start_date', '2026-03-02', 'returned trip has the new start date');
  return next is((v_result -> 'trip' ->> 'end_minute')::integer, 1200, 'returned trip has the new end minute');
  return next is((v_result -> 'trip' ->> 'id')::uuid, t, 'returned trip id');
  return next ok(v_result -> 'trip' ? 'color_cursor', 'returned trip has every column (snake_case)');
  return next is(v_rename_only -> 'trip' ->> 'name', 'Paris 2', 'name null keeps the name');
  return next is((v_rename_only ->> 'moved_count')::integer, 0, 'unchanged window moves nothing');
  return next is(
    (select array_agg(name order by bank_position) from public.activities where trip_id = t and scheduled_date is null),
    array['bank', 'early', 'late'], 'early and late moved to the bank');
  return next is(v_end_before, format(ins, 'end_not_after_start'), 'end date before start rejected');
  return next is(v_equal, format(ins, 'end_not_after_start'), 'end equal to start rejected');
  return next is(v_too_long, format(ins, 'too_long'), 'more than 90 days rejected');
  return next is(v_bad_start, format(ins, 'invalid_start_minute'), 'start minute 1440 rejected');
  return next is(v_bad_end, format(ins, 'invalid_end_minute'), 'end minute 0 rejected');
  return next is(v_bad_name, format(ins, 'name'), 'empty name rejected');
  return next is(v_null_date, format(ins, 'invalid_date'), 'missing date rejected');
  return next is(v_missing, 'P0001 TP_NOT_FOUND [trip]', 'unknown trip raises TP_NOT_FOUND');
end;
$fn$;
