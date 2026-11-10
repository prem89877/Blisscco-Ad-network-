# Login country screen (before the dashboard opens) + "Do it later"

Status: code + tests done. **No new SQL.** Production not accessed. Manual verification **NOT done**.

## Behavior
- After login the user lands on `/dashboard`. If an **advertiser or publisher has not chosen a country**, they are sent to `/auth/choose-country` first (same style as `/auth/choose-role`).
  - New user (no business / platform saved yet): the setup form with the country dropdown.
  - Existing user without a country: only the country form. Saved => straight to the dashboard.
  - **"Do it later"** button => dashboard opens (`/dashboard?later=1`).
- "Later" is remembered **for this login only**: session cookie `bc_country_later` (httpOnly, no maxAge) holding user id + last sign-in time. A new login changes that time, so the screen comes back until a country is chosen.
- Not shown for: admin, suspended accounts, load failures, publishers whose country is pending / verified / rejected (Step 2 workflow and resubmit button already cover those), anyone who already has a country.
- Country save reuses the existing actions: advertiser -> `advertisers.country_code`; publisher -> `submit_publisher_country` (always `pending`, admin verifies). No second workflow, no duplicate country list.

## Files
NEW: `app/auth/choose-country/page.tsx`, `app/auth/choose-country/actions.ts`, `lib/regions/country-prompt.ts`, `lib/regions/country-prompt-queries.ts`, `tests/regions/phase6-step3-login-country-prompt.test.ts`, `tests/regions/phase6-step3-login-country-prompt-publisher.test.ts`
MODIFIED: `app/dashboard/page.tsx` (gate), `app/dashboard/advertiser/country-actions.ts` and `app/dashboard/publisher/country-actions.ts` (redirect to dashboard only when hidden flag `continue=dashboard`), `components/dashboard/AdvertiserCountryForm.tsx` and `PublisherCountryForm.tsx` (optional `continueToDashboard` prop), `tests/regions/advertiser-country-stubs.ts` (test helper)
NOT changed: auth actions, middleware, SQL, pricing, payments, payouts, ledger, API keys.

## Tests (actual, local, fake Supabase / cookies)
- New: 18 tests (14 + 4), all pass. Full suite: 5310 tests, 5308 pass, 1 fail, 1 skipped.
- The 1 failure: `day 28 part 1 | publisher example files compile strictly` - needs `next` types, missing in this sandbox only; unrelated (CI has them).
- NOT run here: ESLint, `next build`, full typecheck.

## Manual verification still to do (NOT done)
1. TEST: log in as a new advertiser and a new publisher -> country screen appears before the dashboard.
2. Choose a country -> dashboard opens; advertiser row has `country_code`; publisher shows "Waiting for verification".
3. Click "Do it later" -> dashboard opens; browse around, no loop; log out and log in again -> screen comes back (country still missing).
4. Existing advertiser / publisher without country -> screen appears; with country -> goes straight to the dashboard.
5. Google login (new user): role choice first, then the country screen.
6. Deep link (e.g. bookmark to `/dashboard/publisher`) does not show the screen; only the `/dashboard` landing does.
7. Production: nothing applied.
