-- Shared fixtures for the DB test files (M1.5). The runner (supabase/tests/run-db-tests.mjs)
-- prepends this file to every *.test.sql file, wraps both in BEGIN … ROLLBACK and calls pgTAP's
-- runtests(), so nothing is ever committed to the database.
--
-- Conventions:
--   * Fixtures are created as `postgres` (BYPASSRLS). Call tests.authenticate_as() to act as an
--     app user (role `authenticated` + JWT claims), and tests.clear_auth() to switch back BEFORE
--     calling any pgTAP assertion.
--   * tests.err*/tests.violated run a statement and return its outcome as text, so the error
--     can be asserted after switching back to postgres.

create extension if not exists pgtap with schema extensions;

create schema tests;
grant usage on schema tests to authenticated, anon;

-- Two app users. Profiles are created by the handle_new_user trigger.
create function tests.user_a() returns uuid language sql immutable
as $$ select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid $$;

create function tests.user_b() returns uuid language sql immutable
as $$ select 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid $$;

create function tests.create_auth_user(p_id uuid, p_email text, p_meta jsonb default '{}')
returns uuid
language sql
as $$
  insert into auth.users (
    id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  )
  values (
    p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email,
    '{"provider":"email","providers":["email"]}', p_meta, now(), now()
  )
  returning id;
$$;

select tests.create_auth_user(tests.user_a(), 'pgtap-user-a@trip-planner.invalid');
select tests.create_auth_user(tests.user_b(), 'pgtap-user-b@trip-planner.invalid');

-- Act as an app user: role `authenticated` with the JWT claims PostgREST would set.
create function tests.authenticate_as(p_user uuid)
returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text,
    true
  );
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Act as an anonymous API caller (role `anon`, no user).
create function tests.authenticate_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end;
$$;

-- Back to the session user (postgres).
create function tests.clear_auth()
returns void
language plpgsql
as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- 'ok' or '<SQLSTATE> <message>'.
create function tests.err(p_sql text)
returns text
language plpgsql
as $$
declare
  v_state text;
  v_message text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
  return v_state || ' ' || v_message;
end;
$$;

-- 'ok' or '<SQLSTATE> <message> [<detail>]' — for TP_* errors, whose detail is the reason.
create function tests.err_full(p_sql text)
returns text
language plpgsql
as $$
declare
  v_state text;
  v_message text;
  v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics
    v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
  return v_state || ' ' || v_message || ' [' || coalesce(v_detail, '') || ']';
end;
$$;

-- 'ok' or '<SQLSTATE> <constraint name>' (falls back to the message when there is none).
create function tests.violated(p_sql text)
returns text
language plpgsql
as $$
declare
  v_state text;
  v_message text;
  v_constraint text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics
    v_state = returned_sqlstate, v_message = message_text, v_constraint = constraint_name;
  return v_state || ' ' || coalesce(nullif(v_constraint, ''), v_message);
end;
$$;

-- Fixtures (insert as postgres, bypassing RLS; triggers still run).
create function tests.make_trip(
  p_owner uuid,
  p_start_date date default '2026-03-01',
  p_start_minute integer default 540,   -- 09:00
  p_end_date date default '2026-03-03',
  p_end_minute integer default 1080,    -- 18:00
  p_name text default 'Test trip'
)
returns uuid
language sql
as $$
  insert into public.trips (owner_id, name, start_date, start_minute, end_date, end_minute)
  values (p_owner, p_name, p_start_date, p_start_minute, p_end_date, p_end_minute)
  returning id;
$$;

create function tests.make_activity(
  p_trip uuid,
  p_name text default 'Activity',
  p_duration integer default 60,
  p_date date default null,
  p_start integer default null
)
returns uuid
language sql
as $$
  insert into public.activities (trip_id, name, duration_minutes, scheduled_date, start_minute)
  values (p_trip, p_name, p_duration, p_date, p_start)
  returning id;
$$;

grant execute on all functions in schema tests to authenticated, anon;
