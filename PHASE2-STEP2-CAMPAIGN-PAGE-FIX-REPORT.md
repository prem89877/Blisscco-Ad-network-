# Phase 2, Step 2: Advertiser Campaign Page Error Report

Date: 2026-11-03. Result: **root cause NOT confirmed. Issue stays Pending. No application code, test, SQL or workflow was changed.**

## 1. Issue being investigated

Day C Preview report (section 5 item 1): after saving a creative, the advertiser campaign page showed "Something went wrong" although the creative row was saved as a draft.

## 2. Evidence reviewed

| Source | What it showed |
|---|---|
| `DAY-C-PREVIEW-MANUAL-VERIFICATION-REPORT.md` | Symptom only. No error line, reference code or log was recorded. |
| Code path read (no change made) | `app/dashboard/advertiser/campaigns/[id]/page.tsx`, `creative-actions.ts`, `lib/campaigns/queries.ts`, `lib/campaigns/creative-validation.ts`, `lib/campaigns/review.ts`, `lib/ads/campaign-performance.ts`, `lib/ads/analytics.ts`, `components/campaigns/CreativeForm.tsx`, error boundaries (`app/error.tsx`, `app/dashboard/error.tsx`, `campaigns/error.tsx`). |
| User screenshot (2026-11-03, about 10:02 IST) | Generic error screen with "Try again" and "Home page" buttons, no reference code. This is the app-level or dashboard-level boundary, not the campaigns boundary. |
| User-copied Vercel request (10:00:27 IST) | `POST` on the campaign page, referer `?creative=added`, status 303, 8.1 s function time, 9.3 s total. It included one PATCH, so the ad status change worked. The ad showed "Waiting for review". |
| Vercel runtime logs (read-only, Preview deployment `preview-day-c`) | No log lines for 10:00 to 10:06 IST or the last 55 minutes. Only runtime error group in 3 hours: sign-in code exchange failure on `/auth/confirm` (unrelated). Request trace not available (404, Hobby retention). |
| User retry (reported) | "Send for review" completed in about 3 s with no error. |

## 3. What the code shows

- The campaign page's queries for creatives, creative summary, spend and performance each catch errors and return a safe empty state ("Could not be loaded"). A missing table, column or function in the TEST project would therefore not open the error screen through those queries. The Day C guess is not supported.
- The page throws to the error boundary only if the advertiser or campaign query itself fails, or if rendering throws.
- "Something went wrong. Please try again." is also the default message of the creative action (`mapDbError`) and is shown inside the form, not as a full-page screen.
- No code path was found that fails for a draft creative. Nothing was proven, so nothing was changed.

## 4. Root cause

**Not confirmed.** The missing evidence is a server log line or reference code from a failing request. The one failure seen had no log entry, and a retry did not fail, so it may have been a slow or interrupted request (8.1 s) rather than a code defect. This is a possibility, not a finding.

## 5. Files changed

None. No regression test was added, because there is no confirmed failure condition to test. Adding one would be a guess.

## 6. Test and Preview results

| Item | Result |
|---|---|
| Automated tests (`npm test`) | **Not run** by Claude in this step (no code changed). |
| Preview rerun: add an ad, then send it for review | Ran once with a generic error screen seen and once without an error (as reported by the user). Status: **Pending**, root cause unconfirmed. |
| Production | Not accessed. |

The item will become "User-confirmed — completed successfully" only after the user states that they personally reran the exact check and it passed, and after a cause is found or the issue is agreed closed.

## 7. What is needed to close this

1. If the error appears again, tell Claude straight away (Vercel Hobby keeps logs for 1 hour). Claude reads the runtime log and trace read-only.
2. Note whether the error screen shows a reference code. The campaigns boundary shows one; the generic screen does not.
3. Optional: run `npm ci` and `npm test` in Termux (Node 22) and share only the pass/fail summary.

## 8. Safety statement

Production data and variables were not accessed or changed. Vercel access was read-only (deployments list, runtime logs, runtime errors, trace lookup) on the Preview project. No SQL, migration, deployment, ledger, payout or spend behavior was touched. No secret, key or database address is recorded here.
