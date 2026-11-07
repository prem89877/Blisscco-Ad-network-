# Phase 5 Step 1: Phase 4 Pending Items Consolidation Report

Date: 2026-11-07. Source of truth: the uploaded `blisscco-ad-network.zip`. Scope: documentation only. Nothing was run, no test repeated, no SQL executed, no Production or Preview service contacted. Revive fallback stays OFF. No billing, no payout, no traffic. Phase 5 Step 2 not started.

Evidence labels: **User-confirmed** = owner's word only. **Seen** = output the owner pasted. **Code-read** = Claude read the code or a document; nothing was run. **Pending** = no evidence yet. **Owner-stated** = a decision the owner wrote on 2026-11-07.

Existing reports are not edited. Historical results stay as they are, and document tests lock several of them. This file is the only addition.

## 1. Previously completed tests intentionally skipped

Publisher authentication (no key, wrong key, suspended publisher, revoked key); 400, 415, 413 cases; valid contextual request; no-fill on unmatched and sensitive topics; impression, duplicate, invalid token and click redirect; key create, show-once and revoke; signup and approval flow; CI green; creative and rich-delivery checks. Sources: `PHASE4-STEP1-GATE-CLOSURE-REPORT.md`, `PHASE4-STEP2-PILOT-EXECUTION-REPORT.md`, `PHASE4-STEP5-PUBLISHER-READINESS-REPORT.md`.

## 2. Task 1: Gates A to D (skipped by owner decision)

The owner has made no contact with any publisher or advertiser. Every item that needs a publisher stays **Pending: publisher contact not yet made**. Nothing is marked confirmed.

| Gate | Item | Status | Evidence required |
| --- | --- | --- | --- |
| A | Publisher handles 429 and 503 without breaking the chat | Pending | Publisher's own run, or written confirmation |
| B | Behavior with `AD_TRACKING_SECRET` unset is understood | Pending (the one item doable without a publisher) | A person reads the code and writes the finding. Not run on Preview |
| B | Impression sent only after display and only from the publisher's server | Pending | Publisher's code or written confirmation |
| B | No page link points straight at `destination_url` (click-link implementation) | Pending | Publisher's code or written confirmation |
| C | 503 `unavailable` told apart from 200 no-fill | Partial | 200 Seen. 503 cannot be caused on Preview, mocked tests only |
| D | Publisher received guide sections 6 and 6a | Pending | Dated record from a person |
| D | Written confirmation of the Sponsored label and plain text | Pending | Written confirmation, no key or host in it |
| D | Publisher owns its chatbot interface and disclosures | Pending | Written confirmation |

## 3. Task 2: Pilot safety checklist (`MVP-PILOT-SAFETY-CHECKLIST.md`)

### 3a. Owner decisions, stated 2026-11-07 (Owner-stated, not edited into the checklist)

| Decision | Value |
| --- | --- |
| Max total budget per pilot campaign | 1000 USD |
| Max total of all pilot campaigns together | 2000 USD |
| Publisher payout maximum | 500 USD per payout request |
| Named approver for campaigns and payouts | Prem Talekar |
| Stop: 503 or timeouts | Either condition stops the pilot and starts an investigation: (1) 30 minutes of continuous 503s or timeouts, OR (2) 3 consecutive failed observation windows (42 days). Restated by the owner 2026-11-07 |
| Stop: dashboard button error | 5 consecutive failures |
| 503 investigation trigger | 10 or more 503s in 1 hour, or fill rate below 40% with rising 503s |
| Incorrect ad matching | 1 wrong match pauses the campaign (proposal accepted) |
| Serves vs impressions tolerance | plus or minus 5% |
| Latency limit (Blisscco server side) | Average below 400 ms, slowest below 1200 ms |
| Pilot start date | 1 December 2026 |
| Observation checks | Day 1 (1 Dec), Day 3 (3 Dec), Day 7 (7 Dec), Day 14 (14 Dec); review 15 Dec 2026 |
| Observation window | 14 consecutive calendar days |
| Pilot stable | 3 consecutive successful windows (42 days). This is for stability approval only, not a stop rule. No window is marked complete without actual test evidence |
| Owner sign-off | CONDITIONAL. No Production deployment, live traffic or real payments approved. No pilot traffic starts without the owner's explicit final approval |

| Window | Dates | Status |
| --- | --- | --- |
| 1 | 1 to 14 Dec 2026 (review 15 Dec) | Not started |
| 2 | 15 to 28 Dec 2026 | Not started |
| 3 | 29 Dec 2026 to 11 Jan 2027 | Not started |

Open point: "failed window" is not defined yet. The owner should state what makes a window failed (for example, a stop condition from checklist section 10f was triggered) before window 1 starts.

Note: the checklist calls the budget caps "small". These caps are the owner's decision and are recorded as given. The current test campaigns (198.00 and 1.00 total) are inside them.

### 3b. Still open

| Item | Status | Required |
| --- | --- | --- |
| Definition of a failed observation window | Not set | Owner writes it |
| Owner sign-off (Prem Talekar) | Conditional, not given | Explicit final approval, with name and date, before any pilot traffic |
| Preview environment isolation | User-confirmed (Owner, 2026-11-06: 3 Preview variables TEST, 3 Production variables Production). Claude did not see the references | Optional: dated note of project references only, no values |
| Server-only secrets: Sensitive switched on, no `NEXT_PUBLIC_` secret name | Pending | Owner checks the Vercel dashboard and writes date and result |
| Bundle and log exposure search (checklist section 6) | Pending | Manual search for the listed patterns in the repository, `.next/static`, browser network tab, Vercel and GitHub logs. Not run in this step |
| Revive configuration | User-confirmed (word only): on 2026-11-07 the owner said all Revive variables were removed from Vercel. `REVIVE_DELIVERY_URL` had been present in Production, which conflicted with checklist section 5, so it was removed. Fallback stays OFF. Not seen by Claude | Owner confirms Production and Preview separately, with date, that `REVIVE_FALLBACK_ENABLED`, `REVIVE_JSON_PREVIEW_ENABLED`, `REVIVE_DELIVERY_URL`, `REVIVE_TIMEOUT_MS` and `REVIVE_RESPONSE_FORMAT` are absent. Checklist boxes stay unticked |
| `SUPABASE_SERVICE_ROLE_KEY` in Vercel | Open question | Code-read: no code or `.env.example` uses it (only `SUPABASE_SECRET_KEY`). Owner decides whether to remove it if it duplicates the secret key |
| Bundle and log exposure search | Code-read findings only | Source search found no secret pattern, no server-only import in a client file, no `NEXT_PUBLIC_` secret, and logs hold static labels and error codes only. The `.next/static` search, browser check and Vercel and GitHub logs are not done. Not complete until the owner confirms |
| Per-test keys | User-confirmed (word only): a new key per test, revoked after each test | Dated revoke records |
| TEST key revoke-practice date | Not recorded. The 401 after revoke is User-confirmed | Owner writes the date |

## 4. Task 3: Phase 4 Step 2 pending evidence (for Phase 5 Step 2, not run now)

Pilot request limit: 30 match requests (Owner-approved 2026-11-06). Used so far: 6 (four no-fill, two 401). Remaining: 24. The limit is not increased. TEST publisher and TEST key only, fallback OFF.

| Pending item | Exact evidence to collect in Step 2 |
| --- | --- |
| Click count and publisher/campaign attribution | Dashboard click count for the pilot campaign and for the TEST publisher read before and after one controlled serve. Date, environment name, campaign identifier (first 8 characters), counts as shown. Click only after an impression |
| Publisher earnings and ledger comparison | Earnings page and ledger entries read before and after the same serve. Compare with serves, impressions and clicks. Duplicate and invalid events add nothing. One ledger entry per serve. No payout requested |
| Response latency | Tool named (for example `curl` timing in Termux), environment named, sample size, each figure with its unit. Compare with the owner limits in section 3a. Write "not measured" if not taken |
| Controlled request usage | A running count against 30: requests made this pass, total used, remaining. Each request listed by outcome (200 fill, 200 no-fill, 401 and so on) |

Needed before Step 2 starts: owner confirms the pilot start and the request budget for that pass. No test is run in Phase 5 Step 1.

## 5. Task 4: Publisher readiness (`PHASE4-STEP5-PUBLISHER-READINESS-REPORT.md`)

| Item | Status | Evidence required |
| --- | --- | --- |
| TEST key revocation practice date | Not recorded | Owner writes the date |
| Pilot publisher's written confirmations (Sponsored label, guide 6 and 6a, disclosure ownership) | Pending: publisher contact not yet made | Written confirmation from the publisher, no key or host in it |
| Publisher's own 429/503 handling confirmation | Pending: publisher contact not yet made | Publisher's own run or written confirmation |

Supported only by mocked tests (cannot be safely caused on Preview): 429, 503, expired key, 503 vs no-fill separation.
Supported only by the owner's word: signup and approval flow, key shown once, CI green, Preview isolation.
Supported only by Code-read: documentation vs route and env-name consistency, no key logging, no `NEXT_PUBLIC_` secret, topic-only requests.

## 6. Exact owner confirmations required

1. Definition of a failed observation window.
2. Explicit final approval (Prem Talekar) before any pilot traffic. Sign-off stays conditional until then.
3. Vercel dashboard check: each secret marked Sensitive, no `NEXT_PUBLIC_` secret name.
4. Bundle and log exposure search, to be run by a person later.
5. TEST key revoke-practice date.
6. Dated confirmation that all Revive variables are absent in Production and Preview, and a decision on `SUPABASE_SERVICE_ROLE_KEY`.
7. Publisher contact, then the written confirmations and 429/503 handling (Gates A to D).
8. Owner confirmation before Phase 5 Step 2 begins.

## 7. Is Phase 4 ready for final sign-off?

**No.** Deployment-side items are verified, and the owner has supplied the budget, payout, approver, stop and latency decisions. Still open: all publisher-dependent Gate A to D items, the exposure search, the Vercel Sensitive check, the pilot start date, the revoke-practice date, the sign-off, and the Step 2 evidence in section 4. No manual item was marked complete without the owner's confirmation.

## 8. Files created or modified

- `PHASE5-STEP1-PENDING-ITEMS-REPORT.md`: new. No other file was changed. No code, SQL, config, environment value or workflow was touched. No `.sh` script was added.

Phase 5 Step 2 is not started. It waits for the owner's explicit confirmation.
