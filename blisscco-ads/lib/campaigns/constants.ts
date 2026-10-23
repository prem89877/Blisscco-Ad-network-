// Campaign ke fixed values. Database me category ek slug hai (^[a-z0-9_]{1,50}$), display naam alag.
export const CATEGORY_OPTIONS = [
  { value: "developer_tools", label: "Developer tools" },
  { value: "education", label: "Education" },
  { value: "finance", label: "Finance" },
  { value: "fitness", label: "Fitness" },
  { value: "food", label: "Food" },
  { value: "gaming", label: "Gaming" },
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
  draft: "Not live. Review and activation come in a later stage.",
  pending_review: "Waiting for review. It cannot be edited until the review is finished.",
  active: "Approved. Ad serving is not live yet, so nothing is delivered for now.",
  paused: "Paused by you. You can resume it once it has an approved creative.",
  completed: "Finished. It cannot be edited.",
  rejected: "Rejected in review. You can edit it.",
  archived: "Archived. It cannot be edited.",
};

// Database trigger ke niyam (day-3-5): in statuses me fields lock hote hain; category sirf draft/rejected me badalti hai.
export const EDIT_LOCKED_STATUSES: readonly CampaignDbStatus[] = ["pending_review", "completed", "archived"];
export const CATEGORY_EDITABLE_STATUSES: readonly CampaignDbStatus[] = ["draft", "rejected"];

export const NAME_MIN = 3;
export const NAME_MAX = 150;
// numeric(12,2) ki sima ~10 billion; app me practical limit.
export const MAX_BUDGET = 10_000_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}
