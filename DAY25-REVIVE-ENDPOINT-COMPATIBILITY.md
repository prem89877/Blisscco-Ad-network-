# Day 25 – Checklist: is an external endpoint compatible with Blisscco's JSON contract?

Status: **documentation only.** Nothing in this file enables, connects or configures anything. No real endpoint has been verified. `REVIVE_FALLBACK_ENABLED` stays unset (off).

Use this checklist by hand, on any endpoint someone proposes as a future `REVIVE_DELIVERY_URL`, **before** it is set anywhere. The contract itself is in `REVIVE-JSON-ENDPOINT-SETUP.md`; this file turns it into checks.

## 1. Test fixture vs a real Revive-generated creative

| | Blisscco test fixture (`/api/revive-json-preview`) | Real Revive-generated creative |
| --- | --- | --- |
| Exists in this repository | yes, static data in `lib/ads/revive-json-preview.ts` | **no** |
| Advertiser | none (fake, `example.com`, labelled `TEST FIXTURE`) | a real advertiser, outside Blisscco |
| Produced by | a fixed provider function in Blisscco | a Revive instance, through an endpoint nobody has built or verified |
| Used by `REVIVE_DELIVERY_URL` / match fallback | **never** (not connected) | only after every check below passes and a separate decision is made |
| What passing proves | Blisscco's own JSON contract and route behave as written | n/a |

A pass on the fixture says nothing about Revive. The fixture must never be described as Revive output.

## 2. What is not confirmed

- **It is not confirmed that Revive supplies the JSON endpoint Blisscco needs.** No Revive documentation, no captured Revive response and no live Revive instance has been checked in this repository.
- A stock Revive ad tag returns HTML or JavaScript for a browser. Blisscco rejects that on purpose.
- Any real endpoint is therefore a separate component that someone must build and host, and what it reads from Revive is undecided.
- Do not write "Revive provides a JSON endpoint" in any document, ticket or code comment until the evidence below exists.

Evidence required before any claim of compatibility:

1. The provider's own documentation (page name and date noted), or a captured live response from an instance you control.
2. The sample response saved with all credentials, tokens and host names removed.
3. A pass on every check in section 5, with the date and who ran it.
4. The notes contain no secret values. Write "passed" or "failed" per item, never the URL.

## 3. Handle the endpoint URL as a secret first

- The URL may carry a token in its path or query. Blisscco sends **no** `Authorization` header and **no** cookies, so an endpoint that needs either is not compatible today.
- Keep the URL out of the repository, docs, tests, logs, screenshots, chat and tickets. Real values go only into server-side hosting settings, never a `NEXT_PUBLIC_` variable.
- In a terminal, enter it without echo and without a shell-history entry, then reuse the variable:

```bash
read -rs ENDPOINT_URL
export ENDPOINT_URL
```

- Error messages from a command may name the host. Do not paste raw command output anywhere public.
- If the URL is ever pasted somewhere it should not be, treat it as leaked and ask the endpoint owner to rotate it.
- Clear it afterwards: `unset ENDPOINT_URL`.

## 4. What Blisscco sends and what it accepts

| Item | Value |
| --- | --- |
| Request | `GET`, no body, no cookies, no credentials |
| Only header sent | `Accept: application/json` |
| Redirects | never followed; any `3xx` is a no-fill |
| Timeout | 800 ms by default; `REVIVE_TIMEOUT_MS` can raise it to at most 3000 ms |
| Status | `2xx` |
| Content type | `application/json`, optional `charset=utf-8`, nothing else |
| Body size | at most 65,536 bytes |
| Fields read | `headline`, `body`, `cta_text`, `destination_url` (all other fields are ignored) |

Every failure ends as no-fill (`{"fill":false}`), so Blisscco's own flow is not affected.

## 5. Checklist

Mark each item pass or fail. One fail means the endpoint is not compatible.

### 5.1 HTTPS

- [ ] The URL starts with `https://`. Plain `http://` is rejected.
- [ ] No username or password in the URL, and no fragment (`#...`).
- [ ] The URL is at most 2048 characters.
- [ ] No leading or trailing spaces.

### 5.2 JSON format

- [ ] Status is `2xx` for a normal request.
- [ ] `Content-Type` is `application/json`, with at most `; charset=utf-8`. `text/html`, `text/plain` and `application/json; charset=latin1` fail.
- [ ] The body is valid UTF-8 and is one JSON object. A JSON array, a string or `null` fails.
- [ ] The body is not empty.

### 5.3 Response fields

- [ ] `headline`: required, plain text, 1 to 90 characters.
- [ ] `body`: required, plain text, 1 to 300 characters.
- [ ] `cta_text`: optional, plain text, 1 to 30 characters, or `null`.
- [ ] `destination_url`: required, see 5.8.
- [ ] No `<` or `>`, no HTML entity (such as `&amp;`), no control character in any text field.
- [ ] None of these keys appears in the object, because any one of them rejects the whole creative: `html`, `script`, `scripts`, `js`, `javascript`, `iframe`, `tag`, `code`, `markup`, `adm`, `creative_html`, `ad_html`, `body_html`, `snippet`, `embed`, `vast`, `xml`.
- [ ] Extra keys are ignored by Blisscco, but prefer none, so the response stays predictable.

### 5.4 Redirect behavior

- [ ] The configured URL answers directly, with no `3xx`. This includes http-to-https redirects, trailing-slash redirects and sign-in redirects.
- [ ] If the endpoint redirects, change the URL to the final address. Blisscco will not follow it.

### 5.5 Timeout

- [ ] The full response arrives well inside the configured timeout (800 ms by default) on repeated tries, not just once.
- [ ] If more time is truly needed, `REVIVE_TIMEOUT_MS` may be raised, with a hard limit of 3000 ms. Longer waits delay the publisher response, so prefer making the endpoint faster.
- [ ] A timeout always becomes a no-fill, never an error shown to a publisher.

### 5.6 Response-size limit

- [ ] The body is at most 65,536 bytes. Larger bodies are cut off and become a no-fill.
- [ ] A normal creative is far smaller (a few hundred bytes). A large body is a sign that something other than the four fields is being sent.

### 5.7 Plain text only (no executable content)

- [ ] The endpoint never returns HTML, JavaScript, an ad tag, VAST or XML as the creative. Blisscco does not render third-party markup or run provider scripts.
- [ ] Creative text is moderated on the endpoint side. Blisscco does not moderate provider content.

### 5.8 Safe destination

- [ ] `destination_url` is `https`.
- [ ] No username or password in it.
- [ ] At most 2048 characters, with no spaces or control characters.
- [ ] It is an absolute URL. Relative paths, `javascript:`, `data:` and `http:` all fail.
- [ ] You have looked at where it leads and it is an acceptable landing page. The check only proves the URL is well-formed, not that the site is safe.

### 5.9 Credential handling

- [ ] The endpoint needs no cookie and no `Authorization` header (Blisscco sends none).
- [ ] If a token is part of the URL, the whole URL is treated as a secret (section 3).
- [ ] The response contains no credential, token, API key or internal host name. A response that leaks any of these fails, whatever else it contains.
- [ ] No real values appear in any file, test, doc, log or chat.

## 6. Manual commands

Run in a terminal after `read -rs ENDPOINT_URL` (section 3). None of these print the URL, but the tools may name the host in an error.

Status, content type and redirect check (no redirect is followed, because `-L` is not used):

```bash
curl -sS -o /dev/null -D - --max-time 3 --proto '=https' "$ENDPOINT_URL" | head -n 20
```

Look for: a `2xx` status line, `content-type: application/json` (optionally with `charset=utf-8`), and no `3xx` status. If the output contains a `set-cookie` line, note it. Blisscco ignores cookies, so this is only a warning sign.

Body size in bytes (must be at most 65,536):

```bash
curl -sS --max-time 3 --proto '=https' "$ENDPOINT_URL" | wc -c
```

Total time in seconds (repeat a few times; compare with the configured timeout, 0.8 by default):

```bash
curl -sS -o /dev/null --max-time 3 --proto '=https' -w "%{time_total}\n" "$ENDPOINT_URL"
```

Key names only (prints no values; expect `headline,body,cta_text,destination_url`, or the same without `cta_text`):

```bash
curl -sS --max-time 3 --proto '=https' "$ENDPOINT_URL" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);console.log(Array.isArray(o)||o===null||typeof o!=="object"?"not_an_object":Object.keys(o).join(","))}catch{console.log("invalid_json")}})'
```

Field lengths and destination checks are easiest by eye on a copy with real values removed. Compare each against section 5.3 and 5.8.

## 7. What the Blisscco check script can and cannot do

`scripts/revive-json-preview-check.mjs` is hard-wired to the Blisscco test route `/api/revive-json-preview` on a Preview deployment. It accepts no other path and cannot be pointed at an external endpoint. It checks the fixture only. For an external endpoint, use section 6 by hand.

## 8. After the checklist

- All items pass: record the result (section 2, evidence), without secret values.
- This checklist does **not** authorise enabling anything. Enabling stays a separate decision under `REVIVE-JSON-ENDPOINT-SETUP.md` section 6: Preview only, set server-side, verified by hand, flag turned off again afterwards.
- Any item fails: the endpoint is not compatible. Fix it on the endpoint side. Do not loosen Blisscco's checks to fit it.
- Provider ads are a fallback fill only. They have no Blisscco tracking, billing, ledger entry or publisher earnings (`REVIVE-JSON-ENDPOINT-SETUP.md` section 5).
