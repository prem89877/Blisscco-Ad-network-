# Blisscco Incident and Recovery Runbook (controlled pilot)

Added in Phase 5 Step 4 (2026-11-08). This file only adds what the existing documents lack. It does not repeat them: the pilot stop conditions are in `MVP-PILOT-SAFETY-CHECKLIST.md` section 10f, the key-leak steps in 10e, the secret rotation plan in section 3, the exposure check in section 6, the monitoring panel in section 15. Nothing here was run or tested. TEST/Preview only; Production is not touched by anything in this file.

Words used: **PROPOSED** = written by Claude for the owner to accept or change. **OWNER-STATED** = a decision the owner wrote. **BLANK** = an owner decision still missing; nobody fills it in for the owner.

## 1. Who decides

- Approver for stopping, restarting and payouts: Prem Talekar (OWNER-STATED, Phase 5 Step 1).
- Anyone (owner, approver, publisher) may stop at any time (10f).
- Nobody restarts after a stop until the cause is written down and the owner writes a restart decision (10f). The restart decision names the date, the cause, what was changed, and the approver.
- Backup and recovery responsible person: BLANK.

## 2. Monitoring instructions

Read, on the dates the owner set in `MVP-PILOT-SAFETY-CHECKLIST.md` section 11b:

1. Admin page, Pilot monitoring panel (7 UTC days): ad requests, fills, no-fills, 503 errors, caller errors (401, 429, 400), fill rate, average and slowest latency, serves, impressions, clicks, spend, consistency notes. Recording works only while `PILOT_METRICS_ENABLED` is `"1"` on the server. The panel shows window totals, not hours.
2. Campaign pages (spend against the written cap) and the publisher earnings, ledger and payout pages.
3. The publisher's own report for timeouts (Blisscco cannot see them).
4. Vercel function logs for the error labels (names and database error codes only, no keys, no conversation text) and Supabase project logs, when an error count rises.

Owner limits written so far (OWNER-STATED, Phase 5 Step 1): 503 or timeouts for 30 minutes continuously, or 3 consecutive failed observation windows, stops the pilot; 5 consecutive dashboard button failures stops it; 10 or more 503s in 1 hour, or fill rate below 40% with rising 503s, starts an investigation; one wrong match pauses the campaign; serves versus impressions within plus or minus 5%; server-side latency average below 400 ms and slowest below 1200 ms. Traffic limits (OWNER-STATED 2026-11-08, admin-configurable, **not implemented yet**): impressions or clicks above 3 times the previous 24-hour average within 1 hour give an **admin warning only** (never a pause), and only when the previous 24 hours had at least 100 impressions (impression alert) or 20 clicks (click alert); CTR above 5% is a warning (notify admin only); CTR above 10% is critical and pauses only the affected campaign, after at least 500 valid impressions; a spend-limit breach pauses the affected campaign; TEST campaigns are excluded from automatic production pauses and their alerts are kept separate. Spend limits (OWNER-STATED 2026-11-08, admin-configurable, **not implemented yet**): daily campaign spend limit 50 USD and daily advertiser spend limit 100 USD, applied to actual billable spend (not raw serves); a campaign over its limit is paused alone; an advertiser over its limit has all its active campaigns paused; the admin is notified and the reason goes to the audit log; no automatic resume after the daily reset (admin approval needed); TEST campaigns are kept apart from production limits. CTR for automatic pauses uses a rolling 24-hour window (valid clicks / valid impressions x 100, at least 500 valid impressions in the same window; threshold and window admin-configurable); lifetime CTR is for reports only. "Valid impression" means an impression the system accepted (valid token, not a duplicate). TEST campaigns will be marked by an explicit flag column on campaigns (to be added in the build step).

## 3. Severity (APPROVED by the owner, 2026-11-08)

The policy below is approved. **Automatic detection, automatic pausing, notification and the financial-operations switch are not built yet.** Until they are, a person applies the policy by hand using section 4. S1 always takes priority over S2.

**S1: highest-severity emergency**
- Covers: suspected secret, API key, SQL credential or personal data exposure; Production or real-money incidents; spend above a written cap; ledger and payout mismatch.
- Pause the affected campaigns at once and disable risky financial operations (payout requests, approvals, refunds).
- Never automatically modify or delete production data.
- Preserve logs, evidence and audit trails (section 6).
- Notify the owner and the designated approver immediately. Alerts and logs never contain secrets.
- Resume only after explicit owner approval.

**S2: high-priority operational incident**
- Covers: repeated 503 or timeouts; incorrect ads or ads against sensitive topics; duplicate billing or tracking events; repeated dashboard errors.
- Pause only the affected publisher integration or campaign.
- Preserve logs and evidence; notify the admin.
- Investigate and resolve within the same day.
- Admin approval before resuming a paused campaign or integration.
- An S2 incident never triggers a refund or payout.

**S3: low-severity monitoring**
- Covers: isolated errors, a single 503, minor cosmetic or interface problems.
- No automatic pause. Record it in the monitoring log. Review at the next scheduled observation.
- Escalate to S2 if the errors repeat or affect users, billing or ad delivery. Escalate to S1 at once if any S1 condition appears.

## 4. Emergency stop

**Stop-all switch (built in Phase 5 Step 4, not yet applied or tested anywhere):** Admin page, "Emergency stop" panel, button "Stop all ad serving". A reason of 3 to 200 characters is required and is saved in the append-only audit log (who, when, why). While stopped, the ad endpoint answers a plain no-fill (200, `fill:false`): no serve, no charge. It never refunds or pays out. It never resumes by itself: only an admin pressing "Resume ad serving" (with a reason) restarts ads, after the owner's restart decision (10f). It works only when (1) `supabase/sql/phase5-step4-1-emergency-stop.sql` has been applied to that project, and (2) the server variable `EMERGENCY_STOP_ENFORCED` is `"1"` (the panel warns when it is not). If the switch cannot be read while enforced, the endpoint answers 503 (fail closed). Timing: the switch is read on every ad request, so it takes effect on the next request.

If the switch is not applied or not enforced, use the existing controls below, most targeted first, and write the time of each:

1. Revoke the pilot key (Publisher page). The next request answers 401.
2. Suspend the pilot publisher (Admin page, publisher status).
3. Pause the campaign (Advertiser campaign page), or suspend the advertiser (Admin page, advertiser status).
4. If a secret may have leaked: follow the rotation plan in section 3 of the checklist (new `SUPABASE_SECRET_KEY`; new `AD_TRACKING_SECRET`, old one kept as `AD_TRACKING_SECRET_PREVIOUS` for a short time).
5. Never enable the Revive fallback as a workaround.

Check afterwards that the stop worked (the switch panel shows STOPPED and the audit list has the row; a revoked key answers 401; a paused campaign is not served).

## 5. Incident playbooks

| Incident | How to identify | Stop | Evidence | Recover | Who approves resuming |
| --- | --- | --- | --- | --- | --- |
| Ad-serving outage | Rising 503 in the panel; publisher reports no ads; the 503 answer is `unavailable`, a no-fill is a 200 | Nothing to stop: the publisher shows no ad and chat continues (Gate C). Pause the pilot if the owner's 503 limit is passed | Panel figures with date and time; Vercel log labels and error codes; Vercel deployment status | Find the cause in logs; after a fix, one controlled TEST request, then the owner's restart decision | Owner (Prem Talekar) |
| Supabase outage | 503 with database error codes in the logs; Supabase status page; dashboard pages failing | As above. No billing or payout actions during the outage | Same, plus the Supabase project log time window | After Supabase is back, check that no half-written spend, serve or ledger rows exist (the read-only consistency check `day-13-16-financial-consistency-verify.sql` on TEST), then restart | Owner |
| Compromised or invalid publisher key | A key seen outside the dashboard, unexplained traffic, 401s from a known key | Revoke first (10e) | Date, who, where it was seen, no key value | Replacement key through the dashboard only; remove the key from the places it was seen | Owner and approver |
| Unexpected advertiser spending | Campaign spend above the written cap, or a charge no request explains | Pause the campaign and stop the pilot (10f) | Campaign spend figures, serve counts, time | Compare serves, spend and ledger; correct only by ledger reversal or adjustment, never by deleting or editing | Owner |
| Duplicate impression or click | Consistency notes in the panel ("Impressions are higher than serves", "Clicks are higher than impressions") | Pause the affected campaign (15b) | Panel notes, counts, date | Find which rule was bypassed; correction by reversal or adjustment, never by deletion | Owner |
| Publisher earnings discrepancy | Earnings page, ledger and payout records disagree | Stop (10f); no payout is approved | Screenshots of earnings, ledger and payout pages; the output of the consistency check | Correction by reversal or adjustment entry with a written reason; no balance is changed any other way | Owner and approver |
| Accidental exposure of sensitive information | A key, secret, token, database address or personal data seen anywhere outside the dashboard | Stop (10f); revoke or rotate the exposed item first | Where, when, who saw it; do not copy the value into the record; do not delete the place until its location is recorded | Rotate or revoke; remove the exposed copy; re-run the exposure check (section 6 of the checklist) | Owner |

## 6. Evidence recording

For every incident, write one record with: date and time (with time zone), who found it, what was seen, severity, the stop actions with times, evidence kept (screenshots, panel figures, log labels, no secrets and no personal data), the cause, the fix, the restart decision (date, approver). Do not paste keys, tokens, addresses or conversation text. Ledger, payout and event records are append-only and are the evidence: never delete or edit them.

## 7. Backup and recovery

- Seen 2026-11-08 (owner screenshot of the Production project's Backups page): **Free plan, no project backups, no point-in-time recovery.** Nothing can be restored from a Supabase backup. Frequency, retention, recovery steps, required access and the recovery owner are BLANK; the owner decides whether to move to a plan with backups or keep a manual dump routine.
- Recovery has not been practised. Nothing here claims a successful recovery.
- Migrations are re-runnable SQL files with a written order (`supabase/MIGRATION-ORDER.md`, `supabase/DEPLOYMENT-RUNBOOK.md`); no rollback scripts are in `supabase/sql/`.
- A restore returns the database to an earlier time and loses later ledger, payout and event rows; those rows cannot be re-created by the append-only rules. Any restore is decided by the owner and the approver, never started during an incident without both.
- Do not start a Production backup, restore or migration from this file.

## 8. TEST-only incident rehearsal checklist (Phase 6 Step 5)

Rehearsal rules: **TEST/Preview only. NEVER run on Production.**

### Rehearsal S1: Suspected secret leak / budget breach
- **Trigger scenario:** A mock alert indicates an exposed test key or a test campaign spend exceeding pilot limits.
- **Action steps:**
  1. Open Admin Dashboard > "Emergency stop" panel.
  2. Enter reason: `"TEST rehearsal S1 stop"`. Click **"Stop all ad serving"**.
  3. Verify with `curl` on TEST match endpoint: response must be HTTP 200 with `{"fill":false}`.
  4. Revoke the test publisher key on the Publisher Dashboard. Verify with `curl`: next request returns HTTP 401.
  5. Pause test campaigns on the Advertiser page.
- **Evidence to capture:** Timestamp, admin audit row showing `"TEST rehearsal S1 stop"`, terminal output of 200 `{"fill":false}` and 401 `{"error":"unauthorized"}`.
- **Resume authority:** Owner (Prem Talekar) written restart decision only. Click "Resume ad serving" with reason `"TEST rehearsal S1 concluded"`.

### Rehearsal S2: High-priority operational failure (repeated 503 / wrong matching)
- **Trigger scenario:** Ad endpoint simulated 503 or mismatch report on a specific campaign.
- **Action steps:**
  1. Pause ONLY the affected campaign in the Advertiser dashboard.
  2. Verify other active campaigns still match and serve on TEST.
  3. Verify the paused campaign returns no-fill when requested directly.
  4. Keep ledger and payout operations untouched.
- **Evidence to capture:** Campaign status `"Paused"` in DB/UI, match response showing no-fill for the paused campaign's category.
- **Resume authority:** Admin approval after verifying root cause.

### Rehearsal S3: Monitoring anomaly / minor warning
- **Trigger scenario:** Isolated latency spike or single 400 bad request in TEST logs.
- **Action steps:**
  1. No pause. Record observation in private observation log.
  2. Check Pilot Monitoring Panel for error count rollup.
  3. If persistent across observation windows, escalate to S2.
- **Evidence to capture:** Monitoring panel screenshot/log line.
- **Resume authority:** Routine monitoring; no stop required.
