import { CATEGORY_OPTIONS, type CampaignCategory } from "../campaigns/constants";

// Day 5 contextual category taxonomy (code side). Pure data, koi database/network nahi.
//
// Source of truth:
//   * Canonical slugs = lib/campaigns/constants.ts CATEGORY_OPTIONS (wahi list database table
//     public.ad_categories me hai, day-5-1). Yahan dobara type nahi ki gayi, taaki do list alag na ho jayein.
//   * Database me HAMESHA canonical slug hi store hota hai (campaigns.category, ad_serve_log.topic).
//   * ALIASES sirf CODE me hain (input ko saaf karne ke liye, jaise "games" -> "gaming").
//     Ye database me nahi hain, isliye koi migration/mapping table nahi chahiye.
//
// Privacy rule: sensitive categories (health, religion, politics, sexuality, ...) taxonomy me KABHI nahi jodni.
// SENSITIVE_CATEGORY_TERMS unhe alag se pehchaan kar reject karta hai, aur test check karta hai ki
// koi alias/slug un terms se na takraye.

export type CategorySlug = CampaignCategory;

/** Har canonical slug ke liye allowed aliases. Record hone se naya slug jodte hi compiler yahan entry maangega. */
// Alias ka format normalized hona chahiye: lowercase, a-z0-9 aur "_" (max 3 shabd). Test ye check karta hai.
export const CATEGORY_ALIASES: Readonly<Record<CategorySlug, readonly string[]>> = {
  developer_tools: ["dev_tools", "devtools", "developer_tool", "coding_tools"],
  education: ["edtech", "e_learning", "elearning"],
  finance: ["fintech"],
  fitness: ["workouts", "exercise"],
  food: ["cooking", "recipes"],
  gaming: ["games", "video_games", "videogames"],
  lifestyle: [],
  technology: ["tech"],
  travel: ["tourism", "trips"],
};

/**
 * Purani (legacy) categories: database me hain par is_active = false (day-5-1). Inpar ad kabhi match nahi hota.
 * Isliye signal me aaye toh "unsupported" maana jata hai.
 */
export const LEGACY_INACTIVE_CATEGORIES: readonly string[] = ["beauty"];

/**
 * Sensitive topics: signal me aayein toh alag reason ke saath reject (taaki log/test me saaf dikhe).
 * Ye list "kya reject karna hai" ka safety-net hai, "kya allow karna hai" ka nahi: allow sirf taxonomy se hota hai.
 * Is list me aur terms jodna theek hai; hatana mat.
 */
export const SENSITIVE_CATEGORY_TERMS: readonly string[] = [
  "health",
  "healthcare",
  "medical",
  "medicine",
  "mental_health",
  "therapy",
  "disability",
  "pregnancy",
  "addiction",
  "religion",
  "religious",
  "politics",
  "political",
  "sexuality",
  "sexual_orientation",
  "gender_identity",
  "ethnicity",
  "race",
  "caste",
  "immigration",
  "criminal",
  "union",
];

export type TaxonomyEntry = {
  slug: string;
  label: string;
  active: boolean;
};

/** Active entries, CATEGORY_OPTIONS ke order me. */
export const ACTIVE_CATEGORIES: readonly TaxonomyEntry[] = CATEGORY_OPTIONS.map((o) => ({
  slug: o.value,
  label: o.label,
  active: true,
}));

const SENSITIVE_SET: ReadonlySet<string> = new Set(SENSITIVE_CATEGORY_TERMS);
const LEGACY_SET: ReadonlySet<string> = new Set(LEGACY_INACTIVE_CATEGORIES);

// Map (object nahi): "__proto__", "constructor" jaisi keys se lookup kabhi dhokha nahi khayega.
const LOOKUP: ReadonlyMap<string, CategorySlug> = (() => {
  const m = new Map<string, CategorySlug>();
  for (const o of CATEGORY_OPTIONS) {
    m.set(o.value, o.value);
    for (const alias of CATEGORY_ALIASES[o.value]) m.set(alias, o.value);
  }
  return m;
})();

export function isSensitiveTerm(token: string): boolean {
  return SENSITIVE_SET.has(token);
}

export function isLegacyInactive(token: string): boolean {
  return LEGACY_SET.has(token);
}

/** Normalized token ko canonical active slug me badalta hai (exact match, substring kabhi nahi). Na mile toh null. */
export function lookupCategory(token: string): CategorySlug | null {
  return LOOKUP.get(token) ?? null;
}
