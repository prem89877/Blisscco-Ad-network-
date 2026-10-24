# Day 6 (Part 3): publisher API-key authentication: audit, tests, verification checklist

**Seedha nateeja:** audit me authentication code ya SQL me koi bug nahi mila, isliye `lib/`, `app/` aur Day 5 ki SQL me **kuch nahi badla**
(RLS bhi nahi chhedi, doosra key system bhi nahi). Sirf tests aur docs jode gaye. **Koi database migration nahi hai.**

## 1. Kya chala aur kya NAHI (sach-sach)

Is sandbox me chala (asli result):
- Compile + `node --test` (poora suite): **498 tests, 498 pass, 0 fail** (pehle 444; 54 naye `tests/ads/publisher-auth.test.ts` ke).
- Mutation check: log me hash daalne par 2, 401 body me Authorization echo karne par 13, authorize ke anjaane outcome ko aage badhne dene par 1,
  SQL me profile-active check hatane par 1 test fail hue; sab wapas karne par 0 fail.
- Strict type-check real `@types/node` ke saath: sirf 2 error, dono sirf isliye ki `next` aur `@supabase/supabase-js` packages sandbox me install nahi hain.
  Ye asli `npm run lint` nahi hai.

NAHI chala:
- **`supabase/sql/day-6-1-publisher-auth-tests.sql` kisi database par nahi chali** (sandbox me Postgres nahi). Jab tak tum har block ka expected result
  na dekho, wo tested nahi hai. TypeScript me SQL ki sirf *static* jaanch hai (regex); wo asli saboot nahi.
- `npm install`, `npm run lint`, `next build`, Vercel deploy, asli key ke saath asli API call.

## 2. Audit: tumhari 8 baatein

| # | Requirement | Nateeja | Kahan hai / kaise pakda |
|---|---|---|---|
| 1 | Missing aur malformed key reject | **Pehle se theek** | `readBearerKey` (format) -> 401, database tak nahi. Tests: R10 + naye (comma-joined header, junk after key). |
| 2 | Invalid / revoked / suspended key | **Pehle se theek** | `authorize_publisher_key`: key `active`, publisher `active`, publisher ka profile `active`. SQL S2-S5 + naye A1 (pending), A2 (profile suspended), A3 (uppercase hash). |
| 2b | **Expired key** | **Schema me hai hi nahi** | `publisher_api_keys` me `expires_at` column nahi: key tab tak chalti hai jab tak revoke na ho. Neeche section 4. |
| 3 | Inactive publisher ko ad nahi | **Pehle se theek** | SQL authorize + record dono, aur TS `matchCategorySignal` bhi `status = active` maangta hai. Naya A5 (record par suspended publisher). |
| 4 | Identity key se, body se nahi | **Pehle se theek** | Body me `publisher_id`/`key`/`key_hash`/`role`... = 400. Naya test: database ko jaane wale arguments ki exact list (publisher id kahin nahi). |
| 5 | Database error = fail closed | **Pehle se theek** | `serve.ts` har anjaane outcome par `unavailable` (503, no ad). Naye tests: throws, null/array/string data, `pending` status, Infinity/NaN cost, env missing. |
| 6 | Rate limit | **Pehle se theek** | Per-key per-minute SQL counter. Naya A6 (har key ka alag counter), A7 (`last_used_at`). Limit: fixed window (minute ki seema par 2x burst ho sakta hai), aur edge/IP limit abhi nahi (Day 5 review ka gap). |
| 7 | Key/hash response ya log me nahi | **Pehle se theek, ab runtime tests ke saath** | Pehle sirf source ki static jaanch thi. Naya: 15 scenarios x 2 routes me response (body+headers) me key/hash/publisher id nahi; aur logs me sirf `"[ads/serve] ..." + error code`. Errors me jaan-boojh kar secrets daale gaye: logs/response me nahi aaye. |
| 8 | Secret credentials client me nahi | **Pehle se theek** | `final-review.test.ts` (client components admin client import nahi karte, `SUPABASE_SECRET_KEY` sirf ek server-only file me). Kuch nahi badla. |

Ek behaviour jo galat nahi par jaanna zaroori hai: agar key authorize ke **baad** par record se **pehle** revoke ho jaye, toh `record_ad_serve`
`unauthorized` deta hai aur route **200 `{fill:false}`** deta hai (ad nahi jaata). 401 nahi, kyunki ad pehle hi chun chuka tha. Fail-closed hai.

## 3. Kya jodha (3 files, sab nayi)

- `tests/ads/publisher-auth.test.ts`: TypeScript tests (upar ki table ke "naye" hisse).
- `supabase/sql/day-6-1-publisher-auth-tests.sql`: SQL tests A1-A11 + live read-only checks V1-V4. **Schema nahi badalta**, har block `begin ... rollback`.
- `DAY6-PUBLISHER-AUTH.md`: ye file.

## 4. Expired keys: tumhara faisla chahiye

Schema ke hisaab se "expired key" ka concept nahi hai, isliye maine use bana ke "kaam karta hai" nahi dikhaya. Agar chahiye: `publisher_api_keys.expires_at timestamptz null`
+ `authorize_publisher_key` me `and (k.expires_at is null or k.expires_at > now())` + `record_ad_serve` me wahi + `private.issue_publisher_key` me optional expiry.
Ye ek **alag, reviewed SQL migration** hogi (RLS/grants wahi rahenge), aur deploy order: SQL pehle, code baad me (code ko kuch badalna nahi padega).
Jab tum bologe tab banaunga.

## 5. Deploy order

1. Koi migration nahi. SQL test project par: `day-6-1-publisher-auth-tests.sql` ke blocks A1-A11 ek-ek karke, phir V1-V4 (expected result file me likha hai).
2. Zip ki 3 files same paths par daalo.
3. `npm install`, `npm test` (`# fail 0`), `npm run lint` (0 errors), `npm run build`. (Ye mere paas nahi chale.)
4. Neeche ka checklist **test project** par.

## 6. Checklist: test publisher account se authentication verify karo

Pehle sirf TEST project par. Asli publisher ya asli key kabhi nahi. Jo key banegi wo sirf ek baar dikhti hai: chat/GitHub/screenshots me mat daalo.

**Setup (SQL Editor, test project):**
1. `day-3-6` ka SETUP block chala ho (TEST Publisher C, `delieveryboy09@gmail.com`, status `active`).
2. Key banao (ek baar dikhti hai): `select private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C'));`
   Jo `blc_live_...` text aaye use sirf apni terminal me `export TEST_KEY=...` karo.
3. Key ki row id: `select id, key_prefix, status, last_used_at from public.publisher_api_keys where publisher_id = (select id from public.publishers where name = 'TEST Publisher C') order by created_at;`
4. Ad dene ke liye 1 eligible creative chahiye (S1 ke update statements: campaign `gaming` + `active`, creative `approved`).

**Checks** (`SITE` = tumhari test site; v1 aur purana dono par try karo):

    curl -i -X POST "$SITE/api/v1/ads/match" -H "Authorization: Bearer $TEST_KEY" -H "Content-Type: application/json" -d '{"topic":"gaming"}'

- [ ] Header ke bina -> **401**, body `{"error":"unauthorized"}`, `WWW-Authenticate` header.
- [ ] `Authorization: Bearer abc` (galat format) -> **401**, wahi body.
- [ ] Apni test key ka **aakhri character badal ke** (sahi format, database me nahi) -> **401**, **wahi body** (missing wale jaisa).
- [ ] Sahi key + `{"topic":"gaming"}` -> **200** `{"fill":true,"sponsored":true,"ad":{...5 fields}}` (ya `{"fill":false}` agar eligible creative nahi).
- [ ] Response me `Cache-Control: no-store`; koi `Access-Control-Allow-*` header nahi.
- [ ] Sahi key + `{"topic":"gaming","publisher_id":"x"}` -> **400** `unknown_field`.
- [ ] Sahi key + `{"topic":"health"}` -> **200** `{"fill":false}`.
- [ ] `last_used_at` set hua: step 3 ki query dobara chalao (pehle null, ab time).
- [ ] **Revoke:** `select private.revoke_publisher_key('<step 3 ki row id>');` phir wahi call -> **401** (wahi body).
- [ ] Nayi key banao (step 2). **Publisher suspend:** `update public.publishers set status = 'suspended' where name = 'TEST Publisher C';` -> **401**. Wapas `'active'` -> **200**.
- [ ] **Pending:** status `'pending'` -> **401**. Wapas `'active'`.
- [ ] **Profile suspend:** `update public.profiles set status = 'suspended' where id = (select profile_id from public.publishers where name = 'TEST Publisher C');` -> **401**. Wapas `'active'`.
- [ ] **Rate limit:** `update public.ad_platform_settings set rate_limit_per_minute = 2;` phir 3 calls jaldi -> teesri **429** + `Retry-After: 60`, aur us call me ad nahi.
      Phir **wapas** `update public.ad_platform_settings set rate_limit_per_minute = 60;`
- [ ] **Logs:** Vercel Function logs me key, hash, topic, body, ad text kuch nahi; sirf `[ads/...]` label + error code.
- [ ] **Browser:** `/` aur `/dashboard` ke DevTools > Sources/Network me `sb_secret_` ya `blc_live_` string nahi milti.
- [ ] **Safai:** test key revoke karo; `rate_limit_per_minute` 60 par; test publisher `active`.

## 7. Known gaps (Part 3 ne nahi badle)

1. Expired keys: schema me nahi (section 4).
2. Edge/IP rate limit: sahi-format galat keys har baar database tak jaati hain. Vercel Firewall dono paths par.
3. Key issue/revoke abhi SQL Editor se (publisher self-service UI nahi); key rotation/expiry dashboard nahi.
4. Rate limit fixed-window hai (minute ki seema par burst).
5. Budget abhi enforce nahi hota (`DAY6-API-V1.md` "Known gaps").
