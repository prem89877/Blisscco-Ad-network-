# Day 14 | Part 4 : Integration tests

**Naya file:** `tests/ads/day14-part4-integration.test.ts` (64 tests). Koi app code / SQL / package.json nahi badla. `npm test` ise apne aap chalata hai.
Database NAKLI hai (FakeAdDb + SQL ka model). Asli ya production Supabase kabhi nahi chhuta.

## Kya cover hai
1. **Campaign creation** (`createCampaign`): valid form, advertiser id database se (form se nahi), status form se nahi, invalid input, inactive advertiser, db error.
2. **Eligibility**: draft -> review -> active pipeline; 18 cases (campaign/creative status, dates, budget, advertiser) jo route ke fill/no-fill aur `deliveryState` dono se match karte hain.
3. **Publisher auth**: missing/malformed/unknown/revoked/expired key, pending/suspended publisher/profile (sab ek jaisa 401), rate limit, publisher id caller se nahi.
4. **Contextual match**: topic, alias, fallback_topics, exclude_ad_ids (soft), sensitive topic, free-text reject.
5. **Successful serve**: exact response shape, ek unit charge, tracking opt-in, Idempotency-Key.
6. **No-fill / safe failure**: koi candidate nahi, race (rejected), db outage = 503.
7. **Impression route** (`POST /api/v1/ads/impression`): recorded, duplicate (parallel bhi), spend nahi badalta, 10 tarah ke invalid token (ek jaisa 401), shape errors (400/413/415), rate limit, 503 safe failure + retry, logs me token/serve_ref nahi.
8. **Click route** (`GET /api/v1/ads/click`): 302 + safe headers, duplicate, click-before-impression (D4: redirect, count nahi), invalid ref (ek jaisa 404), query strictness, 405 methods, prefetch 204, ineligible creative, unsafe destination, rate limit, 503 safe failure + retry.

## Jo implement NAHI hai (isliye assume nahi kiya)
- Match response me click ref (`bc1...`) nahi aata. Click tests ref ko `mintClickRef()` se banate hain. Ek test is "abhi nahi aata" ko pakadta hai; jab ye feature aaye, wo line update karni hai.
- Impression/click par charge nahi hota; test yahi dikhata hai.

## Limit
Ye SQL ke MODEL par chalte hain. SQL ka asli test `tests/integration/*` (TEST database) me hi hai.
