# Day 27 – Safe checklist for a future real Revive endpoint verification

Status: **documentation only.** Nothing in this file enables, connects or configures anything. No real Revive endpoint exists in this repository and none has been verified. `REVIVE_FALLBACK_ENABLED` stays unset (off).

This file does **not** authorise enabling anything. It is the single "before fallback" list that pulls together `REVIVE-JSON-ENDPOINT-SETUP.md`, `DAY24-JSON-PREVIEW-SETUP.md` and `DAY25-REVIVE-ENDPOINT-COMPATIBILITY.md` (the detailed commands live in the Day 25 file, section 6).

Fixed rules for everything below:

- Do not use a guessed URL. Only a URL given to you by the endpoint owner may be used, and it is a secret (section 5).
- Do not use real credentials in any file, test, doc, log, chat or screenshot.
- Preview only. Production configuration is never touched.
- No SQL and no database change are needed for any step.

## 1. Gate: what must be true before fallback is enabled

Every item must be marked pass, with the date and who checked it. One fail means do not enable.

| # | Check | Pass when | Source of the number |
| --- | --- | --- | --- |
| 1 | HTTPS | URL starts with `https://`; no username or password; no fragment; at most 2048 characters; no leading or trailing space | adapter config check |
| 2 | JSON response fields | one JSON object with `headline` (1 to 90 characters), `body` (1 to 300), `cta_text` (1 to 30 or `null`), `destination_url`; plain text only | JSON endpoint contract |
| 3 | Response size | body at most 65,536 bytes | adapter body limit |
| 4 | Content type | `application/json`, optionally with `charset=utf-8`, nothing else | adapter |
| 5 | Redirect rejection | the configured URL answers directly; any `3xx` is a no-fill and is never followed | adapter (`redirect: "error"`) |
| 6 | Timeout | full answer well inside 800 ms by default, on repeated tries; `REVIVE_TIMEOUT_MS` may raise it to at most 3000 ms | adapter |
| 7 | Safe destination | `destination_url` is absolute `https`, no credentials, no spaces, at most 2048 characters, and a human has looked at the landing page | click destination check |
| 8 | Provider attribution | the answer shows as `sponsored: true`, with an id like `revive_xxxxxxxx`, and no `tracking` and no `click_ref` | provider ad builder |

Details per item follow.

### 1.1 HTTPS

- Plain `http://` is rejected by the configuration check and the flag stays off.
- The same rule applies to `destination_url`: `http:`, `javascript:`, `data:` and relative paths all fail.

### 1.2 JSON response fields

- Read: `headline`, `body`, `cta_text`, `destination_url`. Other keys are ignored, but prefer none.
- No `<` or `>`, no HTML entity, no control character in a text field.
- Any of these keys rejects the whole creative: `html`, `script`, `scripts`, `js`, `javascript`, `iframe`, `tag`, `code`, `markup`, `adm`, `creative_html`, `ad_html`, `body_html`, `snippet`, `embed`, `vast`, `xml`.
- A JSON array, a string, `null` or an empty body is a no-fill.

### 1.3 Response size

- Larger than 65,536 bytes is cut off and becomes a no-fill. A normal creative is a few hundred bytes.

### 1.4 Content type

- `text/html`, `text/plain`, a missing header and `application/json; charset=latin1` all become a no-fill.

### 1.5 Redirect rejection

- This includes http-to-https redirects, trailing-slash redirects and sign-in redirects.
- If the endpoint redirects, ask for the final address. Do not loosen Blisscco's check.

### 1.6 Timeout

- A timeout is always a no-fill and never an error shown to a publisher.
- Prefer a faster endpoint over a higher `REVIVE_TIMEOUT_MS`. A longer wait delays the publisher response.

### 1.7 Safe destination

- The automatic check proves only that the URL is well-formed. It does not prove the site is safe. Open the landing page yourself.

### 1.8 Provider attribution

- The public match response carries no `provider` field. The provider is internal.
- A provider ad is recognised by `sponsored: true` and an id shaped like `revive_` plus 8 hex characters. That id is never a UUID, so it cannot be mistaken for a Blisscco campaign or ad id.
- A provider ad has no `tracking` object and no `click_ref`. Blisscco records no impression, click, billing, ledger entry or publisher earning for it.
- Revive-side tracking, billing or payouts, if any, are outside Blisscco and are not promised here.

## 2. Stock Revive HTML/JavaScript zone tag vs the JSON endpoint Blisscco expects

| | Stock Revive HTML/JavaScript zone tag | JSON endpoint Blisscco expects |
| --- | --- | --- |
| Output | HTML and/or JavaScript for a browser to run | one small JSON object, plain text |
| Consumer | a web page in the visitor's browser | Blisscco's server, with a `GET` and only `Accept: application/json` |
| Executable code | yes | never accepted |
| Fit for Blisscco | **rejected on purpose** | the only accepted shape |

- **It is not confirmed that Revive supplies the JSON endpoint Blisscco needs.** No Revive documentation, no captured Revive response and no live Revive instance has been checked in this repository.
- Blisscco has no adapter for Revive's native output, and none should be written before it has been verified with real evidence.
- A real endpoint would be a separate component that someone builds and hosts. What it reads from Revive is undecided.
- Do not write "Revive provides a JSON endpoint" in any document, ticket or code comment until evidence exists.

Evidence required before any claim of compatibility:

1. The provider's own documentation (page name and date noted), or a captured live response from an instance you control.
2. A sample response saved with all credentials, tokens and host names removed.
3. A pass on every item in section 1, with the date and who ran it.
4. Notes that contain no secret value. Write "passed" or "failed" per item, never the URL.

## 3. Preview-only test with a dedicated endpoint

Goal: check one real endpoint on a Vercel Preview deployment, without touching Production and without exposing the URL.

**Preflight checklist (Day 28).** Every box must be a plain yes before step 1 below. If one is not, stop; nothing has been changed yet.

- [ ] **Preview environment label:** the deployment you will test shows the Environment label Preview in the Vercel dashboard, and the variables will be added for Preview only (Production and Development unticked).
- [ ] **Dedicated test publisher key:** a Preview-only test publisher with its own key, made just for this test. Never a real publisher's key. Keep it in a terminal variable only, and revoke it at cleanup.
- [ ] **Endpoint owner approval:** the endpoint owner has agreed, in writing, to test requests from Blisscco's Preview server. Record only "approved" and the date, never the URL.
- [ ] **Verified HTTPS JSON response:** all eight gate items in section 1 passed by hand (HTTPS, fields, size, content type, no redirect, timeout, safe destination, attribution).
- [ ] **Cleanup ready:** the cleanup in step 9 below is understood, and a named person will run it straight after the test.


1. Get a **dedicated** endpoint from its owner. Dedicated means it exists only for this test, returns a test creative, and can be rotated or deleted afterwards. Do not point a test at an endpoint that serves live advertisers.
2. Run the manual checks from `DAY25-REVIVE-ENDPOINT-COMPATIBILITY.md` section 6 first, with the URL entered without echo. Stop on any fail.
3. In Vercel: project > Settings > Environment Variables. Add these as **server-side** variables, **Preview only**. Leave Production and Development unticked. Never use a `NEXT_PUBLIC_` prefix.

   | Variable | Value for the test |
   | --- | --- |
   | `REVIVE_FALLBACK_ENABLED` | exactly `true` |
   | `REVIVE_DELIVERY_URL` | the dedicated endpoint URL, entered in the Vercel form only |
   | `REVIVE_RESPONSE_FORMAT` | `json` (optional; this is the default) |
   | `REVIVE_TIMEOUT_MS` | leave unset (800) unless the checks showed a need, at most 3000 |

4. Redeploy the Preview deployment. Variable changes apply to new deployments only.
5. Check the Environment label of the deployment in the Vercel dashboard before sending any request. It must say Preview.
6. Send a normal publisher match request for a topic with **no approved Blisscco campaign**, using a Preview-only test publisher key kept in a terminal variable. Expect `fill: true`, `sponsored: true`, an id like `revive_xxxxxxxx`, and no `tracking`.
7. Send a request for a topic that has an approved Blisscco campaign. Expect the Blisscco ad, not the provider ad: the provider is only a fallback.
8. Check Production separately. It must still answer `{"fill":false}` for the no-campaign topic.
9. Cleanup, in this order:
   1. Delete `REVIVE_FALLBACK_ENABLED` and `REVIVE_DELIVERY_URL` from Preview, plus any of `REVIVE_RESPONSE_FORMAT`, `REVIVE_TIMEOUT_MS` and `REVIVE_JSON_PREVIEW_ENABLED` that you added. Check that Production and Development hold none of these names.
   2. Redeploy Preview without the build cache and wait until it is Ready. Variable changes apply to new deployments only, so the old deployment keeps the fallback on until then.
   3. Repeat the no-campaign request. Expect `{"fill":false}`, which shows fallback is disabled again.
   4. Ask the endpoint owner to rotate or delete the dedicated endpoint.
   5. Clear the terminal values with `unset`.

Notes:

- A Preview protected by Vercel Deployment Protection answers a command-line request with a sign-in redirect or an authentication status. Turn it off for the test only if you accept that, and turn it back on afterwards.
- The Day 24 route `/api/revive-json-preview` and `scripts/revive-json-preview-check.mjs` check the Blisscco **test fixture** only. A pass there says nothing about Revive, and the script cannot be pointed at an external endpoint.
- `REVIVE_JSON_PREVIEW_ENABLED` is a separate flag. It never turns on `REVIVE_FALLBACK_ENABLED`, and this test does not need it.

## 4. Do not leak the URL or any key

- Treat `REVIVE_DELIVERY_URL` as a secret: it may carry a token in its path or query.
- Blisscco sends **no** `Authorization` header and **no** cookies. An endpoint that needs either is not compatible today.
- Keep the URL out of the repository, docs, tests, logs, screenshots, chat and tickets. Real values go only into server-side hosting settings.
- Enter the URL in a terminal without echo, then clear it:

```bash
read -rs ENDPOINT_URL
export ENDPOINT_URL
unset ENDPOINT_URL
```

- A publisher key (`blc_live_...`) is also a secret. Use a Preview-only test publisher. Never paste a key into a URL, query string, doc or chat, and send it only in a request header from a terminal variable.
- Error output from a tool may name the host. Do not paste raw output anywhere public.
- If the URL or a key is pasted somewhere it should not be, treat it as leaked: ask the endpoint owner to rotate the URL, and revoke the publisher key in the dashboard.
- Record results as "passed" or "failed" only.

## 5. What this file does not do

- It does not claim a live Revive integration. None exists.
- It does not change code, environment variables, billing, tracking, the ledger or payouts.
- It adds no SQL and no schema change.
- After every item passes, enabling is still a separate, later decision under `REVIVE-JSON-ENDPOINT-SETUP.md` section 6: Preview first, verified by hand, flag turned off again afterwards.
- If any item fails, fix it on the endpoint side. Do not loosen Blisscco's checks to fit it.
