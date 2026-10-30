# Day 11 | Part 4 : Ranking aur fallback ka audit

Status: 1 confirmed bug fix (sirf TypeScript, `lib/ads/selection.ts`). **Koi SQL nahi, koi migration nahi, Supabase par kuch nahi chalaya gaya.**
Ye part Part 3 ke upar bana hai (Part 3 ki `serve.ts`, `validation.ts` etc. pehle bheji ja chuki hain).

## Ranking ka tareeka (pehle bhi yahi tha, ab test se pakka)

Sirf bharosemand signals: category relevance + campaign eligibility + aaj ka serve count. Koi bid/priority/weight nahi (DB me hai hi nahi).

1. **Relevance = hard gate, score nahi.** Category exact match na ho toh ad kabhi nahi chunta, chahe uska rank kitna bhi achha ho.
2. **Tier**: `topic` pehle, phir `fallback_topics` publisher ke order me. Tier rotation se upar hai.
3. **Eligibility gate**: approved creative, active campaign/advertiser/profile, schedule (UTC din), total + daily budget, publisher authorization. Ye rank se pehle lagta hai.
4. **Tier ke andar rotation**: aaj kam serve hua campaign -> kam serve hua creative -> campaign id (a-z) -> creative id (a-z). Random kahin nahi.

Example: gaming me A (campaign serves 5) aur B (serves 2). B pehle jaata hai. Dono 2 par hon aur creative serves 1 vs 2, toh jiska 1 hai. Sab barabar ho toh chhota campaign id. Input ka order badalne se kuch nahi badalta (sab permutations test kiye).

## Confirmed bug (fix kiya)

**Kya tha:** Selection ne top ad ke saath agle 2 candidates `nextAds` me rakhe, jo DB reject kare toh try hote hain. Agar top campaign A ke 3 creatives hon aur DB A ko reject kare (budget usi pal khatam / campaign usi pal pause), toh agle 2 attempts bhi A ke siblings par jaate the, jo wahi wajah se reject hote. Result: campaign B eligible hone ke bawajood `{fill:false}`.

**Reproduce kiya (fix se pehle):** A1, A2, A3 (campaign A, DB reject) + B1 (eligible) => result `no_fill`, 3 record calls sab A ke.

**Fix:** `pickNextCandidates`: pehle ALAG campaigns ke best creatives (rank order me), phir bache slots me usi campaign ke siblings. Ab A1 reject => B1 serve. Agar sirf ek hi campaign hai aur sirf ek creative reject hua (creative-level wajah), toh sibling A2 abhi bhi serve hota hai. Record calls ki seema ab bhi 3, aur ek hi ad charge hota hai.

## Har case me behaviour (pehle vs ab)

| Case | Response | Pehle | Ab |
|---|---|---|---|
| Topic unsupported / legacy / sensitive | 200 `{fill:false}`, DB se candidates load bhi nahi | same | same (test) |
| Category sahi, par koi campaign nahi / sirf doosri category | 200 `{fill:false}` | same | same (test) |
| Sab campaigns paused/completed/draft, creative unapproved | 200 `{fill:false}` | same | same (test) |
| Total ya daily budget khatam | 200 `{fill:false}`, kuch charge nahi | same | same (test) |
| Schedule ke bahar (shuru nahi / khatam) | 200 `{fill:false}` | same | same (test) |
| Top campaign ko DB reject kare, doosra campaign eligible | **pehle `{fill:false}` (bug)** | no-fill | **doosre campaign ka ad** |
| Missing/empty/galat context (`{}`, `topic:""`, null, array) | 400 `invalid_request` + reason (purana format) | same | same (test) |
| Publisher suspended / key galat | 401, fallback ya candidates tak nahi pahunchte | same | same (test) |
| DB error (authorize / load / record) | 503 `{fill:false,error:"unavailable"}` | same | same (test) |
| DB ka garbage jawab / exception | kabhi ad nahi, 503 ya no-fill | same | same (test) |

Contract: no-fill ka existing format `{fill:false}` (200) hi hai, badla nahi. Outage hamesha 503 (`error:"unavailable"`), "koi ad nahi" se alag dikhta hai. Ye purana decision hai, document kiya.

## Errors aur leaks

- Log me sirf error code jaata hai (message/details me data ho sakta hai). Test: DB error message me `password=...` daala, response ya logs me nahi aaya.
- Error par kabhi random/koi bhi ad nahi: load error => 503; record error => 503, charge nahi. Topic ki category me outage ho toh fallback par chhalang nahi lagti (503).
- Purana `lib/ads/match.ts` + SQL `match_contextual_ad` (jisme `random()` hai) production flow me import hi nahi hota (source-scan test). Service-role-only hai. Hataya nahi.

## Zimmedari ka batwara (Revive Adserver)

- Ye code sirf: authorize -> select -> `record_ad_serve` (serve log + budget). Impression/click tracking is code me nahi hai aur maine kuch nahi badla.
- Revive Adserver integrated NAHI hai, maine maana bhi nahi. Test check karta hai ki `lib/ads` me revive/impression/click tracking ka koi code nahi, aur ek normal serve sirf 3 DB functions chhoota hai.
- Abhi charge "serve" par lagta hai (purana NOTE). Revive tracking aane par billing ka aadhar badalna alag decision hoga.

## Tests

- Naya: `tests/ads/day11-part4-ranking.test.ts` (57 tests): ranking key, ties, permutations, no-random, rotation, relevance gate, ineligible-best-vs-worse-eligible, exclude list, bug fix (before/after), fallback tiers, har no-fill case (dono routes), failures (3 RPC, exception, garbage), leaks, separation.
- Mutation: fix hataya => 1 test fail; tie-break ulta kiya => 3 fail.
- Poora suite: 1804 tests, 1803 pass, 1 fail (purana: publisher guide ka TypeScript example compile, `@types/node`/`next` nahi hone se). Aapke laptop/CI par `npm install` ke baad dekho.
- Nahi chala: `next build`, `tsc --noEmit`, asli Supabase DB tests (koi SQL badli hi nahi).

## Jaan-boojh kar nahi badla (known)

- Record ka "unauthorized" aur "rejected" DB se ek jaise "rejected" aate hain, isliye key usi pal revoke ho toh max 2 bekaar extra record calls ho sakte hain (sirf tab). Result phir bhi safe no-fill hai.
- Exclude list: topic ka repeat ad, fallback ke fresh ad se upar rehta hai (relevance tier pehle). Agar aap chahte ho ki fresh fallback > repeat topic ad, toh ye policy change hai: bataiye.
- `load_ad_candidates` me daily-budget SQL me nahi dekhte (TypeScript + record dekhte hain). 200 se zyada creatives par measure baaki (Day 8 F5).
