import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseCampaignRegionRows, type CampaignRegionLoader } from "./campaign-targeting";

// Campaigns ke target regions ka read-only pul (server-side). Service-role key SIRF createAdminClient() ke andar hai.
// Sirf padhta hai: public.get_campaign_target_regions (execute sirf service_role). Kuch likhta nahi.
// Error par throw karta hai (selectAd isse safe failure maanta hai); log me sirf error code. Koi campaign id ya region log nahi hota.

export const loadCampaignTargetRegions: CampaignRegionLoader = async (campaignIds) => {
  const ids = [...new Set(campaignIds.map((id) => id.toLowerCase()))];
  if (ids.length === 0) return new Map();
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("get_campaign_target_regions", { p_campaign_ids: ids });
  if (error) {
    console.error("[ads/regional] campaign regions rpc failed", error.code ?? "unknown");
    throw new Error("campaign_regions_load_failed");
  }
  const parsed = parseCampaignRegionRows(data, ids);
  if (parsed === null) {
    console.error("[ads/regional] campaign regions unexpected response shape");
    throw new Error("campaign_regions_load_failed");
  }
  return parsed;
};
