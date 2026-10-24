# Day 5: contextual CATEGORY matching module

Ye guide naye module `lib/ads/category-matching.ts` ka hai. Pehle section 1 padho: kya chala, kya NAHI.

## 1. Kya chala aur kya NAHI (sach-sach)

Is sandbox me chala (asli result):
- Strict TypeScript check (naye + purane `lib/ads` files + route + tests): 0 errors. Main `tsconfig.json` ki settings par bhi 0 errors.
- `npm test`: **180 tests, 180 passed, 0 failed.**
  - 151 naye tests: category normalize/resolve, invalid input, sensitive/unsupported, taxonomy vs SQL seed, publisher authorization, eligibility rules, deterministic ordering, exclude/repeat, no-match, privacy output, module independence.
  - 29 purane Day 5 ke tests (pehle sirf ad-hoc chalaye gaye the, ab file me save): request validation, API key helper, database-jawab parser, `matchAd` pul, aur `/api/ads/match` route handler (401/413/415/400/200/429/503) **nakli database ke saath**.
- Mutation check: jaan-boojh kar code todkar dekha (sensitive check hatana, publisher status ignore, substring match, budget boundary, random order, exclude ignore, end-date ignore, tie-break hatana). Har tod par test fail hua. (Ek tod pehle bach gaya tha; uske liye naya test jodna pada.)

NAHI chala (sandbox me internet, Postgres, Next.js, Supabase nahi hai):
- `npm install`, `next build`, Vercel deploy.
- `supabase/sql/day-5-5-matching-tests.sql` ke M1 se M27 (SQL tests): inhe tum Supabase SQL Editor me ek-ek karke chalao. Jab tak expected result khud na dekho, **pass mat maano**.
- Asli API call asli publisher key ke saath, aur mobile/browser testing.
- Route ke tests nakli database par hain: wo route ka logic prove karte hain, database function ka nahi.

## 2. Schema jo maine dekha (koi change nahi kiya)

Maine `campaigns`, `ad_creatives`, `advertisers`, `profiles`, `publishers`, `ad_categories`, `creative_serve_daily`, `campaign_spend_daily` aur `match_contextual_ad` padha.

**Koi migration / mapping table nahi chahiye, koi SQL file badli nahi.** Wajah: `ad_categories` (day-5-1) pehle se controlled taxonomy hai aur `campaigns.category` uski foreign key hai.

Module sirf ye maujooda fields use karta hai: `ad_creatives` (id, headline, body, cta_text, destination_url, status), `campaigns` (id, category, status, start_date, end_date, total_budget, daily_budget), `advertisers.status`, `profiles.status`, `campaign_spend_daily` (kharch), `creative_serve_daily` (aaj ke serves).

Jo fields database me **nahi** hain, maine banaye bhi nahi: campaign priority, keyword targeting, publisher-wise allowed topics, weights. Isliye "barabari" par tie-break `priority` se nahi, neeche wale ordering se hota hai.

## 3. Taxonomy

- Canonical slugs: `lib/campaigns/constants.ts` `CATEGORY_OPTIONS` (developer_tools, education, finance, fitness, food, gaming, lifestyle, technology, travel). Wahi list DB table `ad_categories` me hai. Ek test dono ko compare karta hai (code vs `day-5-1-categories.sql`), isliye alag-alag hone par test fail hoga.
- Aliases sirf **code** me hain (`lib/ads/taxonomy.ts`), jaise `games -> gaming`, `tech -> technology`. Database me hamesha canonical slug hi jaata hai. Naya alias jodne ke liye migration nahi chahiye.
- `beauty` legacy hai (inactive): signal me aaye toh unsupported.
- Sensitive terms (health, religion, politics, sexuality, ...) alag reason `sensitive_category` se reject. Ye list sirf "reject" ka safety-net hai; allow sirf taxonomy se hota hai. Nayi category jodte waqt sensitive topic kabhi mat jodna.

## 4. Module kaise kaam karta hai

`matchCategorySignal(signal, candidates, ctx)` -> teen me se ek (kabhi throw nahi karta):

| Result | Matlab |
|---|---|
| `rejected` + reason | publisher active nahi, ya category invalid / sensitive / unsupported, ya ctx galat |
| `no_match` | signal theek hai par koi eligible creative nahi (safe no-fill) |
| `matched` | `selected` + deterministic order me saare eligible `candidates` |

Normalization (sirf formatting): NFKC, trim, lowercase, space/hyphen -> `_`. Newline, tab, emoji, zero-width, non-ASCII, punctuation = reject. Max 100 raw / 50 normalized chars, max 3 shabd. Isliye poori conversation ya sentence **reject** hota hai; match hamesha **exact** slug/alias par hota hai, substring par kabhi nahi. (`__proto__`, `constructor` jaise naam bhi match nahi hote.)

Eligibility (DB function `match_contextual_ad` jaisi): creative approved, campaign active, `category ===` signal, advertiser aur uska profile active, start_date <= aaj <= end_date, total aur daily budget me ek impression ki jagah.

Deterministic order (barabari me): aaj sabse kam serve hua campaign -> sabse kam serve hua creative -> campaign id (a-z) -> creative id (a-z). `random()`, clock, network kuch nahi. Input array/objects badalte nahi. `excludeCreativeIds` ke alternative ho toh unhe chhodta hai, warna repeat (`repeat: true`).

`toPublicAd(candidate)` publisher ko dene layak sirf 5 fields deta hai (id, headline, body, ctaText, destinationUrl). Candidates (advertiser/campaign/budget wale) kabhi publisher ya browser ko mat bhejna.

Independence: module me database, `fetch`, `process.env`, clock, random, AI call, browser API **nahi** hai. Ek test source code padhkar ye check karta hai.

## 5. Abhi jaan-boojh kar kya NAHI kiya

- Module abhi `/api/ads/match` route se **jura nahi hai**. Route abhi bhi DB function `match_contextual_ad` par chalta hai (jo ab bhi `random()` se rotation karta hai).
- Wajah: jodne ke liye server-side candidate loader (service-role) chahiye, aur DB function ek hi transaction me auth + rate limit + serve log karta hai; use bina soche hataana Day 5 ki security ko kamzor karta hai. Ye alag, soch-samajh wala step hai.
- Next step ke options (tum batao): (a) DB function ka `random()` hata kar wahi deterministic order SQL me lana (migration: pehle explain karunga), ya (b) route me candidate loader + ye module lagana. Dono me pehle plan, phir code.

## 6. Tests kaise chalayen

Android par terminal nahi hota, isliye ye laptop, GitHub Codespaces ya kisi CI par:

    npm install
    npm test

`npm test` = `tsc -p tsconfig.test.json` (strict compile) + Node ka built-in test runner. Koi naya package nahi lagta. Output me `# pass 180`, `# fail 0` aana chahiye. Tests asli Supabase ko nahi chhute.

## 7. Files

Naye: `lib/ads/taxonomy.ts`, `lib/ads/category-matching.ts`, `tests/register.cjs`, `tests/ads/category-matching.test.ts`, `tests/ads/request-and-route.test.ts`, `tsconfig.test.json`, `DAY5-CATEGORY-MATCHING.md`.
Badli: `package.json` (sirf `test` script), `.gitignore` (`.test-build`).
