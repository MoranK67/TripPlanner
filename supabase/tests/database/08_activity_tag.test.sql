-- FEAT-2 activities.tag (20261125120000_feat2_activity_tag.sql): column, constraint,
-- normalisation, same-tag-same-colour (insert, tag change, cross-trip isolation), import RPCs,
-- grants and RLS. Run with supabase/tests/run-db-tests.mjs (prepends _helpers.sql; rolled back).
--
-- Palette (private.palette()): 0 #FFD6E0, 1 #FFE3C2, 2 #FFF1B5, 3 #D6F2C9, 4 #C8EBE3, 5 #CDE5FF.

-- Insert as the current role; returns the new id.
create function tests.add(p_trip uuid, p_name text, p_tag text, p_color text default null)
returns uuid
language sql
as $$
  insert into public.activities (trip_id, name, duration_minutes, tag, color)
  values (p_trip, p_name, 60, p_tag, p_color)
  returning id;
$$;

create function tests.color_of(p_id uuid) returns text language sql
as $$ select color from public.activities where id = p_id $$;

create function tests.tag_of(p_id uuid) returns text language sql
as $$ select tag from public.activities where id = p_id $$;

create function tests.cursor_of(p_trip uuid) returns integer language sql
as $$ select color_cursor from public.trips where id = p_trip $$;

grant execute on all functions in schema tests to authenticated, anon;

create function tests.test_01_column_grants_and_functions()
returns setof text
language plpgsql
as $fn$
begin
  return next has_column('public', 'activities', 'tag', 'activities.tag exists');
  return next col_type_is('public', 'activities', 'tag', 'text', 'activities.tag is text');
  return next col_is_null('public', 'activities', 'tag', 'activities.tag is nullable');
  return next col_hasnt_default('public', 'activities', 'tag', 'activities.tag has no default');
  return next ok(exists (select 1 from pg_constraint where conname = 'activities_tag_valid' and contype = 'c'),
    'activities_tag_valid check constraint exists');
  return next is(
    (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'activities_trip_tag_idx'),
    'CREATE INDEX activities_trip_tag_idx ON public.activities USING btree (trip_id, lower(tag)) WHERE (tag IS NOT NULL)',
    'activities (trip_id, lower(tag)) index');

  return next ok(has_column_privilege('authenticated', 'public.activities', 'tag', 'SELECT'), 'authenticated can select tag');
  return next ok(has_column_privilege('authenticated', 'public.activities', 'tag', 'INSERT'), 'authenticated can insert tag');
  return next ok(has_column_privilege('authenticated', 'public.activities', 'tag', 'UPDATE'), 'authenticated can update tag');
  return next ok(not has_column_privilege('anon', 'public.activities', 'tag', 'SELECT'), 'anon cannot select tag');
  return next ok(not has_column_privilege('anon', 'public.activities', 'tag', 'UPDATE'), 'anon cannot update tag');
  return next ok(not has_table_privilege('anon', 'public.activities', 'INSERT'), 'anon cannot insert activities');
  return next ok(not has_column_privilege('authenticated', 'public.activities', 'trip_id', 'UPDATE'),
    'activities.trip_id still not updatable');

  return next ok(not has_function_privilege('anon', 'private.normalize_tag(text)', 'EXECUTE'), 'anon cannot execute normalize_tag');
  return next ok(not has_function_privilege('anon', 'private.tag_is_valid(text)', 'EXECUTE'), 'anon cannot execute tag_is_valid');
  return next ok(not has_function_privilege('anon', 'private.tag_group_color(uuid, text, uuid)', 'EXECUTE'), 'anon cannot execute tag_group_color');
  return next ok(not has_function_privilege('anon', 'private.preserve_colors()', 'EXECUTE'), 'anon cannot execute preserve_colors');
  return next ok(not has_function_privilege('anon', 'private.apply_tag_color()', 'EXECUTE'), 'anon cannot execute apply_tag_color');
  return next ok(not has_function_privilege('anon', 'private.normalize_activity_tag()', 'EXECUTE'), 'anon cannot execute normalize_activity_tag');
  return next ok(not (select prosecdef from pg_proc where oid = 'private.tag_group_color(uuid, text, uuid)'::regprocedure),
    'tag_group_color is SECURITY INVOKER (RLS applies)');

  return next is(
    (select array_agg(tgname::text order by tgname) from pg_trigger
     where tgrelid = 'public.activities'::regclass and not tgisinternal),
    array['activities_05_normalize_tag', 'activities_10_assign_defaults', 'activities_15_tag_color',
          'activities_20_validate_in_trip', 'activities_90_set_updated_at'],
    'activities triggers, in firing order');
  return next ok(
    (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.activities'::regclass),
    'RLS still enabled and forced on activities');
end;
$fn$;

create function tests.test_02_normalisation_and_constraint()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a());
  a_spaces uuid;
  a_empty uuid;
  a_blank uuid;
  a_ws uuid;
  a_nbsp uuid;
  a_none uuid;
  a_30 uuid;
  a_heb uuid;
  a_inner uuid;
  v_31 text;
  v_ctrl text;
  v_tab_inside text;
  v_c1 text;
  v_upd_31 text;
begin
  perform tests.authenticate_as(tests.user_a());
  a_spaces := tests.add(t, 's', '  Rome  ');
  a_empty := tests.add(t, 'e', '');
  a_blank := tests.add(t, 'b', '   ');
  a_ws := tests.add(t, 'w', E'\t Day 1 \r\n');
  a_nbsp := tests.add(t, 'n', U&'\00A0\FEFFנמל\3000');
  a_none := tests.add(t, 'x', null);
  a_30 := tests.add(t, '30', repeat('x', 30));
  a_heb := tests.add(t, 'h', repeat('ש', 30));
  a_inner := tests.add(t, 'i', 'מרכז  העיר');
  v_31 := tests.violated(format('select tests.add(%L, %L, %L)', t, 'y', repeat('x', 31)));
  v_ctrl := tests.violated(format('select tests.add(%L, %L, %L)', t, 'y', 'a' || chr(1) || 'b'));
  v_tab_inside := tests.violated(format('select tests.add(%L, %L, %L)', t, 'y', E'a\tb'));
  v_c1 := tests.violated(format('select tests.add(%L, %L, %L)', t, 'y', 'a' || chr(133) || 'b'));
  update public.activities set tag = '  updated ' where id = a_none;
  v_upd_31 := tests.violated(format('update public.activities set tag = %L where id = %L', repeat('z', 31), a_none));
  update public.activities set tag = ' ' where id = a_empty;  -- stays NULL
  perform tests.clear_auth();

  return next is(tests.tag_of(a_spaces), 'Rome', 'spaces trimmed on insert');
  return next is(tests.tag_of(a_empty), null, 'empty string stored as NULL');
  return next is(tests.tag_of(a_blank), null, 'blank string stored as NULL');
  return next is(tests.tag_of(a_ws), 'Day 1', 'tab / CR / LF at the ends trimmed');
  return next is(tests.tag_of(a_nbsp), 'נמל', 'NBSP / BOM / ideographic space trimmed (JS trim set)');
  return next is(tests.tag_of(a_none), 'updated', 'tag trimmed on update');
  return next is(tests.tag_of(a_30), repeat('x', 30), '30 characters accepted');
  return next is(tests.tag_of(a_heb), repeat('ש', 30), '30 Hebrew characters accepted');
  return next is(tests.tag_of(a_inner), 'מרכז  העיר', 'inner spaces kept');
  return next is(v_31, '23514 activities_tag_valid', '31 characters rejected');
  return next is(v_ctrl, '23514 activities_tag_valid', 'control character rejected');
  return next is(v_tab_inside, '23514 activities_tag_valid', 'tab inside rejected');
  return next is(v_c1, '23514 activities_tag_valid', 'C1 control character rejected');
  return next is(v_upd_31, '23514 activities_tag_valid', '31 characters rejected on update');
  return next is(tests.tag_of(a_empty), null, 'blank update stays NULL');

  return next is(private.normalize_tag(null), null, 'normalize_tag(NULL) = NULL');
  return next is(private.normalize_tag('  a b  '), 'a b', 'normalize_tag trims');
  return next ok(private.tag_is_valid('a'), 'tag_is_valid: 1 char');
  return next ok(not private.tag_is_valid(' a'), 'tag_is_valid: untrimmed is invalid');
  return next ok(not private.tag_is_valid(null), 'tag_is_valid: NULL is not a valid tag');
  return next ok(not private.tag_is_valid(repeat('a', 31)), 'tag_is_valid: 31 chars invalid');
end;
$fn$;

-- The constraint itself (normalisation trigger switched off inside this rolled-back test).
create function tests.test_03_constraint_without_trigger()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a());
  v_lead text;
  v_trail text;
  v_nbsp text;
  v_empty text;
  v_ok text;
begin
  alter table public.activities disable trigger activities_05_normalize_tag;
  v_lead := tests.violated(format('select tests.add(%L, %L, %L)', t, 'y', ' x'));
  v_trail := tests.violated(format('select tests.add(%L, %L, %L)', t, 'y', 'x '));
  v_nbsp := tests.violated(format('select tests.add(%L, %L, %L)', t, 'y', U&'x\00A0'));
  v_empty := tests.violated(format('select tests.add(%L, %L, %L)', t, 'y', ''));
  v_ok := tests.violated(format('select tests.add(%L, %L, %L)', t, 'y', 'x y'));
  alter table public.activities enable trigger activities_05_normalize_tag;

  return next is(v_lead, '23514 activities_tag_valid', 'constraint: leading space rejected');
  return next is(v_trail, '23514 activities_tag_valid', 'constraint: trailing space rejected');
  return next is(v_nbsp, '23514 activities_tag_valid', 'constraint: trailing NBSP rejected');
  return next is(v_empty, '23514 activities_tag_valid', 'constraint: empty string rejected');
  return next is(v_ok, 'ok', 'constraint: trimmed tag accepted');
end;
$fn$;

create function tests.test_04_same_tag_same_color_on_insert()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a());
  a1 uuid;
  a2 uuid;
  a3 uuid;
  a4 uuid;
  a5 uuid;
  a6 uuid;
  v_cursor_after_a2 integer;
begin
  perform tests.authenticate_as(tests.user_a());
  a1 := tests.add(t, 'a1', 'Rome');                 -- palette 0, cursor → 1
  a2 := tests.add(t, 'a2', ' rome ');               -- group colour, cursor stays 1
  v_cursor_after_a2 := tests.cursor_of(t);
  a3 := tests.add(t, 'a3', 'ROME', '#000000');      -- group colour wins over a given colour
  a4 := tests.add(t, 'a4', null);                   -- palette 1, cursor → 2
  a5 := tests.add(t, 'a5', 'Paris', '#123456');     -- new tag: given colour kept, cursor → 3
  a6 := tests.add(t, 'a6', 'paris');                -- joins Paris
  perform tests.clear_auth();

  return next is(tests.color_of(a1), '#FFD6E0', 'first tagged activity: palette colour');
  return next is(tests.color_of(a2), '#FFD6E0', 'same tag (case/space-insensitive): same colour');
  return next is(v_cursor_after_a2, 1, 'joining a group does not advance the cursor');
  return next is(tests.color_of(a3), '#FFD6E0', 'group colour wins over a given colour');
  return next is(tests.color_of(a4), '#FFE3C2', 'untagged activity: next palette colour (no skipped colours)');
  return next is(tests.color_of(a5), '#123456', 'new tag with a given colour keeps it');
  return next is(tests.color_of(a6), '#123456', 'later member copies the given colour of the group');
  return next is(tests.cursor_of(t), 3, 'cursor advanced only for a1, a4, a5');
  return next is(tests.tag_of(a2), 'rome', 'tag stored as typed (trimmed), not case-folded');
end;
$fn$;

create function tests.test_05_cross_trip_isolation()
returns setof text
language plpgsql
as $fn$
declare
  t1 uuid := tests.make_trip(tests.user_a(), p_name => 'one');
  t2 uuid := tests.make_trip(tests.user_a(), p_name => 'two');
  tb uuid := tests.make_trip(tests.user_b(), p_name => 'B trip');
  other uuid;
  b_rome uuid;
  a_rome uuid;
  a_rome_upd uuid;
  v_b_sees integer;
  v_b_update integer;
  v_b_group text;
begin
  perform tests.authenticate_as(tests.user_a());
  other := tests.add(t2, 'other trip', 'Rome', '#ABCDEF');
  perform tests.authenticate_as(tests.user_b());
  b_rome := tests.add(tb, 'B rome', 'Rome', '#0000FF');
  perform tests.authenticate_as(tests.user_a());
  a_rome := tests.add(t1, 'a rome', 'Rome');                    -- t1 cursor 0
  a_rome_upd := tests.add(t1, 'later', null, '#111111');
  update public.activities set tag = 'Rome' where id = a_rome_upd; -- joins t1's group only
  perform tests.authenticate_as(tests.user_b());
  select count(*)::integer into v_b_sees from public.activities where tag is not null and trip_id in (t1, t2);
  with u as (update public.activities set tag = 'hacked' where id = a_rome returning 1)
  select count(*)::integer into v_b_update from u;
  v_b_group := private.tag_group_color(t1, 'Rome', null);
  perform tests.clear_auth();

  return next is(tests.color_of(a_rome), '#FFD6E0', 'same tag in another trip of the same user has no effect');
  return next is(tests.color_of(a_rome_upd), '#FFD6E0', 'tag change joins the group of its own trip only');
  return next is(tests.color_of(other), '#ABCDEF', 'other trip unchanged');
  return next is(tests.color_of(b_rome), '#0000FF', 'another user''s same tag unchanged and not copied');
  return next is(v_b_sees, 0, 'B cannot see A''s tags');
  return next is(v_b_update, 0, 'B cannot update A''s tag (0 rows)');
  return next is(tests.tag_of(a_rome), 'Rome', 'A''s tag unchanged');
  return next is(v_b_group, null, 'tag_group_color as B sees nothing of A''s trip (invoker rights)');
end;
$fn$;

create function tests.test_06_tag_change_on_update()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a());
  g1 uuid;
  g2 uuid;
  x uuid;
  y uuid;
  z uuid;
  w uuid;
begin
  perform tests.authenticate_as(tests.user_a());
  g1 := tests.add(t, 'g1', 'Day 1', '#AA0000');   -- oldest member (bank_position 1)
  g2 := tests.add(t, 'g2', 'Day 1');              -- copies #AA0000
  update public.activities set color = '#BB0000' where id = g2;  -- only g2 changes
  x := tests.add(t, 'x', null, '#CC0000');
  y := tests.add(t, 'y', 'Solo', '#DD0000');
  z := tests.add(t, 'z', 'day 1', '#EE0000');      -- joins the group: #AA0000
  w := tests.add(t, 'w', null, '#FF0000');

  update public.activities set tag = 'DAY 1' where id = x;               -- joins: oldest = g1
  update public.activities set tag = 'Day 1', color = '#121212' where id = w; -- group wins over colour
  update public.activities set tag = 'Brand new' where id = y;           -- no group: colour kept
  update public.activities set tag = 'DAY 1', color = '#343434' where id = z; -- case-only change: not a change
  update public.activities set tag = null where id = g1;                 -- leaving: colour kept
  perform tests.clear_auth();

  return next is(tests.color_of(g2), '#BB0000', 'editing one member''s colour does not recolour the others ...');
  return next is(tests.color_of(g1), '#AA0000', '... the oldest keeps its colour (and keeps it after leaving)');
  return next is(tests.tag_of(g1), null, 'tag cleared');
  return next is(tests.color_of(x), '#AA0000', 'tag change to an existing tag: colour of the oldest member');
  return next is(tests.color_of(w), '#AA0000', 'group colour wins over a colour set in the same UPDATE');
  return next is(tests.color_of(y), '#DD0000', 'tag change to a new tag keeps the colour');
  return next is(tests.color_of(z), '#343434', 'case-only tag change is not a change: explicit colour applies');
  return next is(tests.tag_of(z), 'DAY 1', 'case-only tag change stored');
end;
$fn$;

create function tests.test_07_import_activities_tags()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a());
  existing uuid;
  v_rows public.activities[];
  v_old public.activities[];
  v_cursor_before integer;
  v_not_string text;
  v_long text;
  v_ctrl text;
  v_count_before integer;
begin
  perform tests.authenticate_as(tests.user_a());
  existing := tests.add(t, 'existing', 'Old town', '#0A0A0A');   -- cursor → 1
  v_cursor_before := tests.cursor_of(t);
  select array_agg(r order by r.bank_position) into v_rows
  from public.import_activities(t, jsonb_build_array(
    jsonb_build_object('name', 'A', 'duration_minutes', 60, 'tag', 'Day 1'),
    jsonb_build_object('name', 'B', 'duration_minutes', 60, 'tag', '  day 1 '),
    jsonb_build_object('name', 'C', 'duration_minutes', 60),
    jsonb_build_object('name', 'D', 'duration_minutes', 60, 'tag', 'Day 2', 'color', '#111111'),
    jsonb_build_object('name', 'E', 'duration_minutes', 60, 'tag', 'Day 2', 'color', '#222222'),
    jsonb_build_object('name', 'F', 'duration_minutes', 60, 'tag', 'old TOWN'),
    jsonb_build_object('name', 'G', 'duration_minutes', 60, 'tag', null),
    jsonb_build_object('name', 'H', 'duration_minutes', 60, 'tag', '')
  )) r;
  -- Backward compatibility: the pre-FEAT-2 item shape.
  select array_agg(r order by r.bank_position) into v_old
  from public.import_activities(t, '[{"name": "old", "duration_minutes": 30}]') r;

  select count(*)::integer into v_count_before from public.activities where trip_id = t;
  v_not_string := tests.err_full(format($q$select public.import_activities(%L, '[{"name":"x","duration_minutes":60},{"name":"y","duration_minutes":60,"tag":5}]')$q$, t));
  v_long := tests.err_full(format('select public.import_activities(%L, %L)', t,
    jsonb_build_array(jsonb_build_object('name', 'x', 'duration_minutes', 60, 'tag', repeat('t', 31)))));
  v_ctrl := tests.err_full(format('select public.import_activities(%L, %L)', t,
    jsonb_build_array(jsonb_build_object('name', 'x', 'duration_minutes', 60),
                      jsonb_build_object('name', 'x', 'duration_minutes', 60),
                      jsonb_build_object('name', 'x', 'duration_minutes', 60, 'tag', E'a\nb'))));
  perform tests.clear_auth();

  return next is(array_length(v_rows, 1), 8, 'eight items imported');
  return next is((v_rows[1]).tag, 'Day 1', 'tag returned by the RPC');
  return next is((v_rows[2]).tag, 'day 1', 'tag trimmed');
  return next is((v_rows[1]).color, '#FFE3C2', 'first of a new tag: next palette colour');
  return next is((v_rows[2]).color, (v_rows[1]).color, 'same tag in the same import: same colour');
  return next is((v_rows[3]).color, '#FFF1B5', 'untagged item: next palette colour (B did not use one)');
  return next is((v_rows[4]).color, '#111111', 'new tag with a given colour keeps it');
  return next is((v_rows[5]).color, '#111111', 'group colour wins over the item''s colour');
  return next is((v_rows[6]).color, '#0A0A0A', 'tag of an activity already in the trip: its colour');
  return next is((v_rows[7]).tag, null, 'JSON null tag = no tag');
  return next is((v_rows[8]).tag, null, 'empty tag = no tag');
  return next is((v_rows[8]).color, '#CDE5FF', 'untagged items continue the palette (A, C, D, G took 1..4)');
  return next is(tests.cursor_of(t), (v_cursor_before + 5 + 1) % 10, 'cursor advanced for A, C, D, G, H and the old-shape item');
  return next is((v_old[1]).tag, null, 'item without a tag key (old shape) still imports, tag NULL');
  return next is(v_not_string, 'P0001 TP_VALIDATION [item:2:tag]', 'non-string tag reports the item');
  return next is(v_long, 'P0001 TP_VALIDATION [item:1:tag]', '31-char tag rejected');
  return next is(v_ctrl, 'P0001 TP_VALIDATION [item:3:tag]', 'control character in tag rejected');
  return next is((select count(*)::integer from public.activities where trip_id = t), v_count_before,
    'failed imports inserted nothing');
end;
$fn$;

create function tests.test_08_import_trips_tags()
returns setof text
language plpgsql
as $fn$
declare
  v jsonb;
  t uuid;
  later uuid;
  v_setting text;
  v_bad text;
  v_bad_type text;
  v_trips_before integer;
  v_input jsonb := jsonb_build_array(jsonb_build_object(
    'name', 'Restored', 'start_date', '2026-03-01', 'start_minute', 540,
    'end_date', '2026-03-03', 'end_minute', 1080, 'color_cursor', 4,
    'activities', jsonb_build_array(
      jsonb_build_object('name', 'A', 'duration_minutes', 60, 'color', '#AA0000', 'tag', 'Day 1'),
      -- Same tag, different colour (the user recoloured one member): kept as in the file.
      jsonb_build_object('name', 'B', 'duration_minutes', 60, 'color', '#BB0000', 'tag', ' day 1 ',
                         'scheduled_date', '2026-03-02', 'start_minute', 600),
      jsonb_build_object('name', 'C', 'duration_minutes', 60, 'color', '#CC0000', 'tag', null),
      jsonb_build_object('name', 'D (old backup shape)', 'duration_minutes', 60, 'color', '#DD0000'),
      jsonb_build_object('name', 'E', 'duration_minutes', 60, 'color', '#EE0000', 'tag', '')
    )));
begin
  perform tests.authenticate_as(tests.user_a());
  v := public.import_trips(v_input);
  v_setting := current_setting('trip_planner.preserve_colors', true);
  t := (v -> 'trips' -> 0 -> 'trip' ->> 'id')::uuid;
  later := tests.add(t, 'later', 'DAY 1', '#FFFFFF');   -- normal rule again after the import
  select count(*)::integer into v_trips_before from public.trips;
  v_bad := tests.err_full(format('select public.import_trips(%L::jsonb)', jsonb_set(v_input,
    '{0,activities,1,tag}', to_jsonb(repeat('t', 31)))));
  v_bad_type := tests.err_full(format('select public.import_trips(%L::jsonb)', jsonb_set(v_input,
    '{0,activities,0,tag}', '["x"]'::jsonb)));
  perform tests.clear_auth();

  return next is(
    (select array_agg(tag order by bank_position) from public.activities where trip_id = t and name <> 'later'),
    array['Day 1', 'day 1', null, null, null], 'tags stored (trimmed; null / missing / empty = NULL)');
  return next is(
    (select array_agg(color order by bank_position) from public.activities where trip_id = t and name <> 'later'),
    array['#AA0000', '#BB0000', '#CC0000', '#DD0000', '#EE0000'], 'restore keeps every file colour exactly');
  return next is((select color_cursor from public.trips where id = t), 4, 'file cursor kept');
  return next is(v_setting, 'off', 'preserve_colors switched off after the import');
  return next is(tests.color_of(later), '#AA0000', 'after the import, a new member takes the oldest member''s colour');
  return next is(v_bad, 'P0001 TP_VALIDATION [trip:1:item:2:tag]', '31-char tag reports trip and item');
  return next is(v_bad_type, 'P0001 TP_VALIDATION [trip:1:item:1:tag]', 'non-string tag reports trip and item');
  return next is((select count(*)::integer from public.trips where owner_id = tests.user_a()), v_trips_before, 'failed imports stored nothing');
end;
$fn$;

-- Review follow-ups (b), (d), (e).
create function tests.test_09_service_role_has_no_tag_privileges()
returns setof text
language plpgsql
as $fn$
begin
  return next ok(not has_column_privilege('service_role', 'public.activities', 'tag', 'SELECT'), 'service_role cannot select tag');
  return next ok(not has_column_privilege('service_role', 'public.activities', 'tag', 'INSERT'), 'service_role cannot insert tag');
  return next ok(not has_column_privilege('service_role', 'public.activities', 'tag', 'UPDATE'), 'service_role cannot update tag');
end;
$fn$;

create function tests.test_10_line_separator_and_ogham_space_trimmed()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a());
  a_ls uuid;
  a_ogham uuid;
  a_only uuid;
begin
  perform tests.authenticate_as(tests.user_a());
  a_ls := tests.add(t, 'ls', chr(8232) || 'Day 1' || chr(8232));        -- U+2028 both ends
  a_ogham := tests.add(t, 'og', chr(5760) || 'Day 2' || chr(5760));     -- U+1680 both ends
  a_only := tests.add(t, 'only', U&'\2028\1680');
  perform tests.clear_auth();

  return next is(tests.tag_of(a_ls), 'Day 1', 'U+2028 trimmed at both ends');
  return next is(tests.tag_of(a_ogham), 'Day 2', 'U+1680 trimmed at both ends');
  return next is(tests.tag_of(a_only), null, 'only U+2028 / U+1680: stored as NULL');
  return next is(private.normalize_tag(U&'\2028x\1680'), 'x', 'normalize_tag trims U+2028 and U+1680');
  return next ok(not private.tag_is_valid(U&'\1680x'), 'tag_is_valid: leading U+1680 is untrimmed');
  return next ok(not private.tag_is_valid(U&'x\2028'), 'tag_is_valid: trailing U+2028 is untrimmed');
end;
$fn$;

create function tests.test_11_failed_import_trips_resets_preserve_colors()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a());
  v_err text;
  v_setting text;
  first_id uuid;
  second_id uuid;
begin
  perform tests.authenticate_as(tests.user_a());
  -- Valid input that fails in the WRITE phase (after preserve_colors was switched on): overlap.
  v_err := tests.err_full(format('select public.import_trips(%L::jsonb)', jsonb_build_array(jsonb_build_object(
    'name', 'Broken', 'start_date', '2026-03-01', 'start_minute', 540,
    'end_date', '2026-03-03', 'end_minute', 1080, 'color_cursor', 0,
    'activities', jsonb_build_array(
      jsonb_build_object('name', 'A', 'duration_minutes', 60, 'color', '#AA0000', 'tag', 'X',
                         'scheduled_date', '2026-03-02', 'start_minute', 600),
      jsonb_build_object('name', 'B', 'duration_minutes', 60, 'color', '#BB0000', 'tag', 'X',
                         'scheduled_date', '2026-03-02', 'start_minute', 630))))));
  v_setting := current_setting('trip_planner.preserve_colors', true);
  -- Same transaction: the tag rule must be active again.
  first_id := tests.add(t, 'first', 'Group', '#121212');
  second_id := tests.add(t, 'second', 'group', '#343434');
  perform tests.clear_auth();

  return next is(v_err, '23P01 TP_OVERLAP [overlap]', 'import failed in the write phase');
  return next ok(coalesce(v_setting, '') <> 'on', 'preserve_colors is not left on after a failed import');
  return next is(tests.color_of(second_id), '#121212', 'same-tag rule active after the failed import');
end;
$fn$;
