# Phase 3 Step 1: Controlled Pilot Preparation Report

Date: 2026-11-04. Documentation and one report-contract test only. No product feature, application code, SQL file, migration, workflow, script, environment value or deployment setting was added or changed. Nothing was run against Preview, TEST database or Production.

**Status: PILOT PREPARED ON PAPER. NOT STARTED. NOT APPROVED. NOT A PUBLIC LAUNCH.**

Update 2026-11-04: the user ran the Gate A error-case checks by hand on the Preview and reported the results (section 10). They are the user's word only. The gates stay NOT CONFIRMED in the safety checklist.

The publisher API is not declared ready for production use or for real pilot traffic (section 5).

## 1. Changed files

| Path | Change |
|---|---|
| `MVP-PILOT-SAFETY-CHECKLIST.md` | Added sections 10 (pilot scope, budget caps, eligibility, credentials, manual payouts, revoke-first, stop conditions, pilot sign-off table), 11 (observation checklist and record format) and 12 (limits). Sections 1 to 9 are unchanged. |
| `PUBLISHER-PILOT-ONBOARDING.md` | Added a pilot note in the introduction, two pilot bullets in section 1, section 10 (approval, what is sent, ad relevance, no-fill, tracking limits, revoke-key steps, pilot publisher checklist) and section 11 (observation records). Sections 2 to 9 are unchanged. |
| `PHASE3-STEP1-PILOT-PREPARATION-REPORT.md` | New: this report. |
| `tests/ads/phase3-step1-pilot-preparation.test.ts` | New: a focused report-contract test. It reads repository files only. |

## 2. What was prepared

- Scope: at most 1 trusted chatbot publisher, at most 2 early advertisers, small capped budgets, Blisscco contextual ads only, Revive fallback off, manual payouts only, no public self-service onboarding. Written as unticked boxes in safety checklist section 10a.
- Publisher onboarding: manual approval, server-side key, no conversation text or personal data sent, relevance, no-fill and tracking limits explained, revoke-key steps, and a pilot publisher checklist (onboarding section 10).
- Monitoring: the eight observations you listed, where each can be seen today, an observation checklist and a record format with date, environment, method, actual result and source (safety checklist section 11). No number is filled in.
- Safety limits: caps, eligibility, credentials, manual payout approval, revoke-first and stop conditions (safety checklist section 10).
- API contracts, routes, SQL, ledger, payout rules and the Revive flags were not touched.

## 3. Findings from reading the code

These were read, not run.

1. **The application has no pilot budget cap.** `lib/campaigns/constants.ts` has a small minimum and a very high maximum for every advertiser. The pilot cap is therefore a manual rule applied by the admin at review. The cap amounts are not set, and this report invents none.
2. **No latency figure and no no-fill counter was found** in the application or its dashboards. The ad handlers write no logs. Latency and no-fill counts have to be measured on the publisher side or by the tester, and are recorded as measured or as not measured.
3. **"No public self-service onboarding" is a rule for people, not for code.** The signup page is public in the code. New accounts wait for approval, so the rule is to approve only the named pilot accounts and not promote the signup page.
4. **The earnings page does not track pending, approved or paid-out balances.** The approver keeps a separate written record of each payout.

## 4. Pending

- Owner decisions, all blank today: the cap per campaign and in total, the payout maximum, the named approver, the stop thresholds for 503s and button errors, and the observation dates.
- Safety checklist sections 2 to 7 and every new box in sections 10 and 11 and in onboarding section 10: all unticked. Each needs a person, a date and evidence.
- Gate A: the error-case results are user-reported (section 10). Still pending for Gate A: the response headers, a real ad with `sponsored: true` and only the public fields, and the 429 and 503 handling in the publisher's code.
- Gates B, C and D: nothing reported. Gate D needs the publisher's written confirmation.
- Revoke of the TEST key that appeared in a chat during the Gate A checks: not reported yet, so it is pending (section 10).
- A practised revoke on a TEST key (section 10e).
- The decision on the scheduled cleanup of old records (open since the Phase 2 exit report).
- A GitHub CI run on the commit that holds these files. The earlier CI results rest on the user's word and carry no commit.
- Manual Preview checks. None is declared done by this report. The earlier ones stay as the Phase 2 reports record them: User-confirmed, on the user's word, with no output seen.
- A real publisher integration has never been tested. The examples are mocked, and the one hand run of example code is on the user's word.

## 5. Is the publisher API safe for real pilot traffic?

**No. It is not declared ready.** Based on the existing evidence:

- The publisher guide itself says the API is not ready for production use, no staging environment is published and the contract can still change.
- Gates A to D in the safety checklist are all NOT CONFIRMED. The Preview results in the Day C report and the Gate A error-case results in section 10 rest on the user's word, with no raw output seen. They do not replace the dated, signed gate records the checklist asks for.
- Production was never accessed or checked, by design.
- The reason for the slow button responses found in Phase 2 was not diagnosed. A test in `tests/ads/day14-part4-integration.test.ts` failed intermittently once in Claude's sandbox and the cause is unknown.
- The pilot caps, payout maximum and stop thresholds are not set, and the scheduled cleanup is undecided.

The Phase 2 decision (READY FOR CONTROLLED PILOT) stays as written there. It means the preparation may go ahead. It does not mean real traffic may start.

## 6. External or manual configuration required

- A Preview or TEST deployment that uses TEST project values only, and a TEST publisher key made on the Publisher page.
- The API base URL for the pilot publisher, given by Blisscco. The repository publishes no host.
- An admin account to approve the one publisher, the one or two advertisers, their campaigns and the payouts.
- The Vercel dashboard check that both Revive flags are absent in Preview and Production, and that each secret is marked Sensitive. Claude had no access to Vercel.
- A written decision by the owner for each blank in section 4.
- A trusted chatbot publisher who has read onboarding sections 4, 10 and the guide.

## 7. Dependencies for the next Phase 3 step

1. The owner decisions in section 4, written down.
2. Gate A: the remaining items (headers, a real ad, 429 and 503 handling). Gates B, C and D run on TEST or Preview by a person, with dates, and recorded in the safety checklist.
3. The exposure checks (safety checklist section 6) done by a person.
4. A GitHub CI run with a link, a commit and counts, and a Termux rerun of the three document-contract files plus the new test.
5. A written decision on the scheduled cleanup.
6. A decision on whether a first dry run with a TEST publisher key should come before any real publisher.

## 8. Tests

- Before the edits, in Termux and seen by Claude: the three document-contract files (`tests/ads/day30-part2-pilot-safety-doc.test.ts`, `tests/ads/day30-part5-handoff-report.test.ts`, `tests/publisher/day30-part3-onboarding-doc.test.ts`) ran 92 of 92 tests with 0 failures. That is the baseline.
- After the edits: Claude ran the same three files and the new test in its own sandbox. Those results are in the reply that delivered this report. They are not Termux results. A Termux rerun is the next step.
- The Gate A results in section 10 are not test results. They are the user's manual Preview checks, reported without raw output.
- A passing document test shows the files agree with their own rules. It does not show that any product check passed.
- Earlier results were reused, not rerun: the Phase 2 Step 3 and Step 5 runs and the user-confirmed items.

## 9. Safety statement

Production data, the Production deployment and real payout data were not accessed or changed. No migration or SQL was run. No key, secret, token, database address or Revive address is written in any changed file. The Revive fallback was not enabled. Ledger, payout, revenue-share and advertiser-spend behavior was not changed, and no financial safeguard was weakened. No existing test was edited.

## 10. Gate A checks reported by the user (2026-11-04)

The user ran these requests by hand with a rest client app on the dedicated Preview, using a TEST publisher key, against `POST /api/v1/ads/match`. Claude saw the response bodies the user typed in and no screenshot of the responses, no response headers and no status line. The status code in the last column is the one that belongs to the reported error body in the code (`lib/ads/match-handler.ts`, `lib/ads/validation.ts`), not a number the user reported. Every row is **User-reported**, on the user's word only.

| # | Request | Result reported | Expected status |
|---|---|---|---|
| 0 | Valid key, body with only a topic | 200 with the no-fill answer `{"fill":false}` | 200 |
| 1 | Wrong key | `unauthorized` | 401 |
| 2 | Extra body field | `invalid_request` with the reason `unknown_field` | 400 |
| 3 | Content type `text/plain` | `unsupported_media_type` | 415 |
| 4 | Body above the 2048 byte limit | `payload_too_large` | 413 |

What this does and does not show:

- It agrees with the Gate A items for 401, 400, 415 and 413, and it shows a valid request ending in a normal 200 no-fill. The same checks were reported earlier in the Day C and Phase 2 Step 1 reports. This is a second report, not independent proof.
- The no-fill answer shows that no eligible campaign existed for the topic used on that Preview at that time. It does not show that an ad can be served.
- Gate A stays NOT CONFIRMED. Still pending: the response headers `Cache-Control: no-store` and `X-Blisscco-Api-Version: 1`, a real ad with `sponsored: true` and only the public fields (this needs an active approved campaign in the topic used), and the 429 and 503 handling in the publisher's code.
- The reported checks ran against the Preview. They are not a Production check and not real pilot traffic.
- The environment is the dedicated Preview. No Production service was contacted by Claude, and Claude contacted no service at all.

Key handling during these checks:

- The TEST key appeared in a chat message. The checklist rule is to revoke first (`MVP-PILOT-SAFETY-CHECKLIST.md`, section 10e). The user said it would be revoked after the checks. A revoke has not been reported, so it is pending.
- After the revoke, one valid request must return 401. That result is pending too.
- No key value is written in any file of this repository.

## 11. Cross-document status after the Gate A report

Documents from earlier steps are dated records of their own step. They were not edited, so that their own contract tests keep their meaning. Each "pending" in them is still accurate. This table says why.

| Document | Statement | Still accurate |
|---|---|---|
| `PHASE2-STABILIZATION-EXIT-REPORT.md`, row 28 | Pilot gates are Pending and not assessed | Yes. It describes that report's date. Gate A is only partly user-reported (section 10) and Gates B to D have no report. |
| `DAY30-MVP-HANDOFF-REPORT.md` | Every box before a first real pilot is empty | Yes. No box is ticked by anyone with evidence. |
| `DAY-B-CI-TEST-DB-VERIFICATION-REPORT.md` | The pilot gates stay open | Yes. |
| `MVP-PILOT-SAFETY-CHECKLIST.md`, sections 7 and 12 | Every gate is NOT CONFIRMED | Yes. Section 12 now points here for the partial Gate A report. |
| `MVP-FEATURE-STATUS.md`, `MVP-VERIFICATION-RUNBOOK.md` | Preview checks are user-confirmed and a few items stay Pending | Yes. Nothing in them is contradicted by section 10. Their contract tests allow a positive user-confirmed row only under a Phase 2 status heading, so the Phase 3 report is the one place that holds this record. |

If the owner wants these results moved into the status documents or the runbook result log, the contract tests for those two files must be changed first, as a separate and named decision.
