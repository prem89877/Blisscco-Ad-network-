import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  parseCountryStateResult,
  publisherRegionOutcome,
  regionalGateOutcome,
  type PublisherRegionOutcome,
  type RegionalGateOutcome,
} from "./regional-eligibility";

// Serve ke liye publisher country ka read-only pul (server-side). Service-role key SIRF createAdminClient() ke andar hai.
// Sirf padhta hai: public.get_publisher_country_state (execute sirf service_role; country_code sirf VERIFIED par deta hai).
// Log me sirf error code jaata hai. Koi country, publisher id ya key log nahi hoti.

export async function checkPublisherRegionalEligibility(publisherId: string): Promise<RegionalGateOutcome> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("get_publisher_country_state", { p_publisher_id: publisherId });
    if (error) {
      console.error("[ads/regional] country state rpc failed", error.code ?? "unknown");
      return "error";
    }
    return regionalGateOutcome(parseCountryStateResult(data));
  } catch {
    console.error("[ads/regional] country state unexpected failure");
    return "error";
  }
}

// Phase 6 Step 2 Part 2: wahi read-only rpc, par jawab me publisher ka region bhi (sirf VERIFIED + ISO-valid country se, central mapping).
// Region kabhi request / client se nahi aata. Log me sirf error code.
export async function resolvePublisherRegionFromDb(publisherId: string): Promise<PublisherRegionOutcome> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("get_publisher_country_state", { p_publisher_id: publisherId });
    if (error) {
      console.error("[ads/regional] country state rpc failed", error.code ?? "unknown");
      return { outcome: "error" };
    }
    return publisherRegionOutcome(parseCountryStateResult(data));
  } catch {
    console.error("[ads/regional] country state unexpected failure");
    return { outcome: "error" };
  }
}
