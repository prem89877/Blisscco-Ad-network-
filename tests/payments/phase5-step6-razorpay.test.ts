import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { confirmFromOrder, createRazorpayAdapter, parseRazorpayWebhook } from "@/lib/payments/razorpay";
import { getPaymentProvider } from "@/lib/payments/provider";
import { httpStatusFor, processPaymentWebhook, type ApplyArgs, type PaymentsStore } from "@/lib/payments/process-event";
import { POST as webhookPost } from "@/app/api/payments/webhook/route";

// Phase 5 Step 6: Razorpay adapter (TEST mode only). Nakli fetch / nakli store: koi network, database ya asli key nahi.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const walk = (dir: string, ok: (f: string) => boolean): string[] => {
  const out: string[] = [];
  for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(rel, ok));
    else if (ok(rel)) out.push(rel);
  }
  return out;
};

const KEY_ID = "rzp_test_ABCDEF123456";
const KEY_SECRET = "k".repeat(24);
const WH_SECRET = "w".repeat(24);
const ENV = { PAYMENT_PROVIDER: "razorpay", RAZORPAY_MODE: "test", RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: WH_SECRET };
const REF = "BPY-0123456789ABCDEF";
const ORDER = "order_TestOrder123";
const PAY = "pay_TestPay12345";

const body = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    event: "order.paid",
    payload: {
      order: { entity: { id: ORDER, receipt: REF, status: "paid", currency: "USD", amount_paid: 5000 } },
      payment: { entity: { id: PAY, order_id: ORDER, status: "captured", amount: 5000, currency: "USD" } },
    },
    ...over,
  });
const sign = (raw: string, secret = WH_SECRET) => createHmac("sha256", secret).update(raw, "utf8").digest("hex");
const headersFor = (raw: string, secret = WH_SECRET) => new Headers({ "x-razorpay-signature": sign(raw, secret) });

const orderJson = { id: ORDER, status: "paid", receipt: REF, currency: "USD", amount_paid: 5000 };
const paymentsJson = { items: [{ id: PAY, order_id: ORDER, status: "captured", amount: 5000, currency: "USD", amount_refunded: 0 }] };

function fakeFetch(map: Record<string, unknown | null>) {
  const calls: string[] = [];
  const fn = async (url: string, init: { headers: Record<string, string> }) => {
    calls.push(url);
    assert.match(init.headers.Authorization, /^Basic /);
    const key = url.replace("https://api.razorpay.com/v1", "");
    const v = map[key];
    return { ok: v !== null && v !== undefined, json: async () => v };
  };
  return { fn: fn as unknown as Parameters<typeof createRazorpayAdapter>[1], calls };
}
const okFetch = () => fakeFetch({ [`/orders/${ORDER}`]: orderJson, [`/orders/${ORDER}/payments`]: paymentsJson });

function fakeStore() {
  const applied: ApplyArgs[] = [];
  const store: PaymentsStore = { async applyVerifiedEvent(a) { applied.push(a); return { outcome: "processed" }; } };
  return { store, applied };
}

describe("phase 5 step 6 | razorpay adapter exists only for TEST mode with complete config", () => {
  it("is null for missing, live, malformed or reused secrets", () => {
    assert.equal(createRazorpayAdapter({}), null);
    assert.equal(createRazorpayAdapter({ ...ENV, RAZORPAY_MODE: "live" }), null);
    assert.equal(createRazorpayAdapter({ ...ENV, RAZORPAY_MODE: undefined }), null);
    assert.equal(createRazorpayAdapter({ ...ENV, RAZORPAY_KEY_ID: "rzp_" + "live_ABCDEF123456" }), null);
    assert.equal(createRazorpayAdapter({ ...ENV, RAZORPAY_KEY_ID: "ABCDEF123456" }), null);
    assert.equal(createRazorpayAdapter({ ...ENV, RAZORPAY_KEY_SECRET: "short" }), null);
    assert.equal(createRazorpayAdapter({ ...ENV, RAZORPAY_WEBHOOK_SECRET: "short" }), null);
    assert.equal(createRazorpayAdapter({ ...ENV, RAZORPAY_WEBHOOK_SECRET: KEY_SECRET }), null);
  });
  it("registry returns it only with PAYMENT_PROVIDER=razorpay and complete test config", () => {
    assert.equal(getPaymentProvider(ENV)?.name, "razorpay");
    assert.equal(getPaymentProvider({ ...ENV, PAYMENT_PROVIDER: "" }), null);
    assert.equal(getPaymentProvider({ ...ENV, RAZORPAY_MODE: "live" }), null);
  });
});

describe("phase 5 step 6 | razorpay webhook signature and parsing", () => {
  const adapter = createRazorpayAdapter(ENV)!;
  it("accepts only the hex HMAC of the raw body made with the webhook secret", () => {
    const raw = body();
    assert.equal(adapter.verifyWebhook(raw, headersFor(raw)), true);
    assert.equal(adapter.verifyWebhook(raw, headersFor(raw, KEY_SECRET)), false); // API key secret is not the webhook secret
    assert.equal(adapter.verifyWebhook(raw + " ", headersFor(raw)), false);
    assert.equal(adapter.verifyWebhook(raw, new Headers()), false);
    assert.equal(adapter.verifyWebhook(raw, new Headers({ "x-razorpay-signature": "zz" })), false);
  });
  it("parses order.paid into a claim; other events are ignored; bad shapes are null", () => {
    assert.deepEqual(parseRazorpayWebhook(body()), {
      providerEventId: `order.paid:${PAY}`, eventType: "order.paid", internalReference: REF, providerPaymentId: ORDER, claimedStatus: "succeeded",
    });
    assert.equal(parseRazorpayWebhook(JSON.stringify({ event: "payment.failed" })), "ignore");
    assert.equal(parseRazorpayWebhook(JSON.stringify({ event: "refund.processed" })), "ignore");
    assert.equal(parseRazorpayWebhook("not json"), null);
    assert.equal(parseRazorpayWebhook("{}"), null);
    assert.equal(parseRazorpayWebhook(body({ payload: { order: { entity: { id: ORDER, receipt: "BAD" } }, payment: { entity: { id: PAY, order_id: ORDER, status: "captured" } } } })), null);
    assert.equal(parseRazorpayWebhook(body({ payload: { order: { entity: { id: ORDER, receipt: REF } }, payment: { entity: { id: PAY, order_id: ORDER, status: "authorized" } } } })), null);
    assert.equal(parseRazorpayWebhook(body({ payload: { order: { entity: { id: ORDER, receipt: REF } }, payment: { entity: { id: PAY, order_id: "order_Other123456", status: "captured" } } } })), null);
  });
});

describe("phase 5 step 6 | provider API re-read decides the truth", () => {
  it("confirms exactly one captured payment with the full amount", () => {
    assert.deepEqual(confirmFromOrder(ORDER, orderJson, paymentsJson), { providerPaymentId: ORDER, status: "succeeded", amountCents: 5000n, currency: "USD", refundedTotalCents: null });
  });
  it("refuses every doubtful shape", () => {
    const item = paymentsJson.items[0];
    assert.equal(confirmFromOrder(ORDER, { ...orderJson, status: "attempted" }, paymentsJson), null);
    assert.equal(confirmFromOrder(ORDER, { ...orderJson, receipt: "x" }, paymentsJson), null);
    assert.equal(confirmFromOrder(ORDER, { ...orderJson, id: "order_Other123456" }, paymentsJson), null);
    assert.equal(confirmFromOrder(ORDER, orderJson, { items: [] }), null);
    assert.equal(confirmFromOrder(ORDER, orderJson, { items: [item, { ...item, id: "pay_Second12345" }] }), null);
    assert.equal(confirmFromOrder(ORDER, orderJson, { items: [{ ...item, amount_refunded: 100 }] }), null);
    assert.equal(confirmFromOrder(ORDER, orderJson, { items: [{ ...item, amount: 50.5 }] }), null);
    assert.equal(confirmFromOrder(ORDER, orderJson, { items: [{ ...item, currency: "INR" }] }), null);
    assert.equal(confirmFromOrder(ORDER, { ...orderJson, amount_paid: 4000 }, paymentsJson), null);
    assert.equal(confirmFromOrder(ORDER, orderJson, null), null);
    assert.equal(confirmFromOrder(ORDER, orderJson, { items: new Array(101).fill(item) }), null);
  });
  it("fetchPayment reads both endpoints with Basic auth and fails to null on any error", async () => {
    const f = okFetch();
    const adapter = createRazorpayAdapter(ENV, f.fn)!;
    assert.equal((await adapter.fetchPayment(ORDER))?.amountCents, 5000n);
    assert.deepEqual(f.calls.sort(), [`https://api.razorpay.com/v1/orders/${ORDER}`, `https://api.razorpay.com/v1/orders/${ORDER}/payments`]);
    assert.equal(await adapter.fetchPayment("../etc/passwd"), null);
    const bad = createRazorpayAdapter(ENV, fakeFetch({ [`/orders/${ORDER}`]: null, [`/orders/${ORDER}/payments`]: paymentsJson }).fn)!;
    assert.equal(await bad.fetchPayment(ORDER), null);
    const boom = createRazorpayAdapter(ENV, (async () => { throw new Error("net"); }) as unknown as Parameters<typeof createRazorpayAdapter>[1])!;
    assert.equal(await boom.fetchPayment(ORDER), null);
  });
});

describe("phase 5 step 6 | end to end with fakes", () => {
  it("valid signed order.paid writes exactly one verified event with provider-read values", async () => {
    const adapter = createRazorpayAdapter(ENV, okFetch().fn)!;
    const { store, applied } = fakeStore();
    const raw = body();
    const r = await processPaymentWebhook(adapter, store, raw, headersFor(raw));
    assert.deepEqual(r, { kind: "applied", outcome: "processed" });
    assert.equal(httpStatusFor(r), 200);
    assert.equal(applied.length, 1);
    assert.equal(applied[0].provider, "razorpay");
    assert.equal(applied[0].amount, "50.00");
    assert.equal(applied[0].currency, "USD");
    assert.equal(applied[0].internalReference, REF);
    assert.equal(applied[0].providerPaymentId, ORDER);
  });
  it("bad signature, ignored event, provider outage and mismatching claim write nothing", async () => {
    const { store, applied } = fakeStore();
    const raw = body();
    assert.equal((await processPaymentWebhook(createRazorpayAdapter(ENV, okFetch().fn)!, store, raw, headersFor(raw, "x".repeat(24)))).kind, "invalid_signature");
    const ign = JSON.stringify({ event: "payment.failed" });
    assert.equal((await processPaymentWebhook(createRazorpayAdapter(ENV, okFetch().fn)!, store, ign, headersFor(ign))).kind, "ignored");
    const down = createRazorpayAdapter(ENV, fakeFetch({}).fn)!;
    assert.equal((await processPaymentWebhook(down, store, raw, headersFor(raw))).kind, "provider_unavailable");
    assert.equal(applied.length, 0);
  });
});

describe("phase 5 step 6 | route and code hygiene", () => {
  it("webhook route stays 503 not_configured without provider config (no env in tests)", async () => {
    const res = await webhookPost(new Request("http://localhost/api/payments/webhook", { method: "POST", body: "{}" }));
    assert.equal(res.status, 503);
  });
  it("razorpay env names are read only in razorpay.ts and never public or in client files", () => {
    const users = walk("lib", (f) => f.endsWith(".ts")).concat(walk("app", (f) => /\.tsx?$/.test(f))).filter((f) => /RAZORPAY_/.test(read(f).replace(/\/\/[^\n]*/g, "")));
    assert.deepEqual(users.sort(), ["lib/payments/razorpay.ts"]);
    assert.equal(/NEXT_PUBLIC_RAZORPAY/.test(read(".env.example")), false);
    for (const f of walk("components", (x) => /\.tsx?$/.test(x)).concat(walk("app", (x) => /\.tsx$/.test(x)))) assert.equal(/RAZORPAY_|lib\/payments\/razorpay/.test(read(f)), false, f);
  });
  it(".env.example documents razorpay names only as comments", () => {
    assert.deepEqual(read(".env.example").split("\n").filter((l) => /^RAZORPAY_/.test(l)), []);
  });
  it("code has no live-key format, no secret logging, and server code never logs bodies", () => {
    const src = read("lib/payments/razorpay.ts").replace(/\/\/[^\n]*/g, "");
    assert.equal(/rzp_live/.test(src), false);
    assert.equal(/console\./.test(src), false);
  });
});
