"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getCampaignSpend, getCreativeSummary, loadMyAdvertiser, loadMyCampaign } from "@/lib/campaigns/queries";
import { CATEGORY_EDITABLE_STATUSES, EDIT_LOCKED_STATUSES, STATUS_LABELS, isCategory, isUuid } from "@/lib/campaigns/constants";
import { parseCampaignForm, readFormValues, utcToday } from "@/lib/campaigns/validation";
import { logDbError, mapDbError } from "@/lib/campaigns/errors";
import { BELOW_SPEND_MESSAGE, SPEND_UNKNOWN_MESSAGE, isBelowSpend } from "@/lib/campaigns/budget";
import { PAUSE_BLOCK_MESSAGE, RESUME_BLOCK_MESSAGES, canPause, checkResume } from "@/lib/campaigns/run-state";
import type { CampaignFormState, RunStateResult } from "@/lib/campaigns/types";

const LIST_PATH = "/dashboard/advertiser/campaigns";

// Har action: (1) server par role check, (2) advertiser DB se nikalna (form se kabhi nahi),
// (3) validation, (4) RLS ke andar database call. Service-role key kahin use nahi hoti.

async function requireActiveAdvertiser(): Promise<{ id: string } | { error: string }> {
  await requireRole(["advertiser"]);
  const { advertiser: adv, failed } = await loadMyAdvertiser();
  // Database dikkat = "account nahi mila" nahi: alag, saaf message.
  if (failed) return { error: "Something went wrong. Please try again." };
  if (!adv) return { error: "Your advertiser account was not found. Please log out, log in again, or contact support." };
  if (adv.status !== "active") return { error: "Your advertiser account is not active, so campaigns cannot be changed." };
  return { id: adv.id };
}

function readCampaignId(formData: FormData): string | null {
  const v = formData.get("campaignId");
  return typeof v === "string" && isUuid(v) ? v : null;
}

export async function createCampaign(_prev: CampaignFormState, formData: FormData): Promise<CampaignFormState> {
  const values = readFormValues(formData);
  const adv = await requireActiveAdvertiser();
  if ("error" in adv) return { status: "error", message: adv.error, values };

  const parsed = parseCampaignForm(values, { todayUtc: utcToday() });
  if (!parsed.ok) {
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors: parsed.errors, values };
  }
  const v = parsed.value;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaigns")
    .insert({
      advertiser_id: adv.id,
      name: v.name,
      description: v.description,
      category: v.category,
      total_budget: v.totalBudget,
      daily_budget: v.dailyBudget,
      start_date: v.startDate,
      end_date: v.endDate,
    })
    .select("id")
    .single();

  if (error || !data) {
    logDbError("create", error);
    return { status: "error", message: mapDbError(error), values };
  }

  revalidatePath(LIST_PATH);
  const id = (data as { id?: unknown }).id;
  // redirect() try/catch ke bahar; id database se aaya hai aur UUID check ho chuka.
  if (typeof id === "string" && isUuid(id)) redirect(`${LIST_PATH}/${id}?created=1`);
  redirect(LIST_PATH);
}

export async function updateCampaign(_prev: CampaignFormState, formData: FormData): Promise<CampaignFormState> {
  const values = readFormValues(formData);
  const adv = await requireActiveAdvertiser();
  if ("error" in adv) return { status: "error", message: adv.error, values };

  const id = readCampaignId(formData);
  if (!id) return { status: "error", message: "Campaign not found.", values };

  const loaded = await loadMyCampaign(adv.id, id);
  if (loaded.failed) return { status: "error", message: "Something went wrong. Please try again.", values };
  const current = loaded.campaign;
  if (!current) return { status: "error", message: "Campaign not found.", values };
  if (EDIT_LOCKED_STATUSES.includes(current.status)) {
    return {
      status: "error",
      message: `This campaign is locked while its status is ${STATUS_LABELS[current.status]}.`,
      values,
    };
  }

  // Form kholne ke baad campaign kisi aur tab/device se badal gaya? Toh chupchap overwrite nahi karte.
  // Ye hidden field user badal bhi de toh sirf "stale" error milta hai; ownership isse tay nahi hoti.
  const expected = formData.get("expectedUpdatedAt");
  if (typeof expected !== "string" || expected !== current.updatedAt) {
    return {
      status: "error",
      message: "This campaign was changed since you opened this form. Reload the page to see the latest version, then edit again.",
      values,
    };
  }

  const categoryLocked = !CATEGORY_EDITABLE_STATUSES.includes(current.status);
  const parsed = parseCampaignForm(values, {
    todayUtc: utcToday(),
    existing: {
      startDate: current.startDate,
      category: current.category,
      categoryLocked,
      totalBudget: current.totalBudget,
      dailyBudget: current.dailyBudget,
      endDate: current.endDate,
    },
  });
  if (!parsed.ok) {
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors: parsed.errors, values };
  }
  const v = parsed.value;

  // Total budget ab tak ke kharch se neeche nahi ja sakta (warna campaign chupchap khatam ho jata hai par "Active" dikhta hai).
  // Active/paused me kharch na padh paye toh edit rokte hain (fail-closed). Draft/rejected me kharch 0 hota hai: padh na paye toh aage badhte hain.
  // NOTE: padhne aur likhne ke beech ek serve ho sakta hai; DB-level guard alag approval wali migration se aayega (DAY9-PART1-CAMPAIGNS.md).
  if (v.totalBudget !== current.totalBudget) {
    const spend = await getCampaignSpend(current.id);
    if (spend === null && (current.status === "active" || current.status === "paused")) {
      return { status: "error", message: SPEND_UNKNOWN_MESSAGE, values };
    }
    if (spend !== null && isBelowSpend(v.totalBudget, spend.spentTotal)) {
      const spent = `$${spend.spentTotal.toFixed(4)}`;
      return {
        status: "error",
        message: "Please fix the highlighted fields.",
        fieldErrors: { totalBudget: BELOW_SPEND_MESSAGE(spent) },
        values,
      };
    }
  }

  const patch: Record<string, unknown> = {
    name: v.name,
    description: v.description,
    total_budget: v.totalBudget,
    daily_budget: v.dailyBudget,
    start_date: v.startDate,
    end_date: v.endDate,
  };
  if (!categoryLocked && (isCategory(v.category) || v.category === current.category)) patch.category = v.category;

  const supabase = await createClient();
  // .eq("status") + .eq("updated_at"): agar read aur write ke beech campaign badal gaya toh 0 rows milengi
  // (lost update nahi). .eq("advertiser_id") defense in depth hai; asli rok RLS + trigger hai.
  const { data, error } = await supabase
    .from("campaigns")
    .update(patch)
    .eq("id", id)
    .eq("advertiser_id", adv.id)
    .eq("status", current.status)
    .eq("updated_at", current.updatedAt)
    .select("id");

  if (error) {
    logDbError("update", error);
    return { status: "error", message: mapDbError(error), values };
  }
  if (!data || data.length === 0) {
    return {
      status: "error",
      message: "This campaign changed or can no longer be edited. Open it again to see the latest version.",
      values,
    };
  }

  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${id}`);
  redirect(`${LIST_PATH}/${id}?updated=1`);
}

async function changeRunState(formData: FormData, to: "paused" | "active"): Promise<RunStateResult> {
  // Expired session => requireRole /login par redirect karta hai. Role/account status server par check hota hai.
  const adv = await requireActiveAdvertiser();
  if ("error" in adv) return { status: "error", message: adv.error };

  const id = readCampaignId(formData);
  if (!id) return { status: "error", message: "Campaign not found." };

  // Button/form ki state par bharosa nahi: campaign server par dobara padhte hain (sirf apne advertiser ka).
  const loaded = await loadMyCampaign(adv.id, id);
  if (loaded.failed) return { status: "error", message: "Something went wrong. Please try again." };
  const current = loaded.campaign;
  if (!current) return { status: "error", message: "Campaign not found." };

  const from = to === "paused" ? "active" : "paused";
  if (to === "paused") {
    if (!canPause(current.status)) return { status: "error", message: PAUSE_BLOCK_MESSAGE };
  } else {
    const creatives = await getCreativeSummary(current.id);
    const check = checkResume(current, creatives ? creatives.approved : null, utcToday());
    if (!check.ok) return { status: "error", message: RESUME_BLOCK_MESSAGES[check.reason] };
  }

  const supabase = await createClient();
  // .eq("status", from): beech me status badal gaya toh 0 rows (galat transition nahi hota).
  // Final guard database trigger + RLS hai (resume par approved creative aur end_date wahan bhi check hote hain).
  const { data, error } = await supabase
    .from("campaigns")
    .update({ status: to })
    .eq("id", id)
    .eq("advertiser_id", adv.id)
    .eq("status", from)
    .select("id");

  if (error) {
    logDbError(`set ${to}`, error);
    return { status: "error", message: mapDbError(error) };
  }
  if (!data || data.length === 0) {
    return { status: "error", message: to === "paused" ? PAUSE_BLOCK_MESSAGE : RESUME_BLOCK_MESSAGES.not_paused };
  }

  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${id}`);
  // Redirect: page naye status ke saath dobara load hota hai aur success notice page par dikhta hai
  // (button badalne par button ke andar ka message gayab ho jata, isliye).
  redirect(`${LIST_PATH}/${id}?${to === "paused" ? "paused" : "resumed"}=1`);
}

export async function pauseCampaign(_prev: RunStateResult, formData: FormData): Promise<RunStateResult> {
  return changeRunState(formData, "paused");
}

export async function resumeCampaign(_prev: RunStateResult, formData: FormData): Promise<RunStateResult> {
  return changeRunState(formData, "active");
}
