# Phase 2, Step 4: Documentation and Implementation Alignment Report

Date: 2026-11-03. Result: **documents were aligned with the code and the earlier reports. One public page (`app/privacy/page.tsx`) got two clarifying paragraphs. The documentation-contract files ran in Claude's sandbox (results in section 5). A rerun in Termux and in GitHub CI after these edits is Pending.** No product feature was added.

## 1. Scope and safety

- Documentation, one public text page and one documentation-contract test changed. Nothing else.
- Production data, Production credentials, publisher keys, Supabase values and database URLs were not accessed or written.
- No SQL, migration, workflow or script was run, added or changed. No Revive endpoint was contacted and the fallback was not enabled. Nothing was deployed.
- Ad serving, authentication, ledger, payout, revenue-share and advertiser-spend code was not touched.
- No existing assertion was removed or loosened. The tests only gained one narrow exception and new checks (section 4).

## 2. Files changed

| File | Change |
|---|---|
| `PUBLISHER-PILOT-ONBOARDING.md` | Section 5 rewritten from the real handlers; new section 9 (where evidence lives); account status and retry wording corrected |
| `MVP-FEATURE-STATUS.md` | Status-update paragraph, scoped pending list, corrected "not integrated" line, new evidence section |
| `MVP-VERIFICATION-RUNBOOK.md` | New "Phase 2 Step 4 status" section and a limits bullet |
| `app/privacy/page.tsx` | Last-updated date, two clarifying paragraphs |
| `tests/ads/day30-part1-feature-status.test.ts` | New exception for exact user-confirmed rows; new Step 4 checks |
| `PHASE2-STEP4-DOCUMENTATION-ALIGNMENT-REPORT.md` | This report |

Reviewed and left unchanged: `app/dashboard/publisher/guide/page.tsx` (the existing publisher integration guide) and `app/terms/page.tsx`. No contradiction with the code or the reports was found in either.

## 3. Claims corrected and the evidence used

| # | Claim before | Correction | Evidence |
|---|---|---|---|
| 1 | Only a Suspended account fails with 401 | Any account that is not approved (Waiting for approval or Suspended) fails with 401 | Guide troubleshooting table, 401 rows |
| 2 | Impression and click rows listed no errors | Impression: 400, 401, 413, 415, 429, 503. Click: 400, 404, 405, 429, 503 | Guide impression and click error tables |
| 3 | Match request and response fields were scattered | Request fields, limits and header rules and the response shape (200 ad, 200 no-fill, 503 `fill:false` with `error`) stated in one place | `lib/ads/validation.ts`, `lib/ads/match-handler.ts`, guide |
| 4 | "Retry only 429 and 5xx, pause of at least one second" | 429: wait for `Retry-After` (60 s), then send once. 5xx and network errors: retry once or twice after 1 s or more, same `Idempotency-Key` | `lib/ads/match-handler.ts` (`Retry-After: 60`), guide |
| 5 | Version header `X-Blisscco-Api-Version: 1` not mentioned | Added | `app/api/v1/ads/match/route.ts`; Preview: user-confirmed, Day C step 1 |
| 6 | Feature status said "nothing was run" and every check pending | Original text kept and scoped. New evidence section separates automated, Preview, user-confirmed, pending and unverified | Day B, Day C, Step 2 and Step 3 reports |
| 7 | "A deployed Preview or Production environment that has been checked: nothing confirms either" | Preview was checked by hand for the listed routes only. Production was never accessed | Day C report |
| 8 | Runbook held only the Step 1 and Step 3 rows | Added the Day C core checks and the open items | Day C report, section 3 |
| 9 | Privacy: "does not receive ... prompts" read as if no bytes arrive | Kept, and added that the API reads a request only to check it, does not write the body to the database and does not log it, while the host may keep standard logs | `lib/ads/match-handler.ts` has no logging and no `console` call; Preview: unknown field gives 400 (user-confirmed) |
| 10 | Privacy: retention "set up to be removed" | Added that the cleanup relies on a database job that is switched on separately, so the periods are targets | `supabase/sql/day-7-1-budget-keys-retention.sql` runs the schedule only if `pg_cron` is on |

Terms: no guarantee of ad fill, earnings or results is made (they say the opposite). Neither page mentions Revive, compliance or certification. No edit was needed.

## 4. Test change

`tests/ads/day30-part1-feature-status.test.ts`:

- The "verified, confirmed, tested, passed" sentence check now skips only a table row in the exact shape `| a | b | **User-confirmed — completed successfully** |`, the same shape the runbook test already allows.
- New checks: the five evidence kinds exist; the original "Nothing was run to write it" text stays; user-confirmed rows appear only under a "Phase 2 Step N status" heading and never name CI, build, lint, npm or a database; Revive, Production, the campaign page error, example code and cleanup stay Pending or Unverified; privacy and terms make no compliance, certification, guarantee or Revive claim.

## 5. Commands and actual results

Termux (user-run, Node 24, Android), before the Step 4 edits, output seen by Claude:

| Run | Tests | Pass | Fail |
|---|---|---|---|
| `tests/publisher/day30-part3-onboarding-doc` (baseline) | 22 | 22 | 0 |

`npm ci` there printed an engine warning (Node 24, project wants 22) and one install-script notice. Neither affected the run.

Claude's sandbox (Node 22, no network, no `node_modules`; `tsc` reports `TS2688` for missing Node types and still emits): the results of the runs after the edits are filled in below.

| Run (after the edits, sandbox) | Tests | Pass | Fail |
|---|---|---|---|
| `tests/ads/day30-part1-feature-status` (focused file, changed) | 35 | 35 | 0 |
| `tests/ads/day30-part4-verification-runbook` | 36 | 36 | 0 |
| `tests/publisher/day30-part3-onboarding-doc` | 22 | 22 | 0 |
| `tests/landing/day29-part4-trust-pages` | 27 | 27 | 0 |
| `tests/ads/publisher-guide` | 96 | 96 | 0 |
| `tests/ads/day30-part5-handoff-report` | 27 | 27 | 0 |
| `tests/ads/day10-part6-final` | 21 | 21 | 0 |
| `tests/ads/day30-part2-pilot-safety-doc` | 43 | 43 | 0 |

The first run after the edits had two failing files (feature status: one sentence with "confirmed" and no negation; runbook: a new table row starting with "Preview" was counted as a blank result-log row). Both were wording fixes in the documents. No assertion was changed to make them pass.

## 6. Still Pending or unverified

- Termux rerun of the changed documentation-contract files after the edits: **Pending** (user to run).
- GitHub CI for the files changed here: **Pending**. Real PostgreSQL recheck: **Pending**, no database file changed.
- Preview recheck of the match, impression and click routes after Step 3 and Step 4: **Pending**. The last Preview results are the user-confirmed ones from Day C.
- Advertiser campaign page error: **Pending**, root cause not found.
- Controlled Revive test: **Pending**, not approved. Revive fallback and preview route: **Unverified**.
- Whether the scheduled cleanup of old records is on in any database: **Unverified**.
- Publisher example code against a real API, and Production: **Unverified**.

## 7. Limitations of this step

- The old "Known verification limitations" list in the feature status is kept because the old test requires its wording. It is scoped by a lead-in sentence, not rewritten item by item.
- User-confirmed means the user's word only. No log, run link or counts were seen for CI, the database run or the Preview checks.
- Several contract tests guard the edited files, so more than one documentation test file was run in the sandbox. The full suite was not run.
