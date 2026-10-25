# Day 6 (Part 2): POST /api/v1/ads/match

Versioned public ad endpoint. Purana `POST /api/ads/match` **chalta rahega, behaviour wahi**. Dono ek hi handler chalate hain
(`lib/ads/match-handler.ts`), isliye matching/auth/validation ka logic kahin duplicate nahi hai.

## 1. Kya chala aur kya NAHI (sach-sach)

Is sandbox me chala (asli result):
- Compile (`tsc -p tsconfig.test.json`) + `node --test`: **444 tests, 444 pass, 0 fail** (pehle 418; 26 naye `tests/ads/v1-route.test.ts` ke).
- Parity: 12 scenarios (ad, alias, sensitive topic, no candidate, no key, unknown key, 429, 415, 400 x2, 413, 503) me legacy aur v1 ka
  status, body, `Cache-Control`, `WWW-Authenticate`, `Retry-After` aur database calls ka order **same**. v1 me sirf `X-Blisscco-Api-Version: 1` extra.
- Mutation check: content-type ko dheela karne par 2, body limit +1 karne par 1, v1 ka version header hatane par 13 tests fail hue; wapas karne par 0 fail.

NAHI chala:
- `npm install`, `npm run lint` (poore project par `tsc`), `next build`, Vercel deploy, asli API call asli key ke saath.
  Sandbox me `@types/node` install nahi hai, isliye compile me sirf wahi ek error (TS2688) aata hai; baaki code par type error nahi aaya.
- Koi SQL nahi badla, isliye SQL ke liye kuch naya chalane ki zarurat nahi.

## 2. Endpoint

    POST /api/v1/ads/match
    Authorization: Bearer blc_live_...
    Content-Type: application/json
    { "topic": "gaming", "exclude_ad_ids": ["<pichhle dikhaye ad ids, optional>"] }

Jawab (body purane endpoint jaisi, har jawab me header `X-Blisscco-Api-Version: 1` aur `Cache-Control: no-store`):

| Status | Body | Matlab |
|---|---|---|
| 200 | `{"fill":true,"sponsored":true,"ad":{"id","headline","body","cta_text","destination_url"}}` | ad mila |
| 200 | `{"fill":false}` | no-fill (topic unsupported/sensitive, ya koi eligible ad nahi; wajah nahi batate) |
| 400 | `{"error":"invalid_request","reason":"..."}` | body galat |
| 401 | `{"error":"unauthorized"}` + `WWW-Authenticate` | key missing/galat/revoked |
| 413 | `{"error":"payload_too_large"}` | body > 2048 bytes |
| 415 | `{"error":"unsupported_media_type"}` | content-type `application/json` nahi |
| 429 | `{"error":"rate_limited"}` + `Retry-After: 60` | per-key limit |
| 503 | `{"fill":false,"error":"unavailable"}` | server/database dikkat (publisher ise "no ad" maane) |

Curl:

    curl -i -X POST https://YOUR-SITE.vercel.app/api/v1/ads/match \
      -H "Authorization: Bearer blc_live_YOUR_KEY" \
      -H "Content-Type: application/json" \
      -d '{"topic":"gaming"}'

Ye call publisher ke **server** se karo. Browser se nahi (key leak hogi); CORS jaan-boojh kar band hai.

## 3. Supported topics

`developer_tools`, `education`, `finance`, `fitness`, `food`, `gaming`, `lifestyle`, `technology`, `travel`.
Aliases (jaise `games`, `video_games`, `tech`, `coding_tools`) chalte hain. Sensitive topics (health, religion, politics, ...) hamesha no-fill.

`topic` **lowercase slug** hona chahiye (`^[a-z0-9_]{1,50}$`). `Gaming` ya `video games` (space) 400 `invalid_topic` dete hain.
Ye jaan-boojh kar hai (tests isi par tike hain); normalizer ki space/hyphen/uppercase chhoot sirf andar ki hai.

## 4. Kya badla

Naye: `lib/ads/match-handler.ts`, `app/api/v1/ads/match/route.ts`, `tests/ads/v1-route.test.ts`, `DAY6-API-V1.md`.
Badle: `app/api/ads/match/route.ts` (ab patla wrapper), `tsconfig.test.json` (v1 route compile list me), `tests/ads/final-review.test.ts`
(no-CORS check v1 aur handler par bhi), `lib/ads/service.ts` (sirf comment: tootta hua `DAY6-SERVE-AND-SPEND-PLAN.md` reference hataya).

**Ek behaviour change (tumhari haan se):** content-type ab strict hai. Sirf `application/json` (optional `; charset=utf-8`).
`application/jsonp`, `application/json-patch+json` jaise look-alike ab 415 dete hain. Ye **dono** endpoints par lagu hai.
Normal clients (`application/json`, `application/json; charset=utf-8`) par koi farak nahi.

Legacy par koi `Deprecation`/`Link` header nahi jodi (tumhari haan se). Jab migrate karwana ho tab alag se.

## 5. Deploy

1. Zip ki files same paths par daalo. SQL ka kuch nahi.
2. `npm install`, `npm test` (`# fail 0`), `npm run lint` (0 errors), `npm run build`. Ye teeno mere paas nahi chale: tumhe chalane hain.
3. Deploy ke baad:
   - `POST /api/v1/ads/match` bina key -> 401 (header `x-blisscco-api-version: 1`).
   - Sahi key + `{"topic":"technology"}` -> 200 ad ya `{"fill":false}`.
   - `{"topic":"x","prompt":"hi"}` -> 400. 3 KB body -> 413. `Content-Type: text/plain` -> 415. GET -> 405.
   - Purana `POST /api/ads/match` ab bhi wahi jawab de (bina version header ke).
4. **Vercel Firewall rule dono paths par**: `/api/ads/match` aur `/api/v1/ads/match` (IP par rate limit). Ye dashboard ka kaam hai, code me nahi.

## 6. Known gaps (abhi bhi baaki)

1. **(Day 7: THEEK HUA)** Budget ab enforce hota hai (`day-7-1` SQL: `record_ad_serve` campaign lock karke total/daily budget jaanchta hai). Charge abhi "serve" par lagta hai; impression/click tracking alag kaam hai.
   Is endpoint se "serve" ginti hoti hai, impression/click nahi: billing mat karo.
2. **Edge/IP rate limit** abhi nahi: limit key ke baad lagti hai, sahi-format galat keys har baar database tak jaati hain (upar step 4).
3. **(Day 7: THEEK HUA)** Routes par `maxDuration = 15` aur database calls par 8 second ka time-out.
4. **(Day 7: THEEK HUA)** Candidate load fail hone par ab 503 `{"fill":false,"error":"unavailable"}` aata hai. 200 `{"fill":false}` ka matlab sirf "koi ad nahi".
5. Select aur record ke beech race, `ad_serve_log`/`api_rate_limits` ka retention job, publisher key self-service UI, creative review UI: Day 5 review ki list jaisa.
6. Purana `match_contextual_ad` + `lib/ads/match.ts` ab bhi code me hain (route se use nahi hote). v1 unse nahi judta.

> **OWNER NOTE:** Deployment se pehle impressions aur clicks ki ginti (tracking) aur baaki related cheezein (etc.) ka kaam/review kiya jayega.
