import { computeCtr, fetchMyCampaignsAnalytics, type AnalyticsRpcClient, type CampaignAnalytics } from "@/lib/ads/analytics";
import type { NavRole } from "@/lib/dashboard-nav";

// Day 15 Part 1: advertiser analytics overview ka logic (page se alag, taaki bina database ke test ho sake).
// Ownership DATABASE me hai (get_my_campaign_analytics, auth.uid() se). Yahan sirf: role gate, jawab ka jod, aur saaf state.
// Koi spend / revenue number nahi banta: sirf impressions, clicks, CTR.

export type OverviewTotals = {
  campaigns: number;
  /** Kitne campaigns me kam se kam 1 impression ya click record hai. */
  campaignsWithEvents: number;
  impressions: number;
  clicks: number;
  /** Total clicks / total impressions * 100 (campaigns ke CTR ka average NAHI). */
  ctr: number;
};

export type OverviewResult =
  | { status: "unavailable" } // role advertiser nahi: database ko bulaya hi nahi gaya
  | { status: "error" } // database / client fail ya galat shape: kabhi nakli zero nahi
  | { status: "empty" } // advertiser ke koi campaign nahi
  | { status: "ok"; totals: OverviewTotals };

/** Sirf advertiser ko ye overview dikhta hai (publisher / admin ke liye alag analytics aayega, unka data yahan mix nahi hota). */
export function canViewAdvertiserOverview(role: NavRole | null): boolean {
  return role === "advertiser";
}

/** Returned campaign records ka jod. Total safe-integer se bada ho jaye => null (galat number dikhane se behtar error). */
export function aggregateCampaignAnalytics(rows: readonly CampaignAnalytics[]): OverviewTotals | null {
  let impressions = 0;
  let clicks = 0;
  let campaignsWithEvents = 0;
  for (const r of rows) {
    impressions += r.impressions;
    clicks += r.clicks;
    if (r.impressions > 0 || r.clicks > 0) campaignsWithEvents += 1;
  }
  if (!Number.isSafeInteger(impressions) || !Number.isSafeInteger(clicks)) return null;
  return { campaigns: rows.length, campaignsWithEvents, impressions, clicks, ctr: computeCtr(impressions, clicks) };
}

/** Client sirf advertiser ke liye banta hai (getClient lazy hai). Koi bhi fail => "error", kabhi 0 nahi. */
export async function loadAdvertiserOverview(
  role: NavRole | null,
  getClient: () => PromiseLike<AnalyticsRpcClient>,
): Promise<OverviewResult> {
  if (!canViewAdvertiserOverview(role)) return { status: "unavailable" };
  let client: AnalyticsRpcClient;
  try {
    client = await getClient();
  } catch {
    return { status: "error" };
  }
  const res = await fetchMyCampaignsAnalytics(client);
  if (res.status !== "ok") return { status: "error" };
  if (res.data.length === 0) return { status: "empty" };
  const totals = aggregateCampaignAnalytics(res.data);
  return totals ? { status: "ok", totals } : { status: "error" };
}
