-- FEAT-2: activities.tag — one optional free-text tag per activity ("same day / same group"),
-- and "same tag => same colour" inside a trip (spec docs/specs/feat-1-2-placement-and-tags.md).
--
--   1. Column activities.tag text NULL + check constraint activities_tag_valid:
--        trimmed, 1..30 characters (code points), no control characters.
--      "Trimmed" and "whitespace" use the same set as JavaScript String.prototype.trim():
--        U+0009..U+000D, U+0020, U+00A0, U+1680, U+2000..U+200A, U+2028, U+2029, U+202F,
--        U+205F, U+3000, U+FEFF.
--      "Control characters": U+0001..U+001F and U+007F..U+009F (U+0000 cannot occur in text).
--   2. private.normalize_tag(text): trims that whitespace; empty → NULL.
--      private.tag_is_valid(text): the constraint, for RPC validation (normalised input).
--   3. Trigger activities_05_normalize_tag (BEFORE INSERT / UPDATE OF tag): stores
--      normalize_tag(tag), so every write path (plain insert/update, RPCs) stores '' as NULL
--      and '  x ' as 'x'. Values still invalid after that fail activities_tag_valid (23514).
--   4. Same tag => same colour (case-insensitive; tags are stored trimmed):
--        * INSERT (assign_activity_defaults, after the trip lock): when another activity of the
--          SAME trip has the same tag, the new activity takes its colour — even if a colour was
--          given — and trips.color_cursor is NOT advanced (otherwise a large group would burn
--          through the palette and the next new tag could repeat a group's colour). Without a
--          match: unchanged rule (given colour or palette_color(cursor); cursor advances).
--        * UPDATE OF tag (trigger activities_15_tag_color): when the tag really changes
--          (lower(new) <> lower(old)) to a non-NULL tag that another activity of the trip has,
--          the activity takes that colour (wins over a colour set in the same UPDATE). Otherwise
--          its colour is kept. Takes the trip lock (FOR UPDATE) to serialise group joins.
--        * The group colour is the colour of the group's oldest member
--          (created_at, bank_position, id). Editing the colour of one tagged activity does NOT
--          recolour the others. Tags in other trips never matter.
--        * import_trips (backup restore) keeps the file's colours exactly: it sets the
--          transaction-local setting trip_planner.preserve_colors = 'on' around its inserts,
--          which turns the tag rule off. Nothing else sets it.
--   5. Grants: UPDATE (tag) for authenticated (INSERT/SELECT are table-level already).
--      RLS unchanged: the row policies cover the new column.
--   6. import_activities accepts items[].tag; import_trips accepts trips[].activities[].tag.
--      Missing key or JSON null = no tag; must otherwise be a string; normalised like the column.
--   update_activity gets `tag` in the next migration (20261125120100_feat1_update_activity_placement.sql).
--
-- ERROR CONTRACT additions (full contract: 20261112140400_m1_hardening.sql + M6 header):
-- | message        | SQLSTATE | details                                                       |
-- |----------------|----------|---------------------------------------------------------------|
-- | TP_VALIDATION  | P0001    | 'item:<n>:tag' (import_activities)                             |
-- |                |          | 'trip:<n>:item:<m>:tag' (import_trips)                         |
-- Plain writes with a bad tag: 23514 check_violation, constraint activities_tag_valid.

-- ---------------------------------------------------------------------------------------------
-- 1. Column + constraint + index
-- ---------------------------------------------------------------------------------------------
alter table public.activities
  add column tag text
    constraint activities_tag_valid check (
      tag is null
      or (
        char_length(tag) between 1 and 30
        and tag !~ '[\u0001-\u001f\u007f-\u009f]'
        and tag !~ '^[\u0009-\u000d    -     　﻿]'
        and tag !~ '[\u0009-\u000d    -     　﻿]$'
      )
    );

comment on column public.activities.tag is
  'Optional group tag (FEAT-2), trimmed, 1..30 characters, NULL = none. Same tag (case-insensitive) in a trip => same colour on insert / tag change.';

create index activities_trip_tag_idx on public.activities (trip_id, lower(tag))
  where tag is not null;

-- ---------------------------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------------------------
create function private.normalize_tag(tag text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(
    regexp_replace(
      normalize_tag.tag,
      '^[\u0009-\u000d    -     　﻿]+|[\u0009-\u000d    -     　﻿]+$',
      '',
      'g'
    ),
    ''
  );
$$;

-- Same rule as activities_tag_valid for a non-NULL, already normalised tag.
create function private.tag_is_valid(tag text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select tag_is_valid.tag is not null
    and char_length(tag_is_valid.tag) between 1 and 30
    and tag_is_valid.tag !~ '[\u0001-\u001f\u007f-\u009f]'
    and tag_is_valid.tag = private.normalize_tag(tag_is_valid.tag);
$$;

-- Colour of the oldest other activity in the trip with the same tag (case-insensitive), or NULL.
-- Invoker rights: only rows the caller can see.
create function private.tag_group_color(trip_id uuid, tag text, exclude_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select a.color
  from public.activities a
  where a.trip_id = tag_group_color.trip_id
    and lower(a.tag) = lower(tag_group_color.tag)
    and a.id is distinct from tag_group_color.exclude_id
  order by a.created_at, a.bank_position, a.id
  limit 1;
$$;

-- True while import_trips restores a backup (colours are kept exactly).
create function private.preserve_colors()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('trip_planner.preserve_colors', true), '') = 'on';
$$;

revoke all on function private.normalize_tag(text) from public, anon;
revoke all on function private.tag_is_valid(text) from public, anon;
revoke all on function private.tag_group_color(uuid, text, uuid) from public, anon;
revoke all on function private.preserve_colors() from public, anon;
grant execute on function private.normalize_tag(text) to authenticated;
grant execute on function private.tag_is_valid(text) to authenticated;
grant execute on function private.tag_group_color(uuid, text, uuid) to authenticated;
grant execute on function private.preserve_colors() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Normalise on every write
-- ---------------------------------------------------------------------------------------------
create function private.normalize_activity_tag()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.tag := private.normalize_tag(new.tag);
  return new;
end;
$$;

revoke all on function private.normalize_activity_tag() from public, anon;

create trigger activities_05_normalize_tag
  before insert or update of tag on public.activities
  for each row execute function private.normalize_activity_tag();

-- ---------------------------------------------------------------------------------------------
-- 4a. INSERT: assign_activity_defaults with the tag rule. CREATE OR REPLACE keeps the trigger.
-- ---------------------------------------------------------------------------------------------
create or replace function private.assign_activity_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cursor integer;
  v_tag_color text;
begin
  select t.color_cursor into v_cursor
  from public.trips t
  where t.id = new.trip_id
  for update;

  if not found then
    perform private.raise_tp('TP_NOT_FOUND', 'trip', 'The trip does not exist or is not accessible.');
  end if;

  -- new.tag is already normalised (activities_05_normalize_tag fires first).
  if new.tag is not null and not private.preserve_colors() then
    v_tag_color := private.tag_group_color(new.trip_id, new.tag, new.id);
  end if;

  if v_tag_color is not null then
    new.color := v_tag_color;
  elsif new.color is null then
    new.color := private.palette_color(v_cursor);
  end if;

  if new.bank_position is null then
    select coalesce(max(a.bank_position), 0) + 1 into new.bank_position
    from public.activities a
    where a.trip_id = new.trip_id;
  end if;

  -- A tag-group colour is not a new palette colour: the cursor stays.
  if v_tag_color is null then
    update public.trips t
    set color_cursor = (v_cursor + 1) % cardinality(private.palette())
    where t.id = new.trip_id;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 4b. UPDATE OF tag: join the group's colour.
-- ---------------------------------------------------------------------------------------------
create function private.apply_tag_color()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_tag_color text;
begin
  if new.tag is null
     or lower(new.tag) is not distinct from lower(old.tag)
     or private.preserve_colors() then
    return new;
  end if;

  -- Serialise with inserts / other tag changes in the trip (RPCs already hold this lock).
  perform 1 from public.trips t where t.id = new.trip_id for update;
  if not found then
    perform private.raise_tp('TP_NOT_FOUND', 'trip', 'The trip does not exist or is not accessible.');
  end if;

  v_tag_color := private.tag_group_color(new.trip_id, new.tag, new.id);
  if v_tag_color is not null then
    new.color := v_tag_color;
  end if;

  return new;
end;
$$;

revoke all on function private.apply_tag_color() from public, anon;

create trigger activities_15_tag_color
  before update of tag on public.activities
  for each row execute function private.apply_tag_color();

-- ---------------------------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------------------------
grant update (tag) on table public.activities to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6a. import_activities: items[].tag (optional). Otherwise unchanged from the M1 hardening version.
-- ---------------------------------------------------------------------------------------------
create or replace function public.import_activities(trip_id uuid, items jsonb)
returns setof public.activities
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
  v_item jsonb;
  v_index bigint;
  v_name text;
  v_duration integer;
  v_color text;
  v_tag text;
  v_row public.activities;
begin
  if import_activities.trip_id is null then
    perform private.raise_tp('TP_VALIDATION', 'trip_id', 'trip_id is required');
  end if;
  if import_activities.items is null or jsonb_typeof(import_activities.items) <> 'array' then
    perform private.raise_tp('TP_VALIDATION', 'items', 'items must be a JSON array');
  end if;

  v_count := jsonb_array_length(import_activities.items);
  if v_count > 200 then
    perform private.raise_tp('TP_LIMIT', 'too_many_items',
      format('%s items; at most 200 can be imported at once', v_count));
  end if;

  perform 1 from public.trips t where t.id = import_activities.trip_id for update;
  if not found then
    perform private.raise_tp('TP_NOT_FOUND', 'trip');
  end if;

  -- Validate everything first so a bad item reports its (1-based) index and nothing is
  -- inserted. Nested IFs, because SQL does not guarantee short-circuit evaluation of OR and the
  -- casts below must only run on values already known to be well-formed.
  for v_item, v_index in
    select e.value, e.ordinality from jsonb_array_elements(import_activities.items)
      with ordinality as e(value, ordinality)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      perform private.raise_tp('TP_VALIDATION', format('item:%s', v_index),
        'each item must be a JSON object');
    end if;

    if jsonb_typeof(v_item -> 'name') is distinct from 'string' then
      perform private.raise_tp('TP_VALIDATION', format('item:%s:name', v_index),
        'name must be a string of 1..60 characters');
    end if;
    if char_length(v_item ->> 'name') not between 1 and 60 then
      perform private.raise_tp('TP_VALIDATION', format('item:%s:name', v_index),
        'name must be a string of 1..60 characters');
    end if;

    if jsonb_typeof(v_item -> 'duration_minutes') is distinct from 'number'
       or (v_item ->> 'duration_minutes') !~ '^[0-9]{1,4}$' then
      perform private.raise_tp('TP_VALIDATION', format('item:%s:duration_minutes', v_index),
        'duration_minutes must be an integer 30..1440 and a multiple of 30');
    end if;
    v_duration := (v_item ->> 'duration_minutes')::integer;
    if v_duration not between 30 and 1440 or v_duration % 30 <> 0 then
      perform private.raise_tp('TP_VALIDATION', format('item:%s:duration_minutes', v_index),
        'duration_minutes must be an integer 30..1440 and a multiple of 30');
    end if;

    if jsonb_typeof(v_item -> 'color') is not null
       and jsonb_typeof(v_item -> 'color') <> 'null' then
      if jsonb_typeof(v_item -> 'color') <> 'string' then
        perform private.raise_tp('TP_VALIDATION', format('item:%s:color', v_index),
          'color must be #RRGGBB or omitted');
      end if;
      if (v_item ->> 'color') !~ '^#[0-9A-Fa-f]{6}$' then
        perform private.raise_tp('TP_VALIDATION', format('item:%s:color', v_index),
          'color must be #RRGGBB or omitted');
      end if;
    end if;

    -- tag: missing / JSON null / blank = no tag; otherwise a valid tag after trimming.
    if jsonb_typeof(v_item -> 'tag') is not null
       and jsonb_typeof(v_item -> 'tag') <> 'null' then
      if jsonb_typeof(v_item -> 'tag') <> 'string' then
        perform private.raise_tp('TP_VALIDATION', format('item:%s:tag', v_index),
          'tag must be a string of 1..30 characters or omitted');
      end if;
      v_tag := private.normalize_tag(v_item ->> 'tag');
      if v_tag is not null and not private.tag_is_valid(v_tag) then
        perform private.raise_tp('TP_VALIDATION', format('item:%s:tag', v_index),
          'tag must be 1..30 characters without control characters');
      end if;
    end if;
  end loop;

  for v_item in
    select e.value from jsonb_array_elements(import_activities.items)
      with ordinality as e(value, ordinality)
    order by e.ordinality
  loop
    v_name := v_item ->> 'name';
    v_duration := (v_item ->> 'duration_minutes')::integer;
    v_color := v_item ->> 'color';  -- NULL → assigned from the cursor by the trigger
    v_tag := v_item ->> 'tag';      -- normalised by trigger; same tag ⇒ same colour (trigger)

    insert into public.activities (trip_id, name, duration_minutes, color, tag)
    values (import_activities.trip_id, v_name, v_duration, v_color, v_tag)
    returning * into v_row;

    return next v_row;
  end loop;

  return;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 6b. import_trips: trips[].activities[].tag (optional); file colours kept exactly.
--     Otherwise unchanged from 20261114120000_m6_import_trips.sql.
-- ---------------------------------------------------------------------------------------------
create or replace function public.import_trips(trips jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_trip_count integer;
  v_activity_total bigint;
  v_t jsonb;
  v_n bigint;
  v_a jsonb;
  v_m bigint;
  v_p text;
  v_name text;
  v_start_date date;
  v_end_date date;
  v_start_minute integer;
  v_end_minute integer;
  v_int integer;
  v_has_date boolean;
  v_has_minute boolean;
  v_tag text;
  v_trip public.trips;
  v_count integer;
  v_result jsonb := '[]'::jsonb;
  v_message text;
  v_detail text;
begin
  if import_trips.trips is null or jsonb_typeof(import_trips.trips) <> 'array' then
    perform private.raise_tp('TP_VALIDATION', 'trips', 'trips must be a JSON array');
  end if;

  v_trip_count := jsonb_array_length(import_trips.trips);
  if v_trip_count = 0 then
    perform private.raise_tp('TP_VALIDATION', 'trips', 'trips must not be empty');
  end if;
  if v_trip_count > 50 then
    perform private.raise_tp('TP_LIMIT', 'too_many_trips',
      format('%s trips; at most 50 can be imported at once', v_trip_count));
  end if;

  select coalesce(sum(jsonb_array_length(e.value -> 'activities')), 0) into v_activity_total
  from jsonb_array_elements(import_trips.trips) as e(value)
  where jsonb_typeof(e.value) = 'object'
    and jsonb_typeof(e.value -> 'activities') = 'array';
  if v_activity_total > 2000 then
    perform private.raise_tp('TP_LIMIT', 'too_many_activities',
      format('%s activities; at most 2000 can be imported at once', v_activity_total));
  end if;

  -- 1. Validate everything (1-based indexes in details).
  for v_t, v_n in
    select e.value, e.ordinality
    from jsonb_array_elements(import_trips.trips) with ordinality as e(value, ordinality)
  loop
    v_p := format('trip:%s', v_n);

    if jsonb_typeof(v_t) <> 'object' then
      perform private.raise_tp('TP_VALIDATION', v_p, 'each trip must be a JSON object');
    end if;
    if jsonb_typeof(v_t -> 'activities') is distinct from 'array' then
      perform private.raise_tp('TP_VALIDATION', v_p, 'activities must be a JSON array');
    end if;

    if jsonb_typeof(v_t -> 'name') is distinct from 'string' then
      perform private.raise_tp('TP_VALIDATION', v_p || ':name', 'name must be 1..50 characters');
    end if;
    v_name := v_t ->> 'name';
    if char_length(v_name) not between 1 and 50 or v_name ~ '^\s*$' then
      perform private.raise_tp('TP_VALIDATION', v_p || ':name', 'name must be 1..50 characters, not blank');
    end if;

    v_start_date := private.json_iso_date(v_t -> 'start_date');
    v_end_date := private.json_iso_date(v_t -> 'end_date');
    if v_start_date is null or v_end_date is null then
      perform private.raise_tp('TP_VALIDATION', v_p || ':invalid_date', 'dates must be YYYY-MM-DD');
    end if;
    v_start_minute := private.json_uint(v_t -> 'start_minute');
    if v_start_minute is null or v_start_minute > 1410 or v_start_minute % 30 <> 0 then
      perform private.raise_tp('TP_VALIDATION', v_p || ':invalid_start_minute',
        'start_minute must be 0..1410 and a multiple of 30');
    end if;
    v_end_minute := private.json_uint(v_t -> 'end_minute');
    if v_end_minute is null or v_end_minute not between 30 and 1440 or v_end_minute % 30 <> 0 then
      perform private.raise_tp('TP_VALIDATION', v_p || ':invalid_end_minute',
        'end_minute must be 30..1440 and a multiple of 30');
    end if;
    if (v_end_date, v_end_minute) <= (v_start_date, v_start_minute) then
      perform private.raise_tp('TP_VALIDATION', v_p || ':end_not_after_start',
        'trip must end after it starts');
    end if;
    if v_end_date - v_start_date > 89 then
      perform private.raise_tp('TP_VALIDATION', v_p || ':too_long', 'a trip can be at most 90 days');
    end if;

    if private.json_uint(v_t -> 'color_cursor') is null then
      perform private.raise_tp('TP_VALIDATION', v_p || ':color_cursor',
        'color_cursor must be a non-negative integer');
    end if;

    for v_a, v_m in
      select e.value, e.ordinality
      from jsonb_array_elements(v_t -> 'activities') with ordinality as e(value, ordinality)
    loop
      v_p := format('trip:%s:item:%s', v_n, v_m);

      if jsonb_typeof(v_a) <> 'object' then
        perform private.raise_tp('TP_VALIDATION', v_p, 'each activity must be a JSON object');
      end if;

      if jsonb_typeof(v_a -> 'name') is distinct from 'string' then
        perform private.raise_tp('TP_VALIDATION', v_p || ':name', 'name must be 1..60 characters');
      end if;
      v_name := v_a ->> 'name';
      if char_length(v_name) not between 1 and 60 or v_name ~ '^\s*$' then
        perform private.raise_tp('TP_VALIDATION', v_p || ':name',
          'name must be 1..60 characters, not blank');
      end if;

      v_int := private.json_uint(v_a -> 'duration_minutes');
      if v_int is null or v_int not between 30 and 1440 or v_int % 30 <> 0 then
        perform private.raise_tp('TP_VALIDATION', v_p || ':duration_minutes',
          'duration_minutes must be an integer 30..1440 and a multiple of 30');
      end if;

      if jsonb_typeof(v_a -> 'color') is distinct from 'string' then
        perform private.raise_tp('TP_VALIDATION', v_p || ':color', 'color must be #RRGGBB');
      end if;
      if (v_a ->> 'color') !~ '^#[0-9A-Fa-f]{6}$' then
        perform private.raise_tp('TP_VALIDATION', v_p || ':color', 'color must be #RRGGBB');
      end if;

      -- Missing key or JSON null = not set.
      v_has_date := coalesce(jsonb_typeof(v_a -> 'scheduled_date'), 'null') <> 'null';
      v_has_minute := coalesce(jsonb_typeof(v_a -> 'start_minute'), 'null') <> 'null';
      if v_has_date then
        if private.json_iso_date(v_a -> 'scheduled_date') is null then
          perform private.raise_tp('TP_VALIDATION', v_p || ':scheduled_date',
            'scheduled_date must be YYYY-MM-DD or null');
        end if;
      end if;
      if v_has_minute then
        v_int := private.json_uint(v_a -> 'start_minute');
        if v_int is null or v_int > 1410 or v_int % 30 <> 0 then
          perform private.raise_tp('TP_VALIDATION', v_p || ':start_minute',
            'start_minute must be 0..1410 and a multiple of 30, or null');
        end if;
      end if;
      if v_has_date and not v_has_minute then
        perform private.raise_tp('TP_VALIDATION', v_p || ':start_minute',
          'start_minute is required when scheduled_date is set');
      end if;
      if v_has_minute and not v_has_date then
        perform private.raise_tp('TP_VALIDATION', v_p || ':scheduled_date',
          'scheduled_date is required when start_minute is set');
      end if;

      -- tag: missing / JSON null / blank = no tag; otherwise a valid tag after trimming.
      if coalesce(jsonb_typeof(v_a -> 'tag'), 'null') <> 'null' then
        if jsonb_typeof(v_a -> 'tag') <> 'string' then
          perform private.raise_tp('TP_VALIDATION', v_p || ':tag',
            'tag must be a string of 1..30 characters or null');
        end if;
        v_tag := private.normalize_tag(v_a ->> 'tag');
        if v_tag is not null and not private.tag_is_valid(v_tag) then
          perform private.raise_tp('TP_VALIDATION', v_p || ':tag',
            'tag must be 1..30 characters without control characters');
        end if;
      end if;
    end loop;
  end loop;

  -- 2. Write. One exception block (one subtransaction) around all writes, only to add the trip
  --    and item to the hint of placement errors and to map 23P01 to TP_OVERLAP.
  v_n := 0;
  v_m := 0;
  begin
    -- A restore keeps the file's colours exactly: the same-tag-same-colour rule is off for
    -- these inserts (transaction-local; reverted with the subtransaction on error).
    perform set_config('trip_planner.preserve_colors', 'on', true);

    for v_t, v_n in
      select e.value, e.ordinality
      from jsonb_array_elements(import_trips.trips) with ordinality as e(value, ordinality)
    loop
      v_m := 0;
      insert into public.trips (name, start_date, start_minute, end_date, end_minute)
      values (
        v_t ->> 'name',
        private.json_iso_date(v_t -> 'start_date'),
        private.json_uint(v_t -> 'start_minute'),
        private.json_iso_date(v_t -> 'end_date'),
        private.json_uint(v_t -> 'end_minute')
      )
      returning * into v_trip;

      for v_a, v_m in
        select e.value, e.ordinality
        from jsonb_array_elements(v_t -> 'activities') with ordinality as e(value, ordinality)
      loop
        insert into public.activities (
          trip_id, name, duration_minutes, color, scheduled_date, start_minute, bank_position, tag
        )
        values (
          v_trip.id,
          v_a ->> 'name',
          private.json_uint(v_a -> 'duration_minutes'),
          v_a ->> 'color',
          private.json_iso_date(v_a -> 'scheduled_date'),
          private.json_uint(v_a -> 'start_minute'),
          v_m,
          v_a ->> 'tag'  -- normalised by trigger
        );
      end loop;
      v_count := jsonb_array_length(v_t -> 'activities');
      v_m := 0;

      -- After the inserts: assign_activity_defaults advanced the cursor once per activity.
      update public.trips t
      set color_cursor = private.json_uint(v_t -> 'color_cursor') % cardinality(private.palette())
      where t.id = v_trip.id
      returning * into v_trip;

      v_result := v_result || jsonb_build_array(
        jsonb_build_object('trip', to_jsonb(v_trip), 'activity_count', v_count));
    end loop;

    perform set_config('trip_planner.preserve_colors', 'off', true);
  exception
    when exclusion_violation then
      perform private.raise_tp('TP_OVERLAP', 'overlap',
        format('trip:%s:item:%s overlaps an earlier activity of the trip', v_n, v_m));
    when raise_exception then
      get stacked diagnostics
        v_message = message_text, v_detail = pg_exception_detail;
      if v_message = 'TP_OUT_OF_RANGE' then
        perform private.raise_tp('TP_OUT_OF_RANGE', v_detail,
          format('trip:%s:item:%s is outside the trip window', v_n, v_m));
      end if;
      raise;
  end;

  return jsonb_build_object('trips', v_result);
end;
$$;
