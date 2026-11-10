# Phase 6 Step 3: Manual verification and CI guide

Covers: login country screen, Part 1 (advertiser country), Part 2 (publisher onboarding), Part 3 (Admin). **Nothing here is done yet.** Tick a box only after you have actually seen the result.

Rules: use the **TEST** project (Denim Hub Bsl) and a Vercel **Preview** that points to it. Never Production. Do not run any SQL on Production.

## A. Local and CI checks (on your machine / GitHub)

Run from the project folder. Node 22 (`.nvmrc`).

1. `nvm use` (or install Node 22), then `npm ci`
2. `npm run lint` (type check) - expect 0 errors
3. `npm test` - expect 0 failures. Sandbox result for reference: 5353 tests, 1 failure (`day 28 part 1 | publisher example files compile strictly`) that only happens without `next` installed; with `npm ci` it should pass.
4. `npm run lint:eslint` - expect no errors
5. `npm run build` with dummy values, same as CI:
   - `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_dummy SUPABASE_SECRET_KEY=sb_secret_dummy npm run build`
6. GitHub: push the branch, open **Actions > CI**. All steps must be green (install, type check, tests, ESLint, build). A skipped or red step is not a pass.
7. Optional: **Actions > "DB integration (TEST database only)" > Run workflow**. Needs the TEST secrets. Not required for Step 3 (no new SQL in Part 3).

If a check fails: copy the failing step's log lines and send them. Do not mark it passed.

## B. Manual verification on TEST Preview

Before you start: Part 1 SQL (`phase6-step3-1-advertiser-country.sql`) and Step 2 SQL are applied on TEST (see `supabase/MIGRATION-ORDER.md`). You need four logins: an **admin**, a **new advertiser**, a **new publisher**, and an **existing advertiser and publisher with no country**.

### B1. Login country screen
- [ ] New advertiser and new publisher: after login, `/auth/choose-country` appears before the dashboard.
- [ ] Choose a country: dashboard opens. Advertiser row has `country_code`; publisher shows "Waiting for verification".
- [ ] "Do it later": dashboard opens, no loop while browsing; log out and in again: screen returns.
- [ ] Existing account without country: screen appears; with a country: straight to dashboard.
- [ ] Google login (new user): role choice first, then country screen.
- [ ] Deep link `/dashboard/publisher` does not show the screen.

### B2. Advertiser country (Part 1)
- [ ] New advertiser signup with a country saves it; signup without a country still works.
- [ ] Existing advertiser: My campaigns > "Business country" panel saves a country; existing campaigns unchanged.
- [ ] Tampered form value (for example `UK`) is rejected.
- [ ] Pricing / billing screens look the same (USD).

### B3. Publisher onboarding (Part 2)
- [ ] New publisher with a country: publisher page shows country and "Waiting for verification".
- [ ] Admin verifies it: publisher page shows "Verified".
- [ ] Admin rejects another: "Not accepted"; "Submit a different country" works and goes back to pending.
- [ ] Existing publisher without a country: country panel appears; keys, earnings, payouts unchanged.
- [ ] Ad serving with `REGIONAL_ELIGIBILITY_ENFORCED=1` on Preview: verified publisher gets ads for its region; pending / rejected get no ads. Flag off: behaves as before.

### B4. Admin (Part 3) - log in as admin, open `/dashboard/admin`
- [ ] "Waiting: ... N publisher country review(s)" matches the number of pending countries.
- [ ] "Country overview" panel shows publisher counts and advertiser counts; the totals look right for your TEST data.
- [ ] Advertisers and Publishers lists each show a "Country:" line, for example `India (IN) · South Asia · Verified`.
- [ ] Old account with no country shows "Country not chosen" (advertiser) or "Country not submitted" (publisher), and is listed under needs attention.
- [ ] "Publisher countries" panel: **Verify country** on a pending one makes it Verified; **Reject country** makes it Not accepted. Refresh: counts and lines update.
- [ ] The Country overview panel itself has no buttons (read-only).
- [ ] Optional, TEST only: in the SQL editor set one test advertiser to `XX` (`update public.advertisers set country_code = 'XX' where id = '<test advertiser id>';`). Admin shows "XX · Invalid country code". Set it back to `null` afterwards.
- [ ] Other Admin parts still work: account approve / suspend, ad review, campaign review, payouts panels.

### B5. Access control
- [ ] Logged in as advertiser: open `/dashboard/admin` directly. You are sent back to `/dashboard`; no Admin link in the menu.
- [ ] Same as publisher.
- [ ] Logged out: `/dashboard/admin` sends you to login.

### B6. Money regression
- [ ] Campaign budgets and spend show in USD as before.
- [ ] Publisher earnings and payout request / settlement screens show the same USD figures as before.

## C. Production

Nothing is applied. Do not run SQL or turn on `REGIONAL_ELIGIBILITY_ENFORCED` on Production until you decide in writing after sections A and B are complete.
