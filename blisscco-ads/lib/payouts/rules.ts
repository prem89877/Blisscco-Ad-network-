import { parseMoney } from "@/lib/ledger/decimal";

// Day 13 Part 4: manual publisher payout ke PURE niyam (database / env / network nahi). Server actions, UI aur tests yahi use karte hain.
//
// Asli rok DATABASE me hai (day-13-9: guard trigger, partial unique index, row lock, is_admin check). Ye file sirf
//   (a) form ki friendly pehli jaanch, (b) database ke jawab ko user ke message me badalna, (c) niyamon ka TypeScript aaina (tests inhe SQL se milate hain).
//
// KYA NAHI: koi minimum payout amount (repo me koi niyam define nahi hai, isliye invent nahi kiya), koi fee, koi payment provider, koi bank / card / UPI detail.
// "paid" ka matlab sirf: admin ne paisa BAHAR se manually bhej diya aur yahan record kiya.

export const PAYOUT_STATUSES = ["requested", "approved", "rejected", "paid"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export function isPayoutStatus(v: unknown): v is PayoutStatus {
  return typeof v === "string" && (PAYOUT_STATUSES as readonly string[]).includes(v);
}

/** Khule (abhi tak final nahi) statuses: ek publisher ka sirf ek hi ho sakta hai. */
export const OPEN_PAYOUT_STATUSES: readonly PayoutStatus[] = ["requested", "approved"];

/** SQL guard_payout_request ka aaina: kaun se status se kahan jaa sakte hain. paid / rejected aakhri hain. */
export const PAYOUT_TRANSITIONS: Readonly<Record<PayoutStatus, readonly PayoutStatus[]>> = {
  requested: ["approved", "rejected"],
  approved: ["paid", "rejected"],
  rejected: [],
  paid: [],
};

export function canTransition(from: PayoutStatus, to: PayoutStatus): boolean {
  return PAYOUT_TRANSITIONS[from].includes(to);
}

export function isOpenStatus(s: PayoutStatus): boolean {
  return OPEN_PAYOUT_STATUSES.includes(s);
}

export const PAYOUT_STATUS_LABEL: Record<PayoutStatus, string> = {
  requested: "Requested",
  approved: "Approved",
  rejected: "Rejected",
  paid: "Paid",
};

/** Publisher ko har status ka seedha matlab (paid = admin ne manually bhej diya, koi automatic transfer nahi). */
export const PAYOUT_STATUS_HELP: Record<PayoutStatus, string> = {
  requested: "Waiting for the Blisscco team to review.",
  approved: "Approved. The team will send the money manually; it is not paid yet.",
  rejected: "Not approved. The amount is available to request again.",
  paid: "The team marked this as sent manually.",
};

/**
 * available = ledger balance - (requested + approved) - paid.  SQL private.publisher_payout_position ka aaina.
 * Kabhi negative nahi dikhate (negative adjustment ke baad balance request se kam ho sakta hai): 0 se neeche nahi.
 */
export function availableUnits(ledgerBalance: bigint, reserved: bigint, paid: bigint): bigint {
  const v = ledgerBalance - reserved - paid;
  return v > 0n ? v : 0n;
}

export type AmountReason = "empty" | "format" | "too_many_decimals" | "too_large" | "not_positive";
export type AmountCheck = { ok: true; units: bigint } | { ok: false; reason: AmountReason };

/**
 * Form ka amount text -> exact units (1 unit = 0.0001 USD). Float / Number() kahin nahi.
 * Sirf plain positive decimal, 4 decimal tak. 0, negative, "1e3", "+5", comma, space: sab galat.
 */
export function parsePayoutAmount(raw: string): AmountCheck {
  const text = typeof raw === "string" ? raw.trim() : "";
  const p = parseMoney(text);
  if (!p.ok) return { ok: false, reason: p.reason };
  if (p.units <= 0n) return { ok: false, reason: "not_positive" };
  return { ok: true, units: p.units };
}

const AMOUNT_MESSAGES: Record<AmountReason, string> = {
  empty: "Enter the amount you want to request.",
  format: "Enter the amount as a plain number, for example 12.50.",
  too_many_decimals: "Use at most 4 decimal places.",
  too_large: "That amount is too large.",
  not_positive: "The amount must be more than zero.",
};

export function amountErrorMessage(reason: AmountReason): string {
  return AMOUNT_MESSAGES[reason];
}

// ---------------------------------------------------------------------------
// Database ke jawab (jsonb {outcome: ...}) -> user ke message. Raw jawab kabhi nahi dikhate.
// ---------------------------------------------------------------------------

export const REQUEST_OUTCOMES = ["requested", "duplicate", "forbidden", "not_eligible", "invalid", "conflict", "open_request_exists", "insufficient"] as const;
export type RequestOutcome = (typeof REQUEST_OUTCOMES)[number];

export const REVIEW_OUTCOMES = ["approved", "rejected", "paid", "forbidden", "invalid", "not_found", "invalid_transition", "not_eligible", "insufficient"] as const;
export type ReviewOutcome = (typeof REVIEW_OUTCOMES)[number];

function outcomeOf(data: unknown): string | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const o = (data as Record<string, unknown>).outcome;
  return typeof o === "string" ? o : null;
}

export function parseRequestOutcome(data: unknown): { outcome: RequestOutcome; available: string | null } | null {
  const o = outcomeOf(data);
  if (o === null || !(REQUEST_OUTCOMES as readonly string[]).includes(o)) return null;
  const avail = (data as Record<string, unknown>).available;
  return { outcome: o as RequestOutcome, available: typeof avail === "string" ? avail : null };
}

export function parseReviewOutcome(data: unknown): { outcome: ReviewOutcome; status: PayoutStatus | null } | null {
  const o = outcomeOf(data);
  if (o === null || !(REVIEW_OUTCOMES as readonly string[]).includes(o)) return null;
  const st = (data as Record<string, unknown>).status;
  return { outcome: o as ReviewOutcome, status: isPayoutStatus(st) ? st : null };
}

export const REQUEST_SUCCESS = new Set<RequestOutcome>(["requested", "duplicate"]);

export const REQUEST_OUTCOME_MESSAGES: Record<RequestOutcome, string> = {
  requested: "Payout requested. The Blisscco team will review it.",
  duplicate: "This payout request was already received.",
  forbidden: "Only a publisher account can request a payout.",
  not_eligible: "Your publisher account is not active, so a payout cannot be requested.",
  invalid: "That amount cannot be requested. Check the amount and try again.",
  conflict: "This form was already used with a different amount. Please reload the page and try again.",
  open_request_exists: "You already have a payout request in progress. Wait until it is paid or rejected.",
  insufficient: "That is more than your available earnings.",
};

export function requestOutcomeMessage(r: { outcome: RequestOutcome; available: string | null }): string {
  if (r.outcome === "insufficient" && r.available !== null && /^\d{1,16}\.\d{4}$/.test(r.available)) {
    return `That is more than your available earnings (${r.available} USD).`;
  }
  return REQUEST_OUTCOME_MESSAGES[r.outcome];
}

export const REVIEW_SUCCESS = new Set<ReviewOutcome>(["approved", "rejected", "paid"]);

export const REVIEW_OUTCOME_MESSAGES: Record<ReviewOutcome, string> = {
  approved: "Approved. The payout still has to be sent manually and then marked as paid.",
  rejected: "Rejected.",
  paid: "Marked as paid. Blisscco did not send any money; you recorded that you sent it manually.",
  forbidden: "Only an admin can do this.",
  invalid: "That request was not understood. Rejecting needs a reason of 3 to 500 characters.",
  not_found: "That payout request no longer exists. Refresh the page.",
  invalid_transition: "This request is no longer in the right state for that action. Refresh the page.",
  not_eligible: "The publisher's account is not active, so this cannot be approved or paid. Reject it instead.",
  insufficient: "The publisher's ledger balance no longer covers this request (for example after a reversal). Reject it instead.",
};

// ---------------------------------------------------------------------------
// Admin ka form: action + reason
// ---------------------------------------------------------------------------

export const ADMIN_PAYOUT_ACTIONS = ["approve", "reject", "paid"] as const;
export type AdminPayoutAction = (typeof ADMIN_PAYOUT_ACTIONS)[number];

export function isAdminPayoutAction(v: unknown): v is AdminPayoutAction {
  return typeof v === "string" && (ADMIN_PAYOUT_ACTIONS as readonly string[]).includes(v);
}

/** Admin ko is status par kaun si actions dikhani hain (sirf UI ka hint: asli rok database ka guard hai). */
export function adminActionsFor(status: PayoutStatus): AdminPayoutAction[] {
  if (status === "requested") return ["approve", "reject"];
  if (status === "approved") return ["paid", "reject"];
  return [];
}

export const PAYOUT_REASON_MIN = 3;
export const PAYOUT_REASON_MAX = 500;

export type ReasonCheck = { ok: true; value: string } | { ok: false; message: string };

export function parsePayoutReason(raw: string): ReasonCheck {
  const value = (typeof raw === "string" ? raw : "").replace(/\s+/g, " ").trim();
  if (value.length < PAYOUT_REASON_MIN) return { ok: false, message: "Write a short reason (at least 3 characters) so the publisher knows why." };
  if (value.length > PAYOUT_REASON_MAX) return { ok: false, message: `Use at most ${PAYOUT_REASON_MAX} characters for the reason.` };
  return { ok: true, value };
}
