import { isRegionId, type RegionId } from "../regions/country-region";
import { effectiveCampaignRegions } from "../regions/publisher-country";
import type { AdCandidate } from "./category-matching";

// selection.ts sirf "./" imports rakhta hai (uska purana test), isliye region type / check yahin se re-export hote hain (wahi central definition).
export { isRegionId };
export type { RegionId };

// Phase 6 Step 2 Part 2: campaign targeting ka eligibility (PURA module: koi database / env / server-only nahi).
//
// Region ki list yahan NAHI hai: RegionId / isRegionId lib/regions/country-region.ts se, aur "khali => sirf Rest of World" ka niyam
// lib/regions/publisher-country.ts ke effectiveCampaignRegions() se (Part 1 ka wahi function). Koi dusri targeting config nahi.
//
// Niyam (owner-approved):
//   * Publisher ka region SIRF server se aata hai (admin-verified country -> central mapping). Client se kabhi nahi.
//   * Campaign ka target_regions null ya khali    => SIRF Rest of World (all-region NAHI).
//   * Campaign me region(s) hon                   => publisher ka region unme hona chahiye (rest_of_world bhi ek normal selection hai).
//   * Campaign ki list me ek bhi pehchana region na ho => koi publisher eligible nahi (fail closed, Rest of World bhi nahi).
//   * Campaign ki targeting row na mile / kharab shape => wo campaign eligible nahi (guess nahi, Rest of World ka fallback nahi).
//   * Explicit all-region targeting abhi supported nahi hai; jab hogi toh alag, saaf selection hogi (khali list se kabhi nahi).

/** Ek campaign ka target: null = koi region select nahi (=> Rest of World), warna list (khali bhi null jaisa maana jaata hai). */
export type CampaignTarget = readonly unknown[] | null;

/** campaign id (lower-case) -> target. Jis campaign ki row nahi mili wo map me hota hi nahi. */
export type CampaignTargetMap = ReadonlyMap<string, CampaignTarget>;

/** Candidate ke campaigns ke target regions load karne wala function (server-side, read-only). Sirf campaign ids milte hain. */
export type CampaignRegionLoader = (campaignIds: readonly string[]) => Promise<CampaignTargetMap>;

/** Publisher ke verified region ke liye ye campaign target eligible hai? Region invalid ho toh false. */
export function isTargetEligibleForRegion(target: CampaignTarget | undefined, publisherRegion: unknown): boolean {
  if (target === undefined) return false; // row hi nahi mili => guess nahi
  if (!isRegionId(publisherRegion)) return false;
  return effectiveCampaignRegions(target).includes(publisherRegion);
}

/**
 * Candidates me se sirf wo jinka campaign publisher ke region ke liye eligible hai. Input ko badalta nahi.
 * Map me jis campaign ki entry nahi, wo hata diya jaata hai (fail closed). publisherRegion invalid ho toh koi nahi bachta.
 */
export function filterCandidatesByRegion(
  candidates: readonly AdCandidate[],
  targets: CampaignTargetMap,
  publisherRegion: RegionId,
): AdCandidate[] {
  if (!isRegionId(publisherRegion)) return [];
  return candidates.filter((c) => isTargetEligibleForRegion(targets.get(c.campaignId.toLowerCase()), publisherRegion));
}

/**
 * get_campaign_target_regions ka jawab (unknown) -> map. data array nahi => null (caller fail closed).
 * Har row { campaign_id: string, target_regions: null | string[] }. Kharab row chhod di jaati hai (wo campaign map me nahi aata => eligible nahi).
 * Sirf maange gaye ids rakhe jaate hain (extra rows ignore).
 */
export function parseCampaignRegionRows(data: unknown, requestedIds: readonly string[]): CampaignTargetMap | null {
  if (!Array.isArray(data)) return null;
  const wanted = new Set(requestedIds.map((id) => id.toLowerCase()));
  const out = new Map<string, CampaignTarget>();
  for (const row of data) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    if (typeof r.campaign_id !== "string") continue;
    const id = r.campaign_id.toLowerCase();
    if (!wanted.has(id)) continue;
    if (r.target_regions === null) {
      out.set(id, null);
    } else if (Array.isArray(r.target_regions) && r.target_regions.every((x) => typeof x === "string")) {
      out.set(id, r.target_regions as string[]);
    }
    // aur kuch (object / string / number) => row kharab: map me nahi
  }
  return out;
}
