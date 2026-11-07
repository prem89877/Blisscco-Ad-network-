# Phase 4 Step 5: Publisher Onboarding and Integration Readiness Report

Date: 2026-11-07. Source of truth: the uploaded `blisscco-ad-network.zip` plus the Phase 4 Step 4 changes. Scope: publisher onboarding and integration readiness only. Production untouched, no billing, no payout, no live traffic. Step 6 not started.
Evidence labels: **Code read** = Claude read the code or document in the zip; nothing was run. **User-confirmed** = owner's word. **Seen** = output the owner pasted. Claude cannot reach any deployment and could not run tests here (no `node_modules`, no network).

## 1. Previously completed checks skipped (not repeated)
- No key and wrong key => 401 (Seen, Phase 4 Step 2); 400, 415, 413 (Owner, Step 1).
- Revoked key => 401 on Preview; key in query string or body refused; key absent from page source and logs (User-confirmed, Phase 2 Step 1 / Day C).
- Key create, rotate, revoke; key shown once and only a hash stored; invalid, revoked, expired, suspended key refused; not-approved account => 401 (automated mocked tests, `PHASE2-STEP3-AD-SERVING-REGRESSION-REPORT.md`, Phase 2 Step 4 doc alignment).
- Only a topic is accepted, extra body field refused (Owner, Step 1). No-fill leaves the chat normal (Owner).
- Impression, click, tracking, ad approval, creative and rich-delivery checks: out of scope by rule.

## 2. Newly verified (Code read only, not run)
| Item | Result |
| --- | --- |
| Routes, auth header, required fields in `PUBLISHER-PILOT-ONBOARDING.md` vs `app/api/v1/ads/*` and `lib/ads/validation.ts` | Match: body limit 2048 bytes, `fallback_topics` max 2, `exclude_ad_ids` max 20, `Retry-After: 60` on 429, click answers 405 for non-GET, `X-Blisscco-Api-Version: 1` |
| Env names `BLISSCCO_API_BASE_URL`, `BLISSCCO_PUBLISHER_API_KEY` in Node README, Next.js example, guide | Consistent; legacy names kept as fallback in the Node client |
| Retry rule "1 second or more with jitter" | Matches `examples/publisher-node/src/client.ts` (2000 ms base, 50-100% jitter) |
| API key exposure | No `NEXT_PUBLIC_*` variable holds a key or secret; the build guard `config/public-env-guard.mjs` stops the build on secret-looking public variables or `blc_live_` / `sb_secret_` values; Node client keeps the key in a `#private` field and does no logging |
| Logging | Match path logs no key, header, body or topic; `lib/publisher/keys-db.ts` logs only error codes; the Next.js example logs only the error name |
| No conversation text sent | Next.js example route refuses any field except `topic` and uses a topic allow-list; the API refuses unknown fields |
| API unavailable | Docs and examples: 503 or network error => no ad, chat unaffected; client throws `BlissccoRetryExhaustedError` with `safeNoFill = true` |
| Suspension and emergency revoke procedure text | Present and consistent: onboarding section 2 and 4, `MVP-PILOT-SAFETY-CHECKLIST.md` 10e (revoke first, then check 401) |

### 2b. Owner results added 2026-11-07
| Item | Result | Source |
| --- | --- | --- |
| Suspended TEST publisher with a current (not revoked) key => match request returns 401 | VERIFIED | Seen (Termux screenshot, status line `401`). Owner stated the publisher was suspended before the request and the key was a new, unrevoked one |
| Control: after re-approval the same key on a sensitive topic (health) returns `{"fill":false}` with HTTP 200, no ad served, no spend | VERIFIED | Seen (same screenshot). Together with the row above this separates the 401 (suspension) from a bad or revoked key |
| Publisher signup => Waiting for approval => admin approves => key can be created | VERIFIED | User-confirmed (word only) |
| Key is shown only once (not after reload) | VERIFIED | User-confirmed (word only) |
| CI workflow (type check, `npm test` incl. onboarding doc test, ESLint, build) green after push | VERIFIED | User-confirmed (word only; no run link or log seen). This replaces the Termux `npm test` request |
| Revoke-practice date | NOT RECORDED | Owner says the date can be seen, but gave no date. Left blank, not invented |
| Pilot publisher's written confirmations (Sponsored label, guide sections 6 and 6a, own 429/503 handling) | PENDING by owner's decision | Stays pending |
No key, host or token is written in this report. The Preview host visible in the screenshot is deliberately not recorded.

## 3. Pending and unverified
1. Date of the practised TEST-key revoke (the 401 after revoke is User-confirmed from earlier steps; only the date is missing). PENDING (owner writes it).
2. Pilot publisher's written confirmations and its own 429/503 handling (Gate A and D items). PENDING by owner's decision; needs the publisher.
3. Mocked-only by decision (cannot be safely caused on Preview): 429, 503, expired key.
4. Evidence strength: signup/approval flow, key shown once, and CI green are the owner's word only.

## 4. Publisher onboarding status
Code and documentation agree on the setup flow (signup, Waiting for approval, manual approval or suspension, key creation with expiry, key shown once). Registration, approval and suspension are confirmed on Preview (section 2b: suspension Seen, signup/approval User-confirmed). Key shown once: User-confirmed.

## 5. API authentication and security status
Previously verified items stand (section 1). No new weakness found by code read. Suspension => 401 is now Seen on Preview, with a control that rules out a bad key. Expiry, 429 and 503 remain mocked-test only by decision.

## 6. Documentation issues
- **Found and fixed:** `PUBLISHER-PILOT-ONBOARDING.md` said the response and the checklist carry only the five public ad fields. Since Step 3B, `brand_name`, `logo_url` and `image_url` can appear when rich delivery is on (default off). Three lines were corrected and a short section 12 added. No code, route or contract changed.
- Noted, left unchanged: the comment in `examples/publisher-node/README.md` step 3 lists the five fields only; the types already allow the optional fields. Not wrong with the flag off.

## 7. Files modified
- `PUBLISHER-PILOT-ONBOARDING.md` (3 lines edited, section 12 appended).
- `PHASE4-STEP5-PUBLISHER-READINESS-REPORT.md` (new).
No code, SQL, config or environment value changed. No `.sh` script added, so `.github/workflows/ci.yml` is unchanged.

## 8. Remaining blockers
No technical blocker. Open: revoke-practice date, and the pilot publisher's written confirmations (owner decision: stays pending).

## 9. Manual confirmations required from the owner
Revoke-practice date. Pilot publisher's written confirmations (kept pending by owner). Nothing else from this step. Everything marked User-confirmed above rests on the owner's word.

## 10. Overall publisher readiness
**Technically ready for the controlled TEST pilot; not declared fully ready.** Code and documentation agree, the one documentation error was fixed, publisher authentication including suspension is verified on Preview, and CI is green (User-confirmed). Still open: the revoke-practice date and the pilot publisher's written confirmations. This is not approval for live traffic or Production. Step 6 not started; waiting for your confirmation.
