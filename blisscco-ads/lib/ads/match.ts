import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MatchOutcome } from "./types";

// Matching ka server-side pul. Service-role key SIRF yahan (route handler ke peeche) use hoti hai.
// Asli logic database function public.match_contextual_ad me hai (day-5-4).

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Database ka jawab (unknown) -> typed MatchOutcome. Shape galat ho toh "error" (kabhi crash/leak nahi). */
export function parseMatchResult(data: unknown): MatchOutcome {
  if (!isRecord(data) || typeof data.outcome !== "string") return { outcome: "error" };

  switch (data.outcome) {
    case "no_fill":
      return { outcome: "no_fill" };
    case "unauthorized":
      return { outcome: "unauthorized" };
    case "rate_limited":
      return { outcome: "rate_limited" };
    case "ok": {
      const ad = data.ad;
      if (!isRecord(ad)) return { outcome: "error" };
      const { id, headline, body, cta_text: ctaText, destination_url: destinationUrl } = ad;
      if (
        typeof id !== "string" ||
        typeof headline !== "string" ||
        typeof body !== "string" ||
        typeof destinationUrl !== "string" ||
        !destinationUrl.startsWith("https://") ||
        !(ctaText === null || typeof ctaText === "string")
      ) {
        return { outcome: "error" };
      }
      return { outcome: "ok", ad: { id, headline, body, ctaText, destinationUrl } };
    }
    default:
      return { outcome: "error" };
  }
}

export async function matchAd(keyHash: string, topic: string, excludeAdIds: string[]): Promise<MatchOutcome> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("match_contextual_ad", {
      p_key_hash: keyHash,
      p_topic: topic,
      p_exclude_ids: excludeAdIds,
    });
    if (error) {
      // Sirf error code log hota hai (message/details me data ho sakta hai).
      console.error("[ads/match] rpc failed", error.code ?? "unknown");
      return { outcome: "error" };
    }
    return parseMatchResult(data);
  } catch {
    console.error("[ads/match] unexpected failure");
    return { outcome: "error" };
  }
}
