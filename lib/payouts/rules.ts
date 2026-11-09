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

// ---------------------------------------------------------------------------
// Phase 5 Step 5: settlement (bahar ka anjaam) + limits. SQL: phase5-step5-1-commercial-payments.sql. Purane niyam upar jaise ke taise.
// ---------------------------------------------------------------------------

export const SETTLEMENT_STATUSES = ["failed", "completed", "reversed"] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export function isSettlementStatus(v: unknown): v is SettlementStatus {
  return typeof v === "string" && (SETTLEMENT_STATUSES as readonly string[]).includes(v);
}

/** SQL payout_settlements: external_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{5,99}$'. Bank / card / UPI detail yahan nahi: sirf bahar ke transfer ka reference. */
export const EXTERNAL_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{5,99}$/;
export const PAYOUT_REFERENCE_PATTERN = /^BPO-[0-9A-F]{16}$/;

export type ExternalReferenceCheck = { ok: true; value: string } | { ok: false; message: string };

export function parseExternalReference(raw: string): ExternalReferenceCheck {
  const value = (typeof raw === "string" ? raw : "").trim();
  if (value.length === 0) return { ok: false, message: "Enter the payment reference of the transfer you sent (for example the transfer id)." };
  if (!EXTERNAL_REFERENCE_PATTERN.test(value)) {
    return { ok: false, message: "Use 6 to 100 letters, numbers or . _ : / - for the reference. Do not enter bank, card or UPI details." };
  }
  return { ok: true, value };
}

/** Database trigger ke hint (error.hint) -> publisher ko saaf message. Maujooda request_my_payout ko nahi badla: trigger error deta hai, ye use samjhata hai. */
export const LIMIT_HINT_MESSAGES: Readonly<Record<string, string>> = {
  payout_below_minimum: "That is below the minimum payout amount. Request a larger amount.",
  payout_above_maximum: "That is above the maximum amount for one payout. Request a smaller amount.",
  payout_monthly_limit: "Only one payout can be requested per month. Please try again next month.",
};

export function limitHintMessage(hint: unknown): string | null {
  if (typeof hint !== "string") return null;
  return Object.prototype.hasOwnProperty.call(LIMIT_HINT_MESSAGES, hint) ? LIMIT_HINT_MESSAGES[hint] : null;
}

export const SETTLEMENT_OUTCOMES = ["paid", "recorded", "reversed", "forbidden", "invalid", "not_found", "invalid_transition", "payouts_disabled", "reference_in_use", "not_eligible", "insufficient", "ledger_rejected"] as const;
export type SettlementOutcome = (typeof SETTLEMENT_OUTCOMES)[number];

export const SETTLEMENT_SUCCESS = new Set<SettlementOutcome>(["paid", "recorded", "reversed"]);

export const SETTLEMENT_OUTCOME_MESSAGES: Record<SettlementOutcome, string> = {
  paid: "Recorded as paid with your payment reference. Blisscco did not send any money.",
  recorded: "Failure recorded. The request stays approved: try again or reject it to release the balance.",
  reversed: "Payout reversed. The amount is available to the publisher again (a ledger adjustment was added).",
  forbidden: "Only an admin can do this.",
  invalid: "That was not understood. Check the reference or reason and try again.",
  not_found: "That payout request no longer exists. Refresh the page.",
  invalid_transition: "This request is not in the right state for that action. Refresh the page.",
  payouts_disabled: "Payouts are switched off (payout_settings.payouts_enabled is false). Nothing was recorded.",
  reference_in_use: "That payment reference was already used for another payout.",
  not_eligible: "The publisher's account is not active, so this cannot be paid. Reject it instead.",
  insufficient: "The publisher's ledger balance no longer covers this request. Reject it instead.",
  ledger_rejected: "The ledger refused the adjustment, so nothing was changed.",
};

export function parseSettlementOutcome(data: unknown): SettlementOutcome | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const o = (data as Record<string, unknown>).outcome;
  return typeof o === "string" && (SETTLEMENT_OUTCOMES as readonly string[]).includes(o) ? (o as SettlementOutcome) : null;
}

export const SETTLEMENT_ACTIONS = ["complete", "fail", "reverse"] as const;
export type SettlementAction = (typeof SETTLEMENT_ACTIONS)[number];

export function isSettlementAction(v: unknown): v is SettlementAction {
  return typeof v === "string" && (SETTLEMENT_ACTIONS as readonly string[]).includes(v);
}

/** Admin ko is request par kaun si settlement actions dikhani hain (UI hint; asli rok database). */
export function settlementActionsFor(status: PayoutStatus, settlement: SettlementStatus | null): SettlementAction[] {
  if (status === "approved") return ["complete", "fail"];
  if (status === "paid" && settlement === "completed") return ["reverse"];
  return [];
}
