-- =====================================================================
-- BLISSCCO | Day 13 | Part 1 : financial ledger ke SQL tests (ROLLBACK-ONLY: kuch save nahi hota)
-- (Maine ye SQL kisi database par CHALAYA NAHI: sandbox me Postgres nahi hai aur is part me connected Supabase par SQL chalana mana tha.
--  Jab tak tum khud chalakar expected result na dekh lo, inhe "pass" mat maanna.)
--
-- SIRF TEST project (denim) par chalao. ASLI (blisscco ad network) par NAHI. Pehle day-13-1 chali ho.
-- Ye test apna data khud banata hai (auth user + advertiser + publisher + campaign) aur end me `rollback` karta hai.
-- Poori file EK saath chalao. Expect: status = PASS har row me. Beech me ERROR aaye toh pehle `rollback;` chalao.
-- =====================================================================

begin;
create temp table t13 (test text, passed boolean, got text);

-- Helper: ek statement chalao, EXPECT karo ki wo hint ke saath fail ho.
create function pg_temp.t13_fails(p_sql text, p_hint text) returns text language plpgsql as $fn$
declare h text;
begin
  execute p_sql;
  return 'NO ERROR';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(h, sqlstate);
end
$fn$;

do $do$
declare
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); up uuid := gen_random_uuid(); adm uuid := gen_random_uuid();
  adv_a uuid; adv_b uuid; pub uuid; camp_a uuid; camp_b uuid; cat text;
  ref1 text := 'bsr_' || repeat('a', 40);
  ref2 text := 'bsr_' || repeat('b', 40);
  r1 jsonb; r2 jsonb; r3 jsonb; rv jsonb; rv2 jsonb; n int; net numeric; eid bigint; got text; denied boolean;
begin
  select slug into cat from public.ad_categories limit 1;
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
    (ua,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'la_'  || ua  || '@example.test', '{"role":"advertiser"}', now(), now()),
    (ub,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lb_'  || ub  || '@example.test', '{"role":"advertiser"}', now(), now()),
    (up,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lp_'  || up  || '@example.test', '{"role":"publisher"}',  now(), now()),
    (adm, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lad_' || adm || '@example.test', '{"role":"advertiser"}', now(), now());
  insert into public.advertisers (profile_id, company_name, status) select ua, 'L Adv A', 'active' where not exists (select 1 from public.advertisers where profile_id = ua);
  insert into public.advertisers (profile_id, company_name, status) select ub, 'L Adv B', 'active' where not exists (select 1 from public.advertisers where profile_id = ub);
  select id into adv_a from public.advertisers where profile_id = ua;
  select id into adv_b from public.advertisers where profile_id = ub;
  insert into public.publishers (profile_id, name, status) values (up, 'L Pub', 'active');
  select id into pub from public.publishers where profile_id = up;
  insert into public.campaigns (advertiser_id, name, category, total_budget, start_date) values (adv_a, 'L Camp A', cat, 100, current_date) returning id into camp_a;
  insert into public.campaigns (advertiser_id, name, category, total_budget, start_date) values (adv_b, 'L Camp B', cat, 100, current_date) returning id into camp_b;

  -- T1: charge recorded, same key again = duplicate (no new row)
  r1 := private.ledger_append('advertiser_charge', 'advertiser', 0.0020, 'serve:' || ref1 || ':advertiser_charge', 'serve', ref1, adv_a, pub, camp_a);
  r2 := private.ledger_append('advertiser_charge', 'advertiser', 0.0020, 'serve:' || ref1 || ':advertiser_charge', 'serve', ref1, adv_a, pub, camp_a);
  select count(*) into n from public.financial_ledger where source_ref = ref1 and entry_type = 'advertiser_charge';
  insert into t13 values ('T1.1 first write = recorded', r1 ->> 'outcome' = 'recorded', r1::text);
  insert into t13 values ('T1.2 same key + same payload = duplicate, same row id', r2 ->> 'outcome' = 'duplicate' and r2 -> 'id' = r1 -> 'id', r2::text);
  insert into t13 values ('T1.3 exactly ONE ledger row for that serve + type', n = 1, n::text);

  -- T2: conflicts are loud, never silent
  got := pg_temp.t13_fails(format($q$select private.ledger_append('advertiser_charge','advertiser',0.0030,%L,'serve',%L,%L,%L,%L)$q$, 'serve:' || ref1 || ':advertiser_charge', ref1, adv_a, pub, camp_a), 'ledger_idempotency_conflict');
  insert into t13 values ('T2.1 same key, different amount = error', got = 'ledger_idempotency_conflict', got);
  got := pg_temp.t13_fails(format($q$select private.ledger_append('advertiser_charge','advertiser',0.0020,%L,'serve',%L,%L,%L,%L)$q$, 'other-key-for-same-serve', ref1, adv_a, pub, camp_a), 'ledger_idempotency_conflict');
  insert into t13 values ('T2.2 different key, same serve + type = error (no second charge)', got = 'ledger_idempotency_conflict', got);

  -- T3: earning / platform revenue take explicit amounts (no hardcoded share); distinct types for one serve are allowed
  r3 := private.ledger_append('publisher_earning', 'publisher', 0.0012, 'serve:' || ref1 || ':publisher_earning', 'serve', ref1, null, pub, camp_a);
  perform private.ledger_append('platform_revenue', 'platform', 0.0008, 'serve:' || ref1 || ':platform_revenue', 'serve', ref1, null, null, camp_a);
  select count(*) into n from public.financial_ledger where source_ref = ref1;
  insert into t13 values ('T3.1 one serve can hold charge + earning + platform_revenue (3 rows)', r3 ->> 'outcome' = 'recorded' and n = 3, n::text);

  -- T4: append-only (even for the owner running this test)
  got := pg_temp.t13_fails('update public.financial_ledger set amount = 99', 'ledger_append_only');
  insert into t13 values ('T4.1 UPDATE blocked', got = 'ledger_append_only', got);
  got := pg_temp.t13_fails('delete from public.financial_ledger', 'ledger_append_only');
  insert into t13 values ('T4.2 DELETE blocked', got = 'ledger_append_only', got);
  got := pg_temp.t13_fails('truncate public.financial_ledger', 'ledger_append_only');
  insert into t13 values ('T4.3 TRUNCATE blocked', got = 'ledger_append_only', got);

  -- T5: reversal
  select id into eid from public.financial_ledger where idempotency_key = 'serve:' || ref1 || ':advertiser_charge';
  rv  := private.ledger_reverse(eid, 'reverse-charge-1', 'Test reversal', ua);
  rv2 := private.ledger_reverse(eid, 'reverse-charge-1', 'Test reversal', ua);
  select coalesce(sum(amount), 0) into net from public.financial_ledger where campaign_id = camp_a and account = 'advertiser';
  insert into t13 values ('T5.1 reversal recorded', rv ->> 'outcome' = 'recorded', rv::text);
  insert into t13 values ('T5.2 same reversal again = duplicate', rv2 ->> 'outcome' = 'duplicate' and rv2 -> 'id' = rv -> 'id', rv2::text);
  insert into t13 values ('T5.3 advertiser balance nets to 0 after reversal; original row untouched',
    net = 0 and (select amount from public.financial_ledger where id = eid) = 0.0020, net::text);
  got := pg_temp.t13_fails(format($q$select private.ledger_reverse(%s, 'reverse-charge-2', 'Second try', %L)$q$, eid, ua), 'ledger_idempotency_conflict');
  insert into t13 values ('T5.4 second reversal of the same entry (new key) = error', got = 'ledger_idempotency_conflict', got);
  got := pg_temp.t13_fails(format($q$select private.ledger_reverse(%s, 'reverse-reversal-1', 'Reverse a reversal', %L)$q$, (rv ->> 'id')::bigint, ua), 'ledger_reversal_of_reversal');
  insert into t13 values ('T5.5 a reversal cannot be reversed', got = 'ledger_reversal_of_reversal', got);
  got := pg_temp.t13_fails(format($q$insert into public.financial_ledger (entry_type, account, amount, advertiser_id, campaign_id, source_type, idempotency_key, reverses_entry_id, reason, created_by)
      values ('reversal', 'advertiser', -0.0010, %L, %L, 'manual', 'bad-partial-reversal', %s, 'partial', %L)$q$, adv_a, camp_a, (select id from public.financial_ledger where idempotency_key = 'serve:' || ref1 || ':publisher_earning'), ua), 'ledger_reversal_mismatch');
  insert into t13 values ('T5.6 a hand-written reversal that does not exactly negate the original is refused', got in ('ledger_reversal_mismatch', '23514'), got);

  -- T6: adjustment needs a person + reason; both signs allowed; zero is not
  perform private.ledger_append('adjustment', 'advertiser', -0.5000, 'adjust-credit-0001', 'manual', null, adv_a, null, camp_a, 'Goodwill credit', ua);
  perform private.ledger_append('adjustment', 'platform', 0.2500, 'adjust-plat-0001', 'manual', null, null, null, null, 'Manual correction', ua);
  insert into t13 values ('T6.1 signed adjustments (negative and positive) recorded', (select count(*) from public.financial_ledger where entry_type = 'adjustment') = 2, '');
  got := pg_temp.t13_fails(format($q$select private.ledger_append('adjustment','advertiser',1.0000,'adjust-noreason-1','manual',null,%L,null,null,null,null)$q$, adv_a), 'x');
  insert into t13 values ('T6.2 adjustment without reason / created_by refused', got <> 'NO ERROR', got);
  got := pg_temp.t13_fails(format($q$select private.ledger_append('adjustment','advertiser',0,'adjust-zero-0001','manual',null,%L,null,null,'Zero',%L)$q$, adv_a, ua), 'x');
  insert into t13 values ('T6.3 zero amount refused', got <> 'NO ERROR', got);

  -- T7: constraint walls
  got := pg_temp.t13_fails(format($q$select private.ledger_append('advertiser_charge','advertiser',-1,'neg-charge-0001','serve',%L,%L,%L,%L)$q$, ref2, adv_a, pub, camp_a), 'x');
  insert into t13 values ('T7.1 negative charge refused', got <> 'NO ERROR', got);
  got := pg_temp.t13_fails(format($q$select private.ledger_append('advertiser_charge','advertiser',1,'eur-charge-0001','serve',%L,%L,%L,%L,null,null,'EUR')$q$, ref2, adv_a, pub, camp_a), 'x');
  insert into t13 values ('T7.2 non-USD currency refused (project convention)', got <> 'NO ERROR', got);
  got := pg_temp.t13_fails(format($q$select private.ledger_append('advertiser_charge','advertiser',1,'mismatch-0001','serve',%L,%L,%L,%L)$q$, ref2, adv_a, pub, camp_b), 'ledger_campaign_advertiser_mismatch');
  insert into t13 values ('T7.3 campaign of another advertiser refused', got = 'ledger_campaign_advertiser_mismatch', got);
  got := pg_temp.t13_fails(format($q$select private.ledger_append('advertiser_charge','publisher',1,'wrongacct-0001','serve',%L,%L,%L,%L)$q$, ref2, adv_a, pub, camp_a), 'x');
  insert into t13 values ('T7.4 charge on a non-advertiser account refused', got <> 'NO ERROR', got);
  got := pg_temp.t13_fails(format($q$select private.ledger_append('advertiser_charge','advertiser',1,'badref-00001','serve','not-a-ref',%L,%L,%L)$q$, adv_a, pub, camp_a), 'x');
  insert into t13 values ('T7.5 serve entry with a malformed source reference refused', got <> 'NO ERROR', got);
  got := pg_temp.t13_fails($q$select private.ledger_append('advertiser_charge','advertiser',1,'nocamp-00001','manual')$q$, 'x');
  insert into t13 values ('T7.6 manual charge / missing party refused', got <> 'NO ERROR', got);

  -- T8: restrictive permissions
  denied := false; set local role service_role;
  begin perform count(*) from public.financial_ledger; exception when insufficient_privilege then denied := true; end; reset role;
  insert into t13 values ('T8.1 service_role cannot read the table', denied, denied::text);
  denied := false; set local role authenticated;
  begin perform count(*) from public.financial_ledger; exception when insufficient_privilege then denied := true; end; reset role;
  insert into t13 values ('T8.2 authenticated cannot read the table', denied, denied::text);
  denied := false; set local role anon;
  begin perform count(*) from public.financial_ledger; exception when insufficient_privilege then denied := true; end; reset role;
  insert into t13 values ('T8.3 anon cannot read the table', denied, denied::text);
  denied := false; set local role service_role;
  begin perform private.ledger_append('platform_revenue', 'platform', 1, 'svc-role-0001', 'manual'); exception when insufficient_privilege then denied := true; end; reset role;
  insert into t13 values ('T8.4 service_role cannot call the ledger writer directly', denied, denied::text);
end
$do$;

select test, case when passed then 'PASS' else 'FAIL' end as status, got from t13 order by test;
rollback;
