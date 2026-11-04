# Phase 2 Step 5: Stabilization Exit Report

Date: 2026-11-04. Documentation and one report-contract test only. No product feature, application code, SQL file, migration, workflow, script or deployment setting was added or changed.

**Decision: READY FOR CONTROLLED PILOT**

## 1. Decision

Phase 2 stabilization exit criteria are met on the evidence recorded below, with the limits stated in sections 7 and 8. The decision is READY FOR CONTROLLED PILOT. It rests partly on the user's word: the cause and fix of the campaign page error (blocker B1, now closed), the Preview rechecks, GitHub CI and the TEST database run were reported by the user and Claude saw no log, run link or count for them. It does not mean Production is deployed or verified, and it does not cover the items that stay Pending in section 3.

An earlier version of this report said NOT READY because B1 had no confirmed cause. On 2026-11-04 the user reported the cause (section 8) and that it is fixed. The repository supports that account: the Phase 2 Step 4 guard handles a slow or failed button request. Section 12 records the review that supports it.

## 2. Scope and safety

- Source of truth: the repository in the uploaded archive and the Phase 1 and Phase 2 reports named in section 3. Claude had no access to the Preview host, GitHub or Production in this review.
- Status words: **Passed** (an automated run with a count that Claude or the user's visible output shows), **Failed**, **Pending** (not done, with its reason) and **User-confirmed** (the user's word that they ran it and it ended well; no log, link or count was seen).
- A written test is not treated as proof. A row is Passed only where a run with counts is on record.
- Nothing was run against Production. No secret, key, token or database address is recorded here.

## 3. Verification areas

Rows marked (critical) are the ones the decision depends on. The status documents record CI and the TEST database recheck as "Done (user's word only)"; that is the same evidence as User-confirmed here.

| # | Area | Status | Evidence |
|---|---|---|---|
| 1 | Day A: local npm checks (critical) | User-confirmed. Rests on the user's word; no output seen. | `DAY-B-CI-TEST-DB-VERIFICATION-REPORT.md` section 1 |
| 2 | Day B: GitHub CI on the current commit (critical) | User-confirmed. Rests on the user's word; no run link, commit or counts seen. Two earlier runs failed on document-test matching rules, not application code. | `DAY-B-CI-TEST-DB-VERIFICATION-REPORT.md` section 2, `.github/workflows/ci.yml` |
| 3 | Day B: TEST PostgreSQL run (critical) | User-confirmed. Rests on the user's word; no test count seen. | `DAY-B-CI-TEST-DB-VERIFICATION-REPORT.md` section 1, `.github/workflows/integration.yml` |
| 4 | Day B: database guard unit tests, sandbox | Passed, 24 of 24 tests (11 and 13), no database or network. | `tests/integration/day9-part5-guard.test.ts`, `tests/integration/day16-part5-workflow-guard.test.ts` |
| 5 | Day C: valid, wrong and missing key, match, no-fill, impression and click on Preview (critical) | User-confirmed. Rests on the user's word; no raw output seen. | `DAY-C-PREVIEW-MANUAL-VERIFICATION-REPORT.md` section 3 |
| 6 | Phase 2 Step 1: the nine remaining Preview checks (critical) | User-confirmed. Rests on the user's word; no raw output seen. | `DAY-C-PREVIEW-MANUAL-VERIFICATION-REPORT.md` section 4 |
| 7 | Controlled Revive test | Pending. Reason: Revive is not integrated and the test was never approved. | `DAY-C-PREVIEW-MANUAL-VERIFICATION-REPORT.md` section 1 |
| 8 | Campaign page root cause (critical) | User-confirmed. Rests on the user's word; on 2026-11-04 the user reported that the error was a slow button response across the whole website (any button click took long, an error showed while waiting, and a manual reload showed success) and that it is fixed. Claude saw no log or output. The server-side reason for the slow response was not diagnosed. | `PHASE2-STEP2-CAMPAIGN-PAGE-FIX-REPORT.md` section 4 |
| 9 | Campaign page rerun: add an ad, then send it for review (critical) | User-confirmed — currently not reproducible in Preview. Rests on the user's word; on 2026-11-04 the user checked the campaign page with a new advertiser account and the error did not reproduce. No error screen or reference code is recorded. The cause is in row 8. | `MVP-VERIFICATION-RUNBOOK.md`, `MVP-FEATURE-STATUS.md` |
| 10 | Step 3: match and authentication regression, mocked, sandbox (critical) | Passed, 506 of 506 tests. | `PHASE2-STEP3-AD-SERVING-REGRESSION-REPORT.md` section 5, `tests/ads/day10-part5-integration.test.ts`, `tests/ads/publisher-auth.test.ts`, `tests/ads/v1-route.test.ts` |
| 11 | Step 3: impression and click regression, mocked, sandbox (critical) | Passed, 357 of 357 tests. | `PHASE2-STEP3-AD-SERVING-REGRESSION-REPORT.md` section 5, `tests/ads/day12-part4-impression.test.ts`, `tests/ads/day17-part4-click-lifecycle.test.ts` |
| 12 | Step 3: whole suite in the sandbox | Failed, 4553 of 4563 tests passed in Step 3; 10 failures in 7 groups. Rerun in Step 5: 4586 of 4596 tests passed, the same 10 failures. The failing tests stop with a message that the Node type definitions are missing and ask for an install; the sandbox has no `node_modules`. | `PHASE2-STEP3-AD-SERVING-REGRESSION-REPORT.md` section 5, `tests/ads/day28-part1-publisher-types.test.ts`, `tests/ads/publisher-examples.test.ts` |
| 13 | Steps 3 and 4: Preview recheck after the changes (critical) | User-confirmed. Rests on the user's word; commands and output not seen. | `MVP-VERIFICATION-RUNBOOK.md`, `PHASE2-STEP3-AD-SERVING-REGRESSION-REPORT.md` section 6 |
| 14 | Steps 3 and 4: GitHub CI after the changes (critical) | User-confirmed. Rests on the user's word; no run link, commit or counts seen, so the files added in Step 5 are not covered. | `MVP-VERIFICATION-RUNBOOK.md`, `PHASE2-STEP4-DOCUMENTATION-ALIGNMENT-REPORT.md` section 6 |
| 15 | Steps 3 and 4: real PostgreSQL recheck on the TEST project | User-confirmed. Rests on the user's word; no test count seen. | `MVP-VERIFICATION-RUNBOOK.md`, `PHASE2-STEP3-AD-SERVING-REGRESSION-REPORT.md` section 6 |
| 16 | Step 4: Termux runs seen by Claude, baseline then after the edits | Passed, 35 of 35 tests after the edits (the baseline file ran 22 of 22). | `PHASE2-STEP4-DOCUMENTATION-ALIGNMENT-REPORT.md` section 5, `tests/publisher/day30-part3-onboarding-doc.test.ts`, `tests/ads/day30-part1-feature-status.test.ts` |
| 17 | Step 4: eight documentation-contract files, sandbox | Passed, 307 of 307 tests. | `PHASE2-STEP4-DOCUMENTATION-ALIGNMENT-REPORT.md` section 5, `tests/landing/day29-part4-trust-pages.test.ts`, `tests/ads/publisher-guide.test.ts` |
| 18 | Step 4: Termux rerun of the other documentation-contract files | User-confirmed. Rests on the user's word; output not seen. | `MVP-VERIFICATION-RUNBOOK.md`, `PHASE2-STEP4-DOCUMENTATION-ALIGNMENT-REPORT.md` section 6 |
| 19 | Documentation matches confirmed behavior (critical) | Passed, 163 of 163 tests in the five contract files rerun in Step 5, plus the corrections table in the Step 4 report. These tests read repository files only; they are not Preview evidence. | `PHASE2-STEP4-DOCUMENTATION-ALIGNMENT-REPORT.md` section 3, `tests/ads/day30-part4-verification-runbook.test.ts`, `tests/ads/day30-part5-handoff-report.test.ts` |
| 20 | Publisher example code run by hand | User-confirmed. Rests on the user's word; which example, which environment and the output were not given. The automated example tests are mocked. | `MVP-FEATURE-STATUS.md`, `tests/ads/publisher-examples.test.ts` |
| 21 | Runbook section 7 boxes | User-confirmed. 16 runbook boxes are ticked (7a 4, 7b 5, 7c 7), each dated and on the user's word. 21 stay unticked: 10 in section 7 (all of 7d, four setup items in 7a, one in 7b, one in 7c) and 11 elsewhere. | `MVP-VERIFICATION-RUNBOOK.md` |
| 22 | Revive preview route and scripts, Revive fallback wiring, real Revive endpoint and its billing or tracking | Pending. Reason: Revive is not integrated. That the Revive flags are unset in Preview is part of row 6. | `MVP-FEATURE-STATUS.md`, `DAY-C-PREVIEW-MANUAL-VERIFICATION-REPORT.md` section 4 |
| 23 | Payment checkout | Pending. Reason: no payment provider is integrated; payouts are a manual record. | `MVP-FEATURE-STATUS.md` |
| 24 | Publisher earnings, ledger and payout pages on Preview | Pending. Reason: no Preview check is recorded, and payment is not integrated. Outside MVP stabilization, as the user said on 2026-11-04. | `MVP-FEATURE-STATUS.md` |
| 25 | Admin review pages and manual creative approval on Preview | Pending. Reason: no Preview feature check with an admin account is recorded. Automated tests passed in Termux (see `PHASE2-STEP1-ADMIN-REVIEW-VERIFICATION-REPORT.md` section 1); that is not a Preview check. Outside MVP stabilization, as the user said on 2026-11-04. | `DAY-C-PREVIEW-MANUAL-VERIFICATION-REPORT.md` section 5, `PHASE2-STEP1-ADMIN-REVIEW-VERIFICATION-REPORT.md`, `MVP-FEATURE-STATUS.md` |
| 26 | Scheduled cleanup of old records | Pending. Reason: the TEST project has no `pg_cron` schedule, and the Production project was not looked at. | `PHASE2-STEP4-DOCUMENTATION-ALIGNMENT-REPORT.md` section 7, `MVP-FEATURE-STATUS.md` |
| 27 | Production deployment and data | Pending. Reason: never accessed, by design in this phase. | `MVP-FEATURE-STATUS.md` |
| 28 | Pilot gates in the safety checklist and the handoff report | Pending. Reason: these are steps before inviting a real publisher, outside the five stabilization criteria, and not assessed here. 65 and 18 boxes are unticked; Claude counted lines and did not read every box. | `MVP-PILOT-SAFETY-CHECKLIST.md`, `DAY30-MVP-HANDOFF-REPORT.md` |
| 29 | TEST publisher key pasted in chat, then revoked | User-confirmed. Rests on the user's word that the key returned 401 after the revoke. | `DAY-C-PREVIEW-MANUAL-VERIFICATION-REPORT.md` section 5 |

## 4. Critical stabilization criteria

| Criterion | Verdict | Basis |
|---|---|---|
| C1 Advertiser campaign-page error has a confirmed cause and safe resolution | Met | The cause and fix are user-confirmed (rows 8 and 9), on the user's word. The repository carries the Step 4 button guard that matches the reported behavior, and 275 of 275 focused tests pass (section 12). The server-side reason for the slow response is not diagnosed, see section 8. |
| C2 Remaining Preview checks are completed or explicitly pending with reasons | Met | Rows 5, 6 and 13 are user-confirmed. Rows 7 and 22 to 28 are Pending, each with its reason. |
| C3 Core ad matching, authentication, no-fill, impression and click regression checks are accurately recorded | Met | Automated rows 10 and 11 give counts. The failed whole-suite sandbox run (row 12) is recorded, not hidden. CI and database results are labeled as the user's word only. |
| C4 Documentation matches confirmed implementation behavior | Met | Row 19. The status documents were updated in Step 5 only where the user's report supports it, and the contract tests agree with them. Termux and CI runs of the Step 5 files are not done yet (section 9). |
| C5 Secrets and Production data remain protected | Met | No Production access (row 27). A one-off local pattern scan of the archive found no JWT-shaped string, no live publisher-key-shaped string and no private key block. Database-address-shaped and secret-key-shaped strings appear only in test files, with placeholder credentials. `.env` files are ignored by git and only `.env.example` is present. The scan is a pattern check, not a full audit. The TEST key pasted in chat was revoked (row 29). |

## 5. Automated test results

Automated means a test file ran against in-memory fakes or read repository files. It is not a Preview result and not a real database result. These are the runs made in this review, in Claude's sandbox (Node 22, no network, no `node_modules`; `tsc` reports a missing Node types error and still emits).

| File | Tests | Pass | Fail |
|---|---|---|---|
| `tests/ads/day30-part1-feature-status.test.ts` | 35 | 35 | 0 |
| `tests/ads/day30-part4-verification-runbook.test.ts` | 37 | 37 | 0 |
| `tests/ads/day30-part5-handoff-report.test.ts` | 27 | 27 | 0 |
| `tests/ads/day30-part2-pilot-safety-doc.test.ts` | 43 | 43 | 0 |
| `tests/ads/day10-part6-final.test.ts` | 21 | 21 | 0 |
| `tests/ads/phase2-step5-stabilization-exit-report.test.ts` (new, the focused report-contract test) | 22 | 22 | 0 |

The earlier automated results (Step 3 focused runs, the failed whole-suite run, Step 4 runs, the database guard tests) are in section 3 with their report files. The whole suite was also run in this review: 4596 tests, 4586 passed, 10 failed, none skipped. The 10 failures are the same 7 groups as in Step 3 (five in the publisher types file, two in the guide and example files). Each reports missing Node type definitions in a sandbox without `node_modules`. They are recorded as Failed here and are not hidden; a real install must be checked, and the user reports a good CI run (row 14).

A passing report-contract test shows the report is consistent with itself and with the two status documents. It does not show that any product check passed.

## 6. Manual Preview results

All were run by the user in the dedicated Preview with a TEST publisher key and reported to Claude, who could not reach the Preview host. No key, token, click reference or address is recorded.

- Day C: valid key returns the ad with the version header and no-store; wrong and missing key return 401; no-fill for a topic without a campaign and for the sensitive topic; tracking token and click reference only with the opt-in header; impression recorded, repeat is a duplicate, changed token is refused; click redirects to the stored destination, changed reference is refused (row 5).
- Phase 2 Step 1: key in query string or body refused, revoked key refused, key absent from page source and logs (scope as reported, network tab not separately reported), 415, 400, spend unchanged by impression and click, Revive flags unset (row 6).
- After the Step 3 and Step 4 changes: the same areas rechecked on Preview, reported on 2026-11-04 (row 13).
- Campaign page: the earlier run showed a generic error screen once and none on retry (Step 2 report). The rerun reported on 2026-11-04 is row 9.

Not run on Preview: the controlled Revive test, publisher earnings, ledger and payout pages, admin review pages.

## 7. User-confirmed results

These rest on the user's word only. No log, run link, commit or count was seen for any of them.

- Day A local npm checks, Day B GitHub CI and Day B TEST PostgreSQL run (rows 1 to 3).
- Preview checks of Day C and Phase 2 Step 1 (rows 5 and 6).
- On 2026-11-04: the campaign page rerun and the reported cause and fix of the campaign page error, the Preview recheck, the Termux rerun of the documentation-contract files, the publisher example code run, GitHub CI and the real PostgreSQL recheck (rows 9, 13, 14, 15, 18 and 20).
- 16 runbook boxes ticked, each with its date (row 21).
- CI and the database recheck carry no commit, so they may predate the Step 5 files.

## 8. Blockers

None. No open critical blocker.

**Closed: B1. Advertiser campaign page error.** The page showed a generic error screen once after a creative was added, on a request that took 8.1 seconds. On 2026-11-04 the user reported that the cause was a slow button response across the whole website: any button click took long, an error appeared while waiting, and a manual reload showed that the action had worked. The user reports it is fixed. This rests on the user's word. The Step 4 guard (`lib/actions/guard.ts`) limits the wait, always clears the loading state, refreshes the page state after a timeout or network error and shows no false success. Not known: why the server was slow. Slow responses may still occur during the pilot; the buttons now handle them, and they are to be watched (section 9).

## 9. Remaining work

Before inviting a real publisher (controlled pilot):

1. Copy the updated files into the repository, push, and note the GitHub CI run (link or date, commit, counts).
2. Work through `MVP-PILOT-SAFETY-CHECKLIST.md` and `DAY30-MVP-HANDOFF-REPORT.md`. Their unticked boxes are pilot gates, not assessed here (row 28).
3. Decide whether the scheduled cleanup of old records is switched on for the pilot project (row 26). The TEST project has no schedule and Production was not looked at.
4. Keep the Revive flags unset. The controlled Revive test is not part of this pilot.

During the pilot:

5. Watch for slow button responses and for any error screen. If one appears, send the time at once and whether a reference code is shown (Vercel Hobby keeps logs for one hour).
6. Payouts stay a manual record with no payment provider. Keep pilot amounts small and check each approved payout by hand.

Pending by choice, each with its reason in section 3: controlled Revive test, Revive rows, payment checkout, admin pages on Preview, scheduled cleanup, Production, pilot gates.

## 10. What changed in Step 5

| File | Change |
|---|---|
| `PHASE2-STABILIZATION-EXIT-REPORT.md` | New: this report |
| `tests/ads/phase2-step5-stabilization-exit-report.test.ts` | New: the focused report-contract test |
| `MVP-FEATURE-STATUS.md` | Phase 2 Step 5 status table (rerun, Termux rerun, example code); CI and database recheck rows as the user's word only; the campaign page row stays Pending |
| `MVP-VERIFICATION-RUNBOOK.md` | 16 boxes ticked in 7a, 7b and 7c with dates; Phase 2 Step 5 status table; CI and database recheck rows updated; section 7 limits note |
| `tests/ads/day30-part4-verification-runbook.test.ts` | Three assertions narrowed, as requested by the user, so ticked boxes can exist |

The three narrowed assertions in `tests/ads/day30-part4-verification-runbook.test.ts`, stated plainly: (1) each subsection of section 7 no longer needs four unticked boxes; it needs four checklist items, and 7d keeps the original rule (four unticked, none ticked); (2) the check that no box in the file is ticked now allows ticked boxes inside section 7 only; (3) the check for at least 30 unticked boxes now counts all boxes, ticked or not, with the same minimum. One new test requires every ticked box to carry a date and "User-reported", to sit in 7a, 7b or 7c, and to have a user-confirmed status row for its subsection. This departs from the earlier rule to leave the existing assertions unchanged; it was requested by the user and is recorded here so it is not hidden.

Left unticked on purpose: all of 7d, the setup items of 7a, the client-behavior item of 7b and the server-only item of 7c, because the user reported nothing for them. The result log table stays blank.

## 11. Safety statement

Production data and the Production deployment were not accessed or changed. No migration or destructive SQL was run. No publisher key, Supabase credential, database address or other secret is written in this report; the pattern scan printed only file names and counts. The Revive fallback was not enabled and no Revive endpoint was contacted. Nothing was deployed. Ledger, payout, revenue-share and advertiser-spend behavior was not changed. No test was weakened to hide a failure; the three narrowed assertions are named in section 10.

## 12. Review addendum (2026-11-04, second Step 5 review)

Decision at the start of this review: NOT READY, because B1 had no confirmed cause. Later the same day the user reported the cause and fix of B1 (section 8), so the decision is now READY FOR CONTROLLED PILOT.

**What was read and run.** Source of truth: the latest uploaded archive. Claude read the code and ran tests in its sandbox (Node 22, no network, no `node_modules`). No application file, SQL file, migration or workflow was changed. The status text in `MVP-FEATURE-STATUS.md` and `MVP-VERIFICATION-RUNBOOK.md` and two assertions about the campaign page row were updated, as described in section 13.

| Check | Result | Files |
|---|---|---|
| Step 4 button fix, shared guard, campaign, payout and guard tests plus payout and ledger tests, sandbox | Passed, 275 of 275 tests | `tests/workflows/phase2-action-guard.test.ts`, `tests/dashboard/phase2-button-actions-contract.test.ts`, `tests/campaigns/phase2-campaign-button-flow.test.ts`, `tests/payouts/phase2-payout-button-flow.test.ts`, `tests/payouts/day13-part4-payouts.test.ts`, `tests/ledger/day14-part5-financial-flows.test.ts` |
| Whole suite, sandbox | Failed, 4637 of 4647 tests passed; the same 10 sandbox-only failures as in section 5 (missing Node type definitions, no `node_modules`) | `tests/ads/day28-part1-publisher-types.test.ts`, `tests/ads/publisher-examples.test.ts` |
| Code reading: button wiring | Ten action forms use `lib/actions/use-guarded-action.ts` and `lib/actions/guard.ts` (20 second limit, double-tap lock, loading always cleared, refresh after a timeout or network error, no false success). Login, signup and log out use the form status hook. Read only; not a browser test. | `components/campaigns/RunStateButton.tsx`, `components/campaigns/CampaignReviewButton.tsx`, `components/dashboard/PayoutRequestForm.tsx`, `components/admin/PayoutActionButton.tsx` |
| Code reading: payout and ledger safety | The database function takes a publisher row lock, accepts one open request per publisher, treats a repeated request key as a duplicate, refuses an amount above the available balance, and checks the admin role again inside the database. No transfer code. Read only; the TEST database result stays as in section 7. | `app/dashboard/publisher/payout-actions.ts`, `app/dashboard/admin/payout-actions.ts`, `supabase/sql/day-13-9-payout-requests.sql` |

**Findings (none critical).**

- Non-blocking: after a successful payout request the page replaces the form with the "request in progress" message, so the success notice inside the form is not seen. The new status is shown on the page. Monitor during the pilot.
- Closed on the user's word: B1 (section 8). The Step 4 guard changes how a slow or failed request ends on screen, which matches the behavior the user describes. The reason the server was slow is not diagnosed; this is a known limitation to watch.
- Non-blocking, unexplained: one test in `tests/ads/day14-part4-integration.test.ts` (the Day 12 impression route, run against in-memory fakes) failed in 3 of 4 consecutive runs right after a full-suite run in Claude's sandbox, then passed in 19 further isolated runs and 3 further full-suite runs. The failure message was not captured, so the cause is unknown; it is not tied to the edits made in this review. If the same test fails in GitHub CI or Termux, send the failure lines. Treat it as a flaky test to watch, not as a confirmed product defect.
- Manual verification pending: everything listed as Pending in section 3. Claude could not reach Preview, GitHub, the TEST database or Production.

**Pilot note.** If an error appears again, send the time at once and whether a reference code is shown, as in section 9, item 5.

## 13. Changes made after the user's B1 report

| File | Change |
|---|---|
| `PHASE2-STABILIZATION-EXIT-REPORT.md` | Decision, rows 8 and 9, criterion C1, sections 1, 7, 8, 9 and 12 updated |
| `MVP-FEATURE-STATUS.md` | Campaign page row changed from Pending to closed on the user's word; one user-confirmed row added in the Phase 2 Step 5 status table |
| `MVP-VERIFICATION-RUNBOOK.md` | Same status change in the open-items tables and one user-confirmed row added in the Phase 2 Step 5 status table |
| `tests/ads/day30-part1-feature-status.test.ts` | One assertion changed, requested by the user's status report: the campaign page row must no longer be Pending, must say it rests on the user's word and that Claude saw no log, and the new user-confirmed row must exist |
| `tests/ads/phase2-step5-stabilization-exit-report.test.ts` | Two assertions changed for the same reason: the campaign page root cause row must be user-confirmed and say it rests on the user's word, and both status documents must carry the closed status and the new user-confirmed row |

These assertion changes follow a status change the user reported; they were not made to hide a failure. Nothing else in either test file was touched.
