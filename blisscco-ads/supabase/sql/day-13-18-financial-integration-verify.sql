-- =====================================================================
-- BLISSCCO | Day 14 | Part 2 | READ-ONLY verify for day-13-15-financial-integration.sql (sirf SELECT: kuch nahi badalta)
-- (Ye file kisi database par chalayi NAHI gayi hai.) day-13-15 chalane ke baad chalao; Expect: har row status = PASS.
-- Test (denim) aur asli (blisscco ad network) DONO par chala sakte ho.
--
-- Kyun zaroori: day-13-15 ka publishers-row lock sirf function body me hai. Agar baad me day-13-4 dobara chala diya gaya (wo ye dono functions purane,
-- bina-lock version me wapas rakh deta hai), toh koi aur verify use nahi pakadta. Ye file wahi regression pakadti hai.
-- Fix agar FAIL: day-13-15-financial-integration.sql dobara chalao (rerun-safe), phir ye verify.
-- =====================================================================

with checks(name, ok, got) as (
  values

  ('ledger_reverse_entry and ledger_add_adjustment exist with the expected signatures',
     to_regprocedure('public.ledger_reverse_entry(uuid, bigint, text, text)') is not null
     and to_regprocedure('public.ledger_add_adjustment(uuid, text, numeric, text, text, uuid, uuid, uuid)') is not null,
     ''),

  ('both are security definer with an empty search_path',
     (select bool_and(p.prosecdef) and bool_and(coalesce('search_path=""' = any(p.proconfig), false)) and count(*) = 2
        from pg_proc p
       where p.oid in (to_regprocedure('public.ledger_reverse_entry(uuid, bigint, text, text)'),
                       to_regprocedure('public.ledger_add_adjustment(uuid, text, numeric, text, text, uuid, uuid, uuid)'))),
     ''),

  ('ledger_reverse_entry takes the publishers-row lock (for no key update) BEFORE calling private.ledger_reverse',
     (select position('for no key update' in p.prosrc) > 0
         and position('for no key update' in p.prosrc) < position('private.ledger_reverse(' in p.prosrc)
        from pg_proc p where p.oid = to_regprocedure('public.ledger_reverse_entry(uuid, bigint, text, text)')),
     'if FAIL: day-13-4 was re-run after day-13-15; run day-13-15 again'),

  ('ledger_add_adjustment takes the publishers-row lock (for no key update) BEFORE calling private.ledger_append',
     (select position('for no key update' in p.prosrc) > 0
         and position('for no key update' in p.prosrc) < position('private.ledger_append(' in p.prosrc)
        from pg_proc p where p.oid = to_regprocedure('public.ledger_add_adjustment(uuid, text, numeric, text, text, uuid, uuid, uuid)')),
     'if FAIL: day-13-4 was re-run after day-13-15; run day-13-15 again'),

  ('both still require an active admin actor (forbidden otherwise)',
     (select count(*) = 2 and bool_and(p.prosrc like '%private.ledger_is_active_admin(p_actor)%' and p.prosrc like '%forbidden%')
        from pg_proc p
       where p.oid in (to_regprocedure('public.ledger_reverse_entry(uuid, bigint, text, text)'),
                       to_regprocedure('public.ledger_add_adjustment(uuid, text, numeric, text, text, uuid, uuid, uuid)'))),
     ''),

  ('neither function touches campaign_spend_daily / creative_serve_daily (reversal / adjustment never change budget)',
     (select count(*) = 2 and bool_and(p.prosrc not like '%campaign_spend_daily%' and p.prosrc not like '%creative_serve_daily%')
        from pg_proc p
       where p.oid in (to_regprocedure('public.ledger_reverse_entry(uuid, bigint, text, text)'),
                       to_regprocedure('public.ledger_add_adjustment(uuid, text, numeric, text, text, uuid, uuid, uuid)'))),
     ''),

  ('execute: service_role only (no PUBLIC / anon / authenticated)',
     exists (select 1 from information_schema.routine_privileges r where r.routine_schema = 'public' and r.routine_name = 'ledger_reverse_entry' and r.grantee = 'service_role')
     and exists (select 1 from information_schema.routine_privileges r where r.routine_schema = 'public' and r.routine_name = 'ledger_add_adjustment' and r.grantee = 'service_role')
     and not exists (select 1 from information_schema.routine_privileges r
                     where r.routine_schema = 'public' and r.routine_name in ('ledger_reverse_entry', 'ledger_add_adjustment')
                       and r.grantee in ('PUBLIC', 'public', 'anon', 'authenticated')),
     ''),

  ('the payout functions still lock the same publishers row (for no key update of p)',
     (select count(*) = 3 and bool_and(p.prosrc like '%for no key update of p%')
        from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname in ('request_my_payout', 'admin_review_payout_request', 'admin_mark_payout_paid')),
     '')
)
select name, case when coalesce(ok, false) then 'PASS' else 'FAIL' end as status, got from checks order by name;
