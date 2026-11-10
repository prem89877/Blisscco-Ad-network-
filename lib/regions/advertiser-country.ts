import { regionForCountry, resolveCountry, type RegionId } from "./country-region";
import { parseCountrySubmission, type CountrySubmissionCheck } from "./publisher-country";

// Phase 6 Step 3 Part 1: advertiser business country (PURA module: koi database / env / server-only nahi).
//
// Country -> region mapping aur ISO list YAHAN NAHI hain: sab lib/regions/country-region.ts (Phase 6 Step 1) se aata hai.
// Country ki jaanch aur dropdown options publisher wale module se reuse hote hain (duplicate list / validation nahi).
// Region database me store nahi hota; hamesha central mapping se nikalta hai. Pricing (CPM / CPC) is file me nahi hai.

export type AdvertiserCountry = { countryCode: string | null; region: RegionId | null };

export const NO_ADVERTISER_COUNTRY: AdvertiserCountry = { countryCode: null, region: null };

/** Advertiser ki bheji country ki jaanch: officially assigned ISO 3166-1 alpha-2 code hi chalega ("UK" / "XX" reject). */
export function parseAdvertiserCountry(input: unknown): CountrySubmissionCheck {
  return parseCountrySubmission(input);
}

/**
 * Stored country_code -> country + region. Region SIRF ISO-valid code ko milta hai (central mapping se).
 * null / galat shape / ISO me nahi => region null (kabhi silent Rest of World nahi).
 */
export function advertiserCountryFromCode(code: unknown): AdvertiserCountry {
  const r = resolveCountry(code);
  if (!r.ok) return { ...NO_ADVERTISER_COUNTRY };
  return { countryCode: r.countryCode, region: r.region };
}

/** Advertiser ki region (campaign targeting ke liye). Country chuni nahi ya galat ho toh null. */
export function advertiserRegion(code: unknown): RegionId | null {
  return regionForCountry(code);
}

/**
 * Database row (unknown) -> AdvertiserCountry; shape galat => null (caller "load fail" maanta hai).
 * country_code null / missing => country chuni nahi (purane advertisers). Set par ISO-valid na ho => countryCode rakhta hai par region null.
 */
export function toAdvertiserCountry(row: unknown): AdvertiserCountry | null {
  if (typeof row !== "object" || row === null) return null;
  const code = (row as Record<string, unknown>).country_code;
  if (code === null || code === undefined) return { ...NO_ADVERTISER_COUNTRY };
  if (typeof code !== "string") return null;
  return { countryCode: code, region: advertiserRegion(code) };
}

/** Database error -> user ko dikhne wala message (raw message kabhi nahi). */
export function mapAdvertiserCountryError(error: { code?: string | null } | null | undefined): string {
  switch (error?.code) {
    case "23514":
      return "Choose your country from the list.";
    case "42501":
      return "You are not allowed to do this.";
    default:
      return "We could not save the country. Please try again.";
  }
}
