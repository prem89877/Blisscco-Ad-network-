import { ISO_COUNTRY_CODES, isRegionId, resolveCountry, type RegionId } from "./country-region";

// Phase 6 Step 2 Part 1: publisher country verification (PURA module: koi database / env / server-only nahi).
//
// Country -> region ka mapping YAHAN NAHI hai: sab kuch lib/regions/country-region.ts (Phase 6 Step 1) se aata hai (duplicate mapping nahi).
// Ye file sirf teen kaam karti hai:
//   1. Publisher ki bheji country ki jaanch (ISO 3166-1 alpha-2, central module se).
//   2. Verification status ka type + database row -> typed state.
//   3. EKLAUTA gate: publisherRegionalEligibility(). Sirf VERIFIED aur ISO-valid country ko region milta hai.
//      Pending / rejected / missing / invalid => region nahi => regional ad-serving eligibility nahi (no-fill).

export const COUNTRY_VERIFICATION_STATUSES = ["pending", "verified", "rejected"] as const;
export type CountryVerificationStatus = (typeof COUNTRY_VERIFICATION_STATUSES)[number];

export function isCountryVerificationStatus(v: unknown): v is CountryVerificationStatus {
  return typeof v === "string" && (COUNTRY_VERIFICATION_STATUSES as readonly string[]).includes(v);
}

export const COUNTRY_STATUS_LABELS: Record<CountryVerificationStatus, string> = {
  pending: "Waiting for verification",
  verified: "Verified",
  rejected: "Not accepted",
};

/** Admin ke faisle: approve => verified, reject => rejected. */
export const COUNTRY_REVIEW_DECISIONS = ["approve", "reject"] as const;
export type CountryReviewDecision = (typeof COUNTRY_REVIEW_DECISIONS)[number];

export function isCountryReviewDecision(v: unknown): v is CountryReviewDecision {
  return typeof v === "string" && (COUNTRY_REVIEW_DECISIONS as readonly string[]).includes(v);
}

/* ---------------- Submission (publisher ki taraf se) ---------------- */

export type CountrySubmissionCheck =
  | { ok: true; countryCode: string; region: RegionId }
  | { ok: false; message: string };

/**
 * Publisher ki bheji country ki jaanch. Trim + upper-case; sirf officially assigned ISO 3166-1 alpha-2 code chalta hai.
 * "UK" jaise galat code (ISO me GB hai) aur "XX" reject. Region sirf jaankari ke liye; eligibility isse nahi, verification se milti hai.
 */
export function parseCountrySubmission(input: unknown): CountrySubmissionCheck {
  const r = resolveCountry(input);
  if (r.ok) return { ok: true, countryCode: r.countryCode, region: r.region };
  if (r.reason === "invalid_format") return { ok: false, message: "Choose your country from the list." };
  return { ok: false, message: "That country code is not an official ISO country code. Choose your country from the list." };
}

/* ---------------- Dropdown options (central ISO list se; alag list nahi) ---------------- */

export type CountryOption = { value: string; label: string };

/** Naam ke hisaab se sorted. Value hamesha ISO code; server dobara jaanchta hai. */
export function countryOptions(): CountryOption[] {
  const display = new Intl.DisplayNames(["en"], { type: "region" });
  return ISO_COUNTRY_CODES.map((code) => {
    let label = code;
    try {
      const n = display.of(code);
      if (typeof n === "string" && n.length > 0 && n !== code) label = `${n} (${code})`;
    } catch {
      // naam na mile toh sirf code dikhta hai
    }
    return { value: code, label };
  }).sort((a, b) => a.label.localeCompare(b.label, "en"));
}

/** "India (IN)"; naam na mile toh sirf code. */
export function countryDisplayName(code: string): string {
  try {
    const n = new Intl.DisplayNames(["en"], { type: "region" }).of(code);
    return typeof n === "string" && n.length > 0 && n !== code ? `${n} (${code})` : code;
  } catch {
    return code;
  }
}

/* ---------------- Database row -> typed state ---------------- */

export type PublisherCountry = {
  countryCode: string | null;
  status: CountryVerificationStatus | null;
  submittedAt: string | null;
  reviewedAt: string | null;
};

export const NO_PUBLISHER_COUNTRY: PublisherCountry = { countryCode: null, status: null, submittedAt: null, reviewedAt: null };

/**
 * Row (unknown) -> PublisherCountry. Kuch bhi galat shape => null (caller "load fail" maanta hai; kabhi "verified" nahi).
 * country_code aur country_status dono ya toh dono null (missing) ya dono set.
 */
export function toPublisherCountry(row: unknown): PublisherCountry | null {
  if (typeof row !== "object" || row === null) return null;
  const r = row as Record<string, unknown>;
  const code = r.country_code;
  const status = r.country_status;
  const submittedAt = typeof r.country_submitted_at === "string" ? r.country_submitted_at : null;
  const reviewedAt = typeof r.country_reviewed_at === "string" ? r.country_reviewed_at : null;
  if (code === null && status === null) return { ...NO_PUBLISHER_COUNTRY };
  if (typeof code !== "string" || !isCountryVerificationStatus(status)) return null;
  return { countryCode: code, status, submittedAt, reviewedAt };
}

/* ---------------- Regional eligibility: EKLAUTA gate ---------------- */

export type RegionalIneligibleReason = "missing" | "pending" | "rejected" | "invalid_country";

export type PublisherRegionalEligibility =
  | { eligible: true; countryCode: string; region: RegionId }
  | { eligible: false; reason: RegionalIneligibleReason };

/**
 * Sirf VERIFIED aur ISO-valid country ko region milta hai (region central mapping se).
 *  - country/status missing (null / unknown / koi aur value)  => missing
 *  - pending                                                  => pending
 *  - rejected                                                 => rejected
 *  - verified par code ISO me nahi / format galat             => invalid_country (kabhi Rest of World nahi)
 * Input kuch bhi ho (null, undefined, galat type) kabhi throw nahi karta aur kabhi eligible nahi deta.
 */
export function publisherRegionalEligibility(info: unknown): PublisherRegionalEligibility {
  if (typeof info !== "object" || info === null) return { eligible: false, reason: "missing" };
  const { countryCode, status } = info as { countryCode?: unknown; status?: unknown };
  if (status === "pending") return { eligible: false, reason: "pending" };
  if (status === "rejected") return { eligible: false, reason: "rejected" };
  // status null / undefined / koi anjaani value => missing. Sirf exact "verified" aage badhta hai.
  if (status !== "verified") return { eligible: false, reason: "missing" };
  if (countryCode === null || countryCode === undefined) return { eligible: false, reason: "missing" };
  const resolved = resolveCountry(countryCode);
  if (!resolved.ok) return { eligible: false, reason: "invalid_country" };
  return { eligible: true, countryCode: resolved.countryCode, region: resolved.region };
}

/**
 * Campaign ke target regions: koi region select na ho (undefined / null / khali list) => sirf Rest of World.
 * List me kuch ho par ek bhi jaana-pehchana region id na ho => khali (fail closed: kisi ko eligible nahi, Rest of World bhi nahi).
 */
export function effectiveCampaignRegions(targetRegions: readonly unknown[] | null | undefined): RegionId[] {
  if (targetRegions === null || targetRegions === undefined || targetRegions.length === 0) return ["rest_of_world"];
  return targetRegions.filter(isRegionId);
}

/**
 * Verified publisher country campaign ke regions me aati hai? Verified na ho ya country invalid ho toh false.
 * Part 2 (campaign targeting) isi ko use karega; Part 1 me ye selection se juda nahi hai.
 */
export function isPublisherEligibleForCampaignRegions(info: unknown, targetRegions: readonly unknown[] | null | undefined): boolean {
  const eligibility = publisherRegionalEligibility(info);
  if (!eligibility.eligible) return false;
  return effectiveCampaignRegions(targetRegions).includes(eligibility.region);
}

/* ---------------- Database error -> user ko dikhne wala message (raw message kabhi nahi) ---------------- */

type CountryDbError = { code?: string | null; hint?: string | null } | null | undefined;

const COUNTRY_HINT_MESSAGES: Record<string, string> = {
  invalid_country_format: "Choose your country from the list.",
  publisher_suspended: "Your publisher account is suspended, so the country cannot be changed. Please contact support.",
  self_approval_blocked: "You cannot review the country of your own account.",
  country_not_submitted: "This publisher has not submitted a country.",
  country_changed: "The publisher changed the country after you opened this page. Refresh the page and review the new country.",
  country_not_pending: "Only a country that is waiting for verification can be approved.",
};

export function mapCountryError(error: CountryDbError): string {
  if (error?.hint && Object.prototype.hasOwnProperty.call(COUNTRY_HINT_MESSAGES, error.hint)) {
    return COUNTRY_HINT_MESSAGES[error.hint];
  }
  switch (error?.code) {
    case "42501":
      return "You are not allowed to do this.";
    case "P0002":
      return "Please set up your platform details first.";
    case "22023":
      return "The country was not accepted. Check it and try again.";
    default:
      return "We could not save the country. Please try again.";
  }
}
