# Phase 6 Step 3 Part 2 - International Publisher Onboarding

Status: code + tests done. **No new SQL** in this part. Production not accessed. Manual verification **NOT done**. Part 3 is done: see `PHASE6-STEP3-PART3-ADMIN-READINESS-REPORT.md`.

## 1. Files

NEW
- `tests/regions/phase6-step3-part2-publisher-onboarding.test.ts`
- `PHASE6-STEP3-PART2-PUBLISHER-ONBOARDING-REPORT.md`

MODIFIED
- `app/dashboard/page.tsx` (overview = page every login lands on: country option for new / existing advertiser and publisher)
- `app/dashboard/publisher/page.tsx` (pending / rejected hint text only)
- `supabase/MIGRATION-ORDER.md` (row 44 wording: applied on TEST on 2026-11-10, NOT on Production)
- `tests/regions/phase6-step3-part1-advertiser-country.test.ts` (row 44 check follows that wording)

NOT changed: country mapping, Step 2 SQL / actions / admin approval, serve gate, pricing, payments, USD payouts, ledger, API keys, auth.

## 2. Database changes

None. Step 2 already has everything: `publishers.country_*` columns, `submit_publisher_country` (always `pending`), `admin_review_publisher_country` (`verified` / `rejected`), service_role-only `get_publisher_country_state`. A second workflow would have been a duplicate, so nothing was added.

## 3. Behavior

- Registration: publisher setup has a country dropdown (central ISO list, optional). Valid code -> `submit_publisher_country` -> `pending`. Invalid (`UK`, `XX`, ...) -> field error, nothing saved.
- Verification: admin approve -> `verified`, reject -> `rejected` (existing admin screen). Only `verified` + ISO-valid country gets a region (one of the 8, from `country-region.ts`). Pending / rejected / missing / invalid -> No Fill (unchanged).
- Publisher page: shows country + status; hint for pending ("being checked") and rejected ("choose the correct country and submit again"); button "Submit a different country" for rejected (same RPC, same rules: own row, not suspended).
- New request (any login): overview shows the real setup form with country dropdown for a new advertiser / publisher; existing accounts with no country (and publishers with a rejected country) get a country panel there. Selected country is saved through the existing actions. Not shown if load failed or account suspended.
- Existing publishers: untouched (country columns stay null = "missing" = No Fill, as before). No re-registration; keys, earnings, ledger unchanged.

## 4. Tests executed (actual, local, fake Supabase)

- New file: 19 tests, 19 pass.
- Full suite: 5292 tests, 5290 pass, 1 fail, 1 skipped. The 1 failure is `day 28 part 1 | publisher example files compile strictly`: needs `next` types, not installed in this sandbox; not related to this change (CI has them).
- NOT run here: ESLint, `next build`, full typecheck (no `node_modules`). CI runs them.

## 5. Remaining manual verification (NOT done)

1. TEST app: new publisher login -> overview shows setup form with country -> save -> publisher page shows country "Waiting for verification".
2. Admin approves -> publisher page "Verified"; admin rejects another -> "Not accepted" + resubmit works and goes back to pending.
3. TEST app: new advertiser login -> overview shows setup form with country -> country saved (check `advertisers.country_code`).
4. Existing publisher / advertiser without country: overview panel appears; saving works.
5. Ad serving with `REGIONAL_ELIGIBILITY_ENFORCED=1` on TEST: verified publisher served in its region; pending / rejected get No Fill.
6. Production: nothing applied; separate approval needed.
