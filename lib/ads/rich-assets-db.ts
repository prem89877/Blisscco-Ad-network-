import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { ASSET_BUCKET, BANNER_MAX_BYTES } from "@/lib/campaigns/creative-assets";
import { parseRichAssetResult, type RichAssetRecord } from "./rich-assets";

// Rich Ad Delivery ke liye server-side database / storage pul. Service-role key SIRF createAdminClient() ke andar hai.
// Sirf PADHTA hai: rpc get_creative_rich_assets (phase4-step3b-1, read-only) aur private bucket se download.
// Koi insert/update ya paise wala kaam yahan nahi. Log me sirf static label / error code (path, id, brand kabhi nahi).

export type RichLookup = { outcome: "ok"; record: RichAssetRecord } | { outcome: "not_found" } | { outcome: "error" };

export async function lookupRichAssets(creativeId: string): Promise<RichLookup> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("get_creative_rich_assets", { p_creative_id: creativeId });
    if (error) {
      console.error("[ads/rich] lookup rpc failed", error.code ?? "unknown");
      return { outcome: "error" };
    }
    const record = parseRichAssetResult(data);
    return record ? { outcome: "ok", record } : { outcome: "not_found" };
  } catch {
    console.error("[ads/rich] lookup unexpected failure");
    return { outcome: "error" };
  }
}

/** Private bucket se file ke bytes. Nahi mili / bahut badi / koi bhi gadbad => null (caller 404 deta hai). */
export async function downloadStoredImage(path: string): Promise<Uint8Array | null> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.storage.from(ASSET_BUCKET).download(path);
    if (error || !data) return null;
    if (typeof data.size === "number" && data.size > BANNER_MAX_BYTES) return null;
    return new Uint8Array(await data.arrayBuffer());
  } catch {
    return null;
  }
}
