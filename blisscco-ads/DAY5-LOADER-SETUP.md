# Day 5: candidate loader (read-only) setup

Ye guide `DAY5-SELECTION-LAYER.md` ke section 3(a) aur 9(a) ko poora karti hai (loader migration ab likhi gayi hai).

## 1. Kya chala aur kya NAHI (sach-sach)

Is sandbox me chala (asli result):
- Strict TypeScript check (purani + nayi matching files, loader, parser, tests): 0 errors.
- Matching tests: **259 tests, 259 passed, 0 failed** (151 category-matching + 68 selection + 40 naye loader tests).
- Mutation check: jaan-boojh kar tod kar dekha (status check hatana, galat rpc naam, client file me admin client import, `authenticated` ko grant). Har tod par test fail hua.

NAHI chala:
- **`day-5-6-load-candidates.sql` aur `day-5-7-load-candidates-tests.sql` kisi database par nahi chale** (sandbox me Postgres nahi). Jab tak tum Supabase me L1 se L10 chalakar expected result na dekho, ye function tested nahi maano.
- `tests/ads/request-and-route.test.ts` (purane 29 tests) is sandbox me nahi chalte. Poora `npm test` tumhe chalana hai. Expected: `# pass 288` (180 + 68 + 40), `# fail 0`.
- `npm install`, `next build`, Vercel deploy, asli API call.

## 2. Kya bana

- `supabase/sql/day-5-6-load-candidates.sql`: `public.load_ad_candidates(p_category, p_today)`. Read-only, `security definer`, `search_path = ''`, execute sirf `service_role`. 19 columns, advertiser ka naam/email/profile id nahi. Category slug-format + active ho, `p_today` UTC aaj se +-1 din ke andar ho, warna khali result. Max 200 rows, selection strategy jaise order me.
- `supabase/sql/day-5-7-load-candidates-tests.sql`: L1 se L10 (active, paused, expired, future-dated, unapproved creative, galat category, kharch + serve counts, door ki date, anon/authenticated forbidden, columns).
- `lib/ads/candidate-rows.ts`: rows -> `AdCandidate` (pure). Galat status/shape wali row chhod di jaati hai.
- `lib/ads/candidate-loader.ts`: `loadAdCandidates` (`server-only`). Sirf `load_ad_candidates` rpc chalata hai. Error par generic error, log me sirf error code.

## 3. Deploy order

1. Supabase SQL Editor: `day-5-6-load-candidates.sql` ek baar chalao. Neeche ke 2 Check queries chalao (1 row, security_definer = true; grantee sirf service_role aur postgres).
2. `day-5-7-load-candidates-tests.sql`: pehle day-3-6 ka SETUP block chala hona chahiye. Har L-block alag chalao. L9 me ERROR expected hai.
3. Vercel me kuch naya nahi: `SUPABASE_SECRET_KEY` Day 5 se pehle hi set hai.
4. Code push karo.

## 4. Abhi route se jura nahi hai

`/api/ads/match` ab bhi `match_contextual_ad` par chalta hai. Loader tabhi route me lagega jab serve counts aur kharch ka plan tay ho (`DAY6-SERVE-AND-SPEND-PLAN.md`). Tab tak `spendTracking` hamesha `"unavailable"` rakhna.

## 5. Files

Naye: `supabase/sql/day-5-6-load-candidates.sql`, `supabase/sql/day-5-7-load-candidates-tests.sql`, `lib/ads/candidate-rows.ts`, `lib/ads/candidate-loader.ts`, `tests/ads/candidate-loader.test.ts`, `DAY5-LOADER-SETUP.md`, `DAY6-SERVE-AND-SPEND-PLAN.md`.
Badli: `lib/supabase/admin.ts` (sirf comment).
