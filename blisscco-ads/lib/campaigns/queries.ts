import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { isUuid } from "./constants";
import { EMPTY_FILTERS, escapeLike, type CampaignFilters } from "./filters";
import { toCampaign, type Campaign } from "./types";
import { toCreative, type Creative } from "./creative-validation";
import { toAdvertiser, type AdvertiserResult, type MyAdvertiser } from "./advertiser";

// Sirf server par chalta hai (next/headers). Har query me advertiser_id ka filter EXPLICIT hai:
// RLS pehle se rokti hai, par admin ko sab campaigns dikhte hain, isliye defense in depth.

const COLUMNS =
  "id, advertiser_id, name, description, category, status, currency_code, total_budget, daily_budget, start_date, end_date, created_at, updated_at";

export type { MyAdvertiser, AdvertiserResult } from "./advertiser";

/**
 * Logged-in user ka advertiser. failed = database error (advertiser NAHI hai se alag).
 * Pehle error aur "advertiser nahi hai" dono null the, isliye database dikkat par "Set up your business" form
 * ya "not found" dikh jata tha. Ab pages failed par error boundary (Try again) dikhate hain.
 */
export const loadMyAdvertiser = cache(async (): Promise<AdvertiserResult> => {
  const user = await getCurrentUser();
  if (!user) return { advertiser: null, failed: false };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("advertisers")
      .select("id, status, company_name")
      .eq("profile_id", user.id)
      .maybeSingle();
    if (error) return { advertiser: null, failed: true };
    if (!data) return { advertiser: null, failed: false };
    const advertiser = toAdvertiser(data);
    // Row mili par shape galat: ise "nahi hai" nahi, "load fail" maano (galat setup form na dikhe).
    return advertiser ? { advertiser, failed: false } : { advertiser: null, failed: true };
  } catch {
    return { advertiser: null, failed: true };
  }
});

/** Purane callers ke liye: sirf advertiser ya null. Naye code me loadMyAdvertiser() use karo (failed alag milta hai). */
export async function getMyAdvertiser(): Promise<MyAdvertiser | null> {
  return (await loadMyAdvertiser()).advertiser;
}

export const LIST_LIMIT = 100;

export type CampaignListResult = { campaigns: Campaign[]; failed: boolean; total: number };

/**
 * Sirf is advertiser ke campaigns. Search/status/category filter DATABASE query me lagte hain
 * (sab campaigns laakar frontend me chhaantna nahi). RLS alag se rokti hai.
 */
export async function listMyCampaigns(
  advertiserId: string,
  filters: CampaignFilters = EMPTY_FILTERS,
): Promise<CampaignListResult> {
  try {
    const supabase = await createClient();
    let query = supabase.from("campaigns").select(COLUMNS, { count: "exact" }).eq("advertiser_id", advertiserId);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.category) query = query.eq("category", filters.category);
    if (filters.q) query = query.ilike("name", `%${escapeLike(filters.q)}%`);

    const { data, error, count } = await query.order("created_at", { ascending: false }).limit(LIST_LIMIT);
    if (error || !data) return { campaigns: [], failed: true, total: 0 };
    const campaigns = (data as unknown[]).map(toCampaign).filter((c): c is Campaign => c !== null);
    return { campaigns, failed: false, total: typeof count === "number" ? count : campaigns.length };
  } catch {
    return { campaigns: [], failed: true, total: 0 };
  }
}

export type LoadCampaignResult = { campaign: Campaign | null; failed: boolean };

/**
 * Ek campaign (sirf is advertiser ka). failed = database error (campaign nahi mila se alag):
 * pages failed par error boundary dikhate hain, "not found" nahi.
 */
export async function loadMyCampaign(advertiserId: string, campaignId: string): Promise<LoadCampaignResult> {
  if (!isUuid(campaignId)) return { campaign: null, failed: false };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("campaigns")
      .select(COLUMNS)
      .eq("id", campaignId)
      .eq("advertiser_id", advertiserId)
      .maybeSingle();
    if (error) return { campaign: null, failed: true };
    if (!data) return { campaign: null, failed: false };
    const campaign = toCampaign(data);
    // Row mili par shape galat: "campaign nahi mila" nahi, "load fail" maano (error boundary + Try again).
    return campaign ? { campaign, failed: false } : { campaign: null, failed: true };
  } catch {
    return { campaign: null, failed: true };
  }
}

/** Is campaign ke creatives kitne hain / kitne approved (resume ke liye kaam aata hai). */
export async function getCreativeSummary(campaignId: string): Promise<{ total: number; approved: number } | null> {
  if (!isUuid(campaignId)) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("ad_creatives").select("status").eq("campaign_id", campaignId).limit(200);
    if (error || !data) return null;
    const rows = data as { status?: unknown }[];
    return { total: rows.length, approved: rows.filter((r) => r.status === "approved").length };
  } catch {
    return null;
  }
}

/** Is campaign ke saare creatives (archived chhod kar), naye pehle. RLS: sirf apne campaign ke. */
export async function listCampaignCreatives(campaignId: string): Promise<Creative[] | null> {
  if (!isUuid(campaignId)) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("ad_creatives")
      .select("id, campaign_id, headline, body, cta_text, destination_url, status, rejection_reason")
      .eq("campaign_id", campaignId)
      .neq("status", "archived")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error || !data) return null;
    return (data as unknown[]).map(toCreative).filter((c): c is Creative => c !== null);
  } catch {
    return null;
  }
}

/** Kitne creatives review me hain ya approved hain (campaign review ke liye bhejne se pehle zaroori). */
export async function countReviewableCreatives(campaignId: string): Promise<number | null> {
  if (!isUuid(campaignId)) return null;
  try {
    const supabase = await createClient();
    const { count, error } = await supabase
      .from("ad_creatives")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .in("status", ["pending_review", "approved"]);
    if (error || typeof count !== "number") return null;
    return count;
  } catch {
    return null;
  }
}

export type CampaignSpend = { spentTotal: number; spentToday: number; servesTotal: number };

/** Kharch aur serve ginti (database function get_my_campaign_spend; sirf apne campaign ka). */
export async function getCampaignSpend(campaignId: string): Promise<CampaignSpend | null> {
  if (!isUuid(campaignId)) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_my_campaign_spend", { p_campaign_id: campaignId });
    if (error || !Array.isArray(data) || data.length === 0) return null;
    const r = data[0] as Record<string, unknown>;
    const n = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN);
    const spentTotal = n(r.spent_total);
    const spentToday = n(r.spent_today);
    const servesTotal = n(r.serves_total);
    if (![spentTotal, spentToday, servesTotal].every(Number.isFinite)) return null;
    return { spentTotal, spentToday, servesTotal };
  } catch {
    return null;
  }
}
