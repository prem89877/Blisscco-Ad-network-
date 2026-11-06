# Phase 4 - Step 3B: Rich Ad Delivery - Report

Scope: TEST / Preview only. Production untouched. No billing, payout, ledger, RLS or storage-policy change. No migration was run by me.

## What was added
- Match API: optional `brand_name`, `logo_url`, `image_url` inside `ad` (snake_case, like the existing `cta_text`). The 5 existing fields and their values are unchanged; with no rich data the response is byte-identical to before. Flag: `RICH_AD_DELIVERY_ENABLED=1` (default OFF).
- Proxy `GET /api/v1/ads/asset/[id]?kind=logo|image`: serves from the private bucket only for an approved creative, active campaign, active advertiser (+ active profile); everything else is 404 (DB outage = 503). Path ownership (advertiser + campaign + kind), real file type, size and dimensions are re-checked before serving.
- SQL `supabase/sql/phase4-step3b-1-rich-ad-assets.sql`: one read-only function `get_creative_rich_assets` (service_role only). **Must be run on TEST by you** (checks R1-R5 in the file footer).
- Upload validation: logo 64-1024 px per side; banner 600-2400 x 200-1300 px with 1.91:1 ratio (+-5%), read from real bytes (PNG/JPEG/WebP).
- Publisher: Next.js example card (Sponsored label, logo, brand, image, title, description, CTA, text-only fallback, broken image dropped), safe URL checks, Node types/client, in-app guide section 4e, README, DAY6 contract addendum, `.env.example`, `MIGRATION-ORDER.md`.
- Revive adapter / fallback: not modified; provider responses never carry the new keys.

## Test results (sandbox, mock database)
- Total 4950 tests: 4948 pass, 1 fail, 1 skipped (plus the pre-existing TEST_DATABASE_URL skips are counted inside these numbers by the runner).
- New tests: api contract, asset security (404 for pending / rejected / paused / draft / archived, inactive campaign / advertiser, cross-advertiser, bad bytes, bad dimensions), image dimensions, publisher example.
- The 1 failure is `day28-part1 ... compile strictly`: sandbox has no `next` package ("run `npm ci`"). It was environmental before my change; **must be re-run in CI / after `npm ci`**.
- The 1 new skip: strict type-check of `route.ts` + `SponsoredAd.tsx` (needs `next` + `@types/react`); runs after `npm ci`.

## NOT verified (manual, TEST / Preview, do not mark as passed)
1. Run the SQL on TEST and checks R1-R5 (the SQL eligibility rule is only emulated in tests).
2. Real upload of logo + banner, approval, then `RICH_AD_DELIVERY_ENABLED=1` on Preview: match response and image in a browser.
3. Pause / reject the ad: image URL must turn 404 (CDN cache is up to 60 s).
4. `npm ci && npm run lint && npm test && npm run lint:eslint && npm run build` in CI.
5. Note: images uploaded before Step 3B have no stored dimension check; the proxy 404s any that break the rules (card falls back to text-only).
