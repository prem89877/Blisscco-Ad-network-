-- =====================================================================
-- BLISSCCO | Day 13 | Part 5 | READ-ONLY verify for day-13-12-financial-security.sql (sirf SELECT: kuch nahi badalta)
-- (Ye file kisi database par chalayi NAHI gayi hai.) day-13-12 chalane ke baad chalao; Expect: har row status = PASS.
-- Pehle TEST project (denim), phir asli (blisscco ad network). Asli par sirf ye verify; rollback-only tests (day-13-14) nahi.
-- Ye sirf STRUCTURE jaanchta hai (tables, grants, triggers, function grants). Behaviour ke liye day-13-14 (sirf TEST) chalao.
-- =====================================================================

with checks(name, ok, got) as (
  values

  ('all money tables have RLS on, no policy, and no grant to any app role',
     (select count(*) from pg_class c
        where c.oid in (to_regclass('public.financial_ledger'), to_regclass('public.ledger_settings'), to_regclass('public.ad_platform_settings'),
                        to_regclass('public.publisher_payout_requests'), to_regclass('public.publisher_payout_events'), to_regclass('public.financial_settings_history'))
          and c.relrowsecurity) = 6
     and (select count(*) from pg_policy p
            where p.polrelid in (to_regclass('public.financial_ledger'), to_regclass('public.ledger_settings'), to_regclass('public.ad_platform_settings'),
                                 to_regclass('public.publisher_payout_requests'), to_regclass('public.publisher_payout_events'), to_regclass('public.financial_settings_history'))) = 0
     and not exists (select 1 from information_schema.role_table_grants g
                     where g.table_schema = 'public'
                       and g.table_name in ('financial_ledger', 'ledger_settings', 'ad_platform_settings', 'publisher_payout_requests', 'publisher_payout_events', 'financial_settings_history')
                       and g.grantee in ('PUBLIC', 'public', 'anon', 'authenticated', 'service_role')),
     (select string_agg(g.table_name || ':' || g.grantee, ', ') from information_schema.role_table_grants g
        where g.table_schema = 'public' and g.table_name in ('financial_ledger', 'ledger_settings', 'ad_platform_settings', 'publisher_payout_requests', 'publisher_payout_events', 'financial_settings_history')
          and g.grantee in ('PUBLIC', 'public', 'anon', 'authenticated', 'service_role'))),

  ('financial_settings_history exists and its sequence has no grant to any app role',
     to_regclass('public.financial_settings_history') is not null
     and not exists (select 1 from information_schema.role_usage_grants u
                     where u.object_schema = 'public' and u.object_name = 'financial_settings_history_id_seq'
                       and u.grantee in ('PUBLIC', 'public', 'anon', 'authenticated', 'service_role')),
     ''),

  ('history is append-only: update / delete trigger and truncate trigger exist',
     (select count(*) from pg_trigger t where t.tgrelid = to_regclass('public.financial_settings_history') and not t.tgisinternal
        and t.tgname in ('financial_settings_history_guard', 'financial_settings_history_no_truncate')) = 2,
     ''),

  ('every money setting has a baseline row in history (ledger_enabled, publisher_share_bps, cpm_usd)',
     (select count(distinct h.setting) from public.financial_settings_history h where h.change_kind = 'baseline') = 3,
     (select string_agg(h.setting || '=' || coalesce(h.new_value, 'null'), ', ' order by h.setting) from public.financial_settings_history h where h.change_kind = 'baseline')),

  ('settings changes are logged: AFTER UPDATE trigger on ledger_settings and ad_platform_settings',
     (select count(*) from pg_trigger t where not t.tgisinternal
        and ((t.tgrelid = to_regclass('public.ledger_settings') and t.tgname = 'ledger_settings_log_change')
          or (t.tgrelid = to_regclass('public.ad_platform_settings') and t.tgname = 'ad_platform_settings_log_change'))) = 2,
     ''),

  ('settings rows cannot be deleted or truncated: 4 guard triggers exist',
     (select count(*) from pg_trigger t where not t.tgisinternal
        and ((t.tgrelid = to_regclass('public.ledger_settings') and t.tgname in ('ledger_settings_no_delete', 'ledger_settings_no_truncate'))
          or (t.tgrelid = to_regclass('public.ad_platform_settings') and t.tgname in ('ad_platform_settings_no_delete', 'ad_platform_settings_no_truncate')))) = 4,
     ''),

  ('new private functions are security definer, empty search_path, and no app role can EXECUTE them',
     (select count(*) from pg_proc p where p.pronamespace = 'private'::regnamespace
        and p.proname in ('guard_financial_settings_history', 'log_financial_setting_change', 'guard_financial_settings_delete', 'guard_payout_request')
        and p.prosecdef and p.proconfig @> array['search_path=""']) = 4
     and not exists (select 1 from information_schema.routine_privileges r
                     where r.routine_schema = 'private'
                       and r.routine_name in ('guard_financial_settings_history', 'log_financial_setting_change', 'guard_financial_settings_delete', 'guard_payout_request')
                       and r.grantee in ('PUBLIC', 'public', 'anon', 'authenticated', 'service_role')),
     ''),

  ('payout guard has the 3 new rules and still has the old ones',
     (select p.prosrc like '%payout_requester_mismatch%' and p.prosrc like '%payout_review_trail_frozen%' and p.prosrc like '%payout_self_review%'
             and p.prosrc like '%payout_no_delete%' and p.prosrc like '%payout_must_start_requested%'
             and p.prosrc like '%payout_immutable_field%' and p.prosrc like '%payout_invalid_transition%'
        from pg_proc p where p.oid = 'private.guard_payout_request()'::regprocedure),
     ''),

  ('payout request guard trigger is still attached (insert + update + delete)',
     exists (select 1 from pg_trigger t where t.tgrelid = to_regclass('public.publisher_payout_requests') and t.tgname = 'publisher_payout_requests_guard' and not t.tgisinternal
               and (t.tgtype & 4) = 4 and (t.tgtype & 8) = 8 and (t.tgtype & 16) = 16),
     ''),

  ('ledger writers and balance helpers are NOT executable by any app role',
     not exists (select 1 from information_schema.routine_privileges r
                 where r.routine_schema = 'private'
                   and r.routine_name in ('ledger_append', 'ledger_reverse', 'ledger_record_serve', 'ledger_is_active_admin', 'publisher_payout_position')
                   and r.grantee in ('PUBLIC', 'public', 'anon', 'authenticated', 'service_role')),
     (select string_agg(r.routine_name || ':' || r.grantee, ', ') from information_schema.routine_privileges r
        where r.routine_schema = 'private' and r.routine_name in ('ledger_append', 'ledger_reverse', 'ledger_record_serve', 'ledger_is_active_admin', 'publisher_payout_position')
          and r.grantee in ('PUBLIC', 'public', 'anon', 'authenticated', 'service_role'))),

  ('admin ledger writers are service_role only (no anon / PUBLIC / authenticated)',
     exists (select 1 from information_schema.routine_privileges r where r.routine_schema = 'public' and r.routine_name = 'ledger_reverse_entry' and r.grantee = 'service_role')
     and exists (select 1 from information_schema.routine_privileges r where r.routine_schema = 'public' and r.routine_name = 'ledger_add_adjustment' and r.grantee = 'service_role')
     and not exists (select 1 from information_schema.routine_privileges r
                     where r.routine_schema = 'public' and r.routine_name in ('ledger_reverse_entry', 'ledger_add_adjustment', 'record_ad_serve')
                       and r.grantee in ('PUBLIC', 'public', 'anon', 'authenticated')),
     ''),

  ('publisher / admin payout functions are authenticated only (no anon / PUBLIC / service_role)',
     (select count(distinct r.routine_name) from information_schema.routine_privileges r
        where r.routine_schema = 'public' and r.grantee = 'authenticated'
          and r.routine_name in ('request_my_payout', 'admin_review_payout_request', 'admin_mark_payout_paid', 'get_my_payout_summary', 'get_my_payout_requests',
                                 'admin_list_payout_requests')) = 6
     and not exists (select 1 from information_schema.routine_privileges r
                     where r.routine_schema = 'public' and r.grantee in ('PUBLIC', 'public', 'anon', 'service_role')
                       and r.routine_name in ('request_my_payout', 'admin_review_payout_request', 'admin_mark_payout_paid', 'get_my_payout_summary', 'get_my_payout_requests',
                                              'admin_list_payout_requests')),
     ''),

  ('financial_ledger is untouched: append-only triggers still exist',
     (select count(*) from pg_trigger t where t.tgrelid = to_regclass('public.financial_ledger') and not t.tgisinternal
        and t.tgname in ('financial_ledger_guard', 'financial_ledger_no_truncate')) = 2,
     '')
)
select name, case when ok then 'PASS' else 'FAIL' end as status, got from checks order by name;

-- INFO (PASS/FAIL nahi): settings ka ab tak ka poora record.
--   select id, setting, change_kind, old_value, new_value, changed_by, db_role, changed_at from public.financial_settings_history order by id;
