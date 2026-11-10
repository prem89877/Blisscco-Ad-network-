import {
  NO_PUBLISHER_COUNTRY,
  isCountryVerificationStatus,
  publisherRegionalEligibility,
  type PublisherCountry,
} from "@/lib/regions/publisher-country";

// Phase 6 Step 2 Part 1: ad-serving ka regional eligibility gate (PURA module: koi database / env object / server-only nahi).
//
// Flag REGIONAL_ELIGIBILITY_ENFORCED exact "1" ho tabhi match endpoint ye gate chalata hai (default BAND: purana behaviour bilkul same,
// database ko bulaya bhi nahi jaata; baaki flags (EMERGENCY_STOP_ENFORCED) ka wahi tareeka). Kyun band: campaigns me abhi region field nahi hai
// (Part 2), isliye flag ON karne par har wo publisher jiski country VERIFIED nahi hai no-fill pata hai.
//
// Flag ON ho toh: sirf VERIFIED aur ISO-valid country wala publisher aage badhta hai. Pending / rejected / missing / invalid => no-fill.
// Country padhi na ja sake (database error / galat shape) => "error" => 503 (fail closed), kabhi "eligible" nahi.
// Country -> region mapping yahan nahi hai (lib/regions/country-region.ts, central).

export const REGIONAL_ELIGIBILITY_ENV_FLAG = "REGIONAL_ELIGIBILITY_ENFORCED";

export function isRegionalEligibilityEnforced(env: Record<string, string | undefined>): boolean {
  return env[REGIONAL_ELIGIBILITY_ENV_FLAG] === "1";
}

/** get_publisher_country_state ka jawab (unknown) -> PublisherCountry. Shape galat / row nahi => null (caller fail closed). */
export function parseCountryStateResult(data: unknown): PublisherCountry | null {
  const row = Array.isArray(data) ? (data.length === 1 ? data[0] : null) : data;
  if (typeof row !== "object" || row === null || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;
  if (r.country_status === null) return { ...NO_PUBLISHER_COUNTRY };
  if (!isCountryVerificationStatus(r.country_status)) return null;
  // Database country_code sirf verified par deta hai; pending/rejected par null hi sahi hai.
  const code = r.country_code;
  if (!(code === null || typeof code === "string")) return null;
  return { countryCode: code, status: r.country_status, submittedAt: null, reviewedAt: null };
}

export type RegionalGateOutcome = "eligible" | "ineligible" | "error";

/** Padhi hui country state se gate ka faisla. null (padh nahi paye) => "error". Eligible sirf publisherRegionalEligibility() ke kehne par. */
export function regionalGateOutcome(state: PublisherCountry | null): RegionalGateOutcome {
  if (state === null) return "error";
  return publisherRegionalEligibility(state).eligible ? "eligible" : "ineligible";
}
