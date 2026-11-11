# PHASE 6 — DAY 1 — PART 1: TEST DATABASE & SQL INVENTORY REPORT

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
