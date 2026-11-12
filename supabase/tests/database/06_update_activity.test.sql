-- update_activity RPC (20261112140500_m1_update_activity.sql): FR-3.5 edits and the FR-3.6
-- "doesn't fit any more → back to the bank" rule, atomically.
-- Run with supabase/tests/run-db-tests.mjs (prepends _helpers.sql; everything is rolled back).

create function tests.test_01_privileges()
returns setof text
language plpgsql
as $fn$
declare
  v_fn text := 'public.update_activity(uuid, text, integer, text)';
  v_anon text;
begin
  return next ok(has_function_privilege('authenticated', v_fn, 'EXECUTE'), 'authenticated can execute update_activity');
  return next ok(not has_function_privilege('anon', v_fn, 'EXECUTE'), 'anon cannot execute update_activity');
  return next ok(not (select prosecdef from pg_proc where oid = v_fn::regprocedure), 'update_activity is SECURITY INVOKER');
  return next ok(
    (select proconfig @> array['search_path=""'] from pg_proc where oid = v_fn::regprocedure),
    'update_activity pins search_path');

  perform tests.authenticate_anon();
  v_anon := tests.err(format('select public.update_activity(%L, %L)', gen_random_uuid(), 'x'));
  perform tests.clear_auth();
  return next is(v_anon, '42501 permission denied for function update_activity', 'anon call denied');
end;
$fn$;

-- Trip: 2026-03-01 09:00 → 2026-03-03 18:00.
create function tests.test_02_in_place_update()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a(), '2026-03-01', 540, '2026-03-03', 1080);
  a uuid := tests.make_activity(t, 'Museum', 60, '2026-03-02', 600);   -- 10:00–11:00
  n uuid := tests.make_activity(t, 'Lunch', 60, '2026-03-02', 720);    -- 12:00–13:00
  v_all jsonb;
  v_keep jsonb;
  v_grow jsonb;
  v_shrink jsonb;
begin
  perform tests.authenticate_as(tests.user_a());
  v_all := public.update_activity(a, 'Louvre', null, '#123456');
  v_keep := public.update_activity(a);                         -- nothing changes
  v_grow := public.update_activity(a, duration_minutes => 120); -- 10:00–12:00, adjacent to lunch
  v_shrink := public.update_activity(a, duration_minutes => 30);
  perform tests.clear_auth();

  return next is(v_all -> 'activity' ->> 'name', 'Louvre', 'name updated');
  return next is(v_all -> 'activity' ->> 'color', '#123456', 'colour updated');
  return next is((v_all -> 'activity' ->> 'duration_minutes')::integer, 60, 'null duration keeps the duration');
  return next is((v_all ->> 'returned_to_bank')::boolean, false, 'returned_to_bank false for in-place edits');
  return next is((v_all -> 'activity' ->> 'id')::uuid, a, 'activity id returned');
  return next is(v_keep -> 'activity' ->> 'name', 'Louvre', 'all-null call keeps every value');
  return next is((v_grow ->> 'returned_to_bank')::boolean, false, 'growing up to the neighbour''s start stays placed (half-open)');
  return next is((v_grow -> 'activity' ->> 'start_minute')::integer, 600, 'placement kept');
  return next is((v_shrink -> 'activity' ->> 'duration_minutes')::integer, 30, 'shrinking stays placed');
  return next is((v_shrink -> 'activity' ->> 'scheduled_date'), '2026-03-02', 'date kept');
  return next ok(v_all -> 'activity' ? 'bank_position', 'activity JSON has every column (snake_case)');
end;
$fn$;

create function tests.test_03_returns_to_bank()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a(), '2026-03-01', 540, '2026-03-03', 1080);
  bank uuid := tests.make_activity(t, 'bank');                          -- position 1
  late uuid := tests.make_activity(t, 'late', 60, '2026-03-03', 960);   -- 16:00–17:00, ends ≤ 18:00
  night uuid := tests.make_activity(t, 'night', 60, '2026-03-02', 1380); -- 23:00–24:00
  a uuid := tests.make_activity(t, 'a', 60, '2026-03-02', 600);         -- 10:00–11:00
  n uuid := tests.make_activity(t, 'n', 60, '2026-03-02', 720);         -- 12:00–13:00
  v_past_end jsonb;
  v_midnight jsonb;
  v_neighbour jsonb;
begin
  perform tests.authenticate_as(tests.user_a());
  v_past_end := public.update_activity(late, duration_minutes => 180);        -- would end 19:00 > 18:00
  v_midnight := public.update_activity(night, 'night 2', 120);                -- would cross midnight
  v_neighbour := public.update_activity(a, duration_minutes => 150, color => '#ABCDEF'); -- into n
  perform tests.clear_auth();

  return next is((v_past_end ->> 'returned_to_bank')::boolean, true, 'growing past the trip end returns to bank');
  return next ok(v_past_end -> 'activity' -> 'scheduled_date' = 'null'::jsonb
                 and v_past_end -> 'activity' -> 'start_minute' = 'null'::jsonb, 'placement cleared');
  return next is((v_past_end -> 'activity' ->> 'duration_minutes')::integer, 180, 'new duration applied');
  return next is((v_past_end -> 'activity' ->> 'bank_position')::double precision, 6::double precision, 'appended to the bank (max + 1)');

  return next is((v_midnight ->> 'returned_to_bank')::boolean, true, 'growing across midnight returns to bank');
  return next is(v_midnight -> 'activity' ->> 'name', 'night 2', 'other fields applied in the same call');
  return next is((v_midnight -> 'activity' ->> 'bank_position')::double precision, 7::double precision, 'appended after the previous one');

  return next is((v_neighbour ->> 'returned_to_bank')::boolean, true, 'growing into a neighbour returns to bank');
  return next is(v_neighbour -> 'activity' ->> 'color', '#ABCDEF', 'colour applied too');
  return next is((select start_minute::integer from public.activities where id = n), 720, 'the neighbour is untouched');
  return next is(
    (select array_agg(name order by bank_position) from public.activities where trip_id = t and scheduled_date is null),
    array['bank', 'late', 'night 2', 'a'], 'bank order: existing first, then in call order');
end;
$fn$;

create function tests.test_04_bank_activity_and_validation()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a());
  b uuid := tests.make_activity(t, 'bank');
  v_bank jsonb;
  v_name_empty text;
  v_name_long text;
  v_dur_off text;
  v_dur_zero text;
  v_dur_long text;
  v_color text;
  v_null_id text;
  v_missing text;
begin
  perform tests.authenticate_as(tests.user_a());
  v_bank := public.update_activity(b, 'renamed', 1440);
  v_name_empty := tests.err_full(format($q$select public.update_activity(%L, '')$q$, b));
  v_name_long := tests.err_full(format('select public.update_activity(%L, %L)', b, repeat('x', 61)));
  v_dur_off := tests.err_full(format('select public.update_activity(%L, null, 45)', b));
  v_dur_zero := tests.err_full(format('select public.update_activity(%L, null, 0)', b));
  v_dur_long := tests.err_full(format('select public.update_activity(%L, null, 1470)', b));
  v_color := tests.err_full(format($q$select public.update_activity(%L, null, null, 'blue')$q$, b));
  v_null_id := tests.err_full($q$select public.update_activity(null, 'x')$q$);
  v_missing := tests.err_full($q$select public.update_activity('00000000-0000-4000-8000-000000000000', 'x')$q$);
  perform tests.clear_auth();

  return next is((v_bank ->> 'returned_to_bank')::boolean, false, 'bank activity: returned_to_bank false');
  return next is((v_bank -> 'activity' ->> 'duration_minutes')::integer, 1440, 'bank activity: any valid duration accepted');
  return next is((v_bank -> 'activity' ->> 'bank_position')::double precision, 1::double precision, 'bank activity keeps its position');
  return next is(v_name_empty, 'P0001 TP_VALIDATION [name]', 'empty name rejected');
  return next is(v_name_long, 'P0001 TP_VALIDATION [name]', '61-char name rejected');
  return next is(v_dur_off, 'P0001 TP_VALIDATION [duration_minutes]', 'off-grid duration rejected');
  return next is(v_dur_zero, 'P0001 TP_VALIDATION [duration_minutes]', 'zero duration rejected');
  return next is(v_dur_long, 'P0001 TP_VALIDATION [duration_minutes]', 'duration over 24 h rejected');
  return next is(v_color, 'P0001 TP_VALIDATION [color]', 'bad colour rejected');
  return next is(v_null_id, 'P0001 TP_VALIDATION [activity_id]', 'missing id rejected');
  return next is(v_missing, 'P0001 TP_NOT_FOUND [activity]', 'unknown activity raises TP_NOT_FOUND');
  return next is((select name from public.activities where id = b), 'renamed', 'failed calls changed nothing');
end;
$fn$;

create function tests.test_05_rls_isolation()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a());
  a uuid := tests.make_activity(t, 'A act', 60, '2026-03-02', 600);
  v_b text;
begin
  perform tests.authenticate_as(tests.user_b());
  v_b := tests.err_full(format($q$select public.update_activity(%L, 'Hacked', 1440)$q$, a));
  perform tests.clear_auth();

  return next is(v_b, 'P0001 TP_NOT_FOUND [activity]', 'B cannot update A''s activity');
  return next is((select name from public.activities where id = a), 'A act', 'A''s activity unchanged');
  return next is((select start_minute::integer from public.activities where id = a), 600, 'A''s placement unchanged');
end;
$fn$;
