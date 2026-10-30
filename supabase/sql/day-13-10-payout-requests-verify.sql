-- =====================================================================
-- BLISSCCO | Day 13 | Part 4 | READ-ONLY verify for day-13-9-payout-requests.sql (sirf SELECT: kuch nahi badalta)
-- (Ye file kisi database par chalayi NAHI gayi hai.) Day-13-9 chalane ke baad chalao; Expect: har row status = PASS.
-- Pehle TEST project (denim), phir asli (blisscco ad network) -- asli par sirf ye verify, rollback-only tests (day-13-11) nahi.
-- =====================================================================

with checks(name, ok, got) as (
  values

  ('both payout tables exist with RLS on, no policy, and no grant to any app role',
     (select count(*) from pg_class c where c.oid in (to_regclass('public.publisher_payout_requests'), to_regclass('public.publisher_payout_events')) and c.relrowsecurity) = 2
     and (select count(*) from pg_policy p where p.polrelid in (to_regclass('public.publisher_payout_requests'), to_regclass('public.publisher_payout_events'))) = 0
     and not exists (select 1 from information_schema.role_table_grants g
                     where g.table_schema = 'public' and g.table_name in ('publisher_payout_requests', 'publisher_payout_events')
                       and g.grantee in ('PUBLIC', 'public', 'anon', 'authenticated', 'service_role')),
     ''),

  ('requests table has NO bank / card / UPI / account / provider column',
     not exists (select 1 from information_schema.columns c
                 where c.table_schema = 'public' and c.table_name in ('publisher_payout_requests', 'publisher_payout_events')
                   and c.column_name ~* '(bank|card|upi|ifsc|iban|swift|cvv|account_no|account_number|routing|provider|stripe|razorpay|paypal|vpa)'),
     (select string_agg(c.column_name, ', ') from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'publisher_payout_requests')),

  ('status is limited to requested / approved / rejected / paid by a CHECK',
     exists (select 1 from pg_constraint k where k.conrelid = to_regclass('public.publisher_payout_requests') and k.conname = 'publisher_payout_status_check'
               and pg_get_constraintdef(k.oid) like '%requested%' and pg_get_constraintdef(k.oid) like '%approved%'
               and pg_get_constraintdef(k.oid) like '%rejected%' and pg_get_constraintdef(k.oid) like '%paid%'),
     ''),

  ('amount must be > 0 and currency must be USD (CHECKs)',
     exists (select 1 from pg_constraint k where k.conrelid = to_regclass('public.publisher_payout_requests') and k.conname = 'publisher_payout_amount_check')
     and exists (select 1 from pg_constraint k where k.conrelid = to_regclass('public.publisher_payout_requests') and k.conname = 'publisher_payout_currency_check'),
     ''),

  ('only ONE open (requested / approved) request per publisher: partial unique index exists',
     exists (select 1 from pg_indexes i where i.schemaname = 'public' and i.indexname = 'publisher_payout_one_open_key'
               and i.indexdef like '%UNIQUE%' and i.indexdef like '%(publisher_id)%' and i.indexdef like '%requested%' and i.indexdef like '%approved%'),
     ''),

  ('(publisher_id, request_key) is unique (retry-safe)',
     exists (select 1 from pg_constraint k where k.conrelid = to_regclass('public.publisher_payout_requests') and k.conname = 'publisher_payout_requests_key_key' and k.contype = 'u'),
     ''),

  ('guard + audit + truncate triggers exist on the requests table',
     (select count(*) from pg_trigger t where t.tgrelid = to_regclass('public.publisher_payout_requests') and not t.tgisinternal
        and t.tgname in ('publisher_payout_requests_guard', 'publisher_payout_requests_audit', 'publisher_payout_requests_no_truncate', 'publisher_payout_requests_set_updated_at')) = 4,
     ''),

  ('audit table is append-only: update / delete / truncate triggers exist',
     (select count(*) from pg_trigger t where t.tgrelid = to_regclass('public.publisher_payout_events') and not t.tgisinternal
        and t.tgname in ('publisher_payout_events_guard', 'publisher_payout_events_no_truncate')) = 2,
     ''),

  ('private payout functions are security definer, empty search_path, and no app role can EXECUTE them',
     (select count(*) from pg_proc p where p.pronamespace = 'private'::regnamespace
        and p.proname in ('guard_payout_request', 'guard_payout_event', 'guard_payout_request_truncate', 'audit_payout_request', 'publisher_payout_position')
        and p.prosecdef and p.proconfig @> array['search_path=""']) = 5
     and not exists (select 1 from information_schema.routine_privileges r
                     where r.routine_schema = 'private'
                       and r.routine_name in ('guard_payout_request', 'guard_payout_event', 'guard_payout_request_truncate', 'audit_payout_request', 'publisher_payout_position')
                       and r.grantee in ('PUBLIC', 'public', 'anon', 'authenticated', 'service_role')),
     ''),

  ('the 5 public payout functions exist, security definer, empty search_path',
     (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname in ('request_my_payout', 'admin_review_payout_request', 'admin_mark_payout_paid', 'get_my_payout_summary', 'get_my_payout_requests', 'admin_list_payout_requests')
        and p.prosecdef and p.proconfig @> array['search_path=""']) = 6,
     ''),

  ('public payout functions: EXECUTE for authenticated only (not public / anon / service_role)',
     (select count(distinct r.routine_name) from information_schema.routine_privileges r
        where r.routine_schema = 'public' and r.grantee = 'authenticated'
          and r.routine_name in ('request_my_payout', 'admin_review_payout_request', 'admin_mark_payout_paid', 'get_my_payout_summary', 'get_my_payout_requests', 'admin_list_payout_requests')) = 6
     and not exists (select 1 from information_schema.routine_privileges r
                     where r.routine_schema = 'public'
                       and r.routine_name in ('request_my_payout', 'admin_review_payout_request', 'admin_mark_payout_paid', 'get_my_payout_summary', 'get_my_payout_requests', 'admin_list_payout_requests')
                       and r.grantee in ('PUBLIC', 'public', 'anon', 'service_role')),
     ''),

  ('admin functions check private.is_admin() and raise 42501',
     (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname in ('admin_review_payout_request', 'admin_mark_payout_paid')
        and p.prosrc like '%private.is_admin()%' and p.prosrc like '%42501%') = 2
     and (select p.prosrc like '%private.is_admin()%' from pg_proc p where p.oid = 'public.admin_list_payout_requests(integer)'::regprocedure),
     ''),

  ('request_my_payout takes no publisher id and uses auth.uid() and the publisher row lock',
     (select pg_get_function_arguments(p.oid) = 'p_amount numeric, p_request_key uuid'
             and p.prosrc like '%auth.uid()%' and p.prosrc like '%for no key update of p%'
        from pg_proc p where p.oid = 'public.request_my_payout(numeric, uuid)'::regprocedure),
     ''),

  ('payout functions never write the ledger and never call a provider',
     (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname in ('request_my_payout', 'admin_review_payout_request', 'admin_mark_payout_paid')
        and (p.prosrc ilike '%financial_ledger%' or p.prosrc ilike '%ledger_append%' or p.prosrc ilike '%http%')) = 0,
     ''),

  ('financial_ledger is untouched: still only the 5 original entry types',
     exists (select 1 from pg_constraint k where k.conrelid = to_regclass('public.financial_ledger') and k.conname = 'financial_ledger_type_check'
               and pg_get_constraintdef(k.oid) not ilike '%payout%'),
     '')
)
select name, case when ok then 'PASS' else 'FAIL' end as status, got from checks order by name;

-- INFO (PASS/FAIL nahi): kitne payout requests kis status me hain (migration ke turant baad sab 0 hone chahiye).
--   select status, count(*) from public.publisher_payout_requests group by status order by status;
