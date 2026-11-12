# PHASE 6 — DAY 1 — PART 2: TEST SUPABASE MIGRATION VERIFICATION REPORT

Date: 2026-11-12
Mode: **READ-ONLY verification on TEST.** No DDL, no writes, no migration applied by me. No Production project queried. No secrets or connection strings read or printed.
Inputs: latest `blisscco-ad-network.zip`, `PHASE6-DAY1-PART1-DATABASE-INVENTORY-REPORT.md` (incl. Appendix G).

Status labels: **VERIFIED-LIVE** (I ran the query on TEST now) · **OWNER-EVIDENCE** (from Part 1 appendices, not re-run now) · **STATIC** (file read only) · **OPEN**.

---

## 1. TEST project identity (Task 1)

| Check | Result |
|---|---|
| Connector lists 2 projects in one org | `Denim Hub Bsl` (ref `ficw…uqot`, ap-northeast-2, ACTIVE_HEALTHY) and `Blisscco-Ad-network-` (ref `mfli…jbshu`, Production, **never touched**) |
| Ref matches the TEST ref recorded in the repo reports (masked) | **YES** |
| Every statement in this part used project id of `Denim Hub Bsl` only | **YES** |
| Owner confirmation that Denim = TEST | CONFIRMED BY USER (Part 1, App. G #1) |
| Finding P-1 (Denim also holds non-Blisscco tables, shared project) | **STILL OPEN** (owner decision) |

Identity is proven by name + ref + owner statement. **Not a STOP condition.**

---

## 2. Pending-migration decision (Tasks 2 and 3)

Live migration history (23 entries) was re-read and is **identical** to Part 1 Appendix C. Live objects show every Phase 6 SQL file is already in place. Per the rule "skip already-applied, never blindly rerun", **I applied nothing.**

| # | SQL file | Live status | Action |
|---|---|---|---|
| 42 | phase6-step2-1-publisher-country-verification | Applied, in history (2026-11-10) | SKIPPED |
| 43 | phase6-step2-2-campaign-target-regions | Applied, in history (2026-11-10) | SKIPPED |
| 44 | phase6-step3-1-advertiser-country | Applied, in history (2026-11-10) | SKIPPED |
| 45 | phase6-step4-part1-campaign-pricing | Applied (objects verified live; not in history table) | SKIPPED |
| 46 | phase6-step4-part2-event-billing | Applied (objects verified live; not in history table) | SKIPPED |
| 47 | phase6-step4-part3-pilot-limits-guard | Applied, in history (2026-11-11 01:41 UTC) | SKIPPED |
| 48 | phase6-step4-part3-test-revenue-share-config | Applied (value 9000 + audit row 2026-11-11 01:41:04 UTC) | SKIPPED |
| 49 | phase6-step4-part3-financial-reconciliation-verify | Read-only | **RUN NOW — all pass** (section 4) |
| — | phase6-step4-part3-financial-tests (rollback-only) | Run earlier by owner (PASS inferred) | **NOT re-run by me** (section 5) |

**Pending migrations: 0.**

### Static review (file read, grep-level, not a line-by-line proof)

| Area | Finding |
|---|---|
| Transaction safety | Step 4 migrations: 1 `begin` / 1 `commit` each. Verify file: no transaction. Financial-tests: `begin` + `rollback`, no commit |
| Destructive SQL | None (`DROP TABLE`, `TRUNCATE`, `DELETE FROM`, `DROP COLUMN` = 0 in all six files) |
| Idempotency | Part 1, 2, guard use `create or replace`, `if not exists`, `drop trigger/constraint if exists` + re-create. Config = plain `UPDATE` (re-runnable, same value) |
| RLS | `ad_budget_reservations` has RLS on, zero app-role table grants (live-verified) |
| Function permissions | Part 2 functions are `security definer`, no EXECUTE for PUBLIC/anon/authenticated (live-verified); guard function has no EXECUTE for any app role (live-verified) |
| search_path | Guard function uses `set search_path = ''`; Part 1 has 1 and Part 2 has 9 `set search_path` for 9 `security definer` functions |
| Financial precision | `financial_ledger.amount` numeric(14,4), `ad_budget_reservations.amount` numeric(12,4), rates numeric(10,4); 0 ledger rows with >4 decimals |
| Compatibility | Part 2 changes billing (charge moves from serve to impression/click) — backward-incompatible by design (Part 1 R-1) |

**Re-run hazards (unchanged, do NOT re-run):** day-9-3, 9-5, 9-7, 12-5, 12-7, 12-10, 13-4 redefine functions that Part 2 replaced. Re-running them reverts billing to the old charge-on-serve shape (D-3, F-2, F-3).

---

## 3. Footer verification queries — LIVE on TEST (2026-11-12)

| Check | Expected | Actual | Result |
|---|---|---|---|
| P1 V1 pricing columns | numeric / numeric / text | `cpc_rate_usd numeric(10,4)`, `cpm_rate_usd numeric(10,4)`, `pricing_model text` | PASS |
| P1 V2 pricing constraints | 6 | 6 | PASS |
| P1 V3 rows with pricing | 0 until new edits | 0 of 6 | PASS |
| P1 V4 trigger `campaigns_guard_pricing` | 1 | 1 | PASS |
| P1 V5 anon grants on pricing columns | 0 | 0 | PASS |
| P1 V6 platform settings unchanged | cpm 2 / limit 60 | 2.0000 / 60 | PASS |
| P2 C1 RLS on reservations | true | true | PASS |
| P2 C2 app-role table grants | 0 | 0 | PASS |
| P2 C3 functions, all security definer | 4 | 4, all true | PASS |
| P2 C4 EXECUTE for PUBLIC/anon/authenticated | none | none | PASS |
| P2 C5 settled vs spend | 0 | 0 | PASS (vacuous, 0 reservations) |
| P2 C6 campaigns over budget | 0 | 0 | PASS |
| P2 C7 ledger enabled count | 0 | 0 | PASS |
| P3 C1 trigger `campaigns_guard_pilot_limits` | active | `O` (enabled) | PASS |
| P3 C2 guard function grants | 0 | 0 | PASS |
| P3 C3 advertisers over $2,000 (info) | info | 2 (legacy; guard tolerates rename/pause) | INFO |
| Campaigns over $1,000 (info) | info | 2 (legacy) | INFO |
| Public tables / without RLS | 35 / 0 | 35 / 0 | PASS |
| `campaigns_guard_*` triggers | budget, changes, pilot_limits, pricing | all four present | PASS |

## 4. Reconciliation verify (`…financial-reconciliation-verify.sql`) — LIVE, SELECT only

| Query | Expected | Actual | Result |
|---|---|---|---|
| Q1 settings | ledger false | `(false, 9000)` | PASS |
| Q2 split mismatch | 0 | 0 | PASS |
| Q3 missing split | 0 | 0 | PASS |
| Q4 duplicate charges | 0 | 0 | PASS |
| Q5 ledger > spend | 0 | 0 | PASS |
| Q6 settled vs charges | charges ≤ settled | 0 / 0 | PASS |
| Q7 precision | 0 | 0 | PASS |
| Q8 adjustments (info) | info | 1 publisher adjustment, 5.0000 (known TEST entry, owner-confirmed) | INFO |
| Config audit row | 9000 logged | `null → 9000` at 2026-11-11 01:41:04 UTC | PASS |

**Caveat (unchanged from Part 1 App. D):** the ledger has only 1 row (the adjustment), so every zero-row check is vacuous. They prove consistency, not billing correctness.

## 5. Rollback-only financial test and leak check

- `phase6-step4-part3-financial-tests.sql` was run by the owner earlier (screenshot, final row `false / 9000 / pass: ledger remains off`). Assertions passed = **INFERRED**, not directly observed.
- **I did not re-run it.** The script enables the ledger inside a transaction; through the connector I cannot prove the transaction boundary and rollback behave identically, and a failed run could leave unintended state. Not "safe and compatible" enough to execute blind. Owner can rerun it in the SQL Editor if a fresh result is wanted.
- **Leak / unintended-change check (LIVE):**

| Item | Baseline (Part 1) | Now |
|---|---|---|
| `ad_serve_log` | 298 | 298 |
| `ad_events` | 23 | 23 |
| `financial_ledger` | 1 | 1 |
| `ad_budget_reservations` | 0 | 0 |
| test auth users (`@blisscco.test`, `@example.test`) | 0 | 0 |
| test campaigns / advertisers / publishers | 0 / 0 / 0 | 0 / 0 / 0 |
| `ledger_enabled` | false | false |

No unintended data change.

---

## 6. Errors

None. One of my own verification queries failed with a SQL typing error (`text || "char"`, no cast); it was read-only, wrote nothing, and was re-run with the cast.

## 7. Remaining blockers / open items

1. **P-1:** Denim Hub Bsl holds non-Blisscco tables (shared project). Owner decision.
2. Persisted (committed) billing never exercised: `ad_budget_reservations` has 0 rows; expiry/release path not verified.
3. Fresh run of `financial-tests.sql` assertions not directly observed (NOTICE text never seen).
4. Part 1 / Part 2 migrations are not named in `schema_migrations` (applied via SQL Editor); exact file-content match with live objects is object-evidence only.
5. TEST DB password rotation not confirmed (Part 1 App. G #19).
6. Production items (G #16, serve_id check) untouched here; Production stays out of scope.
7. Step 5 readiness report still NO-GO.

## 8. Conclusion

**All Phase 6 SQL files were already applied on TEST. Nothing was pending, so nothing was applied.** Live verification of Part 1, 2, 3 footer checks and the reconciliation queries: all PASS. TEST data unchanged, ledger OFF, 9000 bps set, no Production access.
