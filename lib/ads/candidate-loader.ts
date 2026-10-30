import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseCandidateRows } from "./candidate-rows";
import type { CandidateLoader } from "./selection";

// Server-side candidate loader (selection layer ke liye). Service-role key SIRF createAdminClient() ke andar hai,
// aur "server-only" ki wajah se ye file browser/client component me import karte hi build fail hoga.
//
// Ye sirf PADHTA hai: database function public.load_ad_candidates (day-5-6, read-only, execute sirf service_role).
// Koi insert/update, serve count, impression, click ya billing yahan nahi.
// Error par throw karta hai; selectAd use pakadkar safe no-fill deta hai. Log me sirf error code jaata hai
// (message/details me data ho sakta hai).

export const loadAdCandidates: CandidateLoader = async (category, today) => {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("load_ad_candidates", {
    p_category: category,
    p_today: today,
  });
  if (error) {
    console.error("[ads/load] rpc failed", error.code ?? "unknown");
    throw new Error("candidate_load_failed");
  }
  const candidates = parseCandidateRows(data);
  if (candidates === null) {
    console.error("[ads/load] unexpected response shape");
    throw new Error("candidate_load_failed");
  }
  return candidates;
};
