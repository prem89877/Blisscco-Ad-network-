# Phase 3 Step 2: First Controlled Serve Verification Report

Date: 2026-11-04. This report records what the user ran by hand on the Preview and in Termux, as seen in the raw terminal output the user attached to the chat. Claude read that output. Claude did not contact the Preview or any other live service, and did not reproduce the Preview results.

**Status: PARTIAL. Pending items remain. NOT A PILOT APPROVAL. REAL PUBLISHER TRAFFIC MAY NOT START.**

The publisher API is still not declared ready for production use. Gates A to D in `MVP-PILOT-SAFETY-CHECKLIST.md` stay NOT CONFIRMED.

## 1. Changed files

| Path | Change |
|---|---|
| `PHASE3-STEP2-FIRST-SERVE-VERIFICATION-REPORT.md` | New: this report. |
| `MVP-PILOT-SAFETY-CHECKLIST.md` | Added section 13 (first controlled serve evidence record). Sections 1 to 12 are unchanged. |
| `tests/ads/phase3-step2-first-serve-report.test.ts` | New: a report-contract test. It reads repository files only. |

No application code, publisher example, route, SQL file, migration, workflow, script, environment value or deployment setting was changed. The Step 2 code tasks (publisher example changes, failure-safety changes and new regression tests for them) were not implemented in this pass. The existing example code and its existing mocked tests are unchanged.

## 2. Environment

- Environment name: Vercel Preview deployment (TEST project values, dedicated test publisher). The host is not written here.
- Publisher integration type: direct `curl` from the tester's Android device (Termux). Not a chatbot integration. The Next.js and Node examples were not run against the Preview.
- Key: a TEST publisher key. It was pasted into the chat during the session, so it must be revoked. See section 7.

## 3. What was observed on the Preview

Source of every row: raw terminal output pasted by the user. Times are from the response `date` header (UTC).

| Check | Date and time (UTC) | Observed |
|---|---|---|
| `POST /api/v1/ads/match`, topic `gaming` | 2026-11-04 05:37 | HTTP 200. Headers `cache-control: no-store` and `x-blisscco-api-version: 1` present. Body: `fill: true`, `sponsored: true`, and an `ad` object with exactly five fields: `id`, `headline`, `body`, `cta_text`, `destination_url`. No advertiser, budget or campaign field appeared. |
| `POST /api/v1/ads/match`, topic `health` (first call) | 2026-11-04 05:38 | HTTP 200 with the same two headers. The response body is not visible in the pasted output. |
| `POST /api/v1/ads/match`, topic `health` (second call) | 2026-11-04 05:39 | HTTP 200 with the same two headers. The response body is not visible in the pasted output. |

Reading of the rows:

- A fill with `sponsored: true` and only the five public fields was seen once. The ad content was test data.
- The sensitive-topic answer is HTTP 200 with no visible body. Whether the body was `{"fill":false}` was not seen, so it is not recorded as confirmed.
- `destination_url` is one of the public fields of the match contract. A publisher must not trust it or link to it directly. The Next.js example is built for that (button only, click goes through the publisher's own route), and its existing tests are mocked.

## 4. Not run in this pass (Pending)

Nothing below was run, so nothing below has a result.

- Latency: not measured. The `duration_ms` number in the pasted output belongs to the local test runner (the 92-test document run), not to the API. It is not an API latency value, and it is not recorded as one.
- Missing key, wrong key, extra body field, wrong content type and oversized body on this pass. (The user reported these by hand earlier on 2026-11-04; that stays the user's word only, as recorded in `PHASE3-STEP1-PILOT-PREPARATION-REPORT.md`.)
- Tracking opt-in header, tracking token and click reference.
- Impression response, duplicate impression and changed token.
- Click redirect behavior and changed click reference.
- 429 with `Retry-After` and 503 on the Preview. These cannot be caused on purpose. Only the mocked tests cover them.
- Ad rendering with the Sponsored label in a browser against the Preview, and an undelayed chatbot answer.
- Revoke of the TEST key and a request after the revoke that returns 401.

## 5. Tests

### 5a. Run by the user in Termux (full suite)

Reported in the pasted output: 4636 tests, 760 suites, 4633 pass, 3 fail, 0 cancelled, 0 skipped. The three failures are existing tests that are not part of any Step 2 change:

1. `tests/ads/day12-prompt5-part4-adapter.test.ts`: "a hanging adapter => timeout; a late rejection afterwards does not become an unhandled rejection". The assertion that the caller returns within 35 ms failed.
2. `tests/ads/day22-part1-revive-boundary.test.ts`: "a hanging fetcher => timeout no-fill, request is aborted, late rejection is not unhandled". The assertion that the caller does not wait for the slow fetcher failed.
3. `tests/ads/day22-part3-fallback-routing.test.ts`: "a hanging provider => no-fill after the outer timeout; late rejection is not unhandled". The assertion that the call returns within 50 ms failed.

What is known: all three assert a wall-clock limit of tens of milliseconds, and they all concern the Revive adapter and fallback path, which stays disabled. What is not known: whether the cause is a slow phone, a timer problem, or a real defect. The cause is not diagnosed, and these tests are not fixed. They were not rerun by Claude (the sandbox could not install the packages, see 5c). Treat them as **failing and open**.

After that run the user ran three document tests (day 30 part 2, part 3 and part 5): 92 tests, 92 pass, 0 fail.

### 5b. New tests added in this pass

`tests/ads/phase3-step2-first-serve-report.test.ts`: a report-contract test. It checks that this report and the checklist section 13 hold no key, host, token or ticked box, keep the gates NOT CONFIRMED, keep every pending item pending, and make no readiness claim. It does not test product behavior.

### 5c. Run by Claude in its sandbox

- The sandbox could not install the project packages (the package manager crashed and the network failed), so the TypeScript build and the full suite were not run there.
- The existing document tests (day 30 part 1, 2, 3, 4 and 5, phase 2 step 5 and phase 3 step 1) were run in the sandbox through a type-stripping helper on the unmodified files: 202 pass, 0 fail. They were run again after the new section and the new test were added. The result is in section 6.

### 5d. Repeat of earlier tests

The user's `npm test` run covers the whole suite, so tests reported as passing in earlier phases were run again in that run. No new regression test for Step 2 product code was added, because no Step 2 product code was changed.

## 6. Document test result after this pass

Run by Claude in its sandbox, through a type-stripping helper (not the project's own `npm test` build), on the seven existing document tests plus the new one: 211 tests, 211 pass, 0 fail. Of these, 9 are the new report-contract tests and 202 are the existing document tests. This shows the documents agree with their own rules. It is not a Preview result and not a result of the project's own TypeScript build. The user should rebuild and run the new test in Termux with the project's own command, which also type-checks it:

```
npx tsc -p tsconfig.test.json
node --require ./tests/register.cjs --test .test-build/tests/ads/phase3-step2-first-serve-report.test.js .test-build/tests/ads/day30-part2-pilot-safety-doc.test.js .test-build/tests/ads/phase3-step1-pilot-preparation.test.js
```

## 7. Credential exposure

The TEST key appeared in the chat more than once, including inside the pasted terminal output. The user said they will revoke it after testing. That is not done yet as far as this report knows, so it is pending. After the revoke, a request with the old key must return 401, and that result is also pending. The key value is not written in any repository file.

## 8. Is the first controlled serve technically ready?

**Not declared ready.** One fill and two sensitive-topic answers were seen at the HTTP level on the Preview, with the right headers and the five public fields. That is a start, not a gate. Impression, duplicate, click, latency, failure handling and browser rendering have no Preview result, three existing tests fail in the user's Termux run, and the key revoke is pending.

## 9. Is the publisher integration ready for the next step?

No. Not for real publisher traffic. The next safe step is to finish the pending items in section 4 on the Preview with a new TEST key, find the cause of the three failing tests, and then decide on Step 2 code changes, if any are still needed.
