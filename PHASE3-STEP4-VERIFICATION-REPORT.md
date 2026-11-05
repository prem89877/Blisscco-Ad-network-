# Blisscco Phase 3 Step 4: Pilot Monitoring - Verification Report

Date: 2026-11-05 (UTC)
Scope: Preview environment only. Production database and Production deployment were NOT touched.

## 0. How to read this report

Every item below is marked with who verified it:

- **[CLAUDE-VERIFIED]** Claude read it or ran it directly (Supabase / Vercel connectors, read-only unless stated).
- **[OWNER-REPORTED]** The owner told Claude it was verified. Claude did not re-run it and has no test output to attach.
- **[NOT DONE]** No evidence exists yet.

Simulated or test values are never presented as real pilot results. No real pilot traffic exists.

## 1. Environments found

| Item | Value | Source |
|---|---|---|
| Vercel project | blisscco-ads (prj_6n4vwxqWJfXi9ojxnutpy0i7HxAQ) | [CLAUDE-VERIFIED] |
| Preview Supabase project | ficwuieqjdhrrxbvuqot (named "Denim Hub Bsl") | [CLAUDE-VERIFIED] via Preview NEXT_PUBLIC_SUPABASE_URL |
| Production Supabase project | mfliodvkaszqywajbshu (named "Blisscco-Ad-network-") | [CLAUDE-VERIFIED] via Production NEXT_PUBLIC_SUPABASE_URL |
| Preview deployment with Step 4 | blisscco-51tn6e60m, branch preview-day-c, commit b64e9b3 | [CLAUDE-VERIFIED] |

## 2. Database state

| Check | Preview DB (ficwu...) | Production DB (mflio...) |
|---|---|---|
| ad_request_metrics_hourly table | present | present (0 rows, RLS on, no grants to any role) |
| record_ad_request_metric function | present, service_role only | present, service_role only, security definer |
| get_pilot_monitoring_summary function | present, authenticated only | present, authenticated only, admin check inside, does not read the ledger |
| RLS on metrics table | on | n/a |

All [CLAUDE-VERIFIED] (Production column re-read on 2026-11-05 via the Supabase connector; read-only queries, nothing was run or changed there by Claude). The migration `supabase/sql/phase3-step4-1-pilot-request-metrics.sql` was already applied on Preview by the owner. Claude did not apply it anywhere. Production was only read.

Function check: `record_ad_request_metric('fill', 5)` was run inside a transaction that was deliberately rolled back. The row was inserted and then discarded, so the function works and no test data was left. [CLAUDE-VERIFIED]

## 3. Live Preview result (TEST requests only, not pilot data)

After the owner sent TEST requests to the Preview deployment, `ad_request_metrics_hourly` held:

| Hour (UTC) | Outcome | Requests | Total latency (ms) | Max latency (ms) |
|---|---|---|---|---|
| 2026-11-05 01:00 | fill | 2 | 3556 | 2413 |

`ad_serve_log` showed 3 serves in the same 30 minutes: one before recording was enabled and two after. Metrics count (2) matches the two post-fix requests. [CLAUDE-VERIFIED]

These are two test requests. They are not a baseline and no latency claim or threshold is made from them.

## 4. Root causes found while debugging (Preview)

1. **Recording looked broken because the flag was not live.** `PILOT_METRICS_ENABLED=1` was scoped to branch `preview-day-c` only, and the deployment tested earlier did not carry it. Zero calls to `record_ad_request_metric` appeared in Supabase logs until the flag scope was widened and a deployment rebuilt. After that, recording worked. [CLAUDE-VERIFIED]
2. **Admin login 401 on the newest deployment.** The newest deployment (blisscco-i3bdf88uo) was built from `main`. For non-`preview-day-c` previews the publishable key is `sb_publishable_Kc0A4...`, which belongs to the Production project, while the Preview URL points at the other project. Supabase returned 401 on `/auth/v1/token`. Using the `preview-day-c` deployment avoids this. [CLAUDE-VERIFIED]
3. **Preview DB is shared with another app.** Auth logs on ficwuieqjdhrrxbvuqot show activity from `denim-store-bsl.vercel.app`. Blisscco Preview and the Denim store use the same Supabase project. [CLAUDE-VERIFIED]
4. **Code is consistent.** `lib/ads/match-handler.ts` and `lib/ads/service.ts` on GitHub branch preview-day-c contain the Step 4 wiring and match the ZIP. [OWNER-REPORTED, screenshot and pasted file; the pasted match-handler.ts was compared with the ZIP by Claude]

## 5. Tests

Test files for Step 4 (from the task):

- tests/ads/phase2-pilot-monitoring.test.ts
- tests/ads/publisher-examples.test.ts
- tests/campaigns/phase2-campaign-button-flow.test.ts
- tests/ledger/ (only if ledger code changed; the Step 4 report says it did not)

Result: **[OWNER-REPORTED] all tests for this prompt are verified.** Claude did not run the test suite in this session (the sandbox has no network and no installed dependencies) and has no pass/fail counts to attach. Attach the real test output from the owner's run to this report before treating it as an audit record.

## 6. Preview checks reported by the owner

The owner reports that every item in the table below was done on Preview. These are [OWNER-REPORTED]. Claude has no output or screenshot for them and did not repeat them.

## 6a. Items (original list)

| Item | Status |
|---|---|
| no_fill outcome recorded on Preview (e.g. topic "politics") | [OWNER-REPORTED done] |
| unauthorized outcome recorded on Preview (wrong key) | [OWNER-REPORTED done] |
| Same Idempotency-Key replay does not inflate fill count | [OWNER-REPORTED done] |
| Admin sees the Pilot monitoring panel with real numbers | [OWNER-REPORTED done] (earlier login failure was on the main-branch deployment) |
| Advertiser account cannot see the panel | [OWNER-REPORTED done] |
| Publisher account cannot see the panel | [OWNER-REPORTED done] |
| Publisher earnings and ledger charges in the panel | Not part of Step 4 (pending owner decision, per Step 4 report) |
| Manual Preview verification | [OWNER-REPORTED] complete |

## 7. Thresholds

`MVP-PILOT-SAFETY-CHECKLIST.md` section 15 defines actions and stop conditions. Every numeric limit (error-rate increase, timeout count, latency limit, spend caps, tracking tolerance) is still a **blank owner decision**. None was measured, so none is claimed.

## 8. Production readiness

**Verdict: NOT ready to enable Step 4 monitoring in Production yet.**

Blocking items:

1. ~~Monitoring SQL not applied to Production~~ Resolved: the table and both functions are present in the Production DB (section 2), with the expected grants.
2. `PILOT_METRICS_ENABLED` for Production: [OWNER-REPORTED] set for Production and Preview. Claude did not re-check it in Vercel.
3. Admin panel, and non-admin blocking, have not been verified.
4. no_fill / unauthorized / duplicate-replay checks have not been done.
5. Section 15b threshold fields are blank and the section 15 checklist items are unchecked.
6. [OWNER-REPORTED] Step 4 code is on the deployed branch and the admin page shows the Pilot monitoring panel. Claude did not verify the `main` commit. Original note: the Step 4 code must be merged to `main`; Production deploys from `main`, which is at commit 87f75e7. Whether that commit contains Step 4 was not verified.
7. Real test output (section 5) is not attached.

What is low-risk by code reading (not run against Production): with the flag unset, recording is off and does not call the database. If the summary function is missing, the admin panel returns an "error" state instead of crashing (`loadPilotMonitoring` in `lib/ads/pilot-monitoring.ts`). Billing, ledger, payout and eligibility code were not changed in Step 4.

Suggested order: finish section 6 on Preview, fill thresholds, attach test output, apply SQL to Production DB with approval, merge to main, deploy with the flag OFF, confirm the admin panel shows the "recording off" state, then turn the flag on and check one real request.
