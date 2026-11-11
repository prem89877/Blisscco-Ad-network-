-- =====================================================================
-- BLISSCCO PHASE 6 — STEP 4 — PART 3
-- READ-ONLY FINANCIAL RECONCILIATION VERIFICATION
--
-- Safe for production and test inspection (SELECT only, zero writes/DDL).
-- =====================================================================

-- 1. Current settings status
-- Expect: ledger_enabled = false (default off) and publisher_share_bps value (9000 on test if configured, null on prod)
select
  ledger_enabled,
  publisher_share_bps,
  case when ledger_enabled = false then 'pass' else 'FAIL: ledger enabled' end as default_guard
from public.ledger_settings
where id;

-- 2. Per serve_ref split balance: charge == publisher_earning + platform_revenue
-- Returns rows ONLY when mismatched. Expect: 0 rows.
with serve_sums as (
  select
    source_ref,
    sum(case when entry_type = 'advertiser_charge' then amount else 0 end) as charge_amt,
    sum(case when entry_type = 'publisher_earning' then amount else 0 end) as pub_amt,
    sum(case when entry_type = 'platform_revenue' then amount else 0 end) as plat_amt
  from public.financial_ledger
  where source_type = 'serve'
    and entry_type in ('advertiser_charge', 'publisher_earning', 'platform_revenue')
  group by source_ref
)
select
  source_ref,
  charge_amt,
  pub_amt,
  plat_amt,
  (pub_amt + plat_amt) as split_sum,
  charge_amt - (pub_amt + plat_amt) as diff
from serve_sums
where charge_amt <> (pub_amt + plat_amt);

-- 3. Charges without split entries when share bps is configured
-- Returns rows ONLY if share is set but an event charge missed the split. Expect: 0 rows.
with settings as (
  select publisher_share_bps from public.ledger_settings where id
)
select
  l.source_ref,
  l.amount as charge_amount,
  count(s.id)::int as split_entries_count
from public.financial_ledger l
cross join settings
left join public.financial_ledger s
  on s.source_ref = l.source_ref
 and s.entry_type in ('publisher_earning', 'platform_revenue')
where l.source_type = 'serve'
  and l.entry_type = 'advertiser_charge'
  and settings.publisher_share_bps is not null
group by l.source_ref, l.amount
having count(s.id) = 0;

-- 4. Duplicates: more than one advertiser_charge per serve_ref
-- Expect: 0 rows (guaranteed by partial unique index financial_ledger_one_per_serve_type_key).
select
  source_ref,
  count(*)::int as charges_count
from public.financial_ledger
where source_type = 'serve'
  and entry_type = 'advertiser_charge'
group by source_ref
having count(*) > 1;

-- 5. Ledger charge total per campaign == settled campaign_spend_daily for ledger-on period
-- NOTE: Holds only for events processed after ledger was enabled. Historical serves are never backfilled.
-- Expect: 0 mismatched rows for active ledger periods.
with ledger_campaign_charges as (
  select
    campaign_id,
    sum(amount) as ledger_total
  from public.financial_ledger
  where entry_type = 'advertiser_charge'
    and campaign_id is not null
  group by campaign_id
),
campaign_spends as (
  select
    campaign_id,
    sum(spent) as spend_total
  from public.campaign_spend_daily
  group by campaign_id
)
select
  coalesce(l.campaign_id, s.campaign_id) as campaign_id,
  coalesce(l.ledger_total, 0) as ledger_total,
  coalesce(s.spend_total, 0) as spend_total,
  coalesce(s.spend_total, 0) - coalesce(l.ledger_total, 0) as diff_unledgered_historical_spend
from campaign_spends s
full outer join ledger_campaign_charges l on l.campaign_id = s.campaign_id
where l.ledger_total > s.spend_total; -- ledger can never exceed recorded spend!

-- 6. Settled reservations vs advertiser_charge count
-- Expect: charge count <= settled reservation count (charges only exist when ledger was ON at settlement).
select
  (select count(*)::int from public.ad_budget_reservations where status = 'settled') as settled_reservations_count,
  (select count(*)::int from public.financial_ledger where entry_type = 'advertiser_charge') as advertiser_charges_count;

-- 7. Precision & scale check: no entry with > 4 decimals and no zero-amount entries
-- Expect: 0 rows.
select
  id,
  entry_type,
  amount,
  case
    when amount = 0 then 'zero_amount'
    when amount <> round(amount, 4) then 'exceeds_4_decimals'
    else 'valid'
  end as defect
from public.financial_ledger
where amount = 0 or amount <> round(amount, 4);

-- 8. Informational: Reversals and adjustments summary (reported separately from serve splits)
select
  entry_type,
  account,
  count(*)::int as entries_count,
  coalesce(sum(amount), 0) as net_amount
from public.financial_ledger
where entry_type in ('reversal', 'adjustment')
group by entry_type, account;
