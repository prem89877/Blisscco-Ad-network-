// Phase 5 Step 5: advertiser payment ka USD amount. SIRF integer cents (BigInt): float / Number() se paisa kabhi nahi.
// Database: advertiser_payments.amount numeric(12,2). Yahan wahi niyam: > 0, 2 decimal tak, 10,000,000 se zyada nahi.
// Ye file provider se bilkul alag hai: kisi provider ka naam, URL ya format yahan nahi.

export const PAYMENT_MAX_CENTS = 1_000_000_000n; // 10,000,000.00 USD (SQL: amount <= 10000000)

export type PaymentAmountReason = "empty" | "format" | "too_many_decimals" | "not_positive" | "too_large";
export type PaymentAmountCheck = { ok: true; cents: bigint } | { ok: false; reason: PaymentAmountReason };

/** "12.5" -> 1250n. Sirf plain positive decimal (max 2 decimal). "1e3", "+5", "-1", "1,000", space, "0": sab galat. Chupchap round kabhi nahi. */
export function parsePaymentAmount(raw: string): PaymentAmountCheck {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text.length === 0) return { ok: false, reason: "empty" };
  if (text.length > 20) return { ok: false, reason: "too_large" };
  const m = /^(\d{1,12})(?:\.(\d+))?$/.exec(text);
  if (!m) return { ok: false, reason: "format" };
  const frac = m[2] ?? "";
  if (frac.length > 2) return { ok: false, reason: "too_many_decimals" };
  const cents = BigInt(m[1]) * 100n + BigInt(frac.padEnd(2, "0") || "0");
  if (cents <= 0n) return { ok: false, reason: "not_positive" };
  if (cents > PAYMENT_MAX_CENTS) return { ok: false, reason: "too_large" };
  return { ok: true, cents };
}

/** 1250n -> "12.50". Database ko amount hamesha is 2-decimal TEXT me jaata hai. */
export function formatCents(cents: bigint): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${whole.toString()}.${frac}`;
}

/** Provider / database ke jawab ka amount ("12.50" ya "12.5") -> cents. 2 se zyada non-zero decimal ya galat shape => null (kabhi round nahi). */
export function centsFromDecimalString(raw: unknown): bigint | null {
  if (typeof raw !== "string") return null;
  const m = /^(\d{1,12})(?:\.(\d{1,4}))?$/.exec(raw.trim());
  if (!m) return null;
  const frac = m[2] ?? "";
  if (frac.length > 2 && /[1-9]/.test(frac.slice(2))) return null;
  return BigInt(m[1]) * 100n + BigInt(frac.slice(0, 2).padEnd(2, "0") || "0");
}

const MESSAGES: Record<PaymentAmountReason, string> = {
  empty: "Enter the amount you want to pay.",
  format: "Enter the amount as a plain number, for example 25.00.",
  too_many_decimals: "Use at most 2 decimal places.",
  not_positive: "The amount must be more than zero.",
  too_large: "That amount is too large.",
};

export function paymentAmountMessage(reason: PaymentAmountReason): string {
  return MESSAGES[reason];
}
