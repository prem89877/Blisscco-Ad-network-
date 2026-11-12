# PHASE 6 — DAY 1 — FINAL VERIFICATION REPORT (Parts 1–4)

Date: 2026-11-12 (updated with run #18 evidence and owner decisions)
Scope: TEST Supabase project `Denim Hub Bsl` only. No Production SQL, deploy, Vercel change, live payment, payout or Production ledger. No secrets printed. **No business rule or test changed by me.**

Labels: **LIVE** = I ran it on TEST this session · **GITHUB** = owner-reported Actions result (screenshot/log in zip reports, not re-observed by me) · **STATIC** = code/test file read · **INFERRED** · **BLOCKED** · **OPEN**.

---

## 1. Part-by-part result

| Part | Report | Result |
|---|---|---|
| 1 Inventory | `PHASE6-DAY1-PART1-DATABASE-INVENTORY-REPORT.md` | Done. TEST identity verified; all Phase 6 SQL located; applied/pending classified |
| 2 Migrations | `PHASE6-DAY1-PART2-TEST-MIGRATION-REPORT.md` | **0 pending**, nothing applied. Footer checks P1 V1–V6, P2 C1–C7, P3 C1–C2 + reconciliation Q1–Q7: all **PASS (LIVE)**. Ledger OFF, 9000 bps, no leaks |
| 3 CI | `PHASE6-DAY1-PART3-CI-VERIFICATION-REPORT.md` | Local run **BLOCKED** (no network; `day28-verify.sh` exit 1 at `npm ci`). CI #124 green (GITHUB #17/#18) = same 5 commands as the script |
| 4 DB integration | this report | See §2–§5 |

## 2. Task 1 — integration tests (commands discovered from repo)

| Item | Finding |
|---|---|
| Command | `npm run test:integration` = `tsc -p tsconfig.test.json && node --require ./tests/register.cjs --test --test-concurrency=1 .test-build/tests/integration/*.test.js` (from `package.json`) |
| Workflow | `.github/workflows/integration.yml` (manual dispatch). Needs `TEST_DATABASE_URL`, `TEST_SUPABASE_PROJECT_REF` (repo secrets) and `TEST_DB_CONFIRM=blisscco-test-db`. Fails on any skipped test or zero passes |
| Files (10) | day9-part5-db, day10-part5-db, day16-part1/2/4/5, day18-part4, day9-part5-guard, **phase6-step4-part2-event-billing-db**, **phase6-step4-part3-pilot-limits-db** (+ `test-db-guard.ts`) |
| Run by me | **BLOCKED.** Missing prerequisites: (a) network in sandbox (npm install + DB connection), (b) the TEST DB connection URL as a secret env var — I do not have it and must not be given it in chat |
| Existing result | DB integration #17 PASS (GITHUB #17/#18), 6m 38s, counts not visible. Runs #14–#16 failed for stale tests / TEST-DB drift (fixed, Part 1 F-1, F-5) |
| **Latest result (run #18)** | **VERIFIED (owner-supplied)**: workflow "DB integration (TEST database only)", branch `preview-day-c`, 2026-11-12, status Success, commit `be8b4c01a67acd0651ed35312dffc74125525a20`. **98 passed, 0 failed, 0 skipped, 0 cancelled**, 12 suites, ~4 min 41 s. Source: owner screenshot of a ChatGPT summary of the GitHub run — not the GitHub page itself and not re-observed by me. 0 skipped means no DB test was skipped or mocked |

I did **not** execute the integration tests myself. DB-test PASS below = GitHub run #18 (98/0/0, owner-supplied) + earlier #17 + STATIC mapping of test names.

## 3. Tasks 2–3 — billing, reservations, budget (coverage in `phase6-step4-part2-event-billing-db.test.ts`, run in #17)

Mapping is STATIC (test names read); outcome is GitHub green: #17 and **#18 (98 passed, 0 skipped)**.

| Requirement | Covering test | Status |
|---|---|---|
| Serve reserves, charges nothing | "serving reserves budget but charges nothing…" | PASS (GITHUB #17/#18) |
| CPM: only first valid impression charges; duplicate impression and clicks free | "CPM: first valid impression charges once…" | PASS (GITHUB #17/#18) |
| CPC: impression free; click before impression `not_counted`; first click after impression charges once; repeat = duplicate | "CPC: impression is free, click before impression…" | PASS (GITHUB #17/#18) |
| Price snapshot; campaigns without pricing use platform CPM | "CPC rate change after serve…" | PASS (GITHUB #17/#18) |
| Invalid events never charge (unknown serve, wrong publisher/creative, malformed ref, paused campaign, legacy serve) | 3 tests | PASS (GITHUB #17/#18) |
| Events after 24h never charge | "expired events never charge…" | PASS (GITHUB #17/#18) |
| 24h unused reservation release, budget freed | "expired holds stop counting… released on next serve" | PASS (GITHUB #17/#18) |
| Concurrent budget protection | parallel serves; parallel settles (each impression twice); 30x same impression / click at once; mixed parallel (spend == settled) | PASS (GITHUB #17/#18) |
| Daily budget (UTC day) and total budget | "daily budget: holds + spend of same UTC day…"; "lowering total_budget below spent + holds refused"; `reserve_day` asserted equal to DB `now() at time zone 'utc'` | PASS (GITHUB #17/#18) |
| Idempotency (same key → same `serve_ref`, one reservation) | "Idempotency-Key retry preserved" | PASS (GITHUB #17/#18) |
| Rollback safety | 2 rollback tests | PASS (GITHUB #17/#18) |
| Ledger OFF writes nothing; reservation table closed to app roles | 2 tests | PASS (GITHUB #17/#18) + LIVE (Part 2 C1–C4) |
| Pilot limits ($1,000 / $2,000, 30 parallel inserts) | `phase6-step4-part3-pilot-limits-db.test.ts` | PASS (GITHUB #17/#18) |

Live state now (LIVE, Part 2): 0 reservations, 0 settled, budgets never exceeded (C6 = 0), 298 serves / 23 events unchanged.

## 4. Task 4 — 90/10 split, ledger, rounding, reconciliation

| Item | Evidence | Status |
|---|---|---|
| Config 9000 bps, ledger OFF | LIVE; audit row `null → 9000` (2026-11-11 01:41 UTC) | **PASS (LIVE)** |
| Rounding rule | STATIC (`lib/ledger/revenue-share.ts`): publisher = TRUNCATE(charge × bps / 10000) to 4 decimals; platform = remainder; zero publisher entry skipped; sum always equals charge | Documented |
| Split with ledger ON | `financial-tests.sql` (rollback-only, run by owner): CPM 0.0020 → 0.0018 + 0.0002; CPC 0.1234 → 0.1110 + 0.0124 (0.1234 × 0.9 = 0.11106 → truncated 0.1110; remainder 0.0124 — consistent with the rule). Duplicate impression = `duplicate`, no 2nd charge | **PASS (INFERRED)**: final row `false / 9000 / pass: ledger remains off` seen; assertion output not directly seen |
| Duplicate protection | Unique partial index `financial_ledger_one_per_serve_type_key`; Q4 = 0 | PASS (LIVE, but vacuous: 0 charges) |
| Reconciliation Q1–Q7 | LIVE: settings `(false, 9000)`; split mismatch 0; missing split 0; duplicates 0; ledger>spend 0; settled/charges 0/0; precision 0 | **PASS (LIVE), vacuous** — ledger holds only the 1 known manual adjustment (5.0000) |
| Rollback left no data | LIVE: counts 298 / 23 / 1 / 0, 0 test rows | PASS (LIVE) |

Expected values above are derived from the configured prices in the test and the existing truncation rule; none were invented.

## 5. Not proven (be honest)

1. **Committed (persisted) billing with ledger ON** was never executed; only rollback-only. Ledger must stay OFF anyway.
2. The reconciliation PASSes are consistency checks on an almost empty ledger; they do not prove billing by themselves — the DB tests / rollback test do.
3. I did not execute any integration test myself (BLOCKED, §2).

## 6. GO / NO-GO

| Decision | Verdict |
|---|---|
| **Day 1 completion (TEST verification)** | **GO** — Parts 1–4 covered by LIVE checks and GitHub green runs (CI #124, DB integration #18: 98/0/0); nothing failed; TEST data clean, ledger OFF. Caveat: DB-run evidence is owner-supplied and I could not run the tests myself |
| Any Production step / live payments / payouts / ledger ON | **NO-GO** (Step 5 readiness report is still NO-GO; Production untouched) |

## 7. Blockers: closed and remaining

**Closed (this update):**
1. ~~Commit SHA~~ → `be8b4c01a67acd0651ed35312dffc74125525a20` (run #18, owner-supplied). Note: the ZIP has no `.git`, so I cannot prove the ZIP equals this commit.
2. ~~Pass/skip counts~~ → 98 passed / 0 skipped / 0 failed (run #18).
3. ~~TEST DB password rotation~~ → **CONFIRMED BY USER** (changed; GitHub secret update assumed by owner, not seen).
4. ~~Finding P-1 (shared project)~~ → **DECIDED by owner:** Denim stays the shared TEST project; the non-Blisscco tables/data are not needed. Never use this project as Production.

**Remaining (none blocks Day 1):**
- Persisted (committed) billing with ledger ON never executed; rollback-only coverage. Ledger stays OFF.
- My own execution of integration tests: BLOCKED (no network, no TEST DB secret in sandbox). Optional.
- Production read-only checks (`serve_id` column, `replay_serve`): OPEN, out of Day 1 scope.
- Step 5 readiness report still NO-GO for any Production step.

## 8. Changed files

Created: `PHASE6-DAY1-FINAL-VERIFICATION-REPORT.md`. Modified: none.
