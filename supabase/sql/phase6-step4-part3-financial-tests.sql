-- =====================================================================
-- BLISSCCO PHASE 6 — STEP 4 — PART 3
-- ROLLBACK-ONLY DB TEST: FINANCIAL RECONCILIATION & 90/10 REVENUE SHARE
--
-- STATUS: WRITTEN, NOT RUN BY AI.
-- Run by hand on Denim Hub Bsl (TEST project) SQL Editor.
--
-- Safety:
--   Single transaction ending in ROLLBACK.
--   Zero permanent modifications.
--   ledger_enabled is turned on ONLY inside the transaction and rolled back.
-- =====================================================================

begin;

do $$
declare
  v_test_adv_user uuid := gen_random_uuid();
  v_test_pub_user uuid := gen_random_uuid();
  v_test_adv_id   uuid;
  v_test_pub_id   uuid;
  v_test_key_raw  text;
  v_test_key_hash text;
  v_cpm_camp_id   uuid;
  v_cpc_camp_id   uuid;
  v_cpm_creat_id  uuid;
  v_cpc_creat_id  uuid;
  v_serve_res     jsonb;
  v_event_res     jsonb;
  v_cpm_serve_ref text;
  v_cpc_serve_ref text;
  v_charge_cnt    int;
  v_pub_cnt       int;
  v_plat_cnt      int;
  v_charge_amt    numeric;
  v_pub_amt       numeric;
  v_plat_amt       numeric;
begin
  -- 1. Setup isolated test users and accounts
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_test_adv_user, 'test-adv-fin@blisscco.test', '{"role":"advertiser"}'::jsonb);

  insert into auth.users (id, email, raw_user_meta_data)
  values (v_test_pub_user, 'test-pub-fin@blisscco.test', '{"role":"publisher"}'::jsonb);

  -- FIX: handle_new_user (day-4-1) already creates an 'active' advertiser row for role=advertiser.
  insert into public.advertisers (profile_id, company_name, status)
  select v_test_adv_user, 'Test Fin Advertiser', 'active'
  where not exists (select 1 from public.advertisers where profile_id = v_test_adv_user);
  select id into v_test_adv_id from public.advertisers where profile_id = v_test_adv_user;

  insert into public.publishers (profile_id, name, status)
  values (v_test_pub_user, 'Test Fin Publisher', 'active')
  returning id into v_test_pub_id;

  select private.issue_publisher_key(v_test_pub_id) into v_test_key_raw;
  v_test_key_hash := encode(digest(v_test_key_raw, 'sha256'), 'hex');

  -- 2. Setup CPM campaign ($2.00 CPM => $0.0020 per serve)
  insert into public.campaigns (
    advertiser_id, name, category, total_budget, daily_budget, start_date, status, pricing_model, cpm_rate_usd
  ) values (
    v_test_adv_id, 'Fin Test CPM', 'technology', 100.00, 50.00, current_date - 1, 'active', 'cpm', 2.0000
  ) returning id into v_cpm_camp_id;

  -- FIX: ad_creatives_approved_needs_review_check requires reviewed_at when status = 'approved'.
  insert into public.ad_creatives (campaign_id, headline, body, destination_url, status, reviewed_at)
  values (v_cpm_camp_id, 'Fin CPM Ad', 'Body', 'https://example.com/cpm', 'approved', now())
  returning id into v_cpm_creat_id;

  -- 3. Setup CPC campaign ($0.1234 CPC => $0.1234 per click)
  insert into public.campaigns (
    advertiser_id, name, category, total_budget, daily_budget, start_date, status, pricing_model, cpc_rate_usd
  ) values (
    v_test_adv_id, 'Fin Test CPC', 'technology', 100.00, 50.00, current_date - 1, 'active', 'cpc', 0.1234
  ) returning id into v_cpc_camp_id;

  -- FIX: ad_creatives_approved_needs_review_check requires reviewed_at when status = 'approved'.
  insert into public.ad_creatives (campaign_id, headline, body, destination_url, status, reviewed_at)
  values (v_cpc_camp_id, 'Fin CPC Ad', 'Body', 'https://example.com/cpc', 'approved', now())
  returning id into v_cpc_creat_id;

  -- 4. Enable ledger and set 90/10 split INSIDE this test transaction
  update public.ledger_settings
     set ledger_enabled = true,
         publisher_share_bps = 9000
   where id;

  -- 5. TEST CPM FLOW: serve -> reservation held (0 ledger entries)
  select public.record_ad_serve(v_test_key_hash, v_cpm_creat_id, 'technology') into v_serve_res;
  if (v_serve_res->>'outcome') <> 'ok' then
    raise exception 'CPM serve failed: %', v_serve_res;
  end if;
  v_cpm_serve_ref := v_serve_res->>'serve_ref';

  select count(*) into v_charge_cnt from public.financial_ledger where source_ref = v_cpm_serve_ref;
  if v_charge_cnt <> 0 then
    raise exception 'Serve must NOT create ledger rows, found: %', v_charge_cnt;
  end if;

  -- 6. CPM IMPRESSION: triggers settlement -> charges $0.0020
  select public.record_ad_impression(v_cpm_serve_ref, v_test_pub_id) into v_event_res;
  if (v_event_res->>'outcome') <> 'recorded' or (v_event_res->>'billed')::boolean <> true then
    raise exception 'CPM impression failed: %', v_event_res;
  end if;

  select amount into v_charge_amt from public.financial_ledger where source_ref = v_cpm_serve_ref and entry_type = 'advertiser_charge';
  select amount into v_pub_amt from public.financial_ledger where source_ref = v_cpm_serve_ref and entry_type = 'publisher_earning';
  select amount into v_plat_amt from public.financial_ledger where source_ref = v_cpm_serve_ref and entry_type = 'platform_revenue';

  if v_charge_amt <> 0.0020 or v_pub_amt <> 0.0018 or v_plat_amt <> 0.0002 then
    raise exception 'CPM 90/10 split mismatch: charge=%, pub=%, plat=%', v_charge_amt, v_pub_amt, v_plat_amt;
  end if;
  if v_charge_amt <> (v_pub_amt + v_plat_amt) then
    raise exception 'CPM reconciliation sum failure';
  end if;

  -- 7. CPM DUPLICATE IMPRESSION: must be duplicate and write zero new ledger entries
  select public.record_ad_impression(v_cpm_serve_ref, v_test_pub_id) into v_event_res;
  if (v_event_res->>'outcome') <> 'duplicate' or (v_event_res->>'billed')::boolean <> false then
    raise exception 'Duplicate CPM impression check failed: %', v_event_res;
  end if;
  select count(*) into v_charge_cnt from public.financial_ledger where source_ref = v_cpm_serve_ref and entry_type = 'advertiser_charge';
  if v_charge_cnt <> 1 then
    raise exception 'Duplicate impression created second charge!';
  end if;

  -- 8. TEST CPC FLOW: serve -> impression (free) -> click ($0.1234)
  select public.record_ad_serve(v_test_key_hash, v_cpc_creat_id, 'technology') into v_serve_res;
  v_cpc_serve_ref := v_serve_res->>'serve_ref';

  select public.record_ad_impression(v_cpc_serve_ref, v_test_pub_id) into v_event_res;
  if (v_event_res->>'billed')::boolean <> false then
    raise exception 'CPC impression billed unexpectedly';
  end if;
  select count(*) into v_charge_cnt from public.financial_ledger where source_ref = v_cpc_serve_ref;
  if v_charge_cnt <> 0 then
    raise exception 'CPC impression wrote ledger row!';
  end if;

  select public.record_ad_click(v_cpc_serve_ref, v_test_pub_id, v_cpc_creat_id) into v_event_res;
  if (v_event_res->>'outcome') <> 'recorded' or (v_event_res->>'billed')::boolean <> true then
    raise exception 'CPC click billing failed: %', v_event_res;
  end if;

  select amount into v_charge_amt from public.financial_ledger where source_ref = v_cpc_serve_ref and entry_type = 'advertiser_charge';
  select amount into v_pub_amt from public.financial_ledger where source_ref = v_cpc_serve_ref and entry_type = 'publisher_earning';
  select amount into v_plat_amt from public.financial_ledger where source_ref = v_cpc_serve_ref and entry_type = 'platform_revenue';

  if v_charge_amt <> 0.1234 or v_pub_amt <> 0.1110 or v_plat_amt <> 0.0124 then
    raise exception 'CPC 90/10 split mismatch: charge=%, pub=%, plat=%', v_charge_amt, v_pub_amt, v_plat_amt;
  end if;
  if v_charge_amt <> (v_pub_amt + v_plat_amt) then
    raise exception 'CPC reconciliation sum failure';
  end if;

  raise notice 'ALL FINANCIAL INTEGRATION ASSERTIONS PASSED WITHIN TRANSACTION.';
end $$;

-- 10. ALWAYS ROLLBACK
rollback;

-- 11. POST-ROLLBACK INTEGRITY CHECK
select
  ledger_enabled,
  publisher_share_bps,
  case when ledger_enabled = false then 'pass: ledger remains off' else 'FAIL' end as status
from public.ledger_settings
where id;
