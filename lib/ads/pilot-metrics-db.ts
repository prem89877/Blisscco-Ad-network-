import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MatchOutcome } from "./pilot-monitoring";

// Phase 3 Step 4: request metric ka database pul (server-side). Service-role key SIRF createAdminClient() ke andar hai.
// Ek hi rpc: record_ad_request_metric (phase3-step4-1 SQL). Ye sirf ek aggregate counter badhata hai (outcome + latency):
// koi prompt, topic, publisher key, IP, user id, campaign id ya ad text nahi jaata.
// Billing / ledger / spend / events ko ye kabhi nahi chhuta.
// Error par throw nahi karta: sirf error code log hota hai (message / details me data ho sakta hai). Caller (reportMatchMetric) waise bhi nigal leta hai.

export async function recordRequestMetric(outcome: MatchOutcome, latencyMs: number): Promise<void> {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.rpc("record_ad_request_metric", { p_outcome: outcome, p_latency_ms: latencyMs });
    if (error) console.error("[ads/monitoring] record rpc failed", error.code ?? "unknown");
  } catch {
    console.error("[ads/monitoring] record unexpected failure");
  }
}
