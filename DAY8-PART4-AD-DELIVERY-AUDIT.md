# Day 8 | Part 4 : Ad Delivery Code-Level Audit (SIRF AUDIT, koi code fix nahi)

Status: **plan approval ke intezaar me.** Is turn me koi app code, SQL ya config nahi badla.

## Kya dekha, kya chalaya, kya NAHI chalaya

- Files padhi (sab 8 exist karti hain): `app/api/ads/match/route.ts`, `app/api/v1/ads/match/route.ts`, `lib/ads/serve.ts`, `service.ts`, `selection.ts`, `candidate-loader.ts`, `serve-db.ts`, `category-matching.ts`.
- Flow ko poora samajhne ke liye ye bhi padhi (prompt me nahi thi par flow ka hissa hain): `lib/ads/match-handler.ts`, `api-key.ts`, `ip-guard.ts`, `validation.ts`, `contract.ts`, `candidate-rows.ts`, `lib/supabase/admin.ts`.
- Live Supabase (project Blisscco-Ad-network-) par SIRF READ-ONLY queries chalayi: `pg_get_functiondef` for `authorize_publisher_key`, `record_ad_serve`, `load_ad_candidates`, `issue_publisher_key_for`, `private.purge_old_ad_logs`; CHECK constraints; column types; `default_transaction_isolation` (= read committed).
- **Nahi chalaya:** `npm test` (node_modules install nahi, network band). Live concurrency test bhi **nahi** chalaya (ye test data likhta). Isliye race-safety ka nateeja "live function ka code padhkar" hai, "chalakar dekha" nahi.
- Vercel ka region/plan, aur asli latency: yahan se dikhta nahi. Jahan zaroori hai wahan "VERIFY" likha hai.

---

## 1. Request flow (step by step)

`POST /api/ads/match` aur `POST /api/v1/ads/match` dono sirf `handleMatchPost()` (match-handler.ts) chalate hain. v1 sirf header `X-Blisscco-Api-Version: 1` jodta hai.

1. **IP guard** (match-handler.ts:103): is IP se 20+ galat keys/minute aayi ho toh 429, DB tak nahi.
2. **Key format** (:106, api-key.ts): `Authorization: Bearer blc_live_<64 hex>`. Galat/missing -> 401 (+ IP failure count).
3. **Shape checks** (:113-127): content-type strict JSON -> 415; body > 2048 bytes -> 413 (content-length aur streaming dono se).
4. **Body validation** (validation.ts): sirf `topic` (`^[a-z0-9_]{1,50}$`) aur `exclude_ad_ids` (max 20 UUID). Koi aur field -> 400 `unknown_field`.
5. **Hash**: SHA-256(key). Plain key aage nahi jaati.
6. **serveAd()** (serve.ts:42) 5 kadam:
   1. `authorize_publisher_key` RPC (DB call #1): key active + not expired + publisher active + profile active; rate-limit counter badhta hai; `unit_cost_usd = cpm/1000` aata hai.
   2. `resolveCategory(topic)` (category-matching.ts): sensitive/unsupported -> no_fill (DB call nahi).
   3. `selectAd()` (selection.ts) -> `load_ad_candidates` RPC (DB call #2, read-only, max 200 rows) -> TypeScript me dobara eligibility (approved creative, active campaign/advertiser/profile, UTC dates, category exact, total+daily budget) -> sort (kam serve hua campaign, phir creative, phir id) -> exclude list ko prefer.
   4. `record_ad_serve` RPC (DB call #3): key dobara verify, creative+campaign dobara verify, **campaign row par `FOR UPDATE` lock**, spend sums, budget check, phir `campaign_spend_daily` + `ad_serve_log` + `creative_serve_daily` likhta hai.
   5. Sirf record ke BAAD ad wapas; sirf 5 public fields.
7. **Response mapping**: ad -> 200 `{fill:true,sponsored:true,ad:{...}}`; no_fill -> 200 `{fill:false}`; unauthorized -> 401; rate_limited -> 429 + `Retry-After: 60`; unavailable -> 503 `{fill:false,error:"unavailable"}`. Har jawab `Cache-Control: no-store`, `Vary: Authorization`. Kuch bhi anjaana throw ho toh wahi 503 (catch, match-handler.ts:79).

---

## 2. Aapke 8 sawaalon ke jawab

**1. Authentication / publisher authorization:** Sahi. Publisher id caller se kabhi nahi liya jaata, key hash se DB batata hai. `authorize_publisher_key` aur `record_ad_serve` dono key, expiry, publisher.status, profile.status dobara jaanchte hain (record me bhi, isliye key beech me revoke ho toh serve nahi hota). Functions sirf `service_role` se chalte hain (Part 3 C1 me verify hua). Key ka sirf hash DB me.

**2. Validation + category targeting:** Sahi aur strict (allow-list fields, exact slug/alias match, sensitive terms reject, substring kabhi nahi). Observation: validation `^[a-z0-9_]` maangti hai, isliye `category-matching.ts` ka uppercase/hyphen/space normalization API path par kabhi chalta hi nahi (dead-ish code, harmless).

**3. Creative approval / campaign status / schedule / budget:** Teen jagah check hota hai: DB loader (coarse), TypeScript (poora), `record_ad_serve` (final, DB authority). Status, dates (UTC dono taraf), category sab consistent. Budget: neeche #5.

**4. No eligible ads:** Topic invalid/sensitive/unsupported ya koi eligible candidate nahi -> 200 `{fill:false}` (wajah publisher ko nahi). DB load fail -> 503 (outage aur "no ads" me farak rakha gaya, accha hai). **Gap:** candidate mil gaya par `record_ad_serve` ne reject kiya (budget khatam / race / paused) -> seedha no_fill, doosra candidate try nahi hota (Finding F3).

**5. Concurrent requests budget overspend?** Same campaign par **overspend nahi ho sakta** (live function code padhkar): `record_ad_serve` pehle `select ... for update of c` se campaign row lock leta hai, uske BAAD spend sums padhta hai, check karta hai, phir likhta hai; sab ek transaction me (RPC = 1 transaction). Isolation `read committed` hai, isliye lock milne ke baad ki SELECT pichhle committed serve ka spend dekhti hai. Total aur daily dono check lock ke andar. Alag campaigns alag lock lete hain, koi deadlock-order nahi dikha. TypeScript ka budget check sirf pre-filter hai, authority DB hai. **Ye reading hai, live concurrent test nahi** (F-test).

**6. Rate limiting / errors / version consistency:**
- Rate limit DB me per-key, fixed 1-minute window, atomic upsert (`on conflict ... hits+1`): sahi. IP guard sirf best-effort memory.
- Dono API versions ek handler se chalte hain: body, status codes, headers (version header ke alawa) identical. Verified by code reading.
- Gaps: F2 (per-key, per-publisher nahi), F6 (IP guard), F8 (chhoti consistency baatein).

**7. Security / performance bottlenecks:** F1, F2, F5, F6 neeche.

**8. Minimal fixes:** Neeche prioritized plan.

---

## 3. Findings (priority order)

| # | Severity | Finding | Kahan |
|---|---|---|---|
| F1 | Medium (VERIFY) | Latency: ek request = 3 sequential DB round trips. Repo me koi region config nahi (`vercel.json`/`preferredRegion` nahi mila), DB **ap-southeast-1**. Agar Vercel function default US region me hai toh har round trip lamba hoga. Asli numbers maine nahi napay. | service.ts / serve-db.ts, config |
| F2 | Medium | Rate limit **per key**, per publisher nahi. Ek publisher 5 active keys bana sakta hai (`issue_publisher_key_for`), yaani 5x60 = 300 req/min. Charge "serve" par lagta hai (impression verify nahi), toh malicious/galat publisher advertiser ka budget tezi se kha sakta hai. (Code me "serve = billing ka aadhar nahi" note pehle se hai.) | authorize_publisher_key |
| F3 | Medium | `record` reject par retry nahi: ek candidate chhoot gaya toh `{fill:false}` bhale doosra eligible ho. Fill-rate ghatta hai, overspend nahi. | serve.ts:79-80, selection.ts |
| F4 | Low-Med | Unit cost mismatch: authorize `cpm/1000` (unrounded) deta hai; `record_ad_serve` `greatest(round(cpm/1000,4),0.0001)` charge karta hai. CPM 2.0000 par barabar; CPM jaise 2.5555 ya < 0.1 par TS ka pre-filter DB se alag hoga. Nateeja: kabhi-kabhi unneeded no_fill. DB authority hone se overspend nahi. | authorize_publisher_key vs record_ad_serve |
| F5 | Low (scale) | `load_ad_candidates`: har row par 4 correlated subqueries, aur ORDER BY unhi computed columns par hai, toh `limit 200` se pehle category ke SAARE approved creatives par kaam hota hai. Abhi data nahi (0 active campaigns) toh asar nahi; hazaron creatives par dikhega. | load_ad_candidates |
| F6 | Low | IP guard: per-instance aur (Vercel me) per-route memory; 5000 se zyada alag IPs se purane entries hat jaate hain; `Retry-After` hamesha 60. Poori suraksha ke liye Vercel Firewall rule zaroori (DAY7-FIXES me pehle se likha). `x-forwarded-for` par bharosa Vercel par theek hai; kisi aur host par spoof ho sakta hai. | ip-guard.ts, match-handler.ts |
| F7 | Low | `for update of c` FK-wale inserts (jaise advertiser ka naya creative) ko serve transaction ke dauran thodi der rok sakta hai. `for no key update` same serialization deta hai par FK inserts nahi rokta. | record_ad_serve |
| F8 | Info | 503 par `Retry-After` nahi; fixed-window me minute ki seema par 2x burst; 429 par asli bacha hua time nahi. Legacy aur v1 me koi fark nahi. | match-handler.ts |
| F9 | Carry-over | Part 3 C1: `public.rls_auto_enable()` anon/authenticated/service ko executable (Supabase ka khud ka helper hone ka andaza; verify nahi). Is audit ke scope ke bahar, sirf yaad dilane ke liye. | DB |
| T1 | Test gap | `tests/ads` me concurrency/race test nahi mila (grep). Race-safety abhi sirf code-reading par tiki hai. | tests/ |

---

## 4. Prastavit fixes + acceptance criteria (approval ke baad hi)

Sab minimal; response contract (body shapes/status codes) kahin nahi badalta jab tak likha na ho.

**Fix A (F1) , config only, code nahi:** Vercel project ka Function Region DB ke paas (Singapore `sin1`) set karo (dashboard) ya route files me `preferredRegion`.
- AC: Deploy ke baad `/api/v1/ads/match` ka p50 pehle/baad Vercel logs me compare; function region logs me sin1. Koi API response nahi badla.
- Migration asar: koi nahi.

**Fix B (F2) , SQL only (`authorize_publisher_key`):** rate-limit hits ko publisher ke saare keys ke liye us window me jodkar check karo (max 5 rows), key-level counter jas ka tas.
- AC: 5 keys par 20-20 request (total 100) ek minute me, limit 60 -> 61vi request se 429. Ek key par 60 tak abhi jaisa 200. Index/perf: authorize ka extra cost 1 chhoti query.
- Migration asar: jo publisher kai keys se zyada traffic bhej raha hai use ab shared quota milega; DAY6 docs me ek line.

**Fix C (F3) , TS only (`serve.ts`, thoda `selection.ts`):** `record` reject hone par agla eligible candidate (max 2 extra) try karo; same endpoint, same response.
- AC: unit test: pehla candidate record me reject, doosra OK -> 200 ad (doosra). Sab reject -> 200 no_fill. Max 3 record calls. Worst-case latency ka cap documented.
- Migration asar: koi nahi (zyada fills).

**Fix D (F4) , SQL only (`authorize_publisher_key`):** `unit_cost_usd` ko `record_ad_serve` jaisi hi expression se nikaalo (`greatest(round(cpm/1000,4),0.0001)`).
- AC: CPM 0.05, 2.0, 2.5555 par authorize ka unit == record ka charge (SQL assertion). TS tests pass.

**Fix E (F7) , SQL only:** `for update of c` -> `for no key update of c`.
- AC: do parallel serves same campaign par ab bhi serialize (spend sahi); campaign ke creative insert serve ke dauran block nahi hota.

**Test T1 (pehle, taaki F-race ka saboot mile):** test project par ek approved creative + chhota total budget (jaise 10 serves ki gunjayish) banakar 20-30 parallel `record_ad_serve` calls.
- AC: successful serves ka count <= budget/unit; `campaign_spend_daily.spent <= total_budget`; `ad_serve_log` rows == successful count. Test ke baad test data saaf.

**Defer (measure pehle):** F5 (EXPLAIN ANALYZE 1k/10k creatives par, phir hi badlo), F6 (Vercel Firewall rule dashboard se), F8 (chhote headers, chaho toh baad me).

Sujhai gayi order: T1 -> A -> C -> B -> D -> E.

## Jo jaan-boojh kar nahi badla
Koi secret/key print nahi hui. Koi runtime result invent nahi kiya; jo nahi chalaya woh upar saaf likha hai.
