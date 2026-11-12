-- M1 follow-up: update_activity RPC — atomic edit of an activity (FR-3.5) including the FR-3.6
-- rule "an edited duration that no longer fits returns the activity to the bank".
-- Replaces the client's non-atomic fallback (UPDATE → unplace_activity → UPDATE again).
--
-- update_activity(activity_id uuid, name text = null, duration_minutes integer = null,
--                 color text = null)
--   -> jsonb { "activity": <activities row, snake_case columns>, "returned_to_bank": boolean }
--
-- NULL arguments keep the current value. Placement and moves between days stay with
-- place_activity / unplace_activity. If the activity is placed and its new duration no longer
-- fits that day's bounds (fits_trip_window) or would overlap another placed activity, it is
-- moved to the end of the bank (bank_position = max + 1 in the trip) in the same UPDATE, and
-- returned_to_bank = true. Otherwise it is updated in place.
--
-- Lock order trip (FOR UPDATE) → activity, like the other RPCs. Holding the trip lock blocks every
-- concurrent placement in the trip (they all take the trip lock), so the overlap check is exact.
--
-- ERROR CONTRACT additions (the full contract is in 20261112140400_m1_hardening.sql):
-- | message        | SQLSTATE | AppError kind | details                                          |
-- |----------------|----------|---------------|--------------------------------------------------|
-- | TP_VALIDATION  | P0001    | validation    | 'activity_id' | 'name' | 'duration_minutes' | 'color' |
-- | TP_NOT_FOUND   | P0001    | not_found     | 'activity' (missing or another user's) | 'trip' |
-- update_activity never raises TP_OUT_OF_RANGE or TP_OVERLAP: a duration that does not fit
-- returns the activity to the bank instead.

create function public.update_activity(
  activity_id uuid,
  name text default null,
  duration_minutes integer default null,
  color text default null
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
  v_to_bank boolean := false;
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

  -- FR-3.6: a placed activity whose new duration no longer fits goes back to the bank.
  if v_activity.scheduled_date is not null and v_duration <> v_activity.duration_minutes then
    v_to_bank := not private.fits_trip_window(
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
  end if;

  if v_to_bank then
    select coalesce(max(a.bank_position), 0) + 1 into v_position
    from public.activities a
    where a.trip_id = v_activity.trip_id;
  end if;

  update public.activities a
  set name = coalesce(update_activity.name, a.name),
      duration_minutes = v_duration,
      color = coalesce(update_activity.color, a.color),
      scheduled_date = case when v_to_bank then null else a.scheduled_date end,
      start_minute = case when v_to_bank then null else a.start_minute end,
      bank_position = case when v_to_bank then v_position else a.bank_position end
  where a.id = v_activity.id
  returning * into v_activity;

  return jsonb_build_object('activity', to_jsonb(v_activity), 'returned_to_bank', v_to_bank);
end;
$$;

revoke all on function public.update_activity(uuid, text, integer, text) from public, anon;
grant execute on function public.update_activity(uuid, text, integer, text) to authenticated;
