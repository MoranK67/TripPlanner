-- FEAT-1 update_activity v2 (20261125120100_feat1_update_activity_placement.sql): name, colour,
-- duration, tag AND placement (place / move / back to the bank) in one atomic call; backward
-- compatibility with the 4-argument callers. The FR-3.6 "keep" behaviour is covered by
-- 06_update_activity.test.sql. Run with supabase/tests/run-db-tests.mjs (rolled back).
--
-- Trip used below: 2026-03-01 09:00 → 2026-03-03 18:00.

create function tests.row_of(p_id uuid) returns public.activities language sql
as $$ select * from public.activities where id = p_id $$;

grant execute on all functions in schema tests to authenticated, anon;

create function tests.test_01_signature_and_privileges()
returns setof text
language plpgsql
as $fn$
declare
  v_fn text := 'public.update_activity(uuid, text, integer, text, text, date, integer, boolean)';
  v_anon text;
begin
  return next ok(to_regprocedure('public.update_activity(uuid, text, integer, text)') is null,
    'old 4-argument overload dropped (no ambiguous calls)');
  return next is((select count(*)::integer from pg_proc where proname = 'update_activity'
                  and pronamespace = 'public'::regnamespace), 1, 'exactly one update_activity');
  return next is(
    (select array_to_string(proargnames, ',') from pg_proc where oid = v_fn::regprocedure),
    'activity_id,name,duration_minutes,color,tag,scheduled_date,start_minute,to_bank',
    'argument names (PostgREST named args)');
  return next is((select pronargdefaults::integer from pg_proc where oid = v_fn::regprocedure), 7,
    'every argument but activity_id has a default');
  return next ok(has_function_privilege('authenticated', v_fn, 'EXECUTE'), 'authenticated can execute');
  return next ok(not has_function_privilege('anon', v_fn, 'EXECUTE'), 'anon cannot execute');
  return next ok(not has_function_privilege('public', v_fn, 'EXECUTE'), 'PUBLIC cannot execute');
  return next ok(not (select prosecdef from pg_proc where oid = v_fn::regprocedure), 'SECURITY INVOKER');
  return next ok((select proconfig @> array['search_path=""'] from pg_proc where oid = v_fn::regprocedure),
    'pins search_path');

  perform tests.authenticate_anon();
  v_anon := tests.err(format('select public.update_activity(%L, %L)', gen_random_uuid(), 'x'));
  perform tests.clear_auth();
  return next is(v_anon, '42501 permission denied for function update_activity', 'anon call denied');
end;
$fn$;

create function tests.test_02_backward_compatible_calls()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a());
  a uuid := tests.make_activity(t, 'A', 60, '2026-03-02', 600);
  v_pos jsonb;
  v_named jsonb;
begin
  update public.activities set tag = 'Keep me' where id = a;
  perform tests.authenticate_as(tests.user_a());
  v_pos := public.update_activity(a, 'Renamed', 90, '#123456');
  v_named := public.update_activity(activity_id => a, name => 'Named');
  perform tests.clear_auth();

  return next is(v_pos -> 'activity' ->> 'name', 'Renamed', 'positional 4-arg call: name');
  return next is((v_pos -> 'activity' ->> 'duration_minutes')::integer, 90, 'positional 4-arg call: duration');
  return next is(v_pos -> 'activity' ->> 'color', '#123456', 'positional 4-arg call: colour');
  return next is(v_pos -> 'activity' ->> 'scheduled_date', '2026-03-02', 'placement kept (keep mode)');
  return next is((v_pos -> 'activity' ->> 'start_minute')::integer, 600, 'start kept (keep mode)');
  return next is((v_pos ->> 'returned_to_bank')::boolean, false, 'returned_to_bank false');
  return next is(v_named -> 'activity' ->> 'name', 'Named', 'named-argument call');
  return next is(v_named -> 'activity' ->> 'tag', 'Keep me', 'tag untouched when not passed; returned in the JSON');
end;
$fn$;

create function tests.test_03_place_from_bank_and_move()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a());
  other uuid := tests.make_activity(t, 'other');                       -- bank 1
  a uuid := tests.make_activity(t, 'A');                               -- bank 2, 60 min
  n uuid := tests.make_activity(t, 'N', 60, '2026-03-02', 720);        -- 12:00–13:00
  v_place jsonb;
  v_move jsonb;
  v_same jsonb;
  v_adjacent jsonb;
  v_first jsonb;
  v_last jsonb;
begin
  perform tests.authenticate_as(tests.user_a());
  -- All fields + placement in one call.
  v_place := public.update_activity(a, 'Louvre', 120, '#ABCDEF', 'Day 2', '2026-03-02', 600); -- 10:00–12:00
  -- Move to another day with a new duration (named args, like the client).
  v_move := public.update_activity(a, duration_minutes => 180, scheduled_date => '2026-03-03',
                                   start_minute => 0);
  -- Same slot again (overlap ignores itself).
  v_same := public.update_activity(a, scheduled_date => '2026-03-03', start_minute => 0);
  -- Adjacent to N (half-open ranges).
  v_adjacent := public.update_activity(a, duration_minutes => 60, scheduled_date => '2026-03-02',
                                       start_minute => 660);   -- 11:00–12:00, N starts 12:00
  v_first := public.update_activity(other, scheduled_date => '2026-03-01', start_minute => 540);  -- trip start
  v_last := public.update_activity(other, duration_minutes => 30, scheduled_date => '2026-03-03',
                                   start_minute => 1050);      -- 17:30–18:00, trip end
  perform tests.clear_auth();

  return next is(v_place -> 'activity' ->> 'name', 'Louvre', 'place: name saved');
  return next is((v_place -> 'activity' ->> 'duration_minutes')::integer, 120, 'place: duration saved');
  return next is(v_place -> 'activity' ->> 'color', '#ABCDEF', 'place: colour saved');
  return next is(v_place -> 'activity' ->> 'tag', 'Day 2', 'place: tag saved');
  return next is(v_place -> 'activity' ->> 'scheduled_date', '2026-03-02', 'place: day saved');
  return next is((v_place -> 'activity' ->> 'start_minute')::integer, 600, 'place: start saved');
  return next is((v_place ->> 'returned_to_bank')::boolean, false, 'place: returned_to_bank false');
  return next is((v_place -> 'activity' ->> 'bank_position')::double precision, 2::double precision,
    'place: bank_position kept (unused while placed)');
  return next is(v_move -> 'activity' ->> 'scheduled_date', '2026-03-03', 'move: other day');
  return next is((v_move -> 'activity' ->> 'start_minute')::integer, 0, 'move: 00:00 on a middle/last day');
  return next is((v_move -> 'activity' ->> 'duration_minutes')::integer, 180, 'move: new duration with the move');
  return next is(v_move -> 'activity' ->> 'name', 'Louvre', 'move: name kept');
  return next is((v_same -> 'activity' ->> 'start_minute')::integer, 0, 'same slot again is allowed');
  return next is((v_adjacent -> 'activity' ->> 'start_minute')::integer, 660, 'adjacent to a neighbour is allowed');
  return next is((v_first -> 'activity' ->> 'start_minute')::integer, 540, 'first allowed slot (trip start)');
  return next is((v_last -> 'activity' ->> 'start_minute')::integer, 1050, 'last allowed slot (ends at trip end)');
  return next is((select start_minute::integer from public.activities where id = n), 720, 'neighbour untouched');
end;
$fn$;

create function tests.test_04_place_errors_are_atomic()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a());
  a uuid := tests.make_activity(t, 'A', 60, '2026-03-02', 600);        -- 10:00–11:00
  n uuid := tests.make_activity(t, 'N', 60, '2026-03-02', 720);        -- 12:00–13:00
  b uuid := tests.make_activity(t, 'B');                               -- bank
  v_before_start text;
  v_after_end text;
  v_midnight text;
  v_outside_days text;
  v_overlap text;
  v_grow_overlap text;
  v_bank_overlap text;
  v_before public.activities;
begin
  update public.activities set tag = 'Orig' where id = a;
  v_before := tests.row_of(a);
  perform tests.authenticate_as(tests.user_a());
  v_before_start := tests.err_full(format(
    $q$select public.update_activity(%L, 'X', null, '#000000', 'New', '2026-03-01', 480)$q$, a)); -- 08:00 < 09:00
  v_grow_overlap := tests.err_full(format(
    $q$select public.update_activity(%L, 'X', 180, null, null, '2026-03-02', 600)$q$, a));       -- same slot, grows into N: error, no auto-bank
  v_overlap := tests.err_full(format(
    $q$select public.update_activity(%L, 'X', null, null, null, '2026-03-02', 690)$q$, a));      -- 11:30–12:30 into N
  v_after_end := tests.err_full(format(
    $q$select public.update_activity(%L, 'X', 120, null, null, '2026-03-03', 960)$q$, a));       -- 16:00–18:00 = trip end: ok
  v_midnight := tests.err_full(format(
    $q$select public.update_activity(%L, 'X', 120, null, null, '2026-03-02', 1380)$q$, a));      -- crosses midnight
  v_outside_days := tests.err_full(format(
    $q$select public.update_activity(%L, 'X', null, null, null, '2026-03-04', 600)$q$, a));
  v_bank_overlap := tests.err_full(format(
    $q$select public.update_activity(%L, 'Y', 30, null, 'T', '2026-03-02', 720)$q$, b));
  perform tests.clear_auth();

  return next is(v_before_start, 'P0001 TP_OUT_OF_RANGE [outside_trip_window]', 'before the trip start on day 1');
  return next is(v_after_end, 'ok', '16:00 + 2 h ends exactly at the trip end: allowed');
  return next is(v_midnight, 'P0001 TP_OUT_OF_RANGE [outside_trip_window]', 'crossing midnight');
  return next is(v_outside_days, 'P0001 TP_OUT_OF_RANGE [outside_trip_window]', 'a day outside the trip');
  return next is(v_overlap, '23P01 TP_OVERLAP [overlap]', 'overlap with another activity');
  return next is(v_grow_overlap, '23P01 TP_OVERLAP [overlap]', 'explicit placement + longer duration that overlaps: error, not the bank');
  return next is(v_bank_overlap, '23P01 TP_OVERLAP [overlap]', 'placing a bank activity onto another');

  -- v_after_end succeeded: A is now 2026-03-03 16:00, 120 min, name X. Every failed call changed nothing.
  return next is((tests.row_of(a)).scheduled_date, '2026-03-03'::date, 'only the successful call moved A');
  return next is((tests.row_of(a)).tag, 'Orig', 'failed calls did not change the tag');
  return next is((tests.row_of(a)).color, v_before.color, 'failed calls did not change the colour');
  return next is((tests.row_of(b)).name, 'B', 'failed call on B changed nothing (name)');
  return next is((tests.row_of(b)).duration_minutes, 60, 'failed call on B changed nothing (duration)');
  return next is((tests.row_of(b)).tag, null, 'failed call on B changed nothing (tag)');
  return next ok((tests.row_of(b)).scheduled_date is null, 'B still in the bank');
end;
$fn$;

create function tests.test_05_to_bank()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a());
  bank1 uuid := tests.make_activity(t, 'bank1');                         -- 1
  bank2 uuid := tests.make_activity(t, 'bank2');                         -- 2
  p uuid := tests.make_activity(t, 'P', 60, '2026-03-02', 600);          -- 3
  v_to_bank jsonb;
  v_in_bank jsonb;
  v_null_flag jsonb;
begin
  perform tests.authenticate_as(tests.user_a());
  v_to_bank := public.update_activity(p, 'P2', 1440, to_bank => true);   -- 24 h: would never fit a placement
  v_in_bank := public.update_activity(bank1, 'bank1b', to_bank => true);
  v_null_flag := public.update_activity(bank2, 'bank2b', to_bank => null);
  perform tests.clear_auth();

  return next ok(v_to_bank -> 'activity' -> 'scheduled_date' = 'null'::jsonb
                 and v_to_bank -> 'activity' -> 'start_minute' = 'null'::jsonb, 'to_bank: placement cleared');
  return next is((v_to_bank -> 'activity' ->> 'bank_position')::double precision, 4::double precision,
    'to_bank: appended to the end of the bank (max + 1)');
  return next is(v_to_bank -> 'activity' ->> 'name', 'P2', 'to_bank: other fields saved in the same call');
  return next is((v_to_bank -> 'activity' ->> 'duration_minutes')::integer, 1440, 'to_bank: duration saved');
  return next is((v_to_bank ->> 'returned_to_bank')::boolean, false, 'explicit to_bank is not the FR-3.6 notice');
  return next is((v_in_bank -> 'activity' ->> 'bank_position')::double precision, 1::double precision,
    'to_bank on a bank activity keeps its position');
  return next is(v_in_bank -> 'activity' ->> 'name', 'bank1b', 'to_bank on a bank activity: other fields saved');
  return next is(v_null_flag -> 'activity' ->> 'name', 'bank2b', 'to_bank NULL treated as false');
end;
$fn$;

create function tests.test_06_validation()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a());
  a uuid := tests.make_activity(t, 'A');
  v_both text;
  v_both_minute text;
  v_no_minute text;
  v_no_date text;
  v_off_grid text;
  v_1440 text;
  v_negative text;
  v_tag_long text;
  v_tag_ctrl text;
  v_order text;
  v_missing text;
begin
  perform tests.authenticate_as(tests.user_a());
  v_both := tests.err_full(format($q$select public.update_activity(%L, scheduled_date => '2026-03-02', start_minute => 600, to_bank => true)$q$, a));
  v_both_minute := tests.err_full(format($q$select public.update_activity(%L, start_minute => 600, to_bank => true)$q$, a));
  v_no_minute := tests.err_full(format($q$select public.update_activity(%L, scheduled_date => '2026-03-02')$q$, a));
  v_no_date := tests.err_full(format($q$select public.update_activity(%L, start_minute => 600)$q$, a));
  v_off_grid := tests.err_full(format($q$select public.update_activity(%L, scheduled_date => '2026-03-02', start_minute => 615)$q$, a));
  v_1440 := tests.err_full(format($q$select public.update_activity(%L, scheduled_date => '2026-03-02', start_minute => 1440)$q$, a));
  v_negative := tests.err_full(format($q$select public.update_activity(%L, scheduled_date => '2026-03-02', start_minute => -30)$q$, a));
  v_tag_long := tests.err_full(format('select public.update_activity(%L, tag => %L)', a, repeat('t', 31)));
  v_tag_ctrl := tests.err_full(format('select public.update_activity(%L, tag => %L)', a, 'a' || chr(7) || 'b'));
  -- Field errors come before placement errors.
  v_order := tests.err_full(format($q$select public.update_activity(%L, tag => %L, start_minute => 600)$q$, a, repeat('t', 31)));
  v_missing := tests.err_full($q$select public.update_activity('00000000-0000-4000-8000-000000000000', scheduled_date => '2026-03-02', start_minute => 600)$q$);
  perform tests.clear_auth();

  return next is(v_both, 'P0001 TP_VALIDATION [placement]', 'to_bank with a placement rejected');
  return next is(v_both_minute, 'P0001 TP_VALIDATION [placement]', 'to_bank with only start_minute rejected');
  return next is(v_no_minute, 'P0001 TP_VALIDATION [start_minute]', 'day without start rejected');
  return next is(v_no_date, 'P0001 TP_VALIDATION [scheduled_date]', 'start without day rejected');
  return next is(v_off_grid, 'P0001 TP_VALIDATION [start_minute]', 'off-grid start rejected');
  return next is(v_1440, 'P0001 TP_VALIDATION [start_minute]', 'start 24:00 rejected');
  return next is(v_negative, 'P0001 TP_VALIDATION [start_minute]', 'negative start rejected');
  return next is(v_tag_long, 'P0001 TP_VALIDATION [tag]', '31-char tag rejected');
  return next is(v_tag_ctrl, 'P0001 TP_VALIDATION [tag]', 'control character in tag rejected');
  return next is(v_order, 'P0001 TP_VALIDATION [tag]', 'field validation before placement validation');
  return next is(v_missing, 'P0001 TP_NOT_FOUND [activity]', 'unknown activity: TP_NOT_FOUND');
  return next ok((tests.row_of(a)).scheduled_date is null and (tests.row_of(a)).tag is null, 'nothing changed');
end;
$fn$;

create function tests.test_07_tag_through_update_activity()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a());
  g uuid;
  a uuid;
  c uuid;
  v_set jsonb;
  v_keep jsonb;
  v_clear jsonb;
  v_join jsonb;
  v_recolour jsonb;
begin
  insert into public.activities (trip_id, name, duration_minutes, color, tag)
  values (t, 'G', 60, '#AA0000', 'Center') returning id into g;
  a := tests.make_activity(t, 'A');
  c := tests.make_activity(t, 'C');
  perform tests.authenticate_as(tests.user_a());
  v_set := public.update_activity(a, tag => '  Day 1  ');
  v_keep := public.update_activity(a, name => 'A2');
  v_clear := public.update_activity(a, tag => '   ');
  -- Join the "Center" group, pass a colour and a placement in the same call: group colour wins.
  v_join := public.update_activity(c, color => '#00FF00', tag => 'center',
                                   scheduled_date => '2026-03-02', start_minute => 600);
  -- Then recolour only C (tag unchanged): G keeps its colour.
  v_recolour := public.update_activity(c, color => '#0000FF', tag => 'center');
  perform tests.clear_auth();

  return next is(v_set -> 'activity' ->> 'tag', 'Day 1', 'tag set and trimmed');
  return next is(v_keep -> 'activity' ->> 'tag', 'Day 1', 'tag NULL keeps the tag');
  return next is(v_clear -> 'activity' -> 'tag', 'null'::jsonb, 'blank tag clears it');
  return next is(v_join -> 'activity' ->> 'color', '#AA0000', 'joining a tag group: group colour wins over the passed colour');
  return next is(v_join -> 'activity' ->> 'scheduled_date', '2026-03-02', 'placement saved in the same call');
  return next is(v_recolour -> 'activity' ->> 'color', '#0000FF', 'recolouring a member (same tag) applies');
  return next is((tests.row_of(g)).color, '#AA0000', 'other members are not recoloured');
end;
$fn$;

create function tests.test_08_rls_isolation()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a());
  a uuid := tests.make_activity(t, 'A act');
  v_place text;
  v_bank text;
begin
  perform tests.authenticate_as(tests.user_b());
  v_place := tests.err_full(format($q$select public.update_activity(%L, 'Hacked', tag => 'x', scheduled_date => '2026-03-02', start_minute => 600)$q$, a));
  v_bank := tests.err_full(format($q$select public.update_activity(%L, to_bank => true)$q$, a));
  perform tests.clear_auth();

  return next is(v_place, 'P0001 TP_NOT_FOUND [activity]', 'B cannot place A''s activity');
  return next is(v_bank, 'P0001 TP_NOT_FOUND [activity]', 'B cannot move A''s activity to the bank');
  return next is((tests.row_of(a)).name, 'A act', 'A''s activity unchanged');
  return next ok((tests.row_of(a)).scheduled_date is null and (tests.row_of(a)).tag is null, 'A''s placement and tag unchanged');
end;
$fn$;

-- Review follow-ups (a), (c).
create function tests.test_09_out_of_range_checked_before_overlap()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a());                          -- starts 2026-03-01 09:00
  n uuid := tests.make_activity(t, 'N', 60, '2026-03-01', 540);       -- 09:00–10:00
  a uuid := tests.make_activity(t, 'A');
  v_both text;
begin
  perform tests.authenticate_as(tests.user_a());
  -- 08:00–10:00: before the trip start AND overlapping N.
  v_both := tests.err_full(format(
    $q$select public.update_activity(%L, duration_minutes => 120, scheduled_date => '2026-03-01', start_minute => 480)$q$, a));
  perform tests.clear_auth();

  return next is(v_both, 'P0001 TP_OUT_OF_RANGE [outside_trip_window]', 'out of range wins over overlap');
  return next ok((tests.row_of(a)).scheduled_date is null and (tests.row_of(a)).duration_minutes = 60, 'nothing changed');
  return next is((tests.row_of(n)).start_minute::integer, 540, 'neighbour untouched');
end;
$fn$;

create function tests.test_10_keep_mode_tag_join_and_auto_bank()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a());
  g uuid;
  a uuid;
  n uuid;
  v jsonb;
begin
  insert into public.activities (trip_id, name, duration_minutes, color, tag)
  values (t, 'G', 60, '#AA0000', 'Center') returning id into g;      -- bank 1
  a := tests.make_activity(t, 'A', 60, '2026-03-02', 600);             -- 10:00–11:00, bank 2
  n := tests.make_activity(t, 'N', 60, '2026-03-02', 720);             -- 12:00–13:00, bank 3
  perform tests.authenticate_as(tests.user_a());
  -- One call: join the "Center" group and grow into N (FR-3.6 auto-return).
  v := public.update_activity(a, duration_minutes => 180, tag => ' center ');
  perform tests.clear_auth();

  return next is((v ->> 'returned_to_bank')::boolean, true, 'auto-returned to the bank (FR-3.6)');
  return next ok(v -> 'activity' -> 'scheduled_date' = 'null'::jsonb
                 and v -> 'activity' -> 'start_minute' = 'null'::jsonb, 'placement cleared');
  return next is((v -> 'activity' ->> 'bank_position')::double precision, 4::double precision, 'appended to the bank');
  return next is((v -> 'activity' ->> 'duration_minutes')::integer, 180, 'new duration saved');
  return next is(v -> 'activity' ->> 'tag', 'center', 'tag saved (trimmed)');
  return next is(v -> 'activity' ->> 'color', '#AA0000', 'joined the group colour in the same call');
  return next is((tests.row_of(g)).color, '#AA0000', 'group member unchanged');
  return next is((tests.row_of(n)).start_minute::integer, 720, 'neighbour untouched');
end;
$fn$;
