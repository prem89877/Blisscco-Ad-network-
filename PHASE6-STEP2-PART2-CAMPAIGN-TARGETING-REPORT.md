# Phase 6 Step 2 Part 2: Campaign Targeting and Ad Eligibility

Status: **implemented; SQL applied on the TEST project only (see end of file); manual verification not completed.** Production was not accessed.

## Finding that shaped the work

The repository had **no existing campaign region targeting** (no column, no form field, no query). The Part 1 code said so itself ("campaigns have no region field yet (Part 2)"). So "connect existing targeting" was implemented as: add the single smallest storage for it (`campaigns.target_regions`) and connect that to the central mapping. There is no second targeting configuration. **Owner should confirm this reading.**

## Modified and new files

New: `lib/ads/campaign-targeting.ts`, `lib/ads/campaign-regions-db.ts`, `supabase/sql/phase6-step2-2-campaign-target-regions.sql`, `tests/regions/phase6-step2-part2-targeting.test.ts`, this report.
Modified: `lib/ads/selection.ts`, `lib/ads/serve.ts`, `lib/ads/service.ts`, `lib/ads/regional-eligibility.ts`, `lib/ads/publisher-country-db.ts`, `supabase/MIGRATION-ORDER.md` (row 43), `.env.example` (comment only), `tests/ads/day10-part6-final.test.ts` and `tests/auth/part3-hardening.test.ts` (one allowlist line each for the new server-only reader).
Not changed: `lib/regions/*` (mapping and Part 1 helpers reused as is), `load_ad_candidates`, `record_ad_serve`, pricing, payments, ledger, payouts, auth, any old SQL file, UI.

## Exact eligibility behavior (applies when `REGIONAL_ELIGIBILITY_ENFORCED=1`)

| Situation | Result |
|---|---|
| Publisher country missing, pending, rejected, not ISO, or not readable as verified | No fill (before replay, selection, serve, charge) |
| Country state cannot be read (database error, odd shape) | 503 unavailable (fail closed) |
| Verified country, campaign regions include the publisher's region | Eligible |
| Verified country, campaign regions do not include it | Not eligible |
| Campaign `target_regions` null or empty | Rest of World publishers only (never all-region) |
| Campaign explicitly targets `rest_of_world` | Rest of World publishers only (same rule as no selection) |
| Campaign list has no recognised region id (for example `["all"]`) | Nobody, not even Rest of World (fail closed) |
| Campaign has no targeting row in the read result or malformed row | That campaign is not eligible |
| Campaign region read fails | No ad, 503 (never "everything eligible") |
| Explicit all-region targeting | Not supported in this repo, so not added. It must be a separate explicit selection later; an empty list never means all-region |

The flag off (default) keeps the old behavior exactly: no country read, no campaign region read.
Existing checks are untouched and still apply after the region filter: campaign `active`, approved creative, advertiser and profile status, start and end dates, total and daily budget, category match, ranking, record-time re-verification.

## Security checks

- Publisher region comes only from the database: admin-verified country, central mapping, read by the authorized publisher id (from the API key hash). Request body, headers and query are never read for country or region; the match request type and validators contain no country or region.
- Only `VERIFIED` plus ISO-valid countries get a region. `XX`, `UK`, lower-case junk, pending and rejected never fall back to Rest of World.
- Campaign regions are read through one read-only `service_role`-only function. The loader receives only campaign ids. Logs carry only an error code.
- No region list or country mapping in the new code or SQL; the database only checks array shape, region ids are validated in TypeScript against the central list.
- No column GRANT on the new column (existing campaign grants are column-wise), so publishers and advertisers cannot write it through the API.
- Serving functions, pricing, ledger and payouts are not redefined.

## Tests actually performed

Test database and Production were not used; all tests use in-memory fakes.
- `tsc -p tsconfig.test.json` compile: no errors in the changed files. The only compiler errors are environmental (`next` and its types are not installed in the review sandbox; same errors exist before the change).
- Full `node --test` suite: 5198 tests, 5196 pass, 1 skipped, 1 fail. The 1 failure also fails on the untouched original zip: "publisher example files compile strictly" needs the `next` package (`npm ci`). New tests: 43 (eligibility matrix for all 8 regions, null and empty targets, explicit Rest of World, unknown ids, missing rows, country-to-region outcomes, rpc parsing, selection filtering with all existing eligibility checks, serve gate ordering and fail-closed paths, client-supplied country ignored, reader behavior with fake Supabase, SQL static checks, scope and security checks).
- **Not run:** ESLint, `next build`, GitHub CI, the SQL migration on any database, any manual or browser check.

## Pending (owner / next steps)

- Run `phase6-step2-2` SQL on TEST only, then checks V1-V5. Apply it before turning the flag on anywhere (flag on without it returns 503).
- Run CI on GitHub and the full local `npm test`, `npm run lint`, build.
- No way to set `target_regions` from the UI yet (Part 3 or later); until then every campaign is Rest of World only when the flag is on.
- Mark manual verification only after you have done it.

## Update (2026-11-10): TEST database

`phase6-step2-2-campaign-target-regions.sql` was applied to the TEST project **Denim Hub Bsl** (`ficwuieqjdhrrxbvuqot`) as migration `phase6_step2_2_campaign_target_regions` (outer begin/commit and footer comments left out; statements otherwise identical). Result: success. Checks: V1 = 1, V2 = 0, service_role execute = 1, V3 = 0 of 4 campaigns with regions, V5 = 0, function is security definer with empty search_path, function call returns 4 rows all null. Constraint tests (rolled back): `['North America']` rejected, 9 entries rejected, valid values accepted; 0 campaigns have regions afterwards. Production (`Blisscco-Ad-network-`) was not accessed.
