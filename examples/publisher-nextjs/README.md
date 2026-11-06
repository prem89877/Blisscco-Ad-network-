# Blisscco publisher example (Next.js)

Browser -> your `/api/blisscco-ad` route (server) -> Blisscco `POST /api/v1/ads/match`.
The publisher API key stays on the server. The browser only sends a topic.

## Setup

1. Copy `app/api/blisscco-ad/route.ts`, `components/SponsoredAd.tsx` and `lib/safe-url.ts` into your Next.js app,
   plus `examples/publisher-node/src/client.ts` and `types.ts`. Fix the client import path in `route.ts`.
2. `cp .env.example .env.local` and fill in (server only, never commit it):
   - `BLISSCCO_PUBLISHER_API_KEY`: your `blc_live_...` key (Publisher dashboard -> API keys).
   - `BLISSCCO_API_BASE_URL`: the API host Blisscco gives you (`http://localhost:3000` for local testing).
   - Neither variable gets a `NEXT_PUBLIC_` prefix (no `NEXT_PUBLIC_` prefix, ever).
3. On Vercel add the same two variables (no `NEXT_PUBLIC_` prefix), then redeploy.
4. Use it after your assistant's answer: `<SponsoredAd topic="gaming" />`. Topics are limited to the allowlist in `route.ts`.

## Routes

Browser -> your own route (same origin) -> Blisscco:

| Step | Your route | Calls Blisscco | Body from the browser |
| --- | --- | --- | --- |
| Request an ad | `POST /api/blisscco-ad` | `POST /api/v1/ads/match` (with the key) | `{ "topic": "gaming" }` |
| Impression | `POST /api/blisscco-ad` | `POST /api/v1/ads/impression` (no key) | `{ "token": "...", "event": "impression" }` |
| Click | `POST /api/blisscco-ad` | `GET /api/v1/ads/click?ref=...` (no key) | `{ "click_ref": "...", "event": "click" }` |

## Rules

- Never put the key in client code, `NEXT_PUBLIC_*` variables or logs.
- Send only a topic. Never send chat messages, prompts or user data.
- Impressions: the component sends only `{ token, event: "impression" }` to your own route once the ad is at least half visible in a visible tab (once per ad). The route forwards it server-side; the token is the only credential.
- Clicks: the CTA is a button, not a direct link. On press the component sends only `{ click_ref, event: "click" }` to your route, which calls Blisscco's click endpoint server-side (Blisscco validates the ref). Then the validated https destination opens in a new tab with `noopener,noreferrer`. The browser never supplies a destination.
- Keep the **Sponsored** label. Links open with `rel="sponsored noopener noreferrer"`.
- No CORS headers: the route is same-origin only.
- No ad (no-fill, error, unsafe link) = the component renders nothing.

## Rich ad card (optional fields)

When the advertiser supplied them (and Blisscco has rich delivery switched on for your environment: server flag `RICH_AD_DELIVERY_ENABLED`, off by default), an ad can also carry `brand_name`, `logo_url` and `image_url` next to the five public fields.

- The card shows: **Sponsored** label, logo + brand name, banner image, headline, description and the call-to-action.
- **Text-only fallback**: every rich field is optional. No logo, no brand, no image, or an image that fails to load = the plain text card (headline, description, CTA). The **Sponsored** label is always there.
- Image URLs look like `https://<your Blisscco API host>/api/v1/ads/asset/<ad id>?kind=logo` (or `kind=image`). They point at Blisscco's image proxy, need no key, and stop working (404) when the ad is paused, rejected or no longer approved.
- `app/api/blisscco-ad/route.ts` keeps an image URL only if it is https (http for localhost), on exactly your `BLISSCCO_API_BASE_URL` host and the `/api/v1/ads/asset/` path; `components/SponsoredAd.tsx` checks the shape again. Anything else is dropped and the ad stays text-only. `lib/safe-url.ts` holds both checks.
- Images load with `referrerPolicy="no-referrer"`, lazily, and are never fetched with your key.
- Billing is unchanged: an image load is not an impression or a click.
