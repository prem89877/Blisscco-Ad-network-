# Blisscco Publisher Pilot Onboarding (Day 30 Part 3)

This is documentation only. It restates the existing publisher guide (`app/dashboard/publisher/guide/page.tsx`) and the example integrations (`examples/publisher-node`, `examples/publisher-nextjs`). No code, route or contract was changed, and nothing was run to write it. No deployment, Production database or live endpoint was touched.

## 1. Status

- Access is limited and accounts are approved by hand.
- The guide marks the API as not ready for production use. Do not roll it out to real users yet.
- Blisscco has no integration with ChatGPT or any other third-party chatbot (see section 7).

## 2. Setup flow

1. Sign up with the AI Publisher account type and save your platform details on the Publisher page. The account starts as Waiting for approval.
2. Blisscco reviews the account by hand and sets it to Approved or Suspended. No review time is promised.
3. After approval, create a key on the Publisher page. Choose a name and an expiry. The key is shown once and only a one-way hash is stored.
4. Copy the key straight into your server's environment (section 4).
5. Set the API base URL on your server (section 3).
6. Request an ad, render it with the Sponsored label, then report the impression and link the click (section 5).

A Suspended account makes all its keys fail with 401. Rotate keys by creating the new key first, deploying it, then revoking the old one. Revoking cannot be undone.

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
| POST /api/v1/ads/impression | None, the token is the permission | `Content-Type: application/json`, body fields `token` and `event` (the value `impression`) | `recorded` or `duplicate` |
| GET /api/v1/ads/click | None, the reference is the permission | Query parameter `ref`, exactly once | 302 redirect to the destination stored by Blisscco |

- Optional on match: the `Idempotency-Key` header, the `X-Blisscco-Tracking: 1` header, and the body fields `fallback_topics` and `exclude_ad_ids`.
- Send a new random `Idempotency-Key` per ad placement and reuse the same value only when you retry that placement.
- The only signal accepted is a topic slug chosen by your own code. Never send conversation text, user ids, emails or session ids.
- The impression token and click reference come only from a match response that opted in to tracking. Report an impression only after the ad was really displayed. Send it from your server, because the endpoint has no CORS.
- Build the click link from the returned click reference, never from `destination_url`.
- Retry only 429 and 5xx, with a pause of at least one second and the same `Idempotency-Key`.

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
