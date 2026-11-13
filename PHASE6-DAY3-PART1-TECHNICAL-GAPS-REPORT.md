# PHASE 6 — DAY 3 — PART 1: Close Day 2 Technical Gaps

Source: uploaded `blisscco-ad-network.zip`. Environment: sandbox, no `node_modules`, no network, no `.git`.
No SQL executed, no Production/Preview access, no deployment, no env change. Ledger untouched (stays OFF). Billing logic, 90/10, country/region rules not changed.

## 1. Files changed (exact)
| File | Change |
|---|---|
| `lib/ads/contract.ts` | + `hasSafeDestination(ad)` (new internal export; uses existing `safeDestination`; never throws). `buildAdResponse`, `toPublicAd`, types unchanged |
| `lib/ads/match-handler.ts` | import + 1 guard line in `case "ad"`: unsafe destination => `{ fill:false }` (200) |
| `lib/ads/service.ts` | comments only (N2) |
| `lib/ads/serve.ts` | comment only (N2) |
| `app/api/v1/ads/impression/route.ts` | comment only (N2) |
| `app/api/v1/ads/click/route.ts` | comment only (N2) |
| `tests/ads/phase6-day3-destination-safety.test.ts` | NEW, 18 tests |
| `PHASE6-DAY2-FINAL-VERIFICATION-REPORT.md` | rows 5 and 8 annotated |
| `PHASE6-DAY3-PART1-TECHNICAL-GAPS-REPORT.md` | NEW (this file) |

## 2. N1 — destination_url safety: CONFIRMED (partial bypass), FIXED
- `buildAdResponse` -> `toPublicAd` copied `destinationUrl` with no re-check. Own-ad path had no `safeDestination`; provider path and click redirect did.
- Probe on compiled code (before fix): `buildAdResponse` passed through all of: `http://`, `user:pw@`, `a.com@evil.com`, `not a url`, `javascript:`, `https://127.0.0.1`, `https://localhost`, `https://intranet`, whitespace.
- Real exposure is narrower: DB CHECK + `isCompleteCreative` already block non-https, whitespace, userinfo. **Still reachable by a publisher:** IP, localhost, single-label hosts (click would later refuse them, so the publisher got a destination the click flow rejects).
- Fix: `hasSafeDestination` runs before `buildAdResponse`; fail => `{ fill:false }`, no ad, no tracking. URL is NOT rewritten (no normalization), so valid output is byte-identical. Public API shape unchanged.
- Mutation check: with the guard removed, 2 new tests fail (v1 + legacy); with the guard, they pass.
- Provider fallback: unchanged (`buildProviderAdResponse` untouched; 2 tests lock its behaviour). Edge: an unsafe own ad returns no-fill and does not trigger provider fallback.

## 3. N2 — stale billing comments: CONFIRMED stale, CORRECTED
Verified by reading (not running) `supabase/sql/phase6-step4-part2-event-billing.sql`: serve = budget hold only (no `campaign_spend_daily` insert); `settle_event_billing` charges CPM on first valid impression, CPC on first valid click; duplicates never re-charge.
Corrected: 2 route comments, `service.ts` (4 places: owner note, spendTracking note, impression note, click note), `serve.ts` (owner note). Behaviour not touched.

## 4. Test results (actual)
| Check | Result |
|---|---|
| `npm test` equivalent (sandbox: global `tsc`, borrowed `@types/node`) — BEFORE | 5583 tests, 5581 pass, 1 fail, 1 skipped |
| Same — AFTER | **5601 tests, 5599 pass, 1 fail, 1 skipped** (+18 new, all pass) |
| New file alone | 18 pass, 0 fail, 0 skip |
| The 1 fail (before AND after) | `day 28 part 1: publisher example files compile strictly` — needs real `next`/`react` types, absent in sandbox. Not caused by this change |
| DB suites skipped | 8 suites (`TEST_DATABASE_URL` not set) |
| `npm run lint` (`tsc --noEmit`) | NOT VALID here: ~5,562 errors from missing deps (`next`, `react`, `@types/node`). Errors in touched files are all missing-types only. Must be run in CI |
| `npm run lint:eslint` | NOT RUN (eslint/next not installed, no network) |
| `npm run build` | NOT RUN (same) |

## 5. Implemented vs tested vs passed
- Implemented: N1 guard, N2 comments, 18 tests.
- Tested + passed (sandbox): 18 new tests; full suite unchanged except +18.
- NOT verified: lint, eslint, build, DB integration tests, Preview/Production behaviour.

## 6. Unresolved / for owner
1. Run `npm ci`, `npm test`, `npm run lint`, `npm run lint:eslint`, `npm run build` in CI/local and record results.
2. Day 28 part 1 test failure is expected to pass with real deps; confirm in CI.
3. Unsafe own ad is caught AFTER `record_ad_serve` (a 24 h hold exists, no charge, no token returned). Cleaner option: also reject at candidate stage (`isCompleteCreative`) so another ad can be served. Needs owner decision.
4. Stale comment left (out of scope: not route/handler): `tests/ads/day14-part4-integration.test.ts` line 27 ("charge only on serve").
5. Pending owner decisions untouched: reserved-budget (`load_ad_candidates` ignores live holds), all-regions rule.
6. Commit SHA: not available (zip has no `.git`).
