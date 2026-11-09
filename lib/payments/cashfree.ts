import { verifyBase64TimestampHmac } from "./signature";
import { centsFromDecimalString } from "./money";
import type { ClaimedEvent, ConfirmedPayment, PaymentProviderAdapter } from "./provider";

// Phase 5 Step 5: Cashfree (owner ka chuna provider, advertiser payments). SIRF SANDBOX.
// Cashfree docs se (padhi 2026-11): webhook headers x-webhook-signature / x-webhook-timestamp; signature = base64(HMAC-SHA256(client secret, timestamp + rawBody));
// payload type PAYMENT_SUCCESS_WEBHOOK / PAYMENT_FAILED_WEBHOOK, data.order.order_id, data.payment.cf_payment_id / payment_status;
// payments fetch GET {base}/orders/{order_id}/payments (headers x-api-version, x-client-id, x-client-secret); USD order currency (2 decimals, minimum 0.10) supported,
// settlement INR (T+2). Ye sab abhi KISI ASLI SANDBOX ACCOUNT PAR TEST NAHI hua: pehla sandbox run baaki hai.
//
// Design:
//  * Hamara order_id = hamara internal reference (BPY-XXXXXXXXXXXXXXXX). provider_payment_id = wahi Cashfree order_id (ek order me kai payment attempts ho sakte hain,
//    isliye attempt id (cf_payment_id) ko payment ki pehchan nahi banaya: warna ek failed attempt ke baad safal attempt galat reject hota).
//  * Sirf PAYMENT_SUCCESS_WEBHOOK se status badalta hai, aur wo bhi tab jab Cashfree API me us order ka EXACTLY ek SUCCESS attempt dikhe.
//  * PAYMENT_FAILED / USER_DROPPED / refund / dispute webhooks abhi "ignore" (200): failed attempt ke baad customer dobara try kar sakta hai, isliye payment pending rehti hai
//    (order expire hone par admin use cancel kare). Refund / dispute ka payload sandbox me dekh kar adapter me jodna baaki (database ye status already sambhalta hai).
//  * Production kabhi nahi: CASHFREE_ENV sirf "sandbox" ho tabhi adapter banta hai. Production ke liye alag, owner-approved code change chahiye.

const SANDBOX_BASE = "https://sandbox.cashfree.com/pg";
const API_VERSION = "2025-01-01";
const ORDER_ID_RE = /^BPY-[0-9A-F]{16}$/;
const FETCH_TIMEOUT_MS = 8000;

type Env = Record<string, string | undefined>;
type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function idString(v: unknown): string | null {
  if (typeof v === "number" && Number.isSafeInteger(v) && v > 0) return String(v);
  if (typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v)) return v;
  return null;
}

/** Cashfree amount JSON number / string -> cents, ya null (2 se zyada decimal, galat shape). */
function amountToCents(v: unknown): bigint | null {
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v <= 0 || v >= 1e9) return null;
    return centsFromDecimalString(String(v).includes("e") ? "x" : String(v));
  }
  return centsFromDecimalString(v);
}

export function parseCashfreeWebhook(rawBody: string): ClaimedEvent | "ignore" | null {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!isRecord(json) || typeof json.type !== "string") return null;
  if (json.type !== "PAYMENT_SUCCESS_WEBHOOK") return "ignore";
  const data = json.data;
  if (!isRecord(data) || !isRecord(data.order) || !isRecord(data.payment)) return null;
  const orderId = data.order.order_id;
  const attemptId = idString(data.payment.cf_payment_id);
  if (typeof orderId !== "string" || !ORDER_ID_RE.test(orderId) || !attemptId) return null;
  if (data.payment.payment_status !== "SUCCESS") return null;
  return {
    providerEventId: `${json.type}:${attemptId}`,
    eventType: json.type,
    internalReference: orderId,
    providerPaymentId: orderId,
    claimedStatus: "succeeded",
  };
}

/** GET /orders/{id}/payments ke jawab se asli sthiti. Exactly ek SUCCESS attempt => succeeded. Zero ya zyada => null (manual jaanch, 503). */
export function confirmFromAttempts(orderId: string, attempts: unknown): ConfirmedPayment | null {
  if (!Array.isArray(attempts) || attempts.length > 100) return null;
  const successes = attempts.filter((a) => isRecord(a) && a.payment_status === "SUCCESS");
  if (successes.length !== 1) return null;
  const a = successes[0] as Record<string, unknown>;
  if (a.order_id !== orderId) return null;
  const cents = amountToCents(a.payment_amount);
  const currency = typeof a.payment_currency === "string" ? a.payment_currency : null;
  if (cents === null || currency === null) return null;
  return { providerPaymentId: orderId, status: "succeeded", amountCents: cents, currency, refundedTotalCents: null };
}

export function createCashfreeAdapter(env: Env, fetchImpl?: FetchFn): PaymentProviderAdapter | null {
  if (env.CASHFREE_ENV !== "sandbox") return null; // production band: sirf sandbox
  const clientId = env.CASHFREE_CLIENT_ID;
  const clientSecret = env.CASHFREE_CLIENT_SECRET;
  if (!clientId || !clientSecret || clientSecret.length < 16) return null;
  const doFetch: FetchFn = fetchImpl ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchFn>);

  return {
    name: "cashfree",
    verifyWebhook(rawBody, headers) {
      return verifyBase64TimestampHmac(clientSecret, rawBody, headers.get("x-webhook-timestamp"), headers.get("x-webhook-signature"));
    },
    parseEvent: parseCashfreeWebhook,
    async fetchPayment(providerPaymentId) {
      if (!ORDER_ID_RE.test(providerPaymentId)) return null;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await doFetch(`${SANDBOX_BASE}/orders/${providerPaymentId}/payments`, {
          method: "GET",
          headers: { "x-api-version": API_VERSION, "x-client-id": clientId, "x-client-secret": clientSecret },
          signal: controller.signal,
        });
        if (!res.ok) return null;
        return confirmFromAttempts(providerPaymentId, await res.json());
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
