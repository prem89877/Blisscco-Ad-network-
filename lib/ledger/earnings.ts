import { isUuid } from "@/lib/campaigns/constants";
import { parseMoney } from "./decimal";
import { LEDGER_CURRENCY } from "./display";

// Day 13 Part 3: publisher earnings ka data layer. Sirf PADHNA. Koi payout, koi billing / revenue-share ka hisab nahi.
//
// Ownership DATABASE me hai (day-13-7 SQL: get_my_publisher_earnings / get_my_publisher_ledger_entries). Ye functions caller ki apni
// login-session se bulaye jaate hain (auth.uid()) aur publisher ki id kabhi parameter me nahi leti, isliye yahan koi publisher id
// bhejne ka raasta hi nahi hai, aur service-role key ka koi kaam nahi (use kabhi import nahi karte).
// Is file me sirf: rpc ke jawab ki shape ki jaanch (galat shape => "error", kabhi galat / adha number nahi), aur chhote fetch helpers.
// Client inject hota hai, isliye tests asli database ke bina chalte hain.
//
// KYA SUPPORTED HAI (ledger me asli me hai): total earned, adjustments, reversals, ledger balance, entries ki list.
// KYA NAHI: pending / approved / paid-out. Schema me in ka status ya payout entry-type hi nahi hai, isliye koi value nahi banti
// (UNSUPPORTED_BALANCES neeche: page inhe "not tracked yet" dikhata hai, kabhi 0 ya demo number nahi).

export type EarningsSummary = {
  currency: typeof LEDGER_CURRENCY;
  ledgerEnabled: boolean;
  shareConfigured: boolean;
  entryCount: number;
  lastEntryAt: string | null;
  /** Sab amounts BigInt units (1 unit = 0.0001 USD). */
  earned: bigint;
  adjustments: bigint;
  reversals: bigint;
  balance: bigint;
};

export type EarningsEntryType = "publisher_earning" | "adjustment" | "reversal";
export type EarningsEntry = { entryId: string; type: EarningsEntryType; amount: bigint; currency: typeof LEDGER_CURRENCY; createdAt: string };

export type EarningsResult<T> = { status: "ok"; data: T } | { status: "not_found" } | { status: "error" };

/** Sirf wahi hissa jo hume Supabase client se chahiye (createClient() ka jawab ismein fit hota hai). */
export type EarningsRpcClient = {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
};

/** Jo balances ledger me abhi hain hi nahi. Page inhe honestly "not tracked yet" dikhata hai. */
export const UNSUPPORTED_BALANCES: readonly { key: "pending" | "approved" | "paid"; label: string }[] = [
  { key: "pending", label: "Pending earnings" },
  { key: "approved", label: "Approved earnings" },
  { key: "paid", label: "Earnings marked as paid" },
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Database ka numeric TEXT ("0.0250", "-0.0050") -> units. Number (float) ya galat text => null: kabhi andaza nahi lagate. */
function toUnits(v: unknown): bigint | null {
  if (typeof v !== "string") return null;
  const p = parseMoney(v);
  return p.ok ? p.units : null;
}

/** bigint Postgres se number ya string aa sakta hai. Sirf poore, negative-nahi, safe integers manta hai; baaki null. */
function toCount(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,15}$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

export function parseEarningsSummaryRow(row: unknown): EarningsSummary | null {
  if (!isRecord(row)) return null;
  if (row.currency_code !== LEDGER_CURRENCY) return null; // doosri currency ka jod mix nahi karte
  if (typeof row.ledger_enabled !== "boolean" || typeof row.share_configured !== "boolean") return null;
  const earned = toUnits(row.total_earned);
  const adjustments = toUnits(row.total_adjustments);
  const reversals = toUnits(row.total_reversals);
  const balance = toUnits(row.ledger_balance);
  const entryCount = toCount(row.entry_count);
  if (earned === null || adjustments === null || reversals === null || balance === null || entryCount === null) return null;
  // Hisaab ka milan: balance = earned + adjustments + reversals. Na mile => poora row galat (kuch dikhane se behtar hai "error").
  if (balance !== earned + adjustments + reversals) return null;
  if (earned < 0n) return null; // earning kabhi negative nahi (reversal alag column me aata hai)
  if (entryCount === 0 && (earned !== 0n || adjustments !== 0n || reversals !== 0n)) return null;
  let lastEntryAt: string | null = null;
  if (row.last_entry_at !== null && row.last_entry_at !== undefined) {
    if (typeof row.last_entry_at !== "string" || !ISO_TS.test(row.last_entry_at)) return null;
    lastEntryAt = row.last_entry_at;
  }
  if ((entryCount === 0) !== (lastEntryAt === null)) return null;
  return {
    currency: LEDGER_CURRENCY,
    ledgerEnabled: row.ledger_enabled,
    shareConfigured: row.share_configured,
    entryCount,
    lastEntryAt,
    earned,
    adjustments,
    reversals,
    balance,
  };
}

export function parseEarningsEntryRow(row: unknown): EarningsEntry | null {
  if (!isRecord(row)) return null;
  const { entry_id: entryId, entry_type: type, created_at: createdAt } = row;
  if (typeof entryId !== "string" || !isUuid(entryId)) return null;
  if (type !== "publisher_earning" && type !== "adjustment" && type !== "reversal") return null;
  if (row.currency_code !== LEDGER_CURRENCY) return null;
  if (typeof createdAt !== "string" || !ISO_TS.test(createdAt)) return null;
  const amount = toUnits(row.amount);
  if (amount === null || amount === 0n) return null;
  if (type === "publisher_earning" && amount < 0n) return null; // earning hamesha positive
  return { entryId, type, amount, currency: LEDGER_CURRENCY, createdAt };
}

async function callRpc(client: EarningsRpcClient, fn: string, args: Record<string, unknown>): Promise<unknown[] | null> {
  try {
    const { data, error } = await client.rpc(fn, args);
    if (error) {
      console.error("[ledger/earnings] rpc failed", fn, error.code ?? "unknown"); // sirf function ka naam + code: id / amount kuch nahi
      return null;
    }
    return Array.isArray(data) ? data : null;
  } catch {
    console.error("[ledger/earnings] rpc unexpected failure", fn);
    return null;
  }
}

/** Caller ke apne publisher ke totals. Publisher row nahi hai (ya profile active nahi) => not_found. Database error / galat shape => error (zero nahi dikhaya jaata). */
export async function fetchMyEarningsSummary(client: EarningsRpcClient): Promise<EarningsResult<EarningsSummary>> {
  const rows = await callRpc(client, "get_my_publisher_earnings", {});
  if (!rows) return { status: "error" };
  if (rows.length === 0) return { status: "not_found" };
  if (rows.length !== 1) return { status: "error" };
  const parsed = parseEarningsSummaryRow(rows[0]);
  return parsed ? { status: "ok", data: parsed } : { status: "error" };
}

export const ENTRIES_DEFAULT_LIMIT = 25;
export const ENTRIES_MAX_LIMIT = 100;

/** Apni latest entries (naye pehle). Limit 1..100 me kata jata hai. Ek bhi row kharab => poora error (aadha jawab nahi). */
export async function fetchMyEarningsEntries(client: EarningsRpcClient, limit: number = ENTRIES_DEFAULT_LIMIT): Promise<EarningsResult<EarningsEntry[]>> {
  const safe = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), ENTRIES_MAX_LIMIT) : ENTRIES_DEFAULT_LIMIT;
  const rows = await callRpc(client, "get_my_publisher_ledger_entries", { p_limit: safe });
  if (!rows) return { status: "error" };
  if (rows.length > safe) return { status: "error" };
  const out: EarningsEntry[] = [];
  for (const r of rows) {
    const parsed = parseEarningsEntryRow(r);
    if (!parsed) return { status: "error" };
    out.push(parsed);
  }
  return { status: "ok", data: out };
}

// ---------- Page ka faisla: figures dikhane hain ya "abhi record nahi ho raha" ----------

export type EarningsAvailability =
  | { kind: "not_recording"; reason: "ledger_off" | "share_not_set" }
  | { kind: "available"; recordingNow: boolean };

/**
 * Ledger band (ya batwara tay nahi) AUR koi entry nahi => figures NAHI dikhte (0.0000 asli kamai jaisa dikhta, jo jhooth hota).
 * Entry hai => figures dikhte hain (ye persisted asli records hain); recordingNow = false ho toh page batata hai ki nayi kamai abhi record nahi ho rahi.
 */
export function earningsAvailability(s: EarningsSummary): EarningsAvailability {
  const recordingNow = s.ledgerEnabled && s.shareConfigured;
  if (s.entryCount > 0) return { kind: "available", recordingNow };
  if (!s.ledgerEnabled) return { kind: "not_recording", reason: "ledger_off" };
  if (!s.shareConfigured) return { kind: "not_recording", reason: "share_not_set" };
  return { kind: "available", recordingNow: true };
}

export const ENTRY_TYPE_LABEL: Record<EarningsEntryType, string> = {
  publisher_earning: "Earning",
  adjustment: "Adjustment",
  reversal: "Reversal",
};
