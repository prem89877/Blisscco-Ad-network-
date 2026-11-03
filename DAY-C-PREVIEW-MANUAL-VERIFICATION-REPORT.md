# Day C: Preview and Manual Verification Report

Date of this report: 2026-11-03 (updated the same day after the user's results). This is documentation only. Claude could not reach the Preview host from its own session (the network proxy refused it), so Claude ran no request. Every observed result below was run by the user on their own device (Termux on Android) and reported to Claude. No application code, SQL file, migration, workflow, test or secret was changed, and nothing was deployed by Claude.

Each check is labelled **Passed**, **Failed**, **Pending** or **User-confirmed — completed successfully**. "User-confirmed" means the user ran that exact check and told Claude the output matched the expected result. Claude did not see the raw output, so no status line is quoted beyond what the user reported.

## 1. Summary

| Area | Result |
|---|---|
| Publisher API key handling (valid, wrong, missing key) | **User-confirmed — completed successfully** |
| Ad match with an approved TEST campaign | **User-confirmed — completed successfully** |
| No-fill behavior (topic without a campaign, sensitive topic) | **User-confirmed — completed successfully** |
| Impression tracking, duplicate and changed token | **User-confirmed — completed successfully** |
| Click redirect, repeat click and changed reference | **User-confirmed — completed successfully** |
| Phase 2 Step 1: the 9 remaining Preview checks (section 4) | **User-confirmed — completed successfully** (run by the user on 2026-11-03) |
| Controlled Revive test | **Pending**, not approved, not run |

Day C is **not fully complete**: the 9 Phase 2 Step 1 checks were run by the user and reported as matching (section 4), but the controlled Revive test (not approved) and the follow-up in section 5 item 1 stay Pending. Day A and Day B stay as recorded in `DAY-B-CI-TEST-DB-VERIFICATION-REPORT.md`.

## 2. Environment

- Preview deployment: the Vercel Preview of the branch `preview-day-c` (a branch of the repository, one commit ahead of `main` when seen). The exact address was given by the user in chat and is not written here, because this repository is public. In notes, use the placeholder `https://YOUR-PREVIEW-HOST`.
- Preview data source: the dedicated TEST Supabase project. The user set the Preview-only Supabase values (project address, public key and server key) to the TEST project and redeployed. Sign-in through Google then worked on the Preview site, which shows the Preview is connected to that project. The Production Vercel deployment and its variables were not changed.
- Shared project note: the TEST project also holds tables of the user's other app (a store). The user states it holds only their own testing data. Test data created here: one TEST publisher, one TEST advertiser, one TEST campaign and creative.
- Tool used: `curl` and `jq` in Termux on Android. The publisher key was a dedicated TEST key and is not recorded here.

## 3. Results the user reported

| Step | Check | Expected | Result |
|---|---|---|---|
| 1 | `POST /api/v1/ads/match`, valid TEST key, topic `gaming` | 200, `fill: true`, `sponsored: true`, version header 1, `no-store` | **User-confirmed — completed successfully** |
| 2 | Wrong key, and no key | 401 for both | **User-confirmed — completed successfully** |
| 3 | Topic with no campaign, and the sensitive topic `health` | 200, `{"fill":false}`, no reason | **User-confirmed — completed successfully** |
| 4 | Match with the tracking opt-in header | 200, token and click reference present | **User-confirmed — completed successfully** |
| 5 | Impression with the token, same token again, changed token | `recorded`, `duplicate`, 401 | **User-confirmed — completed successfully** |
| 6 | Click with the reference, again, and with a changed reference | 302 to the stored destination twice, 404 for the changed reference | **User-confirmed — completed successfully** |

The user reported that every output matched the expected result exactly. Charges: the only charged event is the match request, against a tiny TEST budget in the TEST project. No real advertiser, publisher earning or payout was involved.

## 4. Phase 2 Step 1: the 9 Preview checks

All nine were run by the user in the dedicated Preview with a TEST publisher key. Claude could not reach the Preview host and did not see raw output. Each result below is what the user reported. No key, token, click reference or URL is recorded here.

| # | Check | Expected | Actual (as reported) | Status |
|---|---|---|---|---|
| 1 | Key in the query string (no Authorization header) | 401 | 401 | **User-confirmed — completed successfully** |
| 2 | Key in the request body (no Authorization header) | 401 | 401 | **User-confirmed — completed successfully** |
| 3 | After revoking the TEST key, the next match request | 401 | 401. A first attempt returned 200 because the key was still Active on the Publisher page (the revoke had not been done). After the revoke, the key showed Revoked and the next request returned 401. | **User-confirmed — completed successfully** |
| 4 | Key absent from page source, browser-visible content and logs | No match | Public pages (`/`, `/login`, `/privacy`, `/terms`): 0 matches from `curl`. The user then reported the page-source, in-page search and log checks as OK. The network tab was not separately reported. | **User-confirmed — completed successfully** (scope as reported by the user) |
| 5 | Match without the tracking header has no `tracking` object | `false` | `false` | **User-confirmed — completed successfully** |
| 6 | Wrong `Content-Type` | 415 | 415 | **User-confirmed — completed successfully** |
| 7 | Unknown request-body field | 400 | 400 | **User-confirmed — completed successfully** |
| 8 | Impression and click leave advertiser spend unchanged | Spend after = spend before | With a fresh token: impression `recorded`, same token `duplicate`, click 302. Campaign page spend after the events equalled spend after the match (S2 = S1). The match itself charges a small TEST amount, as designed. Exact amounts are not recorded here. | **User-confirmed — completed successfully** |
| 9 | Revive fallback disabled or unset in Preview | Unset | `REVIVE_FALLBACK_ENABLED` and `REVIVE_JSON_PREVIEW_ENABLED` are not set in Preview. `REVIVE_DELIVERY_URL` exists for Production only, not Preview. Nothing was changed or enabled. | **User-confirmed — completed successfully** |

Still Pending after this step:

| Check | Result |
|---|---|
| Controlled Revive test | **Pending**, not approved, not run |
| Advertiser campaign page error after adding a creative (section 5 item 1) | **Pending**. Investigated in Phase 2 Step 2 (see `PHASE2-STEP2-CAMPAIGN-PAGE-FIX-REPORT.md`). Not reproduced on a retry and no server error was logged, so the root cause is **not confirmed**. No code was changed. |

## 5. Observed problems and follow-up issues

1. **Campaign page error.** On the Preview site, the advertiser campaign page showed "Something went wrong" after a creative was added. The creative row itself was saved as a draft. **Phase 2 Step 2 result: root cause not confirmed, status Pending.** The earlier guess (a missing table, column or function in the TEST project) is not supported by the code: the page's data queries for creatives, spend and performance catch their own errors and show "Could not be loaded", so a missing function would not open the error screen. On 2026-11-03 the user saw a generic error screen once after tapping "Send for review" on an ad (the request logged at 10:00 IST took 8.1 s and returned 303; the ad did become "Waiting for review"). Vercel runtime logs for the Preview deployment for the following minutes were empty, and the only runtime error group in the last 3 hours was an unrelated sign-in code error on `/auth/confirm`. A retry on the same day completed in about 3 s with no error (as reported by the user). **Still needed:** a reproduction with a log line, within one hour (Hobby log retention). Details: `PHASE2-STEP2-CAMPAIGN-PAGE-FIX-REPORT.md`. **Pending.**
2. **Approving a creative by hand.** Setting a creative to `approved` in the database needs a review time (`reviewed_at`) set in the same save. The database rule is correct; this is a note for whoever approves rows by hand.
3. **Google sign-in role.** A new Google user is created as an advertiser. A publisher must sign up with the AI Publisher account type. This matches the code and is a usability note, not a defect in the checks.
4. **Preview setup needed fixes before sign-in worked:** the Preview used the wrong Supabase project at first, the TEST project did not allow the Preview address as a redirect, and the site address variable pointed at the Production site. All three were corrected by the user on Preview only.
5. **Key shared in chat.** The test key was pasted into a chat. The key was pasted in chat again during Phase 2 Step 1. It was revoked on the Publisher page in check 3 and returned 401 afterwards. Create a new TEST key only through the Publisher page if more testing is needed, and do not paste it in chat.

## 6. What the user confirms next

Section 4 now holds the nine Phase 2 Step 1 results. For the remaining Pending items (controlled Revive test, campaign page error), tell Claude which you ran and that the output matched. Each will then be changed to "User-confirmed — completed successfully". Share only status codes and non-secret parts of responses. Never share a key, a token, a click reference or a database address.

## 7. Safety statement

Production data was not accessed or modified, and the Production deployment and its variables were not changed. No real advertiser budget, publisher earning or payout action was used. No key, credential or database address is written in this report. Revive fallback was not enabled and no Revive endpoint was contacted. No migration or destructive SQL was run by Claude, no existing test was weakened and no code was deployed by Claude.
