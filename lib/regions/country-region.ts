// Phase 6 Step 1: centralized country -> region mapping (ISO 3166-1 alpha-2).
// Pure data + pure functions. Koi database, network ya env nahi.
//
// Rules:
//   * Exactly 8 regions (owner-defined). Naya region mat jodo.
//   * Har supported country exactly ek region me hai. 7 regions ki lists neeche explicit hain;
//     "rest_of_world" HAMESHA derive hota hai (ISO list minus baaki 7), isliye duplicate ya gap possible nahi.
//   * Supported = officially assigned ISO 3166-1 alpha-2 code. Format galat => "invalid_format".
//     Format theek par ISO me nahi (jaise "XX") => "unsupported_country". Dono me region NAHI milta,
//     koi silent fallback nahi (rest_of_world sirf ISO-valid countries ke liye hai).
//   * Advertiser targeting aur publisher country identification dono isi file se region lete hain.
//   * Pricing (CPM/CPC) values yahan nahi hain aur is file se badalti nahi.

export const REGION_IDS = [
  "north_america",
  "uk",
  "western_europe",
  "australia",
  "middle_east",
  "south_asia",
  "southeast_asia",
  "rest_of_world",
] as const;

export type RegionId = (typeof REGION_IDS)[number];

export const REGION_LABELS: Record<RegionId, string> = {
  north_america: "North America",
  uk: "UK",
  western_europe: "Western Europe",
  australia: "Australia",
  middle_east: "Middle East",
  south_asia: "South Asia",
  southeast_asia: "Southeast Asia",
  rest_of_world: "Rest of World",
};

/** Officially assigned ISO 3166-1 alpha-2 codes (249). */
export const ISO_COUNTRY_CODES: readonly string[] = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ " +
  "BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ " +
  "DE DJ DK DM DO DZ " +
  "EC EE EG EH ER ES ET " +
  "FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY " +
  "HK HM HN HR HT HU " +
  "ID IE IL IM IN IO IQ IR IS IT " +
  "JE JM JO JP " +
  "KE KG KH KI KM KN KP KR KW KY KZ " +
  "LA LB LC LI LK LR LS LT LU LV LY " +
  "MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ " +
  "NA NC NE NF NG NI NL NO NP NR NU NZ " +
  "OM " +
  "PA PE PF PG PH PK PL PM PN PR PS PT PW PY " +
  "QA " +
  "RE RO RS RU RW " +
  "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ " +
  "TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ " +
  "UA UG UM US UY UZ " +
  "VA VC VE VG VI VN VU " +
  "WF WS " +
  "YE YT " +
  "ZA ZM ZW"
).split(" ");

/** Owner-approved initial assignments for the 7 named regions. Rest of World is derived below. */
export const NAMED_REGION_COUNTRIES: Record<Exclude<RegionId, "rest_of_world">, readonly string[]> = {
  north_america: ["US", "CA", "MX"],
  uk: ["GB"],
  western_europe: ["DE", "FR", "NL", "BE", "AT", "CH", "IE", "ES", "PT", "IT", "LU", "GR", "CY"],
  australia: ["AU", "NZ"],
  middle_east: ["AE", "SA", "QA", "KW", "BH", "OM", "TR", "EG", "IR", "SY", "JO", "IQ", "LB", "IL"],
  south_asia: ["IN", "PK", "BD", "LK", "NP", "BT", "MV", "AF"],
  southeast_asia: ["SG", "MY", "ID", "TH", "PH", "VN", "KH", "LA", "MM", "BN", "TL"],
};

const COUNTRY_TO_REGION: ReadonlyMap<string, RegionId> = (() => {
  const map = new Map<string, RegionId>();
  const iso = new Set(ISO_COUNTRY_CODES);
  for (const region of Object.keys(NAMED_REGION_COUNTRIES) as Array<keyof typeof NAMED_REGION_COUNTRIES>) {
    for (const code of NAMED_REGION_COUNTRIES[region]) {
      if (!iso.has(code)) throw new Error(`Region mapping: ${code} is not an ISO 3166-1 alpha-2 code`);
      if (map.has(code)) throw new Error(`Region mapping: ${code} is assigned to more than one region`);
      map.set(code, region);
    }
  }
  for (const code of ISO_COUNTRY_CODES) {
    if (!map.has(code)) map.set(code, "rest_of_world");
  }
  return map;
})();

export type CountryResolution =
  | { ok: true; countryCode: string; region: RegionId }
  | { ok: false; reason: "invalid_format" | "unsupported_country" };

/** Trim + uppercase; null unless the result is exactly two A-Z letters. */
export function normalizeCountryCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

export function resolveCountry(input: unknown): CountryResolution {
  const countryCode = normalizeCountryCode(input);
  if (!countryCode) return { ok: false, reason: "invalid_format" };
  const region = COUNTRY_TO_REGION.get(countryCode);
  if (!region) return { ok: false, reason: "unsupported_country" };
  return { ok: true, countryCode, region };
}

/** Region of a supported country; null for invalid or unsupported input (never a silent fallback). */
export function regionForCountry(input: unknown): RegionId | null {
  const r = resolveCountry(input);
  return r.ok ? r.region : null;
}

export function isSupportedCountryCode(input: unknown): boolean {
  return resolveCountry(input).ok;
}

export function isRegionId(value: unknown): value is RegionId {
  return typeof value === "string" && (REGION_IDS as readonly string[]).includes(value);
}

export function countriesInRegion(region: RegionId): string[] {
  return ISO_COUNTRY_CODES.filter((c) => COUNTRY_TO_REGION.get(c) === region);
}

/**
 * Shared eligibility check for advertiser targeting vs publisher country.
 * False for invalid/unsupported countries, unknown regions, or an empty target list.
 */
export function isCountryInTargetRegions(country: unknown, targetRegions: readonly unknown[]): boolean {
  const region = regionForCountry(country);
  if (!region) return false;
  return targetRegions.some((r) => isRegionId(r) && r === region);
}
