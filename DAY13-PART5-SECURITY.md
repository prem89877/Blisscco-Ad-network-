# Day 13 Part 5: financial security (ledger / earnings / payouts)

SQL kisi database par chalayi NAHI gayi hai (sandbox me Postgres nahi; asli aur denim dono par approval ke bina kuch nahi chala).

## Audit me pehle se theek tha (kuch badla nahi)
- Saare money tables (ledger, settings, payout requests, payout events) par RLS on, koi policy nahi, anon/authenticated/service_role se saare grant hata.
- Publisher / advertiser ledger ya payout rows seedha likh hi nahi sakte; earnings aur payout functions `auth.uid()` se ownership nikalte hain (id parameter nahi).
- Admin payout functions `private.is_admin()` pehle check karte hain; transitions + audit DB trigger me; ek publisher ka ek hi khula request; retry key unique.
- Ledger append-only (UPDATE/DELETE/TRUNCATE band), idempotency key unique, ek serve par ek entry type.
- Amount exact decimal text (float nahi), USD only, 4 decimal se zyada refuse.
- Service-role key sirf `lib/supabase/admin.ts` (server-only); client / public API me nahi.

## Jo asli gap mile aur fix hue
1. **Settings (revenue share, ledger on/off, CPM) chupchap badal sakti thi, row delete par default par laut jaati thi.**
   Fix: `financial_settings_history` (append-only) + har badlav par trigger + delete/truncate band. (day-13-12 A, B)
2. **Admin ledger service (`lib/ledger/ledger-db.ts`) actor ka bharosa caller par karti thi** (service-role se chalti hai).
   Fix: har reversal/adjustment se pehle login session se verify: active admin + actor id match, warna `forbidden`, database call nahi. Abhi koi UI caller nahi hai, isliye aaj exposure nahi tha; ye aage ke liye deewar hai.
3. **Payout guard (defense in depth):** requester sirf publisher ka apna profile; 'paid' par review details nahi badal sakti; requester khud approve/pay nahi kar sakta. (day-13-12 C)

## Manual migration steps (approval ke baad, pehle TEST/denim)
1. `day-13-12-financial-security.sql`
2. `day-13-13-financial-security-verify.sql` (har row PASS)
3. Sirf denim par: `day-13-14-financial-security-tests.sql` (rollback-only)
Asli project par sirf 1 aur 2.

## Tests
`tests/ledger/day13-part5-ledger-actor.test.ts`, `tests/payouts/day13-part5-security.test.ts` (+ `ledger-session-stub.ts`; `day13-part2-service.test.ts` me ek import line).
