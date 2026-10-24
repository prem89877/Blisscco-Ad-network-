import "server-only";
import { isUuid } from "@/lib/campaigns/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CategorySlug } from "./taxonomy";

// Serve ke liye database pul (server-side). Service-role key SIRF createAdminClient() ke andar hai.
// Yahan sirf 2 rpc chalte hain (day-6-1): authorize_publisher_key aur record_ad_serve.
// Log me sirf error code jaata hai (message/details me data ho sakta hai). Key, hash, topic, ad text kabhi log nahi hota.

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// 1. Publisher authorization
// ---------------------------------------------------------------------------

export type AuthorizeOutcome =
  | { outcome: "ok"; publisher: { id: string; status: "active" }; unitCostUsd: number }
  | { outcome: "unauthorized" }
  | { outcome: "rate_limited" }
  | { outcome: "error" };

/** Database ka jawab (unknown) -> typed AuthorizeOutcome. Shape galat ho toh "error" (kabhi crash/leak nahi). */
export function parseAuthorizeResult(data: unknown): AuthorizeOutcome {
  if (!isRecord(data) || typeof data.outcome !== "string") return { outcome: "error" };

  switch (data.outcome) {
    case "unauthorized":
      return { outcome: "unauthorized" };
    case "rate_limited":
      return { outcome: "rate_limited" };
    case "ok": {
      const id = data.publisher_id;
      const unit = typeof data.unit_cost_usd === "string" ? Number(data.unit_cost_usd) : data.unit_cost_usd;
      if (
        typeof id !== "string" ||
        !isUuid(id) ||
        data.publisher_status !== "active" ||
        typeof unit !== "number" ||
        !Number.isFinite(unit) ||
        unit <= 0
      ) {
        return { outcome: "error" };
      }
      return { outcome: "ok", publisher: { id, status: "active" }, unitCostUsd: unit };
    }
    default:
      return { outcome: "error" };
  }
}

export async function authorizePublisher(keyHash: string): Promise<AuthorizeOutcome> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("authorize_publisher_key", { p_key_hash: keyHash });
    if (error) {
      console.error("[ads/serve] authorize rpc failed", error.code ?? "unknown");
      return { outcome: "error" };
    }
    return parseAuthorizeResult(data);
  } catch {
    console.error("[ads/serve] authorize unexpected failure");
    return { outcome: "error" };
  }
}

// ---------------------------------------------------------------------------
// 2. Serve record
// ---------------------------------------------------------------------------

export type RecordOutcome =
  /** Database ne creative dobara verify karke serve record kar liya. */
  | { outcome: "recorded" }
  /** Creative ab eligible nahi (ya key ab valid nahi): ad MAT do, no-fill do. */
  | { outcome: "rejected" }
  | { outcome: "error" };

export function parseRecordResult(data: unknown): RecordOutcome {
  if (!isRecord(data) || typeof data.outcome !== "string") return { outcome: "error" };
  switch (data.outcome) {
    case "ok":
      return { outcome: "recorded" };
    case "rejected":
    case "unauthorized":
      return { outcome: "rejected" };
    default:
      return { outcome: "error" };
  }
}

export async function recordServe(
  keyHash: string,
  creativeId: string,
  category: CategorySlug,
): Promise<RecordOutcome> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("record_ad_serve", {
      p_key_hash: keyHash,
      p_creative_id: creativeId,
      p_topic: category,
    });
    if (error) {
      console.error("[ads/serve] record rpc failed", error.code ?? "unknown");
      return { outcome: "error" };
    }
    return parseRecordResult(data);
  } catch {
    console.error("[ads/serve] record unexpected failure");
    return { outcome: "error" };
  }
}
