import { isUuid } from "@/lib/campaigns/constants";

// Day 12 Prompt 6 Part 2: analytics data layer (impressions, clicks, CTR). Sirf server-side padhna: koi dashboard UI, billing, naya event nahi.
//
// Ownership/authorization DATABASE me hai (day-12-12 SQL: get_my_campaign_analytics / get_my_publisher_analytics). Ye functions caller ki
// apni login-session se bulaye jaate hain (auth.uid()), isliye yahan service-role key ka koi kaam nahi: use kabhi import nahi karte.
// Is file me sirf: CTR ka ganit, rpc ke jawab ki shape ki jaanch (galat shape => "error", kabhi galat number nahi), aur chhote fetch helpers.
// Client inject hota hai (type neeche), isliye tests asli database ke bina chalte hain.

export type CampaignAnalytics = { campaignId: string; impressions: number; clicks: number; ctr: number };
export type PublisherAnalytics = { impressions: number; clicks: number; ctr: number };

export type AnalyticsResult<T> = { status: "ok"; data: T } | { status: "not_found" } | { status: "error" };

/** Sirf wahi hissa jo hume Supabase client se chahiye (createClient() ka jawab ismein fit hota hai). */
export type AnalyticsRpcClient = {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
};

/** CTR (percent) = clicks / impressions * 100. impressions 0 (ya galat input) => 0, kabhi NaN / Infinity nahi. 4 decimal tak. */
export function computeCtr(impressions: number, clicks: number): number {
  if (!Number.isFinite(impressions) || !Number.isFinite(clicks)) return 0;
  if (impressions <= 0 || clicks <= 0) return 0;
  return Math.round((clicks * 100 * 10_000) / impressions) / 10_000;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** bigint Postgres se number ya string aa sakta hai. Sirf poore, negative-nahi, safe integers manta hai; baaki null. */
function toCount(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,15}$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** CTR ka asli jawab database se aata hai; yahan usse dobara ginke milate hain (mismatch => row galat maani jaati hai). */
function ctrMatches(reported: unknown, impressions: number, clicks: number): boolean {
  const n = typeof reported === "number" ? reported : typeof reported === "string" ? Number(reported) : NaN;
  if (!Number.isFinite(n)) return false;
  return Math.abs(n - computeCtr(impressions, clicks)) < 0.0002;
}

export function parseCampaignAnalyticsRow(row: unknown): CampaignAnalytics | null {
  if (!isRecord(row)) return null;
  const { campaign_id: campaignId } = row;
  if (typeof campaignId !== "string" || !isUuid(campaignId)) return null;
  const impressions = toCount(row.impressions);
  const clicks = toCount(row.clicks);
  if (impressions === null || clicks === null) return null;
  if (!ctrMatches(row.ctr, impressions, clicks)) return null;
  return { campaignId, impressions, clicks, ctr: computeCtr(impressions, clicks) };
}

export function parsePublisherAnalyticsRow(row: unknown): PublisherAnalytics | null {
  if (!isRecord(row)) return null;
  const impressions = toCount(row.impressions);
  const clicks = toCount(row.clicks);
  if (impressions === null || clicks === null) return null;
  if (!ctrMatches(row.ctr, impressions, clicks)) return null;
  return { impressions, clicks, ctr: computeCtr(impressions, clicks) };
}

async function callRpc(client: AnalyticsRpcClient, fn: string, args: Record<string, unknown>): Promise<unknown[] | null> {
  try {
    const { data, error } = await client.rpc(fn, args);
    if (error) {
      console.error("[ads/analytics] rpc failed", fn, error.code ?? "unknown"); // sirf function ka naam + code: id / data kuch nahi
      return null;
    }
    return Array.isArray(data) ? data : null;
  } catch {
    console.error("[ads/analytics] rpc unexpected failure", fn);
    return null;
  }
}

/**
 * Ek campaign ka analytics (advertiser: sirf apna; admin: koi bhi; baaki: not_found). Anjaana ya doosre ka campaign => not_found
 * (dono ek jaise dikhte hain). Database error / galat shape => error (zero nahi dikhaya jaata).
 */
export async function fetchCampaignAnalytics(client: AnalyticsRpcClient, campaignId: string): Promise<AnalyticsResult<CampaignAnalytics>> {
  if (!isUuid(campaignId)) return { status: "not_found" };
  const rows = await callRpc(client, "get_my_campaign_analytics", { p_campaign_id: campaignId });
  if (!rows) return { status: "error" };
  if (rows.length === 0) return { status: "not_found" };
  if (rows.length !== 1) return { status: "error" };
  const parsed = parseCampaignAnalyticsRow(rows[0]);
  if (!parsed || parsed.campaignId.toLowerCase() !== campaignId.toLowerCase()) return { status: "error" };
  return { status: "ok", data: parsed };
}

/** Caller ke saare (dikhne layak) campaigns ka analytics, naye pehle. Ek bhi row kharab => poora error (aadha jawab nahi). */
export async function fetchMyCampaignsAnalytics(client: AnalyticsRpcClient): Promise<AnalyticsResult<CampaignAnalytics[]>> {
  const rows = await callRpc(client, "get_my_campaign_analytics", { p_campaign_id: null });
  if (!rows) return { status: "error" };
  const out: CampaignAnalytics[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const parsed = parseCampaignAnalyticsRow(r);
    if (!parsed) return { status: "error" };
    // Ek campaign ki do rows => totals double ginte. Aisa jawab galat hai: poora error (UUID ki case alag ho tab bhi wahi campaign).
    const key = parsed.campaignId.toLowerCase();
    if (seen.has(key)) return { status: "error" };
    seen.add(key);
    out.push(parsed);
  }
  return { status: "ok", data: out };
}

/** Publisher ki apni traffic ke totals (campaign pehchaan ke bina). Publisher row nahi hai => not_found. */
export async function fetchPublisherAnalytics(client: AnalyticsRpcClient): Promise<AnalyticsResult<PublisherAnalytics>> {
  const rows = await callRpc(client, "get_my_publisher_analytics", {});
  if (!rows) return { status: "error" };
  if (rows.length === 0) return { status: "not_found" };
  if (rows.length !== 1) return { status: "error" };
  const parsed = parsePublisherAnalyticsRow(rows[0]);
  return parsed ? { status: "ok", data: parsed } : { status: "error" };
}
