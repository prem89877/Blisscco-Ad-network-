# Blisscco Publisher Pilot Onboarding (Day 30 Part 3)

This is documentation only. It restates the existing publisher guide (`app/dashboard/publisher/guide/page.tsx`) and the example integrations (`examples/publisher-node`, `examples/publisher-nextjs`). No code, route or contract was changed, and nothing was run to write it. No deployment, Production database or live endpoint was touched.

Phase 3 Step 1 added sections 10 and 11 for a controlled pilot. They are documentation only, and no code, route or API contract was changed for them. The pilot is not a public launch.

## 1. Status

- Access is limited and accounts are approved by hand.
- The guide marks the API as not ready for production use. Do not roll it out to real users yet.
- The controlled pilot is limited to 1 trusted chatbot publisher and 1 to 2 early advertisers, with small capped budgets, Blisscco contextual ads only, the Revive fallback off and manual payouts only (section 10).
- There is no public self-service onboarding for the pilot. Only the named pilot account is approved.
- Blisscco has no integration with ChatGPT or any other third-party chatbot (see section 7).
- This document restates the routes, fields and headers found in the code and the guide. It records no run result. Where a result exists, it lives in the files named in section 9, with its own label.

## 2. Setup flow

1. Sign up with the AI Publisher account type and save your platform details on the Publisher page. The account starts as Waiting for approval.
2. Blisscco reviews the account by hand and sets it to Approved or Suspended. No review time is promised.
3. After approval, create a key on the Publisher page. Choose a name and an expiry. The key is shown once and only a one-way hash is stored.
4. Copy the key straight into your server's environment (section 4).
5. Set the API base URL on your server (section 3).
6. Request an ad, render it with the Sponsored label, then report the impression and link the click (section 5).

An account that is not approved (Waiting for approval or Suspended) makes all its keys fail with 401. Rotate keys by creating the new key first, deploying it, then revoking the old one. Revoking cannot be undone.

## 3. API base URL configuration

- The base URL is given to you by Blisscco. This repository publishes no host and no staging environment.
- Your server reads it from `BLISSCCO_API_BASE_URL`.
- Every example in the guide uses a placeholder host, `YOUR-BLISSCCO-API-HOST`. Replace it only on your own server.
- If either variable is missing, the examples run without ads and make no request.

```
BLISSCCO_API_BASE_URL=https://YOUR-BLISSCCO-API-HOST
BLISSCCO_PUBLISHER_API_KEY=paste-your-key-from-the-publisher-page
```

## 4. Server-side publisher key storage

- Keep the key only in `BLISSCCO_PUBLISHER_API_KEY` on your server, in a secret manager or environment file.
- Do not give either variable a public prefix such as `NEXT_PUBLIC_`, `VITE_` or `REACT_APP_`.
- Do not put the key in browser code, a mobile app, git, logs, tickets, screenshots or chat.
- Call the API server to server only. Your frontend talks to your own backend, which returns only the five public ad fields.
- Use a separate named key per server or environment, so one can be revoked alone.
- A lost key cannot be shown again. Create a new one and revoke the old one.
- If a key may have leaked, revoke it first, then create a replacement.
- There is no public key, site key or publisher id in this API. The key is a private password.

## 5. Current routes

Only these three routes exist for publishers.

| Route | Credential | Required | Result |
|---|---|---|---|
| POST /api/v1/ads/match | `Authorization: Bearer` with your key | `Content-Type: application/json`, body field `topic` | 200 with an ad or `{"fill":false}`. Errors: 400, 401, 413, 415, 429, 503 |
| POST /api/v1/ads/impression | None, the token is the permission | `Content-Type: application/json`, body fields `token` and `event` (the value `impression`) | 200 `recorded` or `duplicate`. Errors: 400, 401, 413, 415, 429, 503 |
| GET /api/v1/ads/click | None, the reference is the permission | Query parameter `ref`, exactly once | 302 redirect to the destination stored by Blisscco. Errors: 400, 404, 405, 429, 503 |

### Match request

- Body fields: `topic` (required) and, optionally, `fallback_topics` and `exclude_ad_ids`. Any other field is refused with 400. The body limit is 2048 bytes.
- A topic is a slug of 1 to 50 characters from a-z, 0-9 and underscore. `fallback_topics` holds at most 2 such slugs. `exclude_ad_ids` holds at most 20 ad ids.
- Optional headers: `Idempotency-Key` (8 to 64 letters, digits, underscore or hyphen) and `X-Blisscco-Tracking: 1`. A value in the wrong shape is refused with 400, not ignored.
- Send a new random `Idempotency-Key` per ad placement and reuse the same value only when you retry that placement.
- The only signal accepted is a topic slug chosen by your own code. Never send conversation text, user ids, emails or session ids.

### Match response

- Ad found: 200 with `fill: true`, `sponsored: true` and `ad` holding the five public fields. The response carries `X-Blisscco-Api-Version: 1` and `Cache-Control: no-store`.
- No ad: 200 with `{"fill":false}`. This is normal and never carries a reason. Sensitive and unsupported topics also end this way.
- Temporary failure: 503 with `fill: false` and `error: unavailable`. This is different from a no-fill, which is a 200.
- A `tracking` object (`token`, `expires_at`, `events`, and `click_ref` when one could be signed) appears only if you sent `X-Blisscco-Tracking: 1` and tracking is switched on at Blisscco. A missing `tracking` object is normal: show the ad and report nothing.
- A retry with the same `Idempotency-Key` returns the original ad. After `expires_at` it returns that ad without `tracking`.

### Impression and click

- The impression token and click reference come only from a match response that opted in to tracking. Report an impression only after the ad was really displayed. Send it from your server, because the endpoint has no CORS.
- Build the click link from the returned click reference, never from `destination_url`.
- A rejected token (impression, 401) or reference (click, 404) never says why. Drop it and do not retry.

### Retries

- Do not retry 400, 401, 404, 405, 413 or 415. They fail the same way again.
- After a 429, stop sending until the `Retry-After` time has passed (60 seconds), then send once. Do not loop.
- After a 5xx or a network error, retry at most once or twice, after at least one second, with the same `Idempotency-Key`.

## 6. Publisher checklist

All boxes start empty. Nothing here is confirmed by this document.

### Sponsored-ad disclosure

- [ ] Every ad shows the visible word Sponsored as plain text next to the headline.
- [ ] The label is not hidden, shrunk, renamed, or shown by colour or an icon alone.
- [ ] The ad sits in its own box after the assistant's answer.
- [ ] The ad never reads as the chatbot's own words or advice, and the chatbot does not rephrase it.
- [ ] Your own terms or privacy notice say that sponsored placements are shown, and that a click opens a Blisscco link that redirects to the advertiser.
- [ ] You do not request ads in sensitive or private conversations.

### Rendering the sponsored item

- [ ] Show only the five public fields: `id`, `headline`, `body`, `cta_text`, `destination_url`.
- [ ] Render text fields as plain text, never as HTML.
- [ ] The call-to-action links to the Blisscco click URL only. With no click reference, show the ad without a link.
- [ ] The impression is reported only after the labelled ad is on screen.
- [ ] Shown ad ids are remembered and sent in `exclude_ad_ids` to reduce repeats.

### Handling no-fill

- [ ] `{"fill":false}` is treated as normal, not as an error.
- [ ] No placeholder, apology or empty Sponsored box is shown.
- [ ] No re-request in a loop for the same turn. One request per placement.
- [ ] You do not try to find out why there was no fill. The reason is never disclosed.

### Keeping the chatbot response undisturbed

- [ ] The chatbot answer is sent first or in parallel. A late ad is dropped.
- [ ] Your own timeout is set, since Blisscco sets none for you. The guide example uses 2 seconds.
- [ ] Timeouts, 400, 401, 429, 503 and a missing key all end in no ad and never in an ad-related error for the person.
- [ ] After a 429, ad requests pause until `Retry-After` has passed.
- [ ] Logs hold no key, no conversation text and no topic tied to a person. Counting fills and no-fills is enough.

## 7. Limitations

These come from the existing guide.

- Blisscco has no integration with ChatGPT or any other third-party chatbot. No third-party integration has been tested.
- The examples are samples from this repository, not a published package. Their automated tests use a mocked Blisscco API.
- The guide says the API is not ready for production use.
- No staging environment is published, and the contract can still change.
- Accounts are approved by hand, and no review time is promised.
- Spend is counted when an ad is handed to you, not when a person sees it. A match request is the only charged event.
- Impressions and clicks are reporting counts. A tracking token does not prove an ad was shown or clicked.
- The click reference is optional. Without it there is no Blisscco click link, and a direct link to `destination_url` is not reported.
- The impression endpoint has no CORS, so impressions must come from your server.
- Ad fill and earnings are not promised.
- Rate limiting is per key, plus a best-effort guard against repeated wrong keys from one IP.
- Database calls time out after 8 seconds. A 503 means an outage, while a 200 no-fill means no matching ad.
- The optional Revive fallback is off by default and can only be switched on by Blisscco on its own server. It is not a publisher setting.
- This document does not approve a pilot and does not replace the guide.

## 8. Not changed

No route, handler, SQL, environment variable or workflow was changed. No `.sh` script was added, so `.github/workflows/ci.yml` is unchanged.

## 9. Evidence status of these claims

This section names where results are recorded. It does not repeat them and it claims none.

- Written contract: `app/dashboard/publisher/guide/page.tsx` and the three route handlers listed in section 5. The guide is checked against the real code by `tests/ads/publisher-guide.test.ts`. That check is a mocked automated test, not a Preview run.
- Wording of this file: `tests/publisher/day30-part3-onboarding-doc.test.ts` checks that it names only existing routes, headers and environment variable names. It does not check that the routes behave as written.
- Preview behaviour of match, no-fill, impression and click: recorded only in `DAY-C-PREVIEW-MANUAL-VERIFICATION-REPORT.md` and `MVP-VERIFICATION-RUNBOOK.md`, with the user's word as the source. Anything not listed there stays unverified.
- Any publisher integration outside this repository, any real Revive endpoint and any production use: unverified.

## 10. Controlled pilot rules for the publisher (Phase 3 Step 1)

These rules restate the existing contract for a pilot. They add no route, field, header or environment variable. The pilot is not a public launch, and this document does not approve it.

### Approval and access

- Blisscco approves the pilot publisher account by hand. No other publisher account is approved for the pilot.
- Approval does not start ad delivery by itself. The key is created by the publisher after approval, and campaigns are approved by an admin.
- Blisscco does not promise fill, earnings, a review time or a start date.
- Payouts are a manual record. Blisscco approves each payout request by hand, and Paid only records that money was sent outside the system.

### What the publisher sends and stores

- Only a topic slug chosen by your own code goes to Blisscco. Raw chatbot conversation text, user ids, emails, session ids and other personal data never go to Blisscco.
- The key lives only in your server's environment or secret manager. It stays out of browser code, git, logs, tickets, screenshots and chat.
- Your logs hold counts of fills and no-fills, and no conversation text or topic tied to a person.

### What to expect from ads

- Relevance: an ad is matched by an exact category slug or a fixed alias. There is no reading of the conversation and no profile of the person, so a match can still look loosely related to the answer. Sensitive and unsupported topics get no ad.
- No-fill: `{"fill":false}` is a normal answer and gives no reason. Show nothing and keep the chat unchanged. A 503 is an outage and is not a no-fill.
- Tracking limits: the tracking token and click reference come only from a match request that opted in, and only while tracking is switched on at Blisscco. They are reporting counts and do not prove an ad was shown or clicked. Spend is counted when an ad is handed to you, not when a person sees it.
- The API is not ready for production use, the contract can still change and no staging environment is published.

### Revoke-key procedure

1. If the key may have leaked, open the Publisher page and revoke that key first. Do not look for the cause first.
2. Check that your server now gets 401 for the revoked key. Your chat must keep working without ads.
3. Create a replacement key on the Publisher page, with a name and an expiry. It is shown once.
4. Put the new key in your server's environment and deploy.
5. Remove the old key from every place it was seen, and tell Blisscco the date and what happened. Never include the key value.
6. Revoking cannot be undone. To rotate without a leak, create the new key first, deploy it, then revoke the old one.

### Pilot publisher checklist

All boxes start empty. Nothing here is confirmed by this document.

- [ ] The account was approved by hand, and the publisher knows the pilot is limited and is not a public launch.
- [ ] The key is stored only on the server, and the publisher searched the built frontend and the network tab and found no key.
- [ ] The publisher stated in writing that only a topic slug is sent, and that no conversation text or personal data is sent.
- [ ] The publisher has read the sections of this file on relevance, no-fill and tracking limits.
- [ ] The publisher can state the revoke-key steps above without looking, and knows revoking comes first.
- [ ] The publisher knows that Blisscco may stop the pilot at any time, and what the stop conditions are (`MVP-PILOT-SAFETY-CHECKLIST.md`, section 10f).
- [ ] The publisher knows which fill and no-fill counts and which errors to report during the pilot, and how (`MVP-PILOT-SAFETY-CHECKLIST.md`, section 11).

## 11. Pilot observation records

The observation list, the places each item can be seen and the record format (date, environment, method, actual result, source) are in `MVP-PILOT-SAFETY-CHECKLIST.md`, section 11. The publisher's part is to report API errors, timeouts, fills, no-fills and integration errors with a date and a status code. A value that was not measured is reported as not measured. This document fills in no number.
