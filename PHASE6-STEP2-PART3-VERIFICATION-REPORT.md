# Phase 6 Step 2 Part 3: Pricing Compatibility, Tests and Documentation

Status: **implemented and tested locally as far as the review sandbox allows; lint (full), ESLint, build and CI were NOT run here (see below).** Phase 6 Step 3 is not started. Production was not accessed or changed. **Manual verification: not completed (all items below are unchecked).**

## 1. Pricing compatibility (Phase 5 CPM/CPC)

**Finding the owner must know:** this repository contains **no Phase 5 regional CPM/CPC rates and no regional bidding engine**. The Phase 5 reports in the repo say the same: pricing is a single platform `cpm_usd` setting (default 2.0000, one serve = `round(cpm_usd / 1000, 4)`, minimum 0.0001 USD), and a per-campaign CPM/CPC rate is "owner decided, not implemented". The Step 1 report recorded this too. So there was no regional pricing to connect to, and **none was created**.

What was verified (by code reading and by tests):
- The unit price comes only from `authorize_publisher_key` (`serve-db.ts`, `chargedUnitCostUsd`) and is passed to selection unchanged for all 8 regions.
- The charge call `record_ad_serve` still receives exactly (key hash, creative id, category). No region and no price field was added anywhere.
- The regional code (`campaign-targeting`, `campaign-regions-db`, `regional-eligibility`, `publisher-country-db`, `lib/regions/*`) contains no price, rate, CPM, CPC, bid or budget logic. Pricing, budget, ledger, payout and payment code does not reference regions.
- The Phase 6 SQL files do not mention `ad_platform_settings`, `cpm_usd`, spend, ledger, payouts, `record_ad_serve`, `load_ad_candidates` or `authorize_publisher_key`.
- No Phase 5 rate or bidding code was modified (not one file under `lib/ledger`, `lib/payouts`, `lib/payments`, `lib/campaigns/budget*`, `lib/campaigns/money.ts`, `serve-db.ts`, `category-matching.ts`).

If the owner has a separate Phase 5 regional pricing source that was not in the uploaded zip, send it; wiring region-based rates would be a separate, explicitly approved change.

## 2. Tests added (`tests/regions/phase6-step2-part3-compat.test.ts`, 41 tests)

They run the real chain `serveAd` -> `resolvePublisherRegionFromDb` -> real `selectAd` -> `loadCampaignTargetRegions`; only the Supabase rpc is faked.
- Verified country -> region -> campaign for US, GB, BR, IN, DE; lower-case and spaced codes; Rest of World publishers never get region-specific campaigns and region publishers never get null or empty campaigns.
- Pending, rejected, missing, non-ISO (`XX`, `UK`, `USA`), verified-without-code => no-fill, selection and campaign data never read. Unreadable country state, unknown status value, unreadable campaign targeting => unavailable (fail closed).
- Client-supplied country/region fields cannot change the outcome.
- Matching and non-matching regions; null, empty and explicit Rest of World; campaign with no targeting row never served.
- 14 existing checks still apply inside a matching region (campaign paused, pending review, rejected, draft; creative not approved or rejected; not started; ended; total, near-total and daily budget spent; advertiser and profile suspended; other category), and a blocked matching campaign never lets a non-matching one through.
- Pricing compatibility tests described in section 1, plus an all-8-regions by 8 matrix.

## 3. Verification commands: actual results

Environment: review sandbox without access to the npm registry (`npm ci` fails with `ENOTFOUND`), so `next`, `react`, `eslint` and their types could not be installed. Results below are exactly what happened.

| Command | Result |
|---|---|
| `npm test` equivalent (`tsc -p tsconfig.test.json`, then `node --require ./tests/register.cjs --test .test-build/tests/*/*.test.js`), with Node 22 and only `@types/node` linked | **5239 tests, 5237 pass, 1 skipped, 1 fail.** Compile shows no error in any changed file; the other compiler errors come only from the missing `next` package and exist on the untouched original too. |
| The 1 failing test | "client.ts, types.ts and the Next.js route compile together under strict mode": **pre-existing and unrelated**, needs the `next` package (`npm ci`). It also fails on the untouched original zip. |
| `npm run lint` (`tsc --noEmit`) | **Not meaningful here: not run to a clean result.** 5288 errors, all caused by the missing packages and type definitions (react, next, JSX types, node types). Needs `npm ci` on a machine with network. |
| `npm run lint:eslint` | **Not run** (eslint not installed here). |
| `npm run build` | **Not run** (`next` not installable here). |
| CI (`.github/workflows/ci.yml`: `npm ci`, `bash -n` backup script, `npm run lint`, `npm test`, `npm run lint:eslint`, `npm run build`) | **Not run** (GitHub not accessible from here). The workflow file is configured and unchanged. |

The owner should run `npm ci && npm run lint && npm test && npm run lint:eslint && npm run build`, or push and read the GitHub Actions result, and record the real outcome. Expected from this change: no new failures; the pre-existing failure above disappears once `next` is installed.

## 4. Database changes

None in Part 3. Part 2's migration (`phase6-step2-2`, one nullable `campaigns.target_regions` column, shape check, service_role-only read function) is applied on the TEST project **Denim Hub Bsl** only. Justification: the repository had no campaign region storage. Not applied on Production.

## 5. Documentation updated

`PHASE6-STEP2-PART2-CAMPAIGN-TARGETING-REPORT.md` (TEST database result), `supabase/MIGRATION-ORDER.md` (rows 42 and 43 now say applied on TEST, not on Production), this report.

## 6. Phase 6 Step 2 status

| Item | State |
|---|---|
| Step 1 central 8-region mapping | implemented |
| Part 1 publisher country verification | implemented, SQL applied on TEST |
| Part 2 campaign targeting and eligibility | implemented, SQL applied on TEST |
| Part 3 pricing compatibility, tests, docs | implemented (this report) |
| Regional CPM/CPC rates | **do not exist in the repo; not part of this step** |
| UI to set campaign regions | not built (later step); until then every campaign with the flag on is Rest of World only |

## 7. Remaining manual verification (all unchecked until the owner confirms)

- [ ] `npm ci`, `npm run lint`, `npm test`, `npm run lint:eslint`, `npm run build` pass on the owner's machine
- [ ] GitHub CI green on the Part 2 and Part 3 changes
- [ ] Vercel Preview with `REGIONAL_ELIGIBILITY_ENFORCED=1`: verified publisher gets a matching campaign (set `target_regions` by SQL on TEST), pending/rejected/missing publisher gets no-fill, null-region campaign only serves a Rest of World publisher
- [ ] Preview with the flag off behaves as before
- [ ] Production SQL and the flag stay off until the owner decides in writing
