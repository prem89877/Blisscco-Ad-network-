-- =====================================================================
-- BLISSCCO | Day 13 | Part 2 | READ-ONLY verify for day-13-4-ledger-service.sql (sirf SELECT: kuch nahi badalta)
-- (Ye file kisi database par chalayi NAHI gayi hai.) Day-13-4 chalane ke baad chalao; Expect: har row status = PASS.
-- Pehle TEST project (denim), phir asli.
-- =====================================================================

with checks(name, ok, got) as (
  values
  ('ledger_settings: RLS on, no policy, no grants for any app role',
     (select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.ledger_settings')) is true
     and (select count(*) from pg_policy p where p.polrelid = to_regclass('public.ledger_settings')) = 0
     and not exists (select 1 from information_schema.role_table_grants g
                     where g.table_schema = 'public' and g.table_name = 'ledger_settings' and g.grantee in ('PUBLIC', 'public', 'anon', 'authenticated', 'service_role')),
     ''),

  ('ledger_settings: exactly one row',
     (select count(*) from public.ledger_settings) = 1,
     (select count(*)::text from public.ledger_settings)),

  ('ledger_enabled defaults to false and publisher_share_bps has no default (no invented percentage)',
     (select a.attname from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
        where a.attrelid = to_regclass('public.ledger_settings') and a.attname = 'ledger_enabled' and pg_get_expr(d.adbin, d.adrelid) = 'false') is not null
     and not exists (select 1 from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
        where a.attrelid = to_regclass('public.ledger_settings') and a.attname = 'publisher_share_bps'),
     ''),

  ('share bps is limited to 0..10000 by a CHECK',
     exists (select 1 from pg_constraint k where k.conrelid = to_regclass('public.ledger_settings') and k.conname = 'ledger_settings_share_check'),
     ''),

  ('private ledger functions are security definer with empty search_path',
     (select count(*) from pg_proc p where p.pronamespace = 'private'::regnamespace
        and p.proname in ('ledger_append', 'ledger_record_serve', 'ledger_is_active_admin')
        and p.prosecdef and p.proconfig @> array['search_path=""']) = 3,
     ''),

  ('no app role can EXECUTE the private ledger functions',
     not exists (select 1 from information_schema.routine_privileges r
                 where r.routine_schema = 'private' and r.routine_name in ('ledger_append', 'ledger_record_serve', 'ledger_is_active_admin')
                   and r.grantee in ('PUBLIC', 'public', 'anon', 'authenticated', 'service_role')),
     ''),

  ('ledger_append refuses amounts with more than 4 decimals (bug fix present)',
     (select prosrc from pg_proc where oid = 'private.ledger_append(text, text, numeric, text, text, text, uuid, uuid, uuid, text, uuid, text)'::regprocedure) like '%ledger_invalid_amount%',
     ''),

  ('record_ad_serve (3 args) calls the ledger exactly once and still does the Day 9 spend work',
     (select (length(prosrc) - length(replace(prosrc, 'private.ledger_record_serve', ''))) / length('private.ledger_record_serve') = 1
             and prosrc like '%for update of c%'
             and prosrc like '%campaign_spend_daily%'
             and prosrc like '%v_spent_total + v_unit > v_total%'
             and prosrc like '%creative_serve_daily%'
        from pg_proc where oid = 'public.record_ad_serve(text, uuid, text)'::regprocedure),
     ''),

  ('record_ad_serve (4 args) is untouched: it still replays before charging and never writes the ledger itself',
     (select prosrc like '%replay_serve%' and prosrc like '%pg_advisory_xact_lock%' and prosrc not like '%ledger%'
        from pg_proc where oid = 'public.record_ad_serve(text, uuid, text, text)'::regprocedure),
     ''),

  ('ledger_record_serve never touches campaign_spend_daily (no second budget deduction)',
     (select prosrc not like '%campaign_spend_daily%' and prosrc not like '%creative_serve_daily%' from pg_proc where oid = 'private.ledger_record_serve(text, uuid, uuid, numeric)'::regprocedure),
     ''),

  ('admin wrappers exist, security definer, empty search_path',
     (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('ledger_reverse_entry', 'ledger_add_adjustment')
        and p.prosecdef and p.proconfig @> array['search_path=""']) = 2,
     ''),

  ('admin wrappers: EXECUTE for service_role only (not public / anon / authenticated)',
     exists (select 1 from information_schema.routine_privileges r where r.routine_schema = 'public' and r.routine_name = 'ledger_reverse_entry' and r.grantee = 'service_role')
     and exists (select 1 from information_schema.routine_privileges r where r.routine_schema = 'public' and r.routine_name = 'ledger_add_adjustment' and r.grantee = 'service_role')
     and not exists (select 1 from information_schema.routine_privileges r
                     where r.routine_schema = 'public' and r.routine_name in ('ledger_reverse_entry', 'ledger_add_adjustment')
                       and r.grantee in ('PUBLIC', 'public', 'anon', 'authenticated')),
     '')
)
select name, case when ok then 'PASS' else 'FAIL' end as status, got from checks order by name;

-- INFO (PASS/FAIL nahi): ledger abhi ON hai ya band, aur batwara tay hai ya nahi. Default: false / NULL.
--   select ledger_enabled, publisher_share_bps from public.ledger_settings;
