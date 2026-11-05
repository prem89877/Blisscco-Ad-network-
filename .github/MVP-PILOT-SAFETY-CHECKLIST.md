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

## 13. Phase 3 Step 2: first controlled serve evidence

Added in Phase 3 Step 2. This section records evidence for the first controlled ad serve. The source is raw terminal output that the user pasted into the chat, and Claude did not reproduce it. A field with no result is Pending. Nobody fills a field with an estimate, and no key, token, host or destination is written here. The full record is in `PHASE3-STEP2-FIRST-SERVE-VERIFICATION-REPORT.md`.

| Field | Entry |
| --- | --- |
| Environment name | Vercel Preview with TEST project values and a dedicated test publisher. The host is not written here. |
| Publisher integration type | Direct `curl` from the tester's Android device (Termux). No chatbot integration and no example app was run against the Preview. |
| Date and time (UTC) | 2026-11-04, 05:37 to 05:39, from the response `date` header. |
| Match response | Topic `gaming`: HTTP 200, fill. Topic `health`: HTTP 200, body not visible in the pasted output. No error response was seen. |
| Ad rendering result | Pending. The ad JSON had `sponsored: true` and the five public fields. Nothing was rendered in a browser against the Preview. |
| Sponsored disclosure visible or not | Pending. Not looked at on a screen. Only the existing mocked component tests cover the label. |
| Impression response | Pending. Not run. |
| Click redirect behavior | Pending. Not run. |
| API latency | Pending. Not measured. No number is recorded. |
| Failure behavior | Pending. The 401, 400, 415 and 413 cases were not run in this pass. 429 and 503 cannot be caused on the Preview and are covered by mocked tests only. |
| Verification status | PARTIAL. Several items are Pending. Gates A to D stay NOT CONFIRMED. |

- [ ] Latency is measured from a stated tool and environment, and the numbers are recorded as measured.
- [ ] Impression, duplicate impression, changed token, click redirect and changed click reference are run on the Preview, and each result is recorded.
- [ ] The Sponsored label is looked at on a screen, and no empty sponsored container appears on a no-fill.
- [ ] The TEST key used in this pass is revoked, and a request with it returns 401.
- [ ] The three failing tests named in the Step 2 report have a diagnosed cause.

Limits: this section does not approve a pilot, does not start one and does not declare the publisher API ready for production use. Real publisher traffic does not start until every gate in section 7 has a dated result from a person. Sections 1 to 12 are unchanged.

## 14. Phase 3 Step 3: advertiser campaign verification record

Added in Phase 3 Step 3. This section records evidence for two TEST campaigns on the Preview. The sources are terminal output and a screenshot that the user attached to the chat, and the user's own report where the report says so. Claude did not reproduce any of it. A field with no result is Pending. Nobody fills a field with an estimate, and no key, host or full identifier is written here. The full record is in `PHASE3-STEP3-ADVERTISER-PILOT-VERIFICATION-REPORT.md`.

| Field | Campaign A | Campaign B |
| --- | --- | --- |
| Environment | Preview with TEST project values and a TEST advertiser. The host is not written here. | Same as campaign A. |
| Advertiser campaign identifier | `3657dd65` (first 8 characters) | Pending. Not recorded. |
| Campaign eligibility result | Status Active, and a match returned its ad. | Status Active with one approved ad, and a match returned its ad. |
| Campaign category | `gaming` | `travel` |
| Budget cap configuration | Total 198.00, daily 19.80 (USD), as reported by the user. | Total 1.00, daily 0.50 (USD), as shown on the campaign page. |
| Match result | Fill. | Fill. |
| Served creative identifier | `dd7c6b2a` (first 8 characters) | `d6b2e246` (first 8 characters) |
| Advertiser spend result | 0.0020 more spend for one serve, as reported by the user from the dashboard. | Spend 0.5000, equal to the daily cap, with 250 ads served on the dashboard. |
| Budget-exhaustion behavior | Pending. Not run. | The dashboard showed the daily budget used up. A later no-fill request is the user's report only. |
| Verification date | 2026-11-04 | 2026-11-04 |
| Verification status | PARTIAL | PARTIAL |

- [ ] The identifier of campaign B is recorded.
- [ ] A second TEST advertiser opens the first advertiser's campaign page and sees no campaign data.
- [ ] Draft, pending review, rejected and expired campaigns each return no-fill on the Preview.
- [ ] Concurrent requests against the real TEST database do not spend more than the cap and do not create duplicate spend records.
- [ ] The TEST key used in these checks is revoked, and a request with it returns 401.

Limits: this section does not approve a pilot, does not start one and does not declare the publisher API ready for production use. No real advertiser spending and no public launch. Gates A to D in section 7 stay NOT CONFIRMED. Sections 1 to 13 are unchanged.

## 15. Phase 3 Step 4: pilot monitoring thresholds and stop conditions

Added in Phase 3 Step 4. This section defines what to watch, what to do and who decides. No pilot traffic has been measured, so no rate, count or time limit is written here as a fact. Where no reliable number exists, the field is blank and the owner decides before the pilot. The full record is in `PHASE3-STEP4-PILOT-MONITORING-REPORT.md`.

### 15a. What the monitoring shows

- The admin page shows a Pilot monitoring panel (`app/dashboard/admin/page.tsx`, `components/dashboard/PilotMonitoringPanel.tsx`). Only an admin can open it, and the database function behind it returns nothing to any other account.
- It shows ad requests, fills, no-fills, API errors (503), caller errors (401, 429, 400), fill rate, average and slowest latency, serves, impressions, clicks and campaign spend, for the last 7 UTC days including today. Publisher earnings and ledger charges are not part of the panel (see 15c).
- Request counts and latency exist only while request recording is on. Recording is off by default and starts only when the server variable `PILOT_METRICS_ENABLED` has the exact value `"1"`. The monitoring SQL must also have been applied by a person to the TEST project first. When recording is off, the panel says so and shows no request figure.
- Only the outcome and the duration of a request are recorded. No conversation text, topic, user id, publisher key, address or campaign is recorded (`lib/ads/pilot-metrics-db.ts`).
- Recording runs after the answer is sent and never waits for the database. If recording fails, the ad answer is not changed (`lib/ads/match-handler.ts`).
- The panel applies no threshold and pauses nothing by itself. A person reads it on the dates the owner wrote (section 11b) and acts on the table in 15b.
- The latency shown is the Blisscco server side only. A publisher timeout happens on the publisher's server and is not visible to Blisscco, so the publisher reports it.

### 15b. Thresholds and actions

| Signal | Where it is read | Action | Threshold |
| --- | --- | --- | --- |
| API errors (503) increase | API errors card, and the publisher's report | Investigate before the next check. Read the Blisscco error codes in the server logs. | Increase that starts the investigation: ____ (owner decision, blank until set). No baseline has been measured. |
| Repeated publisher API timeouts | Publisher's own report | Pause the pilot. Pausing uses the same steps as a stop in section 10f. | Number of timeouts and the period: ____ (owner decision, blank until set). The timeout value belongs to the publisher. |
| Incorrect ad matching | A person compares the topic slug the publisher sent with the ad category (section 11b) | Pause the campaign that served the wrong ad. The eligibility rules need an exact category match, so a wrong match is a rule failure. | Proposed for the owner to accept or change: one wrong match found. Owner decision: ____ |
| Budget overspend | Campaign spend card, the campaign page and the ledger views, compared with the written cap (section 10b) | Stop the pilot at once (section 10f). | Any spend above the written cap. The cap amounts are owner decisions and are blank until set. |
| Duplicate financial events | The ledger and payout views, read by a person | Stop the pilot at once (section 10f). The database allows one ledger entry per serve and entry type, so a duplicate means a rule was bypassed. | Any single duplicate. |
| Tracking inconsistency | Consistency notes on the panel | Pause the affected campaign. One serve has at most one impression, and a click counts only after an impression, so the first two notes mean a rule was bypassed. | Any occurrence of the notes "Impressions are higher than serves" or "Clicks are higher than impressions". Tolerance for a difference from the publisher's own counts: ____ (owner decision, blank until set). |
| Publisher integration failure | Publisher's report | The publisher shows no ad and the chat keeps working (Gate C in section 7). Blisscco never guesses an ad: an outage answers 503 with `unavailable` and a request with no eligible ad answers a no-fill. | A single failure is not a stop. Repeated failures follow the timeout row. |
| Latency | Average and slowest latency cards | Record the figures with the date. Write the limit after the first measured sample. | Latency limit: ____ (owner decision, blank until set). No latency limit is claimed here. |

Blank fields in the table above are owner decisions and stay blank until the owner writes them. This section has no tick boxes by the owner's choice.

### 15c. Limits

- No Preview or Production service was contacted for this section. The monitoring SQL was not run on any database, and no pilot metric has been measured.
- Request counts, fill rate and latency are zero or missing until recording is on. A figure in the panel is a recorded count and is not a performance claim.
- The existing limit of 20 wrong keys per minute for one address in `lib/ads/ip-guard.ts` protects the endpoint. It is not a pilot health threshold.
- This section does not approve a pilot, does not start one and does not declare the publisher API ready for production use. Gates A to D in section 7 stay NOT CONFIRMED.
- Publisher earnings and ledger charges are not shown in the panel. The ledger tests allow only the ledger SQL files to read the ledger, so a ledger summary for admins is a pending owner decision. Until then, earnings and charges are read in the existing ledger and payout views.
- The ledger, the payout rules, the budget rules and the Revive flags were not changed.

### 15d. Sign-off

| Item | Evidence kept | Date | Checked by | Result |
| --- | --- | --- | --- | --- |
| Monitoring thresholds written | | | | NOT CONFIRMED |
| Monitoring panel read | | | | NOT CONFIRMED |

A row is filled only by a person, with a dated result. Nothing was run to write this table.
