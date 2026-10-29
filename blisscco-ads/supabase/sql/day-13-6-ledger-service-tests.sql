-- =====================================================================
-- BLISSCCO | Day 13 | Part 2 : ledger service ke SQL tests (ROLLBACK-ONLY: kuch save nahi hota)
-- (Maine ye SQL kisi database par CHALAYA NAHI: sandbox me Postgres nahi hai. Jab tak tum khud chalakar expected result na dekh lo, inhe \"pass\" mat maanna.)
--
-- SIRF TEST project (denim) par chalao. ASLI (blisscco ad network) par NAHI.
-- Pehle: day-13-1 aur day-13-4 chali ho. Ab day-3-6 ka SETUP block ZAROORI NAHI: ye file apne TEST fixtures (advertiser, publisher, campaign A, creative A) khud isi transaction ke andar banati hai, end me rollback => kuch save nahi hota.
-- Poori file EK saath chalao. Ye ledger_settings, CPM, test trigger sab transaction ke andar badalta hai aur end me `rollback` karta hai.
-- Expect: status = PASS har row me. Beech me ERROR aaye toh pehle `rollback;` chalao.
-- Kya jaanchta hai: ledger default me band | charge = wahi amount jo spend me gayi | retry par dobara charge / entry nahi | batwara (rounding) |
--   ledger fail => serve ka spend + log bhi rollback | invalid amounts | reversal / adjustment | reversal budget nahi chhuta | permissions.
-- =====================================================================

begin;
create temp table t13b (test text, passed boolean, got text);

create function pg_temp.t13b_fails(p_sql text, p_hint text) returns text language plpgsql as $fn$
declare h text;
begin
  execute p_sql;
  return 'NO ERROR';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(h, sqlstate);
end
$fn$;

-- Failure injection: platform_revenue ki row par error (sirf is transaction me; rollback se saaf).
create function public.t13b_boom() returns trigger language plpgsql as $fn$
begin
  raise exception 't13b injected ledger failure' using errcode = 'P0001', hint = 't13b_boom';
end
$fn$;

do $do$
declare
  v_pub uuid; v_key text; v_hash text; v_cid uuid; v_camp uuid; v_adv uuid;
  v_r jsonb; v_r2 jsonb; v_ref text;
  s0 numeric; s1 numeric; l0 int; l1 int; lg0 int; lg1 int; n int; x numeric;
  got text; ok boolean;
  v_admin uuid := gen_random_uuid(); v_plain uuid := gen_random_uuid();
  v_fa uuid := gen_random_uuid(); v_fp uuid := gen_random_uuid();
  v_eid bigint; v_rv jsonb; v_rv2 jsonb; v_ad jsonb; v_ad2 jsonb;
  o1 jsonb; o3 text; o4 text; o5 text; o6 text; o7 text; o8 text; o9 text; o10 text; o11 text; o12 text;
begin
  -- ---------- self-contained fixtures (sirf is transaction me; rollback se saaf) ----------
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
    (v_fa, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lfa_' || v_fa || '@example.test', '{"role":"advertiser"}', now(), now()),
    (v_fp, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lfp_' || v_fp || '@example.test', '{"role":"advertiser"}', now(), now());
  delete from public.advertisers where profile_id = v_fp;
  update public.profiles set role = 'publisher' where id = v_fp;
  insert into public.advertisers (profile_id, company_name, status) values (v_fa, 'TEST Advertiser A', 'active')
    on conflict (profile_id) do update set company_name = excluded.company_name, status = 'active';
  insert into public.publishers (profile_id, name, status) values (v_fp, 'TEST Publisher C', 'active');
  insert into public.campaigns (advertiser_id, name, category, total_budget, start_date)
    select id, 'TEST Campaign A', 'gaming', 100, current_date from public.advertisers where profile_id = v_fa;
  insert into public.ad_creatives (campaign_id, headline, body, destination_url)
    select id, 'TEST creative A', 'Test body', 'https://example.com' from public.campaigns where name = 'TEST Campaign A';

  -- ---------- fixtures (day-9-6 jaisa) ----------
  select id into v_pub from public.publishers where name = 'TEST Publisher C';
  v_key  := private.issue_publisher_key(v_pub);
  v_hash := encode(sha256(convert_to(v_key, 'UTF8')), 'hex');
  update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null, daily_budget = null, total_budget = 100 where name = 'TEST Campaign A';
  update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
  select id into v_cid from public.ad_creatives where headline = 'TEST creative A';
  select c.id, c.advertiser_id into v_camp, v_adv from public.campaigns c where c.name = 'TEST Campaign A';
  delete from public.campaign_spend_daily where campaign_id = v_camp;
  update public.ad_platform_settings set cpm_usd = 2 where id;
  update public.ledger_settings set ledger_enabled = false, publisher_share_bps = null where id;

  -- ---------- T1: ledger default band => serve pehle jaisa, ledger khali ----------
  select coalesce(sum(spent), 0) into s0 from public.campaign_spend_daily where campaign_id = v_camp;
  set local role service_role; v_r := public.record_ad_serve(v_hash, v_cid, 'gaming'); reset role;
  select coalesce(sum(spent), 0) into s1 from public.campaign_spend_daily where campaign_id = v_camp;
  select count(*) into n from public.financial_ledger where campaign_id = v_camp;
  insert into t13b values ('T1.1 ledger off (default): serve ok, spend = exactly one unit, ledger stays empty', v_r ->> 'outcome' = 'ok' and s1 - s0 = 0.0020 and n = 0, v_r::text || ' spend+' || (s1 - s0)::text || ' ledger_rows=' || n);

  -- ---------- T2: ledger ON, batwara tay nahi => sirf advertiser_charge, amount = spend ki amount ----------
  update public.ledger_settings set ledger_enabled = true, publisher_share_bps = null where id;
  s0 := s1;
  set local role service_role; v_r := public.record_ad_serve(v_hash, v_cid, 'gaming'); reset role;
  select coalesce(sum(spent), 0) into s1 from public.campaign_spend_daily where campaign_id = v_camp;
  v_ref := v_r ->> 'serve_ref';
  select count(*), coalesce(sum(amount), 0) into n, x from public.financial_ledger where source_ref = v_ref;
  insert into t13b values ('T2.1 ledger on, no share set: exactly ONE row (advertiser_charge) for the serve', n = 1 and (select entry_type from public.financial_ledger where source_ref = v_ref) = 'advertiser_charge', n::text);
  insert into t13b values ('T2.2 ledger charge = the amount spend was increased by (same billing basis, budget deducted once)', x = s1 - s0 and x = 0.0020, 'ledger ' || x::text || ' spend+' || (s1 - s0)::text);
  select id into v_eid from public.financial_ledger where source_ref = v_ref;

  -- ---------- T3: retry (wahi Idempotency-Key) => dobara charge nahi, dobara ledger entry nahi ----------
  select coalesce(sum(spent), 0) into s0 from public.campaign_spend_daily where campaign_id = v_camp;
  select count(*) into lg0 from public.financial_ledger where campaign_id = v_camp;
  set local role service_role;
  v_r  := public.record_ad_serve(v_hash, v_cid, 'gaming', 'ledger-retry-0001');
  v_r2 := public.record_ad_serve(v_hash, v_cid, 'gaming', 'ledger-retry-0001');
  reset role;
  select coalesce(sum(spent), 0) into s1 from public.campaign_spend_daily where campaign_id = v_camp;
  select count(*) into lg1 from public.financial_ledger where campaign_id = v_camp;
  insert into t13b values ('T3.1 first call charges once (spend +0.0020) and writes one ledger row', v_r ->> 'outcome' = 'ok' and v_r2 ->> 'outcome' = 'ok', v_r::text);
  insert into t13b values ('T3.2 retry with the same key: replayed, spend charged ONCE in total, ledger gained ONE row in total', (v_r2 ->> 'replayed') = 'true' and s1 - s0 = 0.0020 and lg1 - lg0 = 1, 'spend+' || (s1 - s0)::text || ' ledger+' || (lg1 - lg0)::text);

  -- ---------- T4: batwara 7000 bps (sirf TEST) => 0.0020 = 0.0014 + 0.0006 ----------
  update public.ledger_settings set publisher_share_bps = 7000 where id;
  set local role service_role; v_r := public.record_ad_serve(v_hash, v_cid, 'gaming'); reset role;
  v_ref := v_r ->> 'serve_ref';
  select count(*) into n from public.financial_ledger where source_ref = v_ref;
  insert into t13b values ('T4.1 share 7000 bps: three rows (charge + earning + platform_revenue)', n = 3, n::text);
  insert into t13b values ('T4.2 charge 0.0020 -> earning 0.0014, platform 0.0006 (sum = charge exactly)',
    (select amount from public.financial_ledger where source_ref = v_ref and entry_type = 'advertiser_charge') = 0.0020
    and (select amount from public.financial_ledger where source_ref = v_ref and entry_type = 'publisher_earning') = 0.0014
    and (select amount from public.financial_ledger where source_ref = v_ref and entry_type = 'platform_revenue') = 0.0006, '');

  -- ---------- T5: rounding (CPM 2.5555 => unit 0.0026; 70% = 0.00182 -> neeche 0.0018; platform 0.0008) ----------
  update public.ad_platform_settings set cpm_usd = 2.5555 where id;
  set local role service_role; v_r := public.record_ad_serve(v_hash, v_cid, 'gaming'); reset role;
  v_ref := v_r ->> 'serve_ref';
  insert into t13b values ('T5.1 rounding: unit 0.0026 (half-up), earning truncated to 0.0018, platform keeps the rest 0.0008, sum = charge',
    (select amount from public.financial_ledger where source_ref = v_ref and entry_type = 'advertiser_charge') = 0.0026
    and (select amount from public.financial_ledger where source_ref = v_ref and entry_type = 'publisher_earning') = 0.0018
    and (select amount from public.financial_ledger where source_ref = v_ref and entry_type = 'platform_revenue') = 0.0008, '');

  -- ---------- T6: bahut chhota charge => 0 wali entry nahi banti ----------
  update public.ad_platform_settings set cpm_usd = 0.1 where id;
  update public.ledger_settings set publisher_share_bps = 100 where id;
  set local role service_role; v_r := public.record_ad_serve(v_hash, v_cid, 'gaming'); reset role;
  v_ref := v_r ->> 'serve_ref';
  insert into t13b values ('T6.1 charge 0.0001 at 1%: no zero earning row; platform gets the whole 0.0001',
    (select count(*) from public.financial_ledger where source_ref = v_ref) = 2
    and not exists (select 1 from public.financial_ledger where source_ref = v_ref and entry_type = 'publisher_earning')
    and (select amount from public.financial_ledger where source_ref = v_ref and entry_type = 'platform_revenue') = 0.0001, '');

  -- ---------- T7: 100% batwara => platform_revenue nahi ----------
  update public.ledger_settings set publisher_share_bps = 10000 where id;
  set local role service_role; v_r := public.record_ad_serve(v_hash, v_cid, 'gaming'); reset role;
  v_ref := v_r ->> 'serve_ref';
  insert into t13b values ('T7.1 share 10000 bps: earning = charge, no platform_revenue row',
    (select count(*) from public.financial_ledger where source_ref = v_ref) = 2
    and (select amount from public.financial_ledger where source_ref = v_ref and entry_type = 'publisher_earning') = 0.0001
    and not exists (select 1 from public.financial_ledger where source_ref = v_ref and entry_type = 'platform_revenue'), '');

  -- ---------- T8: ledger fail => serve ka spend + log + counter sab rollback (aadha kuch nahi) ----------
  update public.ad_platform_settings set cpm_usd = 2 where id;
  update public.ledger_settings set publisher_share_bps = 7000 where id;
  create trigger zz_t13b_boom before insert on public.financial_ledger for each row when (new.entry_type = 'platform_revenue') execute function public.t13b_boom();
  select coalesce(sum(spent), 0) into s0 from public.campaign_spend_daily where campaign_id = v_camp;
  select count(*) into l0 from public.ad_serve_log where creative_id = v_cid;
  select count(*) into lg0 from public.financial_ledger;
  select coalesce(sum(serves), 0) into x from public.creative_serve_daily where creative_id = v_cid;
  got := 'NO ERROR';
  begin
    set local role service_role;
    perform public.record_ad_serve(v_hash, v_cid, 'gaming');
  exception when others then
    get stacked diagnostics got = pg_exception_hint;
  end;
  reset role;
  drop trigger zz_t13b_boom on public.financial_ledger;
  select coalesce(sum(spent), 0) into s1 from public.campaign_spend_daily where campaign_id = v_camp;
  select count(*) into l1 from public.ad_serve_log where creative_id = v_cid;
  select count(*) into lg1 from public.financial_ledger;
  insert into t13b values ('T8.1 injected ledger failure surfaces as an error', got = 't13b_boom', got);
  insert into t13b values ('T8.2 nothing partial: spend, serve log, daily counter and ledger (even the charge row written before the failure) are all unchanged',
    s1 = s0 and l1 = l0 and lg1 = lg0 and (select coalesce(sum(serves), 0) from public.creative_serve_daily where creative_id = v_cid) = x,
    'spend ' || s0::text || '->' || s1::text || ' log ' || l0 || '->' || l1 || ' ledger ' || lg0 || '->' || lg1);

  -- ---------- T9: invalid amounts (writer seedha, postgres ke roop me) ----------
  got := pg_temp.t13b_fails(format($q$select private.ledger_append('adjustment','platform',0.00005,'inv-5dec-0001','manual',null,null,null,null,'Five decimals',%L)$q$, v_admin), 'ledger_invalid_amount');
  insert into t13b values ('T9.1 5 decimals refused (never silently rounded)', got = 'ledger_invalid_amount', got);
  got := pg_temp.t13b_fails($q$select private.ledger_append('platform_revenue','platform',null,'inv-null-0001','manual')$q$, 'ledger_invalid_amount');
  insert into t13b values ('T9.2 NULL amount refused', got = 'ledger_invalid_amount', got);
  got := pg_temp.t13b_fails($q$select private.ledger_append('platform_revenue','platform',10000000000,'inv-big-00001','manual')$q$, 'ledger_invalid_amount');
  insert into t13b values ('T9.3 amount beyond numeric(14,4) refused with a clear code', got = 'ledger_invalid_amount', got);
  got := pg_temp.t13b_fails($q$select private.ledger_append('platform_revenue','platform',0,'inv-zero-0001','manual')$q$, 'x');
  insert into t13b values ('T9.4 zero amount refused', got <> 'NO ERROR', got);

  -- ---------- T10: admin reversal / adjustment ----------
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ladm_' || v_admin || '@example.test', '{"role":"advertiser"}', now(), now()),
    (v_plain, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lpl_'  || v_plain || '@example.test', '{"role":"advertiser"}', now(), now());
  delete from public.advertisers where profile_id = v_admin; -- signup par auto-bani advertiser row role badalne se rokti hai (day-3-6 jaisa)
  update public.profiles set role = 'admin' where id = v_admin;

  select coalesce(sum(spent), 0) into s0 from public.campaign_spend_daily where campaign_id = v_camp;
  -- Role badalne par temp table t13b me likh nahi sakte: pehle sab jawab variables me, reset role ke baad table me.
  set local role service_role;
  o1 := public.ledger_reverse_entry(v_plain, v_eid, 'rev-nonadmin-0001', 'Not allowed');
  v_rv  := public.ledger_reverse_entry(v_admin, v_eid, 'rev-charge-0001', 'Test reversal');
  v_rv2 := public.ledger_reverse_entry(v_admin, v_eid, 'rev-charge-0001', 'Test reversal');
  o3 := public.ledger_reverse_entry(v_admin, v_eid, 'rev-charge-0002', 'Second try') ->> 'outcome';
  o4 := public.ledger_reverse_entry(v_admin, (v_rv ->> 'id')::bigint, 'rev-of-rev-0001', 'Reverse a reversal') ->> 'outcome';
  o5 := public.ledger_reverse_entry(v_admin, 999999999, 'rev-missing-0001', 'No such entry') ->> 'outcome';
  o6 := public.ledger_reverse_entry(v_admin, v_eid, 'bad key', 'Test reversal') ->> 'outcome';
  o7 := public.ledger_reverse_entry(v_admin, v_eid, 'rev-short-0001', 'x') ->> 'outcome';
  v_ad  := public.ledger_add_adjustment(v_admin, 'advertiser', -0.5, 'adj-credit-0001', 'Goodwill credit', v_adv, null, v_camp);
  v_ad2 := public.ledger_add_adjustment(v_admin, 'advertiser', -0.5, 'adj-credit-0001', 'Goodwill credit', v_adv, null, v_camp);
  o8  := public.ledger_add_adjustment(v_admin, 'advertiser', -0.6, 'adj-credit-0001', 'Goodwill credit', v_adv, null, v_camp) ->> 'outcome';
  o9  := public.ledger_add_adjustment(v_admin, 'platform', 0.00005, 'adj-5dec-0001', 'Five decimals') ->> 'outcome';
  o10 := public.ledger_add_adjustment(v_admin, 'platform', 0, 'adj-zero-0001', 'Zero amount') ->> 'outcome';
  o11 := public.ledger_add_adjustment(v_plain, 'platform', 1, 'adj-nonadm-0001', 'Not allowed') ->> 'outcome';
  o12 := public.ledger_add_adjustment(v_admin, 'advertiser', 1, 'adj-noparty-0001', 'Missing party') ->> 'outcome';
  reset role;
  select coalesce(sum(spent), 0) into s1 from public.campaign_spend_daily where campaign_id = v_camp;

  insert into t13b values ('T10.1 reversal by a non-admin actor is forbidden', o1 ->> 'outcome' = 'forbidden', o1::text);
  insert into t13b values ('T10.2 admin reversal recorded; same request again = duplicate, same row', v_rv ->> 'outcome' = 'recorded' and v_rv2 ->> 'outcome' = 'duplicate' and v_rv2 -> 'id' = v_rv -> 'id', v_rv::text || ' / ' || v_rv2::text);
  insert into t13b values ('T10.3 a second reversal of the same entry with a NEW key = conflict', o3 = 'conflict', o3);
  insert into t13b values ('T10.4 a reversal cannot be reversed', o4 = 'rejected', o4);
  insert into t13b values ('T10.5 unknown entry id = not_found', o5 = 'not_found', o5);
  insert into t13b values ('T10.6 bad key / short reason = invalid', o6 = 'invalid' and o7 = 'invalid', o6 || ' / ' || o7);
  insert into t13b values ('T10.7 charge + reversal nets to 0 and the original row is untouched',
    (select coalesce(sum(amount), 0) from public.financial_ledger where id = v_eid or reverses_entry_id = v_eid) = 0
    and (select amount from public.financial_ledger where id = v_eid) = 0.0020, '');
  insert into t13b values ('T10.8 reversal / adjustment did NOT touch the campaign budget / spend (no refund, no second deduction)', s1 = s0, s0::text || ' -> ' || s1::text);

  insert into t13b values ('T11.1 signed adjustment recorded; same request again = duplicate', v_ad ->> 'outcome' = 'recorded' and v_ad2 ->> 'outcome' = 'duplicate' and v_ad2 -> 'id' = v_ad -> 'id', v_ad::text);
  insert into t13b values ('T11.2 same key with a different amount = conflict (never silent)', o8 = 'conflict', o8);
  insert into t13b values ('T11.3 5-decimal amount = invalid', o9 = 'invalid', o9);
  insert into t13b values ('T11.4 zero amount = invalid', o10 = 'invalid', o10);
  insert into t13b values ('T11.5 non-admin actor = forbidden', o11 = 'forbidden', o11);
  insert into t13b values ('T11.6 advertiser account without an advertiser = rejected', o12 = 'rejected', o12);

  -- ---------- T12: permissions ----------
  ok := false; set local role anon;
  begin perform public.ledger_reverse_entry(v_admin, v_eid, 'rev-anon-00001', 'anon try'); exception when insufficient_privilege then ok := true; end; reset role;
  insert into t13b values ('T12.1 anon cannot call the reversal function', ok, ok::text);
  ok := false; set local role authenticated;
  begin perform public.ledger_add_adjustment(v_admin, 'platform', 1, 'adj-auth-00001', 'auth try'); exception when insufficient_privilege then ok := true; end; reset role;
  insert into t13b values ('T12.2 authenticated cannot call the adjustment function', ok, ok::text);
  ok := false; set local role service_role;
  begin perform count(*) from public.ledger_settings; exception when insufficient_privilege then ok := true; end; reset role;
  insert into t13b values ('T12.3 service_role cannot read or change ledger_settings directly', ok, ok::text);
end
$do$;

select test, case when passed then 'PASS' else 'FAIL' end as status, got from t13b order by test;
rollback;
