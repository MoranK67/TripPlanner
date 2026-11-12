-- M1 hardening (20261112140400_m1_hardening.sql) and function-security invariants.
-- Run with supabase/tests/run-db-tests.mjs (prepends _helpers.sql; everything is rolled back).

create function tests.test_01_bank_position_finite()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a());
  ins text := $q$insert into public.activities (trip_id, name, duration_minutes, bank_position) values (%L, 'x', 60, %L)$q$;
  a uuid := tests.make_activity(t, 'existing');
begin
  return next is(tests.violated(format(ins, t, 'NaN')), '23514 activities_bank_position_finite', 'NaN rejected');
  return next is(tests.violated(format(ins, t, 'Infinity')), '23514 activities_bank_position_finite', 'Infinity rejected');
  return next is(tests.violated(format(ins, t, '-Infinity')), '23514 activities_bank_position_finite', '-Infinity rejected');
  return next is(tests.violated(format(ins, t, '-12.5')), 'ok', 'negative finite value accepted');
  return next is(
    tests.violated(format($q$update public.activities set bank_position = 'NaN' where id = %L$q$, a)),
    '23514 activities_bank_position_finite', 'UPDATE to NaN rejected');
end;
$fn$;

create function tests.test_02_timezone_length()
returns setof text
language plpgsql
as $fn$
declare
  t uuid := tests.make_trip(tests.user_a());
begin
  return next is(
    tests.violated(format('update public.trips set timezone = %L where id = %L', repeat('z', 65), t)),
    '23514 trips_timezone_length', '65-char timezone rejected');
  return next is(
    tests.violated(format('update public.trips set timezone = %L where id = %L', repeat('z', 64), t)),
    'ok', '64-char timezone accepted');
  return next is(
    tests.violated(format($q$update public.trips set timezone = 'Europe/Rome' where id = %L$q$, t)),
    'ok', 'IANA name accepted');
end;
$fn$;

create function tests.test_03_default_privileges()
returns setof text
language plpgsql
as $fn$
declare
  v_table text;
  v_priv text;
begin
  return next is(
    (select count(*)::integer
     from pg_default_acl d, aclexplode(d.defaclacl) a
     where d.defaclrole = 'postgres'::regrole
       and d.defaclnamespace = 'public'::regnamespace
       and d.defaclobjtype = 'r'
       and a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)),
    0,
    'postgres default ACL for public tables grants nothing to anon/authenticated/service_role');

  -- A table created now (as postgres) must not leak privileges to API roles.
  create table public.tp_tmp_default_acl_probe (id int);
  return next ok(
    not exists (
      select 1 from aclexplode((select relacl from pg_class where oid = 'public.tp_tmp_default_acl_probe'::regclass)) a
      where a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)),
    'a newly created public table has no grants for API roles');

  foreach v_table in array array['public.profiles', 'public.trips', 'public.activities'] loop
    foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] loop
      return next ok(
        not has_table_privilege('service_role', v_table, v_priv),
        format('service_role has no %s on %s', v_priv, v_table));
    end loop;
    foreach v_priv in array array['REFERENCES', 'TRIGGER', 'MAINTAIN'] loop
      return next ok(
        not has_table_privilege('authenticated', v_table, v_priv),
        format('authenticated has no %s on %s', v_priv, v_table));
    end loop;
  end loop;
end;
$fn$;

create function tests.test_04_security_definer_set()
returns setof text
language plpgsql
as $fn$
begin
  return next is(
    (select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text)
     from pg_proc p
     where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
       and p.prosecdef
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
    array['private.can_access_trip(uuid,text)', 'private.handle_new_user()'],
    'the only SECURITY DEFINER functions are can_access_trip and handle_new_user');
end;
$fn$;

create function tests.test_05_search_path_pinned()
returns setof text
language plpgsql
as $fn$
begin
  return next is(
    (select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text)
     from pg_proc p
     where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and not coalesce(p.proconfig @> array['search_path=""'], false)),
    null::text[],
    'every function in public and private has search_path = ''''');
  return next ok(
    (select count(*) from pg_proc p
     where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)) >= 15,
    'sanity: the function list is not empty');
end;
$fn$;

create function tests.test_06_trigger_functions_not_executable()
returns setof text
language plpgsql
as $fn$
declare
  v_fn text;
  v_role text;
begin
  foreach v_fn in array array[
    'private.handle_new_user()',
    'private.set_updated_at()',
    'private.assign_activity_defaults()',
    'private.validate_activity_in_trip()',
    'private.unplace_out_of_range_activities()'
  ] loop
    foreach v_role in array array['anon', 'authenticated'] loop
      return next ok(
        not has_function_privilege(v_role, v_fn, 'EXECUTE'),
        format('%s cannot execute %s', v_role, v_fn));
    end loop;
  end loop;
end;
$fn$;
