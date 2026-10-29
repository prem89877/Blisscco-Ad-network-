import "server-only";
import { isUuid } from "@/lib/campaigns/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ClickServeRow, RecordClickOutcome } from "./click";
import { SERVE_REF_RE } from "./tracking-token";

// Click ke liye database pul (server-side). Service-role key SIRF createAdminClient() ke andar hai.
// Yahan sirf 2 rpc chalte hain (day-12-10 SQL): lookup_serve_for_click (sirf padhta hai) aur record_ad_click (atomic writer).
// Table seedha kabhi nahi chhuta. Log me sirf error code jaata hai: ref, serve_ref, ids, URL kuch nahi.

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * lookup_serve_for_click ka jawab -> row ya null (anjaani serve). Shape galat ho toh THROW: caller ise "unavailable" maanta hai,
 * "invalid" nahi (database bigad jaye toh bhi koi galat accept ya galat reject nahi).
 */
export function parseClickLookup(data: unknown): ClickServeRow | null {
  if (!isRecord(data) || typeof data.outcome !== "string") throw new Error("bad lookup shape");
  if (data.outcome === "not_found") return null;
  if (data.outcome !== "found") throw new Error("bad lookup outcome");
  const { publisher_id: publisherId, creative_id: creativeId, served_at: servedAt, destination_url: destinationUrl, eligible } = data;
  if (typeof publisherId !== "string" || !isUuid(publisherId)) throw new Error("bad lookup fields");
  if (typeof creativeId !== "string" || !isUuid(creativeId)) throw new Error("bad lookup fields");
  if (typeof servedAt !== "string" || typeof eligible !== "boolean") throw new Error("bad lookup fields");
  if (destinationUrl !== null && typeof destinationUrl !== "string") throw new Error("bad lookup fields");
  const servedAtMs = Date.parse(servedAt);
  if (!Number.isFinite(servedAtMs)) throw new Error("bad lookup time");
  return { publisherId, creativeId, servedAtMs, destinationUrl: destinationUrl as string | null, eligible };
}

/** record_ad_click ka jawab -> outcome. Shape galat/anjaana => "error" (kabhi "recorded" nahi maana jaata). */
export function parseRecordClick(data: unknown): RecordClickOutcome {
  if (!isRecord(data)) return { outcome: "error" };
  switch (data.outcome) {
    case "recorded":
    case "duplicate":
    case "not_counted":
      return typeof data.destination_url === "string" ? { outcome: data.outcome, destinationUrl: data.destination_url } : { outcome: "error" };
    case "rejected":
    case "ineligible":
      return { outcome: data.outcome };
    default:
      return { outcome: "error" };
  }
}

export async function lookupServeForClick(serveRef: string): Promise<ClickServeRow | null> {
  if (!SERVE_REF_RE.test(serveRef)) return null;
  let reply: { data: unknown; error: { code?: string } | null };
  try {
    reply = await createAdminClient().rpc("lookup_serve_for_click", { p_serve_ref: serveRef });
  } catch {
    console.error("[ads/click] lookup unexpected failure");
    throw new Error("lookup unavailable");
  }
  if (reply.error) {
    console.error("[ads/click] lookup rpc failed", reply.error.code ?? "unknown");
    throw new Error("lookup unavailable");
  }
  return parseClickLookup(reply.data);
}

export async function recordClickEvent(serveRef: string, publisherId: string, creativeId: string): Promise<RecordClickOutcome> {
  try {
    const { data, error } = await createAdminClient().rpc("record_ad_click", {
      p_serve_ref: serveRef,
      p_publisher_id: publisherId,
      p_creative_id: creativeId,
    });
    if (error) {
      console.error("[ads/click] record rpc failed", error.code ?? "unknown");
      return { outcome: "error" };
    }
    return parseRecordClick(data);
  } catch {
    console.error("[ads/click] record unexpected failure");
    return { outcome: "error" };
  }
}
