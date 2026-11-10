import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseCountryStateResult, regionalGateOutcome, type RegionalGateOutcome } from "./regional-eligibility";

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
