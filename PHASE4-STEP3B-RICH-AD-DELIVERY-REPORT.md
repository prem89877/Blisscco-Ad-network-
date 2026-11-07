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

## Manual verification on TEST / Preview (Denim Hub Bsl database, preview-day-c deployment)
| Check | Status |
| --- | --- |
| SQL `phase4-step3b-1` applied on TEST; R1 (security definer, search_path empty), R2 (execute: service_role + postgres only; anon / authenticated false), R3 (bucket `creative-assets` private) | VERIFIED (run via Supabase on the TEST project) |
| R4 / R5: all 8 existing creatives: approved + active chain => `ok`, archived / draft / pending_review / paused campaign => `not_found`; unknown id and null => `not_found` | VERIFIED |
| CI workflow (lint / test / build) | VERIFIED by owner (green) |
| Vercel Preview build | Initially failed on an old Step 3 type error (`SignClient.signedUrl`); fixed in blisscco-vercel-typefix.zip; owner confirmed deployment works afterwards |
| Old creative without rich data => exactly the 5 fields | VERIFIED (real Preview response) |
| New creative (brand + logo + banner, approved, active campaign) => `brand_name`, `logo_url`, `image_url` added next to the 5 fields; URLs are the Preview deployment's `/api/v1/ads/asset/<id>?kind=...`; no storage path / bucket name in the response | VERIFIED (real Preview response; DB confirms paths are in the creative's own advertiser/campaign folder and both files exist) |
| `logo_url` and `image_url` open in a browser and show the uploaded logo and banner | VERIFIED (owner screenshots) |
| Wrong kind (`kind=banner`) => 404 | VERIFIED (owner screenshot) |
| Archived creative: database function returns `not_found` | VERIFIED (query on TEST) |
| Archived creative: proxy URL `?kind=image` => 404 in the browser (creative d4517c21 archived) | VERIFIED (owner screenshot, Preview). `?kind=logo` on the archived ad was not opened separately; it uses the same eligibility check (covered by automated tests). |
| Flag OFF (`RICH_AD_DELIVERY_ENABLED` removed from Preview, redeployed): match response back to exactly the 5 fields for a creative that has brand + logo + banner | VERIFIED (real Preview response on the redeployed build; the first attempt before the redeploy still returned rich fields, as expected because env changes need a redeploy) |
| Flag OFF: image URL `/api/v1/ads/asset/<id>?kind=image` of an approved rich ad => 404 | NOT VERIFIED. The screenshot sent was the site's styled "This page was not found" page (URL not visible), which is different from this route's empty 404 and most likely means the address did not match the route (typo / wrong path). Re-check with the full URL; covered by automated tests meanwhile. |
| Wrong-size upload rejected in the real form | VERIFIED for a square banner (owner tried several square images in the Preview form; none was accepted). A too-small / too-big logo was not tried on Preview (covered by automated tests). |
| Production | UNTOUCHED: no SQL, env var or deployment change there |

## Known notes
- 1 automated test (day28-part1 strict compile of the Next.js route) and 1 new test (type-check of route + card) need the `next` / `@types/react` packages; they ran only in CI, not in the authoring sandbox.
- Images uploaded before Step 3B have no stored dimension check; the proxy 404s any that break the rules and the card falls back to text-only.
- Image responses are cached for up to 60 seconds, so a paused ad's image can stay visible that long.
