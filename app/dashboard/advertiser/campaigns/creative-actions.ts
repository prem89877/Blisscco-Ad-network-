"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { countReviewableCreatives, loadMyAdvertiser, loadMyCampaign } from "@/lib/campaigns/queries";
import { isUuid } from "@/lib/campaigns/constants";
import { logDbError, mapDbError } from "@/lib/campaigns/errors";
import { utcToday } from "@/lib/campaigns/validation";
import { ASSET_BUCKET, ASSET_LIMITS, buildAssetPath, type AssetKind } from "@/lib/campaigns/creative-assets";
import { checkFile, removeQuietly, uploadedPaths } from "@/lib/campaigns/creative-upload";
import {
  CREATIVE_ACTIONS,
  MAX_CREATIVES_PER_CAMPAIGN,
  isCreativeAction,
  isCreativeStatus,
  parseCreativeForm,
  readCreativeValues,
  type CreativeFormState,
} from "@/lib/campaigns/creative-validation";
import { pilotTotalProblem } from "@/lib/campaigns/pilot-guard";
import { REVIEW_ACTIONS, SUBMIT_BLOCK_MESSAGES, checkSubmitCampaign, isReviewAction } from "@/lib/campaigns/review";
import type { RunStateResult } from "@/lib/campaigns/types";

// Ad (creative) banana / review ke liye bhejna, aur campaign ko review ke liye bhejna.
// Har action: (1) role + active advertiser server par, (2) campaign sirf apne advertiser ka, (3) validation, (4) RLS ke andar database.
// Final rok database trigger (day-3-5) hai. Service-role key yahan kahin nahi.

const LIST_PATH = "/dashboard/advertiser/campaigns";

async function requireActiveAdvertiser(): Promise<{ id: string } | { error: string }> {
  // Role check aur advertiser ki row ek doosre par nirbhar nahi: saath chalao (ek database round trip kam).
  // requireRole redirect karta hai (throw) toh Promise.all wahi redirect aage badhata hai; loadMyAdvertiser kabhi throw nahi karta.
  const [, { advertiser: adv, failed }] = await Promise.all([requireRole(["advertiser"]), loadMyAdvertiser()]);
  if (failed) return { error: "Something went wrong. Please try again." };
  if (!adv) return { error: "Your advertiser account was not found. Please set up your business first." };
  if (adv.status !== "active") return { error: "Your advertiser account is not approved yet, so changes are not allowed." };
  return { id: adv.id };
}

function readId(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  return typeof v === "string" && isUuid(v) ? v : null;
}

type PickedFile = { file: File } | { none: true } | { invalid: true };

/** File input se File nikalo. Khali input (size 0 / naam khali) = "chuna nahi" (images yahan optional hain). */
function pickFile(fd: FormData, key: string): PickedFile {
  const v = fd.get(key);
  if (v === null) return { none: true };
  if (typeof v === "string") return v.length === 0 ? { none: true } : { invalid: true };
  if (v.size === 0 && v.name === "") return { none: true };
  return { file: v };
}

export async function createCreative(_prev: CreativeFormState, formData: FormData): Promise<CreativeFormState> {
  const values = readCreativeValues(formData);
  const adv = await requireActiveAdvertiser();
  if ("error" in adv) return { status: "error", message: adv.error, values };

  const campaignId = readId(formData, "campaignId");
  if (!campaignId) return { status: "error", message: "Campaign not found.", values };

  const loaded = await loadMyCampaign(adv.id, campaignId);
  if (loaded.failed) return { status: "error", message: "Something went wrong. Please try again.", values };
  if (!loaded.campaign) return { status: "error", message: "Campaign not found.", values };
  if (loaded.campaign.status === "archived" || loaded.campaign.status === "completed") {
    return { status: "error", message: "Ads cannot be added to a closed campaign.", values };
  }

  const parsed = parseCreativeForm(values);
  if (!parsed.ok) {
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors: parsed.errors, values };
  }

  // --- Images (logo + ad image): dono optional. Chuni hui file ki poori jaanch (type, size, asli bytes, dimensions) server par. ---
  const picks: Record<AssetKind, PickedFile> = { logo: pickFile(formData, "logo"), banner: pickFile(formData, "banner") };
  const checked: Partial<Record<AssetKind, { mime: string; ext: "png" | "jpg" | "webp"; bytes: Uint8Array }>> = {};
  const imageErrors: Partial<Record<AssetKind, string>> = {};
  for (const kind of ["logo", "banner"] as const) {
    const pick = picks[kind];
    if ("invalid" in pick) {
      imageErrors[kind] = `${ASSET_LIMITS[kind].label} must be a PNG, JPG or WebP image.`;
    } else if ("file" in pick) {
      const { check, bytes } = await checkFile(kind, pick.file);
      if (!check.ok || bytes === null) imageErrors[kind] = check.ok ? "Something went wrong. Please try again." : check.error;
      else checked[kind] = { mime: check.mime, ext: check.ext, bytes };
    }
  }
  if (Object.keys(imageErrors).length > 0) {
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors: imageErrors, values };
  }

  const supabase = await createClient();
  const { count } = await supabase
    .from("ad_creatives")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .neq("status", "archived");
  if (typeof count === "number" && count >= MAX_CREATIVES_PER_CAMPAIGN) {
    return { status: "error", message: `A campaign can have at most ${MAX_CREATIVES_PER_CAMPAIGN} ads. Archive an old one first.`, values };
  }

  // --- Upload (advertiser ke apne session se; storage policy folder ownership rokti hai) ---
  const uploaded: Partial<Record<AssetKind, string>> = {};
  for (const kind of ["logo", "banner"] as const) {
    const item = checked[kind];
    if (!item) continue;
    const path = buildAssetPath({ advertiserId: adv.id, campaignId, kind, ext: item.ext, randomId: randomUUID() });
    if (!path) {
      await removeQuietly(supabase.storage, uploadedPaths(uploaded));
      return { status: "error", message: "Something went wrong. Please try again.", values };
    }
    const { error: uploadError } = await supabase.storage.from(ASSET_BUCKET).upload(path, item.bytes, { contentType: item.mime, upsert: false, cacheControl: "3600" });
    if (uploadError) {
      console.error("[creatives] upload failed", { kind });
      await removeQuietly(supabase.storage, uploadedPaths(uploaded));
      return { status: "error", message: "The image could not be uploaded. Please try again.", values };
    }
    uploaded[kind] = path;
  }

  const { error } = await supabase.from("ad_creatives").insert({
    campaign_id: campaignId,
    headline: parsed.value.headline,
    body: parsed.value.body,
    cta_text: parsed.value.ctaText,
    destination_url: parsed.value.destinationUrl,
    ...(uploaded.logo ? { logo_path: uploaded.logo } : {}),
    ...(uploaded.banner ? { banner_path: uploaded.banner } : {}),
  });
  if (error) {
    logDbError("creative create", error);
    await removeQuietly(supabase.storage, uploadedPaths(uploaded));
    return { status: "error", message: mapDbError(error), values };
  }

  revalidatePath(`${LIST_PATH}/${campaignId}`);
  redirect(`${LIST_PATH}/${campaignId}?creative=added`);
}

export async function changeCreativeStatus(_prev: RunStateResult, formData: FormData): Promise<RunStateResult> {
  const adv = await requireActiveAdvertiser();
  if ("error" in adv) return { status: "error", message: adv.error };

  const creativeId = readId(formData, "creativeId");
  const action = formData.get("action");
  if (!creativeId || !isCreativeAction(action)) return { status: "error", message: "Ad not found." };
  const rule = CREATIVE_ACTIONS[action];

  const supabase = await createClient();
  const { data: row, error: readError } = await supabase
    .from("ad_creatives")
    .select("id, campaign_id, status")
    .eq("id", creativeId)
    .maybeSingle();
  if (readError) return { status: "error", message: "Something went wrong. Please try again." };
  const found = row as { campaign_id?: unknown; status?: unknown } | null;
  if (!found || typeof found.campaign_id !== "string" || !isCreativeStatus(found.status)) {
    return { status: "error", message: "Ad not found." };
  }

  // Ad sirf apne advertiser ke campaign ka ho (RLS ke upar doosri jaanch)
  const loaded = await loadMyCampaign(adv.id, found.campaign_id);
  if (loaded.failed) return { status: "error", message: "Something went wrong. Please try again." };
  if (!loaded.campaign) return { status: "error", message: "Ad not found." };

  // Band (archived/completed) campaign ka ad review ke liye nahi bheja ja sakta: admin function band campaign par decide nahi karta, ad atak jata.
  if (action === "submit" && (loaded.campaign.status === "archived" || loaded.campaign.status === "completed")) {
    return { status: "error", message: "Ads cannot be sent for review in a closed campaign." };
  }

  if (!rule.from.includes(found.status)) {
    return { status: "error", message: "This ad cannot be changed that way right now. Refresh the page to see the latest status." };
  }

  const { data, error } = await supabase
    .from("ad_creatives")
    .update({ status: rule.to })
    .eq("id", creativeId)
    .eq("campaign_id", found.campaign_id)
    .eq("status", found.status)
    .select("id");
  if (error) {
    logDbError(`creative ${action}`, error);
    return { status: "error", message: mapDbError(error) };
  }
  if (!data || data.length === 0) {
    return { status: "error", message: "This ad changed in the meantime. Refresh the page to see the latest status." };
  }

  revalidatePath(`${LIST_PATH}/${found.campaign_id}`);
  redirect(`${LIST_PATH}/${found.campaign_id}?creative=${action}`);
}

export async function changeCampaignReviewState(_prev: RunStateResult, formData: FormData): Promise<RunStateResult> {
  const adv = await requireActiveAdvertiser();
  if ("error" in adv) return { status: "error", message: adv.error };

  const campaignId = readId(formData, "campaignId");
  const action = formData.get("action");
  if (!campaignId || !isReviewAction(action)) return { status: "error", message: "Campaign not found." };
  const rule = REVIEW_ACTIONS[action];

  // "Review ke liye bhejo" me campaign aur reviewable ads ki ginti ek doosre par nirbhar nahi: saath padhte hain.
  const [loaded, reviewable] = await Promise.all([
    loadMyCampaign(adv.id, campaignId),
    action === "submit" ? countReviewableCreatives(campaignId) : Promise.resolve(null),
  ]);
  if (loaded.failed) return { status: "error", message: "Something went wrong. Please try again." };
  const current = loaded.campaign;
  if (!current) return { status: "error", message: "Campaign not found." };
  if (current.status !== rule.from) {
    return { status: "error", message: "This campaign's status changed. Refresh the page to see the latest status." };
  }

  if (action === "submit") {
    const check = checkSubmitCampaign(current, reviewable, utcToday());
    if (!check.ok) return { status: "error", message: SUBMIT_BLOCK_MESSAGES[check.reason] };
  }

  // Rejected campaign wapas draft me aaye toh wo dobara advertiser ke pilot total ($2,000) me ginta jayega: pehle jaancho.
  if (action === "reopen") {
    const pilotProblem = await pilotTotalProblem(adv.id, current.totalBudget, current.id);
    if (pilotProblem) return { status: "error", message: pilotProblem };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaigns")
    .update({ status: rule.to })
    .eq("id", campaignId)
    .eq("advertiser_id", adv.id)
    .eq("status", rule.from)
    .select("id");
  if (error) {
    logDbError(`campaign ${action}`, error);
    return { status: "error", message: mapDbError(error) };
  }
  if (!data || data.length === 0) {
    return { status: "error", message: "This campaign changed in the meantime. Refresh the page to see the latest status." };
  }

  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${campaignId}`);
  redirect(`${LIST_PATH}/${campaignId}?review=${action}`);
}
