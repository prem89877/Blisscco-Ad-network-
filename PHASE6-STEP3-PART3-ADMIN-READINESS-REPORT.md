# Phase 6 Step 3 Part 3 - Admin Readiness, Testing & Documentation

Status: code + tests done. **No new SQL.** Production not accessed or modified. Manual verification **NOT done** (list in section 8). Phase 6 Step 4 not started.

## 1. Files

NEW
- `lib/regions/admin-country-overview.ts` (pure: country state for advertiser / publisher rows, admin text lines, summary counts)
- `lib/regions/admin-country-queries.ts` (server, SELECT only: loads country info for the Admin page)
- `components/admin/CountryOverviewPanel.tsx` (read-only panel: counts + accounts with missing / invalid / incomplete country)
- `tests/regions/admin-overview-stubs.ts` (test helper: fake `@/lib/supabase/server`, SELECT chain only)
- `tests/regions/phase6-step3-part3-admin-overview.test.ts` (21 tests)
- `tests/regions/phase6-step3-part3-publisher-admin-flow.test.ts` (12 tests)
- `tests/regions/phase6-step3-part3-advertiser-international.test.ts` (10 tests)
- `PHASE6-STEP3-PART3-ADMIN-READINESS-REPORT.md` (this file)
- `PHASE6-STEP3-MANUAL-AND-CI-GUIDE.md` (step-by-step manual + CI guide for all of Phase 6 Step 3)
- `CHANGED-FILES-PHASE6-STEP3-PART3.txt`

MODIFIED
- `app/dashboard/admin/page.tsx` (existing Admin page: loads country overview after `requireRole(["admin"])`, adds a "Country:" line to the existing Advertisers / Publishers lists, adds the panel, adds "N publisher country review(s)" to the "Waiting" line)
- `PHASE6-STEP3-PART1-ADVERTISER-COUNTRY-REPORT.md`, `PHASE6-STEP3-PART2-PUBLISHER-ONBOARDING-REPORT.md` (only the stale "not started" line)

NOT changed: SQL (any), country mapping, `publisher-country.ts`, `advertiser-country.ts`, Step 2 admin action `country-actions.ts`, `PublisherCountryPanel`, serve gate, pricing, payments, payouts, ledger, API keys, auth, middleware, workflows, package files, any existing test.

## 2. Database changes

**None.** Justification: the Admin already has what it needs.
- Admin can read `advertisers.country_code` (Part 1) and `publishers.country_*` (Step 2) through the existing `advertisers_select_admin` / `publishers_select_admin` policies and the existing table-level `select` grant.
- Approve / reject already exists (`admin_review_publisher_country`). A second workflow would be a duplicate.
- Advertiser country has no approval status (Part 1 decision, no existing requirement). None was added.

## 3. Admin functionality

- **Visibility:** the existing `/dashboard/admin` page (same `requireRole(["admin"])`) now shows, for each advertiser and publisher in the existing lists, a line such as `Country: India (IN) · South Asia · Verified` or `Country: Country not chosen`. Account status (pending / active / suspended) stays in the same row, so both statuses are visible together.
- **Country overview panel (read-only):** publisher counts (verified, waiting, not accepted, not submitted, invalid / incomplete), advertiser counts (set, not chosen, invalid), and the accounts that need attention (up to 15 each, "and N more").
- **Incomplete / invalid detection:** `missing` (old accounts, both null), `incomplete` (only code or only status set, or unknown status), `invalid_country` (code is not an official ISO code, any status). Region is shown only for ISO-valid codes; an invalid code never gets a region or Rest of World.
- **Approve / reject:** unchanged, only in the existing "Publisher countries" panel and `adminReviewPublisherCountry` (Verify hidden for invalid codes; Reject always possible). The new panel has no buttons, forms or actions.
- **Failure isolation:** advertisers and publishers load in separate queries. If one fails (for example Part 1 SQL not applied), only that side shows "could not be loaded"; the rest of the Admin page works as before.
- **Limit:** latest 500 rows per side; the panel says so when the limit is reached.

## 4. Tests added (43)

International advertiser country selection (every ISO code saved by one column update), valid / invalid codes, advertiser country -> region from the central mapping (no silent Rest of World), international publisher registration (10 sample countries across regions, goes only through `submit_publisher_country`), publisher pending / verified / rejected states and eligibility (only verified + ISO-valid), admin approve / reject / invalid-cannot-approve / changed-country message, old accounts and old rows (no country = "missing", signup without country unchanged), and unauthorized access (advertiser, publisher, unknown role stopped at the admin role check: no RPC, no revalidate; admin page checks the role before loading; overview code has no write calls; no second approval workflow; no new SQL; no money code in new files).

## 5. Actual results (executed in the build sandbox)

Sandbox limits: no network, so `npm ci` fails (`ENOTFOUND`); `next`, `react`, `@supabase/*`, `eslint` are not installed. Only TypeScript 6.0.3 and `@types/node` were available.

| Check | What was run | Result |
|---|---|---|
| Tests (before my change, original zip) | `tsc -p tsconfig.test.json` then `node --require ./tests/register.cjs --test .test-build/tests/*/*.test.js` | 5310 tests, 5308 pass, **1 fail**, 1 skipped |
| Tests (after) | same | 5353 tests, 5351 pass, **1 fail**, 1 skipped (+43 new, all pass) |
| The 1 failure (pre-existing, unrelated) | `day 28 part 1 \| the publisher example files compile strictly, unchanged` | Needs `next` types, missing in the sandbox. Same failure before and after. |
| `npm test` exactly as written | not run as one command | It chains `tsc && node`; `tsc` reports missing-module errors in the sandbox, so I ran the two halves separately (above). |
| Lint (`npm run lint` = `tsc --noEmit`) | `tsc --noEmit -p tsconfig.json`, errors compared with the original zip | **NOT a pass here.** 5367 errors before, 5430 after, all missing-types noise (`next`, `react`, JSX, `node:` types). New ones are the same kinds the existing `PublisherCountryPanel` already shows. The new pure module was also type-checked strictly on its own: 0 errors. A real run needs `npm ci`. |
| ESLint (`npm run lint:eslint`) | **not run** | `eslint` not installed. |
| Build (`npm run build`) | **not run** | `next` not installed. |
| CI workflow (`.github/workflows/ci.yml`) | **not run** | GitHub Actions cannot run here. Only its `bash -n scripts/backup-production-db.sh` step was run: OK. |

One of my own changes briefly broke an existing test (`phase2-pilot-monitoring`, expects the exact `Promise.all([loadAdminData(), loadPilotMonitoring(account.role` line). Fixed by keeping that line as it was; the country overview loads in a separate promise. Existing test not edited.

## 6. USD payment and payout configuration

Unchanged. Verified by a file-by-file comparison with the uploaded zip: `lib/payments`, `lib/payouts`, `lib/ledger`, `lib/campaigns`, `lib/ads`, `app/api`, `supabase/sql`, `.github`, payout actions (publisher + admin), `package.json`, lockfile and both tsconfig files are identical. The only changed existing source file is `app/dashboard/admin/page.tsx`. A test also checks the new files contain no payment / payout / ledger / price / currency code.

## 7. Production

Not accessed, not modified. No credentials were used; no database was contacted (all tests use fake clients). No SQL was run anywhere. No public launch.

## 8. Remaining manual verification (NOT done)

Full steps: `PHASE6-STEP3-MANUAL-AND-CI-GUIDE.md`.

- [ ] `npm ci`, `npm run lint`, `npm test`, `npm run lint:eslint`, `npm run build` on the owner's machine
- [ ] GitHub `CI` workflow green on this change
- [ ] TEST Admin page: Country overview, Country lines, "Waiting" count, Verify / Reject, old accounts show "not submitted / not chosen"
- [ ] Non-admin (advertiser / publisher) cannot open `/dashboard/admin`
- [ ] Items still open from Parts 1 and 2 and the login country screen
- [ ] Production: nothing applied; separate written approval needed

## 9. Phase 6 Step 3 status

| Item | State |
|---|---|
| Login country screen + "Do it later" | implemented, manual NOT done |
| Part 1 advertiser country (SQL applied on TEST) | implemented, manual NOT done |
| Part 2 publisher onboarding | implemented, manual NOT done |
| Part 3 admin readiness, tests, docs | implemented (this report), manual NOT done |
| Phase 6 Step 4 | **not started** |
