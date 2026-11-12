# PHASE 6 — DAY 1 — PART 1: TEST DATABASE & SQL INVENTORY REPORT

> **Status note (2026-11-12):** sections and appendices below keep the original wording as a history. Where they say NOT VERIFIED or NOT RUN, **Appendix G is the current status** (VERIFIED / CONFIRMED BY USER / INFERRED / OPEN).


Date of inspection: 2026-11-11
Source of truth: uploaded `blisscco-ad-network.zip` (Phase 6 Step 5 state)
Mode: **INSPECTION ONLY.** No SQL executed. No Supabase / Vercel access. No Production access. No credentials read or printed.
Method: ZIP extracted to a scratch folder (excluding `node_modules` / `.next`), then files read statically.

Status vocabulary: **VERIFIED-IN-REPO** (seen in a file in the ZIP) · **OWNER-REPORTED** (a repo report says so, not independently proven) · **NOT VERIFIED** (no evidence available to me).

---

## 1. Executive summary

| Item | Result |
|---|---|
| SQL files in `supabase/sql/` | 86 |
| Supabase CLI `supabase/migrations/` folder | **Does not exist.** No `config.toml`, no linked project ref, no `.vercel` folder in the ZIP |
| Phase 6 SQL files | 9 (Step 2: 2, Step 3: 1, Step 4: 6 incl. tests/verify) |
| Phase 6 **Step 5** SQL files | **0** (Step 5 = docs + 1 contract test + 2 runbook edits only) |
| Live migration history of TEST DB | **NOT VERIFIED** (cannot be read from the ZIP) |
| Steps 4 Part 1, 2, 3 SQL applied anywhere | **NOT VERIFIED; all three reports say NOT RUN on any database** |
| TEST project identity | Documented in repo reports as "Denim Hub Bsl" (OWNER-REPORTED). Not confirmable from config in the ZIP. See §4 |
| Latest update | See **Appendix E** (financial-tests.sql result from owner screenshot, 2026-11-11) |
| Overall | **Inventory complete. Execution NOT yet safe to start until blockers in §9 are cleared by owner evidence.** |

---

## 2. Phase 6 SQL files (exact paths)

All under `supabase/sql/`.

| # | File | Kind | Size | Repo-stated status |
|---|---|---|---|---|
| 42 | `phase6-step2-1-publisher-country-verification.sql` | Migration | 14 KB | OWNER-REPORTED applied on TEST 2026-11-10, V1–V7 PASS (`PHASE6-STEP2-PART1-TEST-DB-MIGRATION-REPORT.md`) |
| 43 | `phase6-step2-2-campaign-target-regions.sql` | Migration | 5 KB | OWNER-REPORTED applied on TEST 2026-11-10 (Step 2 Part 2 / Part 3 reports) |
| 44 | `phase6-step3-1-advertiser-country.sql` | Migration | 4 KB | OWNER-REPORTED applied on TEST 2026-11-10, V1–V5 PASS (`MIGRATION-ORDER.md` row 44). Step 3 Part 1 report itself says "nothing applied" — **conflicting evidence, see §6** |
| 45 | `phase6-step4-part1-campaign-pricing.sql` | Migration | 9 KB | **NOT RUN** (Step 4 Part 1 report) |
| 46 | `phase6-step4-part2-event-billing.sql` | Migration | 38 KB | **NOT RUN** (Step 4 Part 2 report) |
| 47 | `phase6-step4-part3-pilot-limits-guard.sql` | Migration | 5 KB | **NOT RUN** (Step 4 Part 3 + Step 5 reports) |
| 48 | `phase6-step4-part3-test-revenue-share-config.sql` | Data config, **TEST ONLY** | 2.6 KB | **NOT RUN** |
| 49 | `phase6-step4-part3-financial-reconciliation-verify.sql` | Read-only verify | 4.6 KB | **NOT RUN** |
| — | `phase6-step4-part3-financial-tests.sql` | Rollback-only test, **TEST ONLY** | 7 KB | **NOT RUN** |

Related Step 4 / Step 5 non-SQL files (for reference):
- Step 4 Part 1–3 reports: `PHASE6-STEP4-PART{1,2,3}-*.md`, manifests `CHANGED-FILES-PHASE6-STEP4-PART{1,2,3}.txt`
- Step 5: `PHASE6-STEP5-FINAL-PILOT-READINESS-REPORT.md`, `CHANGED-FILES-PHASE6-STEP5.txt`, `tests/ads/phase6-step5-report-contract.test.ts`
- DB integration tests: `tests/integration/phase6-step4-part2-event-billing-db.test.ts`, `tests/integration/phase6-step4-part3-pilot-limits-db.test.ts` (skip without TEST env)
- Guard: `tests/integration/test-db-guard.ts`; docs: `supabase/MIGRATION-ORDER.md`, `supabase/DEPLOYMENT-RUNBOOK.md`, `supabase/SCHEMA-OVERVIEW.md`

TypeScript DB calls tied to Phase 6 (VERIFIED-IN-REPO): RPCs `get_publisher_country_state`, `get_campaign_target_regions`, `submit_publisher_country`, `admin_review_publisher_country`, `record_ad_serve`, `record_ad_impression`, `record_ad_click` in `lib/ads/*-db.ts`, `app/dashboard/**/country-actions.ts`, `app/dashboard/account/actions.ts`.

---

## 3. Migration history comparison

**Finding M-1 (blocker for "applied/pending" classification):** The repo has no `supabase/migrations/` folder and no CLI link. Migration history lives only in the live DB (`supabase_migrations.schema_migrations`) and in owner reports. I cannot read it, so per instructions nothing is assumed.

Classification (based only on repo evidence):

| Status | Files |
|---|---|
| OWNER-REPORTED applied on TEST (needs live confirmation) | phase6-step2-1, phase6-step2-2, phase6-step3-1 (migration name recorded in report for step2-1: `phase6_step2_1_publisher_country_verification`; step2-2: `phase6_step2_2_campaign_target_regions`) |
| PENDING (written, reported NOT RUN) | phase6-step4-part1, part2, part3-pilot-limits-guard, part3-test-revenue-share-config |
| Read-only / test files (never "applied") | part3-reconciliation-verify, part3-financial-tests |
| Phase 5 prerequisites (status of Phase 5 files on TEST) | **NOT VERIFIED.** `phase5-step4-1` and `phase5-step5-1` have no applied-on-TEST evidence for Denim in the files I read |
| Day 3–13 chain on TEST | **NOT VERIFIED** (Step 2 Part 1 report only confirms 34 public tables and 2 private functions existed) |

**Duplicates / conflicts found**
- **D-1:** `phase3-step4-1-pilot-request-metrics.sql` exists twice (repo root and `supabase/sql/`). They are **not identical**: the `supabase/sql/` copy has a stray `h` typo in a comment (line 12) and two extra blank lines near line 178. Comment-only difference, no logic change seen. Use only the `supabase/sql/` copy; delete or ignore the root copy.
- **D-2 (ordering anomaly):** `day-13-9-payout-requests.sql` and `day-13-10/11` are listed out of numeric order in the ZIP; `MIGRATION-ORDER.md` already places them correctly (rows 32). Follow the MIGRATION-ORDER table, not filename sort.
- **D-3 (re-run hazard, documented):** Part 2 redefines `record_ad_serve`, `record_ad_impression`, `record_ad_click`, `private.guard_campaign_budget`, `private.campaign_can_afford_serve`. Re-running day-9-3, day-9-5, 12-5, 12-7, 12-10 or 13-4 **after** Part 2 silently reverts to the old charge-on-serve behaviour. Per `MIGRATION-ORDER.md` "Rerun rule", the whole chain must be re-run from that point if any is repeated.
- **D-4 (doc inconsistency):** `PHASE6-STEP3-PART1-ADVERTISER-COUNTRY-REPORT.md` says nothing applied, while `MIGRATION-ORDER.md` row 44 says applied on TEST with V1–V5 passed. One of them is stale. Resolve with a live read-only check (Appendix A, query A3).

---

## 4. TEST project identity evidence

Target: **Denim Hub Bsl** (TEST).

| Evidence | Source | Strength |
|---|---|---|
| Project named "Denim Hub Bsl", region ap-northeast-2, ref `ficw…uqot` (masked; full value only in the owner's report) | `PHASE6-STEP2-PART1-TEST-DB-MIGRATION-REPORT.md`, `PHASE6-STEP2-PART2-CAMPAIGN-TARGETING-REPORT.md` | OWNER-REPORTED, "as named by the owner as the TEST project" |
| Production named `Blisscco-Ad-network-`, ref `mfli…jbshu` (masked) | same report | OWNER-REPORTED. **Never use this ref.** |
| TEST-only safety guard: needs `TEST_DATABASE_URL`, `TEST_SUPABASE_PROJECT_REF`, `TEST_DB_CONFIRM=blisscco-test-db`; URL must contain the TEST ref | `tests/integration/test-db-guard.ts`, `.github/workflows/integration.yml` | VERIFIED-IN-REPO (mechanism only; actual values are secrets, not in ZIP) |
| `.env.example` lists only placeholders (`NEXT_PUBLIC_SUPABASE_URL`, publishable key, secret key, etc.) | `.env.example` | VERIFIED-IN-REPO; no real project ref |
| Supabase CLI link / `config.toml` / `.vercel` | not in ZIP | **NOT VERIFIED** |

**Finding P-1 (risk):** The same Step 2 report observes Denim Hub Bsl also contains non-Blisscco tables (`products`, `visit_requests`, `push_subscriptions`, `customer_push_subscriptions`). It may be a shared / non-isolated project. Owner must confirm in the Supabase dashboard (Project Settings → General) that this is the intended Blisscco TEST project before any SQL runs.

**Finding P-2:** I did not use any live configuration to confirm the project. Identity is **OWNER-REPORTED only**; final confirmation = owner comparing the dashboard reference ID with the masked value above.

---

## 5. Dependency map for Step 4 migrations

| Migration | Requires first | Dependency files present in ZIP? |
|---|---|---|
| step4-part1 | day-3-3, day-3-5, day-4-1, day-9-3, phase6-step2-2 | Yes (all present) |
| step4-part2 | day-12-1, 12-2, 12-5, 12-7, 12-10, 13-1, 13-4, 9-3, 9-7, step4-part1 | Yes |
| step4-part3-pilot-limits-guard | day-3-5, day-9-3, step4-part1 | Yes |
| step4-part3-test-revenue-share-config | day-13-4, 13-12, step4-part2 | Yes |
| step4-part3-reconciliation-verify | day-13-1, 13-4, step4-part2 | Yes |

Missing files: **none** in the repo. **Missing prerequisites on the live TEST DB: NOT VERIFIED** (whether Day 12–13 chain and Phase 5 are actually applied on Denim).

---

## 6. Recommended safe execution order (TEST only, after prerequisites are confirmed)

Run one at a time; verify before moving on. FAIL = stop.

0. **Read-only baseline** (Appendix A queries) — confirm which of Day 3–13, Phase 3–5, Phase 6 Step 2–3 are actually on Denim. Take a TEST backup/dump or at least note row counts.
1. (Only if missing on TEST) earlier chain per `MIGRATION-ORDER.md` rows 1–44, in table order.
2. `phase6-step4-part1-campaign-pricing.sql` → verify footer checks.
3. `phase6-step4-part2-event-billing.sql` → verify footer checks. **Code deploy only after 2 and 3.**
4. `phase6-step4-part3-pilot-limits-guard.sql` → verify footer checks.
5. `phase6-step4-part3-test-revenue-share-config.sql` (TEST only; keeps `ledger_enabled=false`).
6. `phase6-step4-part3-financial-reconciliation-verify.sql` (read-only; expect `ledger_enabled=false`, 0 mismatch rows).
7. `phase6-step4-part3-financial-tests.sql` (rollback-only, TEST only).
8. `day-13-16` consistency verify at the end.
9. Then `npm run test:integration` with TEST env (guard must pass).

Step 5 has no SQL → nothing to execute.

---

## 7. Risk review: destructive, backward-incompatible, rollback

**Destructive SQL scan (Phase 6 files):** no `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `DELETE FROM`, or `ALTER COLUMN TYPE` found. Only `DROP TRIGGER IF EXISTS` (immediately re-created) in step2-1, part1, part2, part3, plus `DROP CONSTRAINT IF EXISTS` + re-add for check constraints. `REVOKE` statements are hardening only. All Step 4 files are wrapped in `begin; … commit;`.

| ID | Risk | Severity | Detail |
|---|---|---|---|
| R-1 | **Billing behaviour change (backward-incompatible)** | High | Part 2 changes `record_ad_serve`: a serve no longer charges; money is taken at valid impression/click via reservations. Old charge-on-serve semantics end. Legacy serves (pre-migration) have no reservation and are never charged on events. |
| R-2 | Existing test fails after Part 2 | Medium | `tests/integration/day9-part5-db.test.ts` still assumes spend on serve and is expected to fail after Part 2 (stated in Part 2 report). |
| R-3 | Code/DB deploy order | High | Part 1 report: deploying the code before the migration makes campaign list/detail pages error (code selects new columns). Migration first, code second. |
| R-4 | Function re-definition chain | High | See D-3. Rolling back by re-running old files re-introduces old logic and may break newer code. |
| R-5 | Pilot-limits trigger vs existing data | Medium | Trigger blocks new/edited budgets above $1,000 per campaign and $2,000 per advertiser. Existing oversized campaigns are tolerated on rename/pause (by design), but any edit of `total_budget` or reactivation from rejected/archived is checked. Count existing campaigns over the caps before applying (Appendix A, A6). |
| R-6 | Trigger order on `campaigns` | Low | Documented firing order (alphabetical): `campaigns_guard_budget`, `campaigns_guard_changes`, `campaigns_guard_pilot_limits`, `campaigns_guard_pricing`. Trigger names found in files match this. Live trigger list NOT VERIFIED. |
| R-7 | Lock/index impact | Low–Medium | Part 2 adds a table + FOR UPDATE locks on campaign rows; Part 3 adds per-advertiser advisory lock. Run in low-traffic windows. |
| R-8 | Revenue-share config is a data write | Medium | `…test-revenue-share-config.sql` sets `publisher_share_bps = 9000` on `ledger_settings`. TEST only. If ever applied to Production it changes financial config. Ledger stays off. |
| R-9 | No true rollback scripts | High | No down-migrations exist. Reversal = restore from backup, or forward fix. Ledger is append-only (cannot edit; only adjust). Production is on Free plan with no backups per Step 5 G2; not relevant to TEST but blocks any later Production step. |
| R-10 | Secret-name mismatch | Low (not SQL) | Step 5 notes app expects `SUPABASE_SECRET_KEY`, older docs say `SUPABASE_SERVICE_ROLE_KEY`. Owner-side check, no change made. |

Preserved: no schema, data, UUID, FK, index or policy was modified by this inspection.

---

## 8. Findings summary

1. Repo has 86 SQL files but **no CLI migration history** → applied/pending status of anything cannot be proven from the ZIP.
2. Phase 6 Step 2 and Step 3 Part 1 migrations are only OWNER-REPORTED as applied on TEST; one Step 3 report contradicts `MIGRATION-ORDER.md`.
3. Phase 6 Step 4 Part 1, 2, 3 SQL are all **written but NOT RUN**.
4. Phase 6 Step 5 introduced **no SQL**.
5. Duplicate file `phase3-step4-1-pilot-request-metrics.sql` (root vs `supabase/sql/`), comment-only differences.
6. No destructive DDL/DML in Phase 6 files; but Part 2 is a behaviour-breaking billing change.
7. Denim Hub Bsl may be a shared project with non-Blisscco tables.
8. Step 5 readiness report itself says **NO-GO as of 2026-11-11**; no test result in the ZIP has been run by an AI.

---

## 9. Blockers (must clear before Day 1 Part 2 / any execution)

| ID | Blocker | Needed to clear |
|---|---|---|
| B-1 | Live migration history of Denim Hub Bsl NOT VERIFIED | Owner pastes output of Appendix A, A1 |
| B-2 | TEST project identity unconfirmed | Owner confirms dashboard reference ID matches the TEST ref (masked in §4) and that it is the Blisscco TEST project, not shared/live |
| B-3 | Prerequisite chain (Day 3–13, Phase 5) on TEST NOT VERIFIED | Owner pastes outputs of A2–A5 |
| B-4 | Step 3 Part 1 applied status contradictory | Owner pastes A3 |
| B-5 | No TEST backup / rollback point | Owner takes a dump or notes row counts before Part 1 |
| B-6 | Fresh test runs (`npm test`, lint, build, integration) never run by an AI; Step 5 gate G1 open | Owner runs `bash scripts/day28-verify.sh` and pastes result |

---

## Appendix A — READ-ONLY checks for the owner (run in Denim Hub Bsl SQL Editor, SELECT only)

```sql
-- A1. Migration history (may not exist if migrations were applied via SQL Editor)
select version, name from supabase_migrations.schema_migrations order by version;

-- A2. Prerequisite tables / functions present?
select to_regclass('public.ledger_settings')            as ledger_settings,
       to_regclass('public.financial_ledger')           as financial_ledger,
       to_regclass('public.ad_serve_log')               as ad_serve_log,
       to_regclass('public.ad_events')                  as ad_events,
       to_regclass('public.platform_safety_state')      as phase5_emergency_stop,
       to_regclass('public.advertiser_payments')        as phase5_payments,
       to_regclass('public.ad_budget_reservations')     as step4_part2_table;

-- A3. Phase 6 columns present?
select table_name, column_name from information_schema.columns
where table_schema='public' and (
  (table_name='publishers'  and column_name like 'country_%') or
  (table_name='campaigns'   and column_name in ('target_regions','pricing_model','cpm_rate_usd','cpc_rate_usd')) or
  (table_name='advertisers' and column_name='country_code'))
order by table_name, column_name;

-- A4. Triggers on campaigns
select tgname from pg_trigger
where tgrelid='public.campaigns'::regclass and not tgisinternal order by tgname;

-- A5. Ledger / revenue-share state
select ledger_enabled, publisher_share_bps from public.ledger_settings where id;

-- A6. Existing campaigns that would exceed pilot caps
select advertiser_id, count(*) campaigns, sum(total_budget) total_budget, max(total_budget) max_one
from public.campaigns
where status in ('draft','pending_review','active','paused','completed')
group by advertiser_id
having sum(total_budget) > 2000 or max(total_budget) > 1000;
```

Do **not** paste any keys, URLs or passwords with the results.

## Appendix B — Confirmations

- No SQL executed; no DB object modified.
- No Production Supabase or Vercel touched.
- No credentials, keys, tokens or database URLs read or printed (project refs masked).
- Unavailable evidence marked **NOT VERIFIED**; migration status not invented.
- Nothing in this report is marked "verified" or "test completed" for DB-side items; that requires the owner's pasted evidence.

---

## Appendix C — LIVE TEST DB EVIDENCE (added 2026-11-11, read-only)

Method: Supabase connector, **read-only only** (`list_projects`, `list_migrations`, 3 SELECT queries). No DDL, no writes, no Production project queried. Credentials not read. This appendix **supersedes** the "NOT VERIFIED" items in §1, §3, §4, B-1 to B-4 where stated below.

### C1. Project identity — VERIFIED
Connector lists 2 projects in one org: **Denim Hub Bsl** (ref `ficw…uqot`, ap-northeast-2, ACTIVE_HEALTHY) and `Blisscco-Ad-network-` (ref `mfli…jbshu`, Production, not touched). The Denim ref matches the ref in the repo reports. All queries used only the Denim project. Note: P-1 (shared-project risk, non-Blisscco tables) still stands as an owner decision.

### C2. Recorded migration history (23 entries)
Day 3-1, 3-2→3-4, 3-5, 4-1+4-3, 5-1→5-3, 5-6+5-11+7-1, 9-3, 9-5, 12-1 (x2), 12-2, 12-7, 12-10, 12-12, 13-1, 13-4, 13-7, phase4_step3b_1, fix_creative_assets_insert_policy_name_ambiguity, **phase6_step2_1** (2026-11-10), **phase6_step2_2** (2026-11-10), **phase6_step3_1** (2026-11-10), **phase6_step4_part3_pilot_budget_limits_guard** (2026-11-11 01:41 UTC).
Many files are not recorded by name (e.g. Step 4 Part 1, Part 2, revenue-share config, phase5, day-13-9/12/15) but their objects exist, so they were applied outside the recorded history (e.g. SQL Editor) or combined under other names. Exact apply time/person: NOT VERIFIED.

### C3. Phase 6 SQL: live status

| File | Live status | Evidence |
|---|---|---|
| phase6-step2-1 publisher country | **APPLIED (recorded)** | 5 `publishers.country_*` columns, 3 functions present |
| phase6-step2-2 campaign target regions | **APPLIED (recorded)** | `campaigns.target_regions`, `get_campaign_target_regions` |
| phase6-step3-1 advertiser country | **APPLIED (recorded)** | `advertisers.country_code` (resolves D-4: MIGRATION-ORDER row 44 is correct, Step 3 report is stale) |
| phase6-step4-part1 campaign pricing | **APPLIED (object evidence, not in history)** | `pricing_model`, `cpm_rate_usd`, `cpc_rate_usd`, 3 pricing constraints, trigger `campaigns_guard_pricing` |
| phase6-step4-part2 event billing | **APPLIED (object evidence, not in history)** | table `ad_budget_reservations` (0 rows), `settle_event_billing`, `release_expired_budget_reservations`, `campaign_can_afford_serve`; 3-arg `record_ad_serve` references reservations |
| phase6-step4-part3 pilot-limits-guard | **APPLIED (recorded)** | trigger `campaigns_guard_pilot_limits`; function body contains the 1000 / 2000 limits |
| phase6-step4-part3 test-revenue-share-config | **APPLIED (value evidence)** | `ledger_settings`: `ledger_enabled=false`, `publisher_share_bps=9000` |
| phase6-step4-part3 reconciliation-verify | NOT VERIFIED | read-only, leaves no trace; need pasted output |
| phase6-step4-part3 financial-tests | NOT VERIFIED | rollback-only, leaves no trace; need pasted output |
| Phase 6 Step 5 | N/A | no SQL |

**The Step 4 reports saying "NOT RUN on any database" are now stale for TEST.** Update them after the owner confirms.

### C4. Other live facts
- `phase3-step4-1` applied (table `ad_request_metrics_hourly`); `day-13-9` applied (`publisher_payout_requests`, events, settlements). My earlier table-name probes (`pilot_request_metrics`, `payout_requests`) were wrong names, not missing objects.
- Phase 5: `platform_safety_state`, `safety_audit_log`, `advertiser_payments`, `payment_webhook_events` present.
- 35 public tables; **RLS enabled on all** (0 tables without RLS).
- `campaigns_guard_*` trigger set present: budget, changes, pilot_limits, pricing (matches the documented alphabetical order).
- `record_ad_serve` has 2 overloads: 3-arg (Part 2 reservation version) and 4-arg idempotency wrapper that calls the other overload (no direct spend/ledger write). Consistent with design; full behaviour is NOT VERIFIED until the DB tests run.
- `ad_budget_reservations` has 0 rows: Part 2 has not been exercised on persisted data.
- 2 existing campaigns have `total_budget > 1000` (legacy; the guard tolerates rename/pause but checks budget edits).

### C5. Still NOT VERIFIED (next step)
1. Step 4 footer checks (Part 1, Part 2, Part 3) results.
2. `phase6-step4-part3-financial-reconciliation-verify.sql` output (expect ledger off, 0 mismatch rows).
3. `phase6-step4-part3-financial-tests.sql` (rollback-only) result.
4. `npm run test:integration` with TEST env, `scripts/day28-verify.sh`.
5. Whether exact file contents match what was applied (object evidence only).
6. TEST backup / rollback point.

Blockers B-1 to B-4 are cleared by this appendix; B-5 and B-6 remain.

---

## Appendix D — Step 1 evidence: reconciliation verify (2026-11-11)

Source: owner-supplied results (run via ChatGPT on Denim Hub Bsl, read-only, 8/8 queries OK), **independently cross-checked read-only by Claude via connector** for Q1, Q2, Q4, Q6, Q7 (values identical). Q3 and Q5 not re-run separately; they are trivially 0 because the ledger holds no charge rows.

| Check | Result |
|---|---|
| Q1 settings | PASS: `ledger_enabled=false`, `publisher_share_bps=9000` |
| Q2 split balance | PASS: 0 rows |
| Q3 missing splits | PASS: 0 rows (owner-supplied) |
| Q4 duplicate charges | PASS: 0 rows |
| Q5 ledger vs spend | PASS: 0 rows (owner-supplied) |
| Q6 reservations vs charges | PASS: 0 vs 0 |
| Q7 precision | PASS: 0 rows |
| Q8 adjustments | INFO: 1 publisher adjustment 5.0000, source `manual`, created 2026-11-04 (pre-Phase 6); no reversals |

**Status: Step 1 = PASSED (consistency checks only). Real billing = NOT VERIFIED.**

Why these PASSes are weak: `financial_ledger` has exactly 1 row (the adjustment). There are 0 charges, 0 splits, 0 settled reservations, so every zero-row check is vacuous. `ad_serve_log` has 298 rows and `ad_events` 23 rows, but `ad_budget_reservations` has 0: no serve has gone through the Part 2 reservation path yet.

Remaining verification gaps (Phase 6 Step 4 Part 3 / pilot):
1. End-to-end billing never demonstrated: serve → reservation → impression/click → settle (CPM and CPC), duplicate event, expiry/release.
2. 90/10 split with ledger ON: never demonstrated (ledger stays OFF outside a rolled-back transaction).
3. Step 4 Part 1, 2, 3 footer checks: results not supplied.
4. `phase6-step4-part3-financial-tests.sql` (rollback-only): not run.
5. Pilot-limits trigger behaviour (block >$1,000 / >$2,000, concurrency): not run.
6. Integration tests (`npm run test:integration`) and `scripts/day28-verify.sh`: not run.
7. Old test `day9-part5-db.test.ts` expected to fail after Part 2 (known).
8. Orphan manual adjustment of 5.0000 with no charges: owner to confirm it is a known TEST row.

Recommended next controlled tests (TEST only, rollback-only unless owner authorizes writes): financial-tests.sql → footer checks → integration tests → one authorized controlled TEST serve/impression/click run with ledger ON inside a rolled-back transaction.


---

## Appendix E — Step 2 evidence: `phase6-step4-part3-financial-tests.sql` (2026-11-11)

Source: owner screenshot (Supabase SQL Editor, phone browser, project name **Denim Hub Bsl** visible in the top bar). No SQL was executed by Claude for this appendix; evidence is the screenshot plus static comparison with the repo file.

### E1. What the screenshot shows
- Script open in SQL Editor; lines 17–74 visible. They match `supabase/sql/phase6-step4-part3-financial-tests.sql` **line for line at every visible anchor** (`declare` L17, `v_plat_amt` L37, `begin` L38, both `-- FIX:` comments L46 / L66, `issue_publisher_key` L56, CPM setup L59, CPC setup L71). So the visible part is the repo version, including the two FIX patches.
- Result tab: **1 row** — `ledger_enabled = false`, `publisher_share_bps = 9000`, `status = pass: ledger remains off`. This is the script's final post-rollback check (section 11 of the file).

### E2. Interpretation
| Question | Answer |
|---|---|
| Did the rollback leave ledger OFF? | **Yes — shown directly** (`false`, 9000) |
| Did the inner assertions pass? | **PASS (inferred, not directly observed).** The `DO` block raises an exception on any failed assertion; the editor then stops with an error and the final SELECT never returns a row. A returned row therefore means the block finished without exception. |
| What those assertions cover | CPM: serve writes 0 ledger rows; impression bills 0.0020 → 0.0018 publisher + 0.0002 platform; duplicate impression = `duplicate`, no 2nd charge. CPC: impression is free; click bills 0.1234 → 0.1110 + 0.0124; both splits sum to the charge. |

### E3. Caveats (why this is PASS-inferred, not PASS-confirmed)
1. The `NOTICE` text "ALL FINANCIAL INTEGRATION ASSERTIONS PASSED" is not visible in the screenshot.
2. Lines 1–16 and 75–end of the script are not visible; only the visible part is proven identical to the repo.
3. Editor shows "Unsaved edits"; the exact text that was executed cannot be proven.
4. Everything inside was rolled back, so the DB holds no trace to confirm it. Sequences / identity counters may have advanced (harmless, not rolled back by Postgres).
5. Dashboard shows a `main · PRODUCTION` chip beside "Denim Hub Bsl". In Supabase this is the **default-branch label of the project** and does not by itself mean this is the Blisscco Production project (`Blisscco-Ad-network-`). Identity stays as in C1 (Denim = TEST, owner-confirmed). Finding P-1 (shared project) still open.

### E4. Read-only leak check (owner to run in Denim Hub Bsl; SELECT only)
```sql
-- E-1. No leftover test data (expect 0, 0, 0, 0)
select
  (select count(*) from auth.users            where email like '%@blisscco.test')            as test_auth_users,
  (select count(*) from public.campaigns      where name in ('Fin Test CPM','Fin Test CPC')) as test_campaigns,
  (select count(*) from public.advertisers    where company_name = 'Test Fin Advertiser')    as test_advertisers,
  (select count(*) from public.publishers     where name = 'Test Fin Publisher')             as test_publishers;

-- E-2. Row counts vs Appendix D baseline (298 / 23 / 1 / 0) — differences need an explanation
select
  (select count(*) from public.ad_serve_log)            as ad_serve_log,
  (select count(*) from public.ad_events)               as ad_events,
  (select count(*) from public.financial_ledger)        as financial_ledger,
  (select count(*) from public.ad_budget_reservations)  as ad_budget_reservations;
```

### E5. Updated status of the verification gaps from Appendix D
| # | Gap | Status now |
|---|---|---|
| 1 | End-to-end billing (serve → reservation → event → settle, CPM and CPC, duplicate) | **Covered inside a rolled-back transaction: PASS (inferred).** Expiry/release path and persisted (committed) billing: still NOT VERIFIED |
| 2 | 90/10 split with ledger ON | **Covered inside rollback: PASS (inferred).** Ledger confirmed OFF afterwards |
| 3 | Step 4 Part 1/2/3 footer checks | NOT VERIFIED (outputs not supplied) |
| 4 | `financial-tests.sql` | **Run by owner; PASS (inferred)** — see E2/E3 |
| 5 | Pilot-limits trigger behaviour (>$1,000 / >$2,000, concurrency) | NOT VERIFIED (not exercised by this script) |
| 6 | `npm run test:integration`, `scripts/day28-verify.sh` | NOT VERIFIED |
| 7 | Old `day9-part5-db.test.ts` expected to fail | Known, unchanged |
| 8 | Orphan manual adjustment 5.0000 | Owner confirmation pending |

### E6. Recommended next step (TEST only)
1. Run E-1 and E-2 above and paste the two result rows (no keys/URLs) — closes caveat 4.
2. Paste the Part 1, Part 2 and Part 3 footer-check outputs (gap 3).
3. Run pilot-limits trigger tests (gap 5), rollback-only.
4. Run `npm run test:integration` with TEST env and `bash scripts/day28-verify.sh` (gap 6).
5. Update the stale "NOT RUN" wording in `PHASE6-STEP4-PART{1,2,3}-*.md` after the owner confirms.

Confirmations: no SQL executed by Claude, no Production touched, no credentials read or printed, nothing marked verified beyond what the screenshot supports.

---

## Appendix F — CI and DB integration results (2026-11-12)

Source: owner screenshot of GitHub Actions (branch `preview-day-c`) plus the failure logs the owner pasted in chat. Pass/fail counts for the final runs were NOT in the screenshot: **NOT VERIFIED** (only the green/red status is).

### F1. Run history (as shown / reported)
| Run | Result | Note |
|---|---|---|
| CI #120 | FAIL | Claude's retry loop in `ci.yml` broke the CI contract tests (parser expects single-line `run: npm run build`). Reverted. |
| CI #123 | FAIL | Fix SQL file inside `supabase/sql` broke Day 12 architecture test (it lists files that mention `serve_ref`). |
| DB integration #14 / #15 / #16 | FAIL | #14: stale tests; #15: rollback test, pilot-limits setup, idempotency; #16: `column q.serve_id does not exist` (see F2). |
| **CI #124** | **PASS** (screenshot, 1m 52s) | |
| **DB integration #17** | **PASS** (screenshot, 6m 38s) | Counts not visible: NOT VERIFIED. |

### F2. New findings
| # | Finding | Status |
|---|---|---|
| F-1 | TEST (Denim) was missing the day-12-5 retry pieces: `ad_serve_requests.serve_id`, 4-arg `record_ad_serve`, `private.replay_serve` with `serve_ref`, `find_idempotent_serve`. Evidence: retry response had no `serve_ref`; after a replay_serve-only change, error `column q.serve_id does not exist`. | Fix script `phase6-fix-idempotency-retry-TEST-ONLY.sql` prepared by Claude (not executed by Claude). Applied on TEST by owner: **OWNER-REPORTED / implied by run #17, not independently verified** |
| F-2 | Migration-order hazard: `day-9-7-lifecycle-guards.sql` also defines `private.replay_serve` (without `serve_ref`). Re-running it after day-12-5 reverts retry to the old shape. | Open (repo hazard, no change made) |
| F-3 | Re-running `day-12-5` as a whole would overwrite the Phase 6 reservation-based 3-arg `record_ad_serve`. Never re-run it whole. | Open warning |
| F-4 | `campaigns.total_budget` / `daily_budget` are `numeric(12,2)`; per-serve holds are $0.0001-scale. Budgets below $0.01 are impossible; several integration tests assumed otherwise. | Tests fixed; not a pilot blocker |
| F-5 | Day 16 / 18 / 9 integration tests were stale after Phase 6 Step 4 Part 2 (`billed` field, charge moved from serve to impression). | Tests updated, now pass |
| F-6 | **PRODUCTION** may have the same F-1 gap. | **NOT VERIFIED** (nothing run on Production) |

### F3. Still open
1. Production read-only check for `ad_serve_requests.serve_id` (F-6).
2. Post-run leak check on Denim for leftover test rows (`campaigns` where name like 'it%\_%'; `auth.users` where email like '%@example.test' with `it` tag).
3. Rotate the TEST DB password (it was pasted in chat) and update the GitHub secret.
4. Owner confirmation of the orphan manual adjustment 5.0000 (gap 8, Appendix D).
5. Refresh stale "NOT RUN" wording in `PHASE6-STEP4-PART{1,2,3}-*.md`.
6. Decide on P-1 (Denim is a shared project with non-Blisscco tables).


---

## Appendix G — Final status ledger (2026-11-12)

Labels: **VERIFIED** = proof exists in this engagement (pasted query output, Actions screenshot or log). **CONFIRMED BY USER** = owner statement without an independent artefact. **INFERRED** = follows logically from verified evidence. **OPEN** = not proven. Claude executed no SQL and touched no Production resource.

| # | Item | Label | Evidence |
|---|---|---|---|
| 1 | Denim Hub Bsl is the TEST project | **CONFIRMED BY USER** + **VERIFIED** (name) | Owner states it; dashboard screenshot shows the project name; earlier connector listing showed ref `ficw…uqot` (masked) matching the repo reports |
| 2 | `financial-tests.sql` run on Denim | **VERIFIED** (executed) / **INFERRED** (assertions pass) | Screenshot: final row `false / 9000 / pass: ledger remains off`; DO block raises on any failed assertion |
| 3 | Revenue share 9000 bps, ledger OFF | **VERIFIED** | Same screenshot; `ledger_settings` enabled count 0 |
| 4 | Part 1 footer checks V1, V2, V4, V5 | **VERIFIED (PASS)** | Owner query output: 3 / 6 / 1 / 0 |
| 5 | Part 2 footer checks 1, 2, 3 (count), 4 (count), 7 | **VERIFIED (PASS)** | Owner query output: true / 0 / 4 / 0 / 0 |
| 6 | Part 3 footer checks 1, 2 | **VERIFIED (PASS)** | Owner query output: 1 / 0 |
| 7 | Part 1 V3, V6; Part 2 checks 5, 6; Part 3 check 3 | **OPEN** | Not run |
| 8 | Leak check after financial tests | **VERIFIED** | 0 test users / campaigns; counts 298 / 23 / 1 / 0 as baseline |
| 9 | Leak check after integration runs | **VERIFIED and cleaned** | 2 stale `it6s4p3_*` users found, removed by owner, re-check = 0 |
| 10 | Pilot-limits trigger behaviour | **VERIFIED (green)** | `phase6-step4-part3-pilot-limits-db.test.ts` inside DB integration #17 |
| 11 | Event billing, tracking, retry integration tests | **VERIFIED (green)** | DB integration #17 green; counts **not visible** |
| 12 | `npm ci / lint / test / eslint / build` | **VERIFIED (green)** | CI #124 (same five commands as `scripts/day28-verify.sh`; script not run separately) |
| 13 | Retry pieces restored on TEST | **VERIFIED (indirect)** | Retry tests failed with `column q.serve_id does not exist`, then passed in #17 after the TEST-only script |
| 14 | Orphan manual adjustment 5.0000 | **CONFIRMED BY USER** | Owner: test entry |
| 15 | Test-file fixes and `package.json` serial run committed | **VERIFIED** | CI #124 and DB integration #17 ran on the new commits |
| 16 | Production `serve_id` column | **OPEN** | Owner reported a result of 1 but did not say which project it was run on. Needs confirmation. Production `replay_serve` check: not run |
| 17 | Pass counts of run #17 | **OPEN** | Not visible in the screenshot |
| 18 | `test-revenue-share-config.sql` and `financial-reconciliation-verify.sql` executed on TEST | **OPEN** | No output seen (the 9000 bps value itself is proven) |
| 19 | TEST DB password rotated | **OPEN** | Password was pasted in chat; rotation not confirmed |
| 20 | Denim is a shared project (non-Blisscco tables) | **OPEN** | Owner decision (finding P-1) |
| 21 | Stale "NOT RUN" wording in Phase 6 reports | **DONE** | `PHASE6-STEP4-PART1/2/3` and `PHASE6-STEP5` reports, `supabase/MIGRATION-ORDER.md` updated with dated notes |

### Blockers for the next phase
None on TEST for the items above. Remaining before any Production step: items 16 to 20, plus the owner gates listed in `PHASE6-STEP5-FINAL-PILOT-READINESS-REPORT.md` (still NO-GO there).
