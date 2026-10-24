# Day 6 (final): API integration review

**Seedha nateeja: ye API PRODUCTION-READY NAHI hai.** Week 1 MVP ki line ("authorized publisher supported category bheje, sahi eligible
sponsored ad structured JSON me mile") **code + nakli-database tests me saabit hui**. Asli Supabase, asli deploy ya asli key ke saath kuch
verify nahi hua. Neeche section 6 ki limitations baaki hain.

## 1. Kya chala aur kya NAHI (sach-sach)

Is sandbox me chala (asli result):
- `tsc -p tsconfig.test.json` + `node --test` (poora suite): **598 tests, 598 pass, 0 fail**
  (Day 6 shuru: 444 -> prompt 4: 561 -> prompt 5: 573 -> is stage: 598; 25 naye `tests/ads/mvp-e2e.test.ts` ke).
- Compile me sirf ek error: TS2688 (`@types/node` install nahi). Baaki test code par koi type error nahi.
- Uploaded zip se diff: Day 6 ke baad sirf ye files badli hain: `.env.example`, `lib/ads/match-handler.ts`, `components/Sections.tsx`,
  `components/dashboard/IntegrationSteps.tsx`, `app/dashboard/publisher/page.tsx`, `app/dashboard/publisher/guide/page.tsx`
  (+ naye: `lib/ads/contract.ts`, 3 test files, 2 doc files). **Campaign management, auth, landing ke baaki hisse, SQL: ek byte nahi badla.**
- Grep: koi `"use client"` file `lib/ads/*`, `supabase/admin` ya `SUPABASE_SECRET_KEY` import nahi karti; `SUPABASE_SECRET_KEY` sirf `lib/supabase/admin.ts` me hai.

NAHI chala (is sandbox me network band hai, `node_modules` nahi, Postgres nahi):
- `npm install`, `npm run lint` (poore project par `tsc`; koshish ki to 1600 se zyada errors aaye, sab missing react/next types ki wajah se, isliye ye check **valid nahi**),
  `next build`. **Tumhe chalane hain** (section 4 aur 5).
- Koi SQL kisi database par nahi chali (`day-5-9`, `day-6-1` ke SQL tests bhi nahi).
- Koi deploy, koi asli API call, koi asli key. Isliye "live API chal rahi hai" jaisa kuch bhi verified nahi.
- Browser me landing/dashboard/campaign pages dekhe nahi (sirf TSX syntax check + source tests).

## 2. Review table

| # | Cheez | Nateeja | Saboot |
|---|---|---|---|
| 1 | `/api/v1/ads/match` | Theek | thin wrapper, `X-Blisscco-Api-Version: 1`, sirf POST export (`v1-route`, `contract`, `mvp-e2e` tests) |
| 2 | `/api/ads/match` compatibility | Theek | dono routes ek handler; 12+5 scenarios me body/status/headers/db-calls same (`v1-route`, `mvp-e2e`). Ek jaanboojh kar badlav: strict content-type dono par |
| 3 | Key auth + revoked key | Theek (TS side) | missing/malformed/unknown/revoked => 401 same body, database tak nahi (malformed); authorize ke baad revoke => ad nahi (`mvp-e2e`). **SQL side tests asli DB par nahi chale** |
| 4 | Validation + size limit | Theek | sirf `topic`+`exclude_ad_ids`; 2048 bytes (bytes, characters nahi), chunked body bhi 413 (`contract`) |
| 5 | Category matching + eligibility | Theek | paused/rejected/expired/future/galat category/suspended advertiser+profile: database galti se bheje tab bhi TS rok leta hai (`mvp-e2e`) |
| 6 | Sponsored format + no-fill | Theek | `sponsored:true` literal, 5 public fields, no-fill hamesha `{"fill":false}` |
| 7 | Rate limit + safe errors | Theek, par limits hain (section 6) | 429+`Retry-After:60`; 503 body fixed, secrets response/log me nahi |
| 8 | Server-only secrets, private queries | Theek | `server-only`, service_role-only functions, return me advertiser email/budget key nahi (SQL padha; test: `contract`) |
| 9 | Docs + examples | Theek | `DAY6-ADS-MATCH-CONTRACT.md` ke JSON asli jawab se test me milte hain; publisher guide page ke examples bhi (`publisher-guide`) |
| 10 | Landing/dashboard/campaigns | Koi regression nahi mila | upar ka diff; sirf copy badli (Sections me galat API sample theek kiya) |

Required test list ka mapping: valid key + eligible ad (`mvp-e2e`, `v1-route`), valid key + no ad (`mvp-e2e`, `contract`), missing/invalid key (`contract`,
`v1-route`), invalid topic / unexpected field (`contract`), rate limit (`contract`, `mvp-e2e`), database/service failure (`contract`, `mvp-e2e`),
no private advertiser data (`contract`), dono routes consistent (`v1-route`, `mvp-e2e`).

## 3. Findings (koi code bug nahi mila, isliye production code nahi badla)

1. **Candidate load fail hone par 200 `{"fill":false}` aata hai, 503 nahi** (authorize/record fail par 503 aata hai). Safe hai (ad nahi dikhta), par outage
   aur "koi ad nahi" me farak nahi dikhta. Maine badla nahi (behaviour change hota). Monitoring me no-fill spike dekho; ya baad me alag kaam me 503 karo.
2. Select aur record ke beech race: record function creative dobara verify karta hai, isliye ineligible ad kabhi nahi dikhta.
3. `DAY6-API-V1.md` me test counts purane hain (itihas ke taur par theek). Taaza count upar section 1 me.
4. Edge case jo dekha: `topic` = `__proto__` jaisa string format me valid hai, par taxonomy `Map` use karti hai, isliye no-fill milta hai (safe).

## 4. SQL migration aur deployment order

**Day 6 me koi naya SQL migration nahi hai.** Agar tumhare database me Day 3 to Day 5 pehle se chali hain, toh kuch chalane ki zarurat nahi.

Naye/khali database ke liye, SQL Editor me is ORDER me (har file dobara chalane par safe hai), sirf ye "migration" files:
`day-3-1` -> `day-3-2` -> `day-3-3` -> `day-3-4` -> `day-3-5` -> `day-3-7` -> `day-4-1` -> `day-4-3` -> `day-5-1` -> `day-5-2` -> `day-5-3` -> `day-5-4` -> `day-5-6` -> `day-5-8` -> `day-5-11`.
(Sab `supabase/sql/` me.) Ye files **sirf TEST project par**, asli data par kabhi nahi: `day-3-6`, `day-4-2`, `day-4-4`, `day-4-5`, `day-5-5`, `day-5-7`, `day-5-9`, `day-5-10`, `day-6-1`.
Order me jo files mere paas dikhi unki dependency header se li hai; kaunsi tumhare DB par chal chuki hain, wo mujhe nahi pata.

Chalane ke baad check (day-5-8 ke comment se): dono functions `security_definer = true`, aur grant sirf `service_role` (+ `postgres`) ko.
Deploy order: **pehle SQL (agar kuch baaki ho), phir Vercel code, phir smoke test.**

## 5. Android-friendly GitHub commit

Spck Editor (GitHub se connected) me:
1. Zip ki files **same paths par** repo me daalo (Day 6 prompt 4, 5 aur is stage ki zips, order se).
2. Spck > Git > naya branch `day6-final` banao (seedha `main` par nahi).
3. Changes dekho: `.env.example` me sirf placeholder hon (koi asli key nahi). Stage all.
4. Commit message: `Day 6: v1 ads API contract, publisher guide, MVP e2e tests`.
5. Push `day6-final`. GitHub app/web par Pull Request kholo. Vercel us branch ka **Preview** banayega.
6. Preview par smoke test (section 7) pass ho toh PR merge karo. `.test-build` aur `node_modules` commit nahi hote (`.gitignore` me hain).
7. Agar zip ki `package-lock.json` nahi hai toh Codespaces me `npm install` karke lockfile commit karo (SETUP.md).

## 6. Vercel checklist

Environment Variables (Project > Settings > Environment Variables):
- [ ] `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL
- [ ] `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: `sb_publishable_...` (browser me jaa sakti hai)
- [ ] `SUPABASE_SECRET_KEY`: `sb_secret_...`. **Bina `NEXT_PUBLIC_` ke**, sirf server. Kabhi git me nahi
- [ ] (optional) `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_CONTACT_EMAIL`
- [ ] **Preview** environment ko **alag TEST Supabase project** par rakho; Production ko asli project par. Env badalne ke baad **Redeploy** zaruri hai.
- [ ] Node version 20 ya 22. Build command default (`next build`).
- [ ] Deployment ke build log me error nahi; `/api/supabase-health` jaisa koi health check chala ho toh dekho.
- [ ] **Vercel Firewall > rate limit rule dono paths par**: `/api/ads/match` aur `/api/v1/ads/match` (IP par). Ye dashboard ka kaam hai, code me nahi.
- [ ] Function Logs me key, hash, topic, request body kuch nahi dikhna chahiye; sirf `[ads/...]` label aur error code.

## 7. Manual staging smoke-test (TEST publisher + TEST key, Preview URL par)

Setup: `SITE=https://<tumhara-preview-url>`, `TEST_KEY=<test key>` (key sirf apni terminal/Termux/Codespaces me; chat ya screenshot me nahi).
Key banane aur baaki SQL steps: `DAY6-PUBLISHER-AUTH.md` section 6.

| # | Call | Expected |
|---|---|---|
| 1 | POST `$SITE/api/v1/ads/match`, bina `Authorization` | 401 `{"error":"unauthorized"}` + `WWW-Authenticate` + header `x-blisscco-api-version: 1` |
| 2 | Key ka aakhri character badal ke | 401, wahi body |
| 3 | Sahi key, `{"topic":"gaming"}` | 200: ya `fill:true,sponsored:true,ad{5 fields}`, ya `{"fill":false}` (agar test campaign nahi) |
| 4 | `{"topic":"health"}` | 200 `{"fill":false}` |
| 5 | `{"topic":"gaming","prompt":"hi"}` | 400 `unknown_field` |
| 6 | `{"topic":"Gaming"}` | 400 `invalid_topic` |
| 7 | 3 KB body | 413 |
| 8 | `Content-Type: text/plain` | 415 |
| 9 | GET | 405 |
| 10 | Purane `POST $SITE/api/ads/match` par 3 aur 4 | same body, bina version header ke |
| 11 | Response headers | `cache-control: no-store`, **koi `access-control-allow-origin` nahi** |
| 12 | Rate limit: TEST DB par `update public.ad_platform_settings set rate_limit_per_minute = 3 where id;` phir 5 tez calls | 4th/5th par 429 + `Retry-After: 60`. **Baad me wapas 60** |
| 13 | Key revoke (`private.revoke_publisher_key`) phir call 3 | 401 |
| 14 | Publisher suspend phir call 3 | 401; wapas `active` |
| 15 | Vercel Function Logs | key/topic/body nahi |
| 16 | Regression (browser, phone par): landing page, signup/login, advertiser campaign banao/edit/pause/resume, `/dashboard/publisher` aur `/dashboard/publisher/guide` | pehle jaisa chale; guide me "Sponsored" label example dikhe |
| 17 | Safai | test key revoke, test data cleanup (`day-5-10`), rate limit 60 par |

Jab tak yeh table tum asli Preview par khud na chalao, "API live aur sahi chal rahi hai" mat maanna.

## 8. Baaki production limitations (abhi bhi)

1. **Budget enforce nahi hota** (`spendTracking = "unavailable"`; `record_ad_serve` me budget check nahi). Koi advertiser limit se zyada serve ho sakta hai.
2. **Impression/click tracking nahi.** "Serve" ginti hoti hai, display nahi. Billing, payout, analytics ke liye use mat karo (aur is stage me jaanboojh kar nahi joda).
3. **Edge/IP rate limit nahi** (sirf per-key, fixed minute window, 2x burst possible). Sahi-format galat keys har baar database tak jaati hain: Vercel Firewall zaruri.
4. **Key management manual**: SQL se issue/revoke, expiry nahi, rotation/self-service UI nahi.
5. `maxDuration` aur Supabase call timeouts tay nahi.
6. Candidate-load fail par silent no-fill (finding 1).
7. Select-record race, `ad_serve_log` / `api_rate_limits` retention job nahi.
8. Creative review UI nahi (approval abhi manual/database se).
9. SQL aur asli deploy par is review me kuch verify nahi hua (section 1).
10. Publisher dashboard ke numbers demo data hain; staging environment published nahi.
