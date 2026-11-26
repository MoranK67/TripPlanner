-- FEAT-3 import_activities with placement (20261126120000_feat3_import_placement.sql):
-- result shape, backward compatibility, every bank_reason, ordering between rows, a mix of
-- placed and banked items, colours/cursor, atomicity, privileges and RLS.
-- Run with supabase/tests/run-db-tests.mjs (prepends _helpers.sql; rolled back).
--
-- Default trip (tests.make_trip): 2026-03-01 09:00 -> 2026-03-03 18:00.
-- Palette (private.palette()): 0 #FFD6E0, 1 #FFE3C2, 2 #FFF1B5, 3 #D6F2C9, 4 #C8EBE3, 5 #CDE5FF.

-- Import as the current role; the result rows as a JSON array in input order (the JSON is what
-- PostgREST sends to the app).
create function tests.imp(p_trip uuid, p_items jsonb)
returns jsonb
language sql
as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.item_index), '[]'::jsonb)
  from public.import_activities(p_trip, p_items) r;
$$;

-- Outcome per row: 'placed', 'bank' (no placement requested) or the bank_reason.
create function tests.outcomes(p_result jsonb)
returns text[]
language sql
as $$
  select coalesce(array_agg(
    case
      when (e.value ->> 'placed')::boolean then 'placed'
      else coalesce(e.value ->> 'bank_reason', 'bank')
    end order by e.ordinality), array[]::text[])
  from jsonb_array_elements(p_result) with ordinality as e(value, ordinality);
$$;

-- One item. p_date / p_start are raw JSON so malformed values can be sent; NULL = key absent.
create function tests.item(p_name text, p_duration integer, p_date jsonb default null,
                           p_start jsonb default null)
returns jsonb
language sql
as $$
  select jsonb_strip_nulls(jsonb_build_object('name', p_name, 'duration_minutes', p_duration))
    || case when p_date is null then '{}'::jsonb else jsonb_build_object('scheduled_date', p_date) end
    || case when p_start is null then '{}'::jsonb else jsonb_build_object('start_minute', p_start) end;
$$;

create function tests.cursor_of(p_trip uuid) returns integer language sql
as $$ select color_cursor from public.trips where id = p_trip $$;

grant execute on all functions in schema tests to authenticated, anon;

create function tests.test_01_signature_privileges()
returns setof text
language plpgsql
as $fn$
declare
  v_fn text;
begin
  foreach v_fn in array array['public.import_activities(uuid, jsonb)',
                              'private.import_activity_items(uuid, jsonb)'] loop
    return next ok(has_function_privilege('authenticated', v_fn, 'EXECUTE'), 'authenticated can execute ' || v_fn);
    return next ok(not has_function_privilege('anon', v_fn, 'EXECUTE'), 'anon cannot execute ' || v_fn);
    return next ok(not (select prosecdef from pg_proc where oid = v_fn::regprocedure), v_fn || ' is SECURITY INVOKER');
    return next ok((select proconfig @> array['search_path=""'] from pg_proc where oid = v_fn::regprocedure),
      v_fn || ' pins search_path');
  end loop;
  return next is(
    (select count(*)::integer from pg_proc where proname = 'import_activities'
       and pronamespace = 'public'::regnamespace),
    1, 'exactly one public.import_activities (no overload)');
  return next is(
    pg_get_function_result('public.import_activities(uuid, jsonb)'::regprocedure),
    'TABLE(id uuid, trip_id uuid, name text, duration_minutes integer, color text, scheduled_date date, '
      || 'start_minute smallint, bank_position double precision, created_at timestamp with time zone, '
      || 'updated_at timestamp with time zone, tag text, item_index integer, placed boolean, '
      || 'bank_reason text, conflict_activity_id uuid, conflict_item integer)',
    'result = activity columns + outcome columns');
end;
$fn$;

-- Old callers: no placement fields -> exactly the old behaviour, plus outcome fields.
create function tests.test_02_backward_compatible()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a());
  v jsonb;
  v_nulls jsonb;
  v_keys text[];
begin
  perform tests.make_activity(t, 'existing');   -- cursor 1, bank_position 1

  perform tests.authenticate_as(tests.user_a());
  v := tests.imp(t, '[
    {"name": "Louvre", "duration_minutes": 180},
    {"name": "Cafe", "duration_minutes": 30, "color": "#123456"},
    {"name": "Seine walk", "duration_minutes": 90, "color": null, "tag": "Day 1"}
  ]');
  v_nulls := tests.imp(t, '[{"name": "nulls", "duration_minutes": 60, "scheduled_date": null, "start_minute": null}]');
  perform tests.clear_auth();

  select array_agg(k order by k) into v_keys from jsonb_object_keys(v -> 0) k;
  return next is(v_keys,
    array['bank_position', 'bank_reason', 'color', 'conflict_activity_id', 'conflict_item', 'created_at',
          'duration_minutes', 'id', 'item_index', 'name', 'placed', 'scheduled_date', 'start_minute',
          'tag', 'trip_id', 'updated_at'],
    'JSON row = the 11 old activity fields + 5 outcome fields');
  return next is(jsonb_array_length(v), 3, 'three rows');
  return next is(array[v -> 0 ->> 'name', v -> 1 ->> 'name', v -> 2 ->> 'name'],
    array['Louvre', 'Cafe', 'Seine walk'], 'rows in input order');
  return next is(array[v -> 0 ->> 'item_index', v -> 1 ->> 'item_index', v -> 2 ->> 'item_index'],
    array['1', '2', '3'], 'item_index is 1-based');
  return next is(array[(v -> 0 ->> 'bank_position')::numeric, (v -> 1 ->> 'bank_position')::numeric,
                       (v -> 2 ->> 'bank_position')::numeric], array[2, 3, 4]::numeric[],
    'appended to the bank after existing activities');
  return next is(array[v -> 0 ->> 'color', v -> 1 ->> 'color', v -> 2 ->> 'color'],
    array['#FFE3C2', '#123456', '#D6F2C9'], 'colours exactly as before');
  return next is(tests.outcomes(v), array['bank', 'bank', 'bank'], 'all in the bank, no reason');
  return next ok((select bool_and(e -> 'scheduled_date' = 'null'::jsonb and e -> 'start_minute' = 'null'::jsonb
                              and e -> 'conflict_activity_id' = 'null'::jsonb and e -> 'conflict_item' = 'null'::jsonb
                              and e -> 'placed' = 'false'::jsonb)
                  from jsonb_array_elements(v) e),
    'placement and conflict fields null, placed false');
  return next is(v -> 2 ->> 'tag', 'Day 1', 'tag returned');
  return next is((select count(*)::integer from public.activities a
                  where a.trip_id = t and a.id in (select (e ->> 'id')::uuid from jsonb_array_elements(v) e)
                    and a.scheduled_date is null), 3, 'returned ids are the stored bank rows');
  return next is(tests.outcomes(v_nulls), array['bank'], 'JSON null placement fields = not given');
  return next is(tests.cursor_of(t), 5, 'cursor advanced once per imported activity');
end;
$fn$;

-- A valid placement is stored on the timetable; edges of the trip window are allowed.
create function tests.test_03_placed()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a());
  v jsonb;
begin
  perform tests.authenticate_as(tests.user_a());
  v := tests.imp(t, jsonb_build_array(
    tests.item('first day at start', 60, '"2026-03-01"', '540'),
    tests.item('middle day midnight', 60, '"2026-03-02"', '0'),
    tests.item('middle day till 24:00', 60, '"2026-03-02"', '1380'),
    tests.item('last day till end', 60, '"2026-03-03"', '1020'),
    tests.item('full middle day', 1440, '"2026-03-04"', '0')   -- outside: just to keep a bank row
  ));
  perform tests.clear_auth();

  return next is(tests.outcomes(v), array['placed', 'placed', 'placed', 'placed', 'day_out_of_trip'],
    'window edges are placeable');
  return next is(v -> 0 ->> 'scheduled_date', '2026-03-01', 'scheduled_date returned');
  return next is((v -> 0 ->> 'start_minute')::integer, 540, 'start_minute returned');
  return next ok(v -> 0 -> 'bank_reason' = 'null'::jsonb, 'placed row: bank_reason null');
  return next is(
    (select array_agg(a.scheduled_date::text || ' ' || a.start_minute order by a.start_minute)
     from public.activities a where a.trip_id = t and a.scheduled_date = '2026-03-02'),
    array['2026-03-02 0', '2026-03-02 1380'], 'placements stored');
  return next is(
    (select scheduled_date from public.activities where id = (v -> 4 ->> 'id')::uuid), null::date,
    'banked row stored in the bank');
end;
$fn$;

-- Every bank_reason.
create function tests.test_04_reasons()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a());
  existing uuid := tests.make_activity(t, 'existing', 120, '2026-03-02', 600);   -- 10:00-12:00
  later uuid := tests.make_activity(t, 'later', 60, '2026-03-02', 840);         -- 14:00-15:00
  v jsonb;
begin
  perform tests.authenticate_as(tests.user_a());
  v := tests.imp(t, jsonb_build_array(
    tests.item('date only', 60, '"2026-03-02"', null),                      -- 1
    tests.item('start only', 60, null, '600'),                              -- 2
    tests.item('no such date', 60, '"2026-02-30"', '600'),                  -- 3
    tests.item('not ISO', 60, '"02/03/2026"', '600'),                       -- 4
    tests.item('date as number', 60, '20260302', '600'),                    -- 5
    tests.item('off grid', 60, '"2026-03-02"', '615'),                      -- 6
    tests.item('past 23:30', 60, '"2026-03-02"', '1440'),                   -- 7
    tests.item('negative', 60, '"2026-03-02"', '-30'),                      -- 8
    tests.item('fraction', 60, '"2026-03-02"', '570.5'),                    -- 9
    tests.item('start as text', 60, '"2026-03-02"', '"09:30"'),             -- 10
    tests.item('before trip', 60, '"2026-02-28"', '600'),                   -- 11
    tests.item('after trip', 60, '"2026-03-04"', '600'),                    -- 12
    tests.item('before first start', 60, '"2026-03-01"', '480'),            -- 13
    tests.item('after last end', 60, '"2026-03-03"', '1050'),               -- 14
    tests.item('past midnight', 60, '"2026-03-02"', '1410'),                -- 15
    tests.item('overlaps existing', 60, '"2026-03-02"', '660'),             -- 16
    tests.item('spans both existing', 480, '"2026-03-02"', '540'),          -- 17
    tests.item('back to back', 60, '"2026-03-02"', '720'),                  -- 18 placed
    tests.item('overlaps row 18', 30, '"2026-03-02"', '750'),               -- 19
    tests.item('incomplete and bad', 60, '"x"', null)                       -- 20
  ));
  perform tests.clear_auth();

  return next is(tests.outcomes(v), array[
    'placement_incomplete', 'placement_incomplete',
    'placement_invalid', 'placement_invalid', 'placement_invalid', 'placement_invalid',
    'placement_invalid', 'placement_invalid', 'placement_invalid', 'placement_invalid',
    'day_out_of_trip', 'day_out_of_trip',
    'outside_trip_hours', 'outside_trip_hours', 'outside_trip_hours',
    'overlaps_existing', 'overlaps_existing',
    'placed', 'overlaps_import_row', 'placement_incomplete'],
    'each row gets the expected outcome');
  return next is((v -> 15 ->> 'conflict_activity_id')::uuid, existing, 'overlaps_existing names the activity');
  return next ok(v -> 15 -> 'conflict_item' = 'null'::jsonb, 'overlaps_existing has no conflict_item');
  return next is((v -> 16 ->> 'conflict_activity_id')::uuid, existing,
    'overlapping two existing activities names the earliest');
  return next is((v -> 18 ->> 'conflict_item')::integer, 18, 'overlaps_import_row gives the 1-based row');
  return next is((v -> 18 ->> 'conflict_activity_id')::uuid, (v -> 17 ->> 'id')::uuid,
    'overlaps_import_row gives that row''s activity id');
  return next ok((select bool_and(e -> 'scheduled_date' = 'null'::jsonb and e -> 'start_minute' = 'null'::jsonb)
                  from jsonb_array_elements(v) e where e -> 'placed' = 'false'::jsonb),
    'banked rows have no placement');
  return next ok((select bool_and(e -> 'conflict_activity_id' = 'null'::jsonb)
                  from jsonb_array_elements(v) with ordinality as x(e, n) where n not in (16, 17, 19)),
    'conflict_activity_id only on overlap rows');
  return next is((select count(*)::integer from public.activities where trip_id = t), 22,
    'every row inserted (2 existing + 20)');
  return next is((select count(*)::integer from public.activities where trip_id = t and scheduled_date is not null), 3,
    'only the valid row was placed (plus the 2 existing)');
  return next is((select start_minute::integer from public.activities where id = existing), 600,
    'existing activity untouched');
  return next ok(later is not null, 'fixture');
end;
$fn$;

-- Input order decides: an earlier row wins; a banked row blocks nothing.
create function tests.test_05_order_between_rows()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a());
  v jsonb;
begin
  perform tests.authenticate_as(tests.user_a());
  v := tests.imp(t, jsonb_build_array(
    tests.item('bad first', 60, '"2026-03-02"', '601'),        -- 1 invalid: blocks nothing
    tests.item('winner', 120, '"2026-03-02"', '600'),          -- 2 placed 10:00-12:00
    tests.item('loser', 60, '"2026-03-02"', '660'),            -- 3 overlaps row 2
    tests.item('also loser', 60, '"2026-03-02"', '660'),       -- 4 overlaps row 2 (not 3: banked)
    tests.item('after', 60, '"2026-03-02"', '720'),            -- 5 placed 12:00-13:00
    tests.item('spans 2 and 5', 120, '"2026-03-02"', '690'),   -- 6 overlaps rows 2 and 5 -> 2
    tests.item('other day', 120, '"2026-03-03"', '600')        -- 7 same time, other day: placed
  ));
  perform tests.clear_auth();

  return next is(tests.outcomes(v), array['placement_invalid', 'placed', 'overlaps_import_row',
    'overlaps_import_row', 'placed', 'overlaps_import_row', 'placed'], 'earlier rows win');
  return next is(array[(v -> 2 ->> 'conflict_item')::integer, (v -> 3 ->> 'conflict_item')::integer,
                       (v -> 5 ->> 'conflict_item')::integer], array[2, 2, 2],
    'conflict_item points at the earliest placed row, never at a banked one');
end;
$fn$;

-- Mixed placed and banked rows: bank order, colours, tag groups and the cursor as before.
create function tests.test_06_mixed_colours_and_bank()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a());
  v jsonb;
  v_cursor_before integer;
begin
  perform tests.make_activity(t, 'existing bank');   -- cursor 1, bank_position 1
  v_cursor_before := tests.cursor_of(t);

  perform tests.authenticate_as(tests.user_a());
  v := tests.imp(t, jsonb_build_array(
    tests.item('P1', 60, '"2026-03-01"', '600') || '{"tag": "Rome"}',
    tests.item('B1', 60),
    tests.item('P2', 60, '"2026-03-01"', '660') || '{"tag": " rome "}',
    tests.item('B2', 60, '"2026-03-01"', '600') || '{"tag": "ROME", "color": "#000000"}',
    tests.item('P3', 60, '"2026-03-02"', '600') || '{"color": "#ABCDEF"}'
  ));
  perform tests.clear_auth();

  return next is(tests.outcomes(v), array['placed', 'bank', 'placed', 'overlaps_import_row', 'placed'],
    'mix of placed and banked rows');
  return next is(array[v -> 0 ->> 'color', v -> 1 ->> 'color', v -> 2 ->> 'color', v -> 3 ->> 'color',
                       v -> 4 ->> 'color'],
    array['#FFE3C2', '#FFF1B5', '#FFE3C2', '#FFE3C2', '#ABCDEF'],
    'tag group colour shared by placed and banked rows; given colour kept');
  return next is(tests.cursor_of(t), (v_cursor_before + 3) % cardinality(private.palette()),
    'cursor advanced for P1, B1 and P3 only (tag-group members do not advance it)');
  return next is(
    (select array_agg(a.name order by a.bank_position) from public.activities a
     where a.trip_id = t and a.scheduled_date is null),
    array['existing bank', 'B1', 'B2'], 'bank order: existing first, then banked rows in input order');
  return next is(
    (select array_agg(a.name order by a.scheduled_date, a.start_minute) from public.activities a
     where a.trip_id = t and a.scheduled_date is not null),
    array['P1', 'P2', 'P3'], 'placed rows on the timetable');
  return next is(
    (select bool_and((v -> (n - 1) ->> 'bank_position')::double precision
                     < (v -> n ->> 'bank_position')::double precision)
     from generate_series(1, 4) n),
    true, 'bank_position increases in input order (placed rows too)');
end;
$fn$;

-- A hard error anywhere rolls back every row, placed or banked.
create function tests.test_07_atomic()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a());
  v_cursor_before integer := tests.cursor_of(t);
  v_bad_name text;
  v_bad_tag text;
  v_limit text;
  v_not_found text;
begin
  perform tests.authenticate_as(tests.user_a());
  v_bad_name := tests.err_full(format('select * from public.import_activities(%L, %L)', t, jsonb_build_array(
    tests.item('placed', 60, '"2026-03-01"', '600'),
    tests.item('banked', 60, '"2026-03-01"', '630'),
    tests.item('', 60, '"2026-03-02"', '600'))));
  v_bad_tag := tests.err_full(format('select * from public.import_activities(%L, %L)', t, jsonb_build_array(
    tests.item('placed', 60, '"2026-03-01"', '600'),
    tests.item('bad tag', 60, '"2026-03-01"', '700') || '{"tag": 5}')));
  v_limit := tests.err_full(format('select * from public.import_activities(%L, %L)', t,
    (select jsonb_agg(tests.item('n' || g, 30, to_jsonb('2026-03-02'::text), to_jsonb(g * 30 % 1440)))
     from generate_series(1, 201) g)));
  v_not_found := tests.err_full(format('select * from public.import_activities(%L, %L)',
    gen_random_uuid(), jsonb_build_array(tests.item('x', 60, '"2026-03-01"', '600'))));
  perform tests.clear_auth();

  return next is(v_bad_name, 'P0001 TP_VALIDATION [item:3:name]', 'bad name after placeable rows raises');
  return next is(v_bad_tag, 'P0001 TP_VALIDATION [item:2:tag]', 'bad tag raises');
  return next is(v_limit, 'P0001 TP_LIMIT [too_many_items]', '201 items with placements raise TP_LIMIT');
  return next is(v_not_found, 'P0001 TP_NOT_FOUND [trip]', 'unknown trip raises TP_NOT_FOUND');
  return next is((select count(*)::integer from public.activities where trip_id = t), 0, 'nothing inserted');
  return next is(tests.cursor_of(t), v_cursor_before, 'cursor unchanged');
end;
$fn$;

-- RLS: another user's trip is not found; other trips never block a placement.
create function tests.test_08_rls()
returns setof text
language plpgsql
as $fn$
declare
  t_a uuid := tests.make_trip(tests.user_a());
  t_b uuid := tests.make_trip(tests.user_b());
  b_placed uuid := tests.make_activity(t_b, 'B placed', 120, '2026-03-02', 600);
  v_cross text;
  v_anon text;
  v jsonb;
begin
  perform tests.authenticate_as(tests.user_b());
  v_cross := tests.err_full(format('select * from public.import_activities(%L, %L)', t_a,
    jsonb_build_array(tests.item('sneaky', 60, '"2026-03-02"', '600'))));
  perform tests.clear_auth();

  perform tests.authenticate_anon();
  v_anon := tests.err(format('select * from public.import_activities(%L, %L)', t_a,
    jsonb_build_array(tests.item('anon', 60, '"2026-03-02"', '600'))));
  perform tests.clear_auth();

  perform tests.authenticate_as(tests.user_a());
  v := tests.imp(t_a, jsonb_build_array(tests.item('A same slot', 60, '"2026-03-02"', '600')));
  perform tests.clear_auth();

  return next is(v_cross, 'P0001 TP_NOT_FOUND [trip]', 'B cannot import into A''s trip');
  return next ok(v_anon like '42501 %', 'anon cannot call import_activities');
  return next is(tests.outcomes(v), array['placed'], 'B''s activity in another trip does not block A');
  return next is((select count(*)::integer from public.activities where trip_id = t_a), 1,
    'only A''s own import landed in A''s trip');
  return next is((select start_minute::integer from public.activities where id = b_placed), 600,
    'B''s activity untouched');
end;
$fn$;

-- Overlap priority, bank activities, and a full-day item.
create function tests.test_09_edge_cases()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a());
  existing uuid := tests.make_activity(t, 'existing', 60, '2026-03-02', 600);     -- 10:00-11:00
  t_long uuid := tests.make_trip(tests.user_a(), '2026-03-01', 540, '2026-03-05', 1080);
  bank_only uuid := tests.make_activity(t_long, 'in the bank', 1440);           -- never placed
  v jsonb;
  v_long jsonb;
begin
  perform tests.authenticate_as(tests.user_a());
  v := tests.imp(t, jsonb_build_array(
    tests.item('import row', 60, '"2026-03-02"', '720'),        -- 1 placed 12:00-13:00
    tests.item('overlaps both', 240, '"2026-03-02"', '600')     -- 2 10:00-14:00: existing + row 1
  ));
  v_long := tests.imp(t_long, jsonb_build_array(
    tests.item('full middle day', 1440, '"2026-03-03"', '0')
  ));
  perform tests.clear_auth();

  return next is(tests.outcomes(v), array['placed', 'overlaps_existing'],
    'overlapping an existing activity and an import row reports overlaps_existing');
  return next is((v -> 1 ->> 'conflict_activity_id')::uuid, existing,
    'conflict_activity_id is the existing activity');
  return next ok(v -> 1 -> 'conflict_item' = 'null'::jsonb, 'conflict_item is null for overlaps_existing');
  return next is(tests.outcomes(v_long), array['placed'],
    '1440-minute item at minute 0 on a middle day is placed; a bank activity never conflicts');
  return next ok(v_long -> 0 -> 'conflict_activity_id' = 'null'::jsonb, 'no conflict reported');
  return next is(
    (select scheduled_date::text || ' ' || start_minute from public.activities
     where id = (v_long -> 0 ->> 'id')::uuid),
    '2026-03-03 0', 'full-day placement stored');
  return next is((select scheduled_date from public.activities where id = bank_only), null::date,
    'the bank activity stays in the bank');
end;
$fn$;
