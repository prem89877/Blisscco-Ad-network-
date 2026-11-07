# Phase 5 Step 2: Controlled Pilot Evidence Report

Date: 2026-11-07. Source of truth: uploaded `blisscco-ad-network.zip`, `PHASE5-STEP1-PENDING-ITEMS-REPORT.md`, `PHASE4-STEP2-PILOT-EXECUTION-REPORT.md`. Status: **COMPLETE for evidence collection. Ready for owner review with open items. Not ready for sign-off.**

Scope: Preview/TEST only, TEST publisher, new TEST key, Revive fallback OFF. Production untouched. The 30-request limit was not increased. Claude has no access to any deployment: every figure below comes from the owner's terminal output and phone screenshots. No host, key, token or `click_ref` is written here.

Evidence labels: **Seen** = owner pasted output or screenshot. **Owner-stated** = owner's word only. **Derived** = Claude's arithmetic on Seen numbers. **Code-read** = Claude read the code, nothing was run. **Pending** = no evidence yet. Historical reports are not edited (Step 1 notes that document tests lock several of them). This file is the only addition.

Evidence timestamps (phone clock, 7 Nov 2026, time zone not stated): advertiser before-reading 1:52:34 to 1:52:45; pass requests between 1:52:45 and 2:01:18 (Derived); advertiser after-reading 2:01:18 to 2:01:29; publisher pages 2:04:11, 2:04:17, 2:06:31; admin pilot monitoring 2:07:23, 2:07:42; key list 2:10:09 and 2:15:51.

## Final report summary

1. **Pilot requests verified:** 5 controlled serves, all HTTP 200, no 429, 503 or timeout. Admin panel (7 days): 62 requests, 30 fills, 24 no-fills, 0 x 503, 8 caller errors. Count against 30: 11 by Claude's record, plus the owner's estimated maximum of 10 from other tests today (Owner-stated), so **at most about 21 of 30, at least 9 remaining** (estimate, not verified).
2. **Click attribution:** VERIFIED. Campaign `38d54e0b`: impressions +1, clicks +1; account +1 and +1; publisher totals (13 and 10) equal account totals.
3. **Publisher ledger reconciliation:** ledger arithmetic consistent (0 + 5 + 0 = 5). Earnings per serve not recorded: `ledger_enabled = false`, `publisher_share_bps` null (Seen). Advertiser spend (exact at 0.002 per serve) cannot be reconciled with publisher earnings while recording is off. No payout, no billing.
4. **Latency:** server side average 790 ms, slowest 2,413 ms (62 requests, 7 days), above the owner limits of 400 and 1200 ms. Owner decision: record as above limit, not investigated in Step 2, measure again before the 1 Dec 2026 pilot start. P95 not available. Client side (Termux, n = 5 match): average 1360 ms, slowest 2269 ms.
5. **Previously completed tests intentionally skipped:** duplicate click and impression, invalid token, 401, 400, 415, 413, no-fill on unmatched topics, key create, show-once and revoke, signup and approval, creative and rich-delivery checks, CI performance tests.
6. **CI checks awaiting owner results:** `CI` (type check, `npm test`, ESLint, build) and `DB integration` (TEST database). Results not yet supplied.
7. **Pending operational evidence:** status of the key ending `cc54` (no screenshot); CI results; Gates A to D and other Step 1 manual items (unchanged).
8. **Errors and unresolved discrepancies:** latency above limits (accepted as recorded, owner decision A); request count is an owner estimate; no ledger earnings because recording is off; 5.0000 USD adjustment and 2.0000 USD payout hold are owner-made test data (below).
9. **Exact files modified:** `PHASE5-STEP2-PILOT-EVIDENCE-REPORT.md` only (new).
10. **Ready for final review:** ready for the owner's review of the evidence; **not ready for sign-off** until the open items above are closed.

## 0. Test status summary

Status words: **VERIFIED** (Seen evidence, this pass), **VERIFIED EARLIER, SKIPPED** (not repeated), **OWNER-STATED** (word only), **PENDING OWNER CONFIRMATION**, **NOT TESTED by decision**, **AWAITING CI**.

| Area | Test | Status |
| --- | --- | --- |
| Requests | 5 controlled serves (200), no 429/503/timeout | VERIFIED (HTTP lines Seen) |
| Requests | Count against the 30 limit: 11 by Claude's record plus up to 10 from other tests today | OWNER-STATED estimate (at most about 21 of 30); not verified |
| Requests | Ad request and response records, no-fill records | VERIFIED (admin panel: 62 requests, 30 fills, 24 no-fills, 0 x 503, 8 caller errors) |
| Requests | Fallback delivery | NOT TESTED by decision (Revive OFF) |
| Clicks | Valid impression recorded, click 302 recorded once | VERIFIED |
| Clicks | Campaign (38d54e0b) and account counters +1 and +1; publisher totals equal account totals | VERIFIED (screenshots); owner confirmation of the attribution still required |
| Clicks | Duplicate click, duplicate impression, invalid token | VERIFIED EARLIER, SKIPPED |
| Spend | Advertiser spend vs serves (0.002 per serve, exact) | VERIFIED (Derived from screenshots) |
| Ledger | Ledger balance = earned + adjustments + reversals | VERIFIED (0 + 5 + 0 = 5) |
| Ledger | Publisher earning per serve | NOT RECORDED: recording is off (`ledger_enabled = false`, `publisher_share_bps` null, Seen). Not a fault; enabling it is outside this step |
| Ledger | Advertiser spend vs publisher earnings | CANNOT BE RECONCILED while recording is off |
| Ledger | Duplicate and invalid event exclusion for earnings | NOT TESTABLE while recording is off; earlier verification only |
| Ledger | 5.0000 USD adjustment and 2.0000 USD payout hold | OWNER-STATED test data from the earnings and payout implementation; see section 4 |
| Latency | Server-side average 790 ms, slowest 2,413 ms (62 requests) | MEASURED; **above owner limits** (400 and 1200 ms). Owner decision: record as above limit, not investigated, re-measure before 1 Dec 2026 |
| Latency | P95 | NOT AVAILABLE (panel gives none; client sample of 5 too small) |
| Latency | Client-side Termux timings (7 requests) | MEASURED (not comparable with the server limits) |
| Keys | Pass key revoked | VERIFIED status (Seen) and OWNER-STATED date 7 Nov 2026 |
| Keys | All keys used for testing only, revoked after (Owner-stated) | OWNER-STATED; fourth key (ends `cc54`) status not visible: PENDING |
| CI | `ci.yml`, `integration.yml` results | AWAITING CI (owner) |
| Gates A to D, Step 1 open items | Publisher-dependent and manual checks | PENDING OWNER CONFIRMATION, unchanged |

## 1. Controlled request usage (limit 30)

| Item | Value |
| --- | --- |
| Used before this pass (Claude's record) | 6 (4 no-fill, 2 401) |
| Requests this pass | 5 (topic `travel`, valid TEST key) |
| Total by Claude's record | 11 of 30 |

| # | Outcome | Evidence |
| --- | --- | --- |
| 1 | 200, `fill:true`, tracking header on | Seen |
| 2 to 5 | 200 | Seen (HTTP line only). Fill is Derived: the campaign "Ads served" counter rose by 5 |

No 429, 503 or timeout in this pass.

**Admin pilot monitoring panel (last 7 UTC days, Seen):** ad requests 62, successful fills 30, no-fills 24, 503 errors 0, caller errors (401, 429, 400) 8. Fill rate 55.56% (Derived check: 30 / (30 + 24) = 55.56%). 30 + 24 + 8 = 62.

**Owner-stated (2026-11-07):** other tests were also run today from other places, and the owner counts them against the pilot limit, estimated at **10 requests at most**. Total therefore: 11 (Claude's record) + up to 10 = **at most about 21 of 30, at least 9 remaining**. This is an owner estimate; Claude cannot separate those requests in the panel. The limit was not increased. No further requests were made after this pass.

## 2. Click and impression attribution (advertiser side)

Campaign: TEST campaign, category Travel, total budget 1.00 USD. Campaign id first 8 characters: **38d54e0b** (Owner-stated).

| Counter | Before (1:52:34 to 1:52:45) | After (2:01:18 to 2:01:29) | Change |
| --- | --- | --- | --- |
| Campaign impressions | 9 | 10 | +1 |
| Campaign clicks | 6 | 7 | +1 |
| Campaign CTR | 66.67% | 70.00% | consistent |
| Ads served | 279 | 284 | +5 |
| Account analytics impressions | 12 | 13 | +1 |
| Account analytics clicks | 9 | 10 | +1 |

Actions: one valid impression (`200 {"ok":true,"status":"recorded"}`), one click (`302`, once). The second campaign stayed at 3 impressions and 3 clicks (Derived). Publisher totals match, see section 4. Owner confirmation still required.

Not repeated, already verified earlier: duplicate impression, invalid token, duplicate click, 401, 400, 415, 413.

## 3. Spend reconciliation (advertiser side)

| Item | Before | After |
| --- | --- | --- |
| Spend so far | 0.5580 USD | 0.5680 USD |
| Budget left | 0.44 USD | 0.43 USD |
| Spend "today" (UTC) | 0.0100 USD | 0.0200 USD |

Derived: 279 x 0.002 = 0.5580 and 284 x 0.002 = 0.5680, both exact. Charge is 0.002 USD per serve, taken at the serve (not again at impression or click, per code comments). Impression and click added no spend. Budget left 1.00 - 0.5680 = 0.432, shown as 0.43. The 0.0100 "today" spend before the pass (5 serves) is explained by the owner's other tests today (Owner-stated). No billing was triggered.

## 4. Publisher earnings and ledger

Only after-readings exist (no before-reading), so before/after is **not possible**.

| Item | Value (Seen) |
| --- | --- |
| Publisher impressions | 13 |
| Publisher clicks | 10 (CTR 76.92%) |
| Notice on page | "New earnings are not being recorded right now. The figures below are the records saved so far." |
| Total earned | 0.0000 USD |
| Adjustments | 5.0000 USD |
| Reversals | 0.0000 USD |
| Ledger balance | 5.0000 USD |
| Available to request | 3.0000 USD |

- Attribution (Derived): publisher impressions 13 and clicks 10 equal the account totals (13 and 10), so all recorded events belong to the TEST publisher.
- Ledger consistency (Derived): 0.0000 + 5.0000 + 0.0000 = 5.0000, matches the balance shown.
- Earned 0.0000 USD against 0.5680 USD advertiser spend is **explained by the page notice (Seen): earnings recording is off.** Code-read (`day-13-4-ledger-service.sql`): ledger recording is off by default (`ledger_enabled = false`) and the publisher share (`publisher_share_bps`) has no default; earnings are written only when both are set. Owner read `public.ledger_settings` (TEST project, Seen, pasted result): `ledger_enabled = false`, `publisher_share_bps = null`. Both are unset, so no earnings are written. Nothing was changed.
- Therefore advertiser spend versus publisher earnings **cannot be reconciled yet**, by current configuration, not by a fault found.
- Available 3.0000 against balance 5.0000 means 2.0000 USD is in open payout requests or marked paid (Derived). Owner-stated: the 5.0000 USD adjustment was added through the SQL editor to test the payout flow, so it is manual test data, not earnings. The 2.0000 USD hold was created by the owner when the earnings and payout features were implemented (Owner-stated), not in this pass. No payout was requested in this pass.
- Duplicate and invalid event exclusion for earnings: not testable while recording is off. Earlier verification only, not re-tested.

## 5. Response latency

**Server side (admin pilot monitoring panel, Seen):** average 790 ms over 62 requests, slowest 2,413 ms. Window: last 7 UTC days, all recorded match requests (not only this pass). The panel states publisher timeouts are not visible. P95: not shown by the panel, **not available**.

Against the owner limits (average below 400 ms, slowest below 1200 ms): **both figures are above the limits** (790 vs 400, 2,413 vs 1200). The cause was not investigated (the mix of requests, cold starts and Preview environment are not separated in the panel). **Owner decision (2026-11-07): record as above limit, do not investigate in Step 2, and measure again before the 1 Dec 2026 pilot start.** Nothing was changed. 503 errors: 0. Timeouts: not visible.

**Client side (Termux `curl -w "%{time_total}"`, mobile data, Preview, one run each, includes network time):**

| Request | Time |
| --- | --- |
| Match 1 (tracking on) | 2269 ms |
| Match 2 | 1107 ms |
| Match 3 | 1335 ms |
| Match 4 | 927 ms |
| Match 5 | 1160 ms |
| Impression | 1457 ms |
| Click (302) | 875 ms |

Match, n = 5 (Derived): average 1360 ms (1132 ms without the first), slowest 2269 ms, fastest 927 ms. Failed or timed-out: 0 of 7. These client numbers are not comparable with the server-side limits.

## 6. No-fill and fallback

No new no-fill in this pass. Panel (7 days, Seen): 24 no-fills, all valid requests with no ad to show. Earlier record: 4 of 4 unmatched topics returned 200 no-fill (Phase 4 Step 2). Fallback delivery: NOT TESTED by decision (Revive OFF, unchanged).

## 7. Key handling (Seen 2:10:09 and 2:15:51, plus Owner-stated)

Owner-stated: all keys were used for testing only and revoked after testing.

- Pass key (card label "Seever", ends `0c5e`): Revoked, created and last used 7 Nov 2026. Revoke date 7 Nov 2026 (Owner-stated; the card shows the status, not the date).
- Key "Server" (ends `a8f9`): Revoked at 2:15:51 (was Active at 2:10:09), never used.
- Key "Production server" (ends `ad2f`): Revoked, last used 7 Nov 2026. Owner-stated: used for testing only.
- A second key labelled "Production server" (ends `cc54`) is only partly visible; its status is **PENDING** (owner said it will be revoked).

## 8. Remaining discrepancies and notes

1. Server-side latency is above both owner limits (section 5); accepted as recorded by the owner.
2. Request accounting against 30 rests on the owner's estimate of up to 10 other requests (section 1).
3. Earned 0.0000 USD: explained, recording is off (`ledger_enabled = false`, `publisher_share_bps` null).
4. 5.0000 USD adjustment is manual test data (Owner-stated); 2.0000 USD hold not individually confirmed.
5. "Serves" card shows 296 (window not visible) against 13 impressions. The owner limit is serves versus impressions within plus or minus 5%. Most test serves had no impression sent, so this figure is not meaningful for test traffic, but it is far outside 5% and is recorded as is.
6. Time zone and 12/24-hour format of the phone clock are not stated. The Termux `date` output was not taken (optional now).

## 9. Owner confirmations still required

1. CI results for `CI` and `DB integration` (owner will supply).
2. Status of the key ending `cc54` after revoke. No screenshot is available yet.
3. Re-measure server-side latency before the 1 Dec 2026 pilot start (owner decision).
4. Everything from Step 1 still open: failed-window definition, final sign-off, Vercel Sensitive check, exposure search, Revive and `SUPABASE_SERVICE_ROLE_KEY`, Gates A to D.

## 10. CI checks awaited from the owner

Workflow `CI` (`ci.yml`): type check, `npm test`, ESLint, production build. Workflow `DB integration` (`integration.yml`, TEST database only). Results not supplied. Not run by Claude and not requested in Termux.

## 11. Ready for final review?

**Evidence is ready for the owner's review. Not ready for sign-off.** Evidence collection is complete as far as the current configuration allows, and no further Termux tests are needed. Open: CI results, key `cc54` status, latency re-measurement before 1 Dec 2026, and the Step 1 open items. Publisher earnings per serve cannot be shown while ledger recording is off; turning it on is outside this step.

## 12. Files modified

- `PHASE5-STEP2-PILOT-EVIDENCE-REPORT.md`: new. No other file changed. No code, SQL, config, environment value or workflow touched.

Phase 5 Step 3 is not started.
