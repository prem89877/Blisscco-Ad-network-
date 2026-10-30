-- =====================================================================
-- BLISSCCO | Day 14 | Part 2 | READ-ONLY verify for day-13-7-publisher-earnings.sql (sirf SELECT: kuch nahi badalta)
-- (Ye file kisi database par chalayi NAHI gayi hai.) day-13-7 chalane ke baad chalao; Expect: har row status = PASS.
-- Test (denim) aur asli (blisscco ad network) DONO par chala sakte ho. Asli par rollback-only tests (day-13-8) KABHI nahi.
-- Ye sirf STRUCTURE jaanchta hai. Behaviour (ownership, totals) ke liye day-13-8 (SIRF TEST) chalao.
-- =====================================================================

with checks(name, ok, got) as (
  values

  ('both earnings functions exist, stable, security definer, empty search_path',
     (select count(*) = 2 and bool_and(p.prosecdef) and bool_and(p.provolatile = 's')
             and bool_and(coalesce('search_path=""' = any(p.proconfig), false))
        from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname in ('get_my_publisher_earnings', 'get_my_publisher_ledger_entries')),
     (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname in ('get_my_publisher_earnings', 'get_my_publisher_ledger_entries'))),

  ('authenticated can execute both functions',
     (select count(*) = 2 from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname in ('get_my_publisher_earnings', 'get_my_publisher_ledger_entries')
         and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
     ''),

  ('PUBLIC / anon / service_role have NO execute on either function',
     not exists (select 1 from information_schema.routine_privileges r
                 where r.routine_schema = 'public' and r.routine_name in ('get_my_publisher_earnings', 'get_my_publisher_ledger_entries')
                   and r.grantee in ('PUBLIC', 'public', 'anon', 'service_role')),
     (select string_agg(r.routine_name || ':' || r.grantee, ', ') from information_schema.routine_privileges r
        where r.routine_schema = 'public' and r.routine_name in ('get_my_publisher_earnings', 'get_my_publisher_ledger_entries')
          and r.grantee in ('PUBLIC', 'public', 'anon', 'service_role'))),

  ('both functions only read (no insert / update / delete / truncate in the body)',
     (select count(*) = 2 and bool_and(p.prosrc !~* '\m(insert|update|delete|truncate)\M')
        from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname in ('get_my_publisher_earnings', 'get_my_publisher_ledger_entries')),
     ''),

  ('both functions scope by auth.uid() (no publisher id parameter)',
     (select count(*) = 2 and bool_and(p.prosrc like '%auth.uid()%')
        from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname in ('get_my_publisher_earnings', 'get_my_publisher_ledger_entries')),
     (select string_agg(p.proname || '(' || pg_get_function_arguments(p.oid) || ')', ', ') from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.proname in ('get_my_publisher_earnings', 'get_my_publisher_ledger_entries'))),

  ('result columns never expose campaign / advertiser / serve reference / reason / created_by / publisher id',
     (select count(*) = 2 and bool_and(pg_get_function_result(p.oid) !~* '(campaign_id|advertiser|source_ref|created_by|reason|publisher_id)')
        from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname in ('get_my_publisher_earnings', 'get_my_publisher_ledger_entries')),
     ''),

  ('financial_ledger still has RLS on and no grant to any app role (earnings functions are the only publisher read path)',
     (select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.financial_ledger')) is true
     and not exists (select 1 from information_schema.role_table_grants g
                     where g.table_schema = 'public' and g.table_name = 'financial_ledger'
                       and g.grantee in ('PUBLIC', 'public', 'anon', 'authenticated', 'service_role')),
     '')
)
select name, case when coalesce(ok, false) then 'PASS' else 'FAIL' end as status, got from checks order by name;
