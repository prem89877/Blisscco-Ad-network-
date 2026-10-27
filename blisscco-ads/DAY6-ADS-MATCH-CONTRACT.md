# Day 6 (Prompt 4): `POST /api/v1/ads/match` ka final contract

Ye document request/response ka **final contract** hai. Types: `lib/ads/contract.ts`. Tests: `tests/ads/contract.test.ts`
(ye test is document ke har JSON example ko asli API jawab se milata hai, isliye doc aur code alag nahi ho sakte).

Behaviour **nahi badla** (koi verified bug nahi mila). Purana `POST /api/ads/match` bhi bilkul yahi contract follow karta hai
(farak sirf itna: v1 har jawab me `X-Blisscco-Api-Version: 1` jodta hai).

## 1. Request

    POST /api/v1/ads/match
    Authorization: Bearer YOUR_PUBLISHER_API_KEY
    Content-Type: application/json
    Idempotency-Key: <random 8-64 chars, optional but recommended>

```json
{
  "topic": "gaming",
  "exclude_ad_ids": []
}
```

| Field | Type | Zaruri? | Rule |
|---|---|---|---|
| `topic` | string | haan | lowercase slug `^[a-z0-9_]{1,50}$`. Supported: `developer_tools`, `education`, `finance`, `fitness`, `food`, `gaming`, `lifestyle`, `technology`, `travel` (aliases jaise `games`, `tech` chalte hain). Free text/prompt nahi. |
| `exclude_ad_ids` | string[] | nahi | max 20 UUID. Null/object/non-UUID = 400. Duplicate/uppercase theek (lowercase + dedupe hota hai). Best-effort: koi dusra ad ho toh woh milta hai; na ho toh wahi ad repeat ho sakta hai. |

Aur koi field allowed nahi. `prompt`, `messages`, `user_id`, `email`, `conversation`, `query`, ... kuch bhi = **400 `unknown_field`**
(chatbot ki baat-cheet ya user ki pehchaan hum tak aani hi nahi chahiye). Hum koi bhi text kisi external AI service ko nahi bhejte.

**Header `Idempotency-Key` (optional, Day 9):** 8 se 64 characters, sirf `A-Z a-z 0-9 _ -` (UUID chalta hai). Har ad placement ke liye naya random value;
retry (timeout / 5xx) me wahi value. Wahi key dobara => wahi ad, dobara charge nahi (48 ghante yaad). Galat shape => `400 invalid_idempotency_key`
(chup-chaap ignore nahi hota). Value me user id, email ya conversation text kabhi mat daalo. Header na ho toh retry dobara ginti ho sakti hai.

Limits: body max **2048 bytes** (characters nahi, bytes). `Content-Type` sirf `application/json` (optional `; charset=utf-8`).
Key publisher ke **server** se bhejo, browser se nahi (CORS jaan-boojh kar band hai).

## 2. Response

Har jawab JSON hai, `Cache-Control: no-store`, aur v1 par `X-Blisscco-Api-Version: 1`.

| Status | Matlab | Body |
|---|---|---|
| 200 | ad mila | `fill: true`, `sponsored: true`, `ad{...}` |
| 200 | no-fill | `{"fill":false}` |
| 400 | body galat | `{"error":"invalid_request","reason":...}` |
| 401 | key missing/galat/revoked | `{"error":"unauthorized"}` + `WWW-Authenticate` |
| 413 | body > 2048 bytes | `{"error":"payload_too_large"}` |
| 415 | content-type galat | `{"error":"unsupported_media_type"}` |
| 429 | rate limit | `{"error":"rate_limited"}` + `Retry-After: 60` |
| 503 | temporary service dikkat | `{"fill":false,"error":"unavailable"}` |

`reason` (400): `invalid_json`, `invalid_body` (object nahi), `unknown_field`, `invalid_topic`, `invalid_exclude_ad_ids`, `unreadable_body`, `invalid_idempotency_key`.

**401 ke kaaran (sab ek jaisa jawab, andaaza nahi lagta):** key missing / `Bearer <key>` format galat / key ka format galat (`blc_live_` + 64 lowercase hex nahi; database tak jaata hi nahi) /
key unknown / key revoked / key expired / publisher `pending` ya `suspended` / publisher ka profile suspended.

**429 ke do kaaran (ek jaisa body):** (1) is key ka per-minute limit (default 60, `ad_platform_settings.rate_limit_per_minute`; fixed 1-minute window, isliye minute ki seema par kuch der
~2x tak ja sakta hai), (2) ek IP se ek minute me ~20 galat keys (best-effort, har server instance ka apna). `Retry-After` hamesha `60`.
400 / 413 / 415 / 401(galat format) key ke quota me nahi ginte (wo key check se pehle hi lautte hain).

**Sponsored indicator:** har ad response me top-level `"sponsored": true` hota hai (type level par bhi literal `true`).
Publisher ko ad ke paas "Sponsored" label dikhana **zaruri** hai.

**Ad ke public fields (sirf yahi 5):** `id`, `headline`, `body`, `cta_text` (null ho sakta hai), `destination_url`.
Advertiser ka naam/email, campaign, budget, spend, publisher id, API key/hash, ya database error kabhi nahi aata.

**No-fill** ki wajah nahi batayi jaati: unsupported topic, sensitive topic (health, religion, politics, ...), koi eligible ad nahi, ya
serve record na ho paya: sab me ek jaisa `{"fill":false}`. Publisher no-fill par bas koi ad na dikhaye.

**503** par bhi `fill:false` hai: publisher ise "abhi ad nahi" maane aur baad me dobara try kare. Andar ki koi detail nahi aati.

## 3. Example jawab

### Successful match (200)

```json
{
  "fill": true,
  "sponsored": true,
  "ad": {
    "id": "3f2b8c1e-5a47-4d9e-9b62-7c1d8e4a6f10",
    "headline": "Level up your game nights",
    "body": "Compare gaming laptops built for long sessions.",
    "cta_text": "Shop now",
    "destination_url": "https://example.com/gaming-laptops"
  }
}
```

### No-fill (200)

```json
{
  "fill": false
}
```

### Invalid request (400)

Request me `"prompt": "hello"` jaisa extra field tha:

```json
{
  "error": "invalid_request",
  "reason": "unknown_field"
}
```

### Unauthorized publisher (401)

Header: `WWW-Authenticate: Bearer realm="blisscco-ads"`

```json
{
  "error": "unauthorized"
}
```

### Rate limit (429)

Header: `Retry-After: 60`

```json
{
  "error": "rate_limited"
}
```

### Temporary service failure (503)

```json
{
  "fill": false,
  "error": "unavailable"
}
```

### Payload too large (413)

```json
{
  "error": "payload_too_large"
}
```

### Unsupported media type (415)

```json
{
  "error": "unsupported_media_type"
}
```

## 3b. Contextual signal (privacy)

Request me **sirf** `topic` (ek coarse category slug) contextual signal hai. Publisher ka server use apni fixed list se chunta hai (jaise product area -> `developer_tools`);
user ka message / prompt / summary / keywords kabhi nahi. Koi user id, email, IP, device / session / conversation id, location accept nahi (400 `unknown_field`).
Topic ka format `^[a-z0-9_]{1,50}$` hai: `Gaming`, `video games`, `a-b` jaise input 400 `invalid_topic` dete hain. Format theek par unsupported (ya 3 se zyada shabd wala) ya sensitive topic
(health, religion, politics, ...) **error nahi**, normal no-fill `{"fill":false}` hai. Matching exact slug / alias par hoti hai, substring par nahi. Koi external AI service nahi bulai jaati.
Database me topic sirf canonical category ke roop me, serve ke saath ginti ke liye likha jaata hai, kisi insaan se jodkar nahi.

## 4. Curl

    curl -i -X POST https://YOUR-SITE.vercel.app/api/v1/ads/match \
      -H "Authorization: Bearer YOUR_PUBLISHER_API_KEY" \
      -H "Content-Type: application/json" \
      -H "Idempotency-Key: 7b0e3c1a-1c2d-4e5f-8a9b-0c1d2e3f4a5b" \
      -d '{"topic":"gaming"}'

## 5. Kya badla / kya nahi

Naye: `lib/ads/contract.ts` (public types + `toPublicAd`/`buildAdResponse`), `tests/ads/contract.test.ts`, `DAY6-ADS-MATCH-CONTRACT.md`.
Badla: `lib/ads/match-handler.ts` (responses ab contract types se bandhe; ad response `buildAdResponse` se banta hai. JSON bytes pehle jaise hi).
Nahi badla: validation, taxonomy, matching, selection, SQL, routes, status codes, headers.
Known gaps (`DAY6-API-V1.md` section 6): Day 7 me budget enforce, timeouts aur 503-on-load-failure theek hue. Edge/IP rate limit ke liye Vercel Firewall rule abhi bhi lagana hai (`DAY7-FIXES.md`).

## 6. Authentication, keys aur private vs public (Day 10 Part 4)

- **Ek hi credential hai: private API key.** Format `blc_live_` + 64 lowercase hex (32 random bytes, `crypto.randomBytes`). Sirf `Authorization: Bearer ...` header me. Body, query string ya cookie me nahi.
- **Koi public / site key ya publisher id nahi hai** (na is API me, na ads ke jawab me). Browser JavaScript me rakhne layak sirf wahi 5 ad fields hain jo dikhane ke liye hain. CORS jaan-boojh kar band hai.
- Dashboard par dikhne wale **key name, shuruaat ke 13 akshar (`blc_live_` + 4 hex) aur aakhri 4 hex sirf pehchaan hain**: inse API call nahi ho sakti. Poori key sirf banate waqt ek baar dikhti hai.
- Storage: database me sirf SHA-256 hash (+ prefix, last 4). Plain key kahin store / log nahi hoti, isliye kho gayi key wapas nahi aati.
- Server env variable (publisher ke apne server par): `BLISSCCO_PUBLISHER_API_KEY` aur `BLISSCCO_API_BASE_URL` (guide ke examples ke naam; Blisscco ke apne server ka alag `SUPABASE_SECRET_KEY` hai, wo publisher ko kabhi nahi milta). Koi `NEXT_PUBLIC_` / `VITE_` / `REACT_APP_` prefix nahi.

### Approval

1. Publisher sign-up (email) -> platform details save -> status `pending` ("Waiting for approval").
2. Admin (dashboard Admin page) status `active` ya `suspended` karta hai. Koi alag "rejected" state nahi hai.
3. `active` ke baad hi key ban sakti hai. `pending` / `suspended` publisher ki har key 401 deti hai. Reinstate hone par bachi hui (revoke / expire na hui) keys dobara chalti hain.

### Key lifecycle

| Kaam | Kahan | Niyam |
|---|---|---|
| Create | Publisher page | Sirf `active` publisher. Naam optional (max 60), expiry 30 / 90 (default) / 365 din ya never. Max 5 active keys. Roz ki creation limit `day-10-2-key-limits.sql` chalne ke baad (24 ghante me 20) lagti hai. |
| Rotate | Publisher page (Rotate) | Nayi key, wahi naam. **Purani chalti rehti hai** jab tak revoke na karo (zero downtime). Rotate bhi 5-key limit me ginta hai. |
| Revoke | Publisher page (Revoke + confirm) | Turant asar: agli request 401. Wapas nahi hota. Suspended publisher bhi revoke kar sakta hai. |
| Expire | apne aap | `expires_at` ke baad 401, dashboard par "Expired". |

Rotation ka kram: Rotate -> nayi key server ke secret manager me -> deploy -> `Last used` check -> purani Revoke.

### Server-side examples

Publisher guide (`/dashboard/publisher/guide`) me do examples hain: TypeScript (`getSponsoredAd`: timeout, ek retry same Idempotency-Key ke saath, 429 par pause) aur JavaScript (Node 18+, apne frontend ke liye proxy; browser ko sirf 5 ad fields milti hain).
Dono `tests/ads/publisher-examples.test.ts` me asli handler ke against chalaye jaate hain.
