# Day 12 Part 4: Impression endpoint

`POST /api/v1/ads/impression` body: `{ "token": "<tracking.token from /ads/match>", "event": "impression" }` (Content-Type: application/json, max 1 KB).

## Impression ki paribhasha
Ek impression = `ad_events` me ek `event_type='impression'` row, jo sirf tab banti hai jab:
1. token ki HMAC signature sahi ho, expire na hua ho, aur token impression ki ijazat deta ho;
2. token ka serve_ref database ke `ad_serve_log` me ho (matlab asli, kamyab serve jisme spend commit hua) aur publisher + served_at token se mile;
3. serve 24 ghante se purani na ho (DB me hard cap; token expiry usse chhoti ho sakti hai);
4. us serve ka pehla impression ho.
Serve, match API response, no-fill, page load, token milna: koi impression nahi. `record_ad_serve` ko kuch nahi badla; `ad_events` me sirf `record_ad_impression` likhta hai. Charge abhi bhi serve par; impression par doosra charge nahi (SQL me spend ka koi statement nahi, test bhi hai).

## Deduplication
`ad_events_one_per_type_key = unique (serve_id, event_type)` (day-12-2) + `INSERT ... ON CONFLICT ON CONSTRAINT ... DO NOTHING` function `record_ad_impression` me. Pehla = `recorded`, baaki (browser double callback, retry, replay, simultaneous requests) = `duplicate` (200, kuch nahi likhta). App me koi Map/Set/cache dedupe nahi (static test se bandha). Client se event id ya timestamp nahi liya jaata: occurred_at = database `now()`, serve/publisher/campaign/creative DB se.

## Errors (sab generic)
400 shape galat (reason: invalid_json/invalid_body/unknown_field/invalid_token/invalid_event), 401 `{error:"unauthorized"}` token/serve ki har galti ke liye ek jaisa (bad signature, expired, unknown serve, doosre publisher ka), 413, 415, 429 (+Retry-After), 503 `{error:"unavailable"}` (DB/config dikkat; dobara bhejna safe). Jawab me kabhi campaign/publisher/serve data nahi. Log me sirf DB error code; token, serve_ref, ids, IP nahi.

## Rate limit
Per-IP in-memory: 300 requests/min aur 30 galat-token/min (best-effort, har server instance alag). DB ki taraf se bhi seema: ek serve par ek hi impression ban sakta hai. Pakki rok ke liye Vercel Firewall rate-limit rule lagao.

## CORS (faisla chahiye)
Project ka niyam "no wildcard CORS anywhere" (test se bandha) isliye CORS nahi hai: token publisher ke server se (ya same-origin proxy se) aana chahiye. Doosre origin ka browser seedha POST nahi kar sakta. Seedha browser beacon ke liye publisher-wise origin allowlist chahiye (schema me abhi nahi).

## SQL (CHALAYI NAHI GAYI)
Order: `day-12-7-record-ad-impression.sql` -> `day-12-8-impression-verify.sql` (read-only, sab PASS) -> `day-12-9-impression-tests.sql` (rollback-only, sirf TEST project). `day-12-3-event-verify.sql` me ek check badla (ab "sirf record_ad_impression likh sakta hai"). Pehle denim (test), phir asli par.
