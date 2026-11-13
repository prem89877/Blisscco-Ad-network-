# PHASE 6 — DAY 2 — FINAL VERIFICATION REPORT (Parts 1–4)

Date: 2026-11-13 · Branch: `preview-day-c` · Scope: TEST / Preview only. No Production change, no deploy, no live key, no real publisher contacted, no payments/payouts.

## 1. Verdicts (two separate statuses)

| | Status |
|---|---|
| **TEST verification (Day 2)** | **PASS WITH OPEN ITEMS.** Publisher API, tracking, limits, 90/10 math verified on TEST/Preview. Real billing correctness **UNPROVEN**; valid-ad response and live 503 **NOT TESTED** |
| **Production GO/NO-GO** | **NO-GO.** A green Day 2 does **not** authorize the 1 December 2026 pilot |
| Gates A–D | **NOT CONFIRMED** (deferred to publisher onboarding; no written publisher evidence) |
| Real publisher keys | **NO-GO** |
| Ledger / payments / payouts | OFF / disabled (live-checked in Part 3) |

## 2. Evidence labels
**STATIC** = code/SQL read · **REAL-CODE** = real TypeScript, fake writer · **LIVE-TEST-DB** = owner-run SQL on TEST, output seen · **CI-OWNER** = GitHub run, owner-supplied · **LIVE-PREVIEW** = owner-run curl on Vercel Preview, output seen · **SANDBOX** = my offline run (no network).
Mocked, skipped or unavailable = never PASS.

## 3. Test runs

| Run | Total | Pass | Fail | Skipped | Evidence |
|---|---|---|---|---|---|
| CI #129 (`b0aae56`) | 5,583 | 5,582 | **1** | 0 | CI-OWNER |
| CI #130 (`2b05b30`, after SQL comment fix) | not seen | green | — | — | CI-OWNER (screenshot: green, 1m59s) |
| DB integration #21 (TEST DB only) | 98 | 98 | 0 | 0 | CI-OWNER (incl. event billing 21, pilot-limits guard 2) |
| DB integration #22 (TEST DB only) | not seen | green | — | — | CI-OWNER (screenshot: green, 6m0s) |
| `tests/publisher/*` (SANDBOX) | 315 | 313 | 1 | 1 | SANDBOX |
| 11 `tests/ads` handler files (SANDBOX) | 448 | 448 | 0 | 0 | SANDBOX |

- CI #129 failure: static guard "no existing (non Day 13) SQL file mentions the new ledger service objects"; file `phase6-day2-part3-pilot-limits-boundary-rollback.sql`, **line 6 comment** contained `ledger_settings`. Comment-only fix; no SQL statement changed; #130 green.
- SANDBOX 1 fail + 1 skip = `@types/node` / `next` / `@types/react` not installed (no network). Not counted as PASS; CI is the evidence.

## 4. Implemented (verified present in code/SQL)

| Item | Evidence |
|---|---|
| `POST /api/v1/ads/match`: Bearer auth, IP failure guard (20/min, app), 429 `Retry-After: 60`, 415/413/400, emergency stop (stopped = no-fill, read error = 503), crash → generic 503 | STATIC + REAL-CODE |
| `POST /api/v1/ads/impression` (token only, strict body, duplicate → 200 `duplicate`) | STATIC + REAL-CODE |
| `GET /api/v1/ads/click` (`ref` only, prefetch 204, 302 `no-referrer`, HEAD/POST 405) | STATIC + REAL-CODE |
| Safe public response: 5 fields (+3 optional), `sponsored: true` literal, `no-store`, `Vary: Authorization`, no CORS | STATIC + contract tests |
| Publisher example/SDK: impression only when on screen, click via `click_ref`, `safeHref` https only, bounded retry | STATIC + tests/publisher |
| Matching, category, country/regional eligibility (flag-gated) | Part 1 |
| Budget reservations; CPM at impression, CPC at click; 24 h hold | Part 2 |
| `campaigns_guard_pilot_limits` ($1,000 / $2,000); G-1 reopen guard (TEST only) | Part 3 |
| 90/10 split (`publisher_share_bps=9000`, truncate 4 dp, platform remainder) | Part 3 |
| Vercel firewall rule `ads-rate-limit` (600 req / 60 s / IP, deny 429) | Update 2 (config read-only) |

## 5. Tested

| Area | Evidence |
|---|---|
| Part 1: matching/geo 19 new + 268 regions tests | REAL-CODE |
| Part 2: billing lifecycle 16 new + 50 + 14; DB tests 21 | REAL-CODE; CI-OWNER #21 |
| Part 3: offline 30/30; boundary rollback 13/13; G-1 rollback 8/8; `financial-tests.sql` no exception | REAL-CODE; LIVE-TEST-DB |
| Part 4: `tests/ads/phase6-day2-part4-publisher-tracking.test.ts` + existing `tests/publisher` (10 files) + day10/day12/day17/day26 handler tests | REAL-CODE; CI-OWNER |
| Part 4 live API calls (section 6) | LIVE-PREVIEW |

## 6. Passed

| Check | Result | Evidence |
|---|---|---|
| Key missing → 401 `{"error":"unauthorized"}` | PASS | LIVE-PREVIEW |
| Invalid key → 401 (same body) | PASS | LIVE-PREVIEW |
| `Basic` scheme → 401 | PASS | LIVE-PREVIEW |
| Valid key accepted (200, not 401); no eligible ad → `{"fill":false}` | PASS | LIVE-PREVIEW |
| Malformed JSON → 400 `invalid_request / invalid_json` | PASS | LIVE-PREVIEW |
| Wrong content-type → 415 `unsupported_media_type` | PASS | LIVE-PREVIEW |
| Body > 2048 B → 413 `payload_too_large` | PASS | LIVE-PREVIEW |
| Unknown topic `xyz` → 200 no-fill (reason not revealed) | PASS | LIVE-PREVIEW |
| Repeated bad keys → **429** `{"error":"rate_limited"}`, `retry-after: 60`, `cache-control: no-store`, `x-blisscco-api-version: 1`; first 29 = 401, 30th = 429; no stack trace, no key echoed | PASS | LIVE-PREVIEW |
| 429 vs 503 vs no-fill distinct; crash → generic 503, no leak | PASS | REAL-CODE |
| Safe response fields, `sponsored: true`, no CORS | PASS | contract tests |
| Sponsored label + safe link in publisher example | PASS | tests/publisher |
| Impression only after on-screen (hidden/not visible/unmounted send nothing); once per ad | PASS | tests/publisher |
| Click: no direct href; `click_ref` only; destination from DB; extra params 400; bad ref ≡ unavailable 404 | PASS | REAL-CODE |
| Duplicate impression/click → `duplicate`, no 2nd write; 30-parallel on real DB | PASS | CI-OWNER |
| Token expiry (1 h default, max 24 h, +1 h dead), tamper/wrong secret/cross-use refused | PASS | REAL-CODE |
| SDK retry: `Retry-After` honoured, 503/network retried (≤3), same Idempotency-Key, 4xx not retried | PASS | tests/publisher |
| Pilot limits: 1000.00 ok / 1000.01 refused / 2000.00 ok / 2000.01 refused; update, reopen, advertiser move refused | PASS 13/13 | LIVE-TEST-DB |
| G-1 reopen guard on TEST | PASS 8/8; Part 3 re-run 13/13 | LIVE-TEST-DB |
| Ledger OFF after rollback tests | PASS | LIVE-TEST-DB |
| Offline CI after fix (#130) and DB integration #22 | PASS (green; counts not seen) | CI-OWNER |

## 7. Failed

| Item | Where | Status |
|---|---|---|
| Static guard on SQL comment (CI #129, 1 test) | CI | **FIXED** (comment-only), #130 green |
| 1 publisher-example compile test | SANDBOX only (`@types/node` missing) | Not a real-environment failure; CI is green |

Nothing failed in a real environment after the fix.

## 8. Not tested

| Item | Why |
|---|---|
| Valid **ad-filled** response from a live call (`sponsored:true`, public fields) | Preview returned no-fill; needs an active test campaign matching the topic. Covered only by REAL-CODE/contract tests |
| Live **503** (DB down) | Not induced on Preview. REAL-CODE only |
| Exact 429 threshold | App guard is 20/min per instance memory; live 429 came at request 30 (Vercel instances differ). Best-effort by design |
| Whether the Preview deployment points to the TEST DB | Not confirmed in this review |
| Real billing with real rows | 0 charges / 0 settled / 0 reservations; ledger OFF by design |
| Exact 24 h hold boundary; bulk hold release on real PostgreSQL | Not testable with `now()` |
| Behaviour of a real publisher server (any Gate) | No publisher contacted |
| Edge 600/min rule under load | Config seen, not load-tested |
| Pass/skip counts of CI #130 and DB #22 | Screenshot shows green only |
| G-1 SQL on pilot/Production DB | Verified on TEST only |

## 9. Blocked

| Item | Blocked by |
|---|---|
| Gates A–D, G9 | Real publisher written confirmation (deferred) |
| Pilot terms G10 | Owner legal review |
| G2 backup/restore, G3 emergency stop on Production, G4, G6 latency, G8, G11, G12 | Owner-only evidence (dated) |

## 10. Severity-ranked blockers

| # | Sev | Blocker | Needs |
|---|---|---|---|
| 1 | **Critical** | Gates A–D not publisher-confirmed (a publisher can skip click/impression flow; we only control our side) | Written acknowledgement + recorded terms acceptance, no key/host |
| 2 | **Critical** | Production prerequisites open: G2 backup/restore never rehearsed, G3 emergency stop on Production, G6 latency, G4/G8/G11/G12 | Dated owner evidence |
| 3 | **High** | Real billing correctness unproven (no billing rows; ledger OFF) | Rollback-only real-flow billing run |
| 4 | **High** | G-1 guard verified on TEST only, not on pilot/Production DB | Owner applies + checks, dated note |
| 5 | **Medium** | N1: `destination_url` is a public match field; `toPublicAd` does not re-run `safeDestination` for own ads (provider path does). A publisher can ignore the click flow | Decide: re-check in `buildAdResponse` and/or mandatory-flow term | **Day 3 update (code-verified, sandbox):** gap CONFIRMED and fixed in code (match-handler re-checks with safeDestination rules, fail-closed no-fill). Not yet verified on Preview/Production. See `PHASE6-DAY3-PART1-TECHNICAL-GAPS-REPORT.md` |
| 6 | **Medium** | Per-IP cap 300/min on impression/click; shared-IP publisher server may get 429, example does not retry browser events | Accepted for pilot; revisit |
| 7 | **Medium** | Token TTL 1 h vs 24 h hold; unset `AD_TRACKING_SECRET` → ads without tracking, events 503 | Owner: keep, review after pilot; set secret |
| 8 | Low | N2: route/handler header comments say "charge at serve"; reports say CPM at impression, CPC at click. Likely stale comments, DB function not re-checked | Update comments or confirm | **Day 3 update (SQL read, not executed):** CONFIRMED stale; comments corrected (no logic change). DB behaviour verified by reading `phase6-step4-part2-event-billing.sql` only. See Day 3 Part 1 report |
| 9 | Low | Part 1: `load_ad_candidates` ignores live holds; all-regions rule mismatch | Owner decisions pending |
| 10 | Low | `release_expired_budget_reservations()` has no caller | Optional cron |
| 11 | Low | $0.5960 legacy spend (2 campaigns), owner accepted | None |
| 12 | Low | Sandbox cannot run 11 tests without `npm ci` | CI green |

## 11. Next actions (in order)
1. Owner: close G2, G3, G6 (and G4, G8, G11, G12) with dated evidence.
2. Owner: obtain **written** Gates A–D confirmation at publisher onboarding. Until then "NOT CONFIRMED".
3. Create one active TEST campaign, then re-run the valid-ad curl and record the filled response; optionally force a 503 on Preview.
4. Decide N1 and fix N2 comments (separate, tested change).
5. Apply and verify G-1 on the pilot DB; plan one rollback-only real-flow billing run (ledger OFF).
6. Re-decide GO/NO-GO only after 1–5 (Step 5 milestone: 25 November 2026).

## 12. Files changed in this review
Report updates (no lib/, CI, Vercel or Production change): this report; `PHASE6-DAY2-PART1-MATCHING-GEO-REPORT.md`, `PHASE6-DAY2-PART1-PENDING-DECISIONS.md`, `PHASE6-DAY2-PART2-BILLING-LIFECYCLE-REPORT.md`, `PHASE6-DAY2-PART3-FINANCIAL-RECONCILIATION-REPORT.md` (now based on the newest `(2)` variant; stale "pending" rows closed). Code/SQL: `supabase/sql/phase6-day2-part3-pilot-limits-boundary-rollback.sql` (line 6 comment only).
`PHASE6-STEP5-FINAL-PILOT-READINESS-REPORT.md` not edited: its remaining "pending" items (G2–G4, G6, G8–G12, publisher confirmation) are still genuinely open.

---
## Annex — earlier updates (kept as history)
## UPDATE (owner decision, 2026-11-12)
- **CI #128**, commit `c170e82`, green (1m40s, screenshot): includes `tests/ads/phase6-day2-part4-publisher-tracking.test.ts`. Counts not visible. DB integration #20 was before this commit; not re-run.
- **Gates A–D: DEFERRED to publisher onboarding.** No publisher is being onboarded now, so no written confirmation is requested yet. Status stays **NOT CONFIRMED** (not "publisher-confirmed", not "owner-accepted"). Blocker #1 (Critical) stays open for **real key issuance and pilot start**; it does not block TEST verification.
- Rule kept: terms/policy text alone is not confirmation. Confirmation = recorded acceptance (who, when, terms version) + the 4-point written acknowledgement, no key/host. Terms need legal review by the owner.
- Production status unchanged: **NO-GO**.

## UPDATE 2 — Vercel G5 and G-1 files (2026-11-12)
- **G5 rate-limit rule: VERIFIED (config, LIVE via Vercel connector, read-only).** Project `blisscco-ads` (prj_6n4v…), active firewall config v1, `firewallEnabled=true`, rule `ads-rate-limit` active+valid: path starts with `/api/v1/ads/`, fixed window 60 s, 600 requests, key IP, action 429 (deny). Updated 2026-11-12 05:50 UTC; no pending changes. Not load-tested. Config is project-wide (Production + Preview); the connector does not show which environment the pilot will use. Custom Rules: 0 → 1.
- App cap 300/min per IP stays (decision: unchanged). Edge cap 600 sits above it.
- **G-1 tightening: WRITTEN, NOT RUN.** `phase6-day2-part4-g1-reopen-guard.sql` (forward-only, replaces one function; rule: a REJECTED campaign above $1,000 cannot move to a counted status unless its budget is <= $1,000.00) and `phase6-day2-part4-g1-reopen-rollback.sql` (rollback-only, 7 checks). Owner must run both on TEST, then re-run the Part 3 boundary script (expect 13/13). Archived campaigns are not covered (owner approved "rejected" only).

## UPDATE 3 — G-1 verified on TEST (owner-run, output seen)
- `phase6-day2-part4-g1-reopen-guard.sql` applied on TEST: `pass: G-1 rule present`.
- G-1 rollback-only test: **8/8 PASS (LIVE-TEST-DB)** — trigger enabled before/after; reopen of rejected 1500.00 at unchanged budget refused (`pilot_campaign_limit`); 1000.01 refused; reduce to 1000.00 OK; reopen at exactly 1000.00 OK; rename of legacy oversized live campaign still OK; fresh insert 1000.01 still refused.
- Regression: Part 3 boundary script re-run after G-1: **13/13 PASS**.
- Blocker #4 (High): TEST part **CLOSED**. Still open: the same SQL is **not applied to the pilot/Production DB** (no evidence; I changed nothing there).
- Note (Low): the DB error text for any >$1,000 refusal now also says "Reduce the budget… before reopening". The app maps by hint (`pilot_campaign_limit`) to its own message, so users do not see this text. Archived campaigns not covered by G-1 (owner approved "rejected" only).
- Remaining open (Day 2): Gates A–D (deferred), real billing proof, Production prerequisites G2–G4, G6, G8, G11, G12, shared-IP cap (accepted for pilot). **Production: NO-GO** (unchanged).
