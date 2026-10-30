import { normalizeCategoryToken } from "../ads/category-matching";
import { isCampaignStatus, type CampaignDbStatus } from "./constants";

// Campaign list ke search/filter. URL ?q=&status=&category= se aate hain, isliye har value ko
// server par dobara validate karte hain. Advertiser ki id KABHI URL se nahi li jaati.

export type CampaignFilters = { q: string; status: CampaignDbStatus | ""; category: string };

export const EMPTY_FILTERS: CampaignFilters = { q: "", status: "", category: "" };
export const SEARCH_MAX = 100;

const CATEGORY_SLUG_RE = /^[a-z0-9_]{1,50}$/;

type RawParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

/**
 * ?category= ko wahi safai (casing, spaces, hyphen) jo matching me hoti hai, taaki "Gaming " filter chup-chaap gayab na ho.
 * Alias nahi lagta (tech -> technology nahi): filter DB ki asli category par chalta hai, purani legacy (beauty) par bhi.
 */
function cleanCategory(raw: string): string {
  const n = normalizeCategoryToken(raw);
  return n.ok && CATEGORY_SLUG_RE.test(n.token) ? n.token : "";
}

export function parseFilters(sp: RawParams): CampaignFilters {
  const q = first(sp.q)
    .replace(/[\u0000-\u001f*]/g, " ") // control chars aur '*' (PostgREST wildcard) hata do
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SEARCH_MAX);
  const status = first(sp.status);
  const category = first(sp.category);
  return {
    q,
    status: isCampaignStatus(status) ? status : "",
    category: cleanCategory(category),
  };
}

export function hasActiveFilters(f: CampaignFilters): boolean {
  return f.q !== "" || f.status !== "" || f.category !== "";
}

/** LIKE ke special characters (\ % _) ko plain text banata hai, taaki search sirf naam me dhundhe. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

/** Filters ko wapas URL me (list page ka link). */
export function filtersToHref(basePath: string, f: CampaignFilters): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.status) p.set("status", f.status);
  if (f.category) p.set("category", f.category);
  const qs = p.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
