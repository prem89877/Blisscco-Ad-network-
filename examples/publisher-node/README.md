# Blisscco publisher example (Node.js)

Server-side client for the Blisscco Ad API. It runs only on your backend: it holds your secret publisher key.

## Setup

1. Copy `src/client.ts` and `src/types.ts` into your backend (Node 18 or newer).
2. Set two server environment variables (placeholders below, use your own values):

   ```bash
   export BLISSCCO_PUBLISHER_API_KEY="paste-your-key-from-the-publisher-page"
   export BLISSCCO_API_BASE_URL="https://YOUR-BLISSCCO-API-HOST"
   ```

   - `BLISSCCO_PUBLISHER_API_KEY`: your `blc_live_...` key (Publisher dashboard -> API keys). Shown once, kept out of git.
   - `BLISSCCO_API_BASE_URL`: the API host Blisscco gives you (`http://localhost:3000` is accepted for local testing only).
   - Both are server-only: no `NEXT_PUBLIC_` prefix.
3. Create the client and request an ad:

   ```ts
   import { BlissccoClient } from "./client";

   const client = BlissccoClient.fromEnv();
   const result = await client.match({ topic: "gaming" }, { tracking: true });
   if (result.fill) {
     // render result.ad (id, headline, body, cta_text, destination_url) with a visible "Sponsored" label
   }
   ```

4. After the ad is really on screen, report the impression. For a click, report it only when a person actually clicks:

   ```ts
   if (result.fill && result.tracking) {
     await client.reportImpression({ token: result.tracking.token });
     // on a real click, if result.tracking.click_ref exists:
     // await client.reportClick({ click_ref: result.tracking.click_ref });
   }
   ```

## Routes used

| Method | Route | Required |
| --- | --- | --- |
| POST | `/api/v1/ads/match` | `Authorization: Bearer <key>`, `Content-Type: application/json`, body field `topic` |
| POST | `/api/v1/ads/impression` | `Content-Type: application/json`, body fields `token` and `event` (`impression`). No API key |
| GET | `/api/v1/ads/click` | query parameter `ref` (the `click_ref`), once. No API key |

## Rules

- Never put the key in client code, `NEXT_PUBLIC_*` variables or logs.
- Send only a topic. Never send chat messages, prompts or user data.
- `match()` resolves on a no-fill (`fill: false`): show nothing. Other failures throw; show no ad.
- Pass `{ tracking: true }` to `match()` to receive `tracking.token` (impression) and `tracking.click_ref` (click). Without it there is no `tracking` object.
- The client sends no key to the impression and click routes, and never follows the click redirect.
