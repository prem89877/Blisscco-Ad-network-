# Phase 6 Step 2, Part 1: Publisher Country Verification

Status: **implemented in the repository, verification pending.** Part 2 is not started. Production was not accessed. No SQL was run on any database.

## What was built

| Task | Result |
|---|---|
| 1. Publisher submits country | Optional "Country" field in publisher setup (registration), and a "Country" panel on `/dashboard/publisher` (submit, change, resubmit after rejection). Only officially assigned ISO 3166-1 alpha-2 codes are accepted (checked with `lib/regions/country-region.ts`; `XX`, `UK`, free text are refused). |
| 2. Workflow | New submission = `pending`. Admin approve = `verified`. Admin reject = `rejected`. No country = all country columns null ("missing"). The publisher cannot approve their own country (no column grant, guard trigger, and the submit function can only write `pending`). |
| 3. Admin approve / reject | `adminReviewPublisherCountry` server action: `requireRole(["admin"])` first, then database function `admin_review_publisher_country` re-checks `private.is_admin()`. Stores status, admin id (`auth.uid()`), and timestamp. Existing auth and role code was not changed. |
| 4. Eligibility | One gate: `publisherRegionalEligibility()` in `lib/regions/publisher-country.ts`. Only `verified` and ISO-valid gets a region (from the central mapping). Pending, rejected, missing, invalid all return not eligible. |

Owner answers applied: publisher states the country, admin verifies, country stays unverified until then; a campaign with no region selected is eligible only in Rest of World (`effectiveCampaignRegions`); missing or invalid verified country gets no ad (no-fill) when the gate is on.

## Decision the owner must confirm: the serving gate is OFF by default

Campaigns have no region field yet (that is Part 2), so nothing consumes a region today. If the no-fill rule were always on, every existing publisher (none has a verified country yet) would stop getting ads, which would break existing behaviour. So the match endpoint runs the gate only when env `REGIONAL_ELIGIBILITY_ENFORCED` is exactly `1` (same pattern as `EMERGENCY_STOP_ENFORCED`). Default off: serving is unchanged and the database is not even called. On: pending / rejected / missing / invalid country gives `{ "fill": false }` before any selection, serve record, or charge; if the country cannot be read the endpoint returns 503 (fail closed). Do not turn it on before the SQL is applied on TEST and an admin has verified the test publisher.

## Database changes (file: `supabase/sql/phase6-step2-1-publisher-country-verification.sql`, NOT RUN anywhere)

- `publishers`: 5 new nullable columns `country_code`, `country_status`, `country_submitted_at`, `country_reviewed_by` (FK to `profiles`), `country_reviewed_at`. A CHECK enforces: all null, or pending with no review data, or verified/rejected with admin id and time. Format check `^[A-Z]{2}$`. Existing rows are untouched (all null).
- No ISO list or region mapping in SQL (single source stays `lib/regions/country-region.ts`). The database checks format only; ISO membership is checked in TypeScript at submit, at admin approve, and at serving.
- No new GRANT on `publishers`: the day-3-5 column grants (name, website_url, category) still apply, so authenticated users cannot write country columns. Guard trigger `private.guard_publisher_country_changes` blocks direct changes by `anon` / `authenticated` as defense in depth.
- `submit_publisher_country(text)` (authenticated): own row via `auth.uid()`, always sets `pending`, clears review data, refuses a suspended publisher, same-country resubmission changes nothing.
- `admin_review_publisher_country(uuid, text, text)` (authenticated, admin only): approve only from `pending`; reject from `pending` or `verified`; blocks self review (`self_approval_blocked`); the admin must pass the country they saw (`country_changed` if the publisher changed it meanwhile); repeating a decision changes nothing.
- `get_publisher_country_state(uuid)` (service_role only, read only): returns the code only when `verified`.
- Not touched: pricing, payments, ledger, payouts, `authorize_publisher_key`, `record_ad_serve`, RLS policies.

## Files

New: `lib/regions/publisher-country.ts`, `lib/ads/regional-eligibility.ts`, `lib/ads/publisher-country-db.ts`, `lib/publisher/country-queries.ts`, `app/dashboard/publisher/country-actions.ts`, `app/dashboard/admin/country-actions.ts`, `components/dashboard/PublisherCountryForm.tsx`, `components/admin/PublisherCountryPanel.tsx`, `components/admin/PublisherCountryReviewButton.tsx`, the SQL file, this report, and 5 test files under `tests/regions/`.

Modified: `lib/ads/serve.ts` (optional gate dependency, 1 block), `lib/ads/service.ts` (wiring, env flag), `app/dashboard/account/actions.ts`, `components/dashboard/AccountSetupForm.tsx`, `app/dashboard/publisher/page.tsx`, `app/dashboard/admin/page.tsx`, `lib/accounts/validation.ts` (one type only), `.env.example` (commented flag), `supabase/MIGRATION-ORDER.md` (row 42), and two existing test allowlists (`tests/ads/day10-part6-final.test.ts`, `tests/auth/part3-hardening.test.ts`: the new server-only `publisher-country-db.ts` added to the list of files allowed to use the service-role client, same as `emergency-stop-db.ts` before it).

Design notes: country is validated in the server action, not in `validation.ts`, because a Day 27 test pins the exact module graph of the preview route (`validation.ts` is in it). The publisher and admin pages load country data with separate queries, so a missing migration cannot break the publisher page, key creation, or the rest of the admin page; only the country panel shows "could not be loaded".

## Tests and actual results (run in a sandbox with `@types/node`, no `next` / `react` packages)

- New: 58 tests in `tests/regions/phase6-step2-part1-*.test.ts` (pure logic, server actions with fake Supabase, serving gate, static SQL checks). **All 58 pass**, plus the 14 Step 1 tests: `tests/regions` = 72 tests, 72 pass.
- Full suite (same command as `npm test`, minus `tsc` module-resolution for next/react): 5155 tests, 5148 pass, **6 fail**. The same 6 fail on the unmodified uploaded zip run the same way (5093 tests, 5086 pass, 6 fail): Day 10 part 6 API surface, Day 12 part 1, Day 12 part 3 source safety, Day 13 part 1, Day 13 part 2 SQL, Day 13 part 4. They check that no payments webhook route or Phase 5 payment SQL exists, so they are out of date with Phase 5. They were not changed. No new failure comes from this part.
- Two of my first runs failed and were fixed: the Day 27 preview-route module-set test (fixed by moving country validation to the action) and two service-role allowlist tests (allowlist updated).

## Security checks (by test and by reading the SQL)

- Publisher cannot verify own country: form fields `status`, `country_status`, `verified`, `reviewed_by`, `publisher_id`, `role` are never forwarded (tested); no column GRANT, guard trigger, and submit function writes only `pending` (tested on SQL text).
- Admin action: non-admin never reaches the database (tested for publisher and advertiser); only id, decision, expected country are sent; reviewer id and time come from `auth.uid()` and `now()` in the database; `verified` / `rejected` are not accepted as decisions.
- Self approval and stale-country approval blocked in the database function; a non-ISO country cannot be approved (can be rejected).
- Raw database errors never reach the user (fixed messages only); only code and hint are logged.
- No `NEXT_PUBLIC_` variable, no service-role key in browser files; service-role use is limited to one new server-only read-only file.
- No duplicate country mapping (test scans the new files); the central mapping file is unchanged.
- Pricing, payments, ledger, payouts: untouched (test scans those modules).

## Not run / remaining manual verification (NOT marked complete)

- `npm run lint` (full `tsc --noEmit`), `npm run lint:eslint`, `npm run build`, GitHub CI: **not run** (this sandbox has no `next` / `react` packages and no network). The new `.tsx` files, the two pages and `AccountSetupForm.tsx` were never type-checked or built here; the server-side `.ts` files and actions were compiled and tested.
- SQL: not applied on TEST, so the real behaviour of RLS, the trigger, the CHECK, grants, and the three functions is untested. Run on the TEST project only, then the checks V1 to V7 at the end of the SQL file.
- Manual on TEST after the SQL: (1) publisher submits a country at setup and from the dashboard, status shows "Waiting for verification"; (2) a publisher cannot change status through the API; (3) admin verifies and rejects, publisher page updates; (4) admin sees "country changed" if the publisher changed it first; (5) changing a verified country sends it back to pending; (6) with `REGIONAL_ELIGIBILITY_ENFORCED=1` on TEST: verified publisher gets an ad, pending / rejected / no country gets no-fill, and with the flag off nothing changes; (7) layout of the new country panels on mobile.
- Production: not accessed and not changed. Applying the SQL and setting the flag on Production needs a separate owner decision.
