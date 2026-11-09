import { sha256Hex } from "./signature";
import type { ClaimedEvent, ConfirmedPayment, PaymentProviderAdapter } from "./provider";
import { APPLY_OUTCOMES, isEventStatus, type ApplyOutcome } from "./status";
import { formatCents } from "./money";

// Phase 5 Step 5: webhook ka asli kaam, provider-neutral. Har dependency (database, provider) bahar se aati hai, isliye mocks se test hota hai
// aur yahan koi network / env nahi.
//
// Kram (har kadam fail => kuch nahi likha jaata):
//   1. signature galat            -> "invalid_signature" (400). Database ko chhoota bhi nahi.
//   2. body samajh nahi aayi      -> "invalid_payload" (400).
//   3. provider API se status     -> "provider_unavailable" (503: provider baad me retry karega) ya "not_found".
//   4. webhook ka dava != provider API ka sach (status / id) -> "status_mismatch" (409). Kuch nahi likha.
//   5. database function (idempotent, amount / currency / reference / transition khud jaanchti hai).
// Browser ki "payment success" se kuch nahi hota: koi aisa entry point hai hi nahi.

export type ApplyArgs = {
  provider: string;
  providerEventId: string;
  eventType: string;
  internalReference: string;
  providerPaymentId: string;
  newStatus: ConfirmedPayment["status"];
  amount: string; // "12.50"
  currency: string;
  refundedTotal: string | null;
  payloadSha256: string;
};

export type PaymentsStore = {
  applyVerifiedEvent(args: ApplyArgs): Promise<{ outcome: ApplyOutcome } | null>;
};

export type ProcessResult =
  | { kind: "invalid_signature" }
  | { kind: "invalid_payload" }
  | { kind: "ignored" }
  | { kind: "provider_unavailable" }
  | { kind: "status_mismatch" }
  | { kind: "store_unavailable" }
  | { kind: "applied"; outcome: ApplyOutcome };

export function httpStatusFor(r: ProcessResult): number {
  switch (r.kind) {
    case "invalid_signature":
    case "invalid_payload":
      return 400;
    case "status_mismatch":
      return 409;
    case "provider_unavailable":
    case "store_unavailable":
      return 503;
    case "ignored":
      return 200; // jaanbujhkar na sambhala jaane wala event: provider retry na kare
    case "applied":
      // processed / duplicate / purana event => 200 (provider retry band). Mismatch / invalid => 422 (retry se kuch nahi badlega, par dikhna chahiye).
      return r.outcome === "processed" || r.outcome === "duplicate_event" || r.outcome === "ignored_invalid_transition" || r.outcome === "unknown_payment" ? 200 : 422;
  }
}

export function isApplyOutcome(v: unknown): v is ApplyOutcome {
  return typeof v === "string" && (APPLY_OUTCOMES as readonly string[]).includes(v);
}

function claimMatchesConfirmed(claim: ClaimedEvent, confirmed: ConfirmedPayment): boolean {
  if (!isEventStatus(claim.claimedStatus)) return false;
  if (claim.claimedStatus !== confirmed.status) return false;
  if (claim.providerPaymentId !== null && claim.providerPaymentId !== confirmed.providerPaymentId) return false;
  return true;
}

export async function processPaymentWebhook(
  provider: PaymentProviderAdapter,
  store: PaymentsStore,
  rawBody: string,
  headers: Headers
): Promise<ProcessResult> {
  if (!provider.verifyWebhook(rawBody, headers)) return { kind: "invalid_signature" };

  const claim = provider.parseEvent(rawBody);
  if (claim === "ignore") return { kind: "ignored" };
  if (!claim || !/^BPY-[0-9A-F]{16}$/.test(claim.internalReference) || claim.providerEventId.length === 0 || claim.providerEventId.length > 200) {
    return { kind: "invalid_payload" };
  }

  // Webhook sirf ek ISHARA hai. Asli status provider ke trusted API se server par dobara padhte hain.
  const lookupId = claim.providerPaymentId;
  if (lookupId === null) return { kind: "invalid_payload" };
  const confirmed = await provider.fetchPayment(lookupId).catch(() => null);
  if (!confirmed) return { kind: "provider_unavailable" };
  if (!claimMatchesConfirmed(claim, confirmed)) return { kind: "status_mismatch" };

  const applied = await store
    .applyVerifiedEvent({
      provider: provider.name,
      providerEventId: claim.providerEventId,
      eventType: claim.eventType.slice(0, 100),
      internalReference: claim.internalReference,
      providerPaymentId: confirmed.providerPaymentId,
      newStatus: confirmed.status,
      amount: formatCents(confirmed.amountCents),
      currency: confirmed.currency,
      refundedTotal: confirmed.refundedTotalCents === null ? null : formatCents(confirmed.refundedTotalCents),
      payloadSha256: sha256Hex(rawBody),
    })
    .catch(() => null);
  if (!applied || !isApplyOutcome(applied.outcome)) return { kind: "store_unavailable" };
  return { kind: "applied", outcome: applied.outcome };
}
