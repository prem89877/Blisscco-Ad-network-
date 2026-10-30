import type { CampaignDbStatus } from "./constants";

// Campaign ko review ke liye bhejna / wapas lena (pure functions: server action aur page dono yahi use karte hain).
// Asli rok database trigger (day-3-5): advertiser sirf draft->pending_review, pending_review->draft, rejected->draft kar sakta hai.
// 'active' tak sirf admin approval se pahunchta hai.

export type ReviewAction = "submit" | "withdraw" | "reopen";

export const REVIEW_ACTIONS: Record<ReviewAction, { from: CampaignDbStatus; to: CampaignDbStatus; label: string }> = {
  submit: { from: "draft", to: "pending_review", label: "Send for review" },
  withdraw: { from: "pending_review", to: "draft", label: "Take back to draft" },
  reopen: { from: "rejected", to: "draft", label: "Move back to draft" },
};

export function isReviewAction(v: unknown): v is ReviewAction {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(REVIEW_ACTIONS, v);
}

export function reviewActionFor(status: CampaignDbStatus): ReviewAction | null {
  for (const key of Object.keys(REVIEW_ACTIONS) as ReviewAction[]) {
    if (REVIEW_ACTIONS[key].from === status) return key;
  }
  return null;
}

export type SubmitBlockReason = "ended" | "no_creative";

/**
 * Review ke liye bhejne se pehle: ad (creative) hona chahiye jo review me ya approved ho, aur end date nikli nahi honi chahiye.
 * reviewableCreatives = null => pata nahi chala (load fail): block nahi karte, database/admin final faisla karega.
 */
export function checkSubmitCampaign(
  campaign: { endDate: string | null },
  reviewableCreatives: number | null,
  todayUtc: string,
): { ok: true } | { ok: false; reason: SubmitBlockReason } {
  if (campaign.endDate !== null && campaign.endDate < todayUtc) return { ok: false, reason: "ended" };
  if (reviewableCreatives !== null && reviewableCreatives === 0) return { ok: false, reason: "no_creative" };
  return { ok: true };
}

export const SUBMIT_BLOCK_MESSAGES: Record<SubmitBlockReason, string> = {
  ended: "This campaign's end date has passed. Change the end date before sending it for review.",
  no_creative: "Add an ad and send it for review first. A campaign needs at least one ad to be reviewed.",
};
