# Day 12 | Prompt 5 | Part 2 : Click reference (sirf helper)

**SQL kuch nahi chalayi, kisi Supabase project (denim test / asli) se connect nahi kiya, koi migration nahi joda.**
**Redirect route, click writer, Revive: kuch nahi bana.** Match API ka response bhi nahi badla.

## Kya bana
`lib/ads/click-ref.ts` (pure module: DB/env/server-only/logging nahi):
- `mintClickRef(config, {serveRef, publisherId, creativeId, servedAtMs, nowMs})` -> `bc1.<payload>.<sig>` (HMAC-SHA256) ya `null`.
- `verifyClickRef(ref, config, nowMs)` -> shape, signature (pehle, constant-time), strict payload, expiry. Kabhi throw nahi karta.
- `verifyClickRefForServe(ref, {config, nowMs, lookupServe, claimedCreativeId?})` -> ref + DB serve row ka milan: publisher aur creative DB se aate hain.
  `claimedCreativeId` (optional) sirf extra milan hai; galat ho toh `creative_mismatch`.

## Binding
- Payload: `v, r (serve_ref), p (publisher one-way tag), c (creative one-way tag), iat, exp`. Raw publisher/creative id, destination URL, campaign, spend: kuch nahi.
- Creative tag publisher tag se alag label se banta hai (`blisscco:click:creative:`), dono aapas me badle nahi ja sakte.
- Signing label alag (`blisscco:click:bc1:`): impression token (`bt1`) click ref nahi ban sakta aur ulta bhi.
- Expiry serve ke samay + TTL se bandhi hai (late retry purane serve ka naya ref nahi bana sakti).
- Destination URL browser se kabhi nahi li jaati; wo agle part me DB se creative ke row se aayegi.

## Environment variables
Koi naya nahi. Wahi server-only: `AD_TRACKING_SECRET` (min 32 chars), optional `AD_TRACKING_SECRET_PREVIOUS` (rotation), `AD_TRACKING_TTL_SECONDS` (60..86400). Secret `service.ts` me hi padha jaata hai; `click-ref.ts` env nahi padhta.

## Agle part ke liye (abhi nahi hua)
- Production `lookupServe` ko creative_id bhi chahiye. Abhi `lookup_serve_for_event` (day-12-7) sirf publisher_id + served_at deta hai, isliye ek naya read-only lookup SQL lagega. **Approval ke baad hi** chalega.
- Ref ko serve response me dena (`tracking` ke saath) aur redirect route: alag parts.
