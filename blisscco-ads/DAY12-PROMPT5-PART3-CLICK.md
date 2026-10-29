# Day 12 | Prompt 5 | Part 3 : Click redirect route

**SQL (day-12-10) kisi database par CHALAYI NAHI gayi** (na denim test, na asli). Approval ke baad hi. Jab tak na chale, route 503 deta hai (redirect kabhi nahi).
**Revive, analytics dashboard, billing, table/column badlaav: kuch nahi.** Match API response nahi badla.

## Route
`GET /api/v1/ads/click?ref=<bc1...>` (`app/api/v1/ads/click/route.ts`). HEAD/POST/PUT/PATCH/DELETE = 405.
- Query me SIRF `ref`. Koi aur parameter (url, dest, redirect, next...) = 400. Destination query/body/cookie se kabhi nahi.
- Flow: rate limit -> query check -> prefetch check (204, kuch nahi) -> `acceptClick`:
  1. ref verify (Part 2: signature, expiry, serve + publisher + creative DB se).
  2. DB lookup (`lookup_serve_for_click`) se creative ka destination + eligibility.
  3. Eligible na ho / destination ajeeb ho => redirect NAHI, click NAHI (404, generic).
  4. `record_ad_click` (atomic, ek serve = ek click). Duplicate click par redirect hota hai, par kuch naya nahi likhta.
  5. 302 -> destination (dobara jaanchi hui). Headers: no-store, Referrer-Policy: no-referrer, nosniff, noindex.
- Responses: 302 | 204 (prefetch) | 400 (query) | 404 (ref/creative/destination ki har galti EK jaisa body) | 429 | 503.

## Destination rule (`safeDestination`)
https only, <= 2048, no space/control chars, no `user@`/password, no IP, no localhost, host me dot. (Wahi `checkHttpsUrl` jo creative banate waqt lagta hai.) Parsed ASCII href par redirect.

## Click eligibility (SQL, `private.click_target`)
Wahi shart jo retry-replay me hai: creative `approved`, campaign `active` + schedule ke andar, advertiser aur profile `active`.

## Decision jo aapko confirm karna hai (D4)
Part 1 design ke default ke mutabik: **click tabhi ginta hai jab us serve ka impression pehle ho chuka ho.** Na ho toh user redirect hota hai par click nahi likhta (`not_counted`). Nahi chahiye toh `record_ad_click` me "D4" wala ek block hata do.

## SQL order (approval ke baad)
1. `day-12-10-record-ad-click.sql` (pehle denim test, phir asli). Prerequisite: day-12-1, 12-2, 12-5, 12-7.
2. `day-12-11-click-verify.sql` (read-only; sab PASS).
3. `day-12-3-event-verify.sql` aur `day-12-8-impression-verify.sql` dobara: dono me ab "doosra writer record_ad_click allowed" likha hai (warna ye purane checks FAIL dikhate).

## Blocker / baaki
- **Click ref abhi publisher ko diya hi nahi jaata.** Part 2 sirf helper tha; match response (`tracking`) me ref nahi aata. Isliye production me koi valid ref abhi exist nahi karta. Ref ko response me dena (`mintClickRef` + serve ka creative id) alag step hai, maine nahi kiya (API contract badalta).
- Impression pehle chahiye (D4) aur impression endpoint browser se cross-origin nahi chalta (no CORS), isliye publisher ke server se impression bhejna padega.
- SQL ke asli behaviour (unique constraint, eligibility join) ka rollback-only SQL test file nahi likha; sirf SQL ka text static tests se bandha hai.
