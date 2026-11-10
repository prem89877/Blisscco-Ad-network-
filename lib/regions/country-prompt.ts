// Phase 6 Step 3 Part 3-ish (login country prompt): login ke baad dashboard khulne se pehle country chunne ka screen kab dikhana hai.
// PURA module: koi database / env / cookies nahi. Country ki jaanch ya region mapping yahan NAHI (lib/regions/country-region.ts me hi hai).
//
// Prompt sirf tab jab advertiser / publisher ne country nahi chuni:
//   - account row hi nahi (naya user)            => "setup"   (business / platform ka form, usme country dropdown)
//   - account hai par country nahi               => "country" (sirf country form)
// Publisher ki pending / verified / rejected country par prompt NAHI (rejected ke liye publisher page / overview ka resubmit hai).
// Load fail, suspended account, admin => prompt nahi (galat form ya nagging nahi).
// "Later" cookie me user id + last_sign_in_at hota hai: naya login (last_sign_in_at badalta hai) => cookie purani => dobara prompt.

export const COUNTRY_PROMPT_COOKIE = "bc_country_later";

export type CountryPromptMode = "setup" | "country";

export type CountryPromptInput = {
  role: unknown;
  /** Account (advertiser / publisher row) load fail hua? */
  accountFailed: boolean;
  accountExists: boolean;
  suspended: boolean;
  /** Country state; null = load fail. Advertiser: status undefined. */
  country: { countryCode: string | null; status?: string | null } | null;
};

export function countryPromptMode(input: CountryPromptInput): CountryPromptMode | null {
  const { role } = input;
  if (role !== "advertiser" && role !== "publisher") return null;
  if (input.accountFailed) return null;
  if (!input.accountExists) return "setup";
  if (input.suspended) return null;
  if (input.country === null) return null;
  if (role === "advertiser") return input.country.countryCode === null ? "country" : null;
  return input.country.countryCode === null || input.country.status === null || input.country.status === undefined ? "country" : null;
}

/** "Later" cookie ki value: is user + is login. Pehchan na ho toh null (cookie kabhi match nahi karegi). */
export function countryPromptMarker(user: { id?: unknown; last_sign_in_at?: unknown } | null | undefined): string | null {
  if (!user || typeof user.id !== "string" || user.id.length === 0) return null;
  const at = typeof user.last_sign_in_at === "string" ? user.last_sign_in_at : "";
  return `${user.id}|${at}`;
}

export function isCountryPromptSkipped(cookieValue: unknown, marker: string | null): boolean {
  return marker !== null && typeof cookieValue === "string" && cookieValue === marker;
}
