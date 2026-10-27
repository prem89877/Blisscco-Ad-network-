# Day 10 | Part 3: publisher ad request (API, auth, selection, errors)

Koi SQL nahi chalayi, aur is part ke liye koi migration nahi banani padi.

## Asli raasta (jaanch ke baad confirm)

`POST /api/v1/ads/match` (naya) aur `POST /api/ads/match` (purana) -> dono ek hi `lib/ads/match-handler.ts` chalate hain, isliye body / status / headers same (sirf v1 par `X-Blisscco-Api-Version: 1`). Contract: `lib/ads/contract.ts`, `DAY6-ADS-MATCH-CONTRACT.md`. Guide: `/dashboard/publisher/guide`.

Handler ke kadam: IP guard (galat keys ki bheed) -> key ka format (galat = 401, database tak nahi) -> Content-Type (415) -> size 2048 bytes (413) -> body schema (400) -> `Idempotency-Key` header (400 agar galat) -> `authorize_publisher_key` (key hash, active key + publisher + profile, per-key rate limit) -> category (`resolveCategory`: alias / sensitive / unsupported = no-fill) -> candidates + eligibility + selection -> `record_ad_serve` (database creative dobara verify karke serve likhta hai) -> sirf 5 public fields. Kuch bhi anjaana toote toh saaf JSON 503.

## Jaanch ka nateeja

Request ka schema (sirf `topic` + optional `exclude_ad_ids`), key verification, no-fill, rate limit, error safety aur dono URLs ka parity **pehle se sahi nikla**: koi code bug nahi mila, isliye API code nahi badla (contract bacha rahe). 40 se zyada edge cases asli handler par chalaye (galat JSON, BOM, array body, topic number / uppercase / unicode / 51 chars, duplicate topic key, `__proto__`, 21 exclude ids, galat Content-Type charset, chhoti Idempotency-Key, lowercase Bearer, text/plain, 3 KB body...): sab ne contract ke hisaab se jawab diya.

## Jo mila aur fix kiya

| # | Gap | Fix |
|---|---|---|
| 1 | Guide ne likha tha "har response JSON + no-store", jabki GET / PUT ka 405 hosting platform ka khali jawab hai. | Guide me wording sahi: 405 ka body `(empty)`, aur ye ek apvaad likha. Route ka behaviour jaan-boojh kar nahi badla (purana test aur contract "sirf POST export" tay karte hain). |
| 2 | Guide me nahi tha ki `Idempotency-Key` me user id / email / conversation text mat daalo. | Guide me saaf likha: value random honi chahiye (privacy). |
| 3 | Guide me key rotation ka zikr nahi tha (Part 2 me aaya). | Section 2 me "Rotate" ka tareeka. |
| 4 | Guide aur code ke beech drift ka koi test nahi tha. | Naye tests: guide ke supported topics = `ACTIVE_CATEGORIES`, har status (400/401/405/413/415/429/503) aur `Retry-After: 60` guide me. |
| 5 | **Meri Part 2 doc me env variable ka naam galat tha** (`SUPABASE_SERVICE_ROLE_KEY`). | Asli naam `SUPABASE_SECRET_KEY` hai (`lib/supabase/admin.ts`). `DAY10-PART2-API-KEYS.md` theek kar di. Code par asar nahi: sirf doc ki galti thi. |

## Asli sample responses (v1 route, nakli database, 6 jawab)

Headers sab me: `Cache-Control: no-store`, `Vary: Authorization`, `X-Blisscco-Api-Version: 1` (purane URL par ye ek header nahi).

```
200 success
{"fill":true,"sponsored":true,"ad":{"id":"3f2b8c1e-5a47-4d9e-9b62-7c1d8e4a6f10","headline":"Level up your game nights","body":"Compare gaming laptops built for long sessions.","cta_text":"Shop now","destination_url":"https://example.com/gaming-laptops"}}

200 no-fill (sensitive / unsupported topic, koi eligible ad nahi, ya record me reject)
{"fill":false}

400 {"error":"invalid_request","reason":"unknown_field"}
401 {"error":"unauthorized"}              (+ WWW-Authenticate: Bearer realm="blisscco-ads")
429 {"error":"rate_limited"}              (+ Retry-After: 60)
503 {"fill":false,"error":"unavailable"}
```

## Tests (actual result)

Compile + `npm test` (offline, nakli Supabase): **1409 pass, 0 fail** (Part 2 ke baad 1386; 23 naye, `tests/ads/day10-part3-api.test.ts`): dono URLs par success / no-fill / 400 / 401 / 413 / 415 / 429 / 503, privacy (11 field naam jaise messages, prompt, email, user_id: sab 400, database ko koi call nahi, jawab me wo text wapas nahi), galat-key ki bheed ke baad 429, logs me key / database message nahi, dono URLs ka same body, guide drift.

**Nahi chala:** `next build`, `npm run lint`, asli Supabase par live request, Vercel par deploy, integration tests (`test:integration`). `node_modules` nahi the, type-check aanshik. Apne project me `npm run lint` aur `npm run build` chalao.

## Baaki configuration / limitations (environment)

- Live check (deploy ke baad, test key se): `curl` se success ya `{"fill":false}`, `{"topic":"health"}` -> no-fill, key ka aakhri akshar badalke -> 401, extra field -> 400. Guide section 9 me poori list hai.
- IP guard memory me hai (har server instance ka apna) aur `x-forwarded-for` par chalta hai: Vercel me theek, par poori suraksha ke liye Vercel Firewall rate-limit rule bhi lagao (`DAY7-FIXES.md`).
- `lib/ads/match.ts` (purana single-call bridge, `match_contextual_ad`) ab koi route use nahi karta aur wo database function band hai: dead code hai, nuksan nahi, isliye chhoda.
- Rate limit ka window fixed 1 minute hai aur `Retry-After` hamesha 60 (documented); isko badalna contract badalna hoga.
- Impression / click tracking abhi nahi: "serve" hi ginti ka aadhar hai, billing ke liye nahi (service.ts ke note jaisa).
