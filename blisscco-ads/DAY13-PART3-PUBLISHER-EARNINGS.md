# Day 13 | Part 3 | Publisher earnings view

**Status:** code + SQL likhe gaye, TypeScript tests chale (local). **SQL kisi database par CHALAYI NAHI GAYI** (Supabase par chalane se pehle tumhari approval chahiye). SQL ke asli behaviour ka saboot sirf rollback-only `day-13-8` (denim par) chalne par milega.

## Kya banaya
Page: `/dashboard/publisher/earnings` (publisher-only, server-rendered). Publisher page par "View earnings" button.

## Ownership (har query par, server-side)
- `financial_ledger` par kisi role ko grant nahi (service_role ko bhi nahi), isliye app seedha padh hi nahi sakta. Naya SQL `day-13-7` me 2 read-only security-definer functions (day-12-12 jaisa pattern).
- Dono functions publisher ko `auth.uid()` se khud nikalte hain (publisher -> profile, profile **active**). **Publisher id kabhi parameter me nahi aati**, isliye doosre ki id bhejne ka raasta hi nahi.
- Advertiser / admin / anon / suspended profile / publisher-row-nahi => 0 rows. `anon` aur `service_role` ko EXECUTE nahi. Service-role key is feature me use nahi hoti.
- Entries me kabhi nahi: advertiser_id, campaign_id, serve reference, created_by, reason, publisher_id.

## Kaunse figures asli me supported hain
| Figure | Status | Source |
|---|---|---|
| Total earned | Supported | `publisher_earning` entries ka jod |
| Adjustments | Supported | publisher account ke `adjustment` (signed) |
| Reversals | Supported | publisher account ke `reversal` (negative) |
| Ledger balance | Supported | earned + adjustments + reversals (exact milan; na mile toh error). **Payout nahi**, sirf record total |
| Recent entries (25) | Supported | date, type, amount |
| **Pending earnings** | **Supported NAHI** | schema me status hi nahi |
| **Approved earnings** | **Supported NAHI** | schema me approval state hi nahi |
| **Paid out** | **Supported NAHI** | koi payout entry-type nahi |

Pending / approved / paid page par "Not tracked yet" dikhte hain, kabhi 0 ya demo number nahi.

## Honest states
- Ledger band (`ledger_enabled = false`) aur koi entry nahi => figures **nahi** dikhte ("not being recorded yet"), nakli 0 nahi.
- Ledger on par `publisher_share_bps` khali aur koi entry nahi => wahi, alag wajah ke saath.
- Entries hain par ab recording band => figures dikhte hain + notice.
- Database error / galat shape => error message, kabhi zero nahi.

## Paisa
USD, hamesha 4 decimal (`$0.0250 USD`, negative `-$0.0050 USD`). Database numeric ko TEXT me bhejta hai, TypeScript BigInt units me parse karta hai. Float / `toFixed` nahi.

## Business faisle jo ABHI BAAKI hain
1. `publisher_share_bps` abhi bhi khali: jab tak set nahi, publisher earnings record nahi hoti.
2. Pending / approved / paid chahiye toh pehle schema (status + payout entries) ka alag faisla chahiye.
3. Adjustment ki `reason` publisher ko nahi dikhti (internal note ho sakta hai). Dikhana ho toh alag faisla.

## Files
**Naye:** `supabase/sql/day-13-7-publisher-earnings.sql`, `supabase/sql/day-13-8-publisher-earnings-tests.sql`, `lib/ledger/earnings.ts`, `lib/ledger/display.ts`, `app/dashboard/publisher/earnings/page.tsx`, `tests/ledger/day13-part3-earnings.test.ts`, is file.
**Badle:** `app/dashboard/publisher/page.tsx` (sirf Earnings panel + link), `tests/ledger/day13-part2-service.test.ts` (Part 2 ki exact day-13 file-list ab sirf day-13-1..6 dekhti hai, taaki naye Part 3 SQL files us test ko na todein).

## SQL chalane ka tareeka (approval ke baad)
1. **denim (test):** `day-13-7` -> (Check 1 / Check 2, file ke neeche comments me) -> `day-13-8` (sab PASS).
2. **Asli:** sirf `day-13-7` + Check 1 / 2. (`day-13-8` asli par NAHI.)
