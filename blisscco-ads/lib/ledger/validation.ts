import { isUuid } from "@/lib/campaigns/constants";
import { formatMoney, parseMoney } from "./decimal";

// Admin ke reversal / adjustment input ki jaanch (pure, database nahi). Server service har rpc se PEHLE yahi chalati hai;
// database ke andar wahi niyam dobara lagte hain (SQL asli deewar hai, ye pehli).
// Advertiser charge / publisher earning / platform revenue ka koi input yahan NAHI: wo sirf record_ad_serve ke andar, DB ke apne data se bante hain.

export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_.:-]{8,200}$/;
export const ADJUSTMENT_ACCOUNTS = ["advertiser", "publisher", "platform"] as const;
export type AdjustmentAccount = (typeof ADJUSTMENT_ACCOUNTS)[number];

export type ValidationFailure = { ok: false; field: string; reason: string };

function cleanReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.length >= 3 && t.length <= 500 ? t : null;
}

export type ReversalInput = { actorProfileId: string; entryId: number; idempotencyKey: string; reason: string };
export type ReversalChecked = { ok: true; value: ReversalInput } | ValidationFailure;

export function validateReversal(input: ReversalInput): ReversalChecked {
  if (typeof input.actorProfileId !== "string" || !isUuid(input.actorProfileId)) return { ok: false, field: "actorProfileId", reason: "uuid" };
  if (!Number.isSafeInteger(input.entryId) || input.entryId <= 0) return { ok: false, field: "entryId", reason: "positive_integer" };
  if (typeof input.idempotencyKey !== "string" || !IDEMPOTENCY_KEY_RE.test(input.idempotencyKey)) return { ok: false, field: "idempotencyKey", reason: "format" };
  const reason = cleanReason(input.reason);
  if (reason === null) return { ok: false, field: "reason", reason: "length_3_to_500" };
  return { ok: true, value: { ...input, reason } };
}

export type AdjustmentInput = {
  actorProfileId: string;
  account: AdjustmentAccount;
  /** Signed decimal TEXT ("-0.5000"). Number nahi: float kabhi database tak nahi jaata. Kabhi client form se seedha nahi: pehle server par admin check. */
  amount: string;
  idempotencyKey: string;
  reason: string;
  advertiserId?: string | null;
  publisherId?: string | null;
  campaignId?: string | null;
};
export type AdjustmentChecked = { ok: true; value: Required<Omit<AdjustmentInput, "amount">> & { amount: string } } | ValidationFailure;

export function validateAdjustment(input: AdjustmentInput): AdjustmentChecked {
  if (typeof input.actorProfileId !== "string" || !isUuid(input.actorProfileId)) return { ok: false, field: "actorProfileId", reason: "uuid" };
  if (!(ADJUSTMENT_ACCOUNTS as readonly string[]).includes(input.account)) return { ok: false, field: "account", reason: "unknown_account" };
  const amount = parseMoney(input.amount);
  if (!amount.ok) return { ok: false, field: "amount", reason: amount.reason };
  if (amount.units === 0n) return { ok: false, field: "amount", reason: "zero" };
  if (typeof input.idempotencyKey !== "string" || !IDEMPOTENCY_KEY_RE.test(input.idempotencyKey)) return { ok: false, field: "idempotencyKey", reason: "format" };
  const reason = cleanReason(input.reason);
  if (reason === null) return { ok: false, field: "reason", reason: "length_3_to_500" };

  const advertiserId = input.advertiserId ?? null;
  const publisherId = input.publisherId ?? null;
  const campaignId = input.campaignId ?? null;
  for (const [field, v] of [["advertiserId", advertiserId], ["publisherId", publisherId], ["campaignId", campaignId]] as const) {
    if (v !== null && (typeof v !== "string" || !isUuid(v))) return { ok: false, field, reason: "uuid" };
  }
  // Account ke hisaab se party zaroori (SQL ka financial_ledger_party_check).
  if (input.account === "advertiser" && advertiserId === null) return { ok: false, field: "advertiserId", reason: "required_for_account" };
  if (input.account === "publisher" && publisherId === null) return { ok: false, field: "publisherId", reason: "required_for_account" };

  return {
    ok: true,
    value: {
      actorProfileId: input.actorProfileId,
      account: input.account,
      amount: formatMoney(amount.units), // normalised "-0.5000": database ko hamesha exact decimal text
      idempotencyKey: input.idempotencyKey,
      reason,
      advertiserId,
      publisherId,
      campaignId,
    },
  };
}
