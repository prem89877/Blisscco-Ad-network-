import { isUuid } from "@/lib/campaigns/constants";
import { parseMoney } from "@/lib/ledger/decimal";
import { availableUnits, isPayoutStatus, type PayoutStatus } from "./rules";

// Day 13 Part 4: payout ka data layer. Sirf PADHNA (likhne wale kaam server actions me, database functions ke through).
//
// Ownership / role DATABASE me hai (day-13-9): publisher ke functions auth.uid() se apna publisher nikalte hain (publisher id parameter me nahi aati),
// admin list sirf active admin ko rows deti hai. Service-role key is feature me kahin nahi.
// Yahan sirf: rpc ke jawab ki shape ki sakht jaanch (galat / aadhi row => "error", kabhi galat number nahi) aur chhote fetch helpers.
// Client inject hota hai, isliye tests asli database ke bina chalte hain.

export type PayoutRpcClient = {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
};

export type PayoutResult<T> = { status: "ok"; data: T } | { status: "not_found" } | { status: "error" };

/** Sab amounts BigInt units (1 unit = 0.0001 USD). */
export type PayoutSummary = {
  currency: "USD";
  eligible: boolean;
  ledgerBalance: bigint;
  reserved: bigint;
  paidOut: bigint;
  available: bigint;
  hasOpenRequest: boolean;
};

export type PayoutRequestRow = {
  id: string;
  amount: bigint;
  status: PayoutStatus;
  rejectionReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  paidAt: string | null;
};

export type AdminPayoutRow = PayoutRequestRow & { publisherId: string; publisherName: string; ledgerCovers: boolean };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Database ka numeric TEXT ("0.0250") -> units. Number (float) ya galat text => null: kabhi andaza nahi lagate. */
function toUnits(v: unknown): bigint | null {
  if (typeof v !== "string") return null;
  const p = parseMoney(v);
  return p.ok ? p.units : null;
}

const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function optTs(v: unknown): string | null | undefined {
  if (v === null || v === undefined) return null;
  return typeof v === "string" && ISO_TS.test(v) ? v : undefined; // undefined = galat shape
}

export function parsePayoutSummaryRow(row: unknown): PayoutSummary | null {
  if (!isRecord(row)) return null;
  if (row.currency_code !== "USD") return null;
  if (typeof row.eligible !== "boolean" || typeof row.has_open_request !== "boolean") return null;
  const ledgerBalance = toUnits(row.ledger_balance);
  const reserved = toUnits(row.reserved);
  const paidOut = toUnits(row.paid_out);
  const available = toUnits(row.available);
  if (ledgerBalance === null || reserved === null || paidOut === null || available === null) return null;
  if (reserved < 0n || paidOut < 0n || available < 0n) return null;
  // Hisaab ka milan: available = max(0, ledger - reserved - paid). Na mile => poora row galat.
  if (available !== availableUnits(ledgerBalance, reserved, paidOut)) return null;
  // Reserved sirf khule request se aata hai.
  if ((reserved > 0n) !== row.has_open_request) return null;
  return { currency: "USD", eligible: row.eligible, ledgerBalance, reserved, paidOut, available, hasOpenRequest: row.has_open_request };
}

export function parsePayoutRequestRow(row: unknown): PayoutRequestRow | null {
  if (!isRecord(row)) return null;
  const { id, status } = row;
  if (typeof id !== "string" || !isUuid(id)) return null;
  if (!isPayoutStatus(status)) return null;
  const amount = toUnits(row.amount);
  if (amount === null || amount <= 0n) return null;
  const createdAt = optTs(row.created_at);
  const reviewedAt = optTs(row.reviewed_at);
  const paidAt = optTs(row.paid_at);
  if (typeof createdAt !== "string" || reviewedAt === undefined || paidAt === undefined) return null;
  const reason = row.rejection_reason;
  if (reason !== null && reason !== undefined && typeof reason !== "string") return null;
  const rejectionReason = typeof reason === "string" ? reason : null;

  // Status aur tareekhon ka milan (database ke CHECK jaisa): milan nahi => error, kuch aur dikhane se behtar.
  if (status === "requested" && (reviewedAt !== null || paidAt !== null || rejectionReason !== null)) return null;
  if (status === "approved" && (reviewedAt === null || paidAt !== null || rejectionReason !== null)) return null;
  if (status === "rejected" && (reviewedAt === null || paidAt !== null || rejectionReason === null)) return null;
  if (status === "paid" && (reviewedAt === null || paidAt === null || rejectionReason !== null)) return null;

  return { id, amount, status, rejectionReason, createdAt, reviewedAt, paidAt };
}

export function parseAdminPayoutRow(row: unknown): AdminPayoutRow | null {
  const base = parsePayoutRequestRow(row);
  if (!base || !isRecord(row)) return null;
  const { publisher_id: publisherId, publisher_name: publisherName, ledger_covers: ledgerCovers } = row;
  if (typeof publisherId !== "string" || !isUuid(publisherId)) return null;
  if (typeof publisherName !== "string" || publisherName.length === 0) return null;
  if (typeof ledgerCovers !== "boolean") return null;
  return { ...base, publisherId, publisherName, ledgerCovers };
}

async function callRpc(client: PayoutRpcClient, fn: string, args: Record<string, unknown>): Promise<unknown[] | null> {
  try {
    const { data, error } = await client.rpc(fn, args);
    if (error) {
      console.error("[payouts] rpc failed", fn, error.code ?? "unknown"); // sirf function ka naam + code: id / amount kuch nahi
      return null;
    }
    return Array.isArray(data) ? data : null;
  } catch {
    console.error("[payouts] rpc unexpected failure", fn);
    return null;
  }
}

/** Caller ke apne publisher ka hisab. Publisher row nahi (ya profile active nahi) => not_found. Database error / galat shape => error. */
export async function fetchMyPayoutSummary(client: PayoutRpcClient): Promise<PayoutResult<PayoutSummary>> {
  const rows = await callRpc(client, "get_my_payout_summary", {});
  if (!rows) return { status: "error" };
  if (rows.length === 0) return { status: "not_found" };
  if (rows.length !== 1) return { status: "error" };
  const parsed = parsePayoutSummaryRow(rows[0]);
  return parsed ? { status: "ok", data: parsed } : { status: "error" };
}

export const PAYOUT_LIST_DEFAULT_LIMIT = 25;
export const PAYOUT_LIST_MAX_LIMIT = 100;

/** Apne payout requests (naye pehle). Ek bhi row kharab => poora error (aadha jawab nahi). */
export async function fetchMyPayoutRequests(client: PayoutRpcClient, limit: number = PAYOUT_LIST_DEFAULT_LIMIT): Promise<PayoutResult<PayoutRequestRow[]>> {
  const safe = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), PAYOUT_LIST_MAX_LIMIT) : PAYOUT_LIST_DEFAULT_LIMIT;
  const rows = await callRpc(client, "get_my_payout_requests", { p_limit: safe });
  if (!rows || rows.length > safe) return { status: "error" };
  const out: PayoutRequestRow[] = [];
  for (const r of rows) {
    const parsed = parsePayoutRequestRow(r);
    if (!parsed) return { status: "error" };
    out.push(parsed);
  }
  return { status: "ok", data: out };
}

export const ADMIN_PAYOUT_LIST_LIMIT = 50;

/** Admin ki list (khule pehle). Admin nahi => database 0 rows deta hai (yahan bhi khali list). */
export async function fetchAdminPayoutRequests(client: PayoutRpcClient, limit: number = ADMIN_PAYOUT_LIST_LIMIT): Promise<PayoutResult<AdminPayoutRow[]>> {
  const safe = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 200) : ADMIN_PAYOUT_LIST_LIMIT;
  const rows = await callRpc(client, "admin_list_payout_requests", { p_limit: safe });
  if (!rows || rows.length > safe) return { status: "error" };
  const out: AdminPayoutRow[] = [];
  for (const r of rows) {
    const parsed = parseAdminPayoutRow(r);
    if (!parsed) return { status: "error" };
    out.push(parsed);
  }
  return { status: "ok", data: out };
}
