import type { CampaignDbStatus } from "./constants";

// "Kya ye campaign abhi sach me ads dikha sakta hai?" ka PURA (pure) jawab: koi database/env/clock nahi.
// Kyun: database status "active" ka matlab sirf "admin ne approve kiya aur advertiser ne pause nahi kiya" hai.
// Ad tabhi dikhta hai jab approved ad, schedule aur budget bhi theek ho (lib/ads/category-matching.ts + record_ad_serve wahi dekhte hain).
// Isliye UI "Active" ke saath ye saaf line bhi dikhata hai, taaki label aur asli behaviour alag na dikhein.
// Status VALUES kabhi nahi badalte: ye sirf dikhane ki jaankari hai, database me kuch nahi likhta.

/** Ek serve ki default keemat (CPM $2 / 1000). Asli keemat ad_platform_settings se aati hai; yahan sirf label ke liye andaza. */
export const DEFAULT_UNIT_COST_USD = 0.002;
const MIN_UNIT_COST_USD = 0.0001; // record_ad_serve ki sabse chhoti keemat

export type DeliveryReason =
  | "campaign_not_active"
  | "advertiser_not_active"
  | "ended"
  | "not_started"
  | "no_approved_creative"
  | "total_budget_used"
  | "daily_budget_used";

export type DeliveryInput = {
  status: CampaignDbStatus;
  startDate: string; // YYYY-MM-DD
  endDate: string | null;
  totalBudget: number;
  dailyBudget: number | null;
  /** null = pata nahi chala (load fail / list page): us cheez ko block nahi maante. */
  approvedCreatives: number | null;
  spentTotal: number | null;
  spentToday: number | null;
  /** "YYYY-MM-DD" (UTC) */
  todayUtc: string;
  unitCostUsd?: number;
  /** false = advertiser account active nahi (suspended): uske campaigns "Active" dikhte hain par ad nahi dikhte. undefined = pata nahi. */
  advertiserActive?: boolean;
};

export type DeliveryState = {
  /** true = jo cheezein humein pata hain, unke hisaab se ad dikh sakta hai. */
  serving: boolean;
  reason: DeliveryReason | null;
  /** Screen par dikhne wali chhoti line (English). */
  message: string;
};

export const NOT_ACTIVE_MESSAGES: Record<Exclude<CampaignDbStatus, "active">, string> = {
  draft: "Not showing ads: this campaign is still a draft.",
  pending_review: "Not showing ads: waiting for review.",
  paused: "Not showing ads: this campaign is paused.",
  completed: "Not showing ads: this campaign is completed.",
  rejected: "Not showing ads: this campaign was rejected.",
  archived: "Not showing ads: this campaign is archived.",
};

export const DELIVERY_MESSAGES: Record<Exclude<DeliveryReason, "campaign_not_active">, string> = {
  advertiser_not_active: "Not showing ads: your advertiser account is not active.",
  ended: "Not showing ads: the end date has passed.",
  not_started: "Not showing ads yet: the start date has not arrived.",
  no_approved_creative: "Not showing ads: no ad is approved right now.",
  total_budget_used: "Not showing ads: the total budget is used up.",
  daily_budget_used: "Not showing ads right now: today's daily budget is used up. It resets at midnight UTC.",
};

export const SERVING_MESSAGE = "Eligible to show ads.";

// Kharch 4 decimal tak: float ki galti se bachne ke liye integer micro me tulna (lib/campaigns/budget.ts jaisa).
function micro(n: number): number {
  return Math.round(n * 10_000);
}

export function deliveryState(input: DeliveryInput): DeliveryState {
  const { status } = input;
  if (status !== "active") {
    return { serving: false, reason: "campaign_not_active", message: NOT_ACTIVE_MESSAGES[status] };
  }

  const blocked = (reason: Exclude<DeliveryReason, "campaign_not_active">): DeliveryState => ({
    serving: false,
    reason,
    message: DELIVERY_MESSAGES[reason],
  });

  if (input.advertiserActive === false) return blocked("advertiser_not_active");
  if (input.endDate !== null && input.endDate < input.todayUtc) return blocked("ended");
  if (input.startDate > input.todayUtc) return blocked("not_started");
  if (input.approvedCreatives !== null && input.approvedCreatives === 0) return blocked("no_approved_creative");

  const unit = micro(Math.max(input.unitCostUsd ?? DEFAULT_UNIT_COST_USD, MIN_UNIT_COST_USD));
  if (input.spentTotal !== null && micro(input.totalBudget) - micro(input.spentTotal) < unit) {
    return blocked("total_budget_used");
  }
  if (input.dailyBudget !== null && input.spentToday !== null && micro(input.dailyBudget) - micro(input.spentToday) < unit) {
    return blocked("daily_budget_used");
  }

  return { serving: true, reason: null, message: SERVING_MESSAGE };
}
