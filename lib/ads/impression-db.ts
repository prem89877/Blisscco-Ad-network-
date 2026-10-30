import "server-only";
import { isUuid } from "@/lib/campaigns/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RecordImpressionOutcome } from "./impression";
import { SERVE_REF_RE } from "./tracking-token";

// Impression ke liye database pul (server-side). Service-role key SIRF createAdminClient() ke andar hai.
// Yahan sirf 2 rpc chalte hain (day-12-7 SQL): lookup_serve_for_event (sirf padhta hai) aur record_ad_impression (atomic writer).
// Table seedha kabhi nahi chhuta (ad_events par kisi app role ka grant nahi). Log me sirf error code jaata hai: token, serve_ref, ids kuch nahi.

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export type ServeForEvent = { publisherId: string; servedAtMs: number };

/**
 * lookup_serve_for_event ka jawab -> serve ya null (anjaani serve). Shape galat ho toh THROW: caller ise "unavailable" maanta hai,
 * "unknown serve" nahi (database bigad jaye toh bhi koi galat accept ya galat reject nahi).
 */
export function parseServeLookup(data: unknown): ServeForEvent | null {
  if (!isRecord(data) || typeof data.outcome !== "string") throw new Error("bad lookup shape");
  if (data.outcome === "not_found") return null;
  if (data.outcome !== "found") throw new Error("bad lookup outcome");
  const { publisher_id: publisherId, served_at: servedAt } = data;
  if (typeof publisherId !== "string" || !isUuid(publisherId) || typeof servedAt !== "string") throw new Error("bad lookup fields");
  const servedAtMs = Date.parse(servedAt);
  if (!Number.isFinite(servedAtMs)) throw new Error("bad lookup time");
  return { publisherId, servedAtMs };
}

/** record_ad_impression ka jawab -> outcome. Shape galat/anjaana => "error" (kabhi "recorded" nahi maana jaata). */
export function parseRecordImpression(data: unknown): RecordImpressionOutcome {
  if (!isRecord(data)) return "error";
  switch (data.outcome) {
    case "recorded":
    case "duplicate":
    case "rejected":
      return data.outcome;
    default:
      return "error";
  }
}

export async function lookupServeForEvent(serveRef: string): Promise<ServeForEvent | null> {
  if (!SERVE_REF_RE.test(serveRef)) return null;
  let reply: { data: unknown; error: { code?: string } | null };
  try {
    reply = await createAdminClient().rpc("lookup_serve_for_event", { p_serve_ref: serveRef });
  } catch {
    console.error("[ads/impression] lookup unexpected failure");
    throw new Error("lookup unavailable");
  }
  if (reply.error) {
    console.error("[ads/impression] lookup rpc failed", reply.error.code ?? "unknown");
    throw new Error("lookup unavailable");
  }
  return parseServeLookup(reply.data); // galat shape => throw => "unavailable"
}

export async function recordImpressionEvent(serveRef: string, publisherId: string): Promise<RecordImpressionOutcome> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("record_ad_impression", { p_serve_ref: serveRef, p_publisher_id: publisherId });
    if (error) {
      console.error("[ads/impression] record rpc failed", error.code ?? "unknown");
      return "error";
    }
    return parseRecordImpression(data);
  } catch {
    console.error("[ads/impression] record unexpected failure");
    return "error";
  }
}
