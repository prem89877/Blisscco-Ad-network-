# Day 14 | Part 5 : Financial flow tests (ledger, earnings, payout, retries)

**Koi app code / SQL / package.json nahi badla.** Sirf tests add hue. SQL kisi database par CHALAYI NAHI GAYI.
Database NAKLI hai (FakeAdDb + ledger/payout SQL ka MODEL). Asli ya production Supabase kabhi nahi chhuta.

## Files (4)
- `tests/ledger/day14-part5-financial-flows.test.ts` (naya, 55 tests)
- `tests/ledger/financial-model.ts` (naya: ledger + payout SQL ka stateful model, grants ke saath)
- `tests/ads/fake-ad-db.ts` (chhota change: `onServeRecorded` hook, ledger fail par poora serve rollback; hook na ho toh purana behaviour)
- `DAY14-PART5-FINANCIAL-TESTS.md`

## Prompt 1 : kya cover hai
1. **Duplicate financial ops**: ek serve = 1 charge + 1 earning + 1 platform row (split = charge); writer dobara chale toh no change; reversal/adjustment same key = duplicate, alag key/amount = conflict; parallel retries = 1 row; reversal budget wapas nahi deta.
2. **Publisher ownership**: har publisher sirf apna balance/requests dekhta hai; form se publisherId/status forge nahi hota; smuggled publisher id ignore; suspended/pending publisher request nahi kar sakta; grants (publisher ledger admin functions nahi chala sakta, service-role payout functions nahi).
3. **Admin-only transitions**: publisher/advertiser/logged-out/suspended admin approve/reject/paid nahi kar sakte (page gate + DB 42501); requested -> approved -> paid; skip/repeat/paid ke baad badlav sab refuse; reject ko reason chahiye; self-review guard; audit actors sahi.
4. **Available balance**: available se zyada refuse (real available dikhta hai); ek hi open request; 3 parallel requests = 1; same key retry = duplicate; reject release karta hai, paid permanent ghatata hai; reversal/negative adjustment ke baad available 0 (negative nahi), approve/paid "insufficient"; summary hamesha reconcile.

## Prompt 2 : kya cover hai
No-fill, DB "rejected", DB outage, ledger-write failure (poora serve rollback, token nahi), bad key/body/topic/rate-limit, budget khatam, daily cap, Idempotency-Key retries (sequential + parallel), pause ke baad retry, do publishers ek key text, pehla candidate reject / doosra record = 1 charge, duplicate impressions/clicks, click-before-impression, forged ref, tracking DB failure + retry, 80-step mixed run. **Sab me ledger rows aur budget ya toh badalte nahi, ya sirf EK baar badalte hain**; har jagah `charges == spend` aur `earning + platform == charge` check hota hai.

## Jo mila / limit
- Koi app bug nahi mila.
- **Idempotency-Key ke bina retry = nayi billable serve** (design aisa hi hai; test ise pin karta hai). Safe retry ke liye key bhejna zaroori hai.
- Parallel tests ek hi Node process me serial chalte hain: Postgres ka asli lock/race yahan SAABIT NAHI hota. Uske liye denim par SQL tests + 2-session race check baaki (Day 13 Part 6 ka note).
- Tests ko mutation se bhi dekha (9 galat badlav: sab pakde gaye).
