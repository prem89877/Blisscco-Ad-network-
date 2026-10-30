# Day 13 | Part 2 | Financial ledger service

**Status:** code + SQL likhe gaye, TypeScript tests chale (local). **SQL kisi database par CHALAYI NAHI GAYI** (sandbox me Postgres nahi; Supabase par SQL chalane se pehle tumhari approval chahiye). SQL ke asli behaviour ka saboot sirf rollback-only file `day-13-6` ke chalne par milega.

## Kya banaya (aur kaise)

| Zaroorat | Kaise |
|---|---|
| Server-only ledger service | `lib/ledger/ledger-db.ts` (`import "server-only"`, service-role sirf `createAdminClient()` ke andar). Sirf 2 kaam: `reverseLedgerEntry`, `addLedgerAdjustment`. |
| Trusted server operations se hi entry | Advertiser charge / publisher earning / platform revenue TypeScript se likhi hi nahi ja sakti. Wo `record_ad_serve` ke andar (DB ke apne data se) banti hai. Client / API ki koi amount ledger tak nahi pahunchti. |
| Retry par dobara charge nahi | (1) retry par `record_ad_serve` ka 3-arg part chalta hi nahi (`replay_serve` pehle lautati hai, Day 9 jaisa). (2) Ledger me ek serve + ek type = ek entry (unique index). (3) Wahi idempotency key + alag payload = error, chup-chaap nahi. |
| Exact decimal | TypeScript: BigInt "units" (1 unit = 0.0001 USD), `lib/ledger/decimal.ts`. SQL: `numeric`. Float / `Number()` / `toFixed` kahin nahi (test se pakda jata hai). |
| Atomic | Ledger likhna `record_ad_serve` ke usi transaction me hai. Ledger me koi bhi error => spend, serve log, daily counter sab rollback. Admin wrappers me galti par koi aadhi row nahi. |
| Reversal / adjustment | Nayi row hi banti hai (purani par UPDATE / DELETE / TRUNCATE trigger se band, Part 1). Sirf **active admin profile** kar sakta hai. |
| Billing basis + Day 9 budget | Charge abhi bhi **serve** par, CPM / 1000. `record_ad_serve` (3-arg) = Day 12 ka function + **sirf ek line**. Ledger ki amount = wahi `v_unit` jo `campaign_spend_daily` me gayi. Ledger `campaign_spend_daily` ko kabhi nahi chhuta => budget dobara nahi ghatta. |

## Revenue rules jo ASAL me implement hue

1. **Ledger default me BAND hai** (`ledger_settings.ledger_enabled = false`). Migration chalane se serve ka behaviour bilkul nahi badalta.
2. **Charge:** `advertiser_charge` = `greatest(round(cpm_usd / 1000, 4), 0.0001)` (half-up). Ye wahi amount hai jo spend me jaati hai. (Pehle se tay rule, mera banaya nahi.)
3. **Publisher / platform ka batwara:** `ledger_settings.publisher_share_bps` (basis points, 7000 = 70%). **Default KHALI (NULL) hai. Koi percentage project me defined nahi tha, isliye maine koi nahi daala.** NULL ho toh sirf `advertiser_charge` likhti hai, earning / platform_revenue kuch nahi.
4. **Agar bps set ho:** `publisher_earning = TRUNCATE(charge x bps / 10000, 4 decimal)`, `platform_revenue = charge - publisher_earning`. Jodh hamesha charge ke barabar (paisa na bante na ghat'te). Jo entry 0 nikle wo nahi banti (ledger me 0 mana hai): bahut chhoti charge par publisher ko 0 aur platform ko poora.
5. Bps badalne ka asar sirf **aage ki** serves par. Purani entries kabhi nahi badalti. Koi backfill nahi.

## Business faisle jo ABHI BAAKI hain (maine tay nahi kiye)

1. **Publisher ka hissa kitna?** (`publisher_share_bps`). Jab tak khali, publisher ki kamai ledger me nahi bantti.
2. **Rounding ka paisa kiska?** Maine: publisher side neeche round, bacha hua platform ka. Alag chahiye (jaise half-up) toh batao.
3. **Reversal par campaign ka budget wapas mile ya nahi?** Abhi **nahi** (reversal sirf ledger me hai; `campaign_spend_daily` nahi chhuta). Refund par budget wapas dena ho toh alag, jaan-boojh kar approve kiya hua badlav chahiye.
4. **Impression / click par charge?** Abhi nahi, charge sirf serve par (Day 12 ka faisla jaisa tha).
5. **Purana kharch (ledger se pehle ka)?** Backfill nahi kiya: har serve ki apni amount save nahi hai.
6. **Adjustment ki upar ki seema** (max amount) koi nahi lagayi; sirf numeric(14,4) ki seema.

## Bug jo mila aur theek kiya (bina approval ke, jaisa kaha tha)

- **`private.ledger_append` (Part 1):** 4 se zyada decimal wali amount (jaise 0.00005) column me chupchap round ho jaati thi, aur wahi retry galat "conflict" dikhati. Ab `ledger_invalid_amount` se refuse (NULL aur numeric(14,4) se badi amount bhi). Fix `day-13-4` me.

## Files

**Naye:** `lib/ledger/decimal.ts`, `lib/ledger/revenue-share.ts`, `lib/ledger/validation.ts`, `lib/ledger/ledger-db.ts`, `supabase/sql/day-13-4-ledger-service.sql` (migration), `day-13-5-ledger-service-verify.sql` (read-only), `day-13-6-ledger-service-tests.sql` (rollback-only, sirf TEST), `tests/ledger/day13-part2-service.test.ts`, is file.

**Badle:** `tsconfig.test.json` (lib/ledger test build me), `lib/supabase/admin.ts` (sirf comment), aur 4 purane tests ki allowlist: `day13-part1-ledger`, `day10-part6-final`, `part3-hardening`, `day12-part1-architecture` (naya server file / naye SQL files ko allow karne ke liye).

## SQL chalane ka tareeka (approval ke baad)

1. **denim (test):** `day-13-1` (agar pehle nahi chali) -> `day-13-2` -> `day-13-4` -> `day-13-5` (sab PASS) -> `day-13-6` (sab PASS).
2. **Asli:** `day-13-4` -> `day-13-5`. (`day-13-6` asli par NAHI.)
3. Ledger ON karna alag step hai (migration ke header me likha hai). Pehle denim par, business faisle ke baad.
