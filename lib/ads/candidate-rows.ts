import { isCampaignStatus } from "../campaigns/constants";
import type {
  AdCandidate,
  AdvertiserDbStatus,
  CreativeDbStatus,
  ProfileDbStatus,
} from "./category-matching";

// Database function public.load_ad_candidates (day-5-6) ke rows -> AdCandidate.
// Ye file PURI hai (koi database/env/server-only nahi), isliye alag se test hoti hai.
// Rule: shape ya status galat ho toh wo row chhod do (kabhi guess nahi). Rows server-side hi rehti hain.

const CREATIVE_STATUSES: readonly string[] = ["draft", "pending_review", "approved", "rejected", "paused", "archived"];
const ADVERTISER_STATUSES: readonly string[] = ["pending", "active", "suspended"];
const PROFILE_STATUSES: readonly string[] = ["active", "suspended"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** numeric column: JSON number ya numeric string ("1.2500") dono aa sakte hain. Galat/negative/NaN => null. */
function toNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function toCount(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function toText(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** Ek row -> AdCandidate, ya null (row kharab). Extra columns chhod diye jaate hain. */
export function parseCandidateRow(row: unknown): AdCandidate | null {
  if (!isRecord(row)) return null;

  const creativeId = toText(row.creative_id);
  const headline = toText(row.headline);
  const body = toText(row.body);
  const destinationUrl = toText(row.destination_url);
  const campaignId = toText(row.campaign_id);
  const category = toText(row.category);
  const startDate = toText(row.start_date);
  const endDate = row.end_date === null ? null : toText(row.end_date);
  const ctaText = row.cta_text === null ? null : toText(row.cta_text);

  const creativeStatus = toText(row.creative_status);
  const campaignStatus = toText(row.campaign_status);
  const advertiserStatus = toText(row.advertiser_status);
  const profileStatus = toText(row.advertiser_profile_status);

  const totalBudget = toNumber(row.total_budget);
  const dailyBudget = row.daily_budget === null ? null : toNumber(row.daily_budget);
  const spentTotal = toNumber(row.spent_total);
  const spentToday = toNumber(row.spent_today);
  const campaignServes = toCount(row.campaign_serves_today);
  const creativeServes = toCount(row.creative_serves_today);

  if (
    creativeId === null || headline === null || body === null || destinationUrl === null ||
    campaignId === null || category === null || startDate === null ||
    endDate === undefined || ctaText === undefined ||
    row.end_date === undefined || row.cta_text === undefined || row.daily_budget === undefined ||
    (row.end_date !== null && endDate === null) ||
    (row.cta_text !== null && ctaText === null) ||
    totalBudget === null || spentTotal === null || spentToday === null ||
    (row.daily_budget !== null && dailyBudget === null) ||
    campaignServes === null || creativeServes === null
  ) {
    return null;
  }

  if (creativeStatus === null || !CREATIVE_STATUSES.includes(creativeStatus)) return null;
  if (campaignStatus === null || !isCampaignStatus(campaignStatus)) return null;
  if (advertiserStatus === null || !ADVERTISER_STATUSES.includes(advertiserStatus)) return null;
  if (profileStatus === null || !PROFILE_STATUSES.includes(profileStatus)) return null;

  return {
    ad: { id: creativeId, headline, body, ctaText, destinationUrl },
    creativeStatus: creativeStatus as CreativeDbStatus,
    campaignId,
    campaignStatus,
    category,
    startDate,
    endDate,
    totalBudget,
    dailyBudget,
    spentTotal,
    spentToday,
    advertiserStatus: advertiserStatus as AdvertiserDbStatus,
    advertiserProfileStatus: profileStatus as ProfileDbStatus,
    campaignServesToday: campaignServes,
    creativeServesToday: creativeServes,
  };
}

/** rpc ka data -> AdCandidate list. data array nahi hai => null (loader isse failure maanta hai). Kharab rows chhod di jaati hain. */
export function parseCandidateRows(data: unknown): AdCandidate[] | null {
  if (!Array.isArray(data)) return null;
  const out: AdCandidate[] = [];
  for (const row of data) {
    const parsed = parseCandidateRow(row);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}
