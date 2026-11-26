-- FEAT-3: import_activities places items on the timetable when they carry a placement
-- (spec docs/specs/design-fixes-and-ai-placement.md, "FEAT-3 / Server"). No table change.
--
-- import_activities(trip_id uuid, items jsonb) -- same name, same arguments, same grants.
--
-- New, optional item fields (missing key or JSON null = not given):
--   scheduled_date  "YYYY-MM-DD" (JSON string)
--   start_minute    0..1410 on the half-hour grid (JSON integer)
-- Items WITHOUT both fields behave exactly as before: they go to the end of the bank.
--
-- Placement rules, per item, in INPUT ORDER (an earlier item wins over a later one):
--   * Placement problems never raise: the item is inserted IN THE BANK and the result row says
--     why (bank_reason). The import as a whole stays atomic: any TP_* error (validation of
--     name / duration / colour / tag, TP_LIMIT, TP_NOT_FOUND) still rolls back every item.
--   * Checks, in this order (the first that fails is the reason):
--       placement_incomplete  only one of scheduled_date / start_minute is given
--       placement_invalid     scheduled_date is not a valid ISO date string, or start_minute is
--                             not a JSON integer 0..1410 and a multiple of 30
--       day_out_of_trip       scheduled_date is outside start_date..end_date of the trip
--       outside_trip_hours    the day is in the trip but the activity does not fit that day's
--                             hours (before the start time on the first day, after the end time
--                             on the last day, or past midnight) -- private.fits_trip_window,
--                             the same rule as place_activity's TP_OUT_OF_RANGE
--       overlaps_existing     overlaps an activity that was in the trip before this call;
--                             conflict_activity_id = that activity (earliest start, then id)
--       overlaps_import_row   overlaps an item placed earlier in this call;
--                             conflict_item = its 1-based index, conflict_activity_id = its id
--     Overlap is the same half-open [start, start + duration) test as place_activity, so
--     back-to-back activities do not overlap.
--   * Colour and tag: unchanged (DEC-042). Every item is inserted through the same INSERT path,
--     so the tag-group colour rule and the colour cursor behave exactly as before, placed or not.
--   * Lock: the trip row FOR UPDATE for the whole call (as before), so the overlap checks are
--     exact against concurrent placements (every placement path takes the trip lock).
--
-- RESULT: one row per item, in input order. It is a SUPERSET of the old `setof activities`
-- result: the same 11 activity columns (same names and JSON types), then
--   item_index            integer  1-based index of the item in `items`
--   placed                boolean  true = on the timetable, false = in the bank
--   bank_reason           text     NULL when placed or when no placement was requested;
--                                  otherwise one of the six reasons above
--   conflict_activity_id  uuid     overlaps_existing / overlaps_import_row only, else NULL
--   conflict_item         integer  overlaps_import_row only, else NULL
--
-- Implementation: the return type changes, so the function is dropped and re-created (grants
-- re-applied). A PL/pgSQL function cannot have an output column named like its `trip_id`
-- argument, so public.import_activities is a thin SQL wrapper over the PL/pgSQL worker
-- private.import_activity_items. Both are SECURITY INVOKER with search_path = '': RLS applies
-- to the caller, another user's trip is TP_NOT_FOUND.
--
-- ERROR CONTRACT: unchanged (20261112140400_m1_hardening.sql + 20261125120000_feat2 header).
-- Placement problems are NOT errors; they are result rows with placed = false and bank_reason.
-- SQL callers that stored the result in `public.activities` variables must select the columns
-- they need; HTTP (PostgREST / supabase-js) callers see the old fields unchanged.

-- ---------------------------------------------------------------------------------------------
-- Worker
-- ---------------------------------------------------------------------------------------------
create function private.import_activity_items(trip_id uuid, items jsonb)
returns table (
  item_index integer,
  activity public.activities,
  placed boolean,
  bank_reason text,
  conflict_activity_id uuid,
  conflict_item integer
)
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
  v_trip public.trips;
  v_row public.activities;
  v_has_date boolean;
  v_has_start boolean;
  v_date date;
  v_start integer;
  v_reason text;
  v_conflict_id uuid;
  v_conflict_item integer;
  v_ids uuid[] := array[]::uuid[];  -- ids inserted by this call; position = item index
begin
  if import_activity_items.trip_id is null then
    perform private.raise_tp('TP_VALIDATION', 'trip_id', 'trip_id is required');
  end if;
  if import_activity_items.items is null
     or jsonb_typeof(import_activity_items.items) <> 'array' then
    perform private.raise_tp('TP_VALIDATION', 'items', 'items must be a JSON array');
  end if;

  v_count := jsonb_array_length(import_activity_items.items);
  if v_count > 200 then
    perform private.raise_tp('TP_LIMIT', 'too_many_items',
      format('%s items; at most 200 can be imported at once', v_count));
  end if;

  select * into v_trip from public.trips t where t.id = import_activity_items.trip_id for update;
  if not found then
    perform private.raise_tp('TP_NOT_FOUND', 'trip');
  end if;

  -- Validate everything first so a bad item reports its (1-based) index and nothing is
  -- inserted. Unchanged from 20261125120000_feat2_activity_tag.sql. Placement fields are not
  -- validated here: a bad placement banks the item instead of raising.
  for v_item, v_index in
    select e.value, e.ordinality from jsonb_array_elements(import_activity_items.items)
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

  for v_item, v_index in
    select e.value, e.ordinality from jsonb_array_elements(import_activity_items.items)
      with ordinality as e(value, ordinality)
    order by e.ordinality
  loop
    v_name := v_item ->> 'name';
    v_duration := (v_item ->> 'duration_minutes')::integer;
    v_color := v_item ->> 'color';  -- NULL: assigned from the cursor by the trigger
    v_tag := v_item ->> 'tag';      -- normalised by trigger; same tag => same colour (trigger)

    v_reason := null;
    v_conflict_id := null;
    v_conflict_item := null;
    v_date := null;
    v_start := null;
    v_has_date := coalesce(jsonb_typeof(v_item -> 'scheduled_date'), 'null') <> 'null';
    v_has_start := coalesce(jsonb_typeof(v_item -> 'start_minute'), 'null') <> 'null';

    if v_has_date or v_has_start then
      if not (v_has_date and v_has_start) then
        v_reason := 'placement_incomplete';
      else
        v_date := private.json_iso_date(v_item -> 'scheduled_date');
        v_start := private.json_uint(v_item -> 'start_minute');
        if v_date is null or v_start is null then
          v_reason := 'placement_invalid';
        elsif v_start > 1410 or v_start % 30 <> 0 then
          v_reason := 'placement_invalid';
        elsif v_date not between v_trip.start_date and v_trip.end_date then
          v_reason := 'day_out_of_trip';
        elsif not private.fits_trip_window(
          v_trip.start_date, v_trip.start_minute, v_trip.end_date, v_trip.end_minute,
          v_date, v_start, v_duration
        ) then
          v_reason := 'outside_trip_hours';
        else
          -- Activities that were in the trip before this call.
          select o.id into v_conflict_id
          from public.activities o
          where o.trip_id = v_trip.id
            and o.scheduled_date = v_date
            and o.id <> all (v_ids)
            and int4range(o.start_minute, o.start_minute + o.duration_minutes)
                && int4range(v_start, v_start + v_duration)
          order by o.start_minute, o.id
          limit 1;
          if v_conflict_id is not null then
            v_reason := 'overlaps_existing';
          else
            -- Items placed earlier in this call: the earliest item wins the report.
            select o.id, array_position(v_ids, o.id) into v_conflict_id, v_conflict_item
            from public.activities o
            where o.trip_id = v_trip.id
              and o.scheduled_date = v_date
              and o.id = any (v_ids)
              and int4range(o.start_minute, o.start_minute + o.duration_minutes)
                  && int4range(v_start, v_start + v_duration)
            order by array_position(v_ids, o.id)
            limit 1;
            if v_conflict_id is not null then
              v_reason := 'overlaps_import_row';
            end if;
          end if;
        end if;
      end if;

      if v_reason is not null then
        v_date := null;
        v_start := null;
      end if;
    end if;

    insert into public.activities (trip_id, name, duration_minutes, color, tag,
                                   scheduled_date, start_minute)
    values (v_trip.id, v_name, v_duration, v_color, v_tag, v_date, v_start)
    returning * into v_row;

    v_ids := v_ids || v_row.id;

    item_index := v_index::integer;
    activity := v_row;
    placed := v_row.scheduled_date is not null;
    bank_reason := v_reason;
    conflict_activity_id := v_conflict_id;
    conflict_item := v_conflict_item;
    return next;
  end loop;

  return;
end;
$$;

revoke all on function private.import_activity_items(uuid, jsonb) from public, anon;
grant execute on function private.import_activity_items(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Public RPC: same name and arguments; result = old activity columns + outcome columns.
-- ---------------------------------------------------------------------------------------------
drop function public.import_activities(uuid, jsonb);

create function public.import_activities(trip_id uuid, items jsonb)
returns table (
  id uuid,
  trip_id uuid,
  name text,
  duration_minutes integer,
  color text,
  scheduled_date date,
  start_minute smallint,
  bank_position double precision,
  created_at timestamptz,
  updated_at timestamptz,
  tag text,
  item_index integer,
  placed boolean,
  bank_reason text,
  conflict_activity_id uuid,
  conflict_item integer
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select
    (r.activity).id,
    (r.activity).trip_id,
    (r.activity).name,
    (r.activity).duration_minutes,
    (r.activity).color,
    (r.activity).scheduled_date,
    (r.activity).start_minute,
    (r.activity).bank_position,
    (r.activity).created_at,
    (r.activity).updated_at,
    (r.activity).tag,
    r.item_index,
    r.placed,
    r.bank_reason,
    r.conflict_activity_id,
    r.conflict_item
  from private.import_activity_items(import_activities.trip_id, import_activities.items) r
  order by r.item_index;
$$;

comment on function public.import_activities(uuid, jsonb) is
  'Imports up to 200 activities atomically, in input order. Items may carry scheduled_date + start_minute (FEAT-3): placed when valid, otherwise banked with bank_reason.';

revoke all on function public.import_activities(uuid, jsonb) from public, anon;
grant execute on function public.import_activities(uuid, jsonb) to authenticated;
