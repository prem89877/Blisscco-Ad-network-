# Phase 5 Step 7: Final Controlled Pilot Go / No-Go Report

Date: 2026-11-10 (21 days before the planned 1 December 2026 pilot start). Scope: evidence consolidation and documentation only. No product feature, SQL, migration, workflow, configuration or historical report was changed in this step. This file is the only new document (plus `README-CHANGED-FILES.txt`).

Code source of truth: the uploaded `blisscco-ad-network.zip` **plus the Phase 5 Step 6 changes delivered in this conversation** (restored `app/api/payments/webhook/route.ts`, `lib/payments/razorpay.ts`, tests, documents). The owner has not uploaded a newer ZIP since. If the owner's repository differs, the owner must say so; this report does not cover differences it cannot see.

Evidence labels (same as earlier steps): **Seen** (owner screenshot or pasted output), **Owner-stated** (word only), **Code-read** (Claude read the code or ran a text scan, nothing run against any service), **Scratch-run** (isolated run outside the project, not CI), **Web-checked** (provider documentation, not a contract), **PENDING OWNER CONFIRMATION**, **NOT VERIFIED**.

Safety statement: Production Supabase and Production Vercel untouched. No SQL executed on any database. No deployment, no environment variable changed. Razorpay live mode not activated (the code refuses live keys). No Payoneer payout. Revive fallback untouched (OFF). Ledger recording and financial settings untouched (OFF). No owner-only check was marked complete. No test result, approval, publisher confirmation or advertiser confirmation was invented. `npm test`, ESLint, the build and both workflows were not run by Claude (they are the owner's CI).

---

## 1. Executive summary

**Recommendation, with the permissions kept apart:**

| Question | Recommendation | Why, in one line |
| --- | --- | --- |
| A. May the owner start outreach and preparation (talk to publishers and advertisers, share the guide, collect written confirmations)? | **CONDITIONAL GO** | Needs no Production, no key, no money. Conditions: use only documents that exist, promise nothing about payment or earnings, issue no key |
| B. May real publisher keys be issued? | **NO-GO today** | Gates A to D are NOT CONFIRMED, exposure and Sensitive-flag checks are open, no Production backup, emergency stop not on Production |
| C. May real advertiser campaigns be activated? | **NO-GO today** | The 1,000 and 2,000 USD limits are policy only (database allows up to 10,000,000), no spend alerts, billing model and revenue share not built |
| D. May real payments be accepted (Razorpay)? | **NO-GO** | Razorpay approval, test keys, checkout and sandbox evidence are all missing; payments must stay off. Advertiser funding is manual |
| E. May live traffic be served? | **NO-GO today** | Same blockers as B and C, plus latency above the owner limits (790 ms average against 400 ms) |
| F. Can the 1 December pilot still proceed? | **CONDITIONAL GO is reachable, NO-GO as of today** | 21 days remain. If the gating items in section 9 are closed with evidence, the pilot can start on a supervised, minimum-scale basis |

Nothing in this report authorises a real transaction, a Production deployment or a pilot start. The sign-off by Prem Talekar is still CONDITIONAL and approves none of them.

What changed since Step 6: Cashfree refused the account (Cashfree BLOCKED); **Razorpay supersedes Cashfree** as the selected advertiser payment provider (adapter written, TEST mode only, no approval); **Payoneer stays manual** (no API, eligibility unconfirmed, the owner was shown an IEC prompt). Neither changes the pilot decision, because the owner decided earlier that advertiser payment is handled manually and actual payouts stay disabled during the pilot.

## 2. Reconciliation of earlier reports (later dated update wins)

| Topic | Older statement | Latest statement used here |
| --- | --- | --- |
| Payment provider | Step 5: "provider not selected", then Cashfree (2026-11-09) | Cashfree BLOCKED (refusal, 2026-11-09). **Razorpay selected**, TEST mode only, approval PENDING (Readiness Report section 13) |
| Publisher payouts | Step 5: Payoneer manual | Unchanged: manual, no API, eligibility, limits, IEC and purpose code PENDING OWNER CONFIRMATION |
| Production readiness | Step 4 summary lines about stop-all missing | Stop-all built; confirmed on Preview (Owner-stated with screenshots, 2026-11-08); not on Production |
| Webhook route | Step 5 lists it as created | Missing from the uploaded ZIP; restored in Step 6; owner must compare with the repository copy |
| Stability rule | Step 1: "3 consecutive failed windows (42 days)" and "3 successful windows for stability" | Both are in the owner's decisions; the definition of a **failed window** is still not written |
| Total budget limit | Step 1: 2,000 USD for **all pilot campaigns together**; Step 3 decision 4: 2,000 USD **total advertiser budget** | Recorded unchanged; scope (per advertiser or across all pilot campaigns) needs one written sentence from the owner (D-S7-1) |
| Latency | Step 2: re-measure before 1 Dec | Still open; no new measurement exists |
| Production backup | Step 4 Seen: Free plan, none | Unchanged. Nothing has been restored from any backup |
| `CI` and `DB integration` | Owner-stated success (Step 2) | Still Owner-stated. **No CI result exists for the Step 6 changes** |

## 3. Completed and verified requirements

Only items with Seen evidence (or an earlier verified result that Phase 5 reports carried forward). None was repeated in this step.

| # | Requirement | Evidence |
| --- | --- | --- |
| C1 | Controlled TEST serves: 5 requests, HTTP 200, no 429, 503 or timeout; admin panel 62 requests, 30 fills, 24 no-fills, 0 x 503, 8 caller errors | Seen (Step 2) |
| C2 | Click and impression attribution on the TEST campaign: counters +1 and +1, publisher totals equal account totals | Seen (Step 2); owner confirmation of attribution still listed there |
| C3 | Advertiser spend equals serves times 0.002 USD (exact) | Seen, Derived (Step 2) |
| C4 | Ledger consistency check, 7 of 7 PASS (checks 1 to 3 had nothing to compare because recording is off) | Seen (Step 3, TEST project) |
| C5 | Payout request, approve, reject, mark paid with audit trail on test data | Verified earlier (Step 3) |
| C6 | Emergency stop on Preview: panel, Stop with reason and audit row, `{"fill":false}` while stopped, normal ad after Resume | Seen screenshots and REST responses (Step 4, 2026-11-08), Owner-stated |
| C7 | Pilot monitoring panel works on Preview | Seen (Step 2) |
| C8 | Publisher authentication, 400/415/413, no-fill, impression, duplicate, invalid token, click redirect, key create/show-once/revoke, signup and approval, creative and rich delivery | Verified earlier, skipped |
| C9 | Production database has no backup | Seen (Step 4). This is a verified **gap**, not a pass |
| C10 | Vercel Firewall: Custom Rules 0, Bot Protection inactive | Seen (Step 4). A verified **gap**; project shown not confirmed |
| C11 | Code-level security review: RLS on 29 of 29 tables, 105 definer functions hardened, no secret in the repository, logs hold labels only | **Code-read** (Step 6), static; not a runtime verification |

## 4. Implemented but unverified requirements

"Implemented" means the code or SQL exists. It does not mean it worked in the real world.

| # | Item | What exists | What is missing |
| --- | --- | --- | --- |
| U1 | `phase5-step4-1` emergency stop on TEST database | Built; button confirmed on Preview | Footer checks 1 to 4, Stopped and Resumed audit rows, non-admin call answering 42501, CI result, not applied on Production |
| U2 | Payment tables, payout limits (min 20, max 500, once per month), settlement functions (`phase5-step5-1`) | Written | **Never run on any database.** Checks V1 to V10 not run |
| U3 | Razorpay adapter (TEST mode, `order.paid`, API re-read) | `lib/payments/razorpay.ts`, 13 tests | Scratch-run only; never run against Razorpay; no approval, no keys, no checkout (Step 5b) |
| U4 | Webhook route (fail closed) | Restored in Step 6 | Scratch-run only; not compared with the owner's copy; no CI result |
| U5 | Public env guard, key hashing, IP guards, budget lock | Built and unit-tested | Runtime exposure search not done (P1, P2) |
| U6 | Ledger and revenue share | Ledger built, OFF; `publisher_share_bps` unset | No earned amount per serve ever observed; billing change (valid impression CPM, valid click CPC) not built |
| U7 | Day 13-15 serialisation of ledger and payout writers | Written | Two-session race test: Day 14 says NOT RUN, no later result |
| U8 | Daily campaign budget stop | Verified earlier | Total-budget exhaustion not run on Preview |
| U9 | Rollback and emergency shutdown procedures | Written in `PRODUCTION-DEPLOYMENT-SAFETY-PLAN.md` | Never practised; levels 3 to 5 untested |
| U10 | Privacy and terms pages, contact email variable | Pages exist (earlier steps) | Content never reviewed by a lawyer or CA; the real contact email not evidenced |
| U11 | Step 5 UI and action files (settlement button and panel) | Written | Never passed CI type check or ESLint |

## 5. Pending owner confirmations (owner-only evidence)

| # | Confirmation | Evidence needed |
| --- | --- | --- |
| O1 | Vercel: each secret Sensitive, no `NEXT_PUBLIC_` secret name | Dated note, names only |
| O2 | Exposure search: `.next/static`, browser network tab, Vercel and GitHub logs | Dated result per place |
| O3 | Revive variables absent in Production and Preview, separately | Dated note per environment |
| O4 | `SUPABASE_SERVICE_ROLE_KEY` removed or explained | Dated note |
| O5 | TEST and Production Supabase project references written down (name confusion open) | Dated note, references only |
| O6 | Webhook route file compared with the repository copy | Dated note |
| O7 | CI green on the exact commit including Step 6 changes | Run link or screenshot |
| O8 | Latency re-measured before 1 Dec (limits 400 ms average, 1200 ms slowest) | Tool, environment, sample size, figures |
| O9 | Key ending `cc54` status; TEST key revoke-practice date | Screenshot, date |
| O10 | Definition of a failed observation window | One written sentence |
| O11 | Final sign-off by Prem Talekar, with name and date | Written approval |
| O12 | Vercel Firewall rule decision; which project the earlier screenshot showed | Screenshot after the change |
| O13 | Production schema inventory, `pg_cron` on Production | Read-only query results |
| O14 | Pilot environment decision: where do real publisher requests land (Production deployment or a controlled Preview)? | One written decision |
| O15 | Razorpay: written category approval; account identity; fate of `kissaan-saathi.vercel.app` when `blisscco.online` replaces it | Written reply from Razorpay, screenshot of the review result |
| O16 | Payoneer: sending enabled for India account, IEC requirement, payee limits; CA: purpose code (S1007 is a candidate, not confirmed), Form A2 or 15CA/15CB | Written replies |

## 6. Publisher-dependent requirements (no publisher has been contacted)

All stay **Pending: publisher contact not yet made**. Nothing is marked confirmed.

| Item | Existing implementation | Previous evidence | Status | Blocker | Evidence needed |
| --- | --- | --- | --- | --- | --- |
| Gate A: publisher handles 429 and 503 without breaking the chat | Responses and guide defined | Mocked tests only | Not verified | No publisher | Publisher's own run or written confirmation |
| Gate B: impression only after display, from the publisher's server; no link straight to `destination_url` | Tracking token, click redirect | Our side verified; publisher side none | Not verified | No publisher | Publisher code or written confirmation |
| Gate B: behaviour with `AD_TRACKING_SECRET` unset understood | Code fails safe | Code-read | Pending | A person must read the code and write the finding | Written finding, not run on Preview |
| Gate C: 503 told apart from 200 no-fill | Both implemented | 200 Seen; 503 mocked only | Partial | 503 cannot be caused on Preview | Mocked evidence is the ceiling; publisher statement |
| Gate D: guide 6 and 6a received; Sponsored label and plain text; disclosures owned by publisher | Guide page, onboarding document | None | Not verified | No publisher | Dated record, written confirmation without key or host |
| Real publisher key issuance | Key manager works; key shown once | TEST keys only | Not allowed | All Gates, plus O1 to O5 | Section 9 |
| Publisher earnings expectation | Ledger OFF, share unset | Step 3 | Not ready | Earnings are not recorded; payouts disabled in the pilot | Written pilot terms to the publisher (what is and is not paid) |

Outreach is allowed to collect these confirmations. It is not permission to issue a key.

## 7. Advertiser-dependent requirements (no advertiser has been contacted)

| Item | Existing implementation | Previous evidence | Status | Blocker | Evidence needed |
| --- | --- | --- | --- | --- | --- |
| Advertiser onboarding and creative submission | Signup, approval, creative upload with content checks, admin review | Verified earlier (Phase 4) | Verified for TEST | None for TEST | Repeat only on the chosen pilot environment |
| Campaign budget and daily cap | Total and daily budget under a campaign lock | Daily cap verified; total exhaustion not run | Partly verified | Total-budget exhaustion not run | One Preview run, owner-recorded |
| 1,000 USD per campaign, 2,000 USD total | **Not enforced** (database allows 10,000,000) | Step 3 | Unenforced | Policy only | Either approver rule in writing per campaign, or an enforced limit (new build, not in this step) |
| Advertiser funds the campaign | Manual outside the system (owner decision 7) | None | Not verified | No agreed invoice process; Razorpay not approved | Written invoice and receipt procedure; CA view on collecting USD from abroad |
| Billing model | Per serve today (0.002 USD) | Verified exact | Differs from the owner decision (valid impression CPM, valid click CPC) | Not built | Owner decides whether the pilot runs on per-serve billing |
| Advertiser terms and refunds | Terms page exists | None | Not verified | Refund rule (admin-approved only) not written for advertisers | Written pilot terms |

## 8. Payment and financial blockers

| Item | Existing implementation | Previous evidence | Current status | Remaining blocker | Evidence needed |
| --- | --- | --- | --- | --- | --- |
| Razorpay (advertiser payments) | TEST-mode adapter; webhook fails closed; live keys refused | Scratch-run 62 of 62 tests (not CI) | **Implemented, unverified, not approved** | Category approval, test keys, checkout (Step 5b), SQL run, sandbox evidence; Individual account identity; website replacement | Razorpay written approval; eight sandbox scenarios; SQL checks V1 to V10 |
| Cashfree | Sandbox code kept | Refusal email | **BLOCKED** | None to fix; do not reapply for the same business | None |
| Payoneer (publisher payouts) | Manual: admin records the Payoneer payment ID | None | Not verified | Eligibility, IEC prompt, limits, FEMA, purpose code | Written Payoneer and CA replies |
| USD consistency | Platform USD only | Code-read | Consistent in code | Razorpay settles in INR (T+7); no FX and fee rule | Written reconciliation rule |
| Duplicate transaction prevention | Unique keys and idempotent apply function | Unit tests with fakes | Written, unrun | SQL unrun | V1 to V10 |
| Ledger integrity | Append-only, consistency PASS | Seen | Verified on TEST data; recording OFF | No serve entries ever written | Owner-authorised switch-on test on TEST only (not done here) |
| Payout authorization | Admin-only, limits 20 / 500, monthly, off by default | Earlier payout flow verified | Written limits unrun | SQL unrun; old "Mark as paid" button | V1 to V10; remove old button later |
| Revenue share 90 / 10 | Decided; `publisher_share_bps` unset | Step 3 | **Unenforced** | Not set; rounding conflict noted in Step 3 | Owner-authorised setting on TEST first |

During the pilot, payments are off (no `PAYMENT_PROVIDER`, `payments_enabled` false) and payouts are disabled, as the owner already decided.

## 9. Security and operational blockers, and gating items for 1 December

**Gating items.** Items G1 to G12 must each have evidence recorded before real publisher keys are issued or campaigns activated. Dates are a suggested schedule, not an approval.

| ID | Item | Owner, evidence | Suggested by |
| --- | --- | --- | --- |
| G1 | CI green on the exact commit (incl. Step 6) | O7 | 14 Nov |
| G2 | Pilot environment decision (O14) and, if Production: schema inventory (O13), backup taken and test-restored (Free plan has none) | Backup decision, restore note | 17 Nov |
| G3 | Emergency stop: footer checks and 42501 on TEST, then applied where the pilot runs, `EMERGENCY_STOP_ENFORCED=1` there, practised once | U1 | 20 Nov |
| G4 | Owner-only security checks O1 to O6 | Dated notes | 20 Nov |
| G5 | Vercel Firewall rate-limit rules on ad routes (decision D2 in the Step 6 report) | O12 | 20 Nov |
| G6 | Latency re-measured within limits, or the owner accepts the figures in writing | O8 | 22 Nov |
| G7 | Spend control for the pilot: written approver rule per campaign (1,000 / 2,000 USD, scope sentence D-S7-1), budgets set at or under the caps by an admin, spend read by hand daily | Written rule | 22 Nov |
| G8 | Failed-window definition and final sign-off by Prem Talekar | O10, O11 | 25 Nov |
| G9 | Gates A to D confirmed by the pilot publisher (or the owner accepts the gap in writing) | Section 6 | 25 Nov |
| G10 | Pilot terms in writing for the publisher (earnings not recorded, payouts disabled) and the advertiser (manual funding, refunds admin-approved) | Documents | 25 Nov |
| G11 | `SUPABASE_SERVICE_ROLE_KEY` and Revive variables resolved (O3, O4) | Dated notes | 20 Nov |
| G12 | TEST key revocations and key `cc54` (O9) | Screenshot | 20 Nov |

**Security blockers (open):** no edge rate limiting; exposure search and Sensitive check not done; webhook file not compared; no Content-Security-Policy; no dependency scanning; Supabase Auth URL settings on the real domain not confirmed.

**Operational blockers (open):** no alerts (monitoring is read by hand); automatic spend and CTR protection, TEST flag and advertiser total limit decided but not built; no per-publisher error view; 503 catch-all unlogged; incident runbook and rollback never exercised; one named approver only; Vercel plan and log retention unknown.

## 10. Task 2 assessment: the nine areas

Each row: existing implementation, previous evidence, current verification status, remaining blocker, exact evidence needed.

### 10.1 Publisher onboarding and API safety

| | |
| --- | --- |
| Existing implementation | Signup and admin approval; keys stored as hash, shown once; 401 without detail; IP guard (20 wrong keys per minute per instance); 400/413/415 limits; no-fill on sensitive topics; guide, quick start and onboarding document; Node and Next.js examples |
| Previous evidence | Authentication, key lifecycle, error cases, no-fill, impression, click verified earlier (Owner-stated and Seen, skipped here) |
| Current status | Our side verified on TEST. Publisher side **not verified**: no publisher contacted. Code-read security pass in Step 6 found no new issue |
| Remaining blocker | Gates A to D; no edge rate limit; exposure and Sensitive checks; unconfirmed webhook file does not affect this area |
| Evidence needed | Section 6 confirmations; O1 to O3, O9, O12 |

### 10.2 Advertiser onboarding and campaign readiness

| | |
| --- | --- |
| Existing implementation | Advertiser signup, campaign creation, creative upload with magic-byte and dimension checks, private bucket, admin review before serving, pause and resume |
| Previous evidence | Creative workflow and rich delivery verified earlier (Phase 4); campaign flow verified on TEST |
| Current status | Verified on TEST; **no real advertiser** contacted; Production state of creative migrations not seen |
| Remaining blocker | Pilot environment not chosen; Production inventory; advertiser terms |
| Evidence needed | O13, O14; written advertiser terms (G10) |

### 10.3 Campaign budgets and advertiser spending limits

| | |
| --- | --- |
| Existing implementation | Total and daily budget checked under a campaign lock before spend; database maximum 10,000,000; no aggregate limit |
| Previous evidence | Daily cap verified; total exhaustion not run; spend exact at 0.002 per serve |
| Current status | Budget stop verified in part. 1,000 USD per campaign and 2,000 USD total are **unenforced** (policy through the approver). 50 USD per campaign per day and 100 USD per advertiser per day: decided, **not built** |
| Remaining blocker | No enforced cap, no spend alert, no automatic pause |
| Evidence needed | G7 written rule and daily manual spend reading, or a new build later with TEST evidence |

### 10.4 Ledger, revenue share and publisher payout readiness

| | |
| --- | --- |
| Existing implementation | Append-only ledger, OFF; share unset; payout request, approval, manual paid; Step 5 limits and settlements written |
| Previous evidence | Consistency 7 of 7 PASS; payout audit trail verified on test data |
| Current status | Ledger writes never observed for a serve. Revenue share 90 / 10 and rounding **not set**. Step 5 SQL **unrun**. Payouts disabled by owner decision |
| Remaining blocker | Billing change not built; SQL unrun; race test status unknown |
| Evidence needed | Owner-authorised TEST run later; V1 to V10; two-session race result; pilot terms stating no earnings are paid in the pilot |

### 10.5 Razorpay and Payoneer readiness

| | |
| --- | --- |
| Existing implementation | Razorpay TEST adapter and restored webhook route; Payoneer manual reference form |
| Previous evidence | Scratch-run tests only; Razorpay dashboard screenshots (International Cards enabled, 50,000 INR limit, T+7, edit request under review); Payoneer IEC screen |
| Current status | Razorpay **not approved, no keys, no checkout, no sandbox evidence**. Payoneer **eligibility unknown** |
| Remaining blocker | Section 8 |
| Evidence needed | O15, O16. For the pilot itself: none, because funding and payouts are manual or disabled |

### 10.6 Emergency stop and incident response

| | |
| --- | --- |
| Existing implementation | Stop-all with audit log; campaign pause; suspensions; key revoke; S1 to S3 severity policy; incident runbook; shutdown ladder in the deployment plan |
| Previous evidence | Stop-all confirmed on Preview (Owner-stated with screenshots) |
| Current status | Not applied on Production; footer checks pending; runbook and ladder never exercised; incident notification channel not defined (dashboard notice assumed) |
| Remaining blocker | G3; second trained person; Vercel plan limits |
| Evidence needed | Dated practice of levels 1 and 2 on the pilot environment; named second person |

### 10.7 Monitoring, latency and traffic safety

| | |
| --- | --- |
| Existing implementation | Admin pilot monitoring panel (7-day totals); consistency notes; the owner's thresholds recorded |
| Previous evidence | Panel Seen; latency 790 ms average, 2,413 ms slowest (over limits) |
| Current status | Manual monitoring only; no hourly view, no alerts, no P95; no spend or traffic spike detection |
| Remaining blocker | G6; the 30-minute and 10-per-hour 503 rules cannot be read from the panel |
| Evidence needed | New latency measurement; a written daily manual reading routine with a named person |

### 10.8 Privacy, disclosures and secret exposure

| | |
| --- | --- |
| Existing implementation | Privacy and terms pages; Sponsored-label guidance for publishers; logs without secrets; build guard; no analytics of conversation text (metrics hold outcome and duration only) |
| Previous evidence | Code-read only; Gate D not confirmed; exposure search partly Code-read |
| Current status | Content never reviewed by a lawyer or CA (this report is not legal advice); contact email and real domain not evidenced |
| Remaining blocker | O1 to O4; Gate D; legal and CA review |
| Evidence needed | Dated exposure-search results; written Gate D confirmation; reviewer's written comments |

### 10.9 TEST/Preview and Production separation

| | |
| --- | --- |
| Existing implementation | Three variables per environment; DB integration workflow guards the TEST reference; Revive and payment variables default off |
| Previous evidence | Owner-stated 2026-11-06 (Preview TEST, Production Production); screenshots show two Supabase projects |
| Current status | Name confusion ("Denim Hub Bsl" versus "Blisscco-Ad-network", both main branches tagged PRODUCTION) unresolved; Production schema state unknown; Production untouched by Claude |
| Remaining blocker | O3, O5, O13 |
| Evidence needed | Project references written by the owner; read-only inventory |

## 11. Production deployment restrictions (all remain in force)

1. No Production deployment, no Production SQL, no Production environment change without the owner's explicit written approval after section 9.
2. Payments stay off in the first release: no `PAYMENT_PROVIDER`, `payments_enabled` false. Razorpay live mode and live keys are never used; the code refuses them.
3. Payouts disabled (`payouts_enabled` false, no Payoneer payout) throughout the pilot unless the owner explicitly approves one payout in writing.
4. Revive fallback OFF in every environment.
5. Ledger recording and revenue-share settings stay OFF and unset until the owner explicitly authorises a TEST-first switch-on.
6. `phase5-step5-1` (payments SQL) is not part of the first Production release.
7. TEST-only SQL files never run on Production.
8. `EMERGENCY_STOP_ENFORCED=1` only after `phase5-step4-1` is applied where the pilot runs and verified.
9. Resume after any stop only with Prem Talekar's written approval.

## 12. Task 4: final authorization matrix

Owner limits are quoted unchanged. "Implemented" = code or SQL exists. "Verified" = real-world evidence exists. "Enforced" = the system refuses a breach on the pilot environment today.

| Control | Owner-approved value | Implemented | Verified | Enforced today | Status and evidence needed |
| --- | --- | --- | --- | --- | --- |
| Campaign budget cap | 1,000 USD per campaign | No (database cap is 10,000,000) | No | **No** | Unenforced; policy through the approver. Existing TEST campaigns (198.00 and 1.00 total) are inside it. Need: G7 written rule |
| Total advertiser campaign budget | 2,000 USD total | No aggregate check | No | **No** | Unenforced; scope wording needs one sentence (D-S7-1) |
| Daily protective limits | 50 per campaign, 100 per advertiser per day | No (decided only) | No | **No** | Not built; campaign daily budget is the only automatic stop |
| Publisher payout request cap | 500 USD | Written in `phase5-step5-1` | No (SQL unrun) | **No** (not applied anywhere) | Needs V1 to V10 on TEST. Payouts are disabled in the pilot anyway |
| Payout minimum and frequency | 20 USD, once per month | Written | No | **No** | Same as above |
| Publisher revenue share | 90% | Setting exists, unset | No | **No** | Owner-authorised setting on TEST first; rounding rule (half up, 2 decimals) conflicts with 4-decimal per-event amounts (Step 3, 7b item 3) |
| Blisscco share | 10% | Same | No | **No** | Same |
| Pilot start | 1 December 2026 | Schedule only | n/a | n/a | Conditional; section 9 |
| Approval authority | Prem Talekar | Named in the records | n/a | Process control only; no technical role binds approvals to one person; self-review guard exists for payouts | Written approvals with name and date |
| Emergency stop | Required | Yes | On Preview, Owner-stated with screenshots | **Not on Production** | G3 |
| Ledger recording | OFF until authorised | Yes | Seen OFF (Step 2) | Yes (default) | Keep OFF |
| Payments | OFF | Yes (default `payments_enabled` false once SQL exists; route 503 without config) | Webhook fail-closed Scratch-run | Route yes; database settings not applied | Keep OFF |
| Revive fallback | OFF | Yes (default) | Owner-stated variables removed (word only) | Per-environment confirmation pending | O3 |
| Razorpay live mode | Forbidden | Code refuses live keys | Scratch-run tests | Yes in code | Keep |
| Payoneer payouts | Manual only | No API | n/a | n/a | None initiated |

**This matrix authorises nothing.** No real transaction, payment, payout, key, campaign, deployment or live traffic is authorised by this report.

## 13. Final recommendation

- **Outreach and preparation: CONDITIONAL GO** (section 1, row A).
- **Real publisher keys, real campaigns, real payments, live traffic: NO-GO today.**
- **1 December controlled pilot: NO-GO as of 2026-11-10; becomes a CONDITIONAL GO if G1 to G12 are closed with evidence** and Prem Talekar gives written approval. If the owner cannot close G2, G3, G4, G5 and G7 by about 25 November, move the start date; do not compress the checks.
- Minimum viable pilot shape that fits the evidence: one publisher, one advertiser, one campaign well under 1,000 USD, manual funding, payments off, payouts disabled, ledger OFF, supervised daily readings, Revive OFF, emergency stop practised.

## 14. Owner actions before 1 December

1. Run CI on the exact commit (G1). 2. Decide the pilot environment and, if Production, backup and inventory (G2). 3. Finish the emergency-stop checks (G3). 4. Complete O1 to O6 (G4). 5. Decide and add Vercel Firewall rules (G5). 6. Re-measure latency (G6). 7. Write the spend-control rule and the scope of the 2,000 USD limit (G7). 8. Define a failed window and give or withhold sign-off (G8). 9. Contact the pilot publisher and advertiser and collect written confirmations; issue no key yet (G9, G10). 10. Resolve `SUPABASE_SERVICE_ROLE_KEY`, Revive variables, `cc54` (G11, G12). 11. Obtain written replies from Razorpay, Payoneer and the CA (O15, O16); not needed to start a manual-funding pilot, needed before any automated payment.

## 15. Previously completed tests intentionally skipped

Publisher authentication, 400/415/413, valid request, no-fill, impression, duplicate, invalid token, click redirect, key lifecycle, signup and approval, creative and rich delivery, pilot request and latency measurement, spend and daily cap checks, ledger consistency check, payout flow checks, emergency stop on Preview, CI and DB integration (Owner-stated). None was repeated, altered or re-marked.

## 16. CI status

Awaited from the owner: `CI` (type check, `npm test`, ESLint, build) on the Step 6 changes. Step 7 changed no code, so it adds no CI risk. `DB integration` is not affected (no SQL changed). Scratch-run results from Step 6 (62 of 62 payment tests, strict type check of the payment library) are not CI results.

## 17. Files in this step

- New: `PHASE5-STEP7-PILOT-GO-NO-GO-REPORT.md`.
- New: `README-CHANGED-FILES.txt` (hand-off list, delivered in the ZIP only).
- Modified: none. No application code, migration, workflow, configuration or historical report was changed.

Step 8 is not started and waits for the owner's explicit confirmation.
