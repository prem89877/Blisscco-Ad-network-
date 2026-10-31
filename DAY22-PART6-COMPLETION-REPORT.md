# Day 22 Part 6 – Revive fallback attached to the match endpoint (flag OFF by default)

Date: 2026-10-31. No secret, env value or URL is printed here.

## 1. What changed
| File | Change |
|---|---|
| `lib/ads/fallback-provider.ts` | + `publicAdFromFallbackFill(fill)`: provider fill → `extractReviveCreative` → `buildProviderAdResponse` → public response or `null`. Never throws. |
| `lib/ads/service.ts` | + `serveMatchForPublisher(keyHash, request)` and type `MatchServeOutcome`. Calls `serveAdWithFallbackForPublisher`; Blisscco result passes through unchanged; a provider fill becomes `{ kind: "provider_ad", response }` or plain `no_fill`. `serveAdForPublisher` is unchanged. |
| `lib/ads/match-handler.ts` | Calls `serveMatchForPublisher` instead of `serveAdForPublisher`; new `case "provider_ad"` returns `result.response` (200). The file still names no Revive/fallback/mapper. |
| `app/dashboard/publisher/guide/page.tsx` | Panel 7a last bullet: now says attached but off unless Blisscco enables it, and never applies with an `Idempotency-Key`. |
| `tests/ads/day22-part6-match-wiring.test.ts` | NEW, 29 tests (mocked DB + mocked fetch). |
| `tests/ads/publisher-guide.test.ts`, `tests/ads/day22-part3-fallback-routing.test.ts` | One "not attached" assertion each updated to the new reality. |
| `tests/ads/day22-part1/2/4-*.test.ts` | Test titles only (wording). Assertions unchanged. |

NOT changed: SQL, migrations, ledger, payout, revenue share, billing, publisher `PublicAd` fields, click/impression code, `.env*`, `package.json`, workflows.

## 2. Behaviour
- Flag unset / not exactly `"true"` → identical to before; provider never called.
- Blisscco ad exists → served and charged as before; provider never called.
- Blisscco `no_fill` + flag ON + safe fill → `200 { fill:true, sponsored:true, ad:{id,headline,body,cta_text,destination_url} }`, id `revive_xxxxxxxx`, **no `tracking`**, no serve record, no charge.
- Any provider failure / unsafe creative → `200 { fill:false }`.
- 401, 429, sensitive topic, request with `Idempotency-Key` → provider never called.

## 3. Verification (this sandbox)
- No npm registry, so no `npm ci`/`next build`/ESLint. Tests were run on a `tsc` transpile (diagnostics are only missing-package/`@types/node` ones, none in changed files).
- New suite: **29/29 pass**. Whole project: **3566 tests, 3565 pass, 1 fail**. The 1 fail (`publisher-examples` "example compiles with no type errors") also failed BEFORE Part 6 and is caused by missing `@types/node` here; it should pass in a normal install.
- Real PostgreSQL, a real Revive/GitHub Pages request and a deployed Blisscco: **NOT tested**.

## 4. Known limit to decide (important)
The guide and both publisher examples send a fresh `Idempotency-Key` on EVERY request, and the fallback is deliberately skipped for such requests (Part 3 rule). So a publisher following the guide will never get a provider ad. Live test with plain `curl` WITHOUT that header. Allowing fallback with an Idempotency-Key (provider fill is not idempotent; no charge involved) is a separate decision for Part 7.

## 5. Live test (Preview deployment only)
Server env: `REVIVE_FALLBACK_ENABLED=true`, `REVIVE_DELIVERY_URL=<ad.json URL>`, `REVIVE_RESPONSE_FORMAT=json`. Redeploy. Call `POST /api/v1/ads/match` with `{"topic":"<topic with no campaign>"}` and no Idempotency-Key.
