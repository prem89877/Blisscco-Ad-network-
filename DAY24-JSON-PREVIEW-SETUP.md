# Day 24 – JSON preview endpoint (prototype) and safe Preview-only testing

Status: **prototype. Test fixture only.** Not Revive-generated, not connected to Blisscco match fallback, never for Production.

Updated in Day 25 Part 4: manual check script, expected headers and statuses, and cleanup (sections 5 to 8).

## 1. What exists

| Item | Value |
| --- | --- |
| Route | `GET /api/revive-json-preview` |
| Route file | `app/api/revive-json-preview/route.ts` |
| Logic | `lib/ads/revive-json-preview.ts` |
| Flag | `REVIVE_JSON_PREVIEW_ENABLED` (server-side only) |
| Default | **disabled** (flag unset) |
| Manual check script | `scripts/revive-json-preview-check.mjs` (manual only, see section 5) |

## 2. The flag

- Name: `REVIVE_JSON_PREVIEW_ENABLED`.
- Only the exact value `true` enables the route. `TRUE`, `1`, `yes`, ` true`, empty or unset all mean disabled.
- Default is disabled. With the flag unset or not `true`, the route answers a fixed `404` with `{"error":"not_found"}`.
- It is a separate flag from `REVIVE_FALLBACK_ENABLED`. Setting one never turns on the other.
- Never prefix it with `NEXT_PUBLIC_`.

## 3. Expected response

Enabled, `200`, `Content-Type: application/json; charset=utf-8`, `Cache-Control: no-store`:

```json
{
  "headline": "TEST FIXTURE: Sample sponsored headline",
  "body": "Static placeholder text for the preview route. Not a real advertiser.",
  "cta_text": "Learn more",
  "destination_url": "https://example.com/blisscco-revive-test-fixture"
}
```

| State | Status | Body |
| --- | --- | --- |
| Flag not `true` | 404 | `{"error":"not_found"}` |
| Flag `true` | 200 | the 4-field JSON above |
| Enabled but creative invalid / error / timeout | 503 | `{"error":"unavailable"}` |

Query strings, headers and cookies are ignored. They cannot change the response.

### Expected headers (all three states)

| Header | Value | Checked by the script |
| --- | --- | --- |
| `Content-Type` | `application/json; charset=utf-8` | yes (media type must be `application/json`) |
| `Cache-Control` | `no-store` | yes |
| `X-Content-Type-Options` | `nosniff` | no (the route sets it; the script does not check it) |

The route sets no cookie and never redirects. It only answers `200`, `404` or `503`.

## 4. Safe testing: Vercel Preview only

1. Vercel project > Settings > Environment Variables > Add.
2. Name: `REVIVE_JSON_PREVIEW_ENABLED`, Value: `true`.
3. Environments: tick **Preview only**. Leave **Production** and **Development** unticked.
4. Save, then redeploy the Preview deployment (env changes apply to new deployments only).
5. Test against your Preview deployment URL (placeholder shown, use your own):

```bash
curl -i https://<your-preview-deployment-domain>/api/revive-json-preview
```

6. Expect `200` and the fixture JSON from section 3.
7. Check Production separately: the same path must return `404` there.
8. After testing, delete the variable (or set it to anything other than `true`) and redeploy. Expect `404` again.

Do not put real credentials, tokens or a Revive URL in this variable or anywhere in this test. The flag needs only the value `true`.

If no Preview build starts, push a new branch (not `main`) with at least one new commit. A branch that points at the same commit as `main` may not trigger a new Preview build. Never use `--prod` for this test.

## 5. Manual check script

File: `scripts/revive-json-preview-check.mjs`. **Manual only.** It is not in `package.json`, not in CI and not called by any app code. Never run it against Production.

What it does: one `GET` to `<preview-origin>/api/revive-json-preview`, then it checks the response.

What it never does:

- It does not accept a path or query string. The path is fixed in the script.
- It does not follow redirects (`redirect: "manual"`). A `3xx` is a FAIL and the `Location` header is never read or printed.
- It does not send a publisher API key, an `Authorization` header or cookies (`credentials: "omit"`), and it does not read or print cookies.
- It does not print environment values, the URL, headers or the response body. Output is a fixed reason code only.
- It does not touch the Blisscco match API, Revive, a database or any file.

### Environment variables (terminal only, never saved in a file)

| Variable | Required | Meaning |
| --- | --- | --- |
| `BLISSCCO_PREVIEW_URL` | yes | `https://<your-preview-deployment-domain>`: origin only. No path, no query, no fragment, no username or password, no spaces. |
| `BLISSCCO_PREVIEW_CHECK_CONFIRM` | yes | exactly `yes`. Confirms this is a Preview deployment. Without it the script refuses to run. |
| `BLISSCCO_PRODUCTION_HOST` | no | if the URL host equals this host (case-insensitive), the script refuses. |
| `BLISSCCO_PREVIEW_CHECK_EXPECT` | no | `enabled` (default: `200` and the fixture), `disabled` (`404`) or `unavailable` (`503`). |

### Usage

Set the values one line at a time (easier on a phone keyboard), then run the script:

```bash
export BLISSCCO_PREVIEW_URL=https://<your-preview-deployment-domain>
export BLISSCCO_PREVIEW_CHECK_CONFIRM=yes
node scripts/revive-json-preview-check.mjs
```

Expected output with the flag on: `PASS ok state=enabled`.

To check the disabled state (after cleanup, section 8):

```bash
BLISSCCO_PREVIEW_CHECK_EXPECT=disabled node scripts/revive-json-preview-check.mjs
```

Expected output: `PASS ok state=disabled`. Use `unavailable` the same way for the `503` state.

### What the script checks in `enabled` mode

- Status is exactly `200`.
- `Content-Type` is `application/json`.
- `Cache-Control` contains `no-store`.
- The body is one JSON object with exactly four fields: `headline`, `body`, `cta_text`, `destination_url`.
- `headline` is 1 to 90 characters, `body` 1 to 300, `cta_text` 1 to 30 or `null`. Plain text only (no `<` or `>`, no HTML entities, no control characters).
- `destination_url` is `https`, has no username or password, and is at most 2048 characters.
- The headline contains the label `TEST FIXTURE`.
- The body is at most 65,536 characters, and no credential-looking text appears in it.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | PASS |
| `1` | the request ran and the response failed a check |
| `2` | configuration is wrong; no request was sent |

### Reason codes

Configuration (exit `2`): `missing_configuration`, `missing_preview_url`, `invalid_preview_url`, `preview_url_not_https`, `preview_not_confirmed`, `production_host_refused`, `invalid_expect`.

Response (exit `1`):

| Reason | Meaning |
| --- | --- |
| `unexpected_redirect` | a `3xx` answer. The script never follows it. |
| `unexpected_200` / `unexpected_404` / `unexpected_503` | a valid status, but not the one expected (for example `404` while expecting `enabled`) |
| `unexpected_status` | any other status (`401`, `403`, `500`, ...) |
| `bad_content_type` | not `application/json` |
| `missing_no_store` | `Cache-Control` has no `no-store` |
| `malformed_json` / `malformed_response` | body is empty, not JSON, or not a JSON object |
| `response_too_large` | body longer than 65,536 characters |
| `credential_leak` | credential-looking text in the body |
| `unexpected_fields` / `invalid_field` / `unsafe_destination` / `missing_fixture_label` | the fixture does not match section 3 |
| `unexpected_error_body` | a `404` or `503` body is not exactly the documented error JSON |
| `timeout` / `network_error` / `no_fetch` / `unexpected_error` | the request did not complete (10 second limit) |

### If the script reports a redirect or `unexpected_status`

- A Preview protected by Vercel Deployment Protection (Vercel Authentication) answers a command-line request with a redirect to a Vercel sign-in page, or with an authentication status. The script reports this as `unexpected_redirect` or `unexpected_status`. This is not a bug in the script.
- The script has no way to send cookies or a bypass header, on purpose. To test, temporarily turn Vercel Authentication off for Preview deployments, run the script, and turn it back on afterwards.
- `unexpected_404` while the flag should be on usually means the Preview deployment was built before the variable was added, or the variable is not ticked for Preview. Redeploy the Preview.
- The script cannot tell a Preview from a Production deployment by looking at the URL. Check the Environment label of the deployment in the Vercel dashboard before you run it.

## 6. Prototype limitations (read before using)

- The endpoint returns a **fixed test fixture**. The creative is fake (`example.com`, "TEST FIXTURE").
- It is **not Revive-generated**. Nothing here talks to Revive or reads any Revive data.
- It is **not connected to Blisscco match fallback**. The publisher match API, `REVIVE_FALLBACK_ENABLED` and `REVIVE_DELIVERY_URL` are unchanged and not pointed at this route.
- It does no serving, billing, tracking, ledger or database work.
- It **must not be enabled in Production**.
- A passing check proves only that this static route and its contract work on one Preview deployment. It does not show that Revive, or any other provider, can supply a compatible endpoint.
- `REVIVE-JSON-ENDPOINT-SETUP.md` is unchanged and still describes a future real endpoint. This prototype does not make that guide a live integration.
- To judge a real external endpoint, use `DAY25-REVIVE-ENDPOINT-COMPATIBILITY.md`. This check script cannot be pointed at an external endpoint.

## 7. Static fixture vs a real Revive-generated creative

| | This test fixture | A real Revive-generated creative |
| --- | --- | --- |
| Source | hard-coded in `lib/ads/revive-json-preview.ts` | would come from a Revive instance (not built, not verified) |
| Advertiser | none (fake, `example.com`) | a real advertiser |
| Changes between requests | never | yes |
| Proves | the Blisscco JSON contract and the route behave as written | nothing yet; no real Revive output has been seen by this repository |

Do not describe the fixture as Revive output. Revive supplying this JSON shape is **not confirmed**. See `DAY25-REVIVE-ENDPOINT-COMPATIBILITY.md`.

## 8. Cleanup after testing

1. Vercel > Settings > Environment Variables: delete `REVIVE_JSON_PREVIEW_ENABLED` (or set it to anything other than `true`).
2. Redeploy the Preview deployment (without the build cache), and wait until it is Ready.
3. Confirm Preview is disabled again: run the script with `BLISSCCO_PREVIEW_CHECK_EXPECT=disabled`. Expect `PASS ok state=disabled`.
4. Confirm Production still answers `404`: `curl -s https://<your-production-domain>/api/revive-json-preview` must print `{"error":"not_found"}`.
5. If you turned Deployment Protection off for the test, turn it back on.
6. Clear the terminal values: `unset BLISSCCO_PREVIEW_URL BLISSCCO_PREVIEW_CHECK_CONFIRM BLISSCCO_PREVIEW_CHECK_EXPECT BLISSCCO_PRODUCTION_HOST`.
7. Optional: delete the test branch and any temporary Codespace.
