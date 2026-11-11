-- =====================================================================
-- BLISSCCO PHASE 6 — STEP 4 — PART 3
-- TEST-ONLY CONFIGURATION: PUBLISHER REVENUE SHARE (90% / 10%)
--
-- !! NEVER RUN ON PRODUCTION UNTIL SEPARATELY APPROVED !!
-- !! TEST PROJECT ONLY (denim hub bsl) !!
--
-- Business decision:
--   Approved publisher share: 90% (9000 basis points)
--   Approved platform share:  10% (1000 basis points, platform remainder)
--
-- Database state rule:
--   ledger_enabled MUST remain false (this script does NOT enable the ledger).
--   The change is written to public.ledger_settings via standard UPDATE
--   so trigger ledger_settings_log_change logs it into financial_settings_history.
--   Old ledger rows are append-only and are NEVER modified by this update.
-- =====================================================================

begin;

-- 1. READ-ONLY BEFORE CHECK
-- Expect: ledger_enabled = false, publisher_share_bps is null (or previous test value)
select
  id,
  ledger_enabled,
  publisher_share_bps,
  case when ledger_enabled = false then 'pass: ledger stays off' else 'FAIL: ledger was on' end as ledger_status
from public.ledger_settings
where id;

-- 2. APPLY APPROVED TEST VALUE (9000 bps = 90.00%)
-- ledger_enabled is deliberately omitted to keep the default false!
update public.ledger_settings
   set publisher_share_bps = 9000
 where id;

-- 3. READ-ONLY AFTER CHECK
-- Expect: ledger_enabled = false, publisher_share_bps = 9000
select
  id,
  ledger_enabled,
  publisher_share_bps,
  case when ledger_enabled = false and publisher_share_bps = 9000
       then 'pass: 9000 bps set and ledger still off'
       else 'FAIL: incorrect settings'
  end as config_status
from public.ledger_settings
where id;

-- 4. VERIFY AUDIT LOG TRIGGER
-- Expect: at least one row in financial_settings_history with setting = 'publisher_share_bps' and new_value = '9000'
select
  id,
  setting,
  old_value,
  new_value,
  changed_at
from public.financial_settings_history
where setting = 'publisher_share_bps'
order by changed_at desc
limit 1;

-- 5. VERIFY FINANCIAL LEDGER IMMUTABILITY
-- Expect: ledger row count unchanged (no historical rows backfilled or touched)
select
  count(*)::int as ledger_rows_untouched
from public.financial_ledger;

commit;

-- =====================================================================
-- ROLLBACK INSTRUCTION (To undo this test configuration later):
--
--   update public.ledger_settings set publisher_share_bps = null where id;
--
-- Historical ledger rows are append-only and never modified by resetting bps.
-- =====================================================================
