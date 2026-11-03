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
| Remaining Day C items (section 4) | **Pending** |

Day C is **not complete**: the core API flow was run, but the items listed as Pending in section 4 were not run. Day A and Day B stay as recorded in `DAY-B-CI-TEST-DB-VERIFICATION-REPORT.md`.

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

## 4. Still Pending

| Check | Result |
|---|---|
| Key sent in the query string or the body is not accepted | **Pending** |
| Key absent from page source, network tab and logs | **Pending** |
| Revoking the key makes the next request answer 401 | **Pending** (revoke the test key when testing ends) |
| Match without the tracking header returns no `tracking` object | **Pending** |
| Wrong `Content-Type` answers 415, unknown body field answers 400 | **Pending** |
| Impressions and clicks leave spend unchanged | **Pending** |
| Revive fallback and Revive preview settings are unset in Preview | **Pending** (the Revive delivery address was seen set for the Production environment only, not for Preview; the flags in Preview were not looked at) |
| Controlled Revive test | **Pending**, not approved, not run |

## 5. Observed problems and follow-up issues

1. **Campaign page error.** On the Preview site, the advertiser campaign page showed "Something went wrong" after a creative was added. The creative row itself was saved as a draft. The cause is not known. A likely reason is a table, column or function from a later SQL file that is missing in the TEST project. Next step: read the Preview runtime log for that page and send the error line (no secrets). The API checks above do not depend on this page. **Pending follow-up.**
2. **Approving a creative by hand.** Setting a creative to `approved` in the database needs a review time (`reviewed_at`) set in the same save. The database rule is correct; this is a note for whoever approves rows by hand.
3. **Google sign-in role.** A new Google user is created as an advertiser. A publisher must sign up with the AI Publisher account type. This matches the code and is a usability note, not a defect in the checks.
4. **Preview setup needed fixes before sign-in worked:** the Preview used the wrong Supabase project at first, the TEST project did not allow the Preview address as a redirect, and the site address variable pointed at the Production site. All three were corrected by the user on Preview only.
5. **Key shared in chat.** The test key was pasted into a chat. Revoke it on the Publisher page now that the checks are finished, and create a new one if more testing is needed.

## 6. What the user confirms next

Tell Claude, one at a time, which Pending items in section 4 you ran and that the output matched. Each will then be changed to "User-confirmed — completed successfully". Share only status codes and non-secret parts of responses. Never share a key, a token, a click reference or a database address.

## 7. Safety statement

Production data was not accessed or modified, and the Production deployment and its variables were not changed. No real advertiser budget, publisher earning or payout action was used. No key, credential or database address is written in this report. Revive fallback was not enabled and no Revive endpoint was contacted. No migration or destructive SQL was run by Claude, no existing test was weakened and no code was deployed by Claude.
