import { verifyBodyHmac } from "./signature";
import type { ClaimedEvent, ConfirmedPayment, PaymentProviderAdapter } from "./provider";

// Phase 5 Step 6: Razorpay (owner ka naya faisla, advertiser payments). Cashfree ne account activate karne se mana kar diya (2026-11-09).
// SIRF TEST MODE. Razorpay ka approval (ad network / prepaid ad credits category) abhi PENDING OWNER CONFIRMATION hai, isliye live keys ko
// code jaanbujhkar reject karta hai: adapter sirf tab banta hai jab RAZORPAY_MODE = "test" ho aur key id "rzp_test_" se shuru ho.
// Razorpay docs se (padhi 2026-11-09, ek bhi sandbox run nahi hua):
//  * webhook signature = hex(HMAC-SHA256(webhook secret, raw body)), header X-Razorpay-Signature. Webhook secret API key secret se ALAG hota hai.
//  * signature me timestamp nahi: replay ki seema nahi. Bachav: har event idempotent hai aur status hum Razorpay API se dobara padhte hain.
//  * amount hamesha sabse chhoti ikai me (USD ke liye cents), positive integer.
//  * order.paid event me order (receipt, id) aur payment dono hote hain. Hamara order create hone par receipt = hamara BPY-... reference (Step 5b me banega).
// Design (Cashfree wale jaisa): provider_payment_id = Razorpay order id (order_...). Sirf "order.paid" se status badalta hai, aur wo bhi tab jab
// Razorpay API me us order ka EXACTLY ek captured payment, poora amount, bina refund dikhe. Baaki events "ignore" (200). Refund / dispute abhi nahi.

const API_BASE = "https://api.razorpay.com/v1";
const REFERENCE_RE = /^BPY-[0-9A-F]{16}$/;
const ORDER_ID_RE = /^order_[A-Za-z0-9]{6,40}$/;
const PAYMENT_ID_RE = /^pay_[A-Za-z0-9]{6,40}$/;
const TEST_KEY_RE = /^rzp_test_[A-Za-z0-9]{6,40}$/;
const FETCH_TIMEOUT_MS = 8000;

type Env = Record<string, string | undefined>;
type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseRazorpayWebhook(rawBody: string): ClaimedEvent | "ignore" | null {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!isRecord(json) || typeof json.event !== "string") return null;
  if (json.event !== "order.paid") return "ignore";
  const payload = json.payload;
  if (!isRecord(payload) || !isRecord(payload.order) || !isRecord(payload.payment)) return null;
  const order = payload.order.entity;
  const payment = payload.payment.entity;
  if (!isRecord(order) || !isRecord(payment)) return null;
  if (typeof order.id !== "string" || !ORDER_ID_RE.test(order.id)) return null;
  if (typeof order.receipt !== "string" || !REFERENCE_RE.test(order.receipt)) return null;
  if (typeof payment.id !== "string" || !PAYMENT_ID_RE.test(payment.id)) return null;
  if (payment.order_id !== order.id || payment.status !== "captured") return null;
  return {
    providerEventId: `order.paid:${payment.id}`,
    eventType: "order.paid",
    internalReference: order.receipt,
    providerPaymentId: order.id,
    claimedStatus: "succeeded",
  };
}

function positiveCents(v: unknown): bigint | null {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0 || v >= 1e11) return null;
  return BigInt(v);
}

/** GET /orders/{id} aur GET /orders/{id}/payments ke jawab se asli sthiti. Koi bhi shak => null (manual jaanch, 503). */
export function confirmFromOrder(orderId: string, order: unknown, payments: unknown): ConfirmedPayment | null {
  if (!isRecord(order) || order.id !== orderId || order.status !== "paid") return null;
  if (typeof order.receipt !== "string" || !REFERENCE_RE.test(order.receipt)) return null;
  if (!isRecord(payments) || !Array.isArray(payments.items) || payments.items.length > 100) return null;
  const captured = payments.items.filter((p) => isRecord(p) && p.status === "captured");
  if (captured.length !== 1) return null;
  const p = captured[0] as Record<string, unknown>;
  if (p.order_id !== orderId) return null;
  if (p.amount_refunded !== undefined && p.amount_refunded !== 0) return null;
  const cents = positiveCents(p.amount);
  const currency = typeof p.currency === "string" ? p.currency : null;
  if (cents === null || currency === null) return null;
  if (order.amount_paid !== p.amount || order.currency !== currency) return null;
  return { providerPaymentId: orderId, status: "succeeded", amountCents: cents, currency, refundedTotalCents: null };
}

export function createRazorpayAdapter(env: Env, fetchImpl?: FetchFn): PaymentProviderAdapter | null {
  if (env.RAZORPAY_MODE !== "test") return null; // live band: owner ke likhit faisle + approval tak
  const keyId = env.RAZORPAY_KEY_ID;
  const keySecret = env.RAZORPAY_KEY_SECRET;
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET;
  if (!keyId || !TEST_KEY_RE.test(keyId)) return null;
  if (!keySecret || keySecret.length < 16) return null;
  if (!webhookSecret || webhookSecret.length < 16 || webhookSecret === keySecret) return null;
  const doFetch: FetchFn = fetchImpl ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchFn>);
  const auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`, "utf8").toString("base64")}`;

  async function getJson(path: string): Promise<unknown | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await doFetch(`${API_BASE}${path}`, { method: "GET", headers: { Authorization: auth }, signal: controller.signal });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    name: "razorpay",
    verifyWebhook(rawBody, headers) {
      return verifyBodyHmac(webhookSecret as string, rawBody, headers.get("x-razorpay-signature"));
    },
    parseEvent: parseRazorpayWebhook,
    async fetchPayment(providerPaymentId) {
      if (!ORDER_ID_RE.test(providerPaymentId)) return null;
      const [order, payments] = await Promise.all([getJson(`/orders/${providerPaymentId}`), getJson(`/orders/${providerPaymentId}/payments`)]);
      if (order === null || payments === null) return null;
      return confirmFromOrder(providerPaymentId, order, payments);
    },
  };
}
