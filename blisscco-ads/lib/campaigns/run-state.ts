import type { CampaignDbStatus } from "./constants";

// Pause / Resume ke niyam (pure functions: server action aur page dono yahi use karte hain).
// Asli rok database trigger (day-4-1 guard) hai; yahan sirf friendly check aur button dikhane ka faisla.
// Dhyan: ye sirf campaign STATUS badalta hai. Ad serving abhi bani nahi, isliye asli delivery par asar nahi.

export function canPause(status: CampaignDbStatus): boolean {
  return status === "active";
}

export type ResumeBlockReason = "not_paused" | "ended" | "no_approved_creative";
export type ResumeCheck = { ok: true } | { ok: false; reason: ResumeBlockReason };

/**
 * approvedCreatives = null matlab "pata nahi chala" (load fail): block nahi karte, database final faisla karega.
 * todayUtc = "YYYY-MM-DD".
 */
export function checkResume(
  campaign: { status: CampaignDbStatus; endDate: string | null },
  approvedCreatives: number | null,
  todayUtc: string,
): ResumeCheck {
  if (campaign.status !== "paused") return { ok: false, reason: "not_paused" };
  if (campaign.endDate !== null && campaign.endDate < todayUtc) return { ok: false, reason: "ended" };
  if (approvedCreatives !== null && approvedCreatives === 0) return { ok: false, reason: "no_approved_creative" };
  return { ok: true };
}

export const RESUME_BLOCK_MESSAGES: Record<ResumeBlockReason, string> = {
  not_paused: "Only paused campaigns can be resumed. Refresh the page to see the latest status.",
  ended: "This campaign's end date has passed. Change the end date before resuming.",
  no_approved_creative: "This campaign cannot be resumed until it has at least one approved creative.",
};

export const PAUSE_BLOCK_MESSAGE = "Only active campaigns can be paused. Refresh the page to see the latest status.";

export const DELIVERY_NOTE = "Ad serving is not live yet, so this only changes the campaign status.";
