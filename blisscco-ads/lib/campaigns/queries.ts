import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { isUuid } from "./constants";
import { EMPTY_FILTERS, escapeLike, type CampaignFilters } from "./filters";
import { toCampaign, type Campaign } from "./types";

// Sirf server par chalta hai (next/headers). Har query me advertiser_id ka filter EXPLICIT hai:
// RLS pehle se rokti hai, par admin ko sab campaigns dikhte hain, isliye defense in depth.

const COLUMNS =
  "id, advertiser_id, name, description, category, status, currency_code, total_budget, daily_budget, start_date, end_date, created_at, updated_at";

export type MyAdvertiser = { id: string; status: "pending" | "active" | "suspended"; companyName: string };

export const getMyAdvertiser = cache(async (): Promise<MyAdvertiser | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("advertisers")
      .select("id, status, company_name")
      .eq("profile_id", user.id)
      .maybeSingle();
    if (error || !data) return null;
    const r = data as { id?: unknown; status?: unknown; company_name?: unknown };
    if (typeof r.id !== "string" || typeof r.company_name !== "string") return null;
    if (r.status !== "pending" && r.status !== "active" && r.status !== "suspended") return null;
    return { id: r.id, status: r.status, companyName: r.company_name };
  } catch {
    return null;
  }
});

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

export async function getMyCampaign(advertiserId: string, campaignId: string): Promise<Campaign | null> {
  if (!isUuid(campaignId)) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("campaigns")
      .select(COLUMNS)
      .eq("id", campaignId)
      .eq("advertiser_id", advertiserId)
      .maybeSingle();
    if (error || !data) return null;
    return toCampaign(data);
  } catch {
    return null;
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
