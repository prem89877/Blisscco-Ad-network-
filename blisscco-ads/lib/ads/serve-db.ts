import "server-only";
import { isUuid } from "@/lib/campaigns/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { chargedUnitCostUsd } from "./category-matching";
import type { CategorySlug } from "./taxonomy";
import { SERVE_REF_RE } from "./tracking-token";
import type { MatchedAd, ServeReceipt } from "./types";

// Serve ke liye database pul (server-side). Service-role key SIRF createAdminClient() ke andar hai.
// Yahan sirf 3 rpc chalte hain: authorize_publisher_key aur record_ad_serve (day-5-8 / day-7-1 / day-9-5) aur find_idempotent_serve (day-9-5).
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
      // DB jo charge karta hai wahi keemat (round 4 decimals, min 0.0001): TypeScript pre-filter DB se alag na ho.
      return { outcome: "ok", publisher: { id, status: "active" }, unitCostUsd: chargedUnitCostUsd(unit) };
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
  /**
   * Database ne creative dobara verify karke serve record kar liya.
   * replayedAd: sirf tab, jab wahi Idempotency-Key pehle charge ho chuki thi (is baar DOBARA charge nahi hua):
   * publisher ko wahi pehle wala ad milna chahiye.
   */
  | { outcome: "recorded"; replayedAd?: MatchedAd; serve?: ServeReceipt }
  /** Creative ab eligible nahi (ya key ab valid nahi): ad MAT do, no-fill do. */
  | { outcome: "rejected" }
  | { outcome: "error" };

/**
 * Database ke jawab se serve receipt (serve_ref + served_at). Dono sahi shape ke na hon toh undefined: ad phir bhi diya jaata hai
 * (serve record ho chuki hai) par token nahi banta. Isse code day-12-5 SQL se pehle deploy hone par bhi tootta nahi.
 */
export function parseServeReceipt(data: Record<string, unknown>): ServeReceipt | undefined {
  const ref = data.serve_ref;
  const at = data.served_at;
  if (typeof ref !== "string" || !SERVE_REF_RE.test(ref)) return undefined;
  if (typeof at !== "string") return undefined;
  const servedAtMs = Date.parse(at);
  if (!Number.isFinite(servedAtMs)) return undefined;
  return { serveRef: ref, servedAtMs };
}

function parsePublicAd(v: unknown): MatchedAd | null {
  if (!isRecord(v)) return null;
  const { id, headline, body, cta_text: ctaText, destination_url: destinationUrl } = v;
  if (typeof id !== "string" || !isUuid(id)) return null;
  if (typeof headline !== "string" || typeof body !== "string" || typeof destinationUrl !== "string") return null;
  if (!(ctaText === null || typeof ctaText === "string")) return null;
  return { id, headline, body, ctaText, destinationUrl };
}

export function parseRecordResult(data: unknown): RecordOutcome {
  if (!isRecord(data) || typeof data.outcome !== "string") return { outcome: "error" };
  switch (data.outcome) {
    case "ok": {
      if (data.replayed === true) {
        // Retry: database ne pehle charge hui creative bheji hai. Shape galat ho toh "error" (galat ad kabhi nahi).
        const ad = parsePublicAd(data.ad);
        const serve = parseServeReceipt(data);
        return ad ? { outcome: "recorded", replayedAd: ad, ...(serve ? { serve } : {}) } : { outcome: "error" };
      }
      const serve = parseServeReceipt(data);
      return serve ? { outcome: "recorded", serve } : { outcome: "recorded" };
    }
    case "rejected":
    case "unauthorized":
      return { outcome: "rejected" };
    default:
      return { outcome: "error" };
  }
}

/**
 * idempotencyKey NA ho => purana 3-arg record_ad_serve, bilkul pehle jaise args (behaviour same).
 * idempotencyKey HO => 4-arg overload: wahi key dobara aaye toh dobara charge nahi.
 */
export async function recordServe(
  keyHash: string,
  creativeId: string,
  category: CategorySlug,
  idempotencyKey?: string,
): Promise<RecordOutcome> {
  try {
    const supabase = createAdminClient();
    const args =
      idempotencyKey === undefined
        ? { p_key_hash: keyHash, p_creative_id: creativeId, p_topic: category }
        : { p_key_hash: keyHash, p_creative_id: creativeId, p_topic: category, p_idempotency_key: idempotencyKey };
    const { data, error } = await supabase.rpc("record_ad_serve", args);
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

// ---------------------------------------------------------------------------
// 3. Retry check (selection se PEHLE)
// ---------------------------------------------------------------------------

export type ReplayLookup =
  /** Ye key pehle charge ho chuki hai: wahi ad wapas do, dobara charge mat karo. */
  | { outcome: "found"; ad: MatchedAd; serve?: ServeReceipt }
  /** Key naya hai: normal flow. */
  | { outcome: "none" }
  /** Pehle charge hua tha par ab creative eligible nahi: no-fill (kharch wapas nahi aata). */
  | { outcome: "rejected" }
  | { outcome: "unauthorized" }
  | { outcome: "error" };

export function parseReplayResult(data: unknown): ReplayLookup {
  if (!isRecord(data) || typeof data.outcome !== "string") return { outcome: "error" };
  switch (data.outcome) {
    case "none":
      return { outcome: "none" };
    case "rejected":
      return { outcome: "rejected" };
    case "unauthorized":
      return { outcome: "unauthorized" };
    case "found": {
      const ad = parsePublicAd(data.ad);
      const serve = parseServeReceipt(data);
      return ad ? { outcome: "found", ad, ...(serve ? { serve } : {}) } : { outcome: "error" };
    }
    default:
      return { outcome: "error" };
  }
}

export async function findIdempotentServe(keyHash: string, idempotencyKey: string): Promise<ReplayLookup> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("find_idempotent_serve", {
      p_key_hash: keyHash,
      p_idempotency_key: idempotencyKey,
    });
    if (error) {
      console.error("[ads/serve] replay lookup rpc failed", error.code ?? "unknown");
      return { outcome: "error" };
    }
    return parseReplayResult(data);
  } catch {
    console.error("[ads/serve] replay lookup unexpected failure");
    return { outcome: "error" };
  }
}
