# Day 28 – Local verification guide

`scripts/day28-verify.sh` runs the official project checks in one fixed order and stops at the first failure. It is a local helper only: it changes no application code, no CI workflow, no database and no deployment.

## What it runs

| Order | Command | What it checks |
| --- | --- | --- |
| 1 | `npm ci` | exact install from `package-lock.json` |
| 2 | `npm run lint` | TypeScript type check (`tsc --noEmit`) |
| 3 | `npm test` | compiles and runs the whole test suite |
| 4 | `npm run lint:eslint` | ESLint through `next lint` |
| 5 | `npm run build` | production build of the Next.js app |

CI runs the same five commands in the same order (plus one informational `npm ls` that prints package versions after the install).

## Requirements

- **Network access.** `npm ci` downloads every package from the npm registry. Without a connection step 1 fails and nothing else runs. The other four commands need no network.
- **Node version from `.nvmrc`.** The file holds one major version (currently 22). Switch first, for example with `nvm use`. The script compares the major version of `node` with `.nvmrc` before running anything and stops with exit code 65 on a mismatch.
- **npm** from that same Node installation.
- **bash.** On Windows use Git Bash or WSL.

## Usage

From any folder:

```bash
bash scripts/day28-verify.sh
```

`npm ci` removes the existing `node_modules` folder and installs it again. That is intended, but expect it to take a while.

## What it prints

Only command names and exit statuses, one pair of lines per command:

```text
==> RUN  npm ci
<== PASS npm ci (exit 0)
==> RUN  npm run lint
<== FAIL npm run lint (exit 1)
day28-verify: stopped at the first failure; later commands were not run
```

When everything passes the last line is `day28-verify: all 5 commands passed`.

- The script itself never prints an environment variable, a secret, a key or a database URL. It has no debug mode and never lists the environment.
- The commands it starts print their own normal output (npm, tsc, test runner, Next.js). The script does not filter or rewrite it. Before sharing a log with someone, read it once.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | all five commands passed |
| 64 | setup problem: `node`, `npm` or `.nvmrc` not found |
| 65 | the Node major version does not match `.nvmrc`; nothing was run |
| anything else | the exit status of the command that failed; the `FAIL` line names it, and later commands were not run |

## Fail-fast

Each command runs only if the one before it passed. On the first non-zero exit the script prints the `FAIL` line and exits with that same status. There is no retry, no "continue anyway" mode and no skipped command that still counts as passed.

## Environment safety

The script runs its commands in a clean environment, like the CI runner, so that nothing real can reach them by accident:

- Before step 1 it removes (inside the script's own process only, never in your shell) the database settings, the test-database settings and their confirmation switch, Supabase keys, publisher keys, tracking secrets, the Revive settings, `NODE_ENV` and the npm production switches.
- Because the test-database settings are removed, the real PostgreSQL integration tests are skipped here, exactly as in CI. They need a separate TEST database and are run on purpose, not by this script.
- Step 5 (`npm run build`) gets the same three dummy values that CI uses, so a real Supabase configuration in your shell or in a local env file never goes into the build.
- Nothing here is run against Production. The script opens no database connection, runs no SQL, makes no deployment and calls no Revive endpoint.

## After a run

- Pass: record the date and that all five commands passed.
- Fail: the `FAIL` line tells you which command and which exit status. Run that single command by hand to see its full output, fix it, and run the script again from the start.
- A failure that only mentions missing `@types/node` or the `next` package usually means step 1 did not complete; run the script again with network access.

## What this guide does not claim

Running the script on your machine is a local check. It does not replace the GitHub Actions run, and it says nothing about Preview or Production deployments.
