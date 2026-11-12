# PHASE 6 — DAY 2 — PART 2: CPM/CPC Valid Event Billing Lifecycle Verification

Date: 2026-11-12 | Source: uploaded `blisscco-ad-network.zip` + Day 1 reports | Sandbox: no network, no TEST DB secret, no `npm ci`

**Evidence labels:** **STATIC** = code/SQL read · **MODEL** = hand-written model/fake tests (NOT PostgreSQL) · **REAL-CODE** = real TypeScript code with fake writer · **DB-GITHUB** = real TEST PostgreSQL, run by owner on GitHub (owner-supplied, not re-observed by me) · **NOT RUN** = I did not execute it.

> **No real PostgreSQL verification was done by me in this part.** The three DB statements below rest on Day 1 evidence (DB integration run #18) only.

## 1. Pass / fail counts (my runs, this part)

| Suite | Tests | Pass | Fail | Kind |
|---|---|---|---|---|
| `tests/ads/phase6-step4-part2-event-billing.test.ts` | 50 | 50 | 0 | STATIC + MODEL |
| `tests/ledger/phase6-step4-part2-event-ledger.test.ts` | 14 | 14 | 0 | STATIC + MODEL |
| `tests/integration/phase6-step4-part2-event-billing-db.test.ts` | 21 (static count) | — | — | **NOT RUN** (skipped: `TEST_DATABASE_URL` not set) |
| **New** `tests/ads/phase6-day2-part2-billing-lifecycle.test.ts` | 16 | 16 | 0 | REAL-CODE + MODEL |
| All `tests/ads` | 3521 | 3511 | 10 | 10 = environment only (`@types/node`, `next` missing); same 10 as Part 1 |
| All `tests/ledger` | 177 | 177 | 0 | |
| All `tests/regions` | 268 | 268 | 0 | |

## 2. Actual DB evidence (from Day 1, not re-run)

| Evidence | Result | Source |
|---|---|---|
| DB integration run #18 (branch `preview-day-c`) | 98 passed, 0 failed, 0 skipped, 12 suites (includes the 21 tests of the billing DB file) | DB-GITHUB, owner-supplied (screenshot of a summary, not the GitHub page) |
| Phase 6 Step 4 Part 2 migration on TEST | Applied; footer checks P2 C1–C7 PASS | Day 1 Part 2 report (LIVE in that session) |
| TEST state | 0 reservations, 0 settled, budgets never exceeded, ledger OFF, 9000 bps | Day 1 Part 2 (LIVE in that session) |
| Rollback tests (event/spend/hold roll back together) | PASS inside run #18 | DB-GITHUB |

## 3. CPM matrix (price = CPM/1000, min $0.0001)

| Step | Expected | Real-DB test (run #18) | MODEL / REAL-CODE |
|---|---|---|---|
| Serve | Hold only, spend 0, no event | "serving reserves budget but charges nothing" | MODEL + chain test |
| 1st valid impression | Settle once (held → settled) | "CPM: first valid impression charges once" | MODEL + chain test |
| Impression replay (5x same token) | `duplicate`, no charge | same test (duplicate) | chain test: spend stays 20 units |
| Click | Recorded, never charged | same test | MODEL + chain test |
| Campaign without pricing | Platform CPM | "...campaigns without pricing use the platform CPM" | MODEL |
| Settlement error | Event, spend, hold roll back; retry bills once | rollback tests | MODEL + chain test |

## 4. CPC matrix (price = campaign `cpc_rate_usd`, snapshot at serve)

| Step | Expected | Real-DB test (run #18) | MODEL / REAL-CODE |
|---|---|---|---|
| Serve | Hold only, spend 0 | serve test | MODEL |
| Impression | Recorded, free | "CPC: impression is free..." | MODEL + chain test |
| Click before impression | `not_counted`, redirect only, free | same test | chain test |
| 1st click after impression | Settle once | same test | chain test: 150 units once |
| Click replay (4x) | `duplicate`, free | same test | chain test |
| Rate change after serve | Charge = serve-time snapshot | "price snapshot" test | MODEL |
| Click after 24h | `rejected`, free | "expired events never charge" (25h) | MODEL boundary (new) |

## 5. Invalid / expired / tampered / replayed events (all: no charge)

| Case | Result | Evidence |
|---|---|---|
| Tampered signature, edited payload, extended expiry, other publisher tag, wrong secret, unknown serve, wrong publisher, garbage, empty | `unauthorized` (impression) / `invalid` (click); **writer never called**, spend 0, hold stays `held` | REAL-CODE (new) |
| Click ref used as impression token and the reverse; event names `click`/`serve` for an impression | refused, 0 writes | REAL-CODE (new) |
| Other-creative / foreign-secret click ref | `invalid`, 0 writes | REAL-CODE (new) |
| No tracking secret | `unavailable` (503), no charge | REAL-CODE (new) |
| Token expiry (default 1 h) | valid at +1 h − 1 ms, dead at +1 h; unused hold later released | REAL-CODE (new) |
| Unknown serve, wrong publisher/creative, malformed ref, legacy serve, paused campaign, inactive publisher | no charge | DB-GITHUB (run #18) + MODEL |
| 30x parallel same impression / click | one record, one charge | DB-GITHUB (run #18) |

## 6. 24 h reservation lifecycle

| Case | Result | Evidence |
|---|---|---|
| Window boundary | 24 h − 1 ms bills; exactly 24 h and later `rejected`, free (impression and CPC click) | MODEL (new). SQL read: `now() >= served_at + 24h` matches `expires_at <= now()` (STATIC) |
| Max-lifetime token (24 h) | valid at +24 h − 1 ms (billed), dead at +24 h (0 writes) | REAL-CODE (new) |
| Held → settled | Settled hold is never released; release is idempotent | MODEL (new) |
| Held → released (unused) | Expired hold stops counting; late event cannot charge it; budget reusable at exactly 24 h | MODEL (new); DB: "expired holds stop counting... released on next serve" (run #18, 25 h) |
| UTC accounting | Spend lands on the serve's UTC day (23:59:59.999 serve, next-day event); 00:00:00.000 belongs to the new day | MODEL (existing + new); DB asserts `reserve_day` = DB UTC date (run #18) |
| Retry | Failed settlement writes nothing; same token then bills once; Idempotency-Key retry keeps same serve_ref and one reservation | MODEL (new) + DB-GITHUB |
| Inactive publisher event | Recorded, never charged, cannot be charged later | MODEL (new) |

## 7. Findings and unresolved issues

No billing defect found. No code, SQL or CI changed. Day 1 restrictions kept (no re-run of `day-12-5-serve-ref-return.sql` or older lifecycle SQL; no Production; ledger OFF).

1. **Not proven in real PostgreSQL by me:** the exact 24 h boundary (DB tests use 25 h; `now()` cannot be pinned exactly), a committed (non-rollback) billing run with ledger ON, and the bulk release of expired holds on a real DB. Suggested TEST-only DB tests (not added, because I cannot run them): (a) serve backdated to 23 h 59 m still bills; (b) `release_expired_budget_reservations()` releases an expired unused hold and leaves settled and live holds untouched. Run them only on TEST.
2. **Token lifetime vs hold lifetime:** default `AD_TRACKING_TTL_SECONDS` is 1 h (max 24 h) while the hold lasts 24 h. An impression or click reported after the token lifetime is refused (no charge) and the hold is released unused. Not a defect, but publishers must report within the token lifetime. Decision for owner: keep 1 h or raise toward 24 h.
3. **Bulk release has no caller:** `public.release_expired_budget_reservations()` is not called from app code, CI or scripts (STATIC grep). Budget is unaffected (expired holds already stop counting), but `status` stays `held` until the next serve of that campaign or a manual call. Low; bookkeeping only.
4. **Pre-filter price mismatch (low, STATIC):** the TypeScript budget pre-filter uses one platform price per request, while the reservation uses the campaign's CPM or CPC rate. The database guard is authoritative, so no overspend; a lost fill is possible in edge cases (same class as the Part 1 reserved-budget item).
5. **Existing Part 1 pending items** are unchanged (see `PHASE6-DAY2-PART1-PENDING-DECISIONS.md`).
6. 10 environment-only failures in `tests/ads` (need `npm ci`); confirm green in CI.

## 8. Changed files

| File | Change |
|---|---|
| `tests/ads/phase6-day2-part2-billing-lifecycle.test.ts` | New, 16 tests |
| `PHASE6-DAY2-PART2-BILLING-LIFECYCLE-REPORT.md` | New |
