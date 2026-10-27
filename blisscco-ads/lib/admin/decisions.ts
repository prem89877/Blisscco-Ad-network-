// Admin ke faisle ki jaanch (pure). Server action isi se tay karta hai ki kaun sa database function kis value ke saath bulana hai.

export const ADMIN_KINDS = ["advertiser", "publisher", "creative", "campaign"] as const;
export type AdminDecisionKind = (typeof ADMIN_KINDS)[number];
export const REJECT_REASON_MAX = 500;

export function isAdminDecisionKind(v: unknown): v is AdminDecisionKind {
  return typeof v === "string" && (ADMIN_KINDS as readonly string[]).includes(v);
}

export type AdminDecisionCheck =
  | { ok: true; value: string; reason: string | null }
  | { ok: false; message: string };

/**
 * advertiser/publisher: decision = active | suspended
 * creative: approve | reject (reject par reason zaroori)
 * campaign: approve | reject
 */
export function validateAdminDecision(kind: AdminDecisionKind, decision: string, reasonRaw: string): AdminDecisionCheck {
  const reason = reasonRaw.replace(/\s+/g, " ").trim();
  if (kind === "advertiser" || kind === "publisher") {
    if (decision !== "active" && decision !== "suspended") return { ok: false, message: "That request was not understood." };
    return { ok: true, value: decision, reason: null };
  }
  if (decision !== "approve" && decision !== "reject") return { ok: false, message: "That request was not understood." };
  if (kind === "creative" && decision === "reject") {
    if (reason.length === 0) return { ok: false, message: "Write a short reason so the advertiser knows what to fix." };
    if (reason.length > REJECT_REASON_MAX) return { ok: false, message: `Use at most ${REJECT_REASON_MAX} characters for the reason.` };
    return { ok: true, value: decision, reason };
  }
  return { ok: true, value: decision, reason: null };
}

// ---------------------------------------------------------------------------
// Campaign approve ke liye friendly pehli jaanch (button dikhane ka faisla). Asli rok database function admin_review_campaign
// (day-9-7) hai: wahan bhi yahi niyam (aur budget, advertiser account, self-approval) lagte hain.
// ---------------------------------------------------------------------------

export type CampaignApproveBlock = "no_approved_ad" | "ended";

export const CAMPAIGN_APPROVE_BLOCK_MESSAGES: Record<CampaignApproveBlock, string> = {
  no_approved_ad: "Approve at least one of this campaign's ads first.",
  ended: "The end date has passed, so this campaign cannot go live. Reject it so the advertiser can change the dates.",
};

/** approvedAds = null => pata nahi chala (load fail): block nahi karte, database final faisla karega. */
export function campaignApproveBlock(
  campaign: { endDate: string | null },
  approvedAds: number | null,
  todayUtc: string,
): CampaignApproveBlock | null {
  if (campaign.endDate !== null && campaign.endDate < todayUtc) return "ended";
  if (approvedAds !== null && approvedAds === 0) return "no_approved_ad";
  return null;
}

// ---------------------------------------------------------------------------
// Database error -> user ko dikhne wala message. Raw message/details kabhi nahi bhejte.
// ---------------------------------------------------------------------------

type AdminDbError = { code?: string | null; hint?: string | null } | null | undefined;

const ADMIN_HINT_MESSAGES: Record<string, string> = {
  self_approval_blocked: "You cannot approve items that belong to your own account.",
  approve_needs_creative: "Approve at least one of this campaign's ads first.",
  approve_campaign_ended: "This campaign's end date has passed, so it cannot be approved.",
  approve_needs_budget: "This campaign has no budget left, so it cannot be approved.",
  advertiser_not_active: "The advertiser's account is not active, so this cannot be approved.",
};

export function mapAdminError(error: AdminDbError): string {
  if (error?.hint && Object.prototype.hasOwnProperty.call(ADMIN_HINT_MESSAGES, error.hint)) {
    return ADMIN_HINT_MESSAGES[error.hint];
  }
  switch (error?.code) {
    case "42501":
      return "Only an admin can do this.";
    case "22023":
      return "The database did not allow this change (for example, a campaign needs an approved ad first).";
    case "P0002":
      return "That item no longer exists. Refresh the page.";
    default:
      return "Something went wrong. Please try again.";
  }
}
