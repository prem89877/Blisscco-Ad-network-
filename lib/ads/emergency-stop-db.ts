import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseStopState, type StopState } from "./emergency-stop";

// Phase 5 Step 4: emergency stop flag ka server-side padhna. Service-role key SIRF createAdminClient() ke andar hai.
// Ek hi rpc: get_ad_serving_state (phase5-step4-1 SQL), sirf padhta hai. Kuch likhta nahi.
// Log me sirf error code jaata hai. Fail ho toh "error" lauta hai (caller enforced mode me serve nahi karta).

export async function readAdServingState(): Promise<StopState> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("get_ad_serving_state");
    if (error) {
      console.error("[ads/emergency-stop] state rpc failed", error.code ?? "unknown");
      return "error";
    }
    return parseStopState(data);
  } catch {
    console.error("[ads/emergency-stop] state unexpected failure");
    return "error";
  }
}
