# Phase 5 Step 3: Financial Operations and Ledger Readiness Report

Date: 2026-11-07. Source of truth: uploaded `blisscco-ad-network.zip`, `PHASE5-STEP1-PENDING-ITEMS-REPORT.md`, `PHASE5-STEP2-PILOT-EVIDENCE-REPORT.md`, Phase 2 to 4 reports, and the SQL in `supabase/sql/`.

Scope: code and schema review plus existing evidence. **Nothing was run, no request was sent, no SQL executed, no database or setting changed, no billing, no payout.** Production untouched. Revive OFF. Existing reports are not edited; this is the only new file.

Evidence labels: **Code-read** (Claude read the file, nothing run), **Seen** (owner screenshot or output in this project), **Owner-stated** (word only), **Earlier** (earlier report, not repeated), **PENDING OWNER CONFIRMATION**, **DECISION NEEDED** (a business decision, not a defect).

## Final report summary

1. **Advertiser budget and spending:** billing is per serve today (0.002 USD per serve at CPM 2.00); total and daily budget are checked under a campaign lock before spend; daily cap stop verified earlier; total-budget exhaustion not run on Preview. Owner decided to move to valid-impression (CPM) and valid-click (CPC) billing with a per-campaign rate; **not implemented**.
2. **Publisher earnings and ledger:** ledger structure is sound (append-only, USD, idempotent per serve). Recording is off (`ledger_enabled = false`, share null), so no earned amount per serve has been observed. Owner ran the read-only consistency check: **7 of 7 rows PASS** (section 6a).
3. **Revenue share:** owner decided 90% publisher, 10% platform (not set; setting it now would be premature). Rounding decision conflicts with 4-decimal per-event amounts; assumption in 7b item 3.
4. **USD readiness:** USD-compatible as implemented, no required change. Advertiser payment is outside the system; owner will handle it manually in Phase 7.
5. **Payout operations:** request, approve, reject and manual mark-paid exist with an append-only audit trail (verified PASS on the owner's test data). Missing, decided by the owner but not built: minimum 20 USD, once per month, mandatory external payment reference, 500 USD cap, admin-configurable settings, payouts-disabled switch.
6. **Discrepancies and unresolved issues:** section 6.
7. **Previously completed tests intentionally skipped:** section 8.
8. **CI checks awaiting owner results:** none. Owner-stated success for `CI` and `DB integration` (Step 2). No code changed here. `DB integration` does not cover ledger or payouts.
9. **Files modified and database changes:** one new file, this report. No database change by Claude. The owner ran one SELECT-only script; nothing was modified.
10. **Manual decisions and confirmations required:** section 11.
11. **Overall readiness:** section 12. Advertiser spending ready for the controlled TEST pilot; publisher earnings, revenue share, payouts, refunds and the decided limits are **not ready** until implemented in a new step.

## 1. Advertiser budget and spending

Actual billing model (Code-read, latest `record_ad_serve` in `day-13-4-ledger-service.sql`; file order assumed, not run):

- **Billing happens per serve** (ad handed to the chatbot), not per impression and not per click. Unit price = `round(cpm_usd / 1000, 4)`, minimum 0.0001 USD. `cpm_usd` is a single platform setting (default 2.0000, `numeric(8,4)`), giving 0.002 USD per serve. This matches Seen data (Step 2: 279 serves = 0.5580, 284 serves = 0.5680).
- Impressions and clicks add **no** spend (Earlier: Phase 2 Step 3 tests; Seen in Step 2: +1 impression and +1 click, spend unchanged).
- Budget allocation: `campaigns.total_budget numeric(12,2)` above zero and at most 10,000,000; `daily_budget` optional and at most total. Lowering the total below spend so far is blocked by a trigger.
- Spend and remaining budget: `campaign_spend_daily.spent numeric(12,4)`, one row per campaign per UTC day. Remaining = total minus the sum of daily spend. Seen: 1.00 - 0.5680 = 0.432, shown as 0.43.
- Exhaustion and over-spend prevention: the serve locks the campaign row, then rejects if `spent_total + unit > total_budget` or `spent_today + unit > daily_budget`, before any spend is written. Earlier: daily cap stopped delivery exactly at 0.5000 (250 serves x 0.0020) on a TEST campaign (Phase 3 Step 3, user-reported and dashboard seen).
- **Total-budget exhaustion on Preview: NOT RUN.** The 1.00 campaign would need about 216 more serves, above the pilot request limit. Covered only by Code-read and earlier mocked/SQL tests. Not repeated.
- Duplicate billing: the ledger refuses a second charge for the same serve reference (unique per serve reference and type, plus idempotency key). Observation, not a defect: two separate API requests are two serves and are charged twice; there is no request-level idempotency key.
- Invalid events: invalid or duplicate impression and click add nothing (Earlier, Phase 2 Step 3 and Step 1 results).

## 2. Publisher earnings and ledger

- Ledger `financial_ledger` (`numeric(14,4)`, USD only, append-only: update, delete and truncate blocked by triggers). Entry types: `advertiser_charge`, `publisher_earning`, `platform_revenue`, `adjustment`, `reversal`. Each serve entry carries the serve reference, campaign and publisher; manual entries need an admin id and a reason (3 to 500 characters). Reversal must exactly negate the original and can only happen once. Code-read.
- Publisher ownership: the publisher id comes from the API key at the serve, never from the client. Publisher pages read through functions that use the logged-in user (Code-read).
- **Earnings are per serve, not per impression** (differs from the "impression-based" wording in the Step 2 prompt). Clicks earn nothing.
- **Current state (Seen, Step 2):** `ledger_enabled = false`, `publisher_share_bps = null`; page notice "New earnings are not being recorded right now"; total earned 0.0000, adjustments 5.0000, balance 5.0000. The 5.0000 adjustment is owner-made test data (Owner-stated). Ledger arithmetic consistent (0 + 5 + 0 = 5).
- **Duplicate and invalid event exclusion for earnings, and an earned amount per serve, have never been observed on Preview** because recording is off. Earlier user-confirmed Preview checks (earnings summary, ledger history, payout page) are preserved and not repeated.
- Earnings history and references: the publisher page lists recent entries; the reference is the serve reference (opaque `bsr_` value) and the entry id. Code-read.

## 3. Revenue share and reconciliation

- Share is `ledger_settings.publisher_share_bps` (0 to 10000). **It is null: no percentage exists anywhere in the project.** With null, only `advertiser_charge` would be written.
- If set (Code-read): publisher earning = `trunc(charge x bps / 10000, 4)`; platform revenue = charge minus publisher earning, so the three always add up exactly. Truncation always favors the platform, and a tiny charge can give the publisher 0 (for example 0.0001 at 50%: publisher 0, platform 0.0001). A setting change affects only later serves.
- Settings changes (`ledger_enabled`, `publisher_share_bps`, `cpm_usd`) are recorded in a history table (Code-read, `day-13-12`).
- Advertiser billing amount: unit price above. Blisscco revenue: platform entry, only when a share is set. Publisher payable: ledger balance less open and paid payouts.
- Reconciliation: the repository's read-only check `day-13-16-financial-consistency-verify.sql` tests, per serve, earning + platform = charge, no orphan entries, one campaign per serve, balance covers payouts, payout audit trail, one open request per publisher. **It states it was never run on a database.** It does not compare ledger charges to `campaign_spend_daily`; the file itself notes the ledger was off and nothing was back-filled.
- Refunds, invalid-traffic clawback: **not implemented**, except admin adjustment and reversal functions (`ledger_add_adjustment`, `ledger_reverse_entry`). No admin page calling them was found (Code-read; library wrapper only).

## 4. USD readiness

Code-read result: **USD-compatible as implemented; no required change found.**

- USD is enforced by CHECK constraints on campaigns, the ledger and payout requests. Amounts are `numeric`, never float. Precision: budgets 2 decimals, spend 4, ledger 4 (`numeric(14,4)`), unit price 4. Budget input is parsed in integer cents; earnings are displayed with BigInt. Currency-mismatch rows are dropped by the earnings and payout readers.
- Minor, display only: a few places format JavaScript numbers with `toFixed` (admin campaign list budget, advertiser spend message). No money calculation uses them.
- `cpm_usd` and `ledger_settings` have no currency column (implicitly USD). Fine while USD only. Another currency would need schema, ledger and display changes (out of scope).
- Not present: any record of advertiser payment (top-up, invoice, collected money). The budget is a spending cap, not a prepaid balance; `advertiser_charge` is a charge record, not a payment. Gateway work is out of scope.

## 5. Publisher payout operations

Code-read, `day-13-9-payout-requests.sql`:

- Status flow: requested, approved, paid (or rejected). Only an admin can approve, reject (reason required) or mark paid. **Marking paid is a manual record only: no transfer, no provider call, no ledger entry.**
- Balance separation: ledger balance (earned + adjustments + reversals) is separate from reserved (requested and approved) and paid; available = balance - reserved - paid, never below zero. Seen (Step 2): balance 5.0000, available 3.0000, so 2.0000 reserved or paid (created at the payout feature test, Owner-stated).
- Duplicate prevention: one open request per publisher (partial unique index); the request key makes retries safe; amount above available is refused.
- History and references: request id, request key, requester, reviewer, payer, timestamps, and an append-only status audit table. **No field for an external payment reference** (for example a bank transfer id). Bank details are deliberately not stored.
- **Maximum payout: not enforced.** The owner decision "500 USD per payout request" (Step 1) has no check in the database or app code. Only "not above available balance" applies. No minimum payout either.
- No payout was executed or requested in this step.

## 6. Financial discrepancies and unresolved issues

1. **Ledger off, no back-fill:** campaign spend exists (0.5680 for the travel campaign) but there are no `advertiser_charge` rows. If the ledger is switched on later, earlier serves stay outside it permanently. Owner decided "ledger ON", but with today's code that would write per-serve charges; see 7b item 1 (keep OFF until the billing change).
2. **Owner limits not enforced in code:** 1000 USD per pilot campaign, 2000 USD across campaigns, 500 USD per payout. Code allows a campaign up to 10,000,000 and no aggregate or payout cap. Policy only, through the named approver.
3. **DB integration CI does not cover ledger or payouts** (the read-only consistency check in section 6a did run and passed): its files (`tests/integration`) cover analytics, tracking, click-ref, budget and RPC security. The Owner-stated success therefore says nothing about the ledger and payout SQL tests. Those are separate rollback-only SQL scripts for the TEST project. Their last TEST database result is not in the reports (Phase 2 Step 4: PENDING; "earlier user-reported rechecks preserved"). **PENDING OWNER CONFIRMATION:** whether and when they were run.
4. Earned per serve, duplicate and invalid earning exclusion: not observable on Preview while recording is off (section 2).
5. Total-budget exhaustion not run on Preview (section 1).
6. Step 2 items still open and unchanged: key ending `cc54` status, latency above limits (re-measure before 1 Dec 2026), 30-request accounting (owner estimate).

## 6a. Read-only consistency check result (Seen)

The owner ran `day-13-16-financial-consistency-verify.sql` (SELECT only) in the Supabase SQL editor; screenshot at phone clock 6:18:55 (date not visible). **7 rows, all PASS:**

| Check | Result |
| --- | --- |
| 1. per serve, earning + platform = charge | PASS |
| 2. no earning or platform entry without a charge | PASS |
| 3. one serve = one campaign (and one publisher) | PASS |
| 4. every publisher: ledger balance covers requested + approved + paid payouts | PASS |
| 5a. every paid request has paid_by, paid_at and a paid audit event | PASS |
| 5b. every request has a first audit event and its latest event equals its status | PASS |
| 6. no publisher has more than one open payout request | PASS |

How to read it: checks 1 to 3 are about serve entries in the ledger. Recording is off (Seen in Step 2), so there are most likely no serve entries and these three pass with nothing to compare (Derived, not seen directly). They prove nothing about serve-level splits. Check 4 is consistent with Step 2 data (balance 5.0000, held for payouts 2.0000). Checks 4 to 6 and 5a, 5b have real data to check: the owner's payout test requests pass, so the payout audit trail and one-open-request rule are verified on TEST data. The optional ledger-versus-spend comparison at the end of the script is commented out and was not run, so ledger charges against `campaign_spend_daily` remain unreconciled (the ledger holds no charges).

Environment note: the screenshot shows project "Denim Hub Bsl" with a "main" branch tagged PRODUCTION. The SQL file comments name "denim" as the TEST project, and the PRODUCTION tag is Supabase's own label for the main branch of any project. The script is read-only, so nothing could change. **PENDING OWNER CONFIRMATION:** that this project is the TEST project.

## 7. Business decisions (Owner-stated, 2026-11-07, recorded as given, none implemented)

| # | Decision |
| --- | --- |
| 1 | Publisher share: 90% of the advertiser-set CPC or CPM amount (platform 10%). |
| 2 | Bill on valid impressions and valid clicks, not per serve. CPM: per 1,000 valid impressions. CPC: per 1 valid click. Initial CPM 2.00 USD approved as a configurable starting rate, not a fixed global rate. Invalid impressions and clicks are never billed. |
| 3 | Ledger ON from now, but financial entries only for valid billing events. |
| 4 | Enforce in server code and database, configurable by admin, reject transactions over the limit: campaign budget 1,000 USD; total advertiser budget 2,000 USD; single publisher payout 500 USD. Actual payouts stay disabled during the controlled pilot. |
| 5 | Minimum payout 20 USD; monthly, once per month; external payment reference mandatory for completed payouts; minimum and schedule admin-configurable; actual payouts disabled during the pilot. |
| 6 | Invalid traffic not billed; admin-approved refunds only; admin adjustments and reversals; an admin screen to review, approve and track refunds, invalid-traffic adjustments and reversals; full audit trail; never delete or silently change ledger entries; actual refunds and payouts disabled during the pilot unless explicitly approved. |
| 7 | Advertiser USD payment: done in Phase 7, manually (Claude's reading of the owner's message). |
| 8 | Rounding: standard round half up to 2 decimals for publisher and platform shares; totals reconcile exactly; do not systematically favor the platform. |

## 7a. What these decisions require (Code-read impact; NOT implemented, outside Step 3)

Each item below is a code or schema change. Step 3 forbids rebuilding financial features and adding tables, so none was started. Needs the owner's explicit go-ahead as a new step.

1. **Billing moves from serve time to impression and click time.** Today spend, ledger and budget check all happen in `record_ad_serve`. Impression and click functions currently write no spend. Needed: a billing amount per event, written once per valid event (the existing duplicate and invalid-token handling can decide "valid").
2. **Per-campaign pricing model and rate** (CPM or CPC, and the rate) does not exist; today there is one global `cpm_usd`. Needs new campaign fields (schema change) and advertiser form changes.
3. **Ledger source types** allow only `serve` and `manual`, with a unique entry per serve reference and type. Event billing needs new source types and a uniqueness rule per event. CHECK constraint change.
4. **Budget enforcement timing:** the budget is now checked before the ad is served. If charging moves to the impression, a decision is needed on how to stop serves from overshooting the budget before their impressions arrive (for example a check at serve plus charge at event). Daily cap behaviour changes with it.
5. **Limits (1,000 / 2,000 / 500 USD):** need admin-editable settings (new table or columns), checks in server code and in database triggers, and rejection messages. Existing campaigns above limits would need review (Phase 3 Step 3 campaign A was 198.00, within the limit).
6. **Payout rules:** a "payouts disabled" switch (none exists; payout requests work now on TEST), minimum 20 USD, once per month, mandatory external reference column on the payout request, admin-editable settings.
7. **Refund workflow and admin screen:** none exists. Adjustment and reversal functions exist but no admin page calls them. Refund approval needs a record of request, approver, reason and status (likely a new table), plus a refunds-disabled switch.
8. **Rounding:** see 7b item 3. The current code truncates to 4 decimals and gives the remainder to the platform.
9. **Share setting:** `publisher_share_bps = 9000` is only a settings value (no schema change), but it must not be set before item 1 to 3 are done.

## 7b. Conflicts and assumptions to confirm (nothing decided by Claude)

1. **Do not switch the ledger ON yet.** With today's code, ON writes a charge per serve, which contradicts decisions 2 and 3. Switch it on only with the billing change. Records from now until then stay outside the ledger.
2. **"Total advertiser budget 2,000 USD":** Step 1 said "all pilot campaigns together". Assumed: the sum of all campaigns of one advertiser. If you meant all advertisers together, say so.
3. **Rounding:** at 2 decimals a per-impression charge (2.00 CPM = 0.002 USD) would round to 0.00, so per-event rounding at 2 decimals cannot work. Assumed: events are stored at 4 decimals (exact), and half-up 2-decimal rounding is applied to the monthly total per publisher, with platform = total minus publisher so it reconciles exactly.
4. **Monthly payout against the 500 USD cap:** one payout per month with a 500 USD maximum means a balance of 1,200 USD takes three months to pay out. Assumed: intended during the pilot.
5. **"Valid impression"** is taken as what the existing tracking already accepts (valid token, not a duplicate). No new rule was invented.
6. Decision 7 is read as: manual advertiser payment handled in Phase 7. Correct this if the message meant something else.

## 8. Previously completed tests intentionally skipped

Earlier and not repeated: Phase 2 Step 4 Preview checks (earnings summary, ledger history, payout page, insufficient balance rejected, valid payout request status; user-confirmed); Phase 3 Step 3 daily cap stop and 0.0020 per serve; Phase 2 Step 3 spend-unchanged tests; Step 2 serve, impression, click and spend reconciliation; all mocked tests covered by CI.

## 9. CI

Owner-stated in Step 2: `CI` and `DB integration` both passed. No code or configuration changed in this step, so no new CI result is awaited. `DB integration` does not run the financial SQL tests (section 6, item 3).

## 10. Files modified and database changes

- New file: `PHASE5-STEP3-FINANCIAL-OPERATIONS-REPORT.md`. No other file changed.
- Database changes: none. No table, setting, balance or policy touched.

## 11. Confirmations and decisions required from the owner

1. Section 7b items 1 to 6: assumptions stand unless corrected (no reply received yet).
2. Explicit go-ahead to implement section 7a as a new step (not part of Step 3).
3. When the Day 13 financial SQL tests (rollback-only) were last run on the TEST project (no answer yet).
4. Confirm that the project in the consistency-check screenshot is the TEST project (section 6a).
5. Do not switch the ledger on, and do not set the 90% share, until the billing change is built.
6. Still open from Step 2: key ending `cc54` status, latency re-measurement before 1 Dec 2026, and the Step 1 open items.

## 12. Overall financial operations readiness

**Advertiser spending: ready for the controlled TEST pilot** (budget and daily cap work; total exhaustion not run on Preview). **Publisher earnings, revenue share and payout: not ready for real use**: the owner has now decided the model (section 7), but none of it is implemented (section 7a); ledger must stay off until then; limits unenforced; no payout reference field. No real billing or payout should happen until the decisions above are made.

Phase 5 Step 4 is not started.
