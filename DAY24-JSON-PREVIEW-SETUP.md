# Day 24 – JSON preview endpoint (prototype) and safe Preview-only testing

Status: **prototype. Test fixture only.** Not Revive-generated, not connected to Blisscco match fallback, never for Production.

## 1. What exists

| Item | Value |
| --- | --- |
| Route | `GET /api/revive-json-preview` |
| Route file | `app/api/revive-json-preview/route.ts` |
| Logic | `lib/ads/revive-json-preview.ts` |
| Flag | `REVIVE_JSON_PREVIEW_ENABLED` (server-side only) |
| Default | **disabled** (flag unset) |

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

## 5. Prototype limitations (read before using)

- The endpoint returns a **fixed test fixture**. The creative is fake (`example.com`, "TEST FIXTURE").
- It is **not Revive-generated**. Nothing here talks to Revive or reads any Revive data.
- It is **not connected to Blisscco match fallback**. The publisher match API, `REVIVE_FALLBACK_ENABLED` and `REVIVE_DELIVERY_URL` are unchanged and not pointed at this route.
- It does no serving, billing, tracking, ledger or database work.
- It **must not be enabled in Production**.
- `REVIVE-JSON-ENDPOINT-SETUP.md` is unchanged and still describes a future real endpoint. This prototype does not make that guide a live integration.
