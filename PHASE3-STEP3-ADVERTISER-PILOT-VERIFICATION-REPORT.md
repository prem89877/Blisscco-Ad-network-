# Phase 3 Step 3: Advertiser Campaign Pilot Verification Report

Date: 2026-11-04. This report records what the user ran by hand on the Preview (dashboard in a mobile browser, requests from Termux). Claude did not contact the Preview or any other live service. The evidence has three levels, and each row says which one it is:

- **Seen by Claude**: raw terminal output or a screenshot that the user attached to the chat.
- **User-reported**: the user said the result matched what was expected. No output was seen by Claude.
- **Read in code**: Claude read the source. Nothing was run.

**Status: PARTIAL. Pending items remain. NOT A PILOT APPROVAL. NO REAL ADVERTISER SPENDING MAY START.**

The publisher API is still not declared ready for production use. Gates A to D in `MVP-PILOT-SAFETY-CHECKLIST.md` stay NOT CONFIRMED.

## 1. Changed files

| Path | Change |
|---|---|
| `PHASE3-STEP3-ADVERTISER-PILOT-VERIFICATION-REPORT.md` | New: this report. |
| `MVP-PILOT-SAFETY-CHECKLIST.md` | Added section 14 (advertiser campaign verification record). Sections 1 to 13 are unchanged. |
| `tests/ads/phase3-step3-advertiser-pilot-report.test.ts` | New: a report-contract test. It reads repository files only. |

No application code, SQL file, migration, workflow, script, environment value or deployment setting was changed. No new product regression test was added, because no product code was changed (section 6).

## 2. Environment

- Vercel Preview deployment with TEST project values. The host is not written here.
- A TEST advertiser account, a TEST publisher key, and two TEST campaigns that the user created (campaign A and campaign B below).
- The TEST key was pasted into the chat during the session, so it must be revoked. That is pending (section 8).

## 3. Verification record

| Field | Campaign A (budget 198.00) | Campaign B (small cap) |
|---|---|---|
| Campaign identifier | `3657dd65` (first 8 characters) | Not recorded. Pending. |
| Eligibility result | Status Active on the campaign page (user-reported). A match returned its ad (seen by Claude). | Status Active, 1 approved of 1 ad, start date 4 Nov 2026, no end date (screenshot seen by Claude). A match returned its ad (seen by Claude). |
| Category | `gaming` | `travel` |
| Budget cap configuration | Total 198.00, daily 19.80, USD (user-reported) | Total 1.00, daily 0.50, USD (screenshot seen by Claude) |
| Match result | Fill: HTTP 200, `fill: true`, `sponsored: true`, exactly five public fields (seen by Claude) | Fill: HTTP 200, `fill: true` (seen by Claude) |
| Served creative identifier | `dd7c6b2a` (first 8 characters) | `d6b2e246` (first 8 characters) |
| Advertiser spend result | One serve raised the spend from 0.0220 to 0.0240, and today's spend from 0.0040 to 0.0060: 0.0020 per serve (user-reported dashboard numbers) | After the run: spend 0.5000, today 0.5000, ads served 250, budget left 0.50 (screenshot seen by Claude) |
| Budget-exhaustion behavior | Not run. The daily cap would need about 9,900 serves. | The dashboard showed "Not showing ads right now: today's daily budget is used up. It resets at midnight UTC." (user-reported). A later request returned no-fill (user-reported). |
| Pause and resume | Paused: no-fill. Resumed: the ad was served again (user-reported, output not seen). | Not run. |
| Verification date | 2026-11-04 | 2026-11-04 |
| Verification status | PARTIAL | PARTIAL |

Notes on the numbers:

- Spend per serve (0.0020) equals the default unit cost: CPM 2 divided by 1000. The real value comes from `ad_platform_settings`.
- Campaign B stopped at exactly its daily cap. 250 serves at 0.0020 is 0.5000. No overspend was seen.
- The loop script printed `fill=252 nofill=18 rate_limited=0` (270 requests). The server counted 250 serves, so the script counted at least 2 too many fills (the 250 includes one serve made before the loop). The script did not check the HTTP status of each request, and a failed request would leave the previous response file in place. That is a likely reason, but it is not confirmed. The server and dashboard number is the one recorded.

## 4. Budget and spend safety: result

- Daily cap stops paid delivery: seen on the dashboard for campaign B (spend equal to the cap, "used up" message). This was one TEST campaign run from a sequential script.
- Concurrent requests: **not tested.** A sequential script cannot show it. The protection exists in the database function (a row lock on the campaign, read in `supabase/sql/day-12-5-serve-ref-return.sql`) and its proof needs the real PostgreSQL TEST database integration tests (`tests/integration/day9-part5-db.test.ts`). Those were not run here. Pending.
- Duplicate spend from a retry: the retry key behavior is covered by existing mocked tests. Not tried on the Preview in this pass.
- Currency: integer cents in `lib/campaigns/money.ts` and `lib/campaigns/budget-rules.ts` (read in code, not run).

## 5. Contextual matching eligibility: result

- Valid campaign takes part in matching: seen for both campaigns (fill with the right category).
- Paused campaign is not served: user-reported for campaign A.
- Budget-exhausted campaign is not served: seen on the dashboard and user-reported for campaign B.
- Draft, pending review, rejected and expired campaigns: not tried on the Preview. The rules are in `lib/campaigns/delivery.ts` (read in code), and the existing mocked tests cover them.
- The ad object in the response held only the five public fields: seen by Claude. No advertiser, budget or campaign data appeared.
- No-fill remained a normal HTTP 200 answer (user-reported).
- Another advertiser cannot open this campaign: **not tried.** It needs a second TEST advertiser account. Pending.

## 6. Code and test changes

Claude read `lib/campaigns/budget-rules.ts`, `money.ts` and `delivery.ts`, and the locking part of the serve SQL. It found the required safeguards already there and did not change them. That reading was partial: it did not cover `queries.ts`, the campaign actions, or the full SQL function. No Step 3 product code or product test was changed, so no product test was run for Step 3.

Tests run in this pass:

- New: `tests/ads/phase3-step3-advertiser-pilot-report.test.ts` (document contract only). It was run in Claude's sandbox through a type-stripping helper, not through the project's own build. The result is in section 7.
- Previously completed tests were not repeated for Step 3. The existing document tests were rerun only to check that the new section did not break them.
- The user's earlier full test run in Termux (see `PHASE3-STEP2-FIRST-SERVE-VERIFICATION-REPORT.md`) had 3 failing timing tests. They are unrelated to the campaign flow, and they are still open.

## 7. Document test result

Run by Claude in its sandbox through a type-stripping helper (not the project's own build): the new report-contract test and the eight existing document tests, 222 tests, 222 pass, 0 fail. Of these, 11 are the new Step 3 tests and the rest are existing document tests. This shows the documents agree with their own rules. It is not a Preview result and not a result of the project's own TypeScript build. The user should type-check and run the new test in Termux with the project's own command:

```
npx tsc -p tsconfig.test.json
node --require ./tests/register.cjs --test .test-build/tests/ads/phase3-step3-advertiser-pilot-report.test.js
```

## 8. Pending

- Campaign B identifier.
- Other-advertiser access check on the Preview.
- Concurrency check on the real PostgreSQL TEST database.
- Draft, pending, rejected and expired campaigns on the Preview.
- Revoke of the TEST key, and a request with it returning 401. The key appeared in the chat several times.
- The 3 failing timing tests from the Step 2 report.
- Step 2 pending items (impression, click, latency, browser rendering).

## 9. Is the advertiser pilot ready in a controlled environment?

**Not declared ready.** In one TEST campaign the daily cap stopped delivery exactly at the cap, and pause stopped delivery, according to the user. That is good evidence for the two main safeguards. It is not enough: concurrency, ownership and the other ineligible states have no Preview result, and several earlier items are still pending. No real advertiser spending and no public launch.
