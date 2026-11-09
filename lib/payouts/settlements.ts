import { isUuid } from "@/lib/campaigns/constants";
import { PAYOUT_REFERENCE_PATTERN, isSettlementStatus, type SettlementStatus } from "./rules";

// Phase 5 Step 5: admin ki settlement list ko parse karna (admin_list_payout_settlements). Ek bhi row kharab => poora error.

export type SettlementRow = {
  payoutRequestId: string;
  payoutReference: string;
  status: SettlementStatus;
  hasExternalReference: boolean;
  createdAt: string;
};

export type SettlementListClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string | null } | null }>;
};

export function parseSettlementRow(row: unknown): SettlementRow | null {
  if (typeof row !== "object" || row === null || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;
  if (typeof r.payout_request_id !== "string" || !isUuid(r.payout_request_id)) return null;
  if (typeof r.payout_reference !== "string" || !PAYOUT_REFERENCE_PATTERN.test(r.payout_reference)) return null;
  if (!isSettlementStatus(r.status)) return null;
  if (typeof r.has_external_reference !== "boolean") return null;
  if (typeof r.created_at !== "string" || r.created_at.length < 10) return null;
  if ((r.status === "failed") === r.has_external_reference) return null; // failed => reference nahi; baaki => reference hai
  return { payoutRequestId: r.payout_request_id, payoutReference: r.payout_reference, status: r.status, hasExternalReference: r.has_external_reference, createdAt: r.created_at };
}

export async function fetchAdminSettlements(client: SettlementListClient, limit = 100): Promise<{ status: "ok"; data: SettlementRow[] } | { status: "error" }> {
  const safe = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 500) : 100;
  try {
    const { data, error } = await client.rpc("admin_list_payout_settlements", { p_limit: safe });
    if (error || !Array.isArray(data) || data.length > safe) return { status: "error" };
    const out: SettlementRow[] = [];
    for (const row of data) {
      const parsed = parseSettlementRow(row);
      if (!parsed) return { status: "error" };
      out.push(parsed);
    }
    return { status: "ok", data: out };
  } catch {
    console.error("[payouts] settlement list failed");
    return { status: "error" };
  }
}

/** payout_request_id -> us request ka sabse naya "asli" settlement (completed / reversed pehle, warna naya failed). Rows naye-pehle aati hain. */
export function latestSettlementByRequest(rows: readonly SettlementRow[]): Map<string, SettlementRow> {
  const map = new Map<string, SettlementRow>();
  for (const r of rows) {
    const cur = map.get(r.payoutRequestId);
    if (!cur || (cur.status === "failed" && r.status !== "failed")) map.set(r.payoutRequestId, r);
  }
  return map;
}
