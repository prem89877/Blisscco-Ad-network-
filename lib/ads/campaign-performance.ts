import { fetchCampaignAnalytics, type AnalyticsResult, type AnalyticsRpcClient, type CampaignAnalytics } from "@/lib/ads/analytics";

// Day 15 Part 2: ek campaign ki performance (impressions, clicks, CTR) detail page ke liye.
// Ownership: page pehle loadMyCampaign(advertiser.id, id) se pakki karta hai, aur database function (get_my_campaign_analytics) auth.uid() se
// dobara jaanchta hai. Data layer jawab ka campaign_id bhi maangi hui id se milata hai (doosre ka row => error). Yahan sirf state ka matlab.

export type CampaignPerformance =
  | { status: "ok"; impressions: number; clicks: number; ctr: number; hasEvents: boolean } // hasEvents false = sach me zero events
  | { status: "unavailable" } // database ne is campaign ke liye koi row nahi di (anjaana / apna nahi)
  | { status: "error" }; // query fail / galat shape: kabhi zero nahi

export function toCampaignPerformance(res: AnalyticsResult<CampaignAnalytics>): CampaignPerformance {
  if (res.status === "not_found") return { status: "unavailable" };
  if (res.status !== "ok") return { status: "error" };
  const { impressions, clicks, ctr } = res.data;
  return { status: "ok", impressions, clicks, ctr, hasEvents: impressions > 0 || clicks > 0 };
}

/** Client banana ya query kuch bhi fail ho => "error" (kabhi nakli zero nahi). */
export async function loadCampaignPerformance(
  getClient: () => PromiseLike<AnalyticsRpcClient>,
  campaignId: string,
): Promise<CampaignPerformance> {
  try {
    const client = await getClient();
    return toCampaignPerformance(await fetchCampaignAnalytics(client, campaignId));
  } catch {
    return { status: "error" };
  }
}
