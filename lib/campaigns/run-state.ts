import type { CampaignDbStatus } from "./constants";
import { remainingBudget } from "./budget";

// Pause / Resume ke niyam (pure functions: server action aur page dono yahi use karte hain).
// Asli rok database trigger (day-4-1 guard) hai; yahan sirf friendly check aur button dikhane ka faisla.
// Pause hone par ads dikhna band ho jaata hai (matching sirf active campaigns chunti hai).

export function canPause(status: CampaignDbStatus): boolean {
  return status === "active";
}

export type ResumeBlockReason = "not_paused" | "ended" | "no_approved_creative" | "budget_used";
export type ResumeCheck = { ok: true } | { ok: false; reason: ResumeBlockReason };

/**
 * approvedCreatives = null matlab "pata nahi chala" (load fail): block nahi karte, database final faisla karega.
 * spentTotal (optional) = ab tak ka kharch; null/undefined = pata nahi: block nahi (database trigger final faisla karta hai).
 * Poora kharch ho chuka total budget (bacha 0) toh resume nahi: wo campaign "Active" dikhta par kabhi serve nahi hota.
 * Database ek serve ki keemat se kam bacha ho tab bhi rokta hai; yahan sirf saaf "0 bacha" wala friendly check hai.
 * todayUtc = "YYYY-MM-DD".
 */
export function checkResume(
  campaign: { status: CampaignDbStatus; endDate: string | null; totalBudget?: number },
  approvedCreatives: number | null,
  todayUtc: string,
  spentTotal?: number | null,
): ResumeCheck {
  if (campaign.status !== "paused") return { ok: false, reason: "not_paused" };
  if (campaign.endDate !== null && campaign.endDate < todayUtc) return { ok: false, reason: "ended" };
  if (approvedCreatives !== null && approvedCreatives === 0) return { ok: false, reason: "no_approved_creative" };
  if (
    typeof spentTotal === "number" &&
    typeof campaign.totalBudget === "number" &&
    remainingBudget(campaign.totalBudget, spentTotal) <= 0
  ) {
    return { ok: false, reason: "budget_used" };
  }
  return { ok: true };
}

export const RESUME_BLOCK_MESSAGES: Record<ResumeBlockReason, string> = {
  not_paused: "Only paused campaigns can be resumed. Refresh the page to see the latest status.",
  ended: "This campaign's end date has passed. Change the end date before resuming.",
  no_approved_creative: "This campaign cannot be resumed until it has at least one approved creative.",
  budget_used: "This campaign has no budget left. Raise the total budget before resuming.",
};

export const PAUSE_BLOCK_MESSAGE = "Only active campaigns can be paused. Refresh the page to see the latest status.";

export const DELIVERY_NOTE = "Paused campaigns stop showing ads. Active campaigns can show ads until the budget or end date is reached.";
