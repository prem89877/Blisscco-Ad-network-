# PHASE 6 — DAY 1 — PART 3: GITHUB CI & CODE VERIFICATION REPORT

Date: 2026-11-12
Source of truth: uploaded `blisscco-ad-network.zip` (Phase 6 Step 5 state).
No Production code changed, nothing deployed, **no source file changed by me**, no secrets read or printed.

Labels: **LOCAL** = run by me in my sandbox now · **GITHUB** = GitHub Actions result reported by the owner earlier (screenshot/log, Part 1 Appendix F; not re-observed by me) · **STATIC** = file read only · **BLOCKED** / **NOT TESTED**.

---

## 1. Summary

| Item | Result |
|---|---|
| Repository / commit under test | **NOT IDENTIFIABLE** from the ZIP (no `.git`, no SHA in any file). Branch per owner evidence: `preview-day-c` |
| `npm ci` / `lint` / `test` / `lint:eslint` / `build` (LOCAL) | **BLOCKED** — sandbox has no network (see §3) |
| `bash scripts/day28-verify.sh` (LOCAL) | Executed, **exit status 1**, stopped at the first command (`npm ci`) for the same reason. Not a code failure |
| GitHub Actions CI #124 | **PASS** (GITHUB, owner screenshot). Runs the same five commands as `scripts/day28-verify.sh` → **CI VERIFIED (via zip reports, owner evidence)** |
| GitHub Actions DB integration #17 | **PASS** (GITHUB, owner screenshot; pass/skip counts not visible) |
| Files changed by me | **0** (besides this report) |
| Overall | **CI VERIFIED** for the five commands (and therefore the `day28-verify.sh` sequence) per CI #124 as recorded in the zip reports. **NOT re-proven locally** by me. Commit SHA not identifiable |

---

## 2. Static inspection (Task 1)

| Item | Finding |
|---|---|
| `package.json` | Next `^15.5.28`, React `^19.2.3`, TypeScript `^5.7.0`, ESLint `^8.57.1`, `engines.node = 22.x` |
| Scripts | `lint` = `tsc --noEmit`; `test` = `tsc -p tsconfig.test.json && node --require ./tests/register.cjs --test .test-build/tests/*/*.test.js`; `lint:eslint` = `next lint`; `build` = `next build`; `test:integration` = same compile, `--test-concurrency=1`, `tests/integration` only |
| Lockfile | `package-lock.json` v3, 448 packages. **Root dependency/devDependency ranges: 0 mismatches vs `package.json`** (STATIC check). Locked: next 15.5.28, react/react-dom 19.3.1, typescript 5.9.3, eslint 8.57.1, supabase-js 2.118.0, @types/node 22.20.5, pg 8.23.1 |
| Node | `.nvmrc` = 22; sandbox has Node v22.23.4 (matches major) |
| `tsconfig.test.json` | Extends `tsconfig.json`; compiles listed `lib/` + route files and `tests/**/*.ts` to `.test-build` |
| Test files | 189 `*.test.ts`, of which 10 in `tests/integration/` |
| Workflows | `ci.yml` (push + PR): checkout → setup-node (.nvmrc) → `npm ci` → `npm ls` → `bash -n scripts/backup-production-db.sh` → lint → test → eslint → build with dummy public env. All `run:` lines are single-line (the CI contract test depends on this, see F1 in Part 1). `integration.yml` (manual only): preflight of 3 TEST settings, `npm run test:integration`, then a step that **fails on any skipped test or zero passes**. `grok.yml` not reviewed |
| Phase 6 Step 4/5 manifests | All paths listed in `CHANGED-FILES-PHASE6-STEP4-PART{1,2,3}.txt` and `…STEP5.txt` exist in the ZIP (0 missing) |
| SQL | Step 4 / 5 SQL not re-reviewed here (done in Day 1 Part 2) |

## 3. Commands (Task 2) — LOCAL

Environment: sandbox, Node v22.23.4, npm 10.9.9, network **disabled**.

| Command | Status | Evidence |
|---|---|---|
| `npm ci` | **BLOCKED** (exit 1) | npm log: `ENOTFOUND` for registry tarballs (`registry.npmjs.org` does not resolve; `curl` also fails to resolve). Install stops with npm's "Exit handler never called" message |
| `npm run lint` (`tsc --noEmit`) | **BLOCKED / NOT TESTED** | `typescript`, `@types/node`, `next`, `react`, `@supabase/*` all absent after the failed install. A global `tsc 6.0.3` exists but differs from the locked 5.9.3 and has no type packages, so its output would be meaningless |
| `npm test` | **BLOCKED / NOT TESTED** | needs the same install |
| `npm run lint:eslint` | **BLOCKED / NOT TESTED** | needs `eslint`, `eslint-config-next` |
| `npm run build` | **BLOCKED / NOT TESTED** | needs `next` |

Failure log (trimmed, no secrets):
```
http fetch GET https://registry.npmjs.org/<package>.tgz attempt 1 failed with ENOTFOUND
npm error Exit handler never called!
```
To run these, enable network access for the sandbox (Settings → network), or run them on your side (Termux or GitHub Actions).

## 4. `scripts/day28-verify.sh` (Task 3) — LOCAL

| Check | Result |
|---|---|
| `bash -n scripts/day28-verify.sh` | OK |
| `bash -n scripts/backup-production-db.sh` | OK (same syntax check CI runs) |
| Actual run | `==> RUN npm ci` → `<== FAIL npm ci (exit 1)` → "stopped at the first failure; later commands were not run" |
| **Exit status** | **1** |

The script unsets all DB/secret variables before running, so it never touches a database. Even when the network exists it cannot count as a **database** integration check.

**Skipped-test warning (important):** `npm test` runs `.test-build/tests/*/*.test.js`, which **includes `tests/integration/*.test.js`**. Those use `{ skip: skipReason }` and skip without TEST env. So a green `npm test` / `day28-verify.sh` does **not** prove DB integration. Only the manual `integration.yml` run does, because it fails on any skip or zero pass.

## 5. GitHub Actions results (not local) — from Part 1 Appendix F

| Run | Result | Cause (per owner logs) |
|---|---|---|
| CI #120 | FAIL | retry loop added to `ci.yml` broke the CI contract tests; reverted |
| CI #123 | FAIL | fix SQL file placed in `supabase/sql` broke the Day 12 architecture test (lists files mentioning `serve_ref`) |
| DB integration #14 | FAIL | stale tests |
| DB integration #15 | FAIL | rollback test, pilot-limits setup, idempotency |
| DB integration #16 | FAIL | `column q.serve_id does not exist` (TEST DB missing day-12-5 retry pieces) |
| **CI #124** | **PASS** (1m 52s) | — |
| **DB integration #17** | **PASS** (6m 38s) | pass/skip counts not visible; skip-guard step would have failed the run on any skip |

I did not re-open these runs; I only have the owner's screenshot/log summary.


## 5A. CI verification with `day28-verify.sh` (from zip reports)

Sources inside the ZIP: `PHASE6-STEP4-PART3-FINANCIAL-READINESS-REPORT.md`, `PHASE6-STEP5-FINAL-PILOT-READINESS-REPORT.md`, `PHASE6-DAY1-PART1-DATABASE-INVENTORY-REPORT.md` (Appendix F/G #12). Evidence type: owner GitHub Actions screenshot, **not re-observed by me**.

| Command (order used by `scripts/day28-verify.sh`) | `ci.yml` step | CI #124 (GITHUB) |
|---|---|---|
| `npm ci` | Install (npm ci, lockfile only) | **PASS** |
| `npm run lint` (`tsc --noEmit`) | Type check | **PASS** |
| `npm test` | Tests | **PASS** |
| `npm run lint:eslint` | ESLint | **PASS** |
| `npm run build` (dummy public env) | Production build | **PASS** |

- `day28-verify.sh` runs exactly these five commands in this order and exits 0 only if all pass. CI #124 ran the same five commands → the script's pass condition (`all 5 commands passed`) is **CI VERIFIED by equivalence**.
- **Precision:** `ci.yml` calls the commands one by one; it does **not** execute `bash scripts/day28-verify.sh` itself. The script was never run on its own (neither on GitHub nor by me with network). Local run today: exit 1 at `npm ci` (no network, BLOCKED).
- DB integration #17 (manual `integration.yml`, TEST DB) was also green; it is the only run that proves DB tests were not skipped.
- Still open: exact commit SHA of #124 / #17, and pass counts of #17.

## 6. Failure classification (Task 4)

| Failure | Category | Confirmed? |
|---|---|---|
| Old tests (Day 9 / 16 / 18) | **Old serve-time billing assumptions** (`billed` field, charge moved from serve to impression) | Yes, fixed earlier (Part 1 F-5); tests updated, not removed |
| `column q.serve_id does not exist` | **TEST DB drift**, not a code bug | Yes, TEST-only script applied by owner |
| CI #120, #123 | **Unrelated regressions** from CI/SQL file placement | Yes, reverted/fixed |
| Today's local failure | **Missing network** (environment) | Yes |
| Outdated types / missing env vars | none observed | n/a |

**Fixes made by me today: none.** No failure found today that is a confirmed code issue, so no test was edited, removed or weakened.

Static watch-items (not failures): `tests/integration/day9-part5-db.test.ts` is documented as expected-stale after Part 2 (charge moved off serve). Part 1 says it was updated; I did not run it.

## 7. Changed file paths

- Created: `PHASE6-DAY1-PART3-CI-VERIFICATION-REPORT.md` (this file)
- Modified: none

## 8. Blockers / next steps

1. **BLOCKED:** all five local commands. Needs network in the sandbox, or run them yourself and paste the output.
2. **Commit unknown:** please give the commit SHA that CI #124 / DB integration #17 ran on, and confirm it matches this ZIP.
3. Pass/skip counts of DB integration #17 are still not visible.
4. `integration.yml` runs only on manual dispatch; a fresh run on the latest commit is needed before calling DB integration verified for this ZIP.

Nothing here claims success for LOCAL code checks.
