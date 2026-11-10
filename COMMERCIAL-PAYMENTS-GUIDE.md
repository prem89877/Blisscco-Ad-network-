# Commercial Payments Guide (Phase 5 Step 5)

Status: **Cashfree chosen for advertiser payments, Payoneer (manual) for publisher payouts, no wallet (owner, 2026-11-09)**; nothing run against either yet. Nothing here charges a card or sends money. The SQL (`supabase/sql/phase5-step5-1-commercial-payments.sql`) has **not been run anywhere**. All payment routes fail closed until a provider adapter exists and `PAYMENT_PROVIDER` is set on Preview.

## 1. USD transaction flow (target design)
1. Advertiser (logged in) asks to fund a payment. Server resolves the advertiser from the session (never from the form) and calls `payments_create_intent` (service role): USD, 2 decimals, optional own campaign, `request_key` makes retries safe. Result: record `BPY-XXXXXXXXXXXXXXXX`, status `created`.
2. Server asks the approved provider for a checkout and stores the provider payment id once (`payments_attach_provider_payment`): `pending`.
3. Customer pays on Cashfree's checkout (order currency USD; Cashfree settles to you in INR, T+2). The browser return page only **reads** our database; it can never mark a payment paid.
4. Provider sends a webhook. Server: verify signature on the raw body, then re-read the payment from the provider's API, compare, then call `payments_apply_verified_event`. Only then `succeeded` + `verified_at`.
5. Money is a payment record only. It does **not** change `campaigns.total_budget` or spend: prepaid wallet is not in the architecture (DECISION NEEDED).

## 2. Advertiser payment lifecycle
`created -> pending -> succeeded -> partially_refunded -> refunded`; `succeeded/partially_refunded -> disputed -> dispute_won | dispute_lost`; `created/pending -> failed | cancelled`. Terminal: failed, cancelled, refunded, dispute_won, dispute_lost. Out-of-order events are logged as `ignored_invalid_transition` and change nothing.

## 3. Webhook handling
- Wrong signature: HTTP 400, nothing read or written.
- Same provider event id again: `duplicate_event`, HTTP 200, no change (unique `(provider, provider_event_id)`).
- Amount, currency, provider id or provider mismatch: recorded on the event row, payment unchanged, HTTP 422 (investigate).
- Provider API or database down: HTTP 503 so the provider retries.
- Only a SHA-256 of the body is stored, never the body.

## 4. Refund and dispute handling
Refunds and chargebacks arrive as verified events (`partially_refunded` with cumulative refunded total, `refunded`, `disputed`, `dispute_won/lost`). Refund total can never decrease or exceed the amount. Issuing a refund at the provider is a manual admin step in the provider dashboard (no automatic refunds). Nothing automatically touches publisher earnings: any clawback is an admin ledger adjustment/reversal (decision 6, Step 3).

## 5. Publisher payout lifecycle
`requested -> approved -> paid` (or `rejected`), existing flow. New rules (DB triggers): amount >= 20 and <= 500 USD, one request per UTC month (admin-configurable in `payout_settings`); `paid` needs `payouts_enabled = true` (default **false**) and a unique external payment reference recorded by an admin via "Payout settlement". Each completed or failed attempt gets a unique `BPO-...` reference. Failed transfer: recorded, request stays `approved` (retry or reject). Returned money after paid: "Record reversal" adds a ledger adjustment equal to the amount, so the balance is available again. Earned (ledger balance), pending/approved (reserved) and paid stay separate as before. No payout is ever started automatically.

## 6. Reconciliation (read-only, owner/admin)
- Run checks V1-V10 at the bottom of the migration (TEST).
- Daily during a pilot: compare provider dashboard payments with `admin_list_payments`; every `succeeded` must have `verified_at` and a provider id; sum of refunded amounts must match provider refunds.
- Payouts: every new `paid` request has a `completed` settlement with an external reference; compare references with the bank/provider statement. Re-run `day-13-16-financial-consistency-verify.sql`.
- Any mismatch: stop (`payments_enabled=false`, `payouts_enabled=false`), keep evidence, do not edit rows.

## 7. Owner steps still required
See `PHASE5-STEP5-COMMERCIAL-PAYMENTS-REPORT.md` section 10.

## 8. Cashfree and Payoneer specifics
- Cashfree order_id = our `BPY-...` reference. Webhook `PAYMENT_SUCCESS_WEBHOOK` is only a hint: we re-read `GET /orders/{order_id}/payments` and need exactly one SUCCESS attempt with the exact USD amount. Failed or dropped attempts are ignored (the customer may retry); expired unpaid orders are cancelled by admin. Refund/dispute webhooks are ignored until their sandbox payloads are checked.
- Env (Preview only, Sensitive): `PAYMENT_PROVIDER=cashfree`, `CASHFREE_ENV=sandbox`, `CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET`. Anything but `sandbox` disables the adapter.
- Settlement is INR, so USD publisher payouts need separate funding. Payoneer payouts are manual: send from Payoneer, then record the Payoneer payment ID in the admin "Payout settlement" panel. API automation is not built.


## Update 2026-11-09 (Phase 5 Step 6): provider change

- **Cashfree: BLOCKED.** Cashfree refused to activate International Payment Gateway for the account (no reason given). The Cashfree code stays in `lib/payments/cashfree.ts` for history; it is sandbox-only and does nothing in Production. Do not open a second Cashfree account for the same business.
- **Advertiser payments: Razorpay, TEST MODE ONLY.** Adapter: `lib/payments/razorpay.ts`. It exists only when `PAYMENT_PROVIDER=razorpay`, `RAZORPAY_MODE=test`, a key id starting `rzp_test_`, a key secret and a separate webhook secret (16+ characters each) are set. Live keys are refused by the code. Anything else means the webhook answers 503 and writes nothing.
- How it decides (written from Razorpay docs, never run against Razorpay): signature = hex HMAC-SHA256 of the raw body with the webhook secret (header `X-Razorpay-Signature`); only the `order.paid` event is handled; the order `receipt` must be our `BPY-...` reference; the status is re-read from Razorpay (`/orders/{id}` and `/orders/{id}/payments`): exactly one captured payment, full amount, same currency, no refund. Amounts are USD cents. Other events (failed, refund, dispute) are ignored (HTTP 200) until their test payloads are checked.
- **Still missing before any test payment:** the "create Razorpay order with receipt = BPY reference" server call and the advertiser checkout page (Step 5b), Razorpay written approval for the ad network / prepaid ad credits category, Razorpay test keys and a test webhook secret on Vercel **Preview only**, the Step 5 SQL applied on TEST with `payments_enabled` switched on. Razorpay's own dashboard note: business name is the legal KYC name and cannot be changed; the Brand Name field and what customers see in UPI or card apps must be asked from Razorpay support.
- **Publisher payouts: Payoneer, manual.** No Payoneer API, key or code exists. The admin sends the payout from Payoneer, then records the Payoneer payment ID in "Payout settlement" (the form already asks for it). Whether an Indian business may pay foreign publishers this way is PENDING OWNER CONFIRMATION (Payoneer, bank, CA). Payouts stay off (`payouts_enabled` false) until then.
- Settlement of Razorpay international cards is in INR (screenshot showed T+7 and a 50,000 INR per-transaction limit); USD records and INR receipts need a written reconciliation rule.
