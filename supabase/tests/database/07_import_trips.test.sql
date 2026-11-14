-- import_trips RPC (20261114120000_m6_import_trips.sql): atomic backup import (DEC-033).
-- Run with supabase/tests/run-db-tests.mjs (prepends _helpers.sql; everything is rolled back).

-- One valid trip as JSON: 2026-03-01 09:00 → 2026-03-03 18:00, cursor 7, no activities.
create function tests.trip_json(
  p_name text default 'Imported',
  p_activities jsonb default '[]'::jsonb,
  p_cursor integer default 7
)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'name', p_name, 'start_date', '2026-03-01', 'start_minute', 540,
    'end_date', '2026-03-03', 'end_minute', 1080, 'color_cursor', p_cursor,
    'activities', p_activities);
$$;

-- One valid bank activity as JSON.
create function tests.item_json(p_name text default 'Item', p_duration integer default 60)
returns jsonb
language sql
as $$
  select jsonb_build_object('name', p_name, 'duration_minutes', p_duration, 'color', '#123456',
                            'scheduled_date', null, 'start_minute', null);
$$;

-- `import_trips` as user A on the given input, as an error string ('ok' on success).
create function tests.import_err(p_input jsonb)
returns text
language plpgsql
as $$
declare
  v text;
begin
  perform tests.authenticate_as(tests.user_a());
  v := tests.err_full(format('select public.import_trips(%L::jsonb)', p_input));
  perform tests.clear_auth();
  return v;
end;
$$;

-- Same, with one field of trip 1 replaced (or removed when p_value is SQL NULL).
create function tests.trip_field_err(p_key text, p_value jsonb)
returns text
language sql
as $$
  select tests.import_err(jsonb_build_array(
    case when p_value is null then tests.trip_json() - p_key
         else tests.trip_json() || jsonb_build_object(p_key, p_value) end));
$$;

-- Same, with one field of item 2 of trip 2 replaced (or removed when p_value is SQL NULL).
create function tests.item_field_err(p_key text, p_value jsonb)
returns text
language sql
as $$
  select tests.import_err(jsonb_build_array(
    tests.trip_json('first'),
    tests.trip_json('second', jsonb_build_array(
      tests.item_json('ok'),
      case when p_value is null then tests.item_json() - p_key
           else tests.item_json() || jsonb_build_object(p_key, p_value) end))));
$$;

grant execute on all functions in schema tests to authenticated, anon;

create function tests.test_01_privileges()
returns setof text
language plpgsql
as $fn$
declare
  v_fn text := 'public.import_trips(jsonb)';
  v_anon text;
begin
  return next ok(has_function_privilege('authenticated', v_fn, 'EXECUTE'), 'authenticated can execute import_trips');
  return next ok(not has_function_privilege('anon', v_fn, 'EXECUTE'), 'anon cannot execute import_trips');
  return next ok(not has_function_privilege('public', v_fn, 'EXECUTE'), 'PUBLIC cannot execute import_trips');
  return next ok(not (select prosecdef from pg_proc where oid = v_fn::regprocedure), 'import_trips is SECURITY INVOKER');
  return next ok(
    (select proconfig @> array['search_path=""'] from pg_proc where oid = v_fn::regprocedure),
    'import_trips pins search_path');
  return next ok(not has_function_privilege('anon', 'private.json_iso_date(jsonb)', 'EXECUTE'), 'anon cannot execute json_iso_date');
  return next ok(not has_function_privilege('anon', 'private.json_uint(jsonb)', 'EXECUTE'), 'anon cannot execute json_uint');

  perform tests.authenticate_anon();
  v_anon := tests.err(format('select public.import_trips(%L::jsonb)', jsonb_build_array(tests.trip_json())));
  perform tests.clear_auth();
  return next is(v_anon, '42501 permission denied for function import_trips', 'anon call denied');
end;
$fn$;

create function tests.test_02_happy_path()
returns setof text
language plpgsql
as $fn$
declare
  v jsonb;
  t1 uuid;
  t2 uuid;
  v_input jsonb := jsonb_build_array(
    tests.trip_json('Paris', jsonb_build_array(
      jsonb_build_object('name', 'Louvre', 'duration_minutes', 120, 'color', '#ABCDEF',
                         'scheduled_date', '2026-03-02', 'start_minute', 600),
      jsonb_build_object('name', 'Bank C', 'duration_minutes', 30, 'color', '#000001'),
      jsonb_build_object('name', 'Lunch', 'duration_minutes', 60, 'color', '#000002',
                         'scheduled_date', '2026-03-02', 'start_minute', 720),  -- adjacent (half-open)
      jsonb_build_object('name', 'Bank A', 'duration_minutes', 1440, 'color', '#000003',
                         'scheduled_date', null, 'start_minute', null),
      jsonb_build_object('name', 'First slot', 'duration_minutes', 30, 'color', '#000004',
                         'scheduled_date', '2026-03-01', 'start_minute', 540),
      jsonb_build_object('name', 'Last slot', 'duration_minutes', 30, 'color', '#000005',
                         'scheduled_date', '2026-03-03', 'start_minute', 1050),
      jsonb_build_object('name', 'Bank B', 'duration_minutes', 90, 'color', '#000006',
                         'scheduled_date', null, 'start_minute', null)
    ), 23),
    tests.trip_json('Empty', '[]'::jsonb, 0)
  );
begin
  perform tests.authenticate_as(tests.user_a());
  v := public.import_trips(v_input);
  perform tests.clear_auth();

  return next is(jsonb_array_length(v -> 'trips'), 2, 'one result per trip');
  t1 := (v -> 'trips' -> 0 -> 'trip' ->> 'id')::uuid;
  t2 := (v -> 'trips' -> 1 -> 'trip' ->> 'id')::uuid;
  return next is(v -> 'trips' -> 0 -> 'trip' ->> 'name', 'Paris', 'results keep input order (1)');
  return next is(v -> 'trips' -> 1 -> 'trip' ->> 'name', 'Empty', 'results keep input order (2)');
  return next is((v -> 'trips' -> 0 ->> 'activity_count')::integer, 7, 'activity_count trip 1');
  return next is((v -> 'trips' -> 1 ->> 'activity_count')::integer, 0, 'activity_count of a trip without activities');
  return next ok(v -> 'trips' -> 0 -> 'trip' ? 'updated_at' and v -> 'trips' -> 0 -> 'trip' ? 'owner_id',
    'trip JSON has every column (snake_case)');

  return next is((select owner_id from public.trips where id = t1), tests.user_a(), 'trip owned by the caller');
  return next is((select owner_id from public.trips where id = t2), tests.user_a(), 'second trip owned by the caller');
  return next is(
    (select array[start_date::text, start_minute::text, end_date::text, end_minute::text] from public.trips where id = t1),
    array['2026-03-01', '540', '2026-03-03', '1080'], 'trip window stored');

  -- Colour cursor: the file's value % 10, not the trigger's advanced value.
  return next is((select color_cursor from public.trips where id = t1), 3, 'color_cursor = 23 % 10 after 7 inserts');
  return next is((select color_cursor from public.trips where id = t2), 0, 'color_cursor 0 kept');
  return next is((v -> 'trips' -> 0 -> 'trip' ->> 'color_cursor')::integer, 3, 'returned trip has the final cursor');

  return next is(
    (select array_agg(name order by bank_position) from public.activities where trip_id = t1 and scheduled_date is null),
    array['Bank C', 'Bank A', 'Bank B'], 'bank order = file order of the unplaced items');
  return next is(
    (select array_agg(name || '@' || scheduled_date || ' ' || start_minute order by scheduled_date, start_minute)
     from public.activities where trip_id = t1 and scheduled_date is not null),
    array['First slot@2026-03-01 540', 'Louvre@2026-03-02 600', 'Lunch@2026-03-02 720', 'Last slot@2026-03-03 1050'],
    'placed activities stored with their date and minute');
  return next is((select color from public.activities where trip_id = t1 and name = 'Louvre'), '#ABCDEF', 'explicit colour kept');
  return next is((select duration_minutes from public.activities where trip_id = t1 and name = 'Bank A'), 1440, 'duration stored');
  return next is((select count(*)::integer from public.activities where trip_id = t2), 0, 'empty trip has no activities');
end;
$fn$;

create function tests.test_03_rls()
returns setof text
language plpgsql
as $fn$
declare
  v jsonb;
  t uuid;
  b_sees integer;
  b_trips integer;
begin
  perform tests.authenticate_as(tests.user_b());
  v := public.import_trips(jsonb_build_array(tests.trip_json('B trip', jsonb_build_array(tests.item_json()))));
  perform tests.clear_auth();
  t := (v -> 'trips' -> 0 -> 'trip' ->> 'id')::uuid;

  perform tests.authenticate_as(tests.user_a());
  select count(*)::integer into b_sees from public.activities where trip_id = t;
  select count(*)::integer into b_trips from public.trips where id = t;
  perform tests.clear_auth();

  return next is((select owner_id from public.trips where id = t), tests.user_b(), 'rows owned by the caller (user B)');
  return next is(b_trips, 0, 'another user cannot see the imported trip');
  return next is(b_sees, 0, 'another user cannot see the imported activities');
end;
$fn$;

create function tests.test_04_limits()
returns setof text
language plpgsql
as $fn$
declare
  v_50 jsonb;
  v_2000 jsonb;
  v_items jsonb;
  v_51 text;
  v_2001 text;
  v_ok text;
  v_ok2 text;
  v_trips_before integer := (select count(*) from public.trips);
begin
  -- 50 trips, 40 activities each = 2000 (the maximum on both limits).
  select jsonb_agg(tests.item_json('i' || g)) into v_items from generate_series(1, 40) g;
  select jsonb_agg(tests.trip_json('t' || g)) into v_50 from generate_series(1, 50) g;
  select jsonb_agg(tests.trip_json('t' || g, v_items)) into v_2000 from generate_series(1, 50) g;

  v_ok := tests.import_err(v_50);
  v_ok2 := tests.import_err(v_2000);
  v_51 := tests.import_err(v_50 || jsonb_build_array(tests.trip_json('51')));
  v_2001 := tests.import_err(jsonb_build_array(
    tests.trip_json('a', v_items || jsonb_build_array(tests.item_json('extra'))))
    || (select jsonb_agg(tests.trip_json('t' || g, v_items)) from generate_series(2, 50) g));

  return next is(v_ok, 'ok', '50 trips accepted');
  return next is(v_ok2, 'ok', '2000 activities in total accepted');
  return next is(
    (select count(*)::integer from public.activities a join public.trips t on t.id = a.trip_id where t.owner_id = tests.user_a()),
    2000, 'all 2000 activities stored');
  return next is(v_51, 'P0001 TP_LIMIT [too_many_trips]', '51 trips rejected');
  return next is(v_2001, 'P0001 TP_LIMIT [too_many_activities]', '2001 activities rejected');
  return next is((select count(*)::integer from public.trips), v_trips_before + 100, 'rejected calls stored nothing');
  return next is(tests.import_err('[]'::jsonb), 'P0001 TP_VALIDATION [trips]', 'empty array rejected');
  return next is(tests.import_err('{"name":"x"}'::jsonb), 'P0001 TP_VALIDATION [trips]', 'non-array rejected');
  return next is(tests.import_err('null'::jsonb), 'P0001 TP_VALIDATION [trips]', 'JSON null rejected');
  return next is(tests.import_err(null), 'P0001 TP_VALIDATION [trips]', 'SQL NULL rejected');
end;
$fn$;

create function tests.test_05_trip_validation()
returns setof text
language plpgsql
as $fn$
begin
  return next is(tests.import_err(jsonb_build_array(tests.trip_json(), '"x"'::jsonb)),
    'P0001 TP_VALIDATION [trip:2]', 'trip not an object (1-based index)');
  return next is(tests.trip_field_err('activities', null), 'P0001 TP_VALIDATION [trip:1]', 'missing activities');
  return next is(tests.trip_field_err('activities', '{}'), 'P0001 TP_VALIDATION [trip:1]', 'activities not an array');

  return next is(tests.trip_field_err('name', null), 'P0001 TP_VALIDATION [trip:1:name]', 'missing name');
  return next is(tests.trip_field_err('name', '""'), 'P0001 TP_VALIDATION [trip:1:name]', 'empty name');
  return next is(tests.trip_field_err('name', '"   "'), 'P0001 TP_VALIDATION [trip:1:name]', 'blank name');
  return next is(tests.trip_field_err('name', to_jsonb(repeat('x', 51))), 'P0001 TP_VALIDATION [trip:1:name]', '51-char name');
  return next is(tests.trip_field_err('name', '5'), 'P0001 TP_VALIDATION [trip:1:name]', 'name not a string');
  return next is(tests.trip_field_err('name', to_jsonb(repeat('x', 50))), 'ok', '50-char name accepted');

  return next is(tests.trip_field_err('start_date', null), 'P0001 TP_VALIDATION [trip:1:invalid_date]', 'missing start_date');
  return next is(tests.trip_field_err('start_date', '"2026-02-30"'), 'P0001 TP_VALIDATION [trip:1:invalid_date]', 'impossible date');
  return next is(tests.trip_field_err('end_date', '"2026-3-3"'), 'P0001 TP_VALIDATION [trip:1:invalid_date]', 'malformed end_date');
  return next is(tests.trip_field_err('start_date', '"0000-01-01"'), 'P0001 TP_VALIDATION [trip:1:invalid_date]', 'year 0');
  return next is(tests.trip_field_err('start_date', '20260301'), 'P0001 TP_VALIDATION [trip:1:invalid_date]', 'date not a string');
  return next is(tests.import_err(jsonb_build_array(tests.trip_json() || '{"start_date":"2024-02-29","end_date":"2024-03-01"}')),
    'ok', 'leap day accepted');

  return next is(tests.trip_field_err('start_minute', '45'), 'P0001 TP_VALIDATION [trip:1:invalid_start_minute]', 'off-grid start');
  return next is(tests.trip_field_err('start_minute', '1440'), 'P0001 TP_VALIDATION [trip:1:invalid_start_minute]', 'start 24:00');
  return next is(tests.trip_field_err('start_minute', '-30'), 'P0001 TP_VALIDATION [trip:1:invalid_start_minute]', 'negative start');
  return next is(tests.trip_field_err('start_minute', '"540"'), 'P0001 TP_VALIDATION [trip:1:invalid_start_minute]', 'start as string');
  return next is(tests.trip_field_err('start_minute', '540.5'), 'P0001 TP_VALIDATION [trip:1:invalid_start_minute]', 'fractional start');
  return next is(tests.trip_field_err('end_minute', '0'), 'P0001 TP_VALIDATION [trip:1:invalid_end_minute]', 'end 00:00');
  return next is(tests.trip_field_err('end_minute', '1470'), 'P0001 TP_VALIDATION [trip:1:invalid_end_minute]', 'end past 24:00');
  return next is(tests.trip_field_err('end_minute', null), 'P0001 TP_VALIDATION [trip:1:invalid_end_minute]', 'missing end');
  return next is(tests.import_err(jsonb_build_array(tests.trip_json() || '{"end_date":"2026-03-01","end_minute":540}')),
    'P0001 TP_VALIDATION [trip:1:end_not_after_start]', 'end equal to start');
  return next is(tests.trip_field_err('end_date', '"2026-02-28"'),
    'P0001 TP_VALIDATION [trip:1:end_not_after_start]', 'end before start');
  return next is(tests.trip_field_err('end_date', '"2026-05-30"'), 'P0001 TP_VALIDATION [trip:1:too_long]', '91 days');
  return next is(tests.trip_field_err('end_date', '"2026-05-29"'), 'ok', '90 days accepted');

  return next is(tests.trip_field_err('color_cursor', null), 'P0001 TP_VALIDATION [trip:1:color_cursor]', 'missing cursor');
  return next is(tests.trip_field_err('color_cursor', '-1'), 'P0001 TP_VALIDATION [trip:1:color_cursor]', 'negative cursor');
  return next is(tests.trip_field_err('color_cursor', '1.5'), 'P0001 TP_VALIDATION [trip:1:color_cursor]', 'fractional cursor');

  return next is((select count(*)::integer from public.trips where owner_id = tests.user_a()), 3,
    'only the three accepted calls stored trips');
end;
$fn$;

create function tests.test_06_item_validation()
returns setof text
language plpgsql
as $fn$
declare
  v_before integer := (select count(*) from public.trips);
begin
  return next is(tests.import_err(jsonb_build_array(tests.trip_json('a', '[1]'))),
    'P0001 TP_VALIDATION [trip:1:item:1]', 'item not an object');
  return next is(tests.item_field_err('name', null), 'P0001 TP_VALIDATION [trip:2:item:2:name]', 'missing name (1-based trip and item)');
  return next is(tests.item_field_err('name', '""'), 'P0001 TP_VALIDATION [trip:2:item:2:name]', 'empty name');
  return next is(tests.item_field_err('name', '" "'), 'P0001 TP_VALIDATION [trip:2:item:2:name]', 'blank name');
  return next is(tests.item_field_err('name', to_jsonb(repeat('x', 61))), 'P0001 TP_VALIDATION [trip:2:item:2:name]', '61-char name');
  return next is(tests.item_field_err('duration_minutes', '45'), 'P0001 TP_VALIDATION [trip:2:item:2:duration_minutes]', 'off-grid duration');
  return next is(tests.item_field_err('duration_minutes', '0'), 'P0001 TP_VALIDATION [trip:2:item:2:duration_minutes]', 'zero duration');
  return next is(tests.item_field_err('duration_minutes', '1470'), 'P0001 TP_VALIDATION [trip:2:item:2:duration_minutes]', 'over 24 h');
  return next is(tests.item_field_err('duration_minutes', '"60"'), 'P0001 TP_VALIDATION [trip:2:item:2:duration_minutes]', 'duration as string');
  return next is(tests.item_field_err('color', null), 'P0001 TP_VALIDATION [trip:2:item:2:color]', 'missing colour');
  return next is(tests.item_field_err('color', '"blue"'), 'P0001 TP_VALIDATION [trip:2:item:2:color]', 'bad colour');
  return next is(tests.item_field_err('color', '"#1234567"'), 'P0001 TP_VALIDATION [trip:2:item:2:color]', 'colour too long');
  return next is(tests.item_field_err('scheduled_date', '"2026-13-01"'), 'P0001 TP_VALIDATION [trip:2:item:2:scheduled_date]', 'bad date');
  return next is(tests.item_field_err('start_minute', '15'), 'P0001 TP_VALIDATION [trip:2:item:2:start_minute]', 'off-grid start');
  return next is(tests.item_field_err('start_minute', '1440'), 'P0001 TP_VALIDATION [trip:2:item:2:start_minute]', 'start 24:00');
  return next is(tests.item_field_err('scheduled_date', '"2026-03-02"'),
    'P0001 TP_VALIDATION [trip:2:item:2:start_minute]', 'date without start_minute');
  return next is(tests.item_field_err('start_minute', '600'),
    'P0001 TP_VALIDATION [trip:2:item:2:scheduled_date]', 'start_minute without date');
  return next is(tests.item_field_err('scheduled_date', null), 'ok', 'omitted placement keys = bank');
  return next is((select count(*)::integer from public.trips), v_before + 2, 'failed calls stored nothing (trip 1 rolled back too)');
end;
$fn$;

-- Placement errors come from the trigger / exclusion constraint during the writes, after
-- earlier trips have already been inserted: the whole call must roll back.
create function tests.test_07_placement_errors_roll_back()
returns setof text
language plpgsql
as $fn$
declare
  v_before_trips integer := (select count(*) from public.trips);
  v_before_acts integer := (select count(*) from public.activities);
  v_out text;
  v_out_midnight text;
  v_overlap text;
  v_hint text;
begin
  v_out := tests.import_err(jsonb_build_array(
    tests.trip_json('good', jsonb_build_array(tests.item_json())),
    tests.trip_json('bad', jsonb_build_array(
      tests.item_json('fine'),
      tests.item_json('early', 60) || '{"scheduled_date":"2026-03-01","start_minute":480}'))));  -- 08:00 < 09:00
  v_out_midnight := tests.import_err(jsonb_build_array(
    tests.trip_json('bad', jsonb_build_array(
      tests.item_json('late', 120) || '{"scheduled_date":"2026-03-02","start_minute":1380}'))));
  v_overlap := tests.import_err(jsonb_build_array(
    tests.trip_json('good', jsonb_build_array(tests.item_json())),
    tests.trip_json('bad', jsonb_build_array(
      tests.item_json('a', 120) || '{"scheduled_date":"2026-03-02","start_minute":600}',
      tests.item_json('b', 60) || '{"scheduled_date":"2026-03-02","start_minute":660}'))));

  perform tests.authenticate_as(tests.user_a());
  begin
    perform public.import_trips(jsonb_build_array(
      tests.trip_json('bad', jsonb_build_array(
        tests.item_json('a', 120) || '{"scheduled_date":"2026-03-02","start_minute":600}',
        tests.item_json('b', 60) || '{"scheduled_date":"2026-03-02","start_minute":660}'))));
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  perform tests.clear_auth();

  return next is(v_out, 'P0001 TP_OUT_OF_RANGE [outside_trip_window]', 'placement before the trip start → TP_OUT_OF_RANGE');
  return next is(v_out_midnight, 'P0001 TP_OUT_OF_RANGE [outside_trip_window]', 'placement across midnight → TP_OUT_OF_RANGE');
  return next is(v_overlap, '23P01 TP_OVERLAP [overlap]', 'overlapping placements → TP_OVERLAP');
  return next ok(v_hint like 'trip:1:item:2%', 'overlap hint names the trip and item');
  return next is((select count(*)::integer from public.trips), v_before_trips, 'no trips stored (earlier trips rolled back)');
  return next is((select count(*)::integer from public.activities), v_before_acts, 'no activities stored');
end;
$fn$;

-- Existing trips are untouched (add-only), and importing next to them works.
create function tests.test_08_add_only()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a(), p_name => 'Imported');
  a uuid := tests.make_activity(t, 'existing', 60, '2026-03-02', 600);
  v jsonb;
begin
  perform tests.authenticate_as(tests.user_a());
  v := public.import_trips(jsonb_build_array(
    tests.trip_json('Imported', jsonb_build_array(tests.item_json('x') || '{"scheduled_date":"2026-03-02","start_minute":600}'))));
  perform tests.clear_auth();

  return next ok((v -> 'trips' -> 0 -> 'trip' ->> 'id')::uuid <> t, 'a new trip is created even with the same name');
  return next is((select count(*)::integer from public.trips where name = 'Imported'), 2, 'existing trip kept');
  return next is((select start_minute::integer from public.activities where id = a), 600, 'existing activity untouched');
  return next is((select color_cursor from public.trips where id = t), 1, 'existing trip cursor untouched');
end;
$fn$;

-- Keys the RPC does not read are ignored: no way to set ids, ownership, timestamps, timezone or
-- bank_position through the file.
create function tests.test_09_extra_keys_ignored()
returns setof text
language plpgsql
as $fn$
declare
  other uuid := tests.make_trip(tests.user_b(), p_name => 'B trip');
  v_fake_id uuid := '11111111-1111-4111-8111-111111111111';
  v jsonb;
  t uuid;
begin
  perform tests.authenticate_as(tests.user_a());
  v := public.import_trips(jsonb_build_array(
    tests.trip_json('Sneaky', jsonb_build_array(
      tests.item_json('b1') || jsonb_build_object(
        'id', v_fake_id, 'trip_id', other, 'bank_position', 99.5, 'color_cursor', 4,
        'created_at', '2000-01-01T00:00:00Z'),
      tests.item_json('b2') || '{"bank_position": -7}'
    ), 7) || jsonb_build_object(
      'id', v_fake_id, 'owner_id', tests.user_b(), 'timezone', 'Europe/Paris',
      'created_at', '2000-01-01T00:00:00Z', 'updated_at', '2000-01-01T00:00:00Z')));
  perform tests.clear_auth();
  t := (v -> 'trips' -> 0 -> 'trip' ->> 'id')::uuid;

  return next ok(t <> v_fake_id, 'trip id is new, not the file''s');
  return next is((select owner_id from public.trips where id = t), tests.user_a(), 'owner is the caller, not owner_id from the file');
  return next ok((select timezone is null from public.trips where id = t), 'timezone not taken from the file');
  return next ok((select created_at > '2001-01-01' from public.trips where id = t), 'trip created_at not taken from the file');
  return next is((select color_cursor from public.trips where id = t), 7, 'trip cursor from color_cursor only');
  return next is((select count(*)::integer from public.activities where id = v_fake_id), 0, 'activity id is new');
  return next is((select count(*)::integer from public.activities where trip_id = other), 0, 'trip_id in the file ignored (other user''s trip untouched)');
  return next is((select count(*)::integer from public.activities where trip_id = t), 2, 'activities stored in the new trip');
  return next is(
    (select array_agg(bank_position order by name) from public.activities where trip_id = t),
    array[1, 2]::double precision[], 'bank_position = index, not the file''s');
  return next ok((select bool_and(created_at > '2001-01-01') from public.activities where trip_id = t), 'activity created_at not taken from the file');
end;
$fn$;

create function tests.test_10_edges()
returns setof text
language plpgsql
as $fn$
declare
  v jsonb;
  t uuid;
  v_hint text;
  v_empty_date text;
begin
  perform tests.authenticate_as(tests.user_a());
  v := public.import_trips(jsonb_build_array(
    tests.trip_json('Edges', jsonb_build_array(
      tests.item_json('all day', 1440) || '{"scheduled_date":"2026-03-02","start_minute":0}',
      tests.item_json('exp') || '{"duration_minutes": 1e2}'::jsonb || '{"duration_minutes": 1.2e2}'::jsonb
    ), 999999999)));
  begin
    perform public.import_trips(jsonb_build_array(
      tests.trip_json('ok'),
      tests.trip_json('bad', jsonb_build_array(
        tests.item_json('fine'),
        tests.item_json('early') || '{"scheduled_date":"2026-03-01","start_minute":480}'))));
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  perform tests.clear_auth();
  t := (v -> 'trips' -> 0 -> 'trip' ->> 'id')::uuid;
  v_empty_date := tests.item_field_err('scheduled_date', '""');

  return next is(
    (select scheduled_date::text || ' ' || start_minute || ' ' || duration_minutes from public.activities where trip_id = t and name = 'all day'),
    '2026-03-02 0 1440', 'placed 1440-minute activity at minute 0 on a middle day');
  return next is((select color_cursor from public.trips where id = t), 9, 'color_cursor 999999999 stored as % 10');
  return next is((select duration_minutes from public.activities where trip_id = t and name = 'exp'), 120,
    'exponent number (1.2e2) accepted as 120');
  return next is(tests.import_err(jsonb_build_array(tests.trip_json('e', jsonb_build_array(
    tests.item_json() || '{"duration_minutes": 1e2}'::jsonb)))), 'P0001 TP_VALIDATION [trip:1:item:1:duration_minutes]',
    '1e2 = 100 is parsed as a number (then rejected: not a multiple of 30)');
  return next ok(v_hint like 'trip:2:item:2%', 'TP_OUT_OF_RANGE hint starts with trip:<n>:item:<m>');
  return next is(v_empty_date, 'P0001 TP_VALIDATION [trip:2:item:2:scheduled_date]', 'empty-string date rejected');
end;
$fn$;
