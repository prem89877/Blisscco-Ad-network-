# Day 10 | Part 4: publisher guide, API contract docs, dashboard, examples

Koi SQL **nahi chalayi** aur is part ke liye koi nayi migration bhi nahi hai. API ka code (route, handler, validation, SQL) **nahi badla**: sirf docs, dashboard ka text aur tests.

## Asli endpoint / auth (jaanch ke baad confirm, kuch invent nahi kiya)

`POST /api/v1/ads/match` (purana `POST /api/ads/match` same handler). `Authorization: Bearer blc_live_<64 lowercase hex>`, `Content-Type: application/json`, optional `Idempotency-Key`. Body me sirf `topic` aur optional `exclude_ad_ids`. Public ad fields: `id`, `headline`, `body`, `cta_text`, `destination_url` (+ top-level `fill`, `sponsored`). Koi public / site key ya publisher id **exist hi nahi karta**: guide me ye saaf likha hai.

## Jo gap mile aur fix kiye

| # | Gap | Fix |
|---|---|---|
| 1 | Contract doc me `Idempotency-Key` header aur 400 reason `invalid_idempotency_key` nahi tha (Day 9 me aaya tha). | Dono jode; curl example me header. |
| 2 | Guide / doc ne 401 ke kaaran adhure likhe (expired key, suspended publisher / profile nahi). | Ab saare kaaran, aur ye ki sab ek jaisa dikhte hain. |
| 3 | 429 ka doosra kaaran (ek IP se ~20 galat keys) kahin nahi tha. Ye bhi nahi ki 400 / 413 / 415 key ke quota me nahi ginte. | Guide aur doc me, asli handler ke order se test kiya. |
| 4 | Approval process ka sirf ek line me zikr. | Guide section 2: pending -> Approved / Suspended, suspend par keys 401, reinstate par wapas chalti hain (SQL `authorize_publisher_key` se match). |
| 5 | Key generation ka format / randomness guide me nahi tha. | `blc_live_` + 64 lowercase hex, 32 random bytes, sirf hash store, expiry choices (30 / 90 / 365 / never), max 5 active keys. |
| 6 | Revoke / rotate ka kram adhura. | Guide me alag "Revocation" aur "Rotation without downtime" (naya banao -> deploy -> Last used dekho -> purani revoke). Revoke wapas nahi hota (SQL me un-revoke function nahi). |
| 7 | Private key vs public value ka farak saaf nahi tha. | Guide section 8 me table. Dashboard par key list ke neeche note: dikhne wale shuruaat / aakhri 4 akshar sirf pehchaan hain, inse API call nahi hoti. Keys panel ka note ab "private password" kehta hai. |
| 8 | Privacy-safe contextual signal ka alag section nahi tha. | Guide section 1: topic sirf publisher ke apne code se, fixed list se; koi user id / text / IP; `Gaming` ya `video games` = 400; unsupported / sensitive = normal no-fill. |
| 9 | Sirf TypeScript example tha, aur usme retry nahi tha jabki guide retry batata tha. | TypeScript example me ab **ek retry, wahi Idempotency-Key, 1s+ jitter**. Naya JavaScript (Node 18+) example: apne frontend ke liye proxy, topic fixed Map se (object lookup nahi: `__proto__` se bachne ke liye), browser ko sirf 5 ad fields. |
| 10 | `npm test` / `npm run lint` `node_modules` ke saath fail: do purani test files me type errors (`day9-part2.test.ts`: object union ka type; `day9-part5-guard.test.ts`: named capture group, ES2017 target). | Dono test files me type theek kiya (behaviour wahi). |

## Examples: kya asli me chala (actual)

`tests/ads/publisher-examples.test.ts` (31 naye tests). Guide ke text se example nikalkar chalaya jaata hai, isliye doc aur code alag nahi ho sakte.

- **TypeScript example:** strict mode me type-check, phir transpile karke asli `POST` route handler ke against (nakli database): success (URL, headers, body me sirf `topic` + `exclude_ad_ids`, key body me nahi), Idempotency-Key database ke `record_ad_serve` tak pahunchti hai, no-fill (sensitive / unsupported / koi ad nahi), 401 aur 400 par **retry nahi**, 429 par pause (agli call par koi request nahi), 503 ek baar phir success (**wahi key, 1-1.5s backoff**), 503 do baar => null, network error / timeout => ek retry phir null, env na ho toh koi request nahi.
- **JavaScript proxy example:** asli Node process me chalaya, local HTTP server ke peeche asli handler. Browser ko exactly `{sponsored, ad{5 fields}}`, key kabhi nahi, `Authorization` / `Idempotency-Key` header kabhi nahi; upstream ko sirf `{"topic":...}`; `__proto__`, `constructor`, `GAMING`, anjaana area => 204 aur upstream ko koi call nahi; no-fill / 401 / 429 / 503 => chup-chaap 204; env na ho => 204.
- **Mutation check:** proxy me fixed Map hatane par 2 tests fail, retry me nayi Idempotency-Key lagane par 3 tests fail, wapas karne par 0.
- **Guide / contract ke daave:** har 400 reason asli handler se nikalke doc me dhundha; topic format; person-identifying fields (user_id, email, ip, device_id, session_id, conversation_id, location, prompt, messages, api_key, publisher_id) sab 400 aur database tak nahi; 400 / 413 / 415 / galat key format par `authorize_publisher_key` nahi bulaya jaata; key sirf `Bearer` header se (query / body se nahi); expired / revoked / unknown / missing key ek jaisa 401; key format `readBearerKey` / `buildKeyParts` se match.

Result: `npm run lint` (`tsc --noEmit`) 0 errors. `npm test`: **1440 pass, 0 fail** (pehle 1409; 31 naye). `next lint` (guide, publisher page, dashboard components): no warnings. 

## Nahi chala (sach-sach)

- `next build`: is sandbox me Google Fonts (`next/font/google`) tak network nahi, isliye fail hua. Code ki galti nahi; apne project me `npm run build` chalao.
- **Asli deployed API par live request** aur asli Supabase par kuch nahi chala. Examples nakli database ke saath asli handler code par chale. Deploy ke baad guide section 9 ki checklist test key se chalao.
- Browser / mobile screen check (guide aur dashboard ka layout dekha nahi, sirf code / text).
- `test:integration` (asli test database chahiye).
- Publisher dashboard par key banane / rotate / revoke ka asli click-flow (uska logic pehle ke Part 2 tests me hai, is part me nahi badla).

## Jo jaan-boojh kar nahi badla

- Koi API behaviour, field, endpoint ya SQL nahi. Rotate me purani key apne aap revoke nahi hoti (downtime se bachne ke liye).
- Guide ka section numbering (1 se 10) same rakha, taaki purane references na tootein.
- `day-10-2-key-limits.sql` (24 ghante me 20 keys) abhi bhi **tumhari approval ka intezaar** karti hai. Contract doc me likha hai ki ye limit migration chalne ke baad lagti hai; guide sirf "may also be limited per day" kehta hai.

## Deploy

Zip ki files same paths par daalo. Koi SQL / env variable nahi. Phir `npm install`, `npm test`, `npm run lint`, `npm run build`.
