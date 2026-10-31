# Blisscco publisher example (Next.js)

Browser -> your `/api/blisscco-ad` route (server) -> Blisscco `POST /api/v1/ads/match`.
The publisher API key stays on the server. The browser only sends a topic.

## Setup

1. Copy `app/api/blisscco-ad/route.ts`, `components/SponsoredAd.tsx` and `lib/safe-url.ts` into your Next.js app,
   plus `examples/publisher-node/src/client.ts` and `types.ts`. Fix the client import path in `route.ts`.
2. `cp .env.example .env.local` and fill in:
   - `BLISSCCO_PUBLISHER_API_KEY`: your `blc_live_...` key (Publisher dashboard -> API keys).
   - `BLISSCCO_API_BASE_URL`: your Blisscco site URL (`http://localhost:3000` for local testing).
3. On Vercel add the same two variables (no `NEXT_PUBLIC_` prefix), then redeploy.
4. Use it: `<SponsoredAd topic="gaming" />`. Topics are limited to the allowlist in `route.ts`.

## Rules

- Never put the key in client code, `NEXT_PUBLIC_*` variables or logs.
- Send only a topic. Never send chat messages, prompts or user data.
- Keep the **Sponsored** label. Links open with `rel="sponsored noopener noreferrer"`.
- No CORS headers: the route is same-origin only.
- No ad (no-fill, error, unsafe link) = the component renders nothing.
