// Campaign ke fixed values. Database me category ek slug hai (^[a-z0-9_]{1,50}$), display naam alag.
// Day 5: yahi list database table ad_categories (day-5-1) me bhi hai. Nayi category jodo toh DONO jagah.
export const CATEGORY_OPTIONS = [
  { value: "developer_tools", label: "Developer tools" },
  { value: "education", label: "Education" },
  { value: "finance", label: "Finance" },
  { value: "fitness", label: "Fitness" },
  { value: "food", label: "Food" },
  { value: "gaming", label: "Gaming" },
  { value: "lifestyle", label: "Lifestyle" },
  { value: "technology", label: "Technology" },
  { value: "travel", label: "Travel" },
] as const;

export type CampaignCategory = (typeof CATEGORY_OPTIONS)[number]["value"];

export function isCategory(v: string): v is CampaignCategory {
  return CATEGORY_OPTIONS.some((o) => o.value === v);
}

/** Slug -> display naam. Agar slug list me nahi (purana data), toh slug ko padhne layak bana dete hain. */
export function categoryLabel(slug: string): string {
  const found = CATEGORY_OPTIONS.find((o) => o.value === slug);
  if (found) return found.label;
  const text = slug.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const CAMPAIGN_STATUSES = [
  "draft",
  "pending_review",
  "active",
  "paused",
  "completed",
  "rejected",
  "archived",
] as const;
export type CampaignDbStatus = (typeof CAMPAIGN_STATUSES)[number];

export function isCampaignStatus(v: unknown): v is CampaignDbStatus {
  return typeof v === "string" && (CAMPAIGN_STATUSES as readonly string[]).includes(v);
}

export const STATUS_LABELS: Record<CampaignDbStatus, string> = {
  draft: "Draft",
  pending_review: "Pending review",
  active: "Active",
  paused: "Paused",
  completed: "Completed",
  rejected: "Rejected",
  archived: "Archived",
};

export const STATUS_HELP: Record<CampaignDbStatus, string> = {
  draft: "Not live yet. Add an ad, then send the campaign for review.",
  pending_review: "Waiting for review. It cannot be edited until the review is finished.",
  active: "Approved by our team. Ads are shown only while it has an approved ad, is between its start and end dates, and has budget left.",
  paused: "Paused by you. You can resume it once it has an approved ad, has not ended and still has budget left.",
  completed: "Finished. It cannot be edited.",
  rejected: "Rejected in review. You can edit it.",
  archived: "Archived. It cannot be edited.",
};

// Database trigger ke niyam (day-3-5): in statuses me fields lock hote hain; category sirf draft/rejected me badalti hai.
export const EDIT_LOCKED_STATUSES: readonly CampaignDbStatus[] = ["pending_review", "completed", "archived"];
export const CATEGORY_EDITABLE_STATUSES: readonly CampaignDbStatus[] = ["draft", "rejected"];

export const NAME_MIN = 3;
export const NAME_MAX = 150;
export const DESC_MAX = 1000;
// numeric(12,2) ki sima ~10 billion; app me practical limit.
export const MAX_BUDGET = 10_000_000;

// Day 9 Part 1: bahut chhota budget kabhi serve nahi hota (ek serve ki keemat CPM/1000 = $0.002 default),
// par campaign "Active" dikhta rehta hai. Isliye minimum. Badalna ho toh sirf yahi do number badlo.
export const MIN_TOTAL_BUDGET = 1;
export const MIN_DAILY_BUDGET = 0.5;

// Schedule ki seema: start date aaj se zyada se zyada itne din aage, aur campaign itne din se lamba nahi.
export const START_MAX_DAYS_AHEAD = 365;
export const MAX_CAMPAIGN_DAYS = 730;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}
