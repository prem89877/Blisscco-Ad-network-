# Day 5 (Part 6): matching engine ka final review

**Seedha nateeja: ye PRODUCTION-READY NAHI hai.** Matching + safety ka core theek hai, par budget accounting, edge rate limiting,
creative review UI aur publisher key management baaki hain (section 5). Is review me kuch bhi "pass" tabhi likha hai jab maine chalaya.

## 1. Kya chala aur kya NAHI (sach-sach)

Is sandbox me chala (asli result):
- Poora test suite (compile ke baad `node --test`): **418 tests, 418 pass, 0 fail** (pehle 393; 25 naye `tests/ads/final-review.test.ts` ke).
- Strict `tsc` type-check: `lib/ads`, `app/api/ads/match/route.ts`, `lib/supabase/admin.ts`, `tests/**` par **0 errors** — par next/supabase/node ke
  **chhote stubs** ke saath (asli packages sandbox me install nahi ho sakte, network band). Ye asli `npm run lint` nahi hai.
- Mutation check: naya userinfo-URL check hatane par 6 tests fail hue; wapas lagane par 418/418.

NAHI chala:
- **`npm install`, `npm run lint` (poore project par tsc), `next build`, Vercel deploy, asli API call.**
- **SQL tests** (`day-5-5`, `day-5-7`) mere paas kabhi nahi chale (sandbox me Postgres nahi). `day-5-9` (S1-S15) tumne chalaya: S1-S6 pehle sahi, S7-S13 fix ke baad sahi, S14/S15 me expected ERROR.
- Live Supabase ki RLS/grants maine **nahi dekhi**; sirf `supabase/sql/*.sql` files padhi. Live check ke liye section 6 ki SQL chalao.

## 2. Tumhari 7 verify-list

| # | Check | Nateeja | Saboot |
|---|---|---|---|
| 1 | Paused aur expired campaigns select nahi hote | Haan | SQL `load_ad_candidates` + `record_ad_serve` + TS `candidateIneligibility` teeno jaanchte hain. Tests: R5, R6, S8, S11. |
| 2 | Unapproved creative bahar | Haan | Teeno layers `status = 'approved'`. Tests: R7, S9. |
| 3 | Invalid category rules bypass nahi kar sakti | Haan | Exact slug/alias match (substring nahi), sensitive/legacy reject, DB me `ad_categories` FK. Tests: R3, R4, category-matching tests, S10, S13. |
| 4 | Unauthorized publisher ko ad nahi | Haan | Key hash -> `authorize_publisher_key`; galat/missing/revoked/suspended = 401, ad nahi. Tests: R9, R10, S1-S5, S13. |
| 5 | Response me sirf zaroori fields | Haan | `{fill, sponsored, ad:{id, headline, body, cta_text, destination_url}}`. Tests: R12. |
| 6 | Browser ko koi secret nahi | Haan | `SUPABASE_SECRET_KEY` sirf `lib/supabase/admin.ts` (server-only); koi client component use nahi karta; route par CORS nahi. Naye tests: "secrets never reach the browser". |
| 7 | Tests me production advertiser data nahi | TS tests: haan. SQL tests: sirf agar test project par chalein | TS tests nakli uuid + example.com. SQL tests `TEST ...` rows (day-3-6 SETUP) par chalte hain; unhe sirf test project par chalana hai (neeche section 4 ka residue dekho). |

## 3. Area-wise review

- **Category normalization/taxonomy:** NFKC + lowercase + sirf space/-/_ ; max 50 chars, max 3 shabd; exact match; sensitive terms reject; `beauty` legacy (inactive). `coding_tools` -> `developer_tools` alias (product faisla). Koi fallback category nahi: unrelated category kabhi nahi milti.
- **Campaign/creative eligibility:** approved creative, active campaign/advertiser/advertiser-profile, dates, category. SQL aur TS dono me; TS DB par bharosa nahi karta.
- **Schedule/timezone:** poora system **UTC din** (SQL `now() at time zone 'utc'`, TS `getUTC*`, campaign form par "Dates use UTC" likha hai). Limit: India me 00:00-05:30 IST ke beech UTC date pichhla din hota hai, isliye "aaj" shuru hone wala campaign 05:30 IST tak shuru nahi dikhega. Advertiser ko ye pata hona chahiye (abhi sirf form ki ek line me hai).
- **Budget:** **ENFORCE NAHI HOTA** (`spendTracking = "unavailable"`). `campaign_spend_daily` me koi likhta nahi. `record_ad_serve` "serve" ginta hai, impression/click nahi: isse billing mat karna.
- **Publisher auth:** key hash (SHA-256) DB me; function sirf `service_role` ko; per-key per-minute rate limit. Integration status: **API route + SQL functions bane aur test hue; key SQL Editor se manual banti hai; self-service UI nahi.**
- **Private data server-side:** `load_ad_candidates`/`authorize_publisher_key`/`record_ad_serve` security definer, `search_path = ''`, execute sirf `service_role`; Day 5 tables par sab roles ke grant hata diye gaye. Select list me advertiser naam/email/profile id nahi (test hai).
- **Request validation:** sirf `topic` + `exclude_ad_ids`; unknown field reject; 2 KB limit (header + stream dono); content-type check; max 20 ids, uuid only.
- **No-fill/error:** no-fill me wajah nahi; errors fixed body (401/429/503); exception ka stack/message bahar nahi.
- **Logging:** sirf error code log hota hai; key/hash/topic/body/ad text kabhi nahi (test hai). Prompt kahin store nahi.
- **Sponsored label/URL:** response me `sponsored: true`. URL sirf `https://`, bina space, <= 2048. **Gap mila aur theek kiya:** `https://trusted.com@evil.example` jaisa userinfo wala URL paas ho jata tha (section 4).
- **TypeScript/existing pages:** stub-based strict check 0 errors (upar ki limit ke saath). Existing pages me sirf publisher guide ka purana text badla (section 4).

## 4. Jo issues mile aur kya badla

1. **Destination URL me userinfo (phishing).** DB CHECK aur TS dono `https://trusted.com@evil.example` ko maante the.
   - Code: `lib/ads/category-matching.ts` (`isCompleteCreative` ab host se pehle ka `@` reject karta hai; path/query me `@` allowed).
   - Migration: `supabase/sql/day-5-11-creative-url-hardening.sql` (CHECK `NOT VALID`, phir purani rows ki jaanch, phir validate).
2. **Purana test cleanup ab fail hoga.** `day-3-6` ka CLEANUP creatives/campaigns/publishers delete karta hai, par Day 5 ki `ad_serve_log`,
   `creative_serve_daily`, `campaign_spend_daily`, `publisher_api_keys` un par `on delete restrict` se bandhi hain: unki rows rahne par ERROR.
   Tumhare S7 me TEST creative A ki **2 purani serve rows** dikhi thi, yani aise rows pehle se hain. Naya `supabase/sql/day-5-10-test-data-cleanup.sql`
   (pehle sirf-padhne wala count, phir sahi order me delete, sirf exact TEST names).
3. **Publisher guide ka text jhootha-sa tha.** Usme likha tha "no live API, no API key issuing and no backend" jabki route aur key SQL ban chuke hain.
   Ab: "not open to publishers; keys manual; no integration with ChatGPT or any other third-party chatbot." Files: `app/dashboard/publisher/guide/page.tsx`, `components/dashboard/IntegrationSteps.tsx` (step 2 ka text).

Ye maine **nahi** badla: purana `match_contextual_ad` + `lib/ads/match.ts` (route se use nahi hote par maujood; service_role chala sakta hai, aur wahan budget logic zero-spend par chalta hai). Hatana alag faisla hai.

## 5. UNFINISHED (production se pehle zaroori)

1. **Reliable budget accounting:** impression tracking + kharch likhna; phir `spendTracking = "reliable"` aur `record_ad_serve` me budget check. Abhi advertiser ka budget kisi bhi tarah protected nahi.
2. **Edge/IP rate limiting:** abhi limit key ke baad lagti hai; sahi-format galat keys har baar DB tak jaati hain. Vercel Firewall/WAF ya Upstash lagao.
3. **Creative review ka UI:** review sirf DB functions (`admin_review_creative`, `admin_review_campaign`) me hai; na creative banane ka UI hai, na admin review screen. Abhi creative SQL se hi banta/approve hota hai.
4. **Publisher key self-service:** issue/rotate/revoke/expiry/last-used UI nahi; key SQL Editor se.
5. **Select aur record ke beech race** (rotation/budget thoda paar ho sakta hai); strict chahiye toh ek SQL function ya row lock.
6. **Retention job** `ad_serve_log`/`api_rate_limits` ke liye; **monitoring/alerts** (503, silent no-fill spike, 401/429 spike); route/DB **timeouts**.
7. **Destination URL scan/click tracking:** userinfo band hua, par phishing/malware domain ka scan aur creative policy review alag banana hai.
8. **Publisher ka category signal verify nahi ho sakta:** terms me likho ki sensitive context par ads nahi.
9. **Third-party chatbots:** Blisscco ka kisi third-party chatbot (ChatGPT sahit) me ad dikhane ka koi integration ya authorization nahi hai. Ads sirf wahi dikh sakte hain jahan us product ka owner khud API integrate kare.
10. **Staging par asli end-to-end test** (asli deploy + asli key) abhi hua nahi.

## 6. Migration / SQL (order se; Supabase SQL Editor, test project pehle)

1. `supabase/sql/day-5-11-creative-url-hardening.sql`: STEP 1 chalao. STEP 2 (Expect 0 rows). Phir STEP 3 (validate). Har step alag.
2. (Optional, test data hatana ho tab) `supabase/sql/day-5-10-test-data-cleanup.sql`: BLOCK 1 dekho, phir BLOCK 2. Phir Authentication > Users se 5 test users hatao.
3. Live security check (sirf padhta hai):

        -- Expect: 0 rows (in tables par anon/authenticated/service_role ko koi grant nahi)
        select grantee, table_name, privilege_type from information_schema.table_privileges
        where table_schema = 'public'
          and table_name in ('ad_serve_log','creative_serve_daily','campaign_spend_daily','api_rate_limits','publisher_api_keys','ad_platform_settings')
          and grantee in ('anon','authenticated','service_role');

        -- Expect: sab rows me rls_on = true
        select relname, relrowsecurity as rls_on from pg_class
        where relnamespace = 'public'::regnamespace
          and relname in ('profiles','advertisers','publishers','campaigns','ad_creatives','ad_categories','ad_serve_log','creative_serve_daily','campaign_spend_daily','api_rate_limits','publisher_api_keys','ad_platform_settings');

        -- Expect: har function ke liye sirf service_role (aur postgres)
        select routine_name, grantee from information_schema.routine_privileges
        where routine_schema = 'public'
          and routine_name in ('authorize_publisher_key','record_ad_serve','load_ad_candidates','match_contextual_ad')
        order by routine_name, grantee;

## 7. GitHub / Vercel verification checklist

GitHub (Codespaces, phone ke Chrome me Desktop site):
- [ ] Zip ki files same paths par daali; `git status` me sirf expected files badli dikhen.
- [ ] `npm install` phir `npm test`: `# fail 0` (tumhare repo me tests ka total 418 ya zyada).
- [ ] `npm run lint` (poora project type-check) **0 errors** — ye wo check hai jo maine nahi chalaya.
- [ ] `npm run build` success.
- [ ] `git grep -n "sb_secret_"` aur `git grep -n "SUPABASE_SECRET_KEY"`: asli key kahin commit nahi (sirf `.env.example` placeholder + `lib/supabase/admin.ts`).
- [ ] `.env*.local` aur `.test-build` `.gitignore` me hain (hain).

Vercel:
- [ ] `SUPABASE_SECRET_KEY` **bina** `NEXT_PUBLIC_` ke set hai; sirf Production/Preview jahan zaroori.
- [ ] Deploy ke baad `GET /api/supabase-health` -> `{"status":"ok"}`.
- [ ] `POST /api/ads/match` bina key -> 401; galat key (sahi format) -> 401; sahi key + `{"topic":"technology"}` -> `200` ad ya `{fill:false}`; `{"topic":"x","prompt":"hi"}` -> 400; 3KB body -> 413; GET -> 405.
- [ ] Response me sirf `fill, sponsored, ad{id, headline, body, cta_text, destination_url}`; `Cache-Control: no-store`.
- [ ] Function logs me key, topic, body, ad text kuch nahi dikhta (sirf error codes).
- [ ] Browser DevTools > Network/Sources me `sb_secret_` string nahi milti (`/dashboard`, `/`).
- [ ] `/dashboard/publisher/guide` par "Not open yet" aur "no integration with ChatGPT or any other third-party chatbot" dikhta hai.
