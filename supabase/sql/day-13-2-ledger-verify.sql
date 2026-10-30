-- =====================================================================
-- BLISSCCO | Day 13 | Part 1 | READ-ONLY verify for day-13-1-financial-ledger.sql (sirf SELECT: kuch nahi badalta)
-- (Ye file kisi database par chalayi NAHI gayi hai. Day-13-1 chalane ke baad chalao; Expect: har row status = PASS.)
-- Pehle TEST project (denim), phir asli.
-- =====================================================================

with checks(name, ok, got) as (
  values
  ('table exists with RLS on and forced policies absent',
     (select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.financial_ledger')) is true
     and (select count(*) from pg_policy p where p.polrelid = to_regclass('public.financial_ledger')) = 0,
     (select count(*)::text from pg_policy p where p.polrelid = to_regclass('public.financial_ledger'))),

  ('no table grants for public / anon / authenticated / service_role',
     not exists (select 1 from information_schema.role_table_grants g
                 where g.table_schema = 'public' and g.table_name = 'financial_ledger' and g.grantee in ('PUBLIC', 'public', 'anon', 'authenticated', 'service_role')),
     (select count(*)::text from information_schema.role_table_grants g
       where g.table_schema = 'public' and g.table_name = 'financial_ledger' and g.grantee in ('PUBLIC', 'public', 'anon', 'authenticated', 'service_role'))),

  ('no sequence privileges for app roles',
     not exists (select 1 from pg_class s, aclexplode(coalesce(s.relacl, acldefault('S', s.relowner))) a
                 where s.oid = to_regclass('public.financial_ledger_id_seq')
                   and a.grantee in (0, (select oid from pg_roles where rolname = 'anon'), (select oid from pg_roles where rolname = 'authenticated'), (select oid from pg_roles where rolname = 'service_role'))),
     ''),

  ('guard trigger enabled for insert/update/delete',
     exists (select 1 from pg_trigger t where t.tgrelid = to_regclass('public.financial_ledger') and t.tgname = 'financial_ledger_guard' and t.tgenabled = 'O' and not t.tgisinternal),
     ''),
  ('truncate trigger enabled',
     exists (select 1 from pg_trigger t where t.tgrelid = to_regclass('public.financial_ledger') and t.tgname = 'financial_ledger_no_truncate' and t.tgenabled = 'O' and not t.tgisinternal),
     ''),

  ('money column is numeric(14,4), currency column is text with USD check',
     (select format_type(a.atttypid, a.atttypmod) from pg_attribute a where a.attrelid = to_regclass('public.financial_ledger') and a.attname = 'amount') = 'numeric(14,4)'
     and exists (select 1 from pg_constraint k where k.conrelid = to_regclass('public.financial_ledger') and k.conname = 'financial_ledger_currency_check'),
     (select format_type(a.atttypid, a.atttypmod) from pg_attribute a where a.attrelid = to_regclass('public.financial_ledger') and a.attname = 'amount')),

  ('all expected constraints exist',
     (select count(*) from pg_constraint k where k.conrelid = to_regclass('public.financial_ledger') and k.conname in (
        'financial_ledger_entry_id_key', 'financial_ledger_idempotency_key_key', 'financial_ledger_idempotency_format_check',
        'financial_ledger_type_check', 'financial_ledger_account_check', 'financial_ledger_currency_check', 'financial_ledger_amount_nonzero_check',
        'financial_ledger_amount_sign_check', 'financial_ledger_type_account_check', 'financial_ledger_party_check', 'financial_ledger_charge_campaign_check',
        'financial_ledger_source_type_check', 'financial_ledger_source_ref_check', 'financial_ledger_manual_entry_check', 'financial_ledger_reverses_check',
        'financial_ledger_reason_length_check')) = 16,
     (select count(*)::text from pg_constraint k where k.conrelid = to_regclass('public.financial_ledger') and k.contype = 'c')),

  ('foreign keys: advertiser, publisher, campaign, profile, self (reversal) are all RESTRICT',
     (select count(*) from pg_constraint k where k.conrelid = to_regclass('public.financial_ledger') and k.contype = 'f' and k.confdeltype = 'r') = 5,
     (select count(*)::text from pg_constraint k where k.conrelid = to_regclass('public.financial_ledger') and k.contype = 'f')),

  ('dedupe indexes exist (one entry per serve+type, one reversal per entry)',
     (select count(*) from pg_indexes i where i.schemaname = 'public' and i.tablename = 'financial_ledger'
        and i.indexname in ('financial_ledger_one_per_serve_type_key', 'financial_ledger_one_reversal_key')) = 2,
     ''),

  ('writers are security definer with empty search_path',
     (select count(*) from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname in ('ledger_append', 'ledger_reverse', 'guard_ledger_entry', 'guard_ledger_truncate')
        and p.prosecdef and p.proconfig @> array['search_path=""']) = 4,
     ''),

  ('no role (not even service_role) can EXECUTE the ledger functions',
     not exists (select 1 from information_schema.routine_privileges r
                 where r.routine_schema = 'private' and r.routine_name in ('ledger_append', 'ledger_reverse', 'guard_ledger_entry', 'guard_ledger_truncate')
                   and r.grantee in ('PUBLIC', 'public', 'anon', 'authenticated', 'service_role')),
     '')
)
select name, case when ok then 'PASS' else 'FAIL' end as status, got from checks order by name;

-- INFO (PASS/FAIL nahi): ledger abhi kharch se nahi bhara jaata, isliye ye dono alag ho sakte hain. Purana kharch ledger me NAHI daala gaya.
--   select (select coalesce(sum(amount), 0) from public.financial_ledger where entry_type = 'advertiser_charge') as ledger_charges,
--          (select coalesce(sum(spent), 0)  from public.campaign_spend_daily) as campaign_spend_daily_total;
