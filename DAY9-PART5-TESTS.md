# Day 9 / Part 5 : Tests (campaign create/edit, budgets, spend, concurrency, lifecycle)

Koi production code (`lib/`, `app/`, SQL) **nahi badla**. Koi purana test nahi badla/hataya. Sirf naye tests + test-DB harness.

## Pehle test framework kaisa hai
`npm test` = `tsc -p tsconfig.test.json` + Node ka built-in `node --test` (koi Jest/Vitest nahi). `tests/register.cjs` `@/` alias, `server-only`, `next/server` aur Supabase admin client ko nakli se badalta hai. Server actions ke liye `tests/campaigns/action-stubs.ts` (nakli DB). Maine yehi conventions rakhe.

## Naye test files
| File | Kya cover karta hai |
|---|---|
| `tests/campaigns/day9-part5-campaign-edge.test.ts` (63 tests) | create/edit; zero/negative/format budgets; daily > total (1 cent boundary); schedule (leap day, month/year end, 365/730 din limit, UTC, purani date edit me); name/description/category; advertiser ownership + forged ids; locked/editable statuses; stale form; DB failure (fixed message, values bache, redirect nahi); exhausted budget edit/resume; pause/resume status matrix; deliveryState boundaries |
| `tests/ads/day9-part5-spend-integrity.test.ts` (42 tests) | in-memory ledger (record_ad_serve ke niyam: row lock, total+daily, idempotency, rollback) par asli `serveAd` + `selectAd`: 20-30 concurrent requests, duplicate Idempotency-Key, failed/thrown record (koi charge nahi, key burn nahi), 11 mid-flight changes (paused/rejected/unapproved/ended/suspended/budget khatam), eligibility matrix (creative/campaign/advertiser status, schedule edges, float noise), CONTROL test (bina lock ke ledger overspend karta hai => tests race pakadte hain) |
| `tests/integration/test-db-guard.ts` + `day9-part5-guard.test.ts` (11 tests) | Guard: TEST_DATABASE_URL + TEST_DB_CONFIRM + TEST_SUPABASE_PROJECT_REF teeno chahiye, production ref/URL se match hua toh refuse, production env me refuse, DB test file me prod keys/admin client/unscoped delete nahi (static check) |
| `tests/integration/day9-part5-db.test.ts` (7 tests) | ASLI Postgres (alag TEST Supabase): concurrent `record_ad_serve`, same key 10 baar, rejected key burn nahi, paused/unapproved/ended, unknown key, spend trigger. **Env na ho toh SKIP.** |

## Separate test database kaise chalao
1. Alag Supabase project banao (production nahi). Usme `supabase/sql` ki migrations day-3 se day-9-7 tak chalao.
2. `npm i` (naya devDependency: `pg`).
3. Env: `TEST_DATABASE_URL`, `TEST_SUPABASE_PROJECT_REF`, `TEST_DB_CONFIRM=blisscco-test-db`.
4. `npm run test:integration` (ya GitHub Actions > "DB integration" > Run workflow, secrets daalkar).
Test sirf apni tagged rows banata/hataata hai (`it9p5_xxxx`).

## Jo observation mili (code nahi badla, business rule nahi badla)
Ek hi burst me sab requests same purani snapshot se same top campaign chunti hain. Uska budget khatam hone par baaki requests ko **no-fill** milta hai, doosre campaign par retry nahi hota. Paisa kabhi zyada nahi katta (test saabit karta hai), sirf fill-rate kam ho sakta hai. Naya request ho toh doosra campaign chalta hai. Chaho toh alag task me "record reject par next candidate try karo" jod sakte hain.

## Honest limits
- SQL / `pg` integration test maine **chalaya nahi** (sandbox me Postgres aur network nahi). Pehle TEST project par khud chalao; tab tak ise "pass" mat maano.
- Concurrency ke TypeScript tests ek **nakal** ledger par hain (SQL ki nakal), asli SQL ki guarantee integration test se hi milegi.
- `npm run lint`/`tsc` poora is sandbox me nahi chal paya (next/react/supabase packages install nahi ho sake). Apne PC/CI par `npm test` aur `npm run lint` chalao.
- Purani file `tests/campaigns/day9-part2.test.ts` line 388 par TypeScript 6 type error deta hai (`Record<string,string>`); runtime test pass hota hai. Maine purana test chheda nahi.
