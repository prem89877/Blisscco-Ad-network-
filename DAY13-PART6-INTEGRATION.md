# Day 13 | Part 6 | Integration: ledger + publisher earnings + manual payouts

**Status:** audit + 1 confirmed bug fix + earnings/payout page wiring + regression tests. **SQL kisi database par CHALAYI NAHI GAYI** (denim par bhi nahi, asli par bhi nahi). Isliye SQL ka asli behaviour (khaas kar lock / race) Postgres par abhi **saabit nahi hua**; sirf code padhkar aur text-tests se confirm hua hai.

## Audit: kya pehle se theek tha (kuch badla nahi)
- Charge sirf **serve** par, `record_ad_serve` ke andar. Ledger ki amount wahi `v_unit` hai jo `campaign_spend_daily` me gayi: ledger budget ko dobara nahi ghatata. `private.ledger_record_serve` poore SQL me **ek hi jagah** se bulaya jata hai (spend insert ke baad). Retry par `replay_serve` pehle lautati hai, isliye dobara charge nahi.
- Impression / click ke code aur SQL me ledger, charge ya payout ka koi zikr nahi: **dono alag hain**, koi impression billable nahi mana gaya.
- Payout: ek publisher ka ek hi khula request (partial unique index), `request_key` retry-safe, publishers row par `FOR NO KEY UPDATE` lock, `available = ledger - (requested + approved) - paid`. Do request ek hi earnings ko dobara reserve nahi kar sakte.

## Bug jo mila aur theek kiya (bina approval ke)
**Admin reversal / adjustment payout ke lock ke bahar thi.** `ledger_reverse_entry` / `ledger_add_adjustment` (day-13-4) publisher ke account par likhte waqt wo `publishers` row lock nahi leti thi jo payout functions leti hain. Isliye "Mark as paid" ki balance-jaanch aur ek reversal ke beech race ho sakti thi: paid ek aise balance par record ho jata jo ab request ko cover nahi karta. (Paisa nahi hilta, par record galat banta.)
**Fix:** `day-13-15` dono functions me, sirf `account = 'publisher'` par, wahi `FOR NO KEY UPDATE` lock pehle leti hai. Lock order hamesha publishers -> (payout | ledger insert); `record_ad_serve` sirf FK KEY SHARE leta hai jo isse nahi takraata, isliye serve ruka nahi rehta. Signatures, grants (service_role only), actor / reason / amount niyam bilkul wahi.
**Dhyan:** ye fix Postgres par chalke test nahi hua. Do-session race check denim par haath se karna baaki hai (neeche).

## Page wiring
`/dashboard/publisher/earnings` ab wahi `get_my_payout_summary` padhta hai jo Payouts page: **Available to request / In open payout request / Marked as paid**. Page apna koi payout hisab nahi karta. Summary fail ho toh ledger figures ke neeche sirf ek error line (kabhi nakli 0 nahi). Per-earning pending / approved / paid abhi bhi "Not tracked yet" (payout request poore balance par hota hai, kisi ek earning par nahi), aur note me ye saaf likha hai.

## Accounting rules jo ASAL me implemented hain
1. Advertiser charge = `greatest(round(cpm/1000, 4), 0.0001)` per serve; wahi amount budget aur ledger me.
2. Publisher / platform batwara sirf jab `ledger_settings.publisher_share_bps` set ho (abhi khali: koi percentage define nahi hai). `publisher_earning = truncate(charge x bps / 10000, 4)`, `platform_revenue = charge - publisher_earning`; 0 wali entry nahi banti.
3. Ledger append-only; galti ka ilaaj reversal / adjustment (admin only). Reversal budget wapas nahi deta (business faisla baaki).
4. Publisher ledger balance = publisher account ki saari USD entries ka jod (earned + adjustments + reversals). Payout isse **ghatata nahi**; alag table me track hota hai.
5. Impression / click se koi ledger entry nahi.

## Payout workflow status
Manual hai aur poora kaam karta hai: requested -> approved -> paid (ya rejected), admin-only approve / reject / paid, audit events. **"Paid" sirf record hai**: koi transfer, provider, bank / UPI detail nahi. Asli paisa admin Blisscco ke bahar bhejta hai.

## Naya consistency check
`day-13-16-financial-consistency-verify.sql` (read-only SELECT): per serve earning + platform = charge, bina charge ke split nahi, ek serve = ek campaign, har publisher ka balance >= reserved + paid, paid / audit trail milta hai, ek se zyada khula request nahi. `campaign_spend_daily` ka milan sirf INFO query hai (backfill nahi hua, isliye PASS / FAIL nahi).

## Tests (asli chale)
Local sandbox me (network band, `npm install` nahi chala, `next`/`react`/`@supabase` installed nahi):
- `tsc -p tsconfig.test.json` (test-build) + `node --require ./tests/register.cjs --test .test-build/tests/*/*.test.js`: **2442 pass, 0 fail** (pehle 2422; Part 6 ke 20 naye). `@types/node` / `typescript` global se symlink kiye (repo me nahi daale).
- Naya test mutation se bhi dekha: adjustment ka lock hatane par fail hota hai.
- `npm run lint` (`tsc --noEmit`): **PASS nahi**, 2784 errors, sab missing packages (next, react, supabase) ya sandbox ke node types se; naye / badle files me inke alawa koi error nahi nikla. TSX ka asli type-check yahan nahi ho paya.
- `npm run build` aur `npm run lint:eslint`: **chale hi nahi** (`next: not found`). GitHub CI (`ci.yml`) par chalane honge.

## Migrations jo manual review / approval maangti hain
1. `day-13-15-financial-integration.sql` (naya, 2 functions replace).
2. `day-13-16-financial-consistency-verify.sql` (read-only).
Pehle denim: 13-1 -> 13-4 -> 13-9 -> 13-12 (agar pehle nahi chali) -> **13-15** -> **13-16** (sab PASS). Do-session race check denim par: session A `admin_mark_payout_paid` BEGIN me rok ke, session B `ledger_add_adjustment` publisher account par; B tab tak ruka rehna chahiye jab tak A commit na ho. Asli par sirf 13-15 + 13-16 (aur `day-13-11/14` asli par nahi).

## Real-money payment se pehle baaki
1. Business faisle: publisher share %, minimum payout, hold period, fee / currency (INR), rounding ka paisa, reversal par budget refund.
2. Ledger ON karna (abhi `ledger_enabled = false`) denim par test ke baad.
3. Paid ko ledger me alag `payout` entry-type se likhna ya reconciliation tay karna; approve / paid ke liye alag admin (two-person rule).
4. Payment provider, KYC / tax, publisher ke payment details ka surakshit tareeka (abhi koi nahi liya jata).
5. Saare day-13 SQL denim par chalke PASS dekhna, concurrency (2 session) test, phir asli par.
6. CI par `npm run lint`, `npm test`, `npm run build` ka asli PASS.

## Files
**Naye (4):** `supabase/sql/day-13-15-financial-integration.sql`, `supabase/sql/day-13-16-financial-consistency-verify.sql`, `tests/payouts/day13-part6-integration.test.ts`, `DAY13-PART6-INTEGRATION.md`.
**Badla (1):** `app/dashboard/publisher/earnings/page.tsx`.
