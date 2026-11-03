# Day B: GitHub CI and TEST PostgreSQL Verification Report

Date of this report: 2026-11-02 (updated the same day after the user's confirmation). This is documentation only. No product feature, ledger, payout or revenue-share behavior, SQL file, migration, workflow, secret or deployment setting was changed.

GitHub CI and TEST PostgreSQL are reported separately. A passed CI run does not prove the real PostgreSQL checks, and a passed database check does not prove CI. Each result below is labelled **Passed**, **Failed**, **Pending** or **User-confirmed — completed successfully**.

**How to read "User-confirmed".** It means the user told Claude, in this conversation, that they personally completed that check and it ended well. Claude had no GitHub access in this session and did not read the final runs. No run link, commit identifier or final test count was given to Claude, so none is recorded here.

## 1. Phase 1 status

| Part | Scope | Result |
|---|---|---|
| Day A | Local npm checks: `npm ci`, `npm run lint`, `npm test`, `npm run lint:eslint`, `npm run build` | **User-confirmed — completed successfully** (these five commands are the same ones the CI workflow runs; see section 2) |
| Day B, GitHub CI | `.github/workflows/ci.yml` on the current commit | **User-confirmed — completed successfully** |
| Day B, TEST PostgreSQL | Manual workflow "DB integration (TEST database only)" against the dedicated TEST project | **User-confirmed — completed successfully** |

Phase 1 (Day A and Day B) is therefore recorded as completed successfully on the user's confirmation. The two Day B results are independent: CI does not prove the database result, and the database result does not prove CI.

What Phase 1 does not cover: Preview deployment checks, a real Revive endpoint, and the pilot gates in `DAY30-MVP-HANDOFF-REPORT.md` and `MVP-PILOT-SAFETY-CHECKLIST.md`. Those stay open. Production was never touched.

## 2. GitHub CI

### Intended checks (from `.github/workflows/ci.yml`)

The workflow runs on every push and pull request, on `ubuntu-latest`, with a 20 minute limit, read-only repository permission and no repository secrets. Its steps, in order:

1. `npm ci` (lockfile only).
2. `npm ls next react react-dom` (informational).
3. Type check: `npm run lint` (`tsc --noEmit`).
4. Tests: `npm test`.
5. ESLint: `npm run lint:eslint`.
6. Production build: `npm run build`, with dummy Supabase values only.

Steps 4 to 6 use `if: !cancelled()`, so one failure does not hide the others, and the job stays red.

### History of the runs the user showed Claude

| Run | Tests (`npm test`) | Result |
|---|---|---|
| First run shown | 4407 tests, 4406 pass, 1 fail | **Failed** (Tests step) |
| Second run shown (11:02 IST) | 4559 tests, 4555 pass, 4 fail, 0 skipped | **Failed** (Tests step) |
| Latest run | Not shown to Claude | **User-confirmed — completed successfully** |

Both failed runs were caused by test files, not by the application:

- Day 29 Part 5 report-contract test treated a module name in prose as a file path (1 failure).
- Day 30 Part 3 and Part 4 document tests had four failing checks: a table cell length limit, the HTTP method `POST` read as the verb "post", and the word "passed" in a sentence about a rate-limit pause.

The fixes only corrected the matching rules; no assertion was removed. The user pushed them and reported that those test files then passed in CI, and later confirmed the CI check completed successfully.

## 3. TEST PostgreSQL configuration

What the repository requires (from `integration.yml` and the guard):

- `TEST_DATABASE_URL`: a `postgres://` or `postgresql://` URL of the dedicated TEST project (repository secret).
- `TEST_SUPABASE_PROJECT_REF`: the TEST project reference (repository secret).
- `TEST_DB_CONFIRM`: fixed text in the workflow itself, not a secret.

The user added both secrets in GitHub, using the TEST project's reference, and changed the TEST project's database password. Claude never saw a secret value and none is printed here. The project reference appears in the connection user name, which is what the guard checks. A guard that accepted the settings and database suites that started (instead of being skipped) are consistent with this.

## 4. TEST database guard

Code review of `tests/integration/test-db-guard.ts`. The guard returns "not ok" when:

- `TEST_DATABASE_URL` is missing or blank.
- `TEST_DB_CONFIRM` is not the fixed confirmation text.
- `NODE_ENV` or `VERCEL_ENV` is `production`.
- The URL is not a postgres URL.
- `TEST_SUPABASE_PROJECT_REF` is missing, or does not appear inside `TEST_DATABASE_URL` (a mismatched project).
- The TEST project reference equals the Production Supabase project reference, or the TEST URL contains a Production identifier or equals a Production database URL setting.

The workflow adds its own preflight: all three values present, fixed confirmation text, postgres URL shape, and the URL must contain the project reference. Values are never printed. After the tests it also fails the run if zero tests passed or any test was skipped.

Guard unit tests that Claude ran in a sandbox, without any database, network or secret:

| Test file | Tests | Result |
|---|---|---|
| `tests/integration/day9-part5-guard.test.ts` | 11 | **Passed** |
| `tests/integration/day16-part5-workflow-guard.test.ts` | 13 | **Passed** |

The guard was not bypassed or changed. The guard tests also appeared as passing in the log the user pasted from the database workflow.

## 5. Real PostgreSQL integration checks

Command: `npm run test:integration`, started by hand through the workflow "DB integration (TEST database only)". It was run several times; the results are kept here because each failure had a real cause.

| Attempt | What the log showed | Cause | Fix |
|---|---|---|---|
| 1 | 75 tests, 24 pass, 51 cancelled, exit code 1; `getaddrinfo EAI_AGAIN postgres` | `TEST_DATABASE_URL` was malformed, so the host was read as `postgres` | User corrected the secret |
| 2 | `password authentication failed` (code `28P01`) | Wrong or badly formed password in the secret | User reset the TEST database password and updated the secret |
| 3 | 70 pass, 5 fail | One test set a creative to `rejected` without the required rejection reason (database rule `ad_creatives_rejection_reason_check`); the database rule was correct, the test setup was not | Test setup supplies a reason when it rejects a creative (`day9-part5-db.test.ts`) |
| 4 | 71 pass, 4 fail | (a) Three Day 9 tests open 20 to 25 connections at once, but the Session pooler allows 15 (`EMAXCONNSESSION`). (b) A Day 16 Part 1 test added traffic to the same publisher whose totals a later test checks (8, 4, 50 instead of 5, 3, 60) | (a) User switched the secret to the Transaction pooler. (b) The earlier test now uses the suspended publisher for its traffic (`day16-part1-analytics-db.test.ts`) |
| Latest | Not shown to Claude | | **User-confirmed — completed successfully** |

Changes made to the test files were setup and data only. No assertion was changed, no SQL file or migration was edited or run by Claude, and the guard was not touched. The database tests write and delete only rows they tag themselves.

No Production database was involved.

## 6. User confirmations

Recorded, each for that one check only, on the user's statement in this conversation:

- Day A, local npm checks: **User-confirmed — completed successfully**.
- Day B, GitHub CI: **User-confirmed — completed successfully**.
- Day B, TEST PostgreSQL integration run: **User-confirmed — completed successfully**.

Not recorded as confirmed: any Preview deployment check, any real Revive endpoint check, and the pilot gates. If you want the run link, date and commit identifier kept for the record, add them to the result log in `MVP-VERIFICATION-RUNBOOK.md`.

## 7. Safety statement

Production Supabase and the Production database were not accessed, modified or tested. The guard was not changed. No migration or destructive SQL was run by Claude. No credential, connection string or key was printed or committed. No real Revive endpoint was called and nothing was deployed.
