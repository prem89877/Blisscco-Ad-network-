// Day 24 Part 3: explicit PLACEHOLDER provider for the controlled JSON endpoint prototype.
//
// Yeh sirf ek nakli (static) test creative deta hai. Yeh asli ad nahi hai, kisi ad server (Revive samet) se nahi aata,
// aur kisi advertiser ya campaign ka nahi hai. Har text field me "TEST ONLY" likha hai.
//
// Niyam:
//   1. Default: BAND. Sirf server-side flag REVIVE_JSON_PREVIEW_ENABLED exact "true" par creative milta hai. Warna null.
//   2. Koi import nahi. Koi DB, billing, tracking, ledger, payout, network (fetch), logging ya credential nahi.
//   3. Koi URL, query, header ya cookie input nahi: sirf env ka ek flag padha jaata hai. Output hamesha fixed hai.
//   4. Destination fixed https://example.com (reserved test domain).
//   5. Abhi kahin use NAHI hota: na service, na fallback routing, na publisher match route, na preview route.
//      Use karne se pehle alag, explicit decision + tests chahiye (tests/ads/day24-part3 usse bandhta hai).

export const PLACEHOLDER_PROVIDER_FLAG = "REVIVE_JSON_PREVIEW_ENABLED";

export type PlaceholderEnv = Readonly<Record<string, string | undefined>>;

export type PlaceholderCreative = Readonly<{
  headline: string;
  body: string;
  cta_text: string;
  destination_url: string;
}>;

export const PLACEHOLDER_HEADLINE = "TEST ONLY: Placeholder headline";
export const PLACEHOLDER_BODY = "TEST ONLY placeholder content. Not a real advertiser and not a real ad.";
export const PLACEHOLDER_CTA = "TEST ONLY";
export const PLACEHOLDER_DESTINATION = "https://example.com/blisscco-test-only-placeholder";

/** Sirf exact "true" (koi trim/case-folding nahi). Kabhi throw nahi karta. */
export function placeholderProviderEnabled(env: PlaceholderEnv | null | undefined): boolean {
  try {
    return env !== null && env !== undefined && env[PLACEHOLDER_PROVIDER_FLAG] === "true";
  } catch {
    return false;
  }
}

/** Band => null. Chalu => har call par naya, fixed, test-only creative. Kabhi throw nahi karta. */
export function getPlaceholderPreviewCreative(env?: PlaceholderEnv | null): PlaceholderCreative | null {
  try {
    const source = env === undefined ? (typeof process !== "undefined" ? process.env : undefined) : env;
    if (!placeholderProviderEnabled(source)) return null;
    return {
      headline: PLACEHOLDER_HEADLINE,
      body: PLACEHOLDER_BODY,
      cta_text: PLACEHOLDER_CTA,
      destination_url: PLACEHOLDER_DESTINATION,
    };
  } catch {
    return null;
  }
}

/** Preview handler ke provider shape ((): unknown) se mel khata hai, par abhi kahin wired nahi. */
export const placeholderPreviewProvider = (): PlaceholderCreative | null => getPlaceholderPreviewCreative();
