# Phase 6 Step 4 Part 3: Publisher Revenue Share (90/10) & Financial Reconciliation

Status: code, SQL aur tests likhe gaye. **Koi SQL kisi bhi database par CHALAYI NAHI gayi.** Production untouched. Ledger OFF.

## 1. Implemented features
- 90/10 config: `supabase/sql/phase6-step4-part3-test-revenue-share-config.sql` (sirf `publisher_share_bps = 9000`, TEST ONLY; `ledger_enabled` ko chhoota nahi). Default value kahin nahi (existing test "no default" bachta hai).
- `lib/ledger/reconciliation.ts`: pure BigInt module (`reconcileSplit`, `reconcileServeEntries`); split `splitCharge` se, naya math nahi.
- `lib/ledger/revenue-share.ts`: sirf comment update (logic same).
- Pilot limits DB guard: `phase6-step4-part3-pilot-limits-guard.sql` (trigger `campaigns_guard_pilot_limits`, per-advertiser advisory lock). Gap G1 (read-then-write race) aur G2 (direct API insert/update bypass) band karta hai. App-level files (`constants.ts`, `budget-rules.ts`, `pilot-limits.ts`, `pilot-guard.ts`) CHANGE NAHI.
- `lib/campaigns/errors.ts` (2 naye hint messages) aur `campaigns/actions.ts` (2 hints map) .
- Read-only reconciliation verify SQL aur rollback-only DB test SQL (TEST par haath se chalani hain).
- Ledger wiring Part 2 mein pehle se tha (`settle_event_billing` -> `ledger_record_event`); Part 3 mein SQL badla nahi, sirf tests aur verify.

## 2. Exact changed file paths
NEW (12): 4 SQL (`supabase/sql/phase6-step4-part3-*.sql`), `lib/ledger/reconciliation.ts`, 4 tests (`tests/ledger/` x2, `tests/ads/` x1, `tests/campaigns/` x1), `tests/integration/phase6-step4-part3-pilot-limits-db.test.ts`, is report, `CHANGED-FILES-PHASE6-STEP4-PART3.txt`.
MODIFIED (8): `lib/ledger/revenue-share.ts` (comment), `lib/campaigns/errors.ts`, `app/dashboard/advertiser/campaigns/actions.ts`, `supabase/MIGRATION-ORDER.md` (rows jode), 4 purane tests (sirf allow-list ki ek line: `day12-part1-architecture`, `day13-part1-ledger`, `day13-part2-service`, `phase6-step4-part1-pricing`).

## 3. Test commands and results
Commands: `npm ci`, `npm run lint`, `npm test`, `npm run test:integration` (TEST_* env chahiye, warna SKIP).
Results: **NOT RUN** (is review me npm / Postgres nahi chala). Pehle sirf `npm test` ka asli result likhna hai jab aap Termux par chalayen.

## 4. TEST database verification status
Sab 4 SQL files **written, NOT run**. Order (denim par): pilot-limits-guard -> test-revenue-share-config -> reconciliation-verify -> financial-tests (rollback-only). Integration test bhi NOT run.

## 5. Remaining blockers
- TEST DB par SQL aur integration tests chalana baaki; Production ke liye alag approval.
- `tests/integration/day9-part5-db.test.ts` ab bhi serve par spend maanta hai (Part 2 note).
- `load_ad_candidates` holds nahi dekhta; `lib/ads/service.ts` / `serve.ts` ke purane "charge on serve" comments (Part 2 notes).
- Ledger tabhi ON ho jab share set ho (share NULL + ledger ON = sirf charge, split nahi).

## 6. Explicitly untested
Real Postgres behaviour (trigger, advisory lock, rollback), real concurrency, Production, payouts, real money.

## 7. Confirmations
Ledger OFF, no Production SQL, no backfill, no payouts/payments activation, no client-side financial math, no credentials exposed.

---

## UPDATE 2026-11-12 — results (supersedes "NOT RUN" in sections 3 and 4)
Evidence labels used in these updates: **VERIFIED** = proof exists (pasted query output, GitHub Actions screenshot or log); **CONFIRMED BY USER** = owner statement, no independent artefact; **INFERRED** = follows logically from verified evidence; **OPEN** = not proven. Production was not touched; no Production SQL was run for any item below.

| Item | Status | Evidence |
|---|---|---|
| `phase6-step4-part3-pilot-limits-guard.sql` applied on TEST | **VERIFIED** | Footer: trigger `campaigns_guard_pilot_limits` present and enabled (1); 0 EXECUTE grants on `private.guard_pilot_campaign_limits` |
| Pilot-limits trigger behaviour ($1,000 per campaign, $2,000 per advertiser, 30 parallel inserts) | **VERIFIED (green)** | `phase6-step4-part3-pilot-limits-db.test.ts` inside DB integration run #17 (it had been cancelled in earlier runs by a test-setup error; fixed) |
| Revenue-share config on TEST | **VERIFIED** | `financial-tests.sql` final check returned `publisher_share_bps = 9000`, `ledger_enabled = false` |
| `phase6-step4-part3-test-revenue-share-config.sql` itself | **OPEN** | The 9000 bps value is proven, but running this specific file was not evidenced |
| `phase6-step4-part3-financial-reconciliation-verify.sql` | **OPEN** | No output seen |
| `phase6-step4-part3-financial-tests.sql` (rollback-only) | **VERIFIED executed; assertions PASS (INFERRED)** | Owner screenshot on Denim: the DO block finished and the post-rollback check returned `false / 9000 / pass: ledger remains off`. The DO block raises on any failed assertion, so a returned row means all assertions passed. The notice text was not visible |
| Covered by that run | VERIFIED (inferred as above) | CPM serve writes no ledger row; impression bills $0.0020 as $0.0018 + $0.0002; duplicate impression does not bill again; CPC impression is free; CPC click bills $0.1234 as $0.1110 + $0.0124 |
| Leftover test data after the run | **VERIFIED clean** | Read-only check: 0 `@blisscco.test` users, 0 `Fin Test` campaigns, 0 test advertisers/publishers; row counts 298 / 23 / 1 / 0 matched the baseline |
| Leftover rows from failed integration runs | **VERIFIED and cleaned** | 2 stale `it6s4p3_*` users (advertiser rows only, no campaigns) were found and removed by the owner; re-check returned 0 |
| `npm ci`, `npm run lint`, `npm test`, `npm run lint:eslint`, `npm run build` | **VERIFIED (green)** | GitHub Actions CI #124 (same five commands as `scripts/day28-verify.sh`; the script itself was not run separately) |
| Orphan manual adjustment of 5.0000 in the ledger | **CONFIRMED BY USER** | Owner states it was a test entry |
| Ledger | **VERIFIED OFF** | `ledger_enabled` false after the financial tests; `ledger_settings` count of enabled rows = 0 |
| Production | **OPEN** | Not touched, not verified |
