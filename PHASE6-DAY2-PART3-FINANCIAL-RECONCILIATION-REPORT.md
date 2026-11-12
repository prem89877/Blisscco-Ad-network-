# PHASE 6 — DAY 2 — PART 3 — FINANCIAL RECONCILIATION REPORT

Date: 2026-11-12 | Scope: TEST only | Source: latest ZIP + Day 1 evidence (Day 1 Final report, Part 2 migration report, Day 2 Part 2 report)
Not repeated: Day 1 / Day 2 Part 1–2 checks. No code, rule, rounding, cap or DB state changed by me.

## 0. Honest status
| Item | Status |
|---|---|
| 4 offline test files (run by me, ZIP code) | **PASS 30/30** |
| DB integration test (`...pilot-limits-db.test.ts`) | **NOT RUN by me** (no network / no TEST DB secret). Needs CI run on TEST |
| Rollback financial SQL (`financial-tests.sql`) | Day 1: **INFERRED** only (assertion NOTICE never seen) |
| Real billing rows in TEST | **None** (see §4) — reconciliation is vacuous |

## 1. Offline test evidence (run by me)
| File | Tests | Result |
|---|---|---|
| tests/campaigns/phase6-step4-part3-pilot-limits.test.ts | 6 | 6 pass |
| tests/ledger/phase6-step4-part3-revenue-share.test.ts | 16 | 16 pass |
| tests/ledger/phase6-step4-part3-reconciliation.test.ts | 5 | 5 pass |
| tests/ads/phase6-step4-part3-event-reconciliation.test.ts | 3 | 3 pass |

Limit of this evidence: the pilot-limits and several ledger/event tests are **source-text checks or in-memory models**, not real PostgreSQL.

## 2. Pilot limits ($1,000 / $2,000)
Configured values (code = SQL parity): `PILOT_MAX_CAMPAIGN_BUDGET=1000`, `PILOT_MAX_ADVERTISER_TOTAL=2000`; counted statuses draft, pending_review, active, paused, completed.

| Check | Result |
|---|---|
| Trigger `campaigns_guard_pilot_limits` (BEFORE INSERT/UPDATE OF total_budget, status, advertiser_id) | Day 1: PASS (LIVE). Static review OK |
| Direct insert bypass (RLS path) | Trigger is table-level → covers it. DB test: insert 1000.01 refused — **not run by me** |
| Concurrency | Advisory xact lock per advertiser. DB test: 30 parallel × $100 — **not run by me**; assertion is only `total <= 2000` (weak: does not require exactly 20 successes) |
| Boundaries 1000.00 / 1000.01 / 2000.00 / 2000.01, update raise, status reopen, advertiser move | **No DB test exists.** Script provided: `phase6-day2-part3-pilot-limits-boundary-rollback.sql` — **PENDING owner run** |

Findings (no change made):
- **G-1:** Guard checks the $1,000 cap only when `total_budget` changes. A legacy >$1,000 campaign in `rejected` can be reopened to `draft` with unchanged budget (only the $2,000 sum is checked). Matches app rule "unchanged value is not re-blocked". Owner decision needed: accept or tighten.
- **G-2:** DB test covers 2 cases only (insert >1000, 30 parallel inserts). Updates, exact boundaries, reopen, advertiser move and concurrent *updates* are untested in CI.

## 3. 90/10 split (`publisher_share_bps=9000`)
Rule (TS `splitCharge` = SQL `trunc(amount*bps/10000, 4)`): publisher = truncate to 4 decimals; platform = charge − publisher; zero publisher entry is skipped. Computed from the existing implementation:

| Case | Charge | Publisher | Platform | Sum |
|---|---|---|---|---|
| CPM $2.00 (per impression) | 0.0020 | 0.0018 | 0.0002 | OK |
| CPM $1.50 | 0.0015 | 0.0013 | 0.0002 | OK |
| CPC | 0.1234 | 0.1110 | 0.0124 | OK |
| CPC | 0.0019 | 0.0017 | 0.0002 | OK |
| CPC | 1.0000 | 0.9000 | 0.1000 | OK |
| Minimum 0.0001 | 0.0001 | 0.0000 (no entry) | 0.0001 | OK |

Tests: 16 revenue-share tests pass incl. 5000-amount no-loss sweep, MAX_UNITS, invalid bps, TS↔SQL expression match, no hardcoded 9000 in runtime.
Note: platform keeps the truncation remainder (e.g. +0.0001 on 0.0019) — this is the existing rule, not changed.
Live DB split: Day 1 financial-tests.sql run was INFERRED (see §0).

## 4. Reconciliation (spend ↔ reservations ↔ charges ↔ publisher ↔ platform)
Day 1 live state: ledger OFF, 9000 bps, **settled reservations 0, advertiser charges 0**, ledger holds only 1 manual adjustment **5.0000**.
- Q1–Q7 = 0 rows. **This is NOT proof of billing correctness** (no real billing rows).
- Manual adjustment 5.0000: Q2/Q3/Q4/Q5/Q6 filter on `source_type='serve'` / `entry_type='advertiser_charge'`, so it cannot enter these checks → **does not affect reconciliation** (static reading; confirm with E4 below). Not touched.
- Model-level reconciliation (`reconcileSplit`, `reconcileServeEntries`) passes; reversals/adjustments are kept separate.

Missing evidence / gaps in Day 1 reconciliation SQL:
1. Q5 only flags `ledger > spend`; **spend without ledger is computed but filtered out**.
2. No check settled-reservation amount = `campaign_spend_daily` per campaign.
3. No global check: Σcharge = Σpublisher + Σplatform (only per serve_ref, serve source only).
4. Assertion output of `financial-tests.sql` (the "ALL … PASSED" NOTICE) never seen.
5. No committed (non-rollback) billing run — intentionally not done; ledger stays OFF.
Script for 2/global state: `phase6-day2-part3-reconciliation-evidence-readonly.sql` (SELECT only).

## 5. Ledger state
`ledger_enabled=false` — last live evidence: Day 1 Part 2 and Day 1 final (false / 9000 / "ledger remains off"). **Not re-verified live today** (no DB access). Re-check = E1 in the read-only script. I did not enable the ledger.

## 6. Unresolved blockers
1. DB tests not executed by me → run CI (manual dispatch) on TEST; send pass/skip counts.
2. Boundary rollback SQL — owner run needed.
3. `financial-tests.sql` — owner must run and send the NOTICE/result.
4. Read-only evidence SQL — owner run (confirms ledger OFF now, adjustment effect, real billing rows = 0).
5. Owner decision on G-1 (legacy oversized reopen).
6. Real billing correctness remains **UNPROVEN** until a rollback test with real flow output is seen.

## 7. Files
Created: this report, `phase6-day2-part3-pilot-limits-boundary-rollback.sql`, `phase6-day2-part3-reconciliation-evidence-readonly.sql`. Modified: none.

---
## UPDATE — owner-run TEST evidence (2026-11-12)

### A. Pilot guard boundary (rollback-only, owner run) — **PASS (LIVE) 13/13**
T0 trigger enabled `O`; insert 1000.00 OK; 1000.01 refused (`pilot_campaign_limit`, 23514); advertiser total 2000.00 OK; +0.01 refused (`pilot_advertiser_limit`); update to 1000.01 refused; update 500.00→500.01 at 2000.00 refused; rejected(100.00)→draft when full refused; advertiser move into full advertiser refused; final counted total **2000.00**. Direct insert/update, budget change, reopen and advertiser move cannot bypass the guard. Concurrency (30 parallel) still **PENDING CI**.

### B. `financial-tests.sql` (rollback-only, owner run) — **PASS (LIVE, by no-exception)**
No error raised (every assertion is `raise exception`); post-rollback row: `ledger_enabled=false, publisher_share_bps=9000, pass: ledger remains off`. The assertion NOTICE text itself was not shown by the editor. CPM 0.0020 → 0.0018 + 0.0002 and CPC 0.1234 → 0.1110 + 0.0124 are therefore live-supported; duplicate impression = no second charge.

### C. Read-only reconciliation evidence (live TEST)
| Item | Actual |
|---|---|
| ledger_enabled / bps | false / 9000 (history: baseline 2026-10-29; 9000 set 2026-11-11 01:41 UTC) |
| Ledger rows | 1 only: id 53, `adjustment`, publisher account, **5.0000**, source_type `manual`, no source_ref, no campaign, "TEST credit for payout flow" (2026-11-04) |
| Adjustment effect on reconciliation | **None** (not serve-linked, no campaign). It is not billing evidence. Untouched |
| Reservations | 0 rows (any status) |
| advertiser_charge / settled reservations | **0 / 0** — no real billing rows |
| campaign_spend_daily | 7 rows, total **0.5960** |
| Settled reservations total | 0.0000 |
| **Reconciliation difference** | **0.5960 spend with no reservation and no ledger charge**: campaign 38d54e0b-f5c9-46fc-b20c-cefc45b912aa = 0.5720; campaign 3657dd65-bdfa-4071-b3fc-ea833414d789 = 0.0240 |
| Cause (code reading, not yet proven) | Legacy serve-time spend: day-12-5 `record_ad_serve` wrote `campaign_spend_daily` on every serve, before Part 2 moved billing to event settlement. Old Q5 filtered this out. Not backfilled by rule |
| Legacy over-limit | 2 campaigns > $1,000; 2 advertisers > $2,000 (counted statuses). Pre-date the guard; not changed or deleted |

### D. Status now
Closed: guard boundaries, ledger OFF (live, 2 checks), 5.0000 adjustment impact, financial rollback test.
**Still unproven:** real billing correctness (0 charges, 0 settled) — **no PASS claimed**. Open: CI integration run (concurrency), owner decision G-1, owner classification of the 0.5960 legacy spend (accept as legacy / no action), and which legacy over-limit campaigns are active.
