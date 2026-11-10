# Phase 6 Step 3 Part 1 - International Advertiser Onboarding

Status: code + tests done. SQL **NOT run anywhere** (TEST first). Production not accessed. Manual verification **NOT done**.

## 1. Files

NEW
- `supabase/sql/phase6-step3-1-advertiser-country.sql`
- `lib/regions/advertiser-country.ts` (pure: validation reuse, region from central mapping, row -> state)
- `lib/advertiser/country-queries.ts` (server: reads own `country_code`)
- `app/dashboard/advertiser/country-actions.ts` (`updateAdvertiserCountry`)
- `components/dashboard/AdvertiserCountryForm.tsx`
- `tests/regions/advertiser-country-stubs.ts`, `tests/regions/phase6-step3-part1-advertiser-country.test.ts`

MODIFIED
- `app/dashboard/account/actions.ts` (`setupAdvertiser`: optional country)
- `lib/accounts/validation.ts` (type only: `AdvertiserFields` + `"country"`)
- `components/dashboard/AccountSetupForm.tsx` (country dropdown in advertiser setup)
- `app/dashboard/advertiser/campaigns/page.tsx` (Business country panel)
- `supabase/MIGRATION-ORDER.md` (row 44)

NOT changed: `lib/regions/country-region.ts`, pricing / CPM / CPC, payments, USD billing, ledger, payouts, auth / roles, ad serving, any old SQL, any existing test.

## 2. Database changes

One additive nullable column: `advertisers.country_code text` + check `null or ^[A-Z]{2}$`, plus `grant update (country_code)` to `authenticated`.
- Why a column: advertisers had no country field to reuse.
- Region is NOT stored: always derived from `lib/regions/country-region.ts` (no stale or duplicate mapping; SQL has no country list).
- No INSERT grant change: signup insert stays exactly as before; country is saved right after by a separate update. Old advertisers stay `null`.
- RLS unchanged (`advertisers_update_own`: own row, active profile only).

## 3. Country validation behavior

- Trim + upper-case; must be an officially assigned ISO 3166-1 alpha-2 code (central list).
- `""` -> allowed only at signup (country is optional there). `UK`, `XX`, `USA`, `1A`, non-string -> rejected with a message; nothing is saved.
- A stored code that is not ISO gets region `null`, never Rest of World.
- Valid country -> region via central mapping (e.g. IN -> South Asia, US -> North America, BR -> Rest of World).
- Signup: if the country save fails (e.g. SQL not applied), the account is still created and the user can choose the country on the campaigns page.
- Existing advertisers: see "Business country" panel on My campaigns; no new account needed.

## 4. Tests executed (actual results, local, fake Supabase)

- New file `phase6-step3-part1-advertiser-country.test.js`: 32 tests, 32 pass, 0 fail.
- Full suite (`node --test .test-build/tests/*/*.test.js`): 5273 tests, 5271 pass, 1 fail, 1 skipped.
  - The 1 failure: `day 28 part 1 | the publisher example files compile strictly` - needs `next` types, which are not installed in this sandbox (no `node_modules`, no network). Not related to this change; `npm test` in CI has them.
- `tsc` compiled with only "missing next / supabase module" errors (sandbox), none in the new logic.
- NOT run here: ESLint, `next build`, real typecheck with all deps (no `node_modules`). CI will run them.

## 5. Remaining manual verification (NOT done)

1. Run `phase6-step3-1-advertiser-country.sql` on the TEST project, then checks V1-V5 in the file footer.
2. TEST app: new advertiser signup with a country -> row has `country_code`; signup without country still works.
3. TEST app: existing advertiser opens My campaigns -> Business country panel -> saves a country; existing campaigns unchanged.
4. Try an invalid country (tampered form value) -> rejected.
5. Confirm pricing / billing screens and an existing campaign flow are unchanged.
6. Production: nothing applied; separate approval needed.

Part 2 and Part 3 are done; see `PHASE6-STEP3-PART2-PUBLISHER-ONBOARDING-REPORT.md` and `PHASE6-STEP3-PART3-ADMIN-READINESS-REPORT.md`.
