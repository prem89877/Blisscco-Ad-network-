# Revive JSON endpoint setup (future real delivery endpoint)

Status: **documentation only.** No real endpoint exists yet. Blisscco's Revive fallback stays **off** until a real endpoint is verified by hand.

## 1. Request contract (what Blisscco does)

Blisscco calls the configured delivery URL from the server only:

- HTTPS `GET`, no body, no cookies, no credentials. The only header sent is `Accept: application/json`.
- No redirects are followed. A 3xx response is a no-fill.
- Timeout: 800 ms by default, at most 3000 ms. Timeout means no-fill.

## 2. Response contract (what the endpoint must return)

- Status `2xx`.
- `Content-Type: application/json` (an optional `charset=utf-8` is accepted, nothing else).
- Body: valid UTF-8, one JSON object, at most **65,536 bytes**. Larger bodies are cut off and become a no-fill.

```json
{
  "headline": "Plain text, 1-90 characters",
  "body": "Plain text, 1-300 characters",
  "cta_text": "Plain text, 1-30 characters (optional, or null)",
  "destination_url": "https://example.com/landing"
}
```

| Field | Required | Rule |
| --- | --- | --- |
| `headline` | yes | plain text, max 90 characters |
| `body` | yes | plain text, max 300 characters |
| `cta_text` | no | plain text, max 30 characters, or `null` / omitted |
| `destination_url` | yes | `https` only, no username or password, max 2048 characters |

Only these four fields are read. Any other field is ignored.

### Allowed creative content: plain text only

- No `<` or `>`, no HTML entities (such as `&amp;`), no control characters.
- If the object has a key such as `html`, `script`, `iframe`, `adm`, `tag`, `code`, `markup`, `embed`, `vast` or `xml`, the **whole creative is rejected**.
- `"html"` as a response format is never turned into an ad.

### Any other result means no-fill

Redirect, non-2xx, wrong content type, empty body, oversize body, invalid JSON, a JSON array, a timeout, an invalid creative or an unsafe destination all end as `{"fill":false}`. Blisscco's own flow is not affected.

## 3. Stock Revive ad tag vs. the JSON endpoint Blisscco needs

| | Stock Revive HTML/JavaScript ad tag | Blisscco JSON endpoint |
| --- | --- | --- |
| Output | HTML and/or JavaScript for a browser to run | one small JSON object, plain text |
| Consumer | a web page in the visitor's browser | Blisscco's server |
| Executable code | yes | never accepted |
| Fit for Blisscco | **rejected on purpose** | the only accepted shape |

Blisscco does **not** render third-party HTML or run provider scripts.

**This repository does not verify that Revive natively provides this JSON endpoint.** There is no Revive documentation or live Revive response here that confirms it. The adapter only reads Blisscco's own configured contract above.

So a real endpoint is a separate piece you would build and control (for example a small service that returns the JSON above). What it reads from Revive is **not decided**. Verify Revive's real output yourself, from its documentation or a live instance, before building it. Blisscco has no adapter for Revive's native response format, and none should be written before that verification.

## 4. Server-side environment variables

Server-only. Never use a `NEXT_PUBLIC_` prefix. Never commit real values. Read at request time, so a change needs a redeploy.

| Variable | Safe default | Rule |
| --- | --- | --- |
| `REVIVE_FALLBACK_ENABLED` | unset (off) | exactly `true` turns it on; anything else is off |
| `REVIVE_DELIVERY_URL` | unset | an HTTPS URL, no credentials, no fragment, max 2048 characters; set it only when enabling |
| `REVIVE_TIMEOUT_MS` | unset (800) | optional; whole number from 1 to 3000 |
| `REVIVE_RESPONSE_FORMAT` | unset (`json`) | optional; use `json`. `html` is never turned into an ad |

When `REVIVE_FALLBACK_ENABLED` is not `true`, the other three are not read. An invalid value means no-fill, not an error.

**`REVIVE_FALLBACK_ENABLED` stays false (or unset) until a real endpoint has been verified.** Verifying means: it meets sections 1 and 2, it was checked by hand on a Preview deployment, and its content is moderated on the endpoint side.

Treat the delivery URL as a secret: it may contain tokens. Do not put it in code, docs, tests, logs or chat.

## 5. What this does not give you

A provider ad is a fallback fill only.

- It is not a Blisscco advertiser impression or billing event. No Blisscco advertiser is charged.
- The response has no `tracking` object and no `click_ref`.
- Blisscco does not provide tracking or reporting for Revive ads.
- Blisscco does not record publisher earnings for them.
- Revive-side tracking, billing or payouts, if any, are outside Blisscco and are not promised here.

## 6. Before enabling (manual)

1. Build the endpoint and check its output against sections 1 and 2.
2. Deploy to Preview only. Set the variables there (server-side).
3. Use a topic with no approved Blisscco campaign. Expect `fill:true`, `sponsored:true`, an id like `revive_xxxxxxxx`, and no `tracking`.
4. Turn the flag off and redeploy. Expect `{"fill":false}` again.
5. Decide on production only after that.
