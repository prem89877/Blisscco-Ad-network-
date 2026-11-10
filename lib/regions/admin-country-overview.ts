import { REGION_LABELS, resolveCountry, type RegionId } from "./country-region";
import {
  COUNTRY_STATUS_LABELS,
  countryDisplayName,
  isCountryVerificationStatus,
  publisherRegionalEligibility,
  type CountryVerificationStatus,
} from "./publisher-country";

// Phase 6 Step 3 Part 3: Admin ke liye country overview (PURA module: koi database / env / server-only nahi).
//
// Kuch naya policy / workflow nahi: sirf PADHNE wali jaankari.
//  - Country ISO check, region, aur publisher verification gate PEHLE se bane modules se aate hain
//    (country-region.ts, publisher-country.ts); yahan koi dusri country list ya mapping nahi hai.
//  - Publisher approve / reject Step 2 ke maujooda admin_review_publisher_country se hi hota hai (PublisherCountryPanel).
//  - Advertiser country sirf business-profile jaankari hai: iske liye koi approval / verification nahi (Part 1 ka faisla).
//  - Purani rows (country null) ko galti nahi maana jaata: "missing" dikhta hai, aur koi data badalta nahi.

/* ---------------- Advertiser ---------------- */

export type AdvertiserCountryState = "missing" | "valid" | "invalid";

export const ADVERTISER_COUNTRY_STATE_LABELS: Record<AdvertiserCountryState, string> = {
  missing: "Country not chosen",
  valid: "Country set",
  invalid: "Invalid country code",
};

export type AdminAdvertiserCountryRow = {
  id: string;
  name: string;
  /** advertisers.status: pending / active / suspended (account approval, country se alag). */
  accountStatus: string;
  countryCode: string | null;
  state: AdvertiserCountryState;
  region: RegionId | null;
  /** missing ya invalid => admin ko dikhna chahiye. */
  incompleteOrInvalid: boolean;
};

/** Stored advertisers.country_code -> state + region. Region sirf ISO-valid code ko milta hai (kabhi silent Rest of World nahi). */
export function classifyAdvertiserCountry(code: unknown): { state: AdvertiserCountryState; countryCode: string | null; region: RegionId | null } {
  if (code === null || code === undefined) return { state: "missing", countryCode: null, region: null };
  if (typeof code === "string" && code.trim().length === 0) return { state: "missing", countryCode: null, region: null };
  const r = resolveCountry(code);
  if (!r.ok) return { state: "invalid", countryCode: typeof code === "string" ? code : null, region: null };
  return { state: "valid", countryCode: r.countryCode, region: r.region };
}

/** Database row (unknown) -> admin row. id / name / status ke bina null (caller us row ko chhod deta hai). */
export function toAdminAdvertiserRow(row: unknown): AdminAdvertiserCountryRow | null {
  if (typeof row !== "object" || row === null) return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.company_name !== "string" || typeof r.status !== "string") return null;
  const c = classifyAdvertiserCountry(r.country_code);
  return {
    id: r.id,
    name: r.company_name,
    accountStatus: r.status,
    countryCode: c.countryCode,
    state: c.state,
    region: c.region,
    incompleteOrInvalid: c.state !== "valid",
  };
}

/* ---------------- Publisher ---------------- */

/**
 * Admin ke nazariye se publisher country ki halat.
 *  missing         : country_code aur country_status dono null (purane publishers / abhi submit nahi ki)
 *  incomplete      : sirf ek set (code ya status), ya status jaanti-pehchani nahi
 *  invalid_country : code ISO me nahi (status kuch bhi ho)
 *  pending / verified / rejected : Step 2 ka verification status (code ISO-valid)
 */
export type PublisherCountryAdminState = "missing" | "incomplete" | "invalid_country" | CountryVerificationStatus;

export const PUBLISHER_COUNTRY_ADMIN_LABELS: Record<PublisherCountryAdminState, string> = {
  missing: "Country not submitted",
  incomplete: "Country details incomplete",
  invalid_country: "Invalid country code",
  pending: COUNTRY_STATUS_LABELS.pending,
  verified: COUNTRY_STATUS_LABELS.verified,
  rejected: COUNTRY_STATUS_LABELS.rejected,
};

export type AdminPublisherCountryRow = {
  id: string;
  name: string;
  /** publishers.status: pending / active / suspended (account approval, country se alag). */
  accountStatus: string;
  countryCode: string | null;
  state: PublisherCountryAdminState;
  /** ISO-valid code ka region (jaankari ke liye, pending / rejected me bhi). Regional ads ka gate alag hai: regionalEligible. */
  region: RegionId | null;
  /** Sirf verified + ISO-valid country => true (publisherRegionalEligibility, EKLAUTA gate). */
  regionalEligible: boolean;
  /** missing / incomplete / invalid_country => admin ko dikhna chahiye. */
  incompleteOrInvalid: boolean;
  /** Valid country, status pending => admin ke review ka intezaar. */
  awaitingReview: boolean;
};

export function classifyPublisherCountry(code: unknown, status: unknown): { state: PublisherCountryAdminState; countryCode: string | null } {
  const codeEmpty = code === null || code === undefined;
  const statusEmpty = status === null || status === undefined;
  if (codeEmpty && statusEmpty) return { state: "missing", countryCode: null };
  if (codeEmpty || statusEmpty) return { state: "incomplete", countryCode: typeof code === "string" ? code : null };
  if (typeof code !== "string" || !isCountryVerificationStatus(status)) return { state: "incomplete", countryCode: typeof code === "string" ? code : null };
  if (!resolveCountry(code).ok) return { state: "invalid_country", countryCode: code };
  return { state: status, countryCode: code };
}

export function toAdminPublisherRow(row: unknown): AdminPublisherCountryRow | null {
  if (typeof row !== "object" || row === null) return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.name !== "string" || typeof r.status !== "string") return null;
  const c = classifyPublisherCountry(r.country_code, r.country_status);
  const resolved = c.countryCode === null ? null : resolveCountry(c.countryCode);
  const eligibility = publisherRegionalEligibility({ countryCode: r.country_code, status: r.country_status });
  return {
    id: r.id,
    name: r.name,
    accountStatus: r.status,
    countryCode: c.countryCode,
    state: c.state,
    region: resolved && resolved.ok ? resolved.region : null,
    regionalEligible: eligibility.eligible,
    incompleteOrInvalid: c.state === "missing" || c.state === "incomplete" || c.state === "invalid_country",
    awaitingReview: c.state === "pending",
  };
}

/* ---------------- Screen text ---------------- */

function where(code: string | null, region: RegionId | null): string {
  if (code === null) return "";
  return region ? `${countryDisplayName(code)} · ${REGION_LABELS[region]}` : code;
}

/** Ek line: "India (IN) · South Asia" / "Country not chosen" / "XX · Invalid country code". */
export function describeAdvertiserCountry(row: AdminAdvertiserCountryRow): string {
  if (row.state === "valid") return where(row.countryCode, row.region);
  if (row.state === "invalid") return `${row.countryCode ?? "?"} · ${ADVERTISER_COUNTRY_STATE_LABELS.invalid}`;
  return ADVERTISER_COUNTRY_STATE_LABELS.missing;
}

/** Ek line: "India (IN) · South Asia · Waiting for verification" / "Country not submitted". */
export function describePublisherCountry(row: AdminPublisherCountryRow): string {
  if (row.state === "missing") return PUBLISHER_COUNTRY_ADMIN_LABELS.missing;
  if (row.state === "incomplete") return `${row.countryCode ? `${row.countryCode} · ` : ""}${PUBLISHER_COUNTRY_ADMIN_LABELS.incomplete}`;
  if (row.state === "invalid_country") return `${row.countryCode ?? "?"} · ${PUBLISHER_COUNTRY_ADMIN_LABELS.invalid_country}`;
  return `${where(row.countryCode, row.region)} · ${PUBLISHER_COUNTRY_ADMIN_LABELS[row.state]}`;
}

/* ---------------- Summary ---------------- */

export type AdminCountrySummary = {
  advertisers: { total: number; valid: number; missing: number; invalid: number };
  publishers: { total: number; missing: number; incomplete: number; invalidCountry: number; pending: number; verified: number; rejected: number };
};

export function summarizeAdvertiserCountries(rows: readonly AdminAdvertiserCountryRow[]): AdminCountrySummary["advertisers"] {
  const s = { total: rows.length, valid: 0, missing: 0, invalid: 0 };
  for (const r of rows) s[r.state] += 1;
  return s;
}

export function summarizePublisherCountries(rows: readonly AdminPublisherCountryRow[]): AdminCountrySummary["publishers"] {
  const s = { total: rows.length, missing: 0, incomplete: 0, invalidCountry: 0, pending: 0, verified: 0, rejected: 0 };
  for (const r of rows) {
    if (r.state === "invalid_country") s.invalidCountry += 1;
    else s[r.state] += 1;
  }
  return s;
}
