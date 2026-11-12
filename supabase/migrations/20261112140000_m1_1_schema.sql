-- M1.1: core schema — profiles, trips, activities (PROJECT_PLAN §6.2, time model §4.5).
--
-- Times are floating local times: `date` + minute of day (smallint), no time zone.
-- Every limit here is mirrored in src/domain/constants.ts and src/domain/placement.ts.
--
-- Security notes (PROJECT_PLAN §4.6, §6.4):
--   * "Automatically expose new tables" is off, but the project's default ACLs still hand
--     TRUNCATE/REFERENCES/TRIGGER/MAINTAIN on new public tables to anon/authenticated. TRUNCATE
--     bypasses RLS, so every table starts with REVOKE ALL and gets explicit grants only.
--   * RLS is enabled and forced here already (deny-all until the M1.3 policies exist), so the
--     tables are never reachable without row-level checks, even between migrations.

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------------------------
-- profiles: one row per auth user (created by trigger in M1.2).
-- ---------------------------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text
    constraint profiles_display_name_length
    check (display_name is null or char_length(display_name) between 1 and 60),
  locale text not null default 'he'
    constraint profiles_locale_supported check (locale in ('he')),
  created_at timestamptz not null default now()
);

comment on table public.profiles is 'One row per auth user; created by trigger on auth.users insert.';

-- ---------------------------------------------------------------------------------------------
-- trips
-- ---------------------------------------------------------------------------------------------
create table public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references public.profiles (id) on delete cascade,
  name text not null
    constraint trips_name_length check (char_length(name) between 1 and 50),
  start_date date not null,
  start_minute smallint not null
    constraint trips_start_minute_valid
    check (start_minute between 0 and 1410 and start_minute % 30 = 0),
  end_date date not null,
  -- 1440 = "24:00", end of that day.
  end_minute smallint not null
    constraint trips_end_minute_valid
    check (end_minute between 30 and 1440 and end_minute % 30 = 0),
  -- Reserved for Phase 2 (multi-zone items); unused in the MVP.
  timezone text,
  -- Index of the next palette colour for new activities (advanced by trigger, M1.2).
  color_cursor integer not null default 0
    constraint trips_color_cursor_non_negative check (color_cursor >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trips_end_after_start
    check ((end_date, end_minute) > (start_date, start_minute)),
  -- At most 90 calendar days, both ends inclusive.
  constraint trips_max_90_days check (end_date - start_date <= 89)
);

comment on column public.trips.end_minute is 'Minute of day the trip ends on end_date, 30..1440 (1440 = 24:00).';
comment on column public.trips.color_cursor is 'Index of the next palette colour; advanced on every activity insert.';

create index trips_owner_start_idx on public.trips (owner_id, start_date);

-- ---------------------------------------------------------------------------------------------
-- activities: in the bank when scheduled_date/start_minute are NULL, else placed.
-- ---------------------------------------------------------------------------------------------
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  name text not null
    constraint activities_name_length check (char_length(name) between 1 and 60),
  duration_minutes integer not null
    constraint activities_duration_valid
    check (duration_minutes between 30 and 1440 and duration_minutes % 30 = 0),
  -- Palette is enforced by the client; the DB only checks the format (the palette may evolve).
  color text not null
    constraint activities_color_format check (color ~ '^#[0-9A-Fa-f]{6}$'),
  scheduled_date date,
  start_minute smallint
    constraint activities_start_minute_valid
    check (start_minute between 0 and 1410 and start_minute % 30 = 0),
  -- Order within the bank; fractional so items can be reordered without renumbering.
  bank_position double precision not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Both set (placed) or both NULL (in the bank).
  constraint activities_placement_complete
    check ((scheduled_date is null) = (start_minute is null)),
  -- No crossing midnight in the MVP.
  constraint activities_within_day
    check (start_minute is null or start_minute + duration_minutes <= 1440),
  -- No two placed activities of the same trip overlap on the same day. Ranges are half-open
  -- [start, start + duration), so one ending at 10:00 and one starting at 10:00 do not overlap.
  constraint activities_no_overlap exclude using gist (
    trip_id with =,
    scheduled_date with =,
    int4range(start_minute, start_minute + duration_minutes) with &&
  ) where (scheduled_date is not null)
);

comment on column public.activities.scheduled_date is 'NULL = in the bank.';
comment on column public.activities.start_minute is 'Minute of day 0..1410; NULL = in the bank.';

create index activities_trip_date_idx on public.activities (trip_id, scheduled_date);
create index activities_trip_bank_idx on public.activities (trip_id, bank_position)
  where scheduled_date is null;

-- ---------------------------------------------------------------------------------------------
-- Row-level security: enabled and forced on every table (policies in M1.3).
-- ---------------------------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.trips enable row level security;
alter table public.trips force row level security;
alter table public.activities enable row level security;
alter table public.activities force row level security;

-- ---------------------------------------------------------------------------------------------
-- Privileges: nothing for anon; explicit, minimal grants for authenticated.
-- UPDATE is granted per column so ids, ownership and timestamps cannot be rewritten.
-- ---------------------------------------------------------------------------------------------
revoke all on table public.profiles, public.trips, public.activities from public, anon, authenticated;

-- profiles: rows are created by trigger only, deleted only by cascade from auth.users.
grant select on table public.profiles to authenticated;
grant update (display_name, locale) on table public.profiles to authenticated;

grant select, insert, delete on table public.trips to authenticated;
grant update (name, start_date, start_minute, end_date, end_minute, timezone, color_cursor)
  on table public.trips to authenticated;

grant select, insert, delete on table public.activities to authenticated;
grant update (name, duration_minutes, color, scheduled_date, start_minute, bank_position)
  on table public.activities to authenticated;
