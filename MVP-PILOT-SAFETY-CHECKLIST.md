# Blisscco MVP Pilot Safety Checklist (Day 30 Part 2)

This is a checklist for a human to work through before a real publisher is invited. It is documentation only. Nothing was run to write it, and no environment value, flag, SQL file or deployment was changed.

Every box below starts empty. No item is confirmed by this document. A box is ticked only by a person who did the check, with the date and their name. Notes record "found" or "not found" and never the secret value itself.

Related documents: `MVP-FEATURE-STATUS.md` (what exists in the code), `DAY14-PART3-PRODUCTION-ENV.md` (environment variables), `DAY27-REAL-REVIVE-VERIFICATION.md` (Revive checklist), `DAY6-ADS-MATCH-CONTRACT.md` (match contract).

## 1. Rules for using this checklist

- Do not paste a key, secret, token, database URL or Revive delivery URL into this file, a ticket, a chat, a screenshot or a pull request.
- Nothing in this checklist turns on a feature. It does not enable the Revive fallback or the Revive JSON preview.
- If a secret is found where it should not be, revoke or rotate it first, then investigate.
- Run each check only against the environment named in the item. Use TEST for anything that sends requests.

## 2. Separate TEST and Production environments

- [ ] Production and TEST use two different Supabase projects with different project references.
- [ ] Vercel Preview uses values from the TEST project for all three Supabase variables. Only Production uses the Production project.
- [ ] `SUPABASE_SECRET_KEY` in Preview is the TEST project's key, not the Production key (see `DAY14-PART3-PRODUCTION-ENV.md`).
- [ ] The manual "DB integration" workflow (`.github/workflows/integration.yml`) holds TEST secrets only. It starts by hand and never on push or pull request.
- [ ] The TEST database guard (`tests/integration/test-db-guard.ts`) is left as it is. It refuses a Production environment and a database that matches a Production identifier.
- [ ] No Production database URL appears in any TEST secret, and no TEST database URL appears in any Production variable.
- [ ] CI (`.github/workflows/ci.yml`) uses dummy build values only and no repository secrets.
- [ ] The pilot uses a dedicated test publisher with its own key in TEST first. A real publisher's key is never used in TEST, Preview or local development.
- [ ] No real advertiser or publisher data is copied into TEST.
- [ ] Which SQL files are applied to TEST and to Production is checked by a person. This document does not claim any state.

## 3. Server-only secrets

Names only, never values.

| Name | Kind | Where it may live |
| --- | --- | --- |
| `SUPABASE_SECRET_KEY` | secret | Vercel server env, marked Sensitive |
| `AD_TRACKING_SECRET` | secret | Vercel server env, marked Sensitive |
| `AD_TRACKING_SECRET_PREVIOUS` | secret | Vercel server env, only while rotating |
| `REVIVE_DELIVERY_URL` | secret (may contain tokens) | server env only, and only if the fallback is ever approved separately |
| `TEST_DATABASE_URL` | secret | GitHub repository secret of the TEST project |
| `TEST_SUPABASE_PROJECT_REF` | identifier | GitHub repository secret of the TEST project |
| `REVIVE_FALLBACK_ENABLED`, `REVIVE_JSON_PREVIEW_ENABLED` | flags, not secrets | server env, left unset (section 5) |

Public by design: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_CONTACT_EMAIL`.

- [ ] No name in the secret rows above has a `NEXT_PUBLIC_` prefix, in Vercel, in `.env.example` or in any file.
- [ ] The build guard (`config/public-env-guard.mjs`, loaded by `next.config.mjs`) is understood. It stops the build for a `NEXT_PUBLIC_` name containing SECRET, SERVICE_ROLE, PRIVATE, PASSWORD, TOKEN, SIGNING or API_KEY, and for a public value that starts like a Supabase secret key, a publisher key or a service-role token.
- [ ] The guard does not look at a name such as `NEXT_PUBLIC_REVIVE_DELIVERY_URL` or a public database URL. Check by hand that no such variable exists.
- [ ] The server-only files (`lib/supabase/admin.ts`, `lib/ads/service.ts`) are not imported by any `"use client"` file.
- [ ] `.env` files are not committed. Only `.env.example` is, and it holds placeholders.
- [ ] Sensitive is switched on for each secret in Vercel.
- [ ] A rotation plan exists: a new `SUPABASE_SECRET_KEY` after a leak, and a new `AD_TRACKING_SECRET` with the old one kept as `AD_TRACKING_SECRET_PREVIOUS` for a short time.

## 4. Publisher API-key handling

- [ ] The pilot publisher creates their own key on the Publisher page. The key is shown once and only a one-way hash is stored.
- [ ] The key is never sent by email, chat or ticket. Blisscco staff never ask for it.
- [ ] The publisher keeps the key only in their server's environment variables or secret manager (for example `BLISSCCO_PUBLISHER_API_KEY`). It is not put in browser code, a mobile app, a `NEXT_PUBLIC_` variable, git, logs, tickets or chat.
- [ ] The publisher uses a separate named key for each server or environment, so one can be revoked alone.
- [ ] The publisher knows the revoke-first rule: if a key may have leaked, revoke it on the Publisher page, then create a replacement.
- [ ] The match call is made server to server only. The API has no CORS on purpose.
- [ ] The test key is revoked when testing ends.
- [ ] The publisher has read sections 2, 8 and 9 of the publisher guide (`app/dashboard/publisher/guide/page.tsx`).

## 5. Revive fallback stays off

How the code behaves today: the fallback runs only when Blisscco itself has no ad, and only when `REVIVE_FALLBACK_ENABLED` has the exact value `"true"` on the server. Any other value, or no value, means off. The Revive JSON preview route has its own separate flag and also stays off by default. A provider ad is not charged, has no tracking and earns the publisher nothing.

- [ ] `REVIVE_FALLBACK_ENABLED` is unset in Production and in Preview. Check that the variable name is absent in the Vercel dashboard.
- [ ] `REVIVE_JSON_PREVIEW_ENABLED` is unset in Production and in Preview.
- [ ] `REVIVE_DELIVERY_URL`, `REVIVE_TIMEOUT_MS` and `REVIVE_RESPONSE_FORMAT` are absent from Production.
- [ ] `.env.example`, `ci.yml` and `integration.yml` contain no Revive variable.
- [ ] The pilot publisher is told that ads come only from approved Blisscco campaigns and that no-fill is a normal answer.
- [ ] A person understands that a real Revive endpoint has never been checked in this repository. The Revive JSON preview is not proof of a live Revive integration.
- [ ] Turning the fallback on is a separate written decision. It is allowed only after the Preview-only checklist in `DAY27-REAL-REVIVE-VERIFICATION.md` is done, and it is not part of this pilot checklist.

## 6. Exposure check: browser bundles and public logs

These are manual steps for a person to do later. None has been run. Search for patterns and prefixes, not for pasted real values. For a secret with no recognizable prefix (the tracking secret, the Revive URL), compare against a terminal variable and never print it or type it into a command.

What to look for:

| Secret | Pattern |
| --- | --- |
| Publisher key | `blc_live_` followed by long hex |
| Supabase secret key | `sb_secret_`, or a JWT whose role is service_role |
| Database URL | `postgres://` or `postgresql://` with a password |
| Revive delivery URL | the value of `REVIVE_DELIVERY_URL` |
| Tracking secret | the value of `AD_TRACKING_SECRET` |

Source and build:

- [ ] Search the repository (`app`, `components`, `lib`, `examples`, docs, workflows) for the patterns above. Only placeholders may appear.
- [ ] After a build in TEST, search the built client files under `.next/static` for the same patterns and for the secret values held in a terminal variable. Nothing may match.
- [ ] No `"use client"` file imports `lib/supabase/admin.ts`, `lib/ads/service.ts`, `lib/publisher/keys-db.ts`, `lib/ledger/ledger-db.ts` or any Revive file.

Browser:

- [ ] Open the dashboard, the Publisher page (before and after creating a key), login and the guide page. In the browser network tab and page source, no secret pattern appears in a URL, header, response body or cookie.
- [ ] A click link carries only the signed `click_ref`. It carries no publisher key and no tracking token.
- [ ] Error pages and 503 answers show no variable value and no URL.

Logs:

- [ ] In Vercel logs for match, impression and click calls, only static labels and error codes appear. No key, hash, topic, token or URL appears.
- [ ] The only configuration lines are variable names, for example `[config] missing server env: <NAME>`.
- [ ] GitHub Actions logs for CI and the DB integration run show no secret value. The workflows print names only and do not echo values.
- [ ] No secret appears in a pull request, issue, comment, screenshot or chat. If one does, revoke or rotate it at once.

On the publisher's side (section 9 of the guide):

- [ ] The publisher searches their own built frontend and network tab. The key appears nowhere.

## 7. Conditions before inviting a real publisher

All four gates must be confirmed in TEST, with evidence, before any real publisher is invited. Today every gate is NOT CONFIRMED, because nothing has been run.

### Gate A: API contract

- [ ] Using the TEST publisher, a valid request to `POST /api/v1/ads/match` returns 200, either an ad or `{"fill":false}`.
- [ ] A wrong key returns 401, an extra body field returns 400, a wrong content type returns 415 and an oversized body returns 413.
- [ ] Every ad response has `sponsored: true` and only the public ad fields. No advertiser, budget or campaign data appears.
- [ ] Responses carry `Cache-Control: no-store`, and the version header `X-Blisscco-Api-Version: 1` is present on the v1 route.
- [ ] The publisher's integration handles 429 and 503 without breaking the chat.

Evidence to record: date, person, environment name, and pass or fail per item. Status: NOT CONFIRMED.

### Gate B: Tracking behavior

- [ ] `AD_TRACKING_SECRET` is set in the environment under test. The behavior with it unset (no `tracking` field, impression and click endpoints unavailable) is also understood.
- [ ] A match with the header `X-Blisscco-Tracking: 1` returns a tracking token and a click reference.
- [ ] Reporting the same impression twice gives `recorded`, then `duplicate`.
- [ ] A token or reference with one changed character is rejected (401 for the token, 404 for the click reference) and nothing is recorded.
- [ ] The click link redirects to the destination stored for the ad, and no link on the publisher page points straight at `destination_url`.
- [ ] The impression is reported only after the ad is shown, and only from the publisher's server.
- [ ] The charge happens at serve time only. Impression and click counts are reporting numbers and are not used alone for billing or payouts.

Evidence to record: date, person, environment name, and pass or fail per item. Status: NOT CONFIRMED.

### Gate C: No-fill behavior

- [ ] With no eligible campaign, the answer is 200 with `{"fill":false}`.
- [ ] A sensitive topic (for example health) gives no-fill.
- [ ] With the Revive fallback off, a no-fill stays a no-fill.
- [ ] The publisher can tell a no-fill (200) from an outage (503 with `unavailable`).
- [ ] The publisher's chat keeps working normally and shows nothing extra on no-fill.

Evidence to record: date, person, environment name, and pass or fail per item. Status: NOT CONFIRMED.

### Gate D: Publisher disclosure guidance

- [ ] The publisher has received the guide sections on the Sponsored label (section 6) and on disclosure and responsibilities (section 6a).
- [ ] The publisher confirms in writing that every ad is shown with a clear Sponsored label and as plain text.
- [ ] The publisher knows that only a topic category is sent. Conversation text and personal data are not sent.
- [ ] The privacy and terms pages are live in the environment under test, and `NEXT_PUBLIC_CONTACT_EMAIL` shows a real contact address.
- [ ] The publisher knows that they, not Blisscco, are responsible for their own chatbot interface and their own user-facing disclosures.

Evidence to record: date, person, and the written confirmation. Status: NOT CONFIRMED.

### Sign-off

| Item | Evidence kept | Date | Checked by | Result |
| --- | --- | --- | --- | --- |
| Section 2: environments separate | | | | NOT CONFIRMED |
| Section 3: server-only secrets | | | | NOT CONFIRMED |
| Section 4: key handling | | | | NOT CONFIRMED |
| Section 5: Revive flags unset | | | | NOT CONFIRMED |
| Section 6: exposure checks | | | | NOT CONFIRMED |
| Gate A: API contract | | | | NOT CONFIRMED |
| Gate B: tracking | | | | NOT CONFIRMED |
| Gate C: no-fill | | | | NOT CONFIRMED |
| Gate D: disclosure | | | | NOT CONFIRMED |

Invite a real publisher only when every row has a dated result from a person.

## 8. Limits of this checklist

- It was written from the existing code and documents. No test, lint, build, database check or live endpoint check was run, and no Preview or Production service was contacted.
- It does not approve a pilot. The publisher guide itself lists known limitations, and no staging environment is published.
- It does not say which SQL is applied anywhere, or whether any secret is currently exposed.

## 9. Not changed

Environment values, the Revive fallback flag, SQL and migration files, Production data, credentials, payment and ledger behavior, and deployment configuration were not changed, and no live service was contacted. No `.sh` script was added, so `.github/workflows/ci.yml` is unchanged.

## 10. Phase 3 Step 1: controlled pilot scope and limits

Added in Phase 3 Step 1. This section is documentation only. It prepares a controlled pilot and does not start one. The pilot is not a public launch and not an unrestricted production rollout. Every box below starts empty, and no item is confirmed by this document.

What the code does and does not enforce, read from the repository and not run:

- The application has no pilot cap. `lib/campaigns/constants.ts` sets a minimum total budget and a very high maximum total budget for every advertiser. These are application limits, not pilot caps.
- A campaign reaches `active` only through admin approval (`lib/campaigns/review.ts`). So the pilot budget cap is a manual rule that the admin applies at review. No code applies it.
- An account that is not approved or is suspended cannot serve or call the API (`PUBLISHER-PILOT-ONBOARDING.md`, `MVP-FEATURE-STATUS.md`).
- Payouts are a manual record. The publisher requests, an admin approves, rejects or marks paid. Paid only records that money was sent outside the system. No payment provider is used (`lib/payouts/rules.ts`).
- The signup form is public in the code. New accounts wait for approval. So "no public self-service onboarding" is a rule for people: only the named pilot accounts are approved, and the signup page is not promoted.

### 10a. Pilot scope

- [ ] At most 1 trusted chatbot publisher is approved. Every other publisher account stays Waiting for approval or Suspended.
- [ ] At most 2 early advertisers are approved. Every other advertiser account stays Waiting for approval or Suspended.
- [ ] Only Blisscco contextual ads from approved campaigns are served. No other ad source is used.
- [ ] The Revive fallback stays off in every environment the pilot touches (section 5). A no-fill stays a no-fill.
- [ ] Payouts stay manual: no payment provider is connected and no transfer is made by code.
- [ ] The signup page is not promoted, and no publisher or advertiser is told they can join on their own.
- [ ] Nobody describes the pilot as a public launch, a general release or a production rollout.
- [ ] The pilot runs against TEST or Preview first (section 2). Moving it anywhere else is a separate written decision.

### 10b. Budget caps and campaign eligibility

The cap amounts are decisions for the Blisscco owner. This document sets no number. Write each decision in the sign-off table, not here, and leave a field blank until the owner has decided.

- [ ] The owner has written a maximum total budget per pilot campaign and a maximum for all pilot campaigns together. Both are small.
- [ ] The admin checks the campaign's total budget and daily budget against that cap before approving it. A campaign above the cap is rejected or sent back to draft.
- [ ] Every pilot campaign follows the existing rules: one of the nine categories, at least one approved ad, a valid date window, an active advertiser account and budget left. None of these rules is relaxed for the pilot.
- [ ] No pilot campaign uses a sensitive topic. Sensitive topics serve no ad.
- [ ] The admin does not change a campaign's budget, status or ledger record by hand in the database. Changes go through the dashboard.
- [ ] The owner has written who may approve campaigns and payouts during the pilot, and that person is the only approver.

### 10c. Production credentials and database changes

- [ ] No Production credential is used for any pilot step. Pilot checks use TEST or Preview values only.
- [ ] No SQL file, migration or manual database edit is applied to Production as part of the pilot preparation.
- [ ] No real payout data is copied into TEST or into any file in the repository.
- [ ] The scheduled cleanup of old records is a separate decision. Its state is unknown today (see `PHASE2-STABILIZATION-EXIT-REPORT.md`).

### 10d. Manual payout approval

- [ ] Every payout request is approved by the named approver by hand, after the approver has read the publisher's ledger balance on the earnings page.
- [ ] An amount above the ledger balance is rejected. The database already refuses it, and the approver does not work around it.
- [ ] The owner has written a small maximum payout amount for the pilot and records it in the sign-off table.
- [ ] Paid is set only after the money was sent outside the system, and the transfer reference stays with the owner, not in this repository.
- [ ] The earnings page does not track pending, approved or paid-out balances (`lib/ledger/earnings.ts`). The approver keeps a separate written record of each payout.

### 10e. Publisher key leak: revoke first

1. Revoke the key on the Publisher page. Do this before anything else, and before looking for the cause.
2. Check that the revoked key now returns 401 on TEST or Preview.
3. Create a replacement key and give it to the publisher through the dashboard flow only. Nobody sends it by email, chat or ticket.
4. Search the places where the key was seen (logs, ticket, chat, screenshot, repository) and remove it there.
5. Write the date, who did it and what was found, with no key value.
6. If a Supabase key or the tracking secret may also have leaked, follow the rotation plan in section 3.

- [ ] The pilot publisher and the approver have both read these steps before the pilot starts.
- [ ] A revoke has been practised once on a TEST key before the pilot starts, and the date is written in the sign-off table.

### 10f. Pilot stop conditions

Stop the pilot at once on any condition below. Stopping means: suspend the pilot publisher account, pause or suspend the pilot advertiser campaigns or accounts, and revoke the pilot key if a leak is possible. Thresholds with a number are set by the owner before the pilot and are blank until then.

- [ ] A key, secret, token, database address or Revive address appears in a log, bundle, ticket, chat, screenshot or repository.
- [ ] Any Revive flag is found set, or an ad that is not from an approved Blisscco campaign is served.
- [ ] Advertiser spend goes above the written cap, or a charge cannot be explained by a match request.
- [ ] A payout is approved above the ledger balance, or a payout record and the ledger disagree.
- [ ] Conversation text, a user id, an email or other personal data is found in a request to Blisscco.
- [ ] The publisher shows an ad without the visible Sponsored label, or presents it as the chatbot's own words.
- [ ] 503 answers or timeouts continue for longer than the owner's written limit: ____ (blank until set).
- [ ] A dashboard button error screen repeats more than the owner's written count: ____ (blank until set).
- [ ] A sensitive-topic request returns an ad.
- [ ] Anything touches Production data, Production credentials or real payout data.
- [ ] The approver, the publisher or the owner asks to stop for any reason.

After a stop, nobody restarts the pilot until the cause is written down and the owner writes a restart decision.

### 10g. Pilot sign-off (Phase 3 Step 1)

| Pilot item | Evidence kept | Date | Checked by | Result |
| --- | --- | --- | --- | --- |
| Pilot scope (10a) | | | | NOT CONFIRMED |
| Budget caps written (10b) | | | | NOT CONFIRMED |
| Payout maximum and approver written (10d) | | | | NOT CONFIRMED |
| Revoke practised on a TEST key (10e) | | | | NOT CONFIRMED |
| Stop thresholds written (10f) | | | | NOT CONFIRMED |

## 11. Phase 3 Step 1: pilot observation checklist

Added in Phase 3 Step 1. This section is documentation only. No number is filled in here. A value that was not measured is written as "not measured". Nobody estimates, rounds up or copies a number from memory. Never write a key, token, database address, conversation text or user id in a record.

### 11a. What to watch and where it can be seen

This is read from the code and not run. Where no source was found, the record says so.

| Observation | Where it can be seen today |
| --- | --- |
| Ad match response latency | No latency figure is stored or shown by the application. The ad handlers write no logs. Time a request on the publisher's server or from the tester's own tool, and record the tool and the environment. |
| API errors and timeout behavior | Status codes (400, 401, 413, 415, 429, 503) are seen by the publisher's server. Blisscco logs hold static labels and error codes only. The publisher sets its own timeout. |
| Fill and no-fill rate | No dashboard counter for no-fill was found in the code. The publisher counts fills and no-fills on its own server. Record the counts and the period. |
| Ad relevance | A person compares the topic slug the publisher sent with the category of the ad it received, for a written sample of requests. |
| Impression and click consistency | Publisher analytics and the campaign performance panel show impressions, clicks and click-through rate. Compare them with the publisher's own counts. They are reporting counts and do not prove an ad was shown or clicked. |
| Publisher integration errors | The publisher reports them. Blisscco has no view of the publisher's code. |
| Advertiser campaign spend | The campaign page and the advertiser analytics show spend. Compare it with the written cap. Spend is counted when an ad is handed over. |
| Publisher earnings and payout records | The earnings page, the ledger entries and the payout requests list. Pending, approved and paid-out balances are not tracked, so the approver keeps a written record. |

### 11b. Observation checklist

- [ ] Latency is recorded from a stated tool and environment, for at least a written sample of requests, with the tool named.
- [ ] Every API error and timeout the publisher saw is recorded with its status code and date. The chat was not disturbed by any of them.
- [ ] Fills and no-fills are counted by the publisher for a stated period, and the counts are recorded as the publisher gave them.
- [ ] Ad relevance is judged by a person for a written sample, and each judgement is recorded with the topic slug and the ad category.
- [ ] Impression and click counts are compared with the publisher's own counts, and every difference is recorded with its date, not explained away.
- [ ] Each publisher integration error is recorded with the date, the environment and what the publisher reported.
- [ ] Advertiser spend per pilot campaign is read from the dashboard and compared with the written cap on each check.
- [ ] Publisher earnings, ledger balance and each payout record are read on each check and compared with the approver's written record.
- [ ] The check is done on dates the owner wrote before the pilot starts, and each date is recorded.

### 11c. Record format

Copy one block per observation into a private file, not into this repository. Leave a field blank or write "not measured" when it is unknown.

| Field | Entry |
| --- | --- |
| Date (UTC) | |
| Environment (TEST, Preview or other, named) | |
| Observation (one row from 11a) | |
| Method and tool | |
| Period or sample size | |
| Actual result (as measured, with the unit) | |
| Expected or cap (from the owner's written rule) | |
| Recorded by | |
| Source of the result (own measurement, publisher report, dashboard) | |
| Notes (no key, token, address, conversation text or user id) | |

## 12. Phase 3 Step 1: limits

- This section and sections 10 and 11 were written from the existing code and documents. No test, lint, build, database check or live endpoint check was run for them, and no Preview or Production service was contacted.
- They do not approve a pilot, do not start one and do not declare the publisher API ready for production use. The publisher guide still says it is not ready for production use.
- The cap amounts, payout maximum, stop thresholds and observation dates are not set. They are owner decisions.
- Gates A to D in section 7 are still NOT CONFIRMED.
- Gate A: on 2026-11-04 the user reported by hand the 401, 400, 415 and 413 error cases and a 200 no-fill on the Preview. That is the user's word only, and no output was seen by Claude. The boxes in section 7 stay empty and the gate stays NOT CONFIRMED. Pending for Gate A: the response headers, a real ad with only the public fields, and the 429 and 503 handling. The record is in `PHASE3-STEP1-PILOT-PREPARATION-REPORT.md`, section 10.
- A TEST key appeared in a chat during those checks. It must be revoked first, and a request made after the revoke must return 401. Neither result is reported yet.
- Existing financial safeguards, the ledger, the payout rules and the Revive flags were not changed. See `PHASE3-STEP1-PILOT-PREPARATION-REPORT.md`.
