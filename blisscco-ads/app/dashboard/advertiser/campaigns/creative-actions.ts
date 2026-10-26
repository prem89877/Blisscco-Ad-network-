"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { countReviewableCreatives, loadMyAdvertiser, loadMyCampaign } from "@/lib/campaigns/queries";
import { isUuid } from "@/lib/campaigns/constants";
import { logDbError, mapDbError } from "@/lib/campaigns/errors";
import { utcToday } from "@/lib/campaigns/validation";
import {
  CREATIVE_ACTIONS,
  MAX_CREATIVES_PER_CAMPAIGN,
  isCreativeAction,
  isCreativeStatus,
  parseCreativeForm,
  readCreativeValues,
  type CreativeFormState,
} from "@/lib/campaigns/creative-validation";
import { REVIEW_ACTIONS, SUBMIT_BLOCK_MESSAGES, checkSubmitCampaign, isReviewAction } from "@/lib/campaigns/review";
import type { RunStateResult } from "@/lib/campaigns/types";

// Ad (creative) banana / review ke liye bhejna, aur campaign ko review ke liye bhejna.
// Har action: (1) role + active advertiser server par, (2) campaign sirf apne advertiser ka, (3) validation, (4) RLS ke andar database.
// Final rok database trigger (day-3-5) hai. Service-role key yahan kahin nahi.

const LIST_PATH = "/dashboard/advertiser/campaigns";

async function requireActiveAdvertiser(): Promise<{ id: string } | { error: string }> {
  await requireRole(["advertiser"]);
  const { advertiser: adv, failed } = await loadMyAdvertiser();
  if (failed) return { error: "Something went wrong. Please try again." };
  if (!adv) return { error: "Your advertiser account was not found. Please set up your business first." };
  if (adv.status !== "active") return { error: "Your advertiser account is not approved yet, so changes are not allowed." };
  return { id: adv.id };
}

function readId(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  return typeof v === "string" && isUuid(v) ? v : null;
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

  const supabase = await createClient();
  const { count } = await supabase
    .from("ad_creatives")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .neq("status", "archived");
  if (typeof count === "number" && count >= MAX_CREATIVES_PER_CAMPAIGN) {
    return { status: "error", message: `A campaign can have at most ${MAX_CREATIVES_PER_CAMPAIGN} ads. Archive an old one first.`, values };
  }

  const { error } = await supabase.from("ad_creatives").insert({
    campaign_id: campaignId,
    headline: parsed.value.headline,
    body: parsed.value.body,
    cta_text: parsed.value.ctaText,
    destination_url: parsed.value.destinationUrl,
  });
  if (error) {
    logDbError("creative create", error);
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

  const loaded = await loadMyCampaign(adv.id, campaignId);
  if (loaded.failed) return { status: "error", message: "Something went wrong. Please try again." };
  const current = loaded.campaign;
  if (!current) return { status: "error", message: "Campaign not found." };
  if (current.status !== rule.from) {
    return { status: "error", message: "This campaign's status changed. Refresh the page to see the latest status." };
  }

  if (action === "submit") {
    const reviewable = await countReviewableCreatives(current.id);
    const check = checkSubmitCampaign(current, reviewable, utcToday());
    if (!check.ok) return { status: "error", message: SUBMIT_BLOCK_MESSAGES[check.reason] };
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
