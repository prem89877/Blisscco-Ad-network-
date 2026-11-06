"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadMyAdvertiser, loadMyCampaign } from "@/lib/campaigns/queries";
import { isUuid } from "@/lib/campaigns/constants";
import { logDbError, mapDbError } from "@/lib/campaigns/errors";
import { MAX_CREATIVES_PER_CAMPAIGN } from "@/lib/campaigns/creative-validation";
import {
  ASSET_BUCKET,
  ASSET_LIMITS,
  buildAssetPath,
  isOwnedAssetPath,
  type AssetKind,
} from "@/lib/campaigns/creative-assets";
import { checkFile, removeQuietly, uploadedPaths } from "@/lib/campaigns/creative-upload";
import {
  SUBMITTED_CREATIVE_COLUMNS,
  canEditAndResubmit,
  parseSubmission,
  readSubmissionValues,
  toSubmittedCreative,
  type SubmissionField,
  type SubmissionFormState,
} from "@/lib/campaigns/creative-submission";

// Advertiser ka "Submit an ad": text + logo + banner + campaign. Har kadam server par:
//  (1) role + ACTIVE advertiser, (2) campaign sirf apne advertiser ka (RLS ke upar doosri jaanch),
//  (3) validation (text, URL, image ka type / size / asli bytes), (4) upload advertiser ke apne session se (storage policy rokti hai),
//  (5) ad "draft" banta hai (database trigger sirf draft insert hone deta hai) aur turant "pending_review" hota hai.
// Kabhi approve nahi hota: approval sirf admin function se. Service-role key yahan kahin nahi.

const LIST_PATH = "/dashboard/advertiser/creatives";
const CAMPAIGN_PATH = "/dashboard/advertiser/campaigns";
const GENERIC = "Something went wrong. Please try again.";

async function requireActiveAdvertiser(): Promise<{ id: string } | { error: string }> {
  const [, { advertiser: adv, failed }] = await Promise.all([requireRole(["advertiser"]), loadMyAdvertiser()]);
  if (failed) return { error: GENERIC };
  if (!adv) return { error: "Your advertiser account was not found. Please set up your business first." };
  if (adv.status !== "active") return { error: "Your advertiser account is not approved yet, so ads cannot be submitted." };
  return { id: adv.id };
}

function readId(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  return typeof v === "string" && isUuid(v) ? v : null;
}

type PickedFile = { file: File } | { none: true } | { invalid: true };

/** File input se File nikalo. Khali input (size 0 / naam khali) = "chuna nahi". */
function pickFile(fd: FormData, key: string): PickedFile {
  const v = fd.get(key);
  if (v === null) return { none: true };
  if (typeof v === "string") return v.length === 0 ? { none: true } : { invalid: true };
  if (v.size === 0 && v.name === "") return { none: true };
  return { file: v };
}

/**
 * Naya ad (creativeId nahi) ya rejected/draft ad ka edit + dobara bhejna (creativeId hai).
 * Dono me ant me status "pending_review".
 */
export async function submitCreative(_prev: SubmissionFormState, formData: FormData): Promise<SubmissionFormState> {
  const values = readSubmissionValues(formData);
  const adv = await requireActiveAdvertiser();
  if ("error" in adv) return { status: "error", message: adv.error, values };

  const creativeId = readId(formData, "creativeId");
  const rawCreativeId = formData.get("creativeId");
  if (typeof rawCreativeId === "string" && rawCreativeId.length > 0 && !creativeId) {
    return { status: "error", message: "Ad not found.", values };
  }

  const supabase = await createClient();

  // --- Existing ad (edit): sirf apne campaign ka, aur sirf draft / rejected ---
  let existing = null as ReturnType<typeof toSubmittedCreative>;
  let campaignId = readId(formData, "campaignId");
  if (creativeId) {
    const { data, error } = await supabase.from("ad_creatives").select(SUBMITTED_CREATIVE_COLUMNS).eq("id", creativeId).maybeSingle();
    if (error) return { status: "error", message: GENERIC, values };
    existing = data ? toSubmittedCreative(data) : null;
    if (!existing) return { status: "error", message: "Ad not found.", values };
    campaignId = existing.campaignId; // campaign badla nahi ja sakta
    values.campaignId = existing.campaignId;
  }
  if (!campaignId) return { status: "error", message: "Please fix the highlighted fields.", fieldErrors: { campaignId: "Choose one of your campaigns." }, values };

  // --- Campaign ownership ---
  const loaded = await loadMyCampaign(adv.id, campaignId);
  if (loaded.failed) return { status: "error", message: GENERIC, values };
  if (!loaded.campaign) return { status: "error", message: existing ? "Ad not found." : "Campaign not found.", values };
  if (loaded.campaign.status === "archived" || loaded.campaign.status === "completed") {
    return { status: "error", message: "Ads cannot be added to a closed campaign.", values };
  }
  if (existing && !canEditAndResubmit(existing.status)) {
    return { status: "error", message: "This ad cannot be edited right now. Only draft or rejected ads can be edited.", values };
  }

  // --- Validation (text) ---
  const parsed = parseSubmission(values);
  const fieldErrors: Partial<Record<SubmissionField, string>> = parsed.ok ? {} : { ...parsed.errors };

  // --- Validation (images). Naye ad me dono zaroori; edit me sirf badalne ke liye. ---
  const picks: Record<AssetKind, PickedFile> = { logo: pickFile(formData, "logo"), banner: pickFile(formData, "banner") };
  const checked: Partial<Record<AssetKind, { mime: string; ext: "png" | "jpg" | "webp"; bytes: Uint8Array }>> = {};
  for (const kind of ["logo", "banner"] as const) {
    const pick = picks[kind];
    if ("invalid" in pick) {
      fieldErrors[kind] = `${ASSET_LIMITS[kind].label} must be a PNG, JPG or WebP image.`;
    } else if ("none" in pick) {
      const hasOld = existing && (kind === "logo" ? existing.logoPath : existing.bannerPath);
      if (!hasOld) fieldErrors[kind] = `Choose a ${ASSET_LIMITS[kind].label.toLowerCase()} image.`;
    } else {
      const { check, bytes } = await checkFile(kind, pick.file);
      if (!check.ok || bytes === null) fieldErrors[kind] = check.ok ? GENERIC : check.error;
      else checked[kind] = { mime: check.mime, ext: check.ext, bytes };
    }
  }
  if (Object.keys(fieldErrors).length > 0 || !parsed.ok) {
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors, values };
  }
  const input = parsed.value;

  // --- Limit (sirf naye ad par) ---
  if (!existing) {
    const { count } = await supabase
      .from("ad_creatives")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .neq("status", "archived");
    if (typeof count === "number" && count >= MAX_CREATIVES_PER_CAMPAIGN) {
      return { status: "error", message: `A campaign can have at most ${MAX_CREATIVES_PER_CAMPAIGN} ads. Archive an old one first.`, values };
    }
  }

  // --- Upload (advertiser ke apne session se; storage policy folder ownership rokti hai) ---
  const uploaded: Partial<Record<AssetKind, string>> = {};
  for (const kind of ["logo", "banner"] as const) {
    const item = checked[kind];
    if (!item) continue;
    const path = buildAssetPath({ advertiserId: adv.id, campaignId, kind, ext: item.ext, randomId: randomUUID() });
    if (!path) {
      await removeQuietly(supabase.storage, uploadedPaths(uploaded));
      return { status: "error", message: GENERIC, values };
    }
    const { error } = await supabase.storage.from(ASSET_BUCKET).upload(path, item.bytes, { contentType: item.mime, upsert: false, cacheControl: "3600" });
    if (error) {
      console.error("[creatives] upload failed", { kind });
      await removeQuietly(supabase.storage, uploadedPaths(uploaded));
      return { status: "error", message: "The image could not be uploaded. Please try again.", values };
    }
    uploaded[kind] = path;
  }
  const logoPath = uploaded.logo ?? existing?.logoPath ?? null;
  const bannerPath = uploaded.banner ?? existing?.bannerPath ?? null;
  // Purani image ki path bhi apne hi advertiser/campaign ki honi chahiye (kharab row par bharosa nahi)
  if (
    (logoPath && !isOwnedAssetPath(logoPath, adv.id, campaignId, "logo")) ||
    (bannerPath && !isOwnedAssetPath(bannerPath, adv.id, campaignId, "banner"))
  ) {
    await removeQuietly(supabase.storage, uploadedPaths(uploaded));
    return { status: "error", message: GENERIC, values };
  }

  const content = {
    headline: input.headline,
    body: input.body,
    cta_text: input.ctaText,
    destination_url: input.destinationUrl,
    brand_name: input.brandName,
    logo_path: logoPath,
    banner_path: bannerPath,
    keywords: input.keywords,
  };

  // --- Database: draft banao / content badlo ---
  let id: string;
  if (existing) {
    const { data, error } = await supabase
      .from("ad_creatives")
      .update(content)
      .eq("id", existing.id)
      .eq("campaign_id", campaignId)
      .in("status", ["draft", "rejected"])
      .select("id");
    if (error || !data || data.length === 0) {
      if (error) logDbError("creative resubmit (edit)", error);
      await removeQuietly(supabase.storage, uploadedPaths(uploaded));
      return {
        status: "error",
        message: error ? mapDbError(error) : "This ad changed in the meantime. Refresh the page to see the latest status.",
        values,
      };
    }
    id = existing.id;
  } else {
    const { data, error } = await supabase
      .from("ad_creatives")
      .insert({ campaign_id: campaignId, ...content })
      .select("id")
      .single();
    const newId = (data as { id?: unknown } | null)?.id;
    if (error || typeof newId !== "string") {
      if (error) logDbError("creative submit (insert)", error);
      await removeQuietly(supabase.storage, uploadedPaths(uploaded));
      return { status: "error", message: error ? mapDbError(error) : GENERIC, values };
    }
    id = newId;
  }

  // Rejected ad bina badlaav ke bheja gaya ho toh trigger ne status draft nahi kiya: pehle rejected -> draft (allowed badlaav).
  // Agar trigger pehle hi draft kar chuka hai toh ye update koi row nahi chhuta.
  if (existing && existing.status === "rejected") {
    await supabase.from("ad_creatives").update({ status: "draft" }).eq("id", id).eq("campaign_id", campaignId).eq("status", "rejected");
  }

  // --- Review ke liye bhejo: draft -> pending_review (kabhi approved nahi) ---
  const { data: sent, error: sendError } = await supabase
    .from("ad_creatives")
    .update({ status: "pending_review" })
    .eq("id", id)
    .eq("campaign_id", campaignId)
    .eq("status", "draft")
    .select("id");

  // Purani image badal gayi: purani file hata do (best-effort).
  const replaced: string[] = [];
  if (uploaded.logo && existing?.logoPath) replaced.push(existing.logoPath);
  if (uploaded.banner && existing?.bannerPath) replaced.push(existing.bannerPath);
  await removeQuietly(supabase.storage, replaced);

  revalidatePath(LIST_PATH);
  revalidatePath(`${CAMPAIGN_PATH}/${campaignId}`);

  if (sendError || !sent || sent.length === 0) {
    if (sendError) logDbError("creative submit (send for review)", sendError);
    // Ad save ho chuka hai par review me nahi gaya: jhoota success nahi dikhate.
    redirect(`${LIST_PATH}?result=draft`);
  }
  redirect(`${LIST_PATH}?result=${existing ? "resubmitted" : "submitted"}`);
}
