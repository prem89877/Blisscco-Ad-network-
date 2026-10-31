# Day 22 Part 7 – Delivery endpoint contract + Idempotency-Key decision

## 1. Code decision (done)
`fallbackAllowedFor` no longer blocks requests that carry an `Idempotency-Key`. Reason: the guide and both publisher examples send one on EVERY request, so with the old rule no guide-following publisher could ever receive a provider ad. Money safety is unchanged: a provider fill has no serve record, no charge, no tracking. A keyed retry still runs Blisscco's own serve first, so an already-served ad is replayed (charged once) and the provider is not called.
Trade-off (documented in the guide): a provider ad is not idempotent. If Blisscco no-fills twice for the same key, two requests can show two different provider ads. If the original Blisscco ad became ineligible before a retry, the retry may show a provider ad instead of a no-fill.
Still blocked: sensitive topics (topic or fallback_topics).

## 2. What REVIVE_DELIVERY_URL must return (unchanged contract)
HTTPS GET, no redirects, 2xx, `Content-Type: application/json`, body <= 65536 bytes:
`{ "headline": string, "body": string, "cta_text": string | null (optional), "destination_url": "https://..." }`
Plain text only (no `<`, `>`, `&entity;`, control characters); keys such as `html`, `script`, `iframe`, `adm` reject the whole creative.

## 3. Options to provide that JSON (not verified against a live Revive here)
- A. Now / testing: a static `ad.json` on GitHub Pages (what you have). Fine for proving the Blisscco side.
- B. Production: a small endpoint you control (for example a serverless function) that picks a banner from Revive and answers with the JSON above. A stock Revive delivery tag returns HTML/JavaScript, which Blisscco rejects on purpose. The real Revive response format is NOT verified in this repository; verify it manually before building B.
- C. Moderation happens on the Revive/endpoint side. Blisscco only decides whether to call it.

## 4. Live test checklist (Preview deployment)
1. Env (server only): `REVIVE_FALLBACK_ENABLED=true`, `REVIVE_DELIVERY_URL=<ad.json URL>`, `REVIVE_RESPONSE_FORMAT=json`. Redeploy.
2. Pick a topic with NO approved Blisscco campaign (or pause test campaigns).
3. `curl -i -X POST https://<preview>/api/v1/ads/match -H "Authorization: Bearer <key>" -H "Content-Type: application/json" -d '{"topic":"<topic>"}'`
4. Expect 200, `fill:true`, `sponsored:true`, id `revive_xxxxxxxx`, no `tracking`.
5. Turn the flag off (or delete it), redeploy: expect `{"fill":false}` again.
