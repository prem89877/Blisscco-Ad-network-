# Blisscco MVP Verification Runbook (Day 30 Part 4)

This is a runbook for a person to follow after MVP completion. It is documentation only. Nothing was run to write it: no install, lint, test, ESLint, build, database check or live endpoint check, and no service was contacted.

Every box and every result row below starts empty. No step is confirmed by this document. A box is ticked only by the person who ran the step, with the date.

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

## 6. TEST PostgreSQL checks (step 7)

These checks run only against the separate TEST project. They are never part of the local helper and never use Production credentials.

- [ ] The TEST project and the Production project have different project references.
- [ ] The repository secrets `TEST_DATABASE_URL` and `TEST_SUPABASE_PROJECT_REF` belong to the TEST project, and `TEST_DB_CONFIRM` is set by the workflow itself.
- [ ] The workflow "DB integration (TEST database only)" is started by hand (it has no push or pull request trigger).
- [ ] The preflight step reports that all three settings are present, without printing a value.
- [ ] The guard in `tests/integration/test-db-guard.ts` is unchanged and refuses a Production environment.
- [ ] The run reports at least one passing test and no skipped test. A skipped database test is not a success.
- [ ] No database URL appears in any log, ticket or chat.

Running `npm run test:integration` on your own machine is allowed only in a shell that holds the TEST settings for the TEST project and no Production setting. If you are unsure, use the manual workflow instead.

## 7. Manual Preview checks

Preview is a deployed environment, so these checks are by hand. Use a Preview deployment whose Supabase values come from the TEST project and a dedicated test publisher. Use a placeholder in notes for the host, for example `https://YOUR-PREVIEW-HOST`. The routes are the three existing publisher routes only: `POST /api/v1/ads/match`, `POST /api/v1/ads/impression` and `GET /api/v1/ads/click`.

### 7a. Publisher API-key handling

- [ ] The test publisher is approved, and its key was created on the Publisher page of the Preview deployment.
- [ ] The key was shown once and went straight into `BLISSCCO_PUBLISHER_API_KEY` in your shell or server environment.
- [ ] `BLISSCCO_PUBLISHER_API_KEY` and `BLISSCCO_API_BASE_URL` have no public prefix such as `NEXT_PUBLIC_`.
- [ ] A request without the key returns 401, and so does a request with a wrong key.
- [ ] A key sent in the query string or the request body is not accepted.
- [ ] The key does not appear in the Preview page source, the browser network tab or any log.
- [ ] After a revoke on the Publisher page, the next request with that key returns 401.
- [ ] The test key is revoked when testing ends.

### 7b. Ad match and no-fill

```bash
curl -i -X POST "https://YOUR-PREVIEW-HOST/api/v1/ads/match" \
  -H "Authorization: Bearer $BLISSCCO_PUBLISHER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"topic":"gaming"}'
```

- [ ] With an approved test campaign for the topic, the answer is 200 with `fill: true`, `sponsored: true` and the five public ad fields.
- [ ] The response carries `X-Blisscco-Api-Version: 1` and `Cache-Control: no-store`.
- [ ] A topic with no approved campaign returns 200 with `{"fill":false}`.
- [ ] `{"topic":"health"}` returns the normal no-fill answer, with no reason given.
- [ ] A wrong `Content-Type` returns 415, and an unknown body field returns 400.
- [ ] Your own client keeps working and shows no ad-related error when the answer is a no-fill, a 429 or a 503.

### 7c. Impression and click behaviour

- [ ] Without the `X-Blisscco-Tracking: 1` header, the match response has no `tracking` object.
- [ ] With the header, and only if the tracking secret is set for the Preview deployment, the response carries `tracking.token` and `tracking.click_ref`. If the secret is not set, tracking is off and the impression and click routes answer unavailable.
- [ ] `POST /api/v1/ads/impression` with the token answers `recorded`, and the same token again answers `duplicate`.
- [ ] A changed token is refused with 401.
- [ ] `GET /api/v1/ads/click?ref=` with the encoded `click_ref` answers 302 to the destination stored for the ad.
- [ ] A changed click reference is refused with 404.
- [ ] Impressions are sent only from a server, because the impression route has no CORS.
- [ ] The only charged event is the match request. Impressions and clicks are reporting counts.

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

## 9. Limits and what was not changed

- No command was run and no service was contacted to write this runbook.
- It does not approve a pilot and does not replace `MVP-PILOT-SAFETY-CHECKLIST.md`.
- No workflow, SQL file, migration, environment value or application code was changed.
- No `.sh` script was added, so `.github/workflows/ci.yml` is unchanged.
- Production data and Production credentials are outside this runbook.
