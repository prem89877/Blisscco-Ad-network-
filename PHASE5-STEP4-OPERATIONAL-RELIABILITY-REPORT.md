# Phase 5 Step 4: Monitoring, Incident Management and Operational Reliability Report

Date: 2026-11-08. Source of truth: uploaded `blisscco-ad-network.zip`, `PHASE5-STEP1-PENDING-ITEMS-REPORT.md`, `PHASE5-STEP2-PILOT-EVIDENCE-REPORT.md`, `PHASE5-STEP3-FINANCIAL-OPERATIONS-REPORT.md`, `MVP-PILOT-SAFETY-CHECKLIST.md`, the monitoring code and SQL.

Scope: code, schema and documentation review. **Nothing was run, no request sent, no SQL executed, no setting changed, no backup, restore or migration started.** Production untouched. Revive OFF. No billing, no payout, no traffic.

Evidence labels: **Code-read** (nothing run), **Seen** (owner screenshot or output in this project), **Owner-stated**, **Earlier** (earlier report, not repeated), **PENDING OWNER CONFIRMATION**, **DECISION NEEDED**.

Existing locked documents (`MVP-PILOT-SAFETY-CHECKLIST.md`, `MVP-VERIFICATION-RUNBOOK.md`) are many-times tested by document tests, so they were not edited. The missing procedures went into one new file, `MVP-INCIDENT-AND-RECOVERY-RUNBOOK.md`, which points to the existing sections instead of repeating them.

## Final report summary

1. **Existing monitoring:** an admin-only Pilot monitoring panel (7 UTC days): requests, fills, no-fills, 503, caller errors (401, 429, 400), fill rate, average and slowest server latency, serves, impressions, clicks, spend, consistency notes. Seen working on Preview in Step 2 (62 requests). Stores only outcome and duration, no keys, topics, IPs or campaigns.
2. **Missing metrics:** section 1.
3. **Error and latency visibility:** partial (section 2). Server latency average and slowest only; no percentile; no hourly view; timeouts only from publishers.
4. **Budget and emergency stop readiness:** campaign budget, publisher and advertiser suspension, key revocation and campaign pause exist. No single emergency stop, no spike detection, advertiser total limit not enforced (section 3). The owner has decided to build the stop-all switch and spike protection (section 9).
5. **Incident response readiness:** stop conditions and key-leak steps existed; severity, evidence, recovery, escalation and outage procedures did not. Added in the new runbook (section 4).
6. **Backup and recovery readiness:** Seen: the Production project is on the Free plan, which has no project backups, so nothing stored there can be restored. No procedure, no owner, no recovery practised (section 5).
7. **Previously completed tests intentionally skipped:** section 6.
8. **CI checks awaiting owner results:** none. `CI` and `DB integration` success is Owner-stated (Step 2). No code changed in this step.
9. **Files modified:** two new files (section 7). No existing file edited, no database change.
10. **Remaining owner decisions and confirmations:** section 8.
11. **Overall status:** section 10.

**Update (2026-11-08, later, Owner-stated):** the owner answered the open points of section 9d. Recorded in section 9e. Still nothing implemented; the admin button and the automatic checks wait for the owner's explicit start.

**Update 2 (2026-11-08, latest, Owner-stated):** the owner answered the four open questions (section 9f) and told Claude to build the stop-all button. The button is built (section 9g, not yet run anywhere); the automatic spend and CTR protection is still not built. Summary lines 4, 8 and 9 below are superseded by sections 9f and 9g; older text is kept as history.

## 1. Ad delivery monitoring

Existing (Code-read, `lib/ads/pilot-monitoring.ts`, `lib/ads/pilot-metrics-db.ts`, `supabase/sql/phase3-step4-1-pilot-request-metrics.sql`, `components/dashboard/PilotMonitoringPanel.tsx`):

- Every match request records one outcome, after the answer is sent, and never waits for the database: `fill`, `provider_fill`, `no_fill`, `unauthorized`, `rate_limited`, `invalid_request`, `unavailable`, with duration, in hourly buckets (`ad_request_metrics_hourly`).
- Request volume, successful responses, no-fill and fill rate: covered. Seen in Step 2: 62 requests, 30 fills, 24 no-fills, 0 x 503, 8 caller errors, fill rate 55.56%.
- Impressions and clicks: counted from the event tables; consistency notes flag impressions above serves and clicks above impressions.
- Advertiser and publisher analytics pages show impressions, clicks and CTR per campaign and per publisher.

Missing (Code-read):

1. **Per-publisher and per-campaign delivery errors:** the metrics table has no publisher or campaign column (a privacy choice). Publisher-specific and campaign-specific errors cannot be read. Only a publisher's own report or the logs help.
2. **Impression and click failures:** only the match endpoint is metered. A failing impression or click request (503, rejected token) is not counted.
3. **Hourly view:** the table is hourly, the panel shows window totals only. The owner's limits (30 minutes of 503s, 10 or more 503s in 1 hour) therefore cannot be read from the panel; they need an SQL read of the hourly table or a panel change.
4. **Percentiles:** only average and slowest; no P95.
5. **Caller errors are one number** (401, 429 and 400 together); 413 and 415 are not separated.
6. **No purge for the hourly table** (noted in the SQL file; owner decision).
7. **Spend and traffic spikes:** nothing watches for them (section 3).

## 2. Performance and error monitoring

| Item | Status |
| --- | --- |
| API latency | Server side average and slowest only. Seen (Step 2): 790 ms and 2,413 ms over 62 requests, above the owner limits of 400 and 1200 ms (owner decision: record, re-measure before 1 Dec 2026). |
| Slow requests and timeouts | Slowest request is shown. Publisher timeouts are not visible to Blisscco by design; the publisher reports them. Database calls time out after 8 seconds and answer 503 (route comment). |
| 4xx and 5xx | 401, 429, 400 aggregated; 503 counted separately. The click and impression endpoints are not counted. |
| Supabase connection and query failures | They surface as 503 `unavailable`. The server logs a static label with the database error code (for example `[ads/serve] authorize rpc failed <code>`). No separate metric and no alert. |
| Rate-limit events | 429 counted as `rate_limited`. The guard (20 wrong keys per minute per address, `lib/ads/ip-guard.ts`) lives in each server instance's memory, so it is only a first wall; the file recommends a Vercel Firewall rate-limit rule. **Seen** (owner screenshot, phone clock 6:35:26): Vercel Project Firewall active, System Mitigations active, **Custom Rules 0**, Bot Protection inactive; past day 2.1k allowed, 19 denied. So **no rate-limit rule of our own exists**. The screenshot does not show which Vercel project or environment it is, nor what the 19 denied requests were: **PENDING OWNER CONFIRMATION**. |
| Publisher integration errors | Only through the publisher's report and the 401, 400 counts. |
| Traceability without secrets | Good: logs hold labels and error codes only; metrics hold no key, IP, topic, campaign or conversation text; the match handler logs nothing itself (Code-read). |

Traceability gaps (Code-read, files read only): the match handler's catch-all returns 503 **without logging**, and the unapplied `503-debug-logging.patch` (not in the code) would add some labels, so some 503 causes leave no trace. No request id was found that ties a publisher's report to a log line. DECISION NEEDED whether to add either.

## 3. Budget and emergency stop controls

| Control | Status | Where |
| --- | --- | --- |
| Campaign budget exhaustion | Automatic stop before spend (total and daily). Daily cap verified earlier (Phase 3 Step 3); total exhaustion not run on Preview | `record_ad_serve`, `supabase/sql/day-13-4-ledger-service.sql` |
| Advertiser total budget limit | **Not enforced** (owner decided 2,000 USD; Step 3 section 7a) | Needs a database check and server code (new step) |
| Publisher suspension | Exists: serving requires an active key, publisher and profile | Admin page action `admin_set_publisher_status`; checked in `record_ad_serve` |
| Advertiser suspension | Exists: serving requires an active advertiser and profile | `admin_set_advertiser_status` |
| API key revocation | Exists and used (Step 2: key revoked) | Publisher page |
| Manual campaign pause | Exists; stops delivery (Phase 3 Step 3, user-reported) | Advertiser campaign page |
| **Emergency stop of all ad serving** | **Missing.** No switch, environment variable or database flag found. Today: revoke keys, suspend publishers, pause campaigns one by one | Suggested location (not built): a check at the start of `processMatch` in `lib/ads/match-handler.ts`, or a flag in `public.ad_platform_settings` read inside `record_ad_serve`, with an admin toggle in `app/dashboard/admin/page.tsx` |
| Unusual traffic or spend spike | **Missing.** The daily budget caps each campaign's spend, but nothing alerts. Panel is read by hand | Would extend `get_pilot_monitoring_summary` and the panel |

Thresholds not invented. BLANK, owner decisions: spend-spike and traffic-spike limits, and whether the spend and traffic checks need automatic action.

## 4. Incident response and recovery (existing documents against the five questions)

| Incident | Identify | Stop | Evidence | Recover | Approval to resume |
| --- | --- | --- | --- | --- | --- |
| Compromised key | partly | yes (10e) | no | yes (new key) | owner restart decision (10f) |
| Unexpected spending | yes (15b) | yes (10f) | no | no | owner restart decision |
| Duplicate impression or click | yes (15b notes) | yes (15b) | no | no | owner restart decision |
| Earnings discrepancy | partly | yes (10f) | no | no | owner restart decision |
| Sensitive exposure | yes (section 6) | yes (10f, section 3 rotation) | no | partly | owner restart decision |
| Ad-serving outage | behaviour only | none | no | no | none |
| Supabase outage | none | none | no | no | none |

Gaps: severity, evidence preservation, recovery steps, escalation and the two outage cases. **Addressed in `MVP-INCIDENT-AND-RECOVERY-RUNBOOK.md`** (monitoring instructions, proposed severity, emergency stop using existing controls, playbooks, evidence record, who decides). The severity levels and the spend and traffic limits are PROPOSED or BLANK for the owner; nothing there was tested.

## 5. Backup and recovery

| Item | Status |
| --- | --- |
| Backup configuration | **Seen** (owner screenshot, phone clock 6:34:35, project "Blisscco-Ad-network", branch main, tagged PRODUCTION): Database, Backups page says "Free Plan does not include project backups". **The Production database has no Supabase backup.** Scheduled backups and Point in time are therefore not available. |
| Frequency and retention | None (no backup exists on the Free plan, Seen). |
| Recovery procedure | Not documented, not practised. Nothing can be restored from a Supabase backup. No claim of recovery. Only a manual dump taken by a person would give a copy, and none is documented. |
| Migration recovery | Migrations are re-runnable files in a written order; no rollback scripts in `supabase/sql/`. |
| Access and credentials | Not documented (who holds the Supabase owner login and can take a dump or upgrade). |
| Responsibility | Not documented. |
| Ledger note | Append-only ledger and payouts: a restore loses later rows and they cannot be re-created. |

## 6. Previously completed tests intentionally skipped

Earlier and not repeated: publisher authentication and key revocation, 400 and 415 and 413, valid request, no-fill, impression and click cases, pilot request and latency measurements (Step 2), spend and daily cap checks, ledger consistency check (Step 3), CI and DB integration (Owner-stated success).

## 7. Files modified

- New: `MVP-INCIDENT-AND-RECOVERY-RUNBOOK.md`.
- New: `PHASE5-STEP4-OPERATIONAL-RELIABILITY-REPORT.md` (this file; later updated with section 9e, earlier text kept).
- Later update (2026-11-08): `MVP-INCIDENT-AND-RECOVERY-RUNBOOK.md` section 2 (limits line only). Both files are new in this step and no test reads them.
- No other existing file edited. No database change.
- Later update (2026-11-08, latest): the stop-all button build changed files, listed in section 9g (code, one new SQL file, tests, two documents). This report itself was updated with sections 9f and 9g only.

## 8. Remaining owner decisions and confirmations

1. Backups: answered by the screenshot (Free plan, none). **DECISION NEEDED** before any real data: move Production to a plan with backups, or keep a manual dump routine, and name who is responsible. Nothing was started.
2. Rate limit: answered by the screenshot (Custom Rules 0, none). **DECISION NEEDED** whether to add a rate-limit rule; also confirm which Vercel project the screenshot shows.
3. Severity levels S1, S2, S3: **approved** by the owner (section 9a).
4. Spend-spike and traffic-spike protection: **decided**, with thresholds (section 9b); the open points in section 9d still need the owner.
5. Emergency stop-all switch: **decided, yes** (section 9).
6. Whether to add per-hour reading, impression and click failure counts, a percentile, a request id and a log in the 503 catch-all (sections 1 and 2). Per-publisher and per-campaign metrics trade against the privacy design.
7. Purge rule for the hourly metrics table.
8. New open items after section 9e: how a campaign is marked TEST; confirm "valid impression"; spend-limit numbers and what an advertiser-level breach pauses; CTR window length; notification channel; which project the pg_cron screenshot shows and whether pg_cron is on for the other project.
9. Still open from earlier steps: key `cc54`, latency re-measurement before 1 Dec 2026, Step 1 manual items, the Step 3 assumptions and the go-ahead for the financial implementation step.

## 9. Owner decisions recorded (2026-11-08, Owner-stated, none implemented)

1. **Emergency stop of all ad serving: yes, build it.**
2. **Spend and traffic spike protection, all configurable by admin, no permanent hardcoding:**
   - daily campaign spend limit;
   - daily advertiser spend limit;
   - traffic spike detection for unusual rises in impressions and clicks;
   - when a limit or a critical anomaly threshold is passed: automatically pause the affected campaign for the time being, notify the admin, and write the reason in the audit log;
   - resuming a paused campaign needs admin approval;
   - never automatically issue refunds or payouts.

What this needs (Code-read; **not built**, outside Step 4; it is a new implementation step, naturally together with the Step 3 financial work):

| Decision | What exists today | What is needed |
| --- | --- | --- |
| Daily campaign spend limit | `campaigns.daily_budget` already stops serving at the cap (the advertiser sets it, it resumes next UTC day) | A separate admin-set protective limit that pauses and audits instead of only rejecting. Assumed separate from the advertiser's own daily budget |
| Daily advertiser spend limit | None | A setting (global default, optionally per advertiser) and a check on the sum of that advertiser's campaigns per UTC day |
| Traffic spike detection | Hourly request counters for the match endpoint only; impression and click rows carry time | A written definition of "unusual" (the owner's numbers), a periodic check (the project's database job extension was a Day 8 question: **PENDING OWNER CONFIRMATION** whether it is on) or a check at event time |
| Automatic pause | Pause exists for the advertiser, but the lifecycle guards (`day-9-7`) limit status changes | A distinct "paused by the system" state that the advertiser cannot undo, and the pause must not lose track of why |
| Notify admin | Only the monitoring panel read by hand | In-dashboard notice (no new service) or email (needs an email service). **DECISION NEEDED** |
| Audit log | Ledger, payout and settings changes have append-only histories; nothing for pauses | One append-only table of automatic and manual pauses with reason, time, actor |
| Admin approval to resume | Admin page can set advertiser and publisher status | An admin approval action for system-paused campaigns |
| Never auto refund or payout | True today: payouts and refunds happen only through user and admin actions | Keep it so; assert it in the new tests |
| Stop-all switch | None | A flag read at the start of `processMatch` in `lib/ads/match-handler.ts` and inside `record_ad_serve`, an admin toggle in `app/dashboard/admin/page.tsx`, and an audit entry |

Still blank, owner decisions: the numeric limits (daily campaign, daily advertiser, spike size), the "critical anomaly" definition, and the notification channel.

### 9a. Severity policy approved (Owner-stated, 2026-11-08; none implemented)

Recorded in `MVP-INCIDENT-AND-RECOVERY-RUNBOOK.md` section 3. S1 always takes priority over S2.

- **S1 (emergency):** suspected secret, API key, SQL credential or personal data exposure; Production or real-money incident; spend above a written cap; ledger and payout mismatch. Pause affected campaigns and disable risky financial operations at once; never automatically modify or delete production data; preserve logs, evidence and audit trails; notify the owner and the designated approver immediately; explicit owner approval before resuming; no secrets in alerts or logs.
- **S2 (high priority):** repeated 503 or timeouts, incorrect ads or ads on sensitive topics, duplicate billing or tracking events, repeated dashboard errors. Automatically pause only the affected publisher integration or campaign; preserve evidence; notify admin; investigate and resolve the same day; admin approval to resume; never trigger refunds or payouts.
- **S3 (low):** isolated errors, a single 503, cosmetic problems. No automatic pause; record in monitoring logs; review at the next scheduled observation; escalate to S2 if repeated or if users, billing or ad delivery are affected; escalate to S1 at once on any S1 condition.

### 9b. Traffic thresholds given (Owner-stated, 2026-11-08; all admin-configurable)

*Corrected by section 9e (impression and click spikes are warnings only, with minimum baselines). Original table kept as history.*

| Signal | Threshold | Action |
| --- | --- | --- |
| Impression spike | More than 3 times the previous 24-hour average within 1 hour | Notify admin (assumed warning, see 9d) |
| Click spike | More than 3 times the previous 24-hour average within 1 hour | Notify admin (assumed warning, see 9d) |
| CTR warning | Above 5% | Notify admin only |
| CTR critical | Above 10% | Pause the affected campaign temporarily and notify admin |
| Minimum sample | 500 impressions before the CTR alerts apply | |

Never automatic refunds or payouts. Resuming a paused campaign needs admin approval.

### 9c. What can be detected today (Code-read)

| Detection wanted | Today |
| --- | --- |
| Repeated 503 | Counted in the panel (7-day totals only); no hourly view, no alert |
| Timeouts | Not visible to Blisscco (publisher side) |
| Incorrect ad or sensitive-topic ad | Only by a person comparing topic and category; sensitive topics tested earlier as no-fill |
| Duplicate billing or tracking events | Consistency notes in the panel; the read-only consistency check; the database refuses duplicates |
| Repeated dashboard errors | Nothing records them |
| Impression, click and CTR per campaign per hour | Not stored as such. `ad_events` carries campaign, event type and receive time, so it can be computed; no job does it |
| Spend above cap | Daily and total budget stop serving; nothing alerts or audits |
| Ledger and payout mismatch | Read-only consistency check, run by hand |
| A place to record S3 incidents | None (the metrics table holds counters only) |

So nearly all automatic S1 and S2 detection, pausing and notifying is new work.

### 9d. Open points (assumptions stand unless the owner corrects them)

*Points 1, 2, 3 and 5 are answered in section 9e. Original text kept as history.*

1. The impression and click spikes are treated as **warnings** (notify only); only CTR above 10% and the spend limits pause a campaign.
2. A new campaign or a quiet one has a tiny 24-hour average, so 3 times that is passed by one or two events. A minimum count for the spike alerts is needed; no number was invented. **DECISION NEEDED.**
3. The pilot's own TEST campaign shows CTR 66% to 77% (Seen), because test clicks are sent for nearly every impression. Once the 500-impression minimum is passed, such a campaign would reach the critical alert and pause. Expected, but plan for it.
4. Notification channel: dashboard notice assumed (no email service). Designated approver: Prem Talekar (Owner-stated, Step 1).
5. Whether the database job extension (`pg_cron`) is on, in TEST and in Production: only the owner can look (read-only: `select jobname, schedule, active from cron.job;`). The existing 90-day log purge job also depends on it. If it is off, checks run at event time instead.
6. Log retention in Vercel and Supabase on the current plans is unknown, so "preserve logs" is not guaranteed yet.

Not built in this step. The build is a separate step and needs the owner's explicit start.

### 9e. Owner corrections (2026-11-08, Owner-stated; none implemented)

The owner approved the corrections to the assumptions of section 9d:

| # | Decision | Replaces |
| --- | --- | --- |
| 1 | Impression and click spikes give an **admin warning only**. They never pause a campaign automatically. | 9d point 1 (confirmed) |
| 2 | Minimum baseline: **100 impressions** in the previous 24 hours for an impression spike alert; **20 clicks** in the previous 24 hours for a click spike alert. Below that, no spike alert. | 9d point 2 (was BLANK) |
| 3 | **CTR above 10%** is a critical alert and pauses **the affected campaign only**, and only after **at least 500 valid impressions**. CTR above 5% stays a warning (admin only, 9b). | 9d point 3 |
| 4 | A **spend-limit breach pauses the affected campaign automatically** (with admin notice and an audit entry, 9). | Section 9 |
| 5 | **TEST campaigns are excluded** from automatic production safety pauses. Alerts for TEST campaigns are kept **separate** from production alerts. | 9d point 3 (the 66% to 77% TEST CTR no longer pauses) |
| 6 | **All thresholds are configurable by the admin** (no hardcoded values). | Section 9 |

S1 and S2 emergency incident rules (9a) are **unchanged**. Never automatic refunds or payouts. Resuming a paused campaign needs admin approval.

What the corrections need when they are built (Code-read; nothing built):

1. **How a campaign is marked TEST:** the schema has **no test flag** on campaigns (searched `supabase/sql`, `lib`, `app`). TEST campaigns are told apart only by their name ("TEST Campaign A"). A name rule is fragile. **DECISION NEEDED:** add an explicit flag on `campaigns` (new column, new migration, in the build step) or another rule the owner names.
2. **Where the thresholds live:** `public.ad_platform_settings` is the existing single-row settings table (CPM, rate limit), with append-only history for financial settings (`day-13-12-financial-security.sql`, `financial_settings_history`). Suggested place for the new admin-editable thresholds, with changes written to a history. An admin edit form belongs in `app/dashboard/admin/page.tsx`.
3. **"Valid impression":** assumed to mean an impression event the system accepted (token valid, not a duplicate, not rejected). **PENDING OWNER CONFIRMATION** of that wording before the build; the code that decides acceptance is in the impression path.
4. **Spend-limit numbers are still BLANK** (daily campaign protective limit, daily advertiser limit), and so is what an **advertiser-level** breach pauses (all active campaigns of that advertiser, or only the one that crossed). Not invented.
5. **Alert storage and notice:** a dashboard notice with a TEST flag, so test alerts show apart. Email still needs an email service (DECISION NEEDED, 9d point 4).
6. **Pause state:** the automatic pause must be a "paused by the system" state that the advertiser cannot undo, with the reason stored (section 9, "Automatic pause").
7. **CTR rule check:** CTR is computed per campaign over the window the owner names; the window length is not stated yet (**DECISION NEEDED**, otherwise a lifetime CTR would hide a recent burst).

Scheduler (`pg_cron`): **Seen** (owner screenshot, phone clock 7:08:09): Database, Extensions, search "cron": `pg_cron` version 1.6.4, schema `pg_catalog`, **enabled**. The project shown is "Denim Hub Bsl", branch main with Supabase's PRODUCTION tag, organisation on the Free plan. Step 3 section 6a already treats "Denim Hub Bsl" as the TEST project, **PENDING OWNER CONFIRMATION**. The Step 4 backup screenshot was a different project, "Blisscco-Ad-network". So: pg_cron is on for "Denim Hub Bsl" (Seen); for "Blisscco-Ad-network" it is **not shown, PENDING OWNER CONFIRMATION**. The 90-day log purge job's presence (`cron.job`) was not seen. If a project has it off, the checks run at event time instead of on a schedule.

### 9f. Owner answers to the four open questions (2026-11-08, Owner-stated; none implemented except the stop-all button in 9g)

| # | Question | Owner answer |
| --- | --- | --- |
| 1 | How to mark TEST campaigns | **Approved:** an explicit flag column on `campaigns` (replaces the name rule). Not built yet: it needs a column, a way for only the admin to set it (an advertiser must not be able to flip it to avoid limits), and the automatic checks that use it. |
| 2 | "Valid impression" | **Confirmed:** an impression the system accepted (valid token, not a duplicate). Closes 9e point 3. |
| 3 | Spend limits | **Set, admin-configurable:** daily campaign limit **50 USD**; daily advertiser limit **100 USD**. Campaign over its limit: pause only that campaign. Advertiser over its limit: pause **all** active campaigns of that advertiser. Notify admin and write the reason in the audit log. **No automatic resume** after the daily reset; admin approval needed. Limits apply to **actual billable spend**, not raw serves. TEST campaigns kept apart from production limits. Closes 9e point 4. |
| 4 | CTR window | **Rolling 24 hours** for the critical CTR alert and the automatic pause. CTR = valid clicks / valid impressions x 100, with at least **500 valid impressions in that same 24-hour window**. CTR above **10%** is a critical alert and pauses only the affected campaign. **Lifetime CTR is reporting only**, never an automatic decision. Threshold and window admin-configurable. Closes 9e point 7. Replaces the "window not stated" gap. |

Still open: how the admin is notified (dashboard notice assumed, email needs an email service); where "billable spend" is read for the per-advertiser daily sum (code-read: `campaign_spend_daily` per campaign per UTC day is the nearest existing source; billable versus served spend must be confirmed when the checks are built); the 5% CTR warning stays as in 9b. The checks are **not built**: they need the TEST flag column, the settings, the audit entries for automatic pauses, a "paused by the system" state the advertiser cannot undo, and a periodic job or event-time check. Owner start needed for that step.

### 9g. Stop-all button built (2026-11-08, Owner-stated "build the button"; Code-read and written only, **nothing run**)

What it does: Admin page, new "Emergency stop" panel at the top. "Stop all ad serving" needs a reason (3 to 200 characters); the reason, admin and time go to an append-only audit log. While stopped, the match endpoint answers a plain no-fill (200, `fill:false`) before authorizing, selecting or recording a serve, so nothing is served or charged. "Resume ad serving" (also with a reason) is the only way back: nothing resumes automatically. It does not touch billing, ledger, payouts, refunds, campaigns or keys. Revive fallback untouched (off).

Design choices to confirm (**PENDING OWNER CONFIRMATION**):

1. The ad endpoint reads the switch only when the server variable `EMERGENCY_STOP_ENFORCED` is `"1"` (default off, so nothing changes until the owner sets it, same pattern as the other flags, and the existing tests that count database calls are unaffected). The panel shows a warning while it is not set. Without that variable the button changes the flag but ads keep serving.
2. When enforced and the flag cannot be read, the endpoint answers 503 (fail closed).
3. A stop answers no-fill (200), so it counts as a no-fill in the pilot panel, not as a 503. The audit log, not the panel, shows stops.
4. One extra database read per ad request while enforced (no caching, so the stop is immediate).
5. Impression and click requests for ads already served are not stopped; only new serving.

Not tested anywhere: the SQL was not applied (TEST first), the button was not clicked, `npm test`, lint and build were not run here (the owner's CI runs them). Manual checks for the owner on TEST/Preview only, after applying the SQL to TEST: the five checks in the file footer; set `EMERGENCY_STOP_ENFORCED=1` on Preview; press Stop and send one TEST match request (expect `{"fill":false}`); press Resume and confirm serving works again. Do not do this on Production.

Files changed in this build: see the list in the delivery message (new SQL file, `lib/ads/emergency-stop.ts`, `lib/ads/emergency-stop-db.ts`, `lib/ads/match-handler.ts`, `app/dashboard/admin/safety-actions.ts`, `app/dashboard/admin/page.tsx`, `components/admin/EmergencyStopPanel.tsx`, `tests/ads/phase5-step4-emergency-stop.test.ts`, the allowlists in `tests/auth/part3-hardening.test.ts` and `tests/ads/day10-part6-final.test.ts`, `MVP-INCIDENT-AND-RECOVERY-RUNBOOK.md`, `supabase/MIGRATION-ORDER.md`, this report).

CI results awaited from the owner for this change: `CI` (type check, `npm test`, ESLint, build). `DB integration` is not affected (no existing SQL changed).

**Owner-confirmed on TEST/Preview (2026-11-08, Owner-stated with screenshots and REST responses; Production untouched):**

- Panel visible on the Admin page; state loads ("Ad serving is running" / "STOPPED"); Stop saved the reason and showed an audit row (screenshots).
- With `EMERGENCY_STOP_ENFORCED=1` active (the warning disappeared only after a fresh git-triggered Preview build; a Vercel "Redeploy" had kept the old environment snapshot, and the variable was first saved for Production too, then limited to Preview only), a TEST match request answered `{"fill":false}` while STOPPED and a normal ad (`fill:true`) after Resume.
- Extra change: a read-only "Check:" line under the warning (variable present, length, equals 1, deployment, commit; never the value). Files: `lib/ads/emergency-stop.ts`, `app/dashboard/admin/page.tsx`, `components/admin/EmergencyStopPanel.tsx`, `tests/ads/phase5-step4-emergency-stop.test.ts`.

Still **PENDING OWNER CONFIRMATION:** SQL footer checks 1 to 4 on the TEST database; the audit list showing both Stopped and Resumed rows; a non-admin call of `admin_set_ad_serving_stopped` answering 42501; CI result for the diagnostic change; the five design choices above; and a Production decision (SQL not applied there, `EMERGENCY_STOP_ENFORCED` must stay off for Production until then).

## 10. Overall operational reliability status

**Adequate for a supervised, controlled TEST pilot with manual checks on the owner's dates. Not adequate for unattended or real traffic.** Monitoring is manual and has no alerts; there is no stop-all switch, no spike detection, no per-publisher or per-campaign error view; backup and recovery are undocumented and unverified; server latency is above the owner limits. The incident runbook now exists but has never been exercised. **The Production database has no backup (Free plan, Seen): nothing stored there can be restored, which must be solved before any real data or real money.**

**After the stop-all build (9g):** a stop-all switch now exists in code but is unapplied, unenforced and untested; the status above is otherwise unchanged. Automatic spend and CTR protection is decided (9f) but not built.

Phase 5 Step 5 is not started.
