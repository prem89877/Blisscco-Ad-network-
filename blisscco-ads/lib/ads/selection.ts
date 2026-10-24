import {
  matchCategorySignal,
  toPublicAd,
  type AdCandidate,
  type RejectionReason,
} from "./category-matching";
import type { CategorySlug } from "./taxonomy";
import type { MatchedAd } from "./types";

// Day 5: campaign eligibility + creative SELECTION layer (server-side).
//
// Ye layer category-matching.ts (eligibility rules + deterministic order) ke upar ek surakshit "selector" hai:
//   publisher signal  ->  candidates load (inject kiya hua loader)  ->  eligibility  ->  EK creative  ->  safe no-fill
//
// Kya ye layer KARTI HAI:
//   - UTC din nikalti hai (utcDateString) taaki start_date / end_date ka fark server ki timezone par na tike
//   - budget check sirf tab lagati hai jab caller bataye ki kharch ka data bharosemand hai (spendTracking)
//   - sirf 5 public ad fields wapas deti hai; kabhi throw nahi karti; kuch galat ho toh no-fill
//
// Kya ye layer NAHI karti (jaan-boojh kar):
//   - koi database/network/env/clock/random nahi: loader aur clock bahar se aate hain (deps)
//   - serve count, impression, click, kharch kuch update nahi karti; billing nahi
//   - service-role key nahi chhoti. Candidate loader (jo key use karega) alag, server-only file hogi
//     (uske liye migration chahiye, DAY5-SELECTION-LAYER.md dekho; approval ke baad)

/** Din ki seema: campaigns.start_date / end_date plain `date` hain (timezone column nahi), isliye poore platform ke liye UTC din. */
export const SELECTION_DAY_BOUNDARY = "UTC" as const;

/**
 * Date -> "YYYY-MM-DD" (UTC). Server ki local timezone par kabhi nirbhar nahi (sirf getUTC* use hota hai).
 * Galat/invalid Date par null.
 */
export function utcDateString(now: Date): string | null {
  if (!(now instanceof Date)) return null;
  const t = now.getTime();
  if (!Number.isFinite(t)) return null;
  const y = now.getUTCFullYear();
  if (y < 1000 || y > 9999) return null;
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Candidates load karne wala function (server-side, read-only). Sirf category aur aaj ki UTC date milti hai:
 * publisher ka key/hash ya koi aur cheez loader tak nahi jaati.
 * Loader coarse filter (category, active, dates) laga sakta hai, par yahan sab kuch dobara jaancha jaata hai.
 */
export type CandidateLoader = (category: CategorySlug, today: string) => Promise<readonly AdCandidate[]>;

export type SpendTracking =
  /** campaign_spend_daily me kharch asli impressions par likha ja raha hai: budget check lagao. */
  | "reliable"
  /** Kharch ka koi bharosemand record nahi (abhi ki sthiti): budget check NAHI lagta, aur result me budgetEnforced=false aata hai. */
  | "unavailable";

export type SelectionDeps = {
  loadCandidates: CandidateLoader;
  /** Clock bahar se: production me `() => new Date()`, tests me fixed time. */
  now: () => Date;
  /** Ek impression ki keemat USD me (= cpm_usd / 1000, ad_platform_settings se). */
  unitCostUsd: number;
  /** Zaroori field (default nahi): har caller ko saaf batana padta hai ki kharch ka data kitna bharosemand hai. */
  spendTracking: SpendTracking;
};

export type SelectionRequest = {
  publisher: { id: string; status: string };
  /** Publisher ka topic/category signal (unknown: bahar se aata hai, validate hota hai). */
  category: unknown;
  /** Publisher ke pichhle dikhaye creative ids (optional). */
  excludeCreativeIds?: readonly string[];
};

export type NoFillReason =
  | RejectionReason
  | "no_eligible_candidates"
  | "candidate_load_failed";

/**
 * INTERNAL result (server logs / tests ke liye). `reason` publisher ko KABHI mat bhejna: toPublicResponse() use karo.
 */
export type SelectionOutcome =
  | {
      fill: true;
      ad: MatchedAd;
      /** true = publisher ki exclude list ke sab eligible creatives pehle dikh chuke the, isliye repeat. */
      repeat: boolean;
      /** false = budget check nahi laga (spendTracking = "unavailable"). Ise "budget pura enforce hua" mat samajhna. */
      budgetEnforced: boolean;
    }
  | { fill: false; reason: NoFillReason };

/** Publisher ko jaane wala jawab (existing /api/ads/match ke shape jaisa). Isme sirf yahi hota hai. */
export type PublicSelectionResponse =
  | { fill: true; sponsored: true; ad: MatchedAd }
  | { fill: false };

function noFill(reason: NoFillReason): SelectionOutcome {
  return { fill: false, reason };
}

/**
 * Ek eligible creative chunta hai ya safe no-fill deta hai. Kabhi throw nahi karta.
 *
 * Selection strategy (documented + tested; random nahi):
 *   1. Pehle category-matching ke eligibility rules (approved creative, active campaign/advertiser/profile,
 *      UTC dates, category exact match, budget agar enforce ho raha ho).
 *   2. Bache hue eligible candidates me: aaj sabse kam serve hua campaign -> sabse kam serve hua creative
 *      -> campaign id (a-z) -> creative id (a-z).
 *   3. Publisher ki exclude list ke creatives chhod kar; alternative na ho tabhi repeat.
 * NOTE: rotation tabhi asli hoga jab serve counts (creative_serve_daily) kahin aur record hon. Ye layer unhe
 * update nahi karti, isliye bina record ke har baar wahi (sabse upar wala) creative chunega.
 */
export async function selectAd(request: SelectionRequest, deps: SelectionDeps): Promise<SelectionOutcome> {
  try {
    const budgetCheck = deps.spendTracking === "reliable" ? "enforce" : "skip";

    const today = utcDateString(deps.now());
    if (today === null) return noFill("invalid_context");

    // Pehle signal jaancho (publisher + category) bina candidates load kiye:
    // galat/sensitive/unsupported category par database tak jaana hi nahi.
    const probe = matchCategorySignal(
      { publisher: request.publisher, category: request.category },
      [],
      { today, unitCostUsd: deps.unitCostUsd, excludeCreativeIds: request.excludeCreativeIds, budgetCheck },
    );
    if (probe.status === "rejected") return noFill(probe.reason);

    let loaded: readonly AdCandidate[];
    try {
      loaded = await deps.loadCandidates(probe.category, today);
    } catch {
      return noFill("candidate_load_failed");
    }
    if (!Array.isArray(loaded)) return noFill("candidate_load_failed");

    const result = matchCategorySignal(
      { publisher: request.publisher, category: request.category },
      loaded,
      { today, unitCostUsd: deps.unitCostUsd, excludeCreativeIds: request.excludeCreativeIds, budgetCheck },
    );
    if (result.status === "rejected") return noFill(result.reason);
    if (result.status === "no_match") return noFill("no_eligible_candidates");

    return {
      fill: true,
      ad: toPublicAd(result.selected),
      repeat: result.repeat,
      budgetEnforced: budgetCheck === "enforce",
    };
  } catch {
    // Kuch bhi anjaana: publisher ko kuch nahi dikhta, bas no-fill.
    return noFill("invalid_context");
  }
}

/** Internal outcome -> publisher ka jawab. no-fill me wajah, campaign, advertiser, budget kuch nahi. */
export function toPublicResponse(outcome: SelectionOutcome): PublicSelectionResponse {
  if (!outcome.fill) return { fill: false };
  const { id, headline, body, ctaText, destinationUrl } = outcome.ad;
  return { fill: true, sponsored: true, ad: { id, headline, body, ctaText, destinationUrl } };
}
