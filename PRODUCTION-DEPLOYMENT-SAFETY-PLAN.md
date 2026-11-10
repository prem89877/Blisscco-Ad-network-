# Production Deployment Safety Plan (Phase 5 Step 6, Task 5)

Date: 2026-11-09. Status: **DRAFT PLAN. NOT APPROVED. NOTHING IN THIS FILE HAS BEEN EXECUTED.** Production was not touched while writing it.

This plan is a checklist for a future Production deployment. It does not authorise one. Every box is unticked on purpose. A box is ticked only by the person named in it, with a date, after they have seen the evidence.

Tags used on every item:

- **[AUTO]** = an automated check that runs in the existing GitHub workflows (`CI`, and the manual `DB integration` workflow on the TEST database). The owner runs these. Claude does not ask for them to be run in Termux.
- **[MANUAL]** = a person looks at a dashboard, a header, a page or a read-only SQL result and writes down what they saw.
- **[OWNER]** = an approval or a decision that only the owner (named approver: Prem Talekar) can give.

Evidence rule: nothing is "confirmed" because Claude read code. Items that only the owner can see stay **PENDING OWNER CONFIRMATION** until the owner writes the date and result.

Related documents (not repeated here): `PHASE5-PRODUCTION-READINESS-REPORT.md` (blockers and status), `MVP-PILOT-SAFETY-CHECKLIST.md` (pilot gates, key leak steps), `MVP-INCIDENT-AND-RECOVERY-RUNBOOK.md` (severity levels, incident playbooks), `supabase/MIGRATION-ORDER.md` and `supabase/DEPLOYMENT-RUNBOOK.md` (migration order and rules), `DAY14-PART3-PRODUCTION-ENV.md` (environment variable behaviour).

---

## 1. Pre-deployment requirements (all must be true before section 6 starts)

| # | Requirement | Tag | Status |
| --- | --- | --- | --- |
| 1.1 | `CI` workflow (type check, `npm test`, ESLint, `npm run build`) is green on the exact commit to deploy | [AUTO] | PENDING OWNER (result awaited, Step 6 changed code) |
| 1.2 | `DB integration` workflow (TEST database only) green on the same or the previous commit; no skipped test | [AUTO] | Owner-stated green earlier (Phase 5 Step 2); re-run only if SQL changed |
| 1.3 | A red `CI` cannot be deployed to Production: GitHub branch protection or Vercel Deployment Checks is on. (The Vercel build ignores ESLint by design, `next.config.mjs`, so a deploy can succeed while ESLint is red.) | [MANUAL] | PENDING OWNER CONFIRMATION |
| 1.4 | Production Supabase project has a backup that has actually been restored once to a scratch project (section 4) | [MANUAL] [OWNER] | **BLOCKED** (Free plan, no backups, Seen 2026-11-08) |
| 1.5 | The owner has written down which project is TEST and which is Production, by project reference (not by name or by the "PRODUCTION" branch tag, which Supabase puts on every main branch) | [OWNER] | PENDING OWNER CONFIRMATION (name confusion open since Phase 5 Step 3) |
| 1.6 | Read-only inventory of Production schema done (section 3, step 0) so the migration list is based on what exists, not on memory | [MANUAL] | PENDING |
| 1.7 | Every security blocker in `PHASE5-PRODUCTION-READINESS-REPORT.md` section 5 is closed or accepted in writing by the owner | [OWNER] | OPEN |
| 1.8 | Owner decisions D1 to D12 in the readiness report section 7 are answered | [OWNER] | OPEN |
| 1.9 | Final owner sign-off by Prem Talekar, with name and date. Today the sign-off is CONDITIONAL and approves no Production deployment, no live traffic and no real payments | [OWNER] | NOT GIVEN |
| 1.10 | Decision whether the first Production release carries payments at all. Recommended default: **no**. Payments stay off (no `PAYMENT_PROVIDER`, `payments_enabled` false) | [OWNER] | PENDING |

## 2. Required environment variables (names only, never values)

Server-only means: no `NEXT_PUBLIC_` prefix, Vercel "Sensitive" switch ON. The build stops if a secret-looking name or value carries a `NEXT_PUBLIC_` prefix (`config/public-env-guard.mjs`).

| Variable | Production | Preview | Public? | Notes |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | required | required (TEST project) | yes | Different value per environment |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | required | required (TEST project) | yes | `sb_publishable_...` only |
| `SUPABASE_SECRET_KEY` | required | required (TEST project key) | **no**, Sensitive | Must never be the same key in both environments |
| `AD_TRACKING_SECRET` | required for tracking | required for tracking | **no**, Sensitive | 32+ random characters. Without it tracking is safely off and impression/click answer 503 |
| `AD_TRACKING_SECRET_PREVIOUS` | only while rotating | only while rotating | **no**, Sensitive | |
| `AD_TRACKING_TTL_SECONDS` | optional (60 to 86400) | optional | no | Not a secret |
| `NEXT_PUBLIC_SITE_URL` | recommended | optional | yes | The real https site URL; used for verification email links |
| `NEXT_PUBLIC_CONTACT_EMAIL` | recommended | optional | yes | Shown on `/privacy` and `/terms` |
| `EMERGENCY_STOP_ENFORCED` | `1` only after `phase5-step4-1` SQL is applied on Production **and** the owner approves | `1` on Preview (owner-confirmed on TEST 2026-11-08) | no | Without it the stop button changes a flag but ad serving does not read it |
| `RICH_AD_DELIVERY_ENABLED` | absent until the owner decides | `1` allowed on Preview | no | |
| `PAYMENT_PROVIDER`, `RAZORPAY_MODE`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | **absent** | Razorpay TEST keys only, Preview only | **no**, Sensitive | The code refuses live keys (only `rzp_test_` with `RAZORPAY_MODE=test`); Production stays 503 even if set. Cashfree variables are obsolete (Cashfree blocked) |
| `REVIVE_FALLBACK_ENABLED`, `REVIVE_JSON_PREVIEW_ENABLED`, `REVIVE_DELIVERY_URL`, `REVIVE_TIMEOUT_MS`, `REVIVE_RESPONSE_FORMAT` | **absent** | absent | no | Fallback stays OFF. Owner said they were removed on 2026-11-07; PENDING OWNER CONFIRMATION per environment |
| `SUPABASE_SERVICE_ROLE_KEY` | **remove if it exists** | remove if it exists | no | Not read by any code (only `SUPABASE_SECRET_KEY` is). A second powerful key is risk with no benefit. Owner decision |

- [ ] [MANUAL] Owner checks every secret above is marked Sensitive and no secret has a `NEXT_PUBLIC_` name. Date/result: ____
- [ ] [MANUAL] Owner confirms Preview and Production use different Supabase projects (by project reference). Date/result: ____
- [ ] [MANUAL] Owner confirms the Revive variables are absent in Production and in Preview (separately). Date/result: ____
- Note (owner-observed 2026-11-08): environment variable changes only reach a new build. After changing one, trigger a fresh build and check the variable took effect (the admin panel "Check:" line does this for `EMERGENCY_STOP_ENFORCED`). Vercel's Instant Rollback also restores the old build with its old variables.

## 3. Database migration sequence

Rules (from `supabase/DEPLOYMENT-RUNBOOK.md`, restated): only migrations and read-only verify files on Production. **Never** a TEST-only file (22 files: all `*-tests.sql`, `day-3-6-security-test.sql`, `day-4-*`, `day-5-5/5-7/5-9/5-10`, `day-6-1`, `day-7-3`, `day-9-2/9-4/9-6/9-8`, `day-12-4/12-9/12-13`, `day-13-3/13-6/13-8/13-11/13-14`; cleanup and SETUP files included). One migration, then its verify, then the next. A FAIL stops everything. Data is never fixed by hand (the ledger is append-only: use reversal or adjustment functions).

| Step | Action | Tag | Notes |
| --- | --- | --- | --- |
| 0 | Read-only inventory of Production: tables, functions, policies, bucket, extensions (`day-8-1-readonly-verify.sql`, `day-7-2-verify.sql`). Write down which migration numbers already exist | [MANUAL] | Needed because the Production state beyond migration 36 is not recorded anywhere (see readiness report 4.2) |
| 1 | Take and **test-restore** a backup (section 4) | [MANUAL] [OWNER] | Blocker today |
| 2 | Apply only the numbers missing on Production, in `MIGRATION-ORDER.md` order | [MANUAL] [OWNER] | Low-traffic window. `day-12-1` takes a lock on `ad_serve_log` |
| 3 | After each migration run its R verify file; every row PASS/true | [MANUAL] | |
| 4 | `day-5-11` STEP 3 only when its STEP 2 query returns 0 rows | [MANUAL] | |
| 5 | `phase5-step4-1` (emergency stop) **only after** its footer checks 1 to 4 and the non-admin call (expect error 42501) are confirmed on TEST | [MANUAL] [OWNER] | Recommended before any real traffic, because section 9 level 1 depends on it |
| 6 | `phase5-step5-1` (payments, payout limits) is **not part of the first Production release** | [OWNER] | Written, never run on any database, no provider approved, no checkout built |
| 7 | End with `day-13-16-financial-consistency-verify.sql` (read-only) | [MANUAL] | Expect all PASS. Ledger stays OFF (`ledger_enabled` false) and revenue share unset until the owner decides |
| 8 | Confirm `pg_cron` is on in Production and the 90-day log purge job exists (`select jobname, schedule, active from cron.job;`) | [MANUAL] | Seen ON for the TEST project only; Production not seen |

No rollback scripts exist for any migration (see section 8).

## 4. Backup requirements

State today (Seen 2026-11-08): the Production project is on the Free plan and **has no project backups and no point-in-time recovery**. Nothing stored there can be restored from Supabase.

Required before real data or real money:

- [ ] [OWNER] Decision: move Production to a plan with backups, or keep a documented manual dump routine. Date/result: ____
- [ ] [OWNER] A named person responsible for backups and for who holds the Supabase owner login. Name: ____
- [ ] [MANUAL] A backup taken immediately before each migration run (step 1 of section 3)
- [ ] [MANUAL] One **test restore** into a scratch project, row counts compared. A backup that was never restored is not a backup. Date/result: ____
- [ ] [OWNER] Stated retention and frequency, written in `MVP-INCIDENT-AND-RECOVERY-RUNBOOK.md` section 7 (today BLANK)
- Warning: the ledger and payouts are append-only. A restore loses every later row and those rows cannot be re-created. After any restore, run `day-13-16` and reconcile by hand before re-enabling anything.

## 5. Security confirmation requirements

| # | Confirmation | Tag | Status |
| --- | --- | --- | --- |
| 5.1 | Restored webhook route file matches the owner's repository copy (it was missing from the uploaded ZIP) | [MANUAL] | PENDING OWNER CONFIRMATION |
| 5.2 | Exposure search: repository, `.next/static`, browser network tab, Vercel and GitHub logs contain no key, secret or token pattern (`MVP-PILOT-SAFETY-CHECKLIST.md` section 6) | [MANUAL] | Code-read part done; the rest PENDING |
| 5.3 | Vercel Firewall: a rate-limit rule for `/api/v1/ads/match`, `/api/ads/match`, impression, click and `/api/payments/webhook` (Seen 2026-11-08: Custom Rules 0) | [MANUAL] [OWNER] | **OPEN** |
| 5.4 | Response headers on the real domain checked with a header viewer or `curl -I`: `x-content-type-options`, `x-frame-options`, `referrer-policy`, `permissions-policy`, `strict-transport-security`, no `x-powered-by` | [MANUAL] | PENDING (needs the real domain) |
| 5.5 | Content-Security-Policy: decision made (trial report-only on Preview, or accept the gap in writing) | [OWNER] | OPEN |
| 5.6 | Supabase Auth: Site URL and redirect allow-list contain only the real domain (and Preview if wanted); Google OAuth redirect URIs correct (`DAY3-GOOGLE-DOMAIN-SETUP.md`); email confirmation on | [MANUAL] | PENDING OWNER CONFIRMATION |
| 5.7 | Dependency scan: `npm audit --omit=dev` (or Dependabot) reviewed. `.npmrc` disables audit on install and there is no Dependabot file | [MANUAL] [OWNER] | PENDING |
| 5.8 | `SUPABASE_SERVICE_ROLE_KEY` removed or explained | [OWNER] | PENDING |
| 5.9 | Admin accounts: list of admin users reviewed, each with a strong login; no shared admin login | [MANUAL] [OWNER] | PENDING |
| 5.10 | Production publisher keys: none exist from the TEST period; every TEST key revoked (revoke dates recorded) | [MANUAL] | PENDING (revoke-practice date not recorded) |

## 6. Deployment order

Only after sections 1 to 5 are complete and the owner has approved in writing.

1. [OWNER] Written go-ahead, date and time window, named person who watches.
2. [MANUAL] Confirm the previous production deployment is still available to roll back to; note its deployment id.
3. [MANUAL] Backup taken (section 4).
4. [MANUAL] Apply the missing migrations (section 3), verify each.
5. [MANUAL] Set or confirm Production environment variables (section 2). `EMERGENCY_STOP_ENFORCED` only if step 5 of section 3 was done.
6. [AUTO] Deploy the exact green commit (Git-triggered build, not a redeploy of an old snapshot).
7. [MANUAL] Run the smoke checks (section 7) **before** announcing anything or giving any publisher a key.
8. [OWNER] Only then: create the first Production publisher key and campaign, one at a time, within the owner limits (1000 USD per campaign, 2000 USD total, payout cap 500 USD, pilot start 1 December 2026 at the earliest).
9. [MANUAL] Start the observation record (Day 1, 3, 7, 14).

## 7. Smoke-check requirements

All on Production, all without real money, none with real payment credentials.

| # | Check | Expected | Tag |
| --- | --- | --- | --- |
| 7.1 | `GET /api/supabase-health` | 200 `{"status":"ok"}` | [MANUAL] |
| 7.2 | Open `/dashboard` logged out | Redirect to `/login` | [MANUAL] |
| 7.3 | `POST /api/v1/ads/match` with no key | 401, no detail | [MANUAL] |
| 7.4 | `POST /api/payments/webhook` with an empty body | 503 `{"error":"not_configured"}` (proves payments are not live) | [MANUAL] |
| 7.5 | Wrong HTTP method on the ad routes | Not 200 | [MANUAL] |
| 7.6 | Admin login; admin page loads; Emergency stop panel shows state and no "not enforced" warning (if enforced) | Panel OK | [MANUAL] |
| 7.7 | Press Stop, send one request with a Production smoke key, expect `{"fill":false}`; press Resume, expect normal serving | Both work | [MANUAL] [OWNER] |
| 7.8 | Logs for the last 30 minutes: no `[config]` line, no `tracking token off` unless intended, no stack traces | Clean | [MANUAL] |
| 7.9 | Pilot monitoring panel shows the smoke requests; 503 count is 0 | OK | [MANUAL] |
| 7.10 | Response headers (item 5.4) | As listed | [MANUAL] |
| 7.11 | Latency: average below 400 ms, slowest below 1200 ms (owner limits; last measurement 790 ms and 2413 ms on Preview, over the limit) | Within limits | [MANUAL] [OWNER] |

Open question for the owner: how a Production smoke publisher and smoke campaign are marked as test traffic. The schema has no test flag on campaigns yet (decided in Step 4, not built). Until it exists, keep the smoke campaign's budget at the minimum and pause it afterwards.

## 8. Rollback procedure

**Code (fast, tested by Vercel, not yet practised by the owner):**

1. Vercel dashboard, project, Production tile, **Instant Rollback**, pick the last known good deployment (Pro plans can pick any earlier production deployment; Hobby only the previous one). CLI equivalent: `vercel rollback`.
2. Know the side effects (Vercel docs, checked 2026-11-09): the rolled-back build keeps its old environment variables, and automatic assignment of the production domain is turned off, so new pushes do not go live until the rollback is undone by promoting a deployment.
3. Run smoke checks 7.1 to 7.4 on the rolled-back deployment.
4. Record the reason in the incident record (`MVP-INCIDENT-AND-RECOVERY-RUNBOOK.md`).

**Database (slow, no automation):**

1. There are no down-migrations. Migrations are additive and re-runnable. First choice is always: use the emergency stop (section 9) and fix forward.
2. Never delete or edit ledger, payout, payment or audit rows. Use the existing reversal and adjustment functions.
3. A restore from backup is the last resort and loses later rows (section 4 warning). Needs owner approval and a reconciliation afterwards.
4. After a function-redefining migration is re-run, rerun the chain from that point (`MIGRATION-ORDER.md` rerun rule) and then the verify files.

**Environment variables:** a bad variable change is fixed by correcting it and starting a fresh build; Instant Rollback will not pick up the corrected value.

## 9. Emergency shutdown procedure

From fastest and least harmful to most drastic. Use the lowest level that stops the harm. S1 incidents (suspected secret exposure, real-money incident, spend above cap, ledger/payout mismatch) follow the S1 rules in `MVP-INCIDENT-AND-RECOVERY-RUNBOOK.md`: stop first, preserve evidence, notify the owner and Prem Talekar, no resume without written approval, never modify or delete data automatically.

| Level | Action | Needs | Effect |
| --- | --- | --- | --- |
| 1 | Admin page, **Stop all ad serving** with a reason | `phase5-step4-1` SQL on Production and `EMERGENCY_STOP_ENFORCED=1` live | New match requests answer a plain no-fill. Billing, ledger, payouts and keys are not touched. Already served ads can still report impressions and clicks |
| 2 | Pause campaigns, suspend an advertiser or publisher, revoke an API key (existing admin and publisher pages) | Admin login | Stops one party at a time |
| 3 | Financial: keep payouts off (`payouts_enabled` false), payments off (`payments_enabled` false) once that SQL exists; remove `PAYMENT_PROVIDER` and start a fresh build so the webhook answers 503 | Admin login, Vercel access | No payment or payout can be applied. Approving or completing a payout is a person's action and nothing runs it automatically |
| 4 | Vercel Firewall custom rule to deny `/api/*` (or the affected path); Instant Rollback to the last good deployment | Vercel access | Stops traffic at the edge. Verify the rule works in advance |
| 5 | Pause the Vercel project, or pause the Supabase project (verify availability on your plan beforehand) | Owner | Whole site down; logins fail. Last resort |

Secret exposure: rotate first (new `AD_TRACKING_SECRET`, new `SUPABASE_SECRET_KEY`, revoke publisher keys), as written in `MVP-PILOT-SAFETY-CHECKLIST.md` section 3. Rotation is a manual owner action.

- [ ] [MANUAL] Each level above practised once on TEST/Preview and the date written here: ____ (level 1 was practised on Preview on 2026-11-08, Owner-stated with screenshots)
- [ ] [OWNER] Two named people can perform levels 1 to 4 (today one approver is named)

## 10. Post-deployment monitoring requirements

| # | What | How often | Tag |
| --- | --- | --- | --- |
| 10.1 | Pilot monitoring panel: requests, fills, no-fills, 503, caller errors, fill rate, latency, serves, impressions, clicks, spend | Day 1, 3, 7, 14 (owner dates), plus daily in week 1 | [MANUAL] |
| 10.2 | Stop rules: 30 minutes of continuous 503/timeouts, or 3 failed windows; investigate on 10 or more 503 in 1 hour or fill rate below 40% with rising 503 | Continuous watch in week 1 | [MANUAL] [OWNER] |
| 10.3 | Vercel runtime logs and Supabase logs: look for `[config]`, `[ads/serve]`, `[payments]`, `[admin]` lines; no secret in any line | Daily in week 1 | [MANUAL] |
| 10.4 | Spend against caps (50 USD per campaign per day, 100 USD per advertiser per day were decided but are **not enforced yet**; campaign daily budget is the only automatic stop) | Daily, by hand | [MANUAL] |
| 10.5 | `day-13-16` consistency check (read-only) | Weekly and after any incident | [MANUAL] |
| 10.6 | Backup success and one test restore per quarter | Per plan | [MANUAL] [OWNER] |
| 10.7 | Vercel Firewall denied-request counts and unusual 4xx spikes | Weekly | [MANUAL] |
| 10.8 | Dependency alerts (Dependabot or audit) | Weekly | [MANUAL] |
| 10.9 | CI stays green on the deployed branch | Every push | [AUTO] |
| 10.10 | Resume rule: after any automatic or manual stop, resume only with the owner's written approval | Always | [OWNER] |

Known monitoring gaps (not fixed in Step 6): no alerts (monitoring is read by hand), no per-hour view in the panel, no per-publisher or per-campaign error view, impression and click failures are not counted, the 503 catch-all returns without a log line, no request id, no percentile latency. Automatic spend and CTR protection is decided but not built.

---

Approval record (to be filled by the owner, not by Claude):

| Item | Name | Date | Decision |
| --- | --- | --- | --- |
| Pre-deployment gates complete | | | |
| Backup restore verified | | | |
| Migrations approved for Production | | | |
| Go-ahead to deploy | | | |
| Go-ahead to issue the first Production publisher key | | | |
