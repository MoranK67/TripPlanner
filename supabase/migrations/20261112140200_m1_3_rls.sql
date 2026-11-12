-- M1.3: row-level security (PROJECT_PLAN §6.4).
--
-- RLS was enabled and forced on all tables in M1.1 (deny-all). This migration adds the single
-- access helper can_access_trip() and the policies. anon has no grants and no policies.
--
-- | Table      | SELECT                        | INSERT                         | UPDATE                         | DELETE                         |
-- |------------|-------------------------------|--------------------------------|--------------------------------|--------------------------------|
-- | profiles   | id = auth.uid()               | — (trigger only)               | id = auth.uid()                | — (cascade from auth.users)    |
-- | trips      | can_access_trip(id,'viewer')* | owner_id = auth.uid()          | can_access_trip(id,'editor')   | owner_id = auth.uid()          |
-- | activities | can_access_trip(trip_id,'viewer') | can_access_trip(trip_id,'editor') | can_access_trip(trip_id,'editor') | can_access_trip(trip_id,'editor') |
--
-- * trips SELECT also accepts `owner_id = auth.uid()` directly. INSERT ... RETURNING (what
--   supabase-js `.insert().select()` sends) checks the SELECT policy against the new row, and
--   can_access_trip() — a STABLE function reading trips — cannot see a row inserted by the same
--   statement. The direct owner test makes the new row visible; the helper still covers
--   everything else (and Phase 2 members).

-- ---------------------------------------------------------------------------------------------
-- can_access_trip(trip_id, min_role)
-- MVP: the caller owns the trip. Phase 2: also checks trip_members (viewer < editor < owner).
-- SECURITY DEFINER so the policy on trips can read trips without recursing into its own RLS
-- (owner `postgres` has BYPASSRLS). Unknown roles deny.
-- ---------------------------------------------------------------------------------------------
create function private.can_access_trip(trip_id uuid, min_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select can_access_trip.min_role in ('viewer', 'editor', 'owner')
    and exists (
      select 1
      from public.trips t
      where t.id = can_access_trip.trip_id
        and t.owner_id = (select auth.uid())
    );
$$;

revoke all on function private.can_access_trip(uuid, text) from public, anon;
grant execute on function private.can_access_trip(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------------------------
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- trips
-- ---------------------------------------------------------------------------------------------
create policy trips_select on public.trips
  for select to authenticated
  using (owner_id = (select auth.uid()) or private.can_access_trip(id, 'viewer'));

create policy trips_insert_own on public.trips
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy trips_update on public.trips
  for update to authenticated
  using (private.can_access_trip(id, 'editor'))
  with check (private.can_access_trip(id, 'editor'));

create policy trips_delete_own on public.trips
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- activities
-- ---------------------------------------------------------------------------------------------
create policy activities_select on public.activities
  for select to authenticated
  using (private.can_access_trip(trip_id, 'viewer'));

create policy activities_insert on public.activities
  for insert to authenticated
  with check (private.can_access_trip(trip_id, 'editor'));

create policy activities_update on public.activities
  for update to authenticated
  using (private.can_access_trip(trip_id, 'editor'))
  with check (private.can_access_trip(trip_id, 'editor'));

create policy activities_delete on public.activities
  for delete to authenticated
  using (private.can_access_trip(trip_id, 'editor'));
