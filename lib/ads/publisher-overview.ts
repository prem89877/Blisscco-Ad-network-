import { fetchPublisherAnalytics, type AnalyticsRpcClient } from "@/lib/ads/analytics";
import type { NavRole } from "@/lib/dashboard-nav";

// Day 15 Part 3: publisher ki apni traffic ke totals (impressions, clicks, CTR). Page se alag, taaki bina database ke test ho sake.
// Privacy: output me SIRF teen ginti (impressions, clicks, ctr). Koi campaign id, advertiser, budget ya publisher id nahi: database function
// (get_my_publisher_analytics) bhi inhe kabhi nahi bhejta, aur yahan extra fields copy hi nahi hote.
// Ownership DATABASE me hai (auth.uid() se caller ka publisher). Yahan koi id bheji nahi jaati.

export type PublisherOverview =
  | { status: "unavailable" } // role publisher nahi: database ko bulaya hi nahi gaya
  | { status: "not_found" } // is login ka koi (active) publisher row nahi
  | { status: "error" } // query / client fail ya galat shape: kabhi nakli zero nahi
  | { status: "ok"; impressions: number; clicks: number; ctr: number; hasEvents: boolean }; // hasEvents false = sach me zero events

export function canViewPublisherOverview(role: NavRole | null): boolean {
  return role === "publisher";
}

export async function loadPublisherOverview(
  role: NavRole | null,
  getClient: () => PromiseLike<AnalyticsRpcClient>,
): Promise<PublisherOverview> {
  if (!canViewPublisherOverview(role)) return { status: "unavailable" };
  try {
    const client = await getClient();
    const res = await fetchPublisherAnalytics(client);
    if (res.status === "not_found") return { status: "not_found" };
    if (res.status !== "ok") return { status: "error" };
    const { impressions, clicks, ctr } = res.data;
    return { status: "ok", impressions, clicks, ctr, hasEvents: impressions > 0 || clicks > 0 };
  } catch {
    return { status: "error" };
  }
}
