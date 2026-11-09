// Phase 5 Step 5: advertiser payment ki status machine. SQL guard_advertiser_payment / payments_apply_verified_event ka TypeScript aaina
// (tests SQL file se milate hain). Kisi provider ka naam yahan nahi: provider ke apne status ek alag adapter me in statuses me badlenge.

export const PAYMENT_STATUSES = [
  "created", "pending", "succeeded", "failed", "cancelled",
  "partially_refunded", "refunded", "disputed", "dispute_won", "dispute_lost",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Provider event se aane wale statuses ("created" kabhi provider se nahi aata). */
export const EVENT_STATUSES = PAYMENT_STATUSES.filter((s) => s !== "created") as readonly PaymentStatus[];
export type EventStatus = Exclude<PaymentStatus, "created">;

export function isPaymentStatus(v: unknown): v is PaymentStatus {
  return typeof v === "string" && (PAYMENT_STATUSES as readonly string[]).includes(v);
}
export function isEventStatus(v: unknown): v is EventStatus {
  return typeof v === "string" && (EVENT_STATUSES as readonly string[]).includes(v);
}

export const PAYMENT_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  created: ["pending", "succeeded", "failed", "cancelled"],
  pending: ["succeeded", "failed", "cancelled"],
  succeeded: ["partially_refunded", "refunded", "disputed"],
  partially_refunded: ["partially_refunded", "refunded", "disputed"],
  disputed: ["dispute_won", "dispute_lost"],
  failed: [],
  cancelled: [],
  refunded: [],
  dispute_won: [],
  dispute_lost: [],
};

export function canPaymentTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}

/** Jis status me paisa sach me mila mana jaata hai (verified_at ke saath). */
export const MONEY_RECEIVED_STATUSES: readonly PaymentStatus[] = ["succeeded", "partially_refunded", "refunded", "disputed", "dispute_won", "dispute_lost"];

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  created: "Created",
  pending: "Waiting for payment confirmation",
  succeeded: "Paid",
  failed: "Failed",
  cancelled: "Cancelled",
  partially_refunded: "Partially refunded",
  refunded: "Refunded",
  disputed: "Under dispute",
  dispute_won: "Dispute resolved in our favour",
  dispute_lost: "Dispute lost (charged back)",
};

export const APPLY_OUTCOMES = [
  "processed", "duplicate_event", "unknown_payment", "provider_mismatch", "reference_mismatch", "currency_mismatch",
  "amount_mismatch", "ignored_invalid_transition", "invalid_refund", "invalid",
] as const;
export type ApplyOutcome = (typeof APPLY_OUTCOMES)[number];

/** Jis natije par payment ki sthiti sach me badli. Baaki sab me kuch nahi badla. */
export function outcomeChangedPayment(o: ApplyOutcome): boolean {
  return o === "processed";
}

/** Duplicate event ya purana (out-of-order) event provider ko "ok" (2xx) jaana chahiye taaki wo retry na kare. Mismatch / invalid ko nahi. */
export function outcomeIsAcknowledged(o: ApplyOutcome): boolean {
  return o === "processed" || o === "duplicate_event" || o === "ignored_invalid_transition" || o === "unknown_payment";
}
