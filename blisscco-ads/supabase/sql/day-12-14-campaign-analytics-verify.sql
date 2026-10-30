-- =====================================================================
-- BLISSCCO | Day 14 | Part 2 | READ-ONLY verify for day-12-12-campaign-analytics.sql (sirf SELECT: kuch nahi badalta)
-- (Ye file kisi database par chalayi NAHI gayi hai.) day-12-12 chalane ke baad chalao; Expect: har row status = PASS.
-- Test (denim) aur asli (blisscco ad network) DONO par chala sakte ho. Asli par rollback-only tests (day-12-13) KABHI nahi.
-- Ye sirf STRUCTURE jaanchta hai. Behaviour (ownership) ke liye day-12-13 (SIRF TEST) chalao.
-- =====================================================================

with checks(name, ok, got) as (
  values

  ('both analytics functions exist, stable, security definer, empty search_path',
     (select count(*) = 2 and bool_and(p.prosecdef) and bool_and(p.provolatile = 's')
             and bool_and(coalesce('search_path=""' = any(p.proconfig), false))
        from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname in ('get_my_campaign_analytics', 'get_my_publisher_analytics')),
     (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname in ('get_my_campaign_analytics', 'get_my_publisher_analytics'))),

  ('authenticated can execute both functions',
     (select count(*) = 2 from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname in ('get_my_campaign_analytics', 'get_my_publisher_analytics')
         and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
     ''),

  ('PUBLIC / anon / service_role have NO execute on either function (day-12-12 Day 14 fix: service_role revoke)',
     not exists (select 1 from information_schema.routine_privileges r
                 where r.routine_schema = 'public' and r.routine_name in ('get_my_campaign_analytics', 'get_my_publisher_analytics')
                   and r.grantee in ('PUBLIC', 'public', 'anon', 'service_role')),
     (select string_agg(r.routine_name || ':' || r.grantee, ', ') from information_schema.routine_privileges r
        where r.routine_schema = 'public' and r.routine_name in ('get_my_campaign_analytics', 'get_my_publisher_analytics')
          and r.grantee in ('PUBLIC', 'public', 'anon', 'service_role'))),

  ('both functions only read (no insert / update / delete / truncate in the body)',
     (select count(*) = 2 and bool_and(p.prosrc !~* '\m(insert|update|delete|truncate)\M')
        from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname in ('get_my_campaign_analytics', 'get_my_publisher_analytics')),
     ''),

  ('campaign analytics scopes by caller (my_advertiser_id / is_admin), not by a caller-supplied owner id',
     (select p.prosrc like '%private.my_advertiser_id()%' and p.prosrc like '%private.is_admin()%'
        from pg_proc p where p.oid = to_regprocedure('public.get_my_campaign_analytics(uuid)')),
     ''),

  ('publisher analytics scopes by auth.uid() and returns NO campaign / advertiser identity',
     (select p.prosrc like '%auth.uid()%' and pg_get_function_result(p.oid) !~* '(campaign_id|advertiser|creative_id|publisher_id)'
        from pg_proc p where p.oid = to_regprocedure('public.get_my_publisher_analytics()')),
     (select pg_get_function_result(p.oid) from pg_proc p where p.oid = to_regprocedure('public.get_my_publisher_analytics()'))),

  ('ad_events still has RLS on and no grant to any app role (analytics functions are the only read path)',
     (select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.ad_events')) is true
     and not exists (select 1 from information_schema.role_table_grants g
                     where g.table_schema = 'public' and g.table_name = 'ad_events'
                       and g.grantee in ('PUBLIC', 'public', 'anon', 'authenticated', 'service_role')),
     '')
)
select name, case when coalesce(ok, false) then 'PASS' else 'FAIL' end as status, got from checks order by name;
