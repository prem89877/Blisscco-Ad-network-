# Day 5 (Part 5): matching engine ka test suite

## 1. Kya chala aur kya NAHI (sach-sach)

Is sandbox me chala (asli result):
- `tsc -p tsconfig.test.json` (strict): 0 errors.
- Poora suite: **393 tests, 393 passed, 0 failed**. Isme naya `tests/ads/matching-requirements.test.ts` ke 78 tests hain; baaki purane + Day 5 Part 4 ke.
- Mutation check (jaan-boojh kar code todkar): category check, expiry check, creative-approval check, paused-campaign check hatana, campaign id leak karna, request body log karna, `prompt` field allow karna, `coding_tools` alias hatana. Har tod par kam se kam ek test fail hua.

NAHI chala:
- **SQL tests** (`day-5-5`, `day-5-7`, `day-5-9`): sandbox me Postgres nahi. Ye tumhe Supabase SQL Editor me khud chalane hain.
- `npm install`, `next build`, Vercel deploy, asli API call. Sandbox me next/supabase ke chhote stubs the (asli packages nahi).
- Koi asli ad request ya production record nahi chhua gaya: sab data nakli hai.

## 2. Requirement -> test (sab `tests/ads/matching-requirements.test.ts` me)

| # | Requirement | Describe block |
|---|---|---|
| 1 | Technology -> eligible Technology campaign | `R1` |
| 2 | Coding tools -> Developer Tools (taxonomy ke andar) | `R2` |
| 3 | Gaming ko unrelated category nahi (koi fallback policy nahi) | `R3` |
| 4 | Invalid/missing category -> 400 ya no-fill | `R4` |
| 5 | Paused (aur draft/completed/...) campaigns bahar | `R5` |
| 6 | Future-dated aur expired campaigns bahar (UTC, dono seemayen inclusive) | `R6` |
| 7 | Unapproved/inactive creatives, suspended advertiser, adhoora creative bahar | `R7` |
| 8 | Eligible nahi => no-fill; error me internals nahi | `R8` |
| 9 | Publisher authorization fail => ad nahi | `R9` |
| 10 | Missing/galat credentials => 401 | `R10` |
| 11 | Selection deterministic (har input order, 100 runs, `Math.random` band) | `R11` |
| 12 | Advertiser/budget data public response me nahi | `R12` |
| 13 | Raw prompt store/log nahi hota (code + schema dono) | `R13` |

Route tests poora pipeline chalate hain (route -> auth -> category -> selection -> record) nakli database ke saath.
Database ke rows jaan-boojh kar "ganda" bhi bheje jaate hain (paused, expired...), taaki TypeScript layer ka apna filter test ho.
Schema wale tests `supabase/sql/*.sql` files padhte hain (status values, `ad_serve_log` ke columns, `load_ad_candidates` ka select list).

## 3. Jo issue mila aur theek kiya

- **Taxonomy me "coding tools" nahi tha.** Requirement 2 ke liye `lib/ads/taxonomy.ts` me `developer_tools` ka alias `coding_tools` joda. Sirf ek alias; bare `coding` jaan-boojh kar nahi (bahut broad). Ye product faisla hai: pasand na ho toh us ek shabd ko hata do aur `R2` ka `coding_tools` case hata do.
- Baaki 12 requirements me koi bug nahi mila: sab pehle se sahi chal rahe the. Is suite ne unhe ab pakka kar diya.

## 4. Android-friendly cloud environment me tests chalana (GitHub Codespaces)

Phone ke Chrome me (Desktop site on karo):
1. GitHub repo kholo -> hara **Code** button -> **Codespaces** tab -> **Create codespace on main**. VS Code browser me khulega (1-2 minute).
2. Zip ki files repo me same paths par daalo (Codespaces me file explorer se upload/drag, ya GitHub web "Upload files" phir Codespace me `git pull`).
3. Terminal (neeche **Terminal** panel; na dikhe toh menu -> Terminal -> New Terminal):

        npm install
        npm test

   Expected end: `# pass 393` aur `# fail 0` (tumhare repo me aur tests hon toh number badh sakta hai; `# fail 0` zaroori hai).
4. Sirf naya suite chalana:

        npx tsc -p tsconfig.test.json && node --require ./tests/register.cjs --test .test-build/tests/ads/matching-requirements.test.js

5. Type check: `npm run lint`.

StackBlitz bhi chalega (terminal me wahi `npm install` + `npm test`), par Node 20+ chahiye; Codespaces zyada bharosemand hai.
`.test-build/` folder tests ka temporary output hai; `.gitignore` me hona chahiye (check: `cat .gitignore`).

Koi test fail ho toh: failing test ka naam + error text bhejna.

## 5. SQL tests (Supabase me, tum chalaoge)

Order: `day-5-8-serve-functions.sql` ek baar, phir `day-5-9-serve-tests.sql` ke S1-S15 (day-3-6 ka SETUP block pehle). Har block alag; S14/S15 me ERROR expected hai. Purane `day-5-5-matching-tests.sql` (M1-M27) ab bhi valid hain (purana function chheda nahi).
