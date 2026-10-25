# Day 6 (Prompt 4): `POST /api/v1/ads/match` ka final contract

Ye document request/response ka **final contract** hai. Types: `lib/ads/contract.ts`. Tests: `tests/ads/contract.test.ts`
(ye test is document ke har JSON example ko asli API jawab se milata hai, isliye doc aur code alag nahi ho sakte).

Behaviour **nahi badla** (koi verified bug nahi mila). Purana `POST /api/ads/match` bhi bilkul yahi contract follow karta hai
(farak sirf itna: v1 har jawab me `X-Blisscco-Api-Version: 1` jodta hai).

## 1. Request

    POST /api/v1/ads/match
    Authorization: Bearer YOUR_PUBLISHER_API_KEY
    Content-Type: application/json

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

`reason` (400): `invalid_json`, `invalid_body` (object nahi), `unknown_field`, `invalid_topic`, `invalid_exclude_ad_ids`, `unreadable_body`.

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

## 4. Curl

    curl -i -X POST https://YOUR-SITE.vercel.app/api/v1/ads/match \
      -H "Authorization: Bearer YOUR_PUBLISHER_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{"topic":"gaming"}'

## 5. Kya badla / kya nahi

Naye: `lib/ads/contract.ts` (public types + `toPublicAd`/`buildAdResponse`), `tests/ads/contract.test.ts`, `DAY6-ADS-MATCH-CONTRACT.md`.
Badla: `lib/ads/match-handler.ts` (responses ab contract types se bandhe; ad response `buildAdResponse` se banta hai. JSON bytes pehle jaise hi).
Nahi badla: validation, taxonomy, matching, selection, SQL, routes, status codes, headers.
Known gaps (`DAY6-API-V1.md` section 6): Day 7 me budget enforce, timeouts aur 503-on-load-failure theek hue. Edge/IP rate limit ke liye Vercel Firewall rule abhi bhi lagana hai (`DAY7-FIXES.md`).
