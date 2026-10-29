import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateAdjustment, validateReversal, type AdjustmentInput, type ReversalInput } from "./validation";

// Financial ledger ki server-side service (service-role SIRF createAdminClient() ke andar).
//
// KYA YAHAN NAHI HOTA: advertiser charge / publisher earning / platform revenue. Inhe koi TypeScript caller likh hi nahi sakta:
// wo sirf DATABASE ke record_ad_serve ke andar, usi transaction me (spend ke saath), DB ke apne data (CPM, serve ka reference, campaign) se bante hain.
// Isliye client / API se aayi koi amount ledger tak pahunchti hi nahi, aur retry par dobara charge ka raasta hi nahi.
//
// KYA YAHAN HOTA HAI: admin ke do kaam, dono SIRF nayi entry (purana kabhi nahi badalta):
//   * reverseLedgerEntry : kisi entry ka poora ulta.
//   * addLedgerAdjustment: signed adjustment (wajah + insaan ke naam par).
// Caller (server action) PEHLE khud admin session check kare aur actorProfileId session se de; DB phir bhi dobara check karta hai (active admin profile).
// Amount sirf decimal TEXT me jaati hai (float nahi). Log me sirf error code jaata hai: amount, reason, ids kuch nahi.

export type LedgerWriteOutcome =
  | { outcome: "recorded" | "duplicate"; id: number; entryId: string }
  | { outcome: "invalid"; field?: string }
  | { outcome: "forbidden" | "not_found" | "conflict" | "rejected" | "error" };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Database ka jawab -> typed outcome. Shape galat/anjaana => "error" (kabhi "recorded" nahi maana jaata). */
export function parseLedgerWrite(data: unknown): LedgerWriteOutcome {
  if (!isRecord(data) || typeof data.outcome !== "string") return { outcome: "error" };
  switch (data.outcome) {
    case "recorded":
    case "duplicate": {
      const id = typeof data.id === "string" ? Number(data.id) : data.id;
      if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return { outcome: "error" };
      if (typeof data.entry_id !== "string" || data.entry_id === "") return { outcome: "error" };
      return { outcome: data.outcome, id, entryId: data.entry_id };
    }
    case "forbidden":
    case "not_found":
    case "conflict":
    case "rejected":
      return { outcome: data.outcome };
    case "invalid":
      return { outcome: "invalid" };
    default:
      return { outcome: "error" };
  }
}

async function callWriter(name: string, args: Record<string, unknown>): Promise<LedgerWriteOutcome> {
  try {
    const { data, error } = await createAdminClient().rpc(name, args);
    if (error) {
      console.error("[ledger] rpc failed", name, error.code ?? "unknown");
      return { outcome: "error" };
    }
    return parseLedgerWrite(data);
  } catch {
    console.error("[ledger] unexpected failure", name);
    return { outcome: "error" };
  }
}

/** Kisi entry ka poora ulta. Wahi idempotencyKey dobara => "duplicate" (nayi row nahi). Campaign ka budget / spend NAHI chhuta. */
export async function reverseLedgerEntry(input: ReversalInput): Promise<LedgerWriteOutcome> {
  const v = validateReversal(input);
  if (!v.ok) return { outcome: "invalid", field: v.field };
  return callWriter("ledger_reverse_entry", {
    p_actor: v.value.actorProfileId,
    p_entry_id: v.value.entryId,
    p_idempotency_key: v.value.idempotencyKey,
    p_reason: v.value.reason,
  });
}

/** Signed adjustment (nayi row). Amount decimal text; 4 se zyada decimal ya 0 => "invalid" (kabhi chupchap round nahi). */
export async function addLedgerAdjustment(input: AdjustmentInput): Promise<LedgerWriteOutcome> {
  const v = validateAdjustment(input);
  if (!v.ok) return { outcome: "invalid", field: v.field };
  const a = v.value;
  return callWriter("ledger_add_adjustment", {
    p_actor: a.actorProfileId,
    p_account: a.account,
    p_amount: a.amount, // TEXT: PostgREST ise numeric me exact badalta hai
    p_idempotency_key: a.idempotencyKey,
    p_reason: a.reason,
    p_advertiser_id: a.advertiserId,
    p_publisher_id: a.publisherId,
    p_campaign_id: a.campaignId,
  });
}
