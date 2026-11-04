# Blisscco MVP Verification Runbook (Day 30 Part 4)

This is a runbook for a person to follow after MVP completion. It is documentation only. Nothing was run to write it: no install, lint, test, ESLint, build, database check or live endpoint check, and no service was contacted.

Every box and every result row below starts empty. No step is confirmed by this document. A box is ticked only by the person who ran the step, with the date.

Status update (Phase 2 Step 5): some boxes in 7a, 7b and 7c were ticked on the user's report, each with the date. See the Phase 2 Step 5 status table. The statement above describes the original authoring.

Related files: `scripts/day28-verify.sh`, `DAY28-VERIFICATION-GUIDE.md`, `MVP-PILOT-SAFETY-CHECKLIST.md`, `DAY27-REAL-REVIVE-VERIFICATION.md`.

## 1. Rules

- Run each step only in the environment named for it in section 2.
- Stop at the first failing step, fix it, and start that step again.
- Do not paste a key, secret, token, database URL or Revive delivery URL into this file, a ticket, a chat, a screenshot or a pull request.
- If a log must go to someone else, read it once first and remove any value that looks like a credential.
- No step in this runbook changes a workflow, a SQL file, a migration or an environment value.

## 2. Environments

| Environment | Where it runs | Data and credentials | What this runbook does there |
|---|---|---|---|
| Local | Your own machine, Node major version from `.nvmrc` | No real credentials; the helper script clears them | Steps 1 to 5 |
| CI | GitHub Actions, `.github/workflows/ci.yml`, on push and pull request | Dummy build values only; no repository secrets | Step 6 |
| Preview | A Vercel Preview deployment | TEST project values, never real Production values | Manual checks in section 7 |
| TEST database | A separate TEST PostgreSQL project, `.github/workflows/integration.yml` started by hand | TEST secrets only; a guard refuses a Production database | Step 7 |
| Production | The live service and its database | Real data and real credentials | Not used by this runbook; no step reads, writes or contacts it |

## 3. Verification order

Run the steps in this order. Steps 1 to 5 are the local and CI commands. Step 6 is the GitHub CI run. Step 7 is separate and guarded.

1. `npm ci` (Local, CI): exact install from `package-lock.json`.
2. `npm run lint` (Local, CI): TypeScript type check.
3. `npm test` (Local, CI): compiles and runs the unit test suite.
4. `npm run lint:eslint` (Local, CI): ESLint through `next lint`.
5. `npm run build` (Local, CI): production build of the Next.js app, with dummy public-shaped values only.
6. GitHub CI (CI): the `.github/workflows/ci.yml` run for the pushed commit or pull request.
7. TEST PostgreSQL checks (TEST database): a separate, guarded run, never part of steps 1 to 6.

Notes:

- Step 1 needs network access to the npm registry. It removes and recreates `node_modules`.
- Step 3 skips the real database tests here, because no TEST database settings are present in a clean local or CI environment.
- A step that was skipped or not reached is not a success. Record it as not run.

## 4. Existing local helper

`scripts/day28-verify.sh` already runs steps 1 to 5 in this order and stops at the first failure. `DAY28-VERIFICATION-GUIDE.md` explains its requirements, exit codes and clean-environment behaviour.

- Run it with `bash scripts/day28-verify.sh` from any folder, using the Node version in `.nvmrc`.
- This runbook adds no second verification script and does not replace the helper.
- The helper never contacts a database, runs no SQL, makes no deployment and calls no Revive endpoint.
- This document does not say the helper has been run, and nothing here claims it has succeeded. Its result is whatever your own run prints.
- The helper is a local check only. It does not replace step 6, and it says nothing about Preview or Production.

## 5. GitHub CI (step 6)

- [ ] The run for the commit under test is complete and the job is not red.
- [ ] The order of the steps in the run matches section 3: install, `npm ls` (informational), type check, tests, ESLint, build.
- [ ] No step in the run was skipped.
- [ ] The run used no repository secrets and only dummy build values.

Record the run link and date in section 8. Do not copy log text that contains a value.

Day B status (see `DAY-B-CI-TEST-DB-VERIFICATION-REPORT.md`): **Done, on the user's word only.** Two earlier runs were red at the Tests step because of test files, and the causes were corrected. The user later reported that the CI check finished with a good result. Claude did not read the run, and no run link or commit identifier was given, so the result log below stays blank until a person fills it.

## 6. TEST PostgreSQL checks (step 7)

These checks run only against the separate TEST project. They are never part of the local helper and never use Production credentials.

- [ ] The TEST project and the Production project have different project references.
- [ ] The repository secrets `TEST_DATABASE_URL` and `TEST_SUPABASE_PROJECT_REF` belong to the TEST project, and `TEST_DB_CONFIRM` is set by the workflow itself.
- [ ] The workflow "DB integration (TEST database only)" is started by hand (it has no push or pull request trigger).
- [ ] The preflight step reports that all three settings are present, without printing a value.
- [ ] The guard in `tests/integration/test-db-guard.ts` is unchanged and refuses a Production environment.
- [ ] The run reports at least one passing test and no skipped test. A skipped database test is not a success.
- [ ] No database URL appears in any log, ticket or chat.

Day B status (see `DAY-B-CI-TEST-DB-VERIFICATION-REPORT.md`): **Done, on the user's word only.** The manual workflow was run several times. Earlier runs were red for fixable reasons: a malformed address secret, a wrong password, two test setup problems and a connection limit of the Session pooler (the secret now uses the Transaction pooler). The user reported that the latest run finished with a good result. Claude did not read that run, and no database test count was given. The guard was not bypassed and no Production database was involved.

Running `npm run test:integration` on your own machine is allowed only in a shell that holds the TEST settings for the TEST project and no Production setting. If you are unsure, use the manual workflow instead.

## 7. Manual Preview checks

Preview is a deployed environment, so these checks are by hand. Use a Preview deployment whose Supabase values come from the TEST project and a dedicated test publisher. Use a placeholder in notes for the host, for example `https://YOUR-PREVIEW-HOST`. The routes are the three existing publisher routes only: `POST /api/v1/ads/match`, `POST /api/v1/ads/impression` and `GET /api/v1/ads/click`.

### 7a. Publisher API-key handling

- [ ] The test publisher is approved, and its key was created on the Publisher page of the Preview deployment.
- [ ] The key was shown once and went straight into `BLISSCCO_PUBLISHER_API_KEY` in your shell or server environment.
- [ ] `BLISSCCO_PUBLISHER_API_KEY` and `BLISSCCO_API_BASE_URL` have no public prefix such as `NEXT_PUBLIC_`.
- [x] A request without the key returns 401, and so does a request with a wrong key. (User-reported, 2026-11-04.)
- [x] A key sent in the query string or the request body is not accepted. (User-reported, 2026-11-04.)
- [x] The key does not appear in the Preview page source, the browser network tab or any log. (User-reported, 2026-11-04, scope as reported.)
- [x] After a revoke on the Publisher page, the next request with that key returns 401. (User-reported, 2026-11-04.)
- [ ] The test key is revoked when testing ends.

### 7b. Ad match and no-fill

```bash
curl -i -X POST "https://YOUR-PREVIEW-HOST/api/v1/ads/match" \
  -H "Authorization: Bearer $BLISSCCO_PUBLISHER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"topic":"gaming"}'
```

- [x] With an approved test campaign for the topic, the answer is 200 with `fill: true`, `sponsored: true` and the five public ad fields. (User-reported, 2026-11-04.)
- [x] The response carries `X-Blisscco-Api-Version: 1` and `Cache-Control: no-store`. (User-reported, 2026-11-04.)
- [x] A topic with no approved campaign returns 200 with `{"fill":false}`. (User-reported, 2026-11-04.)
- [x] `{"topic":"health"}` returns the normal no-fill answer, with no reason given. (User-reported, 2026-11-04.)
- [x] A wrong `Content-Type` returns 415, and an unknown body field returns 400. (User-reported, 2026-11-04.)
- [ ] Your own client keeps working and shows no ad-related error when the answer is a no-fill, a 429 or a 503.

### 7c. Impression and click behaviour

- [x] Without the `X-Blisscco-Tracking: 1` header, the match response has no `tracking` object. (User-reported, 2026-11-04.)
- [x] With the header, and only if the tracking secret is set for the Preview deployment, the response carries `tracking.token` and `tracking.click_ref`. If the secret is not set, tracking is off and the impression and click routes answer unavailable. (User-reported, 2026-11-04.)
- [x] `POST /api/v1/ads/impression` with the token answers `recorded`, and the same token again answers `duplicate`. (User-reported, 2026-11-04.)
- [x] A changed token is refused with 401. (User-reported, 2026-11-04.)
- [x] `GET /api/v1/ads/click?ref=` with the encoded `click_ref` answers 302 to the destination stored for the ad. (User-reported, 2026-11-04.)
- [x] A changed click reference is refused with 404. (User-reported, 2026-11-04.)
- [ ] Impressions are sent only from a server, because the impression route has no CORS.
- [x] The only charged event is the match request. Impressions and clicks are reporting counts. (User-reported, 2026-11-04.)

### 7d. Revive fallback stays disabled

- [ ] `REVIVE_FALLBACK_ENABLED` is unset in the Preview deployment, so the fallback is off.
- [ ] `REVIVE_JSON_PREVIEW_ENABLED` is unset in the Preview deployment, so the preview route is off.
- [ ] A topic with no Blisscco campaign returns the normal no-fill and not a Revive ad.
- [ ] No response in this section carries a Revive creative, and none was expected.

Testing the Revive fallback is a separate, deliberate decision. It is not part of this runbook. If someone decides to test it, they follow `DAY27-REAL-REVIVE-VERIFICATION.md` in a TEST context and switch it off again afterwards. A Revive ad is not charged, has no tracking and earns the publisher nothing.

## 8. Result log

Filled in by a person, with a date, after each step. A blank row means not run.

| Step | Environment | Date | Person | Result |
|---|---|---|---|---|
| 1. `npm ci` | Local | | | |
| 2. `npm run lint` | Local | | | |
| 3. `npm test` | Local | | | |
| 4. `npm run lint:eslint` | Local | | | |
| 5. `npm run build` | Local | | | |
| 6. GitHub CI | CI | | | |
| 7. TEST PostgreSQL checks | TEST database | | | |
| Preview checks 7a to 7d | Preview | | | |

### Day B status

The table above stays blank until a person fills it. This separate table records what Day B found, one check at a time. A row is marked "Done (user's word only)" when the user says they finished that specific check with a good result; Claude did not read those runs itself. The full wording for each check is in `DAY-B-CI-TEST-DB-VERIFICATION-REPORT.md`.

| Check | Status | Note |
|---|---|---|
| GitHub CI for the current commit | Done (user's word only) | Reported by the user. No run link or commit identifier was given. |
| TEST secrets belong to the TEST project | Done (user's word only) | The user set both secrets with the TEST project reference; the database run used them. |
| TEST database guard, code review | Reviewed | Refuses Production, a mismatched project reference and a missing setting. |
| TEST database guard unit tests (24) | Ran in a sandbox, none failed | No database used; not the official `npm test`. |
| Real PostgreSQL integration run | Done (user's word only) | Reported by the user after fixes to the address secret, the password, two test setup problems and the pooler type. No test count was given. |
| Day A local npm checks | Done (user's word only) | The five commands are the same ones the CI workflow runs. |

### Phase 2 Step 1 status (Preview, 2026-11-03)

Run by the user with a TEST publisher key in the dedicated Preview. Claude did not see raw output. Full detail is in `DAY-C-PREVIEW-MANUAL-VERIFICATION-REPORT.md`, section 4. No key, token or URL is recorded.

| Check | Section | Status |
|---|---|---|
| Key in query string rejected (401) | 7a | **User-confirmed — completed successfully** |
| Key in request body rejected (401) | 7a | **User-confirmed — completed successfully** |
| Key absent from page source, network content and logs | 7a | **User-confirmed — completed successfully** (scope as reported) |
| After revoke, next request returns 401 | 7a | **User-confirmed — completed successfully** |
| No `tracking` object without the opt-in header | 7c | **User-confirmed — completed successfully** |
| Wrong `Content-Type` returns 415 | 7b | **User-confirmed — completed successfully** |
| Unknown body field returns 400 | 7b | **User-confirmed — completed successfully** |
| Impression and click leave spend unchanged | 7c | **User-confirmed — completed successfully** |
| Revive fallback and preview flags unset in Preview | 7d | **User-confirmed — completed successfully** |
| Controlled Revive test | 7d | **Pending**, not approved |

Section 7 boxes are ticked, with the date, only where the user reported the step and a user-confirmed row above names that subsection. Every other box stays unticked.

### Phase 2 Step 3 status (automated, mocked, 2026-11-03)

These rows record only automated regression tests that use in-memory fakes. They are not Preview results and not real PostgreSQL results. Counts and commands are in `PHASE2-STEP3-AD-SERVING-REGRESSION-REPORT.md`. The Preview recheck was run by the user and is recorded in the Phase 2 Step 5 status table below. GitHub CI and the real PostgreSQL recheck were reported by the user on 2026-11-04 as the user's word only, with no run link, commit or counts seen.

| Check | Section | Status |
|---|---|---|
| Valid key and eligible campaign return the ad | 7b | Existing automated tests (mocked). Preview recheck: see Phase 2 Step 5 status |
| Invalid or revoked key is refused | 7a | Existing automated tests (mocked). Preview recheck: see Phase 2 Step 5 status |
| No eligible campaign returns the no-fill answer | 7b | Existing automated tests (mocked). Preview recheck: see Phase 2 Step 5 status |
| Every term of the sensitive list gives no-fill, as topic and as fallback | 7b | New automated test (mocked). Preview recheck: see Phase 2 Step 5 status |
| Impression is recorded, a repeat is a duplicate, a changed token is refused | 7c | Existing automated tests (mocked). Preview recheck: see Phase 2 Step 5 status |
| Click redirects to the stored destination, a changed reference is refused | 7c | Existing automated tests (mocked). Preview recheck: see Phase 2 Step 5 status |
| Disallowed destinations are never redirected to | 7c | New automated test (mocked). Preview recheck: see Phase 2 Step 5 status |
| Real PostgreSQL recheck for Step 3 | 6 | Done (user's word only), reported 2026-11-04, no test count seen |
| GitHub CI for the Step 3 test files | 5 | Done (user's word only), reported 2026-11-04, no run link, commit or counts seen |

### Phase 2 Step 4 status (evidence kinds and Day C core checks, 2026-11-03)

This table adds the Day C core checks that the Step 1 table above does not hold. They were run by the user with a TEST publisher key in the dedicated Preview. Claude saw no raw output. Detail: `DAY-C-PREVIEW-MANUAL-VERIFICATION-REPORT.md`, section 3.

Evidence kinds used in this runbook:

- Automated means a test file ran against in-memory fakes. It does not show Preview or real database behaviour.
- Preview means a person ran the request against the dedicated Preview. A user-confirmed row is the user's word only, with no log or run link attached.
- Done (user's word only) is used for CI and database checks, which stay outside the user-confirmed rows.
- Pending means no result exists yet. A check stays Pending until a person runs it and reports the result.

| Check | Section | Status |
|---|---|---|
| Valid TEST key and approved campaign return the ad, version header and no-store | 7b | **User-confirmed — completed successfully** |
| Wrong key and missing key return 401 | 7a | **User-confirmed — completed successfully** |
| Topic without a campaign and the sensitive topic `health` return no-fill without a reason | 7b | **User-confirmed — completed successfully** |
| Opt-in header returns a tracking token and a click reference | 7c | **User-confirmed — completed successfully** |
| Impression is recorded, the same token is a duplicate, a changed token returns 401 | 7c | **User-confirmed — completed successfully** |
| Click returns 302 to the stored destination twice, a changed reference returns 404 | 7c | **User-confirmed — completed successfully** |

Checks that remain open after Step 4:

| Check | Section | Status |
|---|---|---|
| Advertiser campaign page error screen seen once | none | **Pending**, root cause not found. Old issue not reproduced in latest user-confirmed Preview check (new advertiser account, 2026-11-04); root cause remains unknown. A rerun reported on 2026-11-04 is in Phase 2 Step 5 status and does not name a cause |
| Controlled Revive test | 7d | **Pending**, not approved |
| Recheck on the deployed Preview of the Step 3 automated tests | 7a to 7c | Reported by the user, see Phase 2 Step 5 status |
| GitHub CI and real PostgreSQL recheck for the files changed in Steps 3 and 4 | 5 and 6 | Done (user's word only), reported 2026-11-04, see Phase 2 Step 5 status |
| Termux rerun of the documentation-contract files after the Step 4 edits | 3 | Reported by the user, see Phase 2 Step 5 status |
| Production behaviour | none | Not checked, outside this runbook |

### Phase 2 Step 5 status (user-run manual checks, 2026-11-04)

The user reported that these checks were run by hand after the Step 3 and Step 4 changes. Claude did not see the commands, the output or any counts, and no key, token or URL is recorded here. The rows cover only the areas named in them. The campaign page root cause, the controlled Revive test and Production are not covered by this table and keep the status given above. GitHub CI and the real PostgreSQL recheck are in the second table below, as the user's word only.

| Check | Section | Status |
|---|---|---|
| Recheck on Preview of key handling: valid, wrong, missing and revoked key | 7a | **User-confirmed — completed successfully** |
| Recheck on Preview of ad match, no-fill and the sensitive topic | 7b | **User-confirmed — completed successfully** |
| Recheck on Preview of impression, duplicate, changed token, click and changed reference | 7c | **User-confirmed — completed successfully** |
| Termux rerun of the documentation-contract files after the Step 4 edits | 3 | **User-confirmed — completed successfully** |
| Rerun on Preview: add an ad, then send it for review | Open items | **User-confirmed — completed successfully** |

The last row is the rerun of the Step 2 check. The user gave no details, so no error screen and no reference code are recorded. It does not explain the one earlier error, so the root cause row above stays Pending.

Reported on 2026-11-04 and recorded as the user's word only:

| Check | Section | Status |
|---|---|---|
| GitHub CI for the Step 3 and Step 4 changes | 5 | Done (user's word only), no run link, commit or counts seen |
| Real PostgreSQL recheck on the TEST project | 6 | Done (user's word only), no test count seen |

Neither run is tied to a commit in these notes, so the files added in Phase 2 Step 5 are not covered by them.

On the same user report, 16 boxes in 7a, 7b and 7c were ticked and dated. Boxes without a matching row, and all of 7d, stay unticked. The contract test for this runbook now matches each ticked box to a status row for its subsection.

### Phase 2 Step 2 status (regression rerun, 2026-11-04)

Automated rows are a sandbox run with in-memory fakes (Node 22, no network). They are not Preview, real PostgreSQL or CI results. Detail: `PHASE2-STEP3-AD-SERVING-REGRESSION-REPORT.md`, section 9.

| Check | Section | Status |
|---|---|---|
| Key, eligibility, no-fill and non-serving of pending, rejected, paused (5 files, 324 tests) | 7a, 7b | **PASS** (automated, mocked) |
| Sensitive topics, token, duplicate and spend or ledger checks (7 files, 280 tests) | 7b, 7c | **PASS** (automated, mocked) |
| Admin Review Flow on Preview (M1 to M9) | Admin review | **User-confirmed — completed successfully** |
| Advertiser campaign page error | Open items | **Pending**, root cause unknown |
| Controlled Revive test | 7d | **PENDING**, not approved |

The Admin Review Flow row rests on the user's word only; no output was seen (see `PHASE2-STEP1-ADMIN-REVIEW-VERIFICATION-REPORT.md`). Campaign page status, exactly: User-confirmed — currently not reproducible in Preview. The old error's root cause remains unknown, so no root-cause box is ticked.

## 9. Limits and what was not changed

- No command was run and no service was contacted to write this runbook.
- The Day B status notes were added later. They record what the Day B session could and could not see, and they do not change a step or a rule above.
- It does not approve a pilot and does not replace `MVP-PILOT-SAFETY-CHECKLIST.md`.
- No workflow, SQL file, migration, environment value or application code was changed.
- No `.sh` script was added, so `.github/workflows/ci.yml` is unchanged.
- Production data and Production credentials are outside this runbook.
- Phase 2 Step 4 changed only documents, one public text page (`app/privacy/page.tsx`) and a documentation-contract test. No ad-serving, authentication, ledger, payout or spend code was changed.
- Phase 2 Step 3 changed only test files and documents. No application code, SQL file, migration, workflow, environment value or script was changed.
- Phase 2 Step 5 changed only status rows in this runbook and in `MVP-FEATURE-STATUS.md`. No application code, test, SQL file, migration, workflow, script or environment value was changed.
