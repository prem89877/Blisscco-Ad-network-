# Phase 5 Step 5: Commercial Payment Infrastructure and USD Payment Integration Report

Date: 2026-11-08. Source of truth: uploaded `blisscco-ad-network.zip`, Phase 4 and Phase 5 reports (Steps 1 to 4). Existing reports are not edited.

Evidence labels: **Code-read**, **Web-checked (2026-11-08, search results, not the provider's contract)**, **Written, not run**, **PENDING OWNER DECISION**, **PENDING OWNER CONFIRMATION**.

Scope done: code, SQL and documentation written. **Nothing was run against any database, no provider contacted, no sandbox used, no money moved, Production untouched.** `npm test` was not run by Claude in the project (CI is the owner's). Only the new Step 5 tests were compiled and run in an isolated scratch build (42 of 42 passed); that is not a CI result.

## UPDATE 2026-11-09: owner decisions applied
Owner decisions: (1) **No wallet for now.** (2) **Advertiser payments: Cashfree.** (3) **Publisher payouts: Payoneer.** Sections below that say "provider not selected" are superseded by this block. Everything is still TEST / sandbox only; nothing was run against Cashfree or Payoneer, no credentials exist yet.

**Cashfree facts (web-checked 2026-11-09 against Cashfree's own docs; confirm in your own sandbox/contract):**
- International Payment Gateway: Visa/Mastercard/Amex etc. in 140+ currencies, USD supported with 2 decimals (minimum order 0.10 USD). **Settlement is in INR (T+2), not USD.** So you receive INR; USD payouts to publishers must be funded separately (your own bank/Payoneer balance). FIRC/inward remittance reports are offered.
- Pricing seen: about 2.99% for international cards (a limited offer of 2.69% was advertised). Not a contract; refund and dispute fees not verified. Approval for an ad network / prepaid ad credits category is **PENDING OWNER CONFIRMATION**: ask Cashfree in writing.
- Webhook signature: base64(HMAC-SHA256(client secret, x-webhook-timestamp + raw body)), compared with `x-webhook-signature`. Sandbox base `https://sandbox.cashfree.com/pg`, payments of an order `GET /orders/{order_id}/payments`, API version 2025-01-01, headers x-client-id / x-client-secret.
- Cashfree allows several payment attempts per order. Webhook payloads showed no event id, so the idempotency key is built as `TYPE:cf_payment_id` (assumption to confirm in sandbox).

**Payoneer facts (web-checked, not verified for your account):** Mass Payout API exists (up to 500 payouts per call) but it needs a Payoneer program, payees must be registered, and funds must be deposited in advance. Payoneer states that Indian businesses can send payments abroad, mainly B2B, and the sender side has limits on volume and purpose (needs your Payoneer account manager / bank). **API automation is NOT built.** Payouts stay manual: admin sends from Payoneer (dashboard or mass-payment file), then records the Payoneer payment ID in "Payout settlement". Whether an Indian ad network may pay foreign publishers this way is **PENDING OWNER CONFIRMATION** (Payoneer + your bank/CA).

**Code added in this update (written, unit-tested with fakes, never run against Cashfree):** `lib/payments/cashfree.ts` (webhook parse, signature, order confirmation through Cashfree's payments API), Cashfree signature primitive, an "ignore" result so unsupported event types get HTTP 200, registry entry. Safety: adapter exists **only** when `PAYMENT_PROVIDER=cashfree` and `CASHFREE_ENV=sandbox` with id and secret set; anything else (including production) means 503. Our payment reference `BPY-...` is used as Cashfree `order_id`, so the webhook finds the payment without metadata. Only `PAYMENT_SUCCESS_WEBHOOK` changes a payment, and only if Cashfree's API shows exactly one SUCCESS attempt with an exact USD amount. Failed attempts, dropped payments, refunds and disputes are ignored for now (customer may retry, so a payment stays pending; admin cancels expired ones). The database already supports refund and dispute statuses; mapping them waits for real sandbox payloads.
Tests: the new Step 5 file now has 49 tests (49 passed in an isolated scratch build, not CI).

**Still missing before any sandbox payment can run:** the "create Cashfree order + checkout" part (server call plus advertiser page and Cashfree's browser checkout script, needing a CSP check and Cashfree's required customer fields), sandbox credentials, SQL applied on TEST with `payments_enabled` switched on, Cashfree webhook URL set in the sandbox dashboard. These are the next step (5b).

**Updated owner actions:** (a) Cashfree: create a sandbox (test) account, send them the written category question; (b) Payoneer: ask your account manager whether your India business can send mass payouts and whether the Mass Payout API is available, and the sender limits; (c) add `PAYMENT_PROVIDER`, `CASHFREE_ENV=sandbox`, `CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET` on Vercel **Preview only** (Sensitive) when you have sandbox keys; (d) decide how INR settlement will fund USD payouts.

## 1. Payment provider evaluation (India business, USD from abroad)

Web-checked, to be confirmed in each provider's own onboarding and contract before relying on it.

| Option | Onboarding in India | USD in, USD out | Fees (reported) | Fit for Blisscco |
| --- | --- | --- | --- | --- |
| Razorpay International Payments | Registered business, KYC, website, enablement on dashboard; product/category review | International cards in 100+ currencies. Settlement normally **INR**; USD settlement only via an **EEFC account** option (reported, needs bank + enablement). Typical international card settlement reported T+7 | About 3% + 18% GST on it, plus FX markup if INR | Best documented for Indian businesses with a sandbox; **ad-credit/ad-network category approval unverified** |
| Stripe India | **Invite only** (cannot self sign up) | Cards in 135+ currencies, settled in INR (reportedly cannot hold USD) | About 3% to 4.3% international cards, reported 5 to 6% all-in | Not beginner-friendly: access depends on Stripe's invite |
| PayPal India | Business account, PAN, bank, purpose code | Receive only; USD auto-converted to INR and withdrawn; **cannot send money abroad**, cannot hold USD | About 4.4% + FX markup | Possible for receiving; **useless for paying publishers** |
| Dodo Payments (merchant of record) | India-based, fast onboarding | Merchant of record sells for you, pays out net; digital products only | About 4% + 0.40 USD reported; USD SWIFT payout fee reported | Built for software sales. **Prepaid ad-credit top-ups / ad network not confirmed as an accepted use**; MoR also conflicts with a platform that pays publishers |
| Bank-transfer collection services (virtual USD accounts) | Business KYC | USD bank transfers in; not card checkout | Varies | Option for larger advertisers; not evaluated in depth |

Refund and dispute: all card gateways above have refund APIs and dispute/chargeback processes with their own fees (Dodo reports 1 USD per refund, 30 USD per dispute); exact terms are **not verified** here.

Publisher payouts (USD): **no provider was verified to support automated USD payouts from an Indian business.** PayPal India cannot send abroad; Razorpay's payout product is INR. Outward USD payments from India go through an authorised dealer bank under FEMA/RBI rules. This needs your bank/CA, so payouts stay **manual** (existing design) and are not automated.

**Recommendation (not a decision):** start with Razorpay International Payments for advertiser card payments, because it has Indian onboarding, a sandbox and docs, and a USD (EEFC) settlement option. Before applying, ask Razorpay support in writing (a) whether an ad network / prepaid ad credits is an approved category, (b) whether USD settlement to an EEFC account is available to you, (c) refund and dispute fees. If they refuse, the fallback is manual bank-transfer invoicing (Phase 7 plan) rather than a card gateway. Do not use a merchant-of-record platform without written confirmation.

## 2. Provider selection status
**Decided by owner (2026-11-09): Cashfree for advertiser payments, Payoneer (manual) for publisher payouts.** Account approval, category approval and sandbox keys are still PENDING OWNER CONFIRMATION. Until sandbox keys are set, `/api/payments/webhook` answers 503 and writes nothing.

## 3. Advertiser USD payment implementation (written, not run)
Provider-neutral and fail-closed. New SQL `phase5-step5-1-commercial-payments.sql`: `advertiser_payments` (exact `numeric(12,2)` USD, unique internal reference `BPY-...`, unique request key per advertiser, unique provider id, `verified_at` required for any paid state, guard trigger and status machine), append-only `advertiser_payment_events`, `payment_webhook_events` (idempotency), `payments_audit_log`, `payment_settings` (`payments_enabled` default false, optional max). Functions: create intent (checks advertiser ownership, active status, own campaign, 2 decimals), attach provider id, apply verified event (amount, currency, provider, reference, transition, refund checks); read functions for advertiser and admin.
TypeScript: `lib/payments/` (cents-based money, status machine, signature primitives, provider interface, webhook processing, server-only DB wrapper), webhook route.
**Not built, decisions needed:** advertiser wallet/prepaid balance and automatic campaign budget funding (architecture has none; budget stays a spending cap; a payment never changes budget or spend); advertiser-facing payment page and checkout (needs the provider); admin payments page (only SQL read functions exist).
Existing advertiser spending ledger and `record_ad_serve` are untouched.

## 4. Publisher USD payout implementation (written, not run)
Existing request/approve/reject/paid tables and functions are not redefined. Added: `payout_settings` (min 20, max 500, once per UTC month, `payouts_enabled` default false), BEFORE INSERT limits trigger, `publisher_payout_settlements` (unique `BPO-` reference, unique external reference, failed/completed/reversed), BEFORE UPDATE gate (paid needs payouts enabled and a completed settlement), functions `admin_complete_payout`, `admin_record_payout_failure`, `admin_reverse_payout` (uses existing `ledger_add_adjustment`), admin list, publisher references list, admin settings function with audit. UI: new admin panel "Payout settlement" and a publisher message for limit errors. Earned, reserved and paid remain separate; nothing starts a payout automatically (a test asserts only the admin action calls the new functions).
**Behaviour changes on TEST once applied (owner decision from Step 3):** small payout requests under 20 USD are refused; the old "Mark as paid" button now fails by design (reference required, payouts off). The old button was left in place because CI tests lock its source. Remove it in a follow-up with its tests. Publisher-facing display of payout references: SQL function exists, page not changed. Old paid rows have no settlement (kept as is).

## 5. Webhook and payment security status
Written and unit-tested with fake provider/store (pure logic): signature check on raw body, constant-time compare, replay tolerance primitive, provider API re-read, claim vs provider mismatch rejected, hash-only payload storage, duplicate event acknowledged without effect, mismatch surfaced as 422, secrets never in client code or logs, `.env.example` lists names as comments only. **Webhook signature formats are NOT verified against any real provider.** DB-side protections (RLS, grants, triggers, idempotency) are **Written, not run**: owner must run checks V1 to V10 on TEST.

## 6. Sandbox verification results
**None. Not run: no provider selected, no sandbox credentials.** The eight Task 5 scenarios (success, failure, duplicate webhook, invalid signature, status mismatch, refund, payout approval workflow, reconciliation) are all PENDING. Logic-level coverage only (fake provider tests above). No results were invented.

## 7. Previously completed tests intentionally skipped
All Phase 2 to 5 manual and CI checks (earnings, payout page, ledger consistency 7 of 7 PASS, emergency stop checks, serve/impression/click, daily cap). Not repeated, not altered.

## 8. CI checks awaiting owner results
`CI` (type check, `npm test`, ESLint, build) on this change. Files touching existing tests: allowlists in `tests/auth/part3-hardening.test.ts` and `tests/ads/day10-part6-final.test.ts` (added `lib/payments/payments-db.ts`), `tsconfig.test.json` includes. Risk to watch: type check/ESLint/build were not run on the new UI/action files (`PayoutSettlementButton.tsx`, `PayoutSettlementsPanel.tsx`, `payout-settlement-actions.ts`, edited `payout-actions.ts`, `admin/page.tsx`). `DB integration` unaffected (no existing SQL changed).

## 9. Files modified and database changes
New: `supabase/sql/phase5-step5-1-commercial-payments.sql`, `lib/payments/{money,status,signature,provider,process-event,payments-db}.ts`, `app/api/payments/webhook/route.ts`, `lib/payouts/settlements.ts`, `app/dashboard/admin/payout-settlement-actions.ts`, `components/admin/PayoutSettlementButton.tsx`, `components/admin/PayoutSettlementsPanel.tsx`, `tests/payments/phase5-step5-payments.test.ts`, `COMMERCIAL-PAYMENTS-GUIDE.md`, this report.
Edited: `lib/payouts/rules.ts` (appended), `app/dashboard/publisher/payout-actions.ts` (limit message), `app/dashboard/admin/page.tsx` (one panel), `.env.example` (commented names), `supabase/MIGRATION-ORDER.md` (row 41), `tsconfig.test.json`, two test allowlists.
Database changes: **none applied.** The SQL adds 7 tables and functions/triggers when the owner runs it on TEST.

## 10. Owner decisions and access still required
1. Choose a provider (recommendation above); send the written questions; business documents for KYC (PAN, GST if any, bank account, website, terms).
2. Prepaid wallet or not; whether a payment should fund a campaign budget.
3. Max single payment (blank), and how outward USD payouts will be paid (bank/CA).
4. Confirm TEST project is "Denim Hub Bsl"; apply the SQL on TEST, run V1 to V10.
5. After provider choice: sandbox keys on Vercel Preview only (never Production, never live keys).
6. Remove the old "Mark as paid" button in a later step.

## 11. Remaining blockers
No provider; SQL unrun; no sandbox evidence; no adapter, checkout page or admin payments page; outward USD payout route unverified; Production has no backup (Step 4).

## 12. Overall commercial payment readiness
**Not ready for real money.** Safe foundation written (fail-closed, provider-neutral, no live integration). Ready for: owner provider decision, then TEST SQL application and sandbox work in Step 5b. Step 6 not started.
