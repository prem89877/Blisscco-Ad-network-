import { isUuid, type CampaignDbStatus } from "../campaigns/constants";
import { isLegacyInactive, isSensitiveTerm, lookupCategory, type CategorySlug } from "./taxonomy";
import type { MatchedAd } from "./types";

// Day 5 core: contextual CATEGORY matching. Ye module PURA hai:
//   - koi database, network, env, clock (Date.now) ya random nahi. Candidates aur "aaj ki date" bahar se aate hain.
//   - isliye bina asli ad request ke test hota hai, aur same input => hamesha same output.
//
// Privacy / safety rules (code me enforce):
//   - Input sirf ek chhota category value hai (max 3 shabd, 50 chars). Poori chatbot conversation ya free text
//     reject hota hai; match hamesha EXACT slug/alias par hota hai, substring par kabhi nahi.
//   - Sensitive topics (health, religion, politics, sexuality, ...) reject. Insaan ke baare me kuch infer nahi hota.
//   - Koi external AI call nahi. Browser ke liye nahi: candidates server-side hi load karo (service-role), aur
//     publisher ko SIRF toPublicAd() ka output do. Advertiser/campaign/budget kabhi publisher tak nahi.
//   - Sirf wahi fields jo database me hain (campaigns, ad_creatives, advertisers, profiles, creative_serve_daily,
//     campaign_spend_daily). Koi "priority" field nahi hai, isliye bhi nahi banaya: barabari par deterministic ordering.

// ---------------------------------------------------------------------------
// 1. Normalization + resolve
// ---------------------------------------------------------------------------

export const CATEGORY_RAW_MAX_LENGTH = 100; // normalize se pehle ki seema (kaam bounded rakhne ke liye)
export const CATEGORY_MAX_LENGTH = 50; // database ke slug format jaisi (^[a-z0-9_]{1,50}$)
export const CATEGORY_MAX_WORDS = 3; // "developer_tools" jaisa 2, aage free text jaisa lagta hai

export type NormalizeFailure =
  | "not_a_string"
  | "empty"
  | "too_long"
  | "too_many_words"
  | "invalid_characters";

export type NormalizeResult = { ok: true; token: string } | { ok: false; reason: NormalizeFailure };

const TOKEN_RE = /^[a-z0-9_]+$/;

/**
 * Raw value -> saaf token. Sirf formatting saaf karta hai (NFKC, trim, lowercase, space/hyphen -> "_").
 * Token abhi taxonomy me hai ya nahi, ye yahan nahi dekhta (resolveCategory dekhta hai).
 * Allowed separators sirf space, "-" aur "_". Newline, tab, emoji, zero-width, non-ASCII, punctuation => reject.
 */
export function normalizeCategoryToken(raw: unknown): NormalizeResult {
  if (typeof raw !== "string") return { ok: false, reason: "not_a_string" };
  if (raw.length > CATEGORY_RAW_MAX_LENGTH) return { ok: false, reason: "too_long" };

  const trimmed = raw.normalize("NFKC").trim();
  if (trimmed.length === 0) return { ok: false, reason: "empty" };

  const collapsed = trimmed
    .toLowerCase()
    .replace(/[ \-_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (collapsed.length === 0) return { ok: false, reason: "empty" };
  if (collapsed.length > CATEGORY_MAX_LENGTH) return { ok: false, reason: "too_long" };
  if (!TOKEN_RE.test(collapsed)) return { ok: false, reason: "invalid_characters" };
  if (collapsed.split("_").length > CATEGORY_MAX_WORDS) return { ok: false, reason: "too_many_words" };

  return { ok: true, token: collapsed };
}

export type ResolveFailure = NormalizeFailure | "sensitive_category" | "unsupported_category";

export type ResolveResult = { ok: true; category: CategorySlug } | { ok: false; reason: ResolveFailure };

/** Raw value -> canonical active category slug, ya reject. Exact match; substring kabhi nahi. */
export function resolveCategory(raw: unknown): ResolveResult {
  const normalized = normalizeCategoryToken(raw);
  if (!normalized.ok) return normalized;

  const { token } = normalized;
  if (isSensitiveTerm(token)) return { ok: false, reason: "sensitive_category" };
  if (isLegacyInactive(token)) return { ok: false, reason: "unsupported_category" };

  const category = lookupCategory(token);
  if (category === null) return { ok: false, reason: "unsupported_category" };
  return { ok: true, category };
}

// ---------------------------------------------------------------------------
// 2. Types (sirf maujooda database fields)
// ---------------------------------------------------------------------------

export type CreativeDbStatus = "draft" | "pending_review" | "approved" | "rejected" | "paused" | "archived";
export type AdvertiserDbStatus = "pending" | "active" | "suspended";
export type ProfileDbStatus = "active" | "suspended";

/**
 * Ek (creative + uska campaign) ki server-side snapshot. Server isse database se load karta hai; browser ko nahi jaata.
 * Fields ka source:
 *   ad                      ad_creatives: id, headline, body, cta_text, destination_url
 *   creativeStatus          ad_creatives.status
 *   campaignId/Status/..    campaigns: id, status, category, start_date, end_date, total_budget, daily_budget
 *   advertiserStatus        advertisers.status;  advertiserProfileStatus: profiles.status (advertiser ka)
 *   spentTotal / spentToday campaign_spend_daily (sum / aaj ki row; nahi hai toh 0)
 *   campaignServesToday     creative_serve_daily: aaj ke campaign ke saare creatives ka serves ka jod
 *   creativeServesToday     creative_serve_daily: aaj is creative ke serves
 */
export type AdCandidate = {
  ad: MatchedAd;
  creativeStatus: CreativeDbStatus;
  campaignId: string;
  campaignStatus: CampaignDbStatus;
  category: string;
  startDate: string; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD
  totalBudget: number;
  dailyBudget: number | null;
  spentTotal: number;
  spentToday: number;
  advertiserStatus: AdvertiserDbStatus;
  advertiserProfileStatus: ProfileDbStatus;
  campaignServesToday: number;
  creativeServesToday: number;
};

/** Publisher ka signal. `category` unknown hai kyunki wo bahar se aata hai (API body) aur use validate karna hai. */
export type CategorySignal = {
  publisher: { id: string; status: string };
  category: unknown;
};

export type MatchContext = {
  /** Aaj ki date, UTC, YYYY-MM-DD (DB function ke `v_today` jaisi). Bahar se aati hai taaki module pure rahe. */
  today: string;
  /** Ek impression ki keemat USD me = cpm_usd / 1000 (ad_platform_settings). > 0 hona chahiye. */
  unitCostUsd: number;
  /** Publisher ke pichhle dikhaye creative ids (optional). Alternative ho toh inhe chhod kar. */
  excludeCreativeIds?: readonly string[];
  /**
   * "enforce" (default) = total/daily budget check lagta hai (spentTotal / spentToday par bharosa karke).
   * "skip" = budget check BILKUL nahi lagta. Tab use karo jab kharch ka koi bharosemand record nahi hai
   * (Day 7 se record_ad_serve likhta hai, isliye production me "enforce"). Taaki hum jhooth na bolen ki limit lag rahi hai.
   */
  budgetCheck?: "enforce" | "skip";
};

export type RejectionReason =
  | ResolveFailure
  | "publisher_not_authorized"
  | "invalid_context";

export type IneligibleReason =
  | "malformed_candidate"
  | "category_mismatch"
  | "creative_not_approved"
  | "creative_incomplete"
  | "campaign_not_active"
  | "advertiser_not_active"
  | "advertiser_profile_not_active"
  | "not_started"
  | "ended"
  | "total_budget_exhausted"
  | "daily_budget_exhausted";

export type MatchResult =
  | {
      status: "matched";
      category: CategorySlug;
      /** candidates[0]. */
      selected: AdCandidate;
      /** Saare eligible candidates, deterministic order me (best pehle). INTERNAL: publisher ko mat bhejna. */
      candidates: readonly AdCandidate[];
      /** true = sab eligible creatives publisher ki exclude list me the, isliye repeat dena pada. */
      repeat: boolean;
    }
  | { status: "no_match"; category: CategorySlug; reason: "no_eligible_candidates" }
  | { status: "rejected"; reason: RejectionReason };

// ---------------------------------------------------------------------------
// 3. Eligibility
// ---------------------------------------------------------------------------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MICROS = 1_000_000;

function isRealDate(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = DATE_RE.exec(v);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

function isMoney(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function toMicros(v: number): number {
  return Math.round(v * MICROS);
}

/**
 * Database jo ek serve ka charge asal me lagata hai wahi keemat (USD): record_ad_serve ka
 * greatest(round(cpm / 1000, 4), 0.0001). authorize_publisher_key seedha cpm / 1000 (bina round) deta hai, isliye
 * CPM jaise 2.5555 ya 0.05 par TypeScript ka budget pre-filter DB se alag ho jata tha (DB reject => bekaar no-fill).
 * round() yahan half-away-from-zero hai (numeric jaisa); 1e-9 float ke 25.499999.. jaise dhoke se bachata hai.
 */
export function chargedUnitCostUsd(rawUnitUsd: number): number {
  const tenThousandths = Math.max(1, Math.round(rawUnitUsd * 10_000 + 1e-9));
  return tenThousandths / 10_000;
}

/** Impression ki keemat: upar ki taraf round (kabhi kam nahi aanka, taaki budget paar na ho). */
function unitCostMicros(v: number): number {
  return Math.ceil(v * MICROS - 1e-9);
}

function isWellFormed(c: AdCandidate): boolean {
  return (
    typeof c === "object" &&
    c !== null &&
    typeof c.ad === "object" &&
    c.ad !== null &&
    typeof c.ad.id === "string" &&
    isUuid(c.ad.id) &&
    typeof c.campaignId === "string" &&
    isUuid(c.campaignId) &&
    typeof c.category === "string" &&
    isRealDate(c.startDate) &&
    (c.endDate === null || isRealDate(c.endDate)) &&
    isMoney(c.totalBudget) &&
    (c.dailyBudget === null || isMoney(c.dailyBudget)) &&
    isMoney(c.spentTotal) &&
    isMoney(c.spentToday) &&
    isCount(c.campaignServesToday) &&
    isCount(c.creativeServesToday)
  );
}

/**
 * Creative poora hai ya nahi (database ke CHECK constraints jaisa: ad_creatives headline 1-90, body 1-300,
 * cta_text null ya 1-30, destination_url https:// bina space, max 2048). Database me ye pehle se lagu hain
 * (userinfo wali rok day-5-11 migration se aati hai), par server-side snapshot par bharosa nahi karte:
 * adhoora ya shaky creative kabhi publisher tak nahi jaana chahiye.
 */
function isCompleteCreative(ad: MatchedAd): boolean {
  const textOk = (v: unknown, max: number): boolean =>
    typeof v === "string" && v.trim().length >= 1 && v.trim().length <= max;
  if (!textOk(ad.headline, 90) || !textOk(ad.body, 300)) return false;
  if (!(ad.ctaText === null || textOk(ad.ctaText, 30))) return false;
  const url = ad.destinationUrl;
  if (typeof url !== "string" || url.length > 2048 || !/^https:\/\/[^\s]+$/i.test(url)) return false;
  // "https://trusted.com@evil.com" jaise URL (userinfo) phishing me kaam aate hain: browser asli host evil.com ko jaata hai.
  // "@" path/query me theek hai (https://example.com/a@b); sirf host se pehle wala "@" reject hota hai.
  return !/^https:\/\/[^/?#]*@/i.test(url);
}

function isValidContext(ctx: MatchContext): boolean {
  if (typeof ctx !== "object" || ctx === null) return false;
  if (!isRealDate(ctx.today)) return false;
  if (typeof ctx.unitCostUsd !== "number" || !Number.isFinite(ctx.unitCostUsd) || ctx.unitCostUsd <= 0) return false;
  if (ctx.budgetCheck !== undefined && ctx.budgetCheck !== "enforce" && ctx.budgetCheck !== "skip") return false;
  if (ctx.excludeCreativeIds !== undefined) {
    if (!Array.isArray(ctx.excludeCreativeIds)) return false;
    if (!ctx.excludeCreativeIds.every((id) => typeof id === "string")) return false;
  }
  return true;
}

/**
 * Ek candidate eligible kyun nahi hai (pehla fail hone wala reason), ya null agar eligible hai.
 * Rules DB function public.match_contextual_ad (day-5-4) jaise hain; yahan sirf random() ki jagah deterministic ordering hai.
 * Category par strict barabari (===): database me category pehle se saaf slug hai (CHECK constraint).
 */
export function candidateIneligibility(
  candidate: AdCandidate,
  category: CategorySlug,
  ctx: MatchContext,
): IneligibleReason | null {
  if (!isWellFormed(candidate)) return "malformed_candidate";
  if (candidate.category !== category) return "category_mismatch";
  if (candidate.creativeStatus !== "approved") return "creative_not_approved";
  if (!isCompleteCreative(candidate.ad)) return "creative_incomplete";
  if (candidate.campaignStatus !== "active") return "campaign_not_active";
  if (candidate.advertiserStatus !== "active") return "advertiser_not_active";
  if (candidate.advertiserProfileStatus !== "active") return "advertiser_profile_not_active";
  if (candidate.startDate > ctx.today) return "not_started"; // YYYY-MM-DD string compare = date compare
  if (candidate.endDate !== null && candidate.endDate < ctx.today) return "ended";

  if (ctx.budgetCheck === "skip") return null; // budget enforce nahi ho raha (kharch ka reliable data nahi)

  const unit = unitCostMicros(ctx.unitCostUsd);
  if (toMicros(candidate.spentTotal) + unit > toMicros(candidate.totalBudget)) return "total_budget_exhausted";
  if (candidate.dailyBudget !== null && toMicros(candidate.spentToday) + unit > toMicros(candidate.dailyBudget)) {
    return "daily_budget_exhausted";
  }
  return null;
}

// ---------------------------------------------------------------------------
// 4. Deterministic ordering + selection
// ---------------------------------------------------------------------------

function cmpString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Order (pehle wala behtar):
 *   1. aaj sabse kam serve hua campaign  2. aaj sabse kam serve hua creative
 *   3. campaign id (a-z)                 4. creative id (a-z)
 * 3 aur 4 sirf barabari todne ke liye hain (koi "priority" field database me nahi hai). Random kabhi nahi.
 */
export function compareCandidates(a: AdCandidate, b: AdCandidate): number {
  return (
    a.campaignServesToday - b.campaignServesToday ||
    a.creativeServesToday - b.creativeServesToday ||
    cmpString(a.campaignId.toLowerCase(), b.campaignId.toLowerCase()) ||
    cmpString(a.ad.id.toLowerCase(), b.ad.id.toLowerCase())
  );
}

/** Sirf eligible candidates, deterministic order me, duplicate creative id hata kar. Input array ko badalta nahi. */
export function selectEligibleCandidates(
  candidates: readonly AdCandidate[],
  category: CategorySlug,
  ctx: MatchContext,
): AdCandidate[] {
  const seen = new Set<string>();
  const eligible: AdCandidate[] = [];
  for (const c of candidates) {
    if (candidateIneligibility(c, category, ctx) !== null) continue;
    const id = c.ad.id.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    eligible.push(c);
  }
  return eligible.sort(compareCandidates);
}

/** Publisher ko dene layak ad: sirf 5 public fields (advertiser/campaign/budget nahi). */
export function toPublicAd(candidate: AdCandidate): MatchedAd {
  const { id, headline, body, ctaText, destinationUrl } = candidate.ad;
  return { id, headline, body, ctaText, destinationUrl };
}

// ---------------------------------------------------------------------------
// 5. Entry point
// ---------------------------------------------------------------------------

/**
 * Signal + (server-side loaded) candidates -> matched | no_match | rejected. Kabhi throw nahi karta.
 *   rejected  = signal ya context galat (publisher active nahi, category invalid/sensitive/unsupported, ...)
 *   no_match  = signal theek, par eligible candidate nahi (safe no-fill; publisher ko kuch aur batane ki zaroorat nahi)
 *   matched   = eligible candidates mile; selected = sabse upar wala
 */
export function matchCategorySignal(
  signal: CategorySignal,
  candidates: readonly AdCandidate[],
  ctx: MatchContext,
): MatchResult {
  const publisher = typeof signal === "object" && signal !== null ? signal.publisher : null;
  if (
    typeof publisher !== "object" ||
    publisher === null ||
    typeof publisher.id !== "string" ||
    !isUuid(publisher.id) ||
    publisher.status !== "active"
  ) {
    return { status: "rejected", reason: "publisher_not_authorized" };
  }

  if (!isValidContext(ctx) || !Array.isArray(candidates)) {
    return { status: "rejected", reason: "invalid_context" };
  }

  const resolved = resolveCategory(signal.category);
  if (!resolved.ok) return { status: "rejected", reason: resolved.reason };
  const category = resolved.category;

  const eligible = selectEligibleCandidates(candidates, category, ctx);
  if (eligible.length === 0) return { status: "no_match", category, reason: "no_eligible_candidates" };

  const exclude = new Set((ctx.excludeCreativeIds ?? []).map((id) => id.toLowerCase()));
  const fresh = eligible.filter((c) => !exclude.has(c.ad.id.toLowerCase()));
  const pool = fresh.length > 0 ? fresh : eligible; // alternative na ho tabhi repeat
  return {
    status: "matched",
    category,
    selected: pool[0],
    candidates: pool,
    repeat: fresh.length === 0 && exclude.size > 0,
  };
}
