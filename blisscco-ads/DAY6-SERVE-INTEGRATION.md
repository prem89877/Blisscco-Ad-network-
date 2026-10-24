# Day 6: category matching + campaign selection ab route se jude (secure server-side serve)

## 1. Kya chala aur kya NAHI (sach-sach)

Is sandbox me chala (asli result):
- Strict TypeScript compile (`tsconfig.test.json`, next/supabase ke chhote stubs ke saath): 0 errors.
- `npm test` jaisa poora suite: **315 tests, 315 passed, 0 failed** (pehle 288; route tests naye flow ke hisaab se likhe gaye, nayi `serve.test.ts` me 23 tests).
- Mutation check: "record rejected par bhi ad do" aur "unauthorized par aage badho" todne par tests/compile fail hue.
  Teesra todna (category check hatana) fail nahi hua: wo jaan-boojh kar behaviour-equal hai, kyunki selection layer wahi check dobara karti hai.

NAHI chala:
- **`day-6-1-serve-functions.sql` aur `day-6-2-serve-tests.sql` kisi database par nahi chale** (sandbox me Postgres nahi). Jab tak tum S1 se S15 chalakar expected result na dekho, ye functions tested nahi maano.
- `npm install`, `next build`, Vercel deploy, asli API call asli key ke saath.

## 2. Flow

    POST /api/ads/match   (publisher ka SERVER, browser nahi)
    Authorization: Bearer blc_live_...      { "topic": "gaming", "exclude_ad_ids": [...] }

1. Route: key format -> content-type -> body size (2 KB) -> strict JSON (sirf `topic`, `exclude_ad_ids`). Koi prompt/free text nahi.
2. `authorize_publisher_key` (SQL): key hash + publisher active + publisher profile active + per-key rate limit. Publisher id caller se kabhi nahi liya jaata.
3. `resolveCategory` (TS): alias -> canonical slug (`games` -> `gaming`); sensitive/legacy/unsupported => no-fill, database tak query nahi.
4. `load_ad_candidates` (SQL, read-only) + `selectAd` (TS): eligibility + deterministic rotation => ek creative.
5. `record_ad_serve` (SQL): key dobara verify + creative dobara verify + serve log + daily counter.
6. Ad tabhi wapas jaata hai jab record ho gaya. Record na ho toh no-fill (rejected) ya 503 (error).

Jawab (shape pehle jaisa): `200 {fill:true, sponsored:true, ad:{id, headline, body, cta_text, destination_url}}`,
`200 {fill:false}`, `401 {error:"unauthorized"}`, `429 {error:"rate_limited"}` + `Retry-After`, `400/413/415`, `503 {fill:false, error:"unavailable"}`.

## 3. Behaviour jo badla (dhyan se)

- Aliases ab chalte hain (`games`, `video_games`, `tech`...). Pehle sirf exact slug.
- Rotation ab deterministic hai (pehle `random()`): kam serve hua campaign -> kam serve hua creative -> id.
- Candidate load fail hone par 200 no-fill aata hai (selection layer ka safe design), 503 nahi. Isliye monitoring zaroori hai (section 6).
- Purana `match_contextual_ad` (day-5-4) aur `lib/ads/match.ts` ab route se use nahi hote par hataye nahi. Rollback: `app/api/ads/match/route.ts` purani file se badal do.
- **Budget abhi bhi enforce nahi hota** (`spendTracking = "unavailable"`): kharch likhne wala impression tracking baaki hai. Pehle bhi kharch hamesha 0 tha.

## 4. DEPLOY ORDER

1. Supabase SQL Editor: `day-6-1-serve-functions.sql` ek baar chalao. Neeche ke 2 Check queries: 2 rows (`security_definer = true`), grantee sirf `service_role` aur `postgres`.
2. `day-6-2-serve-tests.sql`: day-3-6 ka SETUP block pehle chala ho. Har S-block alag. S14/S15 me ERROR expected hai.
3. Tab code push karo. (Code pehle push hua toh route 503 `unavailable` dega jab tak SQL na chale: safe fail, ad nahi jaata.)
4. Vercel me kuch naya nahi: `SUPABASE_SECRET_KEY` pehle se set hai.

## 5. Files

Naye: `supabase/sql/day-6-1-serve-functions.sql`, `supabase/sql/day-6-2-serve-tests.sql`, `lib/ads/serve.ts`, `lib/ads/serve-db.ts`, `lib/ads/service.ts`, `tests/ads/serve.test.ts`, `DAY6-SERVE-INTEGRATION.md`.
Badli: `app/api/ads/match/route.ts`, `tests/ads/request-and-route.test.ts` (sirf route section), `lib/supabase/admin.ts` (sirf comment).

## 6. Production se pehle BAAKI security kaam

1. **Edge/IP rate limiting.** Abhi rate limit key ke baad lagta hai. Galat-par-sahi-format keys har baar database tak jaati hain. Vercel WAF/Firewall ya Upstash se IP + path par limit lagao.
2. **Impression tracking + asli kharch.** Tab `spendTracking = "reliable"` karo aur `record_ad_serve` me budget check jodo (DAY6-SERVE-AND-SPEND-PLAN.md). Tab tak advertiser ka budget kisi bhi tarah protected nahi.
3. **Race.** Select aur record alag calls hain: do request ek hi creative chun sakti hain. Record eligibility dobara jaanchta hai, par rotation/budget thoda paar ho sakta hai. Strict chahiye toh Path 1 (sab SQL me) ya record me row lock.
4. **Monitoring bina sensitive logging ke.** Abhi sirf error code log hota hai. Alert lagao: 503 rate, `candidate_load_failed` jaisa silent no-fill spike, 401/429 spike. Request body, key, topic kabhi log mat karo.
5. **Publisher self-service key UI + rotation.** Abhi key SQL se banti hai. Expiry, last-used dashboard, leak par revoke.
6. **Retention.** `ad_serve_log` aur `api_rate_limits` badhte rahenge: purani rows hatane ka scheduled job.
7. **Creative safety.** Destination URL sirf `https://` validate hota hai. Link safety scan, creative review policy aur click tracking/redirect alag banana hai (open-redirect/phishing ka khatra review se hi rukta hai).
8. **Timeouts.** Route par `maxDuration` aur Supabase calls par timeout tay karo taaki database dheema ho toh requests latki na rahein.
9. **Secrets.** `SUPABASE_SECRET_KEY` kabhi `NEXT_PUBLIC_` me nahi; Vercel me sirf Production/Preview jahan zaroori. Rotation ki tareekh tay karo. Key chat/GitHub me kabhi nahi.
10. **Publisher ki classification.** Category signal publisher ka bheja hua hai; hum use verify nahi kar sakte. Publisher terms me likho ki sensitive context par ads nahi, aur galat signal par account suspend ho sakta hai.
11. **Staging par asli test.** Section 4 ke baad `DAY5-MATCHING-SETUP.md` ke API checklist (401/400/429/no-fill) naye flow par dobara chalao.
