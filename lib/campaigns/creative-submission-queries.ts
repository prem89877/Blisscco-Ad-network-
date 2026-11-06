import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/campaigns/constants";
import { ASSET_BUCKET } from "@/lib/campaigns/creative-assets";
import { SUBMITTED_CREATIVE_COLUMNS, toSubmittedCreative, type SubmittedCreative } from "@/lib/campaigns/creative-submission";

// Sirf server par chalta hai. User ke apne session se (RLS + storage policies); service-role key yahan kahin nahi.
// Har query me advertiser ke campaign ids ka filter EXPLICIT hai (RLS ke upar doosri parat).

export const CREATIVE_LIST_LIMIT = 100;
const SIGNED_URL_SECONDS = 60 * 60;

/** Ye campaigns (sirf apne advertiser ke, caller ne pehle verify kiye) ke creatives, archived chhod kar, naye pehle. null = load fail. */
export async function listCreativesForCampaigns(campaignIds: string[]): Promise<SubmittedCreative[] | null> {
  const ids = campaignIds.filter(isUuid);
  if (ids.length === 0) return [];
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("ad_creatives")
      .select(SUBMITTED_CREATIVE_COLUMNS)
      .in("campaign_id", ids)
      .neq("status", "archived")
      .order("created_at", { ascending: false })
      .limit(CREATIVE_LIST_LIMIT);
    if (error || !data) return null;
    return (data as unknown[]).map(toSubmittedCreative).filter((c): c is SubmittedCreative => c !== null);
  } catch {
    return null;
  }
}

/** Ek creative (sirf diye gaye apne campaign ids me se). */
export async function loadCreativeForCampaigns(creativeId: string, campaignIds: string[]): Promise<SubmittedCreative | null> {
  if (!isUuid(creativeId)) return null;
  const ids = campaignIds.filter(isUuid);
  if (ids.length === 0) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("ad_creatives")
      .select(SUBMITTED_CREATIVE_COLUMNS)
      .eq("id", creativeId)
      .in("campaign_id", ids)
      .maybeSingle();
    if (error || !data) return null;
    return toSubmittedCreative(data);
  } catch {
    return null;
  }
}

type SignClient = {
  storage: {
    from: (bucket: string) => {
      createSignedUrls: (
        paths: string[],
        expiresIn: number,
      ) => Promise<{ data: { path: string | null; signedUrl: string | null; error: string | null }[] | null; error: unknown }>;
    };
  };
};

/**
 * Private bucket ki images ke liye chhote (1 ghanta) signed URLs. Storage policy khud rokti hai: advertiser sirf apne folder ki,
 * admin sab, doosre kisi ki nahi (unke liye URL banta hi nahi). Fail hone par khali map: page images ke bina bhi chalta hai.
 */
export async function signAssetUrls(client: SignClient, paths: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => typeof p === "string" && p.length > 0))];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  try {
    const { data, error } = await client.storage.from(ASSET_BUCKET).createSignedUrls(unique, SIGNED_URL_SECONDS);
    if (error || !data) return out;
    for (const row of data) {
      if (row.path && row.signedUrl && !row.error) out.set(row.path, row.signedUrl);
    }
  } catch {
    // images ke bina chalo
  }
  return out;
}
