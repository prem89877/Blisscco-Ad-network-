# Day 12 Part 3 : serve reference + tracking token

**Status:** code + tests tayyar. **SQL (day-12-5) kisi database par chalayi NAHI gayi** (na denim test, na asli). Approval ke baad hi.

## Kya bana
- `serve_ref` (day-12-1) ab `record_ad_serve` se wapas aata hai, aur Idempotency-Key retry usi serve row se juda hota hai (`day-12-5`).
- `lib/ads/tracking-token.ts`: HMAC-SHA256 signed, time-limited token `bt1.<payload>.<sig>`.
  Payload: opaque serve_ref, publisher ka one-way tag, events `["impression","click"]`, iat/exp. Publisher id, campaign, creative, sequential id, spend: kuch nahi.
- Opt-in: request header `X-Blisscco-Tracking: 1`. Header na ho => response bilkul pehle jaisa (`fill`, `sponsored`, `ad`{5 fields}).
- Opt-in par kamyab serve me extra key: `tracking: { token, expires_at, events }`.

## Response contract
```json
{ "fill": true, "sponsored": true, "ad": { "...5 fields..." },
  "tracking": { "token": "bt1....", "expires_at": "ISO-UTC", "events": ["impression","click"] } }
```
- Header ho par `1` na ho => `400 invalid_request` + `reason: invalid_tracking_header` (kuch serve/charge nahi).
- `tracking` NAHI aata jab: opt-in nahi, no-fill, 401, 429, 400, 503, DB reject, secret set nahi, serve ka token-lifetime nikal chuka (late retry), ya serve day-12-5 se pehle ki hai.

## Security
- Secret: `AD_TRACKING_SECRET` (server env, min 32 chars, `NEXT_PUBLIC_` nahi). Placeholder / `sb_secret_` / `blc_live_` / JWT-jaisa value reject. Set nahi => tracking band, ad pehle jaisa.
- Rotation: `AD_TRACKING_SECRET_PREVIOUS`. TTL: `AD_TRACKING_TTL_SECONDS` (60..86400, default 3600).
- Expiry **serve ke samay** se bandhi hai (retry se nahi badhti). Same serve => byte-identical token.
- Verify: canonical base64url, signature pehle (constant-time), strict payload, expiry, event-type scope.

## Jo NAHI hua (jaan-boojh kar)
- Koi impression/click endpoint, event writer ya beacon nahi. Token = sirf "is serve ke events report karne ki ijazat", **impression/click ka saboot nahi**.
- `verifyTrackedEvent` (token + serve row ka milan, lookup inject hota hai) tayyar hai, par production lookup SQL + event writer agle part me.
- Spend / billing / budget logic nahi badla (day-12-5 me 3-arg `record_ad_serve` ki sirf serve_ref wali lines badli; test line-by-line pakadta hai).

## SQL order (approval ke baad)
1. `day-12-5-serve-ref-return.sql` (pehle denim test, phir asli). Prerequisite: day-12-1, 12-2 (already chali honi chahiye), 9-5, 9-7.
2. `day-12-6-serve-ref-return-verify.sql` (read-only; sab PASS).
3. `day-12-3-event-verify.sql` dobara (ek check update hua).
Code day-12-5 se PEHLE deploy karna bhi safe hai: serve_ref na mile to bas `tracking` nahi aata.
Rollback: day-9-5 / day-7-1 / day-9-7 wale purane function versions dobara chalao (`serve_id` column khali rehne me koi nuksan nahi).
