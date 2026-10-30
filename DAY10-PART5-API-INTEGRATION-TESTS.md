# Day 10 | Part 5: publisher ad API integration tests

Koi SQL nahi chalayi. Koi production credential / traffic nahi. API code (lib/, app/) me **koi badlav nahi**: tests me koi product bug nahi mila.

## Nayi files (3 test + 1 doc)

| File | Kaam |
|---|---|
| `tests/ads/fake-ad-db.ts` | Stateful nakli database: authorize / load candidates / record (3 aur 4 args) / find_idempotent_serve ke SQL rules Node me (day-7-5, day-9-5, day-5-6 padhkar) |
| `tests/ads/day10-part5-integration.test.ts` | 171 tests, dono URLs par (`/api/ads/match`, `/api/v1/ads/match`) |
| `tests/integration/day10-part5-db.test.ts` | Asli Postgres par SQL test (sirf TEST database, warna SKIP) |
| `DAY10-PART5-API-INTEGRATION-TESTS.md` | Ye report |

## Kya cover hua (har route par)

- Valid key: ad + exactly 5 public fields, serve sahi publisher ke naam, sirf key ka SHA-256 database tak
- Invalid / revoked / expired / malformed key: sab ka ek jaisa 401 (koi oracle nahi), revoke turant lagu, doosri key par asar nahi
- Pending / suspended publisher aur suspended profile: 401, kuch record / charge nahi, status badalte hi agli request par asar, Idempotency replay se bypass nahi
- Malformed: 27 case (JSON, topic, extra field, exclude ids, size, Content-Type, jhooti Content-Length, chunked body, galat Idempotency-Key, privacy fields): 400/413/415, database ko 0 call
- Eligible ads: 15 tarah ke ineligible ad (creative / campaign / advertiser / profile status, dates, budget, category) -> `{fill:false}`; exclude list; total + daily budget
- No-fill: sensitive / unsupported / inactive topic, kabhi ads query nahi
- Rate limit: exact limit, `Retry-After: 60`, naya minute, per-key, galat keys quota nahi khaate, dono URLs ka quota shared
- Repeated: same Idempotency-Key = ek hi charge (5 concurrent bhi), budget khatam / creative pause ke baad retry, 100 sequential requests
- Outage: har rpc fail -> 503, charge nahi, andar ki detail response / log me nahi, recovery
- Isolation: serve log har publisher ke naam, doosre ki retry key replay nahi hoti, A suspend / revoke / rate-limit ka B par asar nahi, publisher_id body / header se nahi chalta
- Schema: har response `assertContract` se guzarta hai (status, headers, exact JSON keys, UUID / https, leak scan: publisher id, key, hash, campaign / budget fields)
- Dono versions: same sequence = same body, v1 par `X-Blisscco-Api-Version: 1` har status (200/400/401/413/415/429/503) par, legacy par kabhi nahi

## Test quality check (mutation)

Code me jaanbujhkar bug daalke dekha ki tests pakadte hain: replay lookup hatana, rate_limited ko no-fill banana, response me extra field, Vary header hatana, Content-Type / size check hatana, record "rejected" ignore, pending publisher ko 200, galat Retry-After. Do mutations (exclude list ignore, replay ke waqt key revoke) pehle bach gaye the; tests kamzor the, to unhe majboot kiya (decisive exclude check + 2 naye "key revoked mid-request" tests). Ab sab pakde jaate hain. Koi test kamzor / delete nahi kiya.

## Result (actual)

- `npm test` jaisa chalaya (tsc compile + `node --test`): **1611 pass, 0 fail** (pehle 1440; 171 naye)
- Naye file ke type errors: 0

## Findings

1. Database me publisher status sirf `pending | active | suspended` hai. "Rejected" ka alag status nahi (admin ka "no" = suspended). Tests ne "rejected" ko suspended maana.
2. Product bug: koi nahi mila, isliye autonomous fix ki zaroorat nahi padi.

## Nahi chala / limitations

- `tests/integration/day10-part5-db.test.ts`: **SKIP** (TEST database ka URL / ref is session me nahi tha, sandbox me network aur Postgres nahi). Asli SQL (status / revoke / expiry / rate limit / retry-key isolation) abhi verify nahi hua. Chalane ke liye: GitHub Actions > "DB integration" (TEST secrets ke saath) ya `npm run test:integration` TEST env ke saath.
- Nakli database SQL ka MODEL hai, SQL nahi: SQL badle toh `fake-ad-db.ts` bhi badalna hoga.
- Is session me Supabase / GitHub connector tools available nahi the, isliye SQL aur GitHub Actions par `npm test` nahi chala. Tests sandbox me chale; `node_modules` nahi the (npm install ke liye network band), to `next build` / `npm run lint` nahi chale aur type-check aanshik tha (sirf missing-module errors, naye code me 0).
- Concurrency sirf Node ke event loop me test hui; asli lock (advisory lock) ka concurrency test `day9-part5-db.test.ts` me hai (TEST DB chahiye).
- IP guard memory me hai (har server instance ka apna); Vercel Firewall rule alag se lagao (`DAY7-FIXES.md`).
