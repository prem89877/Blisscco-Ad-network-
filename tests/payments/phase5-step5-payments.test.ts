import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PAYMENT_MAX_CENTS, centsFromDecimalString, formatCents, parsePaymentAmount } from "@/lib/payments/money";
import {
  APPLY_OUTCOMES, PAYMENT_STATUSES, PAYMENT_TRANSITIONS, canPaymentTransition, isEventStatus, outcomeChangedPayment, outcomeIsAcknowledged,
} from "@/lib/payments/status";
import { createHmac } from "node:crypto";
import { hmacSha256Hex, safeEqualHex, sha256Hex, verifyBodyHmac, verifyTimestampedHmac, verifyBase64TimestampHmac } from "@/lib/payments/signature";
import { confirmFromAttempts, createCashfreeAdapter, parseCashfreeWebhook } from "@/lib/payments/cashfree";
import { getPaymentProvider, type ConfirmedPayment, type PaymentProviderAdapter } from "@/lib/payments/provider";
import { httpStatusFor, processPaymentWebhook, type ApplyArgs, type PaymentsStore } from "@/lib/payments/process-event";
import {
  EXTERNAL_REFERENCE_PATTERN, SETTLEMENT_OUTCOMES, SETTLEMENT_OUTCOME_MESSAGES, limitHintMessage, parseExternalReference, parseSettlementOutcome, settlementActionsFor,
} from "@/lib/payouts/rules";
import { latestSettlementByRequest, parseSettlementRow } from "@/lib/payouts/settlements";
import { POST as webhookPost } from "@/app/api/payments/webhook/route";

// Phase 5 Step 5: sirf NAYI cheezon ke tests (purane successful tests dobara nahi). Asli database niyam (triggers / grants / RLS) sirf TEST database par
// migration ke footer ke V1..V10 se saabit honge; yahan: pure logic, nakli provider / store se webhook flow, aur SQL / source ke TEXT checks.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const SQL = read("supabase/sql/phase5-step5-1-commercial-payments.sql");
const sqlCode = SQL.replace(/--[^\n]*/g, "");

function walk(dir: string, accept: (f: string) => boolean): string[] {
  const out: string[] = [];
  for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      out.push(...walk(rel, accept));
    } else if (accept(rel)) out.push(rel);
  }
  return out;
}

const REF = "BPY-0123456789ABCDEF";
const SECRET = "test-webhook-secret-0123456789";

function fakeProvider(opts: { signatureOk?: boolean; confirmed?: ConfirmedPayment | null; claimStatus?: string; claimPaymentId?: string | null } = {}) {
  const calls = { fetch: 0, verify: 0 };
  const provider: PaymentProviderAdapter = {
    name: "fakeprov",
    verifyWebhook: () => { calls.verify++; return opts.signatureOk ?? true; },
    parseEvent: () => ({
      providerEventId: "evt_1", eventType: "payment.updated", internalReference: REF,
      providerPaymentId: opts.claimPaymentId === undefined ? "pay_1" : opts.claimPaymentId,
      claimedStatus: (opts.claimStatus ?? "succeeded") as never,
    }),
    fetchPayment: async () => { calls.fetch++; return opts.confirmed === undefined ? { providerPaymentId: "pay_1", status: "succeeded", amountCents: 2500n, currency: "USD", refundedTotalCents: null } : opts.confirmed; },
  };
  return { provider, calls };
}

function fakeStore(outcome: string | null = "processed") {
  const applied: ApplyArgs[] = [];
  const store: PaymentsStore = {
    async applyVerifiedEvent(a) { applied.push(a); return outcome === null ? null : { outcome: outcome as never }; },
  };
  return { store, applied };
}

describe("phase 5 step 5 | USD amount handling (integer cents, never float)", () => {
  it("parses plain decimals exactly and rejects everything else", () => {
    assert.deepEqual(parsePaymentAmount("12.5"), { ok: true, cents: 1250n });
    assert.deepEqual(parsePaymentAmount("0.01"), { ok: true, cents: 1n });
    assert.deepEqual(parsePaymentAmount(" 1000 "), { ok: true, cents: 100000n });
    assert.deepEqual(parsePaymentAmount("10000000"), { ok: true, cents: PAYMENT_MAX_CENTS });
    for (const bad of ["", "0", "0.00", "-1", "+5", "1e3", "1,000", "1 000", "abc", "1.234", "10000000.01", "99999999999999999999"]) {
      assert.equal(parsePaymentAmount(bad).ok, false, bad);
    }
    assert.equal((parsePaymentAmount("1.234") as { reason: string }).reason, "too_many_decimals");
  });
  it("0.1 + 0.2 style float traps do not exist: cents add exactly", () => {
    const a = parsePaymentAmount("0.10");
    const b = parsePaymentAmount("0.20");
    assert.ok(a.ok && b.ok);
    if (a.ok && b.ok) assert.equal(formatCents(a.cents + b.cents), "0.30");
  });
  it("formats and reads back without drift; refuses amounts that would need rounding", () => {
    assert.equal(formatCents(5n), "0.05");
    assert.equal(formatCents(123456789n), "1234567.89");
    assert.equal(centsFromDecimalString("12.50"), 1250n);
    assert.equal(centsFromDecimalString("12.5"), 1250n);
    assert.equal(centsFromDecimalString("12.5000"), 1250n);
    assert.equal(centsFromDecimalString("12.505"), null);
    assert.equal(centsFromDecimalString(12.5), null);
    assert.equal(centsFromDecimalString("1e2"), null);
  });
  it("money code never uses floats", () => {
    const src = read("lib/payments/money.ts").replace(/\/\/[^\n]*/g, "");
    assert.equal(/parseFloat|toFixed|Math\.round|Number\(/.test(src), false);
  });
});

describe("phase 5 step 5 | payment status machine matches the SQL", () => {
  it("TypeScript transitions equal the guard trigger and the apply function", () => {
    const guard = SQL.match(/create or replace function private\.guard_advertiser_payment[\s\S]*?\$\$;/)![0];
    const apply = SQL.match(/create or replace function public\.payments_apply_verified_event[\s\S]*?\n\$\$;/)![0];
    assert.match(guard, /old\.status = 'partially_refunded' and new\.refunded_amount > old\.refunded_amount/);
    for (const block of [guard, apply]) {
      const found = new Map<string, string[]>();
      for (const m of block.matchAll(/(?:old\.status|v_from)\s*=\s*'(\w+)'\s+and\s+(?:new\.status|p_new_status)\s+in\s*\(([^)]*)\)/g)) {
        found.set(m[1], [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]));
      }
      const isGuard = block === guard;
      for (const [from, to] of found) {
        // Guard trigger me partially_refunded -> partially_refunded alag "same status" branch se handle hota hai (refund badhne par), list me nahi.
        const expected = [...PAYMENT_TRANSITIONS[from as keyof typeof PAYMENT_TRANSITIONS]].filter((t) => !(isGuard && from === "partially_refunded" && t === "partially_refunded"));
        assert.deepEqual([...to].sort(), expected.sort(), `from ${from}`);
      }
      // jis status ka SQL me koi rasta nahi, TS me bhi koi rasta nahi
      for (const s of PAYMENT_STATUSES) if (!found.has(s)) assert.deepEqual(PAYMENT_TRANSITIONS[s], [], `terminal ${s}`);
    }
  });
  it("status list equals the SQL CHECK; money-received statuses need verified_at in SQL", () => {
    const check = SQL.match(/advertiser_payments_status_check check \(status in \(([^)]*)\)\)/)![1];
    assert.deepEqual([...check.matchAll(/'(\w+)'/g)].map((m) => m[1]), [...PAYMENT_STATUSES]);
    assert.match(SQL, /advertiser_payments_verified_check check \(status in \('created', 'pending', 'failed', 'cancelled'\) or verified_at is not null\)/);
  });
  it("a late 'pending' after 'succeeded' or any move out of a terminal state is impossible", () => {
    assert.equal(canPaymentTransition("succeeded", "pending"), false);
    assert.equal(canPaymentTransition("failed", "succeeded"), false);
    assert.equal(canPaymentTransition("refunded", "succeeded"), false);
    assert.equal(canPaymentTransition("dispute_lost", "dispute_won"), false);
    assert.equal(canPaymentTransition("pending", "succeeded"), true);
    assert.equal(canPaymentTransition("succeeded", "disputed"), true);
    assert.equal(isEventStatus("created"), false);
  });
  it("only 'processed' changes a payment; duplicates are acknowledged without effect", () => {
    for (const o of APPLY_OUTCOMES) assert.equal(outcomeChangedPayment(o), o === "processed");
    assert.equal(outcomeIsAcknowledged("duplicate_event"), true);
    assert.equal(outcomeIsAcknowledged("amount_mismatch"), false);
  });
});

describe("phase 5 step 5 | webhook signature primitives", () => {
  const body = '{"id":"evt_1","amount":2500}';
  it("accepts the right body signature and rejects tampering, wrong secret, wrong length, non-hex", () => {
    const sig = hmacSha256Hex(SECRET, body);
    assert.equal(verifyBodyHmac(SECRET, body, sig), true);
    assert.equal(verifyBodyHmac(SECRET, body + " ", sig), false);
    assert.equal(verifyBodyHmac("another-secret-0123456789", body, sig), false);
    assert.equal(verifyBodyHmac(SECRET, body, sig.slice(0, -2)), false);
    assert.equal(verifyBodyHmac(SECRET, body, "zz".repeat(32)), false);
    assert.equal(verifyBodyHmac(SECRET, body, ""), false);
    assert.equal(verifyBodyHmac(SECRET, body, null), false);
  });
  it("a missing or short secret never verifies (fail closed)", () => {
    for (const s of ["", "short"]) {
      assert.equal(verifyBodyHmac(s, body, hmacSha256Hex(s, body)), false);
      assert.equal(verifyTimestampedHmac(s, body, "1700000000", hmacSha256Hex(s, `1700000000.${body}`), 300, 1700000000), false);
    }
  });
  it("timestamped signature rejects replays outside the tolerance and altered timestamps", () => {
    const ts = "1700000000";
    const sig = hmacSha256Hex(SECRET, `${ts}.${body}`);
    assert.equal(verifyTimestampedHmac(SECRET, body, ts, sig, 300, 1700000100), true);
    assert.equal(verifyTimestampedHmac(SECRET, body, ts, sig, 300, 1700000400), false);
    assert.equal(verifyTimestampedHmac(SECRET, body, "1700000001", sig, 300, 1700000100), false);
    assert.equal(verifyTimestampedHmac(SECRET, body, "abc", sig, 300, 1700000100), false);
  });
  it("constant-time compare never throws on bad input", () => {
    assert.equal(safeEqualHex("ab", "abcd"), false);
    assert.equal(safeEqualHex("", ""), false);
    assert.equal(safeEqualHex("abc", "abc"), false); // odd length
    assert.equal(safeEqualHex("ab", "AB"), true);
    assert.match(sha256Hex("x"), /^[0-9a-f]{64}$/);
    assert.match(read("lib/payments/signature.ts"), /timingSafeEqual/);
  });
});

describe("phase 5 step 5 | webhook processing (fake provider and store, no network)", () => {
  const headers = new Headers();

  it("invalid signature: nothing fetched, nothing written, 400", async () => {
    const { provider, calls } = fakeProvider({ signatureOk: false });
    const { store, applied } = fakeStore();
    const r = await processPaymentWebhook(provider, store, "{}", headers);
    assert.deepEqual(r, { kind: "invalid_signature" });
    assert.equal(httpStatusFor(r), 400);
    assert.equal(calls.fetch, 0);
    assert.equal(applied.length, 0);
  });
  it("valid event: status comes from the provider API, amount is formatted in cents, payload is stored only as a hash", async () => {
    const { provider, calls } = fakeProvider();
    const { store, applied } = fakeStore("processed");
    const raw = '{"secret":"do-not-store"}';
    const r = await processPaymentWebhook(provider, store, raw, headers);
    assert.deepEqual(r, { kind: "applied", outcome: "processed" });
    assert.equal(httpStatusFor(r), 200);
    assert.equal(calls.fetch, 1);
    assert.equal(applied.length, 1);
    assert.equal(applied[0].amount, "25.00");
    assert.equal(applied[0].currency, "USD");
    assert.equal(applied[0].payloadSha256, sha256Hex(raw));
    assert.equal(JSON.stringify(applied[0]).includes("do-not-store"), false);
  });
  it("webhook claims success but the provider API says pending: nothing is recorded (browser / webhook claim is not trusted)", async () => {
    const { provider } = fakeProvider({ claimStatus: "succeeded", confirmed: { providerPaymentId: "pay_1", status: "pending", amountCents: 2500n, currency: "USD", refundedTotalCents: null } });
    const { store, applied } = fakeStore();
    const r = await processPaymentWebhook(provider, store, "{}", headers);
    assert.deepEqual(r, { kind: "status_mismatch" });
    assert.equal(httpStatusFor(r), 409);
    assert.equal(applied.length, 0);
  });
  it("provider payment id in the webhook differs from the provider API record: nothing is recorded", async () => {
    const { provider } = fakeProvider({ claimPaymentId: "pay_OTHER" });
    const { store, applied } = fakeStore();
    assert.deepEqual(await processPaymentWebhook(provider, store, "{}", headers), { kind: "status_mismatch" });
    assert.equal(applied.length, 0);
  });
  it("provider API unreachable or event without a payment id: nothing is recorded, retryable 503 / 400", async () => {
    const a = fakeProvider({ confirmed: null });
    const s1 = fakeStore();
    const r1 = await processPaymentWebhook(a.provider, s1.store, "{}", headers);
    assert.deepEqual(r1, { kind: "provider_unavailable" });
    assert.equal(httpStatusFor(r1), 503);
    assert.equal(s1.applied.length, 0);
    const b = fakeProvider({ claimPaymentId: null });
    const s2 = fakeStore();
    assert.deepEqual(await processPaymentWebhook(b.provider, s2.store, "{}", headers), { kind: "invalid_payload" });
    assert.equal(s2.applied.length, 0);
  });
  it("provider fetch that throws is a 503, not a crash", async () => {
    const { provider } = fakeProvider();
    provider.fetchPayment = async () => { throw new Error("network"); };
    const { store } = fakeStore();
    assert.deepEqual(await processPaymentWebhook(provider, store, "{}", headers), { kind: "provider_unavailable" });
  });
  it("duplicate webhook: the store says duplicate_event, we answer 200 and nothing else happens here", async () => {
    const { provider } = fakeProvider();
    const { store } = fakeStore("duplicate_event");
    const r = await processPaymentWebhook(provider, store, "{}", headers);
    assert.deepEqual(r, { kind: "applied", outcome: "duplicate_event" });
    assert.equal(httpStatusFor(r), 200);
  });
  it("amount / currency mismatch from the database is surfaced as 422, not hidden", async () => {
    for (const o of ["amount_mismatch", "currency_mismatch", "reference_mismatch", "invalid_refund"]) {
      const { provider } = fakeProvider();
      const r = await processPaymentWebhook(provider, fakeStore(o).store, "{}", headers);
      assert.equal(httpStatusFor(r), 422, o);
    }
  });
  it("store failure / unexpected shape: 503 so the provider retries; nothing claimed as applied", async () => {
    const { provider } = fakeProvider();
    assert.deepEqual(await processPaymentWebhook(provider, fakeStore(null).store, "{}", headers), { kind: "store_unavailable" });
    assert.deepEqual(await processPaymentWebhook(provider, fakeStore("made_up_outcome").store, "{}", headers), { kind: "store_unavailable" });
  });
  it("refund event passes the cumulative refunded total in exact decimals", async () => {
    const { provider } = fakeProvider({ claimStatus: "partially_refunded", confirmed: { providerPaymentId: "pay_1", status: "partially_refunded", amountCents: 2500n, currency: "USD", refundedTotalCents: 1000n } });
    const { store, applied } = fakeStore();
    await processPaymentWebhook(provider, store, "{}", headers);
    assert.equal(applied[0].newStatus, "partially_refunded");
    assert.equal(applied[0].refundedTotal, "10.00");
  });
});

describe("phase 5 step 5 | provider not configured: everything fails closed", () => {
  it("getPaymentProvider is null for empty, invalid, unknown and even a well-formed name (no adapter is registered)", () => {
    assert.equal(getPaymentProvider({}), null);
    assert.equal(getPaymentProvider({ PAYMENT_PROVIDER: "" }), null);
    assert.equal(getPaymentProvider({ PAYMENT_PROVIDER: "Bad Name!" }), null);
    assert.equal(getPaymentProvider({ PAYMENT_PROVIDER: "someprovider" }), null);
    // Cashfree chuna gaya hai, par config poori na ho (ya production ho) to bhi null
    assert.equal(getPaymentProvider({ PAYMENT_PROVIDER: "cashfree" }), null);
    assert.equal(getPaymentProvider({ PAYMENT_PROVIDER: "cashfree", CASHFREE_ENV: "production", CASHFREE_CLIENT_ID: "id", CASHFREE_CLIENT_SECRET: "x".repeat(32) }), null);
    assert.equal(getPaymentProvider({ PAYMENT_PROVIDER: "cashfree", CASHFREE_ENV: "sandbox", CASHFREE_CLIENT_ID: "id", CASHFREE_CLIENT_SECRET: "short" }), null);
    assert.equal(getPaymentProvider({ PAYMENT_PROVIDER: "__proto__" }), null);
    assert.equal(getPaymentProvider({ PAYMENT_PROVIDER: "constructor" }), null);
  });
  it("webhook route answers 503 not_configured and never touches the database", async () => {
    const res = await webhookPost(new Request("http://localhost/api/payments/webhook", { method: "POST", body: "{}" }));
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: "not_configured" });
  });
  it("only Cashfree (the owner's choice) is named in payment code; no other provider, no live URL, no key format", () => {
    const files = [...walk("lib/payments", (f) => f.endsWith(".ts")), "app/api/payments/webhook/route.ts", "supabase/sql/phase5-step5-1-commercial-payments.sql"];
    const banned = /stripe|razorpay|paypal|paddle|lemon\s?squeezy|dodo|payu|payoneer|wise\.com|api\.cashfree|sk_live|sk_test|rzp_|whsec_/i;
    for (const f of files) {
      const code = read(f).replace(/\/\/[^\n]*/g, "").replace(/--[^\n]*/g, "");
      assert.equal(banned.test(code), false, f);
    }
  });
});

describe("phase 5 step 5 | secrets and client code", () => {
  const clientFiles = walk("components", (f) => /\.tsx?$/.test(f)).concat(walk("app", (f) => /\.tsx$/.test(f)));
  it("no client / page file mentions payment secrets or the payment library", () => {
    for (const f of clientFiles) {
      const src = read(f);
      assert.equal(/PAYMENT_PROVIDER|CASHFREE_|lib\/payments\//.test(src), false, f);
    }
  });
  it("payment env names are never NEXT_PUBLIC_ and only provider.ts reads PAYMENT_PROVIDER", () => {
    assert.equal(/NEXT_PUBLIC_(PAYMENT|CASHFREE)/.test(read(".env.example")), false);
    const users = walk("lib", (f) => f.endsWith(".ts")).concat(walk("app", (f) => /\.tsx?$/.test(f))).filter((f) => /PAYMENT_PROVIDER|CASHFREE_(ENV|CLIENT)/.test(read(f).replace(/\/\/[^\n]*/g, "")));
    assert.deepEqual(users.sort(), ["lib/payments/cashfree.ts", "lib/payments/provider.ts"]);
  });
  it(".env.example documents the payment variables only as comments (no value, nothing active)", () => {
    const active = read(".env.example").split("\n").filter((l) => /^(PAYMENT_|CASHFREE_)/.test(l));
    assert.deepEqual(active, []);
  });
  it("payments-db is server-only and logs only labels and error codes", () => {
    const src = read("lib/payments/payments-db.ts");
    assert.match(src, /^import "server-only";/m);
    for (const m of src.matchAll(/console\.error\(([^;]*)\)/g)) assert.equal(/amount|reference|secret|payload|args/i.test(m[1]), false, m[0]);
    const route = read("app/api/payments/webhook/route.ts");
    for (const m of route.matchAll(/console\.error\(([^;]*)\)/g)) assert.equal(/rawBody|secret|signature|amount|reference/i.test(m[1]), false, m[0]);
  });
});

describe("phase 5 step 5 | SQL: payments cannot be forged and money state is not touched", () => {
  it("payment write functions are service_role only; tables have RLS, no policy, no grants", () => {
    for (const sig of ["payments_create_intent\\(uuid, uuid, numeric, uuid, text, uuid\\)", "payments_attach_provider_payment\\(text, text\\)", "payments_apply_verified_event\\(text, text, text, text, text, text, numeric, text, numeric, text\\)"]) {
      assert.match(sqlCode, new RegExp(`revoke all on function public\\.${sig} from public, anon, authenticated;\\s*grant execute on function public\\.${sig} to service_role;`));
    }
    for (const t of ["payment_settings", "payout_settings", "payments_audit_log", "advertiser_payments", "advertiser_payment_events", "payment_webhook_events", "publisher_payout_settlements"]) {
      assert.match(sqlCode, new RegExp(`alter table public\\.${t}\\s+enable row level security;`));
      assert.match(sqlCode, new RegExp(`revoke all on table public\\.${t}\\s+from public, anon, authenticated, service_role;`));
    }
    assert.equal(/create policy/i.test(sqlCode), false);
    assert.equal(/grant (select|insert|update|delete|all)[^;]*on (table )?public\./i.test(sqlCode), false);
  });
  it("admin functions check private.is_admin() and are granted to authenticated only", () => {
    for (const fn of ["admin_set_payment_settings", "admin_set_payout_settings", "admin_complete_payout", "admin_record_payout_failure", "admin_reverse_payout"]) {
      const body = sqlCode.match(new RegExp(`create or replace function public\\.${fn}[\\s\\S]*?\\n\\$\\$;`))![0];
      assert.match(body, /private\.is_admin\(\)/, fn);
      assert.match(body, /errcode = '42501'/, fn);
      assert.match(sqlCode, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, service_role;\\s*grant execute on function public\\.${fn}\\([^)]*\\) to authenticated;`), fn);
    }
  });
  it("webhook idempotency, duplicate prevention and mismatch handling exist", () => {
    const apply = sqlCode.match(/create or replace function public\.payments_apply_verified_event[\s\S]*?\n\$\$;/)![0];
    assert.match(apply, /on conflict \(provider, provider_event_id\) do nothing/);
    assert.match(apply, /'duplicate_event'/);
    for (const o of ["amount_mismatch", "currency_mismatch", "reference_mismatch", "provider_mismatch", "invalid_refund", "ignored_invalid_transition"]) assert.match(apply, new RegExp(`'${o}'`), o);
    assert.match(apply, /for update/);
    assert.match(sqlCode, /advertiser_payments_request_key_key unique \(advertiser_id, request_key\)/);
    assert.match(sqlCode, /create unique index if not exists advertiser_payments_provider_ref_key\s+on public\.advertiser_payments \(provider, provider_payment_id\)/);
    assert.match(sqlCode, /payment_webhook_events_key unique \(provider, provider_event_id\)/);
  });
  it("amounts are exact numeric(12,2), USD only; the intent checks advertiser ownership and campaign ownership", () => {
    assert.match(sqlCode, /amount\s+numeric\(12, 2\) not null/);
    assert.match(sqlCode, /currency_code = 'USD'/);
    const intent = sqlCode.match(/create or replace function public\.payments_create_intent[\s\S]*?\n\$\$;/)![0];
    assert.match(intent, /a\.profile_id = p_actor/);
    assert.match(intent, /c\.advertiser_id = p_advertiser_id/);
    assert.match(intent, /p_amount <> round\(p_amount, 2\)/);
    assert.match(intent, /payments_disabled/);
  });
  it("append-only audit tables block update, delete and truncate", () => {
    for (const t of ["payments_audit_log", "advertiser_payment_events"]) {
      assert.match(sqlCode, new RegExp(`${t}_no_change before update or delete on public\\.${t}`));
      assert.match(sqlCode, new RegExp(`${t}_no_truncate before truncate on public\\.${t}`));
    }
  });
  it("the file never writes budgets, spend, serving or the ledger directly (no wallet, no balance change)", () => {
    assert.equal(/(update|insert into|delete from)\s+public\.(campaigns|campaign_spend_daily|financial_ledger|ledger_settings|ad_platform_settings|publisher_payout_requests)\b/i.test(sqlCode), false);
    assert.equal(/alter table public\.(campaigns|financial_ledger|publisher_payout_requests|publisher_payout_events)/i.test(sqlCode), false);
    assert.equal(/create or replace function public\.(request_my_payout|admin_review_payout_request|admin_mark_payout_paid|record_ad_serve|ledger_add_adjustment|ledger_reverse_entry)/i.test(sqlCode), false);
    assert.equal(/total_budget|daily_budget/.test(sqlCode), false);
  });
});

describe("phase 5 step 5 | publisher payout hardening", () => {
  it("limits trigger enforces minimum, maximum and one per month on INSERT, using the settings row", () => {
    const f = sqlCode.match(/create or replace function private\.payout_request_limits[\s\S]*?\n\$\$;/)![0];
    for (const h of ["payout_below_minimum", "payout_above_maximum", "payout_monthly_limit"]) assert.match(f, new RegExp(`hint = '${h}'`));
    assert.match(sqlCode, /create trigger publisher_payout_requests_step5_limits before insert on public\.publisher_payout_requests/);
    assert.match(sqlCode, /min_payout_usd\s+numeric\(14, 4\) not null default 20/);
    assert.match(sqlCode, /max_payout_usd\s+numeric\(14, 4\) not null default 500/);
    assert.match(sqlCode, /payouts_enabled boolean\s+not null default false/);
    for (const h of ["payout_below_minimum", "payout_above_maximum", "payout_monthly_limit"]) assert.ok(limitHintMessage(h), h);
    assert.equal(limitHintMessage("something_else"), null);
    assert.equal(limitHintMessage(undefined), null);
  });
  it("'paid' needs payouts_enabled and a completed settlement with a unique external reference", () => {
    const gate = sqlCode.match(/create or replace function private\.payout_paid_gate[\s\S]*?\n\$\$;/)![0];
    assert.match(gate, /payouts_enabled/);
    assert.match(gate, /t\.status = 'completed'/);
    assert.match(sqlCode, /create trigger publisher_payout_requests_step5_gate before update on public\.publisher_payout_requests/);
    assert.match(sqlCode, /publisher_payout_settlements_external_key\s+on public\.publisher_payout_settlements \(external_reference\) where external_reference is not null/);
    assert.match(sqlCode, /publisher_payout_settlements_one_success_key\s+on public\.publisher_payout_settlements \(payout_request_id\) where status in \('completed', 'reversed'\)/);
    assert.match(sqlCode, /publisher_payout_settlements_reference_key unique \(payout_reference\)/);
  });
  it("completion runs the existing mark-paid checks in one transaction and nothing auto-starts a payout", () => {
    const f = sqlCode.match(/create or replace function public\.admin_complete_payout[\s\S]*?\n\$\$;/)![0];
    assert.match(f, /public\.admin_mark_payout_paid\(p_request_id\)/);
    assert.match(f, /payouts_disabled/);
    assert.match(f, /reference_in_use/);
    const callers = [...walk("lib", (x) => /\.tsx?$/.test(x)), ...walk("app", (x) => /\.tsx?$/.test(x)), ...walk("components", (x) => /\.tsx?$/.test(x))]
      .filter((x) => /admin_complete_payout|admin_reverse_payout|admin_record_payout_failure/.test(read(x)));
    assert.deepEqual(callers, ["app/dashboard/admin/payout-settlement-actions.ts"]);
    for (const f2 of walk("lib/payments", (x) => x.endsWith(".ts"))) assert.equal(/payout/i.test(read(f2).replace(/\/\/[^\n]*/g, "")), false, f2);
  });
  it("reversal restores the available balance through the existing ledger adjustment, never by editing rows", () => {
    const f = sqlCode.match(/create or replace function public\.admin_reverse_payout[\s\S]*?\n\$\$;/)![0];
    assert.match(f, /public\.ledger_add_adjustment\(v_uid, 'publisher', v_req\.amount/);
    assert.match(f, /payout-reversal:/);
    assert.equal(/update public\.publisher_payout_requests/.test(f), false);
  });
  it("settlement external reference rules (no bank / card / UPI data) match the SQL pattern", () => {
    assert.match(sqlCode, /external_reference ~ '\^\[A-Za-z0-9\]\[A-Za-z0-9\._:\/-\]\{5,99\}\$'/);
    assert.equal(parseExternalReference("TRF-2026-000123").ok, true);
    assert.equal(parseExternalReference("a b c d e f").ok, false);
    assert.equal(parseExternalReference("").ok, false);
    assert.equal(parseExternalReference("12345").ok, false);
    assert.equal(parseExternalReference("x".repeat(101)).ok, false);
    assert.ok(EXTERNAL_REFERENCE_PATTERN.test("ab-cd.ef"));
  });
  it("settlement actions per state; every outcome has a message; shapes are validated", () => {
    assert.deepEqual(settlementActionsFor("approved", null), ["complete", "fail"]);
    assert.deepEqual(settlementActionsFor("approved", "failed"), ["complete", "fail"]);
    assert.deepEqual(settlementActionsFor("paid", "completed"), ["reverse"]);
    assert.deepEqual(settlementActionsFor("paid", "reversed"), []);
    assert.deepEqual(settlementActionsFor("requested", null), []);
    assert.deepEqual(settlementActionsFor("rejected", null), []);
    for (const o of SETTLEMENT_OUTCOMES) assert.ok(SETTLEMENT_OUTCOME_MESSAGES[o].length > 5);
    assert.equal(parseSettlementOutcome({ outcome: "paid" }), "paid");
    assert.equal(parseSettlementOutcome({ outcome: "hacked" }), null);
    assert.equal(parseSettlementOutcome(null), null);
    assert.equal(parseSettlementOutcome([]), null);
  });
  it("settlement rows are parsed strictly and the newest real settlement wins", () => {
    const rid = "22222222-2222-4222-8222-222222222222";
    const mk = (status: string, ext: boolean, ref: string, at: string) => ({ payout_request_id: rid, payout_reference: ref, status, has_external_reference: ext, created_at: at });
    assert.ok(parseSettlementRow(mk("completed", true, "BPO-0123456789ABCDEF", "2026-11-08T00:00:00Z")));
    assert.equal(parseSettlementRow(mk("completed", false, "BPO-0123456789ABCDEF", "2026-11-08T00:00:00Z")), null);
    assert.equal(parseSettlementRow(mk("failed", true, "BPO-0123456789ABCDEF", "2026-11-08T00:00:00Z")), null);
    assert.equal(parseSettlementRow(mk("completed", true, "bad", "2026-11-08T00:00:00Z")), null);
    assert.equal(parseSettlementRow(mk("weird", true, "BPO-0123456789ABCDEF", "2026-11-08T00:00:00Z")), null);
    const failedNew = parseSettlementRow(mk("failed", false, "BPO-AAAAAAAAAAAAAAAA", "2026-11-09T00:00:00Z"))!;
    const doneOld = parseSettlementRow(mk("completed", true, "BPO-BBBBBBBBBBBBBBBB", "2026-11-08T00:00:00Z"))!;
    assert.equal(latestSettlementByRequest([failedNew, doneOld]).get(rid)!.status, "completed");
  });
});


describe("phase 5 step 5 | Cashfree adapter (sandbox only, from Cashfree's documented formats; not yet run against a real sandbox)", () => {
  const SECRET_CF = "cf-sandbox-secret-0123456789abcdef";
  const ORDER = "BPY-0123456789ABCDEF";
  const body = JSON.stringify({ type: "PAYMENT_SUCCESS_WEBHOOK", data: { order: { order_id: ORDER, order_amount: 25, order_currency: "USD" }, payment: { cf_payment_id: 9001, payment_status: "SUCCESS", payment_amount: 25, payment_currency: "USD" } } });
  const sign = (ts: string, raw: string, secret = SECRET_CF) => createHmac("sha256", secret).update(ts + raw).digest("base64");
  const env = { CASHFREE_ENV: "sandbox", CASHFREE_CLIENT_ID: "test-id", CASHFREE_CLIENT_SECRET: SECRET_CF };

  it("verifies base64(HMAC-SHA256(secret, timestamp + rawBody)) and rejects every tampering", () => {
    const ts = "1746426425612";
    const sig = sign(ts, body);
    assert.equal(verifyBase64TimestampHmac(SECRET_CF, body, ts, sig), true);
    assert.equal(verifyBase64TimestampHmac(SECRET_CF, body + " ", ts, sig), false);
    assert.equal(verifyBase64TimestampHmac(SECRET_CF, body, "1746426425613", sig), false);
    assert.equal(verifyBase64TimestampHmac("another-secret-0123456789abcdef", body, ts, sig), false);
    assert.equal(verifyBase64TimestampHmac(SECRET_CF, body, ts, sig.slice(0, -4) + "AAAA"), false);
    assert.equal(verifyBase64TimestampHmac(SECRET_CF, body, ts, ""), false);
    assert.equal(verifyBase64TimestampHmac(SECRET_CF, body, null, sig), false);
    assert.equal(verifyBase64TimestampHmac("short", body, ts, sign(ts, body, "short")), false);
  });
  it("adapter checks the two Cashfree headers on the raw body", () => {
    const a = createCashfreeAdapter(env)!;
    const ts = "1746426425612";
    assert.equal(a.verifyWebhook(body, new Headers({ "x-webhook-timestamp": ts, "x-webhook-signature": sign(ts, body) })), true);
    assert.equal(a.verifyWebhook(body, new Headers({ "x-webhook-timestamp": ts })), false);
    assert.equal(a.verifyWebhook(body, new Headers({ "x-webhook-signature": sign(ts, body) })), false);
    assert.equal(a.verifyWebhook(body.replace("25", "2500"), new Headers({ "x-webhook-timestamp": ts, "x-webhook-signature": sign(ts, body) })), false);
  });
  it("adapter exists only for sandbox with complete config", () => {
    assert.ok(createCashfreeAdapter(env));
    assert.equal(createCashfreeAdapter({ ...env, CASHFREE_ENV: "production" }), null);
    assert.equal(createCashfreeAdapter({ ...env, CASHFREE_ENV: undefined }), null);
    assert.equal(createCashfreeAdapter({ ...env, CASHFREE_CLIENT_ID: "" }), null);
    assert.equal(getPaymentProvider({ ...env, PAYMENT_PROVIDER: "cashfree" })?.name, "cashfree");
  });
  it("parses only the success webhook; failed / dropped / refund / dispute are ignored; garbage is rejected", () => {
    const ev = parseCashfreeWebhook(body);
    assert.deepEqual(ev, { providerEventId: "PAYMENT_SUCCESS_WEBHOOK:9001", eventType: "PAYMENT_SUCCESS_WEBHOOK", internalReference: ORDER, providerPaymentId: ORDER, claimedStatus: "succeeded" });
    for (const t of ["PAYMENT_FAILED_WEBHOOK", "PAYMENT_USER_DROPPED_WEBHOOK", "REFUND_STATUS_WEBHOOK", "DISPUTE_CREATED"]) {
      assert.equal(parseCashfreeWebhook(JSON.stringify({ type: t, data: {} })), "ignore", t);
    }
    assert.equal(parseCashfreeWebhook("not json"), null);
    assert.equal(parseCashfreeWebhook("[]"), null);
    assert.equal(parseCashfreeWebhook(JSON.stringify({ type: "PAYMENT_SUCCESS_WEBHOOK", data: {} })), null);
    assert.equal(parseCashfreeWebhook(body.replace(ORDER, "order_1")), null); // hamara BPY- order id nahi
    assert.equal(parseCashfreeWebhook(body.replace('"SUCCESS"', '"FAILED"')), null);
  });
  it("order is confirmed only by exactly one SUCCESS attempt with an exact amount; extra, missing or foreign attempts are refused", () => {
    const ok = { order_id: ORDER, payment_status: "SUCCESS", payment_amount: 25.1, payment_currency: "USD", cf_payment_id: "9001" };
    const failed = { order_id: ORDER, payment_status: "FAILED", payment_amount: 25.1, payment_currency: "USD", cf_payment_id: "9000" };
    assert.deepEqual(confirmFromAttempts(ORDER, [failed, ok]), { providerPaymentId: ORDER, status: "succeeded", amountCents: 2510n, currency: "USD", refundedTotalCents: null });
    assert.equal(confirmFromAttempts(ORDER, [failed]), null);
    assert.equal(confirmFromAttempts(ORDER, []), null);
    assert.equal(confirmFromAttempts(ORDER, [ok, { ...ok, cf_payment_id: "9002" }]), null);
    assert.equal(confirmFromAttempts(ORDER, [{ ...ok, order_id: "BPY-FFFFFFFFFFFFFFFF" }]), null);
    assert.equal(confirmFromAttempts(ORDER, [{ ...ok, payment_amount: 25.123 }]), null);
    assert.equal(confirmFromAttempts(ORDER, [{ ...ok, payment_amount: "x" }]), null);
    assert.equal(confirmFromAttempts(ORDER, { not: "array" }), null);
    assert.equal(confirmFromAttempts(ORDER, [{ ...ok, payment_currency: "INR" }])!.currency, "INR"); // database currency_mismatch se rokega
  });
  it("fetchPayment calls only the sandbox host with the documented headers; errors and timeouts become null", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const good = createCashfreeAdapter(env, async (url, init) => {
      seen.push({ url, headers: init.headers });
      return { ok: true, json: async () => [{ order_id: ORDER, payment_status: "SUCCESS", payment_amount: 25, payment_currency: "USD", cf_payment_id: 1 }] };
    })!;
    const r = await good.fetchPayment(ORDER);
    assert.equal(r?.amountCents, 2500n);
    assert.equal(seen[0].url, `https://sandbox.cashfree.com/pg/orders/${ORDER}/payments`);
    assert.equal(seen[0].headers["x-api-version"], "2025-01-01");
    assert.equal(seen[0].headers["x-client-id"], "test-id");
    assert.equal(await good.fetchPayment("not-our-order"), null);
    assert.equal(seen.length, 1);
    const bad = createCashfreeAdapter(env, async () => ({ ok: false, json: async () => ({}) }))!;
    assert.equal(await bad.fetchPayment(ORDER), null);
    const boom = createCashfreeAdapter(env, async () => { throw new Error("network"); })!;
    assert.equal(await boom.fetchPayment(ORDER), null);
  });
  it("end to end with the fake store: success webhook is applied once with API-confirmed amount; failed webhook is ignored and writes nothing", async () => {
    const adapter = createCashfreeAdapter(env, async () => ({ ok: true, json: async () => [{ order_id: ORDER, payment_status: "SUCCESS", payment_amount: 25, payment_currency: "USD", cf_payment_id: 9001 }] }))!;
    const ts = "1746426425612";
    const { store, applied } = fakeStore("processed");
    const r = await processPaymentWebhook(adapter, store, body, new Headers({ "x-webhook-timestamp": ts, "x-webhook-signature": sign(ts, body) }));
    assert.deepEqual(r, { kind: "applied", outcome: "processed" });
    assert.equal(applied.length, 1);
    assert.equal(applied[0].amount, "25.00");
    assert.equal(applied[0].providerEventId, "PAYMENT_SUCCESS_WEBHOOK:9001");
    const failedBody = JSON.stringify({ type: "PAYMENT_FAILED_WEBHOOK", data: { order: { order_id: ORDER }, payment: { cf_payment_id: 9000, payment_status: "FAILED" } } });
    const s2 = fakeStore();
    const r2 = await processPaymentWebhook(adapter, s2.store, failedBody, new Headers({ "x-webhook-timestamp": ts, "x-webhook-signature": sign(ts, failedBody) }));
    assert.deepEqual(r2, { kind: "ignored" });
    assert.equal(httpStatusFor(r2), 200);
    assert.equal(s2.applied.length, 0);
    const s3 = fakeStore();
    assert.deepEqual(await processPaymentWebhook(adapter, s3.store, body, new Headers({ "x-webhook-timestamp": ts, "x-webhook-signature": "AAAA" })), { kind: "invalid_signature" });
    assert.equal(s3.applied.length, 0);
  });
});
