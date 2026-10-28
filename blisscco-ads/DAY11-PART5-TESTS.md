# Day 11 | Part 5 : Matching tests majboot + bugs

Status: 1 confirmed bug fix (sirf TypeScript, `lib/ads/category-matching.ts`) + 1 naya test file. **Koi SQL nahi, koi migration nahi, Supabase (denim ya asli) par kuch nahi chalaya gaya.**

## Kya mila aur kya kiya

**Confirmed bug (fix kiya):** creative ka text/URL "poora hai" check karta tha, par control characters (NUL, ESC, DEL), bidi-override characters (text ulta dikhate hain) aur URL me invisible characters (zero-width space, word joiner, BOM) pass ho jaate the. Ab ye creative `creative_incomplete` ban kar kabhi serve nahi hota. Normal text same hai: body me tab/newline allowed, emoji (ZWJ) aur accents allowed. Test ne pehle fail karke bug pakda, fix ke baad pass.

**Policy sawal (BADLA NAHI, aapka faisla chahiye):** agar publisher ki exclude list me ad A hai aur eligible fresh ad B hai, aur DB B ko record ke waqt reject kare (budget/pause race), toh abhi result `{fill:false}` aata hai, jabki A eligible hai. Purana Part 1 test pakka karta hai ki excluded creative kabhi `nextAds` me nahi aata, isliye maine isko apne aap nahi badla. Iska test likha hai aur `todo: owner decision` mark hai (chalta hai, suite fail nahi karta).

**Bug nahi nikla (jo test ne confirm kiya):** HTTP body ke shuru me UTF-8 BOM ho toh request chalti hai (standard behaviour); API `topic` me casing/space/hyphen par 400 `invalid_topic` deti hai (documented contract), jabki andar ka resolver `Gaming`, `Video Games` jaisa saaf kar deta hai. Dono jaise the waise rakhe.

## Naya test file: `tests/ads/day11-part5-hardening.test.ts` (128 tests pass + 1 todo)

- Category: har alias, koi alias do category me nahi, casing/whitespace, unknown/partial/look-alike (cyrillic), galat type, `__proto__`/`constructor`, sensitive/legacy, irrelevant category hard gate.
- Eligibility matrix (25 cases): paused/draft/completed campaign, creative pending/rejected/paused/archived, advertiser pending/suspended, profile suspended, scheduled, expired, aaj start/end (inclusive), total + daily budget (bilkul ek unit bacha / ek unit kam / zero / overspent), kharab candidates (NaN, negative, string number, galat date/id).
- Creative safety: khali/lamba text, http, `javascript:`, `user@host` URL, control/invisible characters, extra fields leak nahi.
- Selection counting nahi karti: 50 baar chalane par kuch nahi badalta, `lib/ads` me revive/impression/click code nahi.
- Dono routes (legacy + v1) par: key missing/galat format/revoked/expired/doosre publisher ki, suspended publisher/profile, malformed JSON (25 shapes), oversized (declared, chunked, multi-byte), content-type, Idempotency-Key, no-fill, har ineligible state, 3 RPC x 3 tarah ke DB errors (503, password logs me nahi), DB exception, primary topic outage par fallback nahi.
- Concurrency (nakli DB): 40 parallel, budget 5 serve => exactly 5; daily cap; 2 campaigns; 4 publishers ek budget; 10 same Idempotency-Key => 1 charge; failed requests se spend nahi badhta; sirf 3 RPC chhoote hain.
- Ranking rotation, response format (exact keys, headers, error shapes), v1 aur legacy ka body same.

## Real results (maine chalaya)

- Pehle (baseline): 1804 tests, 1803 pass, 1 fail.
- Ab: **1933 tests, 1931 pass, 1 fail, 1 todo.** Wahi 1 fail purana hai (publisher guide ka TypeScript example compile: `@types/node` install nahi). `npm install` ke baad apne laptop/CI par dekho.
- Integration (`tests/integration`): 11 pass (guard tests). Asli DB wale suites **skip** (blocked): `TEST_DATABASE_URL`, `TEST_SUPABASE_PROJECT_REF`, `TEST_DB_CONFIRM` set nahi. Isliye atomic spend ka asli SQL test is part me NAHI chala; concurrency tests SQL ke Node model par hain.
- NAHI chala: `next build`, `tsc --noEmit`, asli Supabase par kuch.

## Limit (seedhi baat)

Concurrency tests `FakeAdDb` par hain jo SQL ka model hai. SQL me asli race tabhi pakki hogi jab TEST database par integration suite chalegi.
