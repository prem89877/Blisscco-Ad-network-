import type { EventStatus } from "./status";
import { createCashfreeAdapter } from "./cashfree";
import { createRazorpayAdapter } from "./razorpay";

// Phase 5 Step 5: payment provider ka SANDHI (interface). Koi concrete provider nahi: owner ne abhi koi provider approve nahi kiya
// (PENDING OWNER DECISION). Jab tak PAYMENT_PROVIDER env set na ho aur uska adapter na likha jaye, getPaymentProvider() null deta hai
// aur har payment route fail-closed rehta hai (503, kuch likhta nahi).

/** Provider ke webhook se nikla, abhi UNTRUSTED (signature verify ho chuka, par status provider API se confirm hona baaki). */
export type ClaimedEvent = {
  providerEventId: string;
  eventType: string;
  internalReference: string; // hamara BPY-... (provider ke metadata / receipt me hum ne bheja tha)
  providerPaymentId: string | null;
  claimedStatus: EventStatus;
};

/** Provider API se server-side dobara padha SACH (yahi database me jaata hai; webhook ka dava nahi). */
export type ConfirmedPayment = {
  providerPaymentId: string;
  status: EventStatus;
  amountCents: bigint;
  currency: string;
  refundedTotalCents: bigint | null;
};

export interface PaymentProviderAdapter {
  /** Provider ka chhota label (a-z0-9_), database me advertiser_payments.provider. */
  readonly name: string;
  /** Raw body + headers par signature. false => 400, kuch nahi likha jaata. Secret kabhi return / log nahi. */
  verifyWebhook(rawBody: string, headers: Headers): boolean;
  /** Verified body ko ClaimedEvent me. Galat shape => null (400). Aisa event jise hum jaanbujhkar nahi sambhalte (jaise dusre type) => "ignore" (200, kuch nahi likha). */
  parseEvent(rawBody: string): ClaimedEvent | "ignore" | null;
  /** Provider ke trusted API se payment ka asli status (browser / webhook ke dave par bharosa nahi). Fail => null. */
  fetchPayment(providerPaymentId: string): Promise<ConfirmedPayment | null>;
}

const NAME_RE = /^[a-z][a-z0-9_]{1,31}$/;

export function isValidProviderName(v: unknown): v is string {
  return typeof v === "string" && NAME_RE.test(v);
}

/**
 * Registry. PAYMENT_PROVIDER set na ho / anjaan ho / adapter ki sandbox config poori na ho => null => payment routes fail-closed (503).
 */
const REGISTRY: Readonly<Record<string, (env: Record<string, string | undefined>) => PaymentProviderAdapter | null>> = {
  // Owner ka faisla (2026-11-09): advertiser payments ke liye Cashfree. Sirf SANDBOX: createCashfreeAdapter production env par null deta hai.
  cashfree: createCashfreeAdapter, // 2026-11-09: Cashfree ne International Payment Gateway activate nahi kiya (BLOCKED). Code purani jaankari ke liye rakha hai.
  // Owner ka naya faisla (2026-11-09): Razorpay. Sirf TEST mode (key rzp_test_...). Approval PENDING OWNER CONFIRMATION.
  razorpay: createRazorpayAdapter,
};

export function getPaymentProvider(env: Record<string, string | undefined> = process.env): PaymentProviderAdapter | null {
  const name = env.PAYMENT_PROVIDER;
  if (!isValidProviderName(name)) return null;
  const make = Object.prototype.hasOwnProperty.call(REGISTRY, name) ? REGISTRY[name] : undefined;
  return make ? make(env) : null;
}
