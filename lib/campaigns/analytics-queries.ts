import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAccount } from "@/lib/auth/session";
import {
  fetchCampaignAnalytics,
  fetchMyCampaignsAnalytics,
  fetchPublisherAnalytics,
  type AnalyticsResult,
  type CampaignAnalytics,
  type PublisherAnalytics,
} from "@/lib/ads/analytics";

// Server-side analytics (impressions, clicks, CTR). UI nahi: pages / actions baad me inhe bulayenge.
// Har call LOGGED-IN user ke session (createClient) se jaati hai, service-role key se kabhi nahi: ownership ka asli faisla database function me hota hai
// (day-12-12 SQL). Yahan ka role check sirf pehla darwaza hai (galat role par database tak jaana hi nahi); role database (profiles) se aata hai, JWT / metadata se nahi.
// Suspended / login-nahi / role-nahi => not_found (fail closed). Kuch bhi browser ko nahi bheja jaata: ye sab server-only hai.

const DENIED = { status: "not_found" } as const;

/** Ek campaign ka analytics: advertiser (sirf apna) ya admin. Publisher ko campaign analytics nahi milta. */
export async function loadCampaignAnalytics(campaignId: string): Promise<AnalyticsResult<CampaignAnalytics>> {
  const account = await getCurrentAccount();
  if (!account || account.status !== "active" || (account.role !== "advertiser" && account.role !== "admin")) return DENIED;
  return fetchCampaignAnalytics(await createClient(), campaignId);
}

/** Caller ke saare campaigns ka analytics (advertiser: apne; admin: sab). */
export async function loadMyCampaignsAnalytics(): Promise<AnalyticsResult<CampaignAnalytics[]>> {
  const account = await getCurrentAccount();
  if (!account || account.status !== "active" || (account.role !== "advertiser" && account.role !== "admin")) return DENIED;
  return fetchMyCampaignsAnalytics(await createClient());
}

/** Publisher ki apni traffic ke totals. Campaign / advertiser pehchaan kabhi nahi milti. */
export async function loadMyPublisherAnalytics(): Promise<AnalyticsResult<PublisherAnalytics>> {
  const account = await getCurrentAccount();
  if (!account || account.status !== "active" || account.role !== "publisher") return DENIED;
  return fetchPublisherAnalytics(await createClient());
}
