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
| CI #131 (owner-reported, green) | `npm run lint`, `npm test`, `npm run lint:eslint`, `npm run build`: PASS as one green run; counts not seen. Replaces the sandbox "NOT RUN / NOT VALID" rows below for CI purposes; sandbox rows kept as history |
| `npm run lint` (`tsc --noEmit`) | (sandbox) NOT VALID here: ~5,562 errors from missing deps (`next`, `react`, `@types/node`). Errors in touched files are all missing-types only. Must be run in CI |
| `npm run lint:eslint` | NOT RUN (eslint/next not installed, no network) |
| `npm run build` | NOT RUN (same) |

## 5. Implemented vs tested vs passed
- Implemented: N1 guard, N2 comments, 18 tests.
- **CI-OWNER (added after owner update):** CI workflow **#131**, branch `preview-day-c`, head_sha `2594671646ab821c239844d0947ca9df35583777`, reported by owner as **passed (green)**. The workflow runs `bash -n`, `npm run lint`, `npm test`, `npm run lint:eslint`, `npm run build` (read from `.github/workflows/ci.yml`), so a green run means all five steps passed. **Not seen by me:** pass/skip counts, run duration, and whether #131 contains exactly the Day 3 changes (the ZIP has no `.git`). Counts are therefore NOT claimed.
- Tested + passed (sandbox): 18 new tests; full suite unchanged except +18.
- NOT verified: lint, eslint, build, DB integration tests, Preview/Production behaviour.

## 6. Owner decisions received and status (updated)
| # | Item | Owner decision | Status |
|---|---|---|---|
| 1 | Run lint / eslint / build / tests | CI #131 green (owner-reported) | **Closed (CI-OWNER, counts not seen)** |
| 2 | Day 28 part 1 sandbox-only failure | Green CI #131 covers real deps | **Closed (CI-OWNER)** |
| 3 | Unsafe own ad caught after `record_ad_serve` (24 h hold, no charge); optional reject at candidate stage | No decision given | **Still open (owner decision)**. No code change |
| 4 | Stale comment `tests/ads/day14-part4-integration.test.ts` line 27 ("charge only on serve") | **Out of scope. Leave unchanged; do not edit in this part** | **Deliberately left unchanged** (verified: file not touched) |
| 5a | Reserved-budget | Owner wrote: "Approved G-1 tightening ($1,000 limit); implement with regression and concurrency tests" | **NOT implemented in this part.** G-1 reopen guard ($1,000) is already written and verified on TEST (8/8, Part 3 13/13). The `load_ad_candidates` live-hold fix is a different item, so the approval scope needs one confirmation before any SQL/TS change. No SQL executed |
| 5b | All-regions | Keep existing behaviour; no policy weakening | **Closed: no change** |
| 5c | Ledger / payments / payouts | Keep OFF | **Unchanged (OFF)** |
| 6 | Commit SHA | Do not init Git; ZIP unchanged; take SHA from GitHub | See section 7 |

## 7. Commit SHA (owner-supplied from GitHub; not verifiable by me)
| What | SHA |
|---|---|
| Latest commit, default branch | `573b6082ccf49c3b566467e64d63cdacd183736e` |
| CI #131 head_sha, branch `preview-day-c` | `2594671646ab821c239844d0947ca9df35583777` |
- The two SHAs are different commits on different branches. I cannot tell from the ZIP which one contains the Day 3 changes. Treat `2594671...` as the verified-by-CI commit only if the owner confirms the Day 3 files are in it.
