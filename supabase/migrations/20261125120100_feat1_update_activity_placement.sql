-- FEAT-1 (+ FEAT-2 tag): update_activity sets name, colour, duration, tag AND placement in one
-- atomic call (spec docs/specs/feat-1-2-placement-and-tags.md). Replaces the version from
-- 20261112140500_m1_update_activity.sql. The old 4-argument function is dropped (an overload
-- would make 1..4-argument calls ambiguous); every new parameter has a default, so existing
-- callers — named ({activity_id, name?, duration_minutes?, color?}) or positional — keep working
-- with the same results.
--
-- update_activity(
--   activity_id uuid,
--   name text = null,               -- NULL keeps
--   duration_minutes integer = null,-- NULL keeps
--   color text = null,              -- NULL keeps
--   tag text = null,                -- NULL keeps; '' (or only whitespace) clears; else trimmed
--   scheduled_date date = null,     -- with start_minute: place / move there
--   start_minute integer = null,    -- with scheduled_date
--   to_bank boolean = false         -- true: return to the bank (NULL = false)
-- ) -> jsonb { "activity": <activities row, snake_case columns incl. tag>,
--              "returned_to_bank": boolean }
--
-- Placement modes (decided by the arguments):
--   * keep (no scheduled_date / start_minute, to_bank false): as before — a placed activity
--     whose new duration no longer fits its day or overlaps another goes to the end of the bank
--     (FR-3.6) and returned_to_bank = true. Otherwise updated in place.
--   * place (scheduled_date AND start_minute): validated like place_activity, with the NEW
--     duration, in the same order: TP_VALIDATION → TP_OUT_OF_RANGE → TP_OVERLAP. An explicit
--     placement never falls back to the bank; it raises instead. bank_position is kept.
--     Placing at the current slot is allowed (overlap ignores the activity itself).
--   * bank (to_bank = true): a placed activity goes to the end of the bank (max + 1, like
--     unplace_activity); one already in the bank keeps its position.
--   returned_to_bank is true ONLY for the automatic FR-3.6 case, never for an explicit to_bank.
--
-- Tag: same rules as the column (20261125120000_feat2_activity_tag.sql). When the tag changes
-- to one another activity of the trip already has, the trigger activities_15_tag_color gives
-- this activity the group's colour, even if `color` was passed in the same call.
--
-- Lock order trip (FOR UPDATE) → activity, like the other RPCs. Every placement path takes the
-- trip lock, so the overlap check is exact; 23P01 from a race is still mapped to TP_OVERLAP.
--
-- ERROR CONTRACT for update_activity (full contract: 20261112140400_m1_hardening.sql):
-- | message         | SQLSTATE | AppError kind    | details                                       |
-- |-----------------|----------|------------------|-----------------------------------------------|
-- | TP_VALIDATION   | P0001    | validation       | 'activity_id' | 'name' | 'duration_minutes' |  |
-- |                 |          |                  | 'color' | 'tag' | 'scheduled_date' |           |
-- |                 |          |                  | 'start_minute' | 'placement'                  |
-- | TP_OUT_OF_RANGE | P0001    | out_of_range     | 'outside_trip_window'  (place mode only)      |
-- | TP_OVERLAP      | 23P01    | conflict_overlap | 'overlap'              (place mode only)      |
-- | TP_NOT_FOUND    | P0001    | not_found        | 'activity' | 'trip'                           |
-- Validation order: activity_id, name, duration_minutes, color, tag, placement, scheduled_date,
-- start_minute. 'placement' = to_bank together with scheduled_date / start_minute.
-- 'scheduled_date' = start_minute given without scheduled_date; 'start_minute' = scheduled_date
-- given without start_minute, or start_minute not 0..1410 on the half-hour grid.

drop function public.update_activity(uuid, text, integer, text);

create function public.update_activity(
  activity_id uuid,
  name text default null,
  duration_minutes integer default null,
  color text default null,
  tag text default null,
  scheduled_date date default null,
  start_minute integer default null,
  to_bank boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_trip_id uuid;
  v_trip public.trips;
  v_activity public.activities;
  v_duration integer;
  v_tag text;
  v_mode text := 'keep';  -- 'keep' | 'place' | 'bank'
  v_date date;
  v_minute integer;
  v_auto_bank boolean := false;
  v_position double precision;
begin
  if update_activity.activity_id is null then
    perform private.raise_tp('TP_VALIDATION', 'activity_id', 'activity_id is required');
  end if;
  if update_activity.name is not null
     and char_length(update_activity.name) not between 1 and 60 then
    perform private.raise_tp('TP_VALIDATION', 'name', 'name must be 1..60 characters');
  end if;
  if update_activity.duration_minutes is not null
     and (update_activity.duration_minutes not between 30 and 1440
          or update_activity.duration_minutes % 30 <> 0) then
    perform private.raise_tp('TP_VALIDATION', 'duration_minutes',
      'duration_minutes must be 30..1440 and a multiple of 30');
  end if;
  if update_activity.color is not null
     and update_activity.color !~ '^#[0-9A-Fa-f]{6}$' then
    perform private.raise_tp('TP_VALIDATION', 'color', 'color must be #RRGGBB');
  end if;
  if update_activity.tag is not null then
    v_tag := private.normalize_tag(update_activity.tag);  -- blank → NULL = clear
    if v_tag is not null and not private.tag_is_valid(v_tag) then
      perform private.raise_tp('TP_VALIDATION', 'tag',
        'tag must be 1..30 characters without control characters');
    end if;
  end if;

  if coalesce(update_activity.to_bank, false) then
    if update_activity.scheduled_date is not null or update_activity.start_minute is not null then
      perform private.raise_tp('TP_VALIDATION', 'placement',
        'to_bank cannot be combined with scheduled_date / start_minute');
    end if;
    v_mode := 'bank';
  elsif update_activity.scheduled_date is not null or update_activity.start_minute is not null then
    if update_activity.scheduled_date is null then
      perform private.raise_tp('TP_VALIDATION', 'scheduled_date',
        'scheduled_date is required with start_minute');
    end if;
    if update_activity.start_minute is null
       or update_activity.start_minute not between 0 and 1410
       or update_activity.start_minute % 30 <> 0 then
      perform private.raise_tp('TP_VALIDATION', 'start_minute',
        'start_minute must be 0..1410 and a multiple of 30');
    end if;
    v_mode := 'place';
  end if;

  select a.trip_id into v_trip_id
  from public.activities a
  where a.id = update_activity.activity_id;
  if not found then
    perform private.raise_tp('TP_NOT_FOUND', 'activity');
  end if;

  select * into v_trip from public.trips t where t.id = v_trip_id for update;
  if not found then
    perform private.raise_tp('TP_NOT_FOUND', 'trip');
  end if;

  select * into v_activity
  from public.activities a
  where a.id = update_activity.activity_id
  for update;
  if not found then
    perform private.raise_tp('TP_NOT_FOUND', 'activity');
  end if;

  v_duration := coalesce(update_activity.duration_minutes, v_activity.duration_minutes);
  v_date := v_activity.scheduled_date;
  v_minute := v_activity.start_minute;

  if v_mode = 'place' then
    -- Same checks and order as place_activity, with the new duration.
    if not private.fits_trip_window(
      v_trip.start_date, v_trip.start_minute, v_trip.end_date, v_trip.end_minute,
      update_activity.scheduled_date, update_activity.start_minute, v_duration
    ) then
      perform private.raise_tp('TP_OUT_OF_RANGE', 'outside_trip_window');
    end if;
    if exists (
      select 1
      from public.activities o
      where o.trip_id = v_activity.trip_id
        and o.id <> v_activity.id
        and o.scheduled_date = update_activity.scheduled_date
        and int4range(o.start_minute, o.start_minute + o.duration_minutes)
            && int4range(update_activity.start_minute, update_activity.start_minute + v_duration)
    ) then
      perform private.raise_tp('TP_OVERLAP', 'overlap');
    end if;
    v_date := update_activity.scheduled_date;
    v_minute := update_activity.start_minute;

  elsif v_mode = 'bank' then
    if v_activity.scheduled_date is not null then
      select coalesce(max(a.bank_position), 0) + 1 into v_position
      from public.activities a
      where a.trip_id = v_activity.trip_id;
      v_date := null;
      v_minute := null;
    end if;

  elsif v_activity.scheduled_date is not null and v_duration <> v_activity.duration_minutes then
    -- keep: FR-3.6, a placed activity whose new duration no longer fits goes back to the bank.
    v_auto_bank := not private.fits_trip_window(
        v_trip.start_date, v_trip.start_minute, v_trip.end_date, v_trip.end_minute,
        v_activity.scheduled_date, v_activity.start_minute, v_duration
      )
      or exists (
        select 1
        from public.activities o
        where o.trip_id = v_activity.trip_id
          and o.id <> v_activity.id
          and o.scheduled_date = v_activity.scheduled_date
          and int4range(o.start_minute, o.start_minute + o.duration_minutes)
              && int4range(v_activity.start_minute, v_activity.start_minute + v_duration)
      );
    if v_auto_bank then
      select coalesce(max(a.bank_position), 0) + 1 into v_position
      from public.activities a
      where a.trip_id = v_activity.trip_id;
      v_date := null;
      v_minute := null;
    end if;
  end if;

  begin
    update public.activities a
    set name = coalesce(update_activity.name, a.name),
        duration_minutes = v_duration,
        color = coalesce(update_activity.color, a.color),
        tag = case when update_activity.tag is null then a.tag else v_tag end,
        scheduled_date = v_date,
        start_minute = v_minute,
        bank_position = coalesce(v_position, a.bank_position)
    where a.id = v_activity.id
    returning * into v_activity;
  exception
    -- Defensive: a concurrent placement after our check (all paths take the trip lock).
    when exclusion_violation then
      perform private.raise_tp('TP_OVERLAP', 'overlap');
  end;

  return jsonb_build_object('activity', to_jsonb(v_activity), 'returned_to_bank', v_auto_bank);
end;
$$;

revoke all on function public.update_activity(uuid, text, integer, text, text, date, integer, boolean)
  from public, anon;
grant execute on function public.update_activity(uuid, text, integer, text, text, date, integer, boolean)
  to authenticated;
