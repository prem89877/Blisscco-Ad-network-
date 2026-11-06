// Tiny, dependency-free URL check shared by the API route (server) and SponsoredAd (browser).
// Only plain https links with no embedded credentials are allowed as a CTA destination.

const MAX_URL_LENGTH = 2048;

/** Returns the normalized https URL, or null when it is not safe to link to. */
export function safeHref(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_URL_LENGTH) return null;
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return null; // spaces / control characters
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null; // blocks javascript:, data:, http:, ...
  if (url.username || url.password) return null; // blocks https://trusted.com@evil.example
  if (!url.hostname) return null;
  return url.href;
}

// ---------------------------------------------------------------------------
// Rich ad fields (optional): brand_name, logo_url, image_url. Blisscco sends them only when the advertiser supplied them.
// Images are NEVER loaded from an arbitrary address: only Blisscco's own asset proxy path is accepted.
// ---------------------------------------------------------------------------

const ASSET_PATH_RE = /^\/api\/v1\/ads\/asset\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BRAND_MAX = 80;

/**
 * Returns the image URL only if it is `https://<host>/api/v1/ads/asset/<ad id>?kind=logo|image` (http only for localhost),
 * with no credentials or fragment. With `expectedOrigin` (server side) the host must also be exactly your Blisscco API host.
 */
export function safeAssetSrc(value: unknown, kind: "logo" | "image", expectedOrigin?: string): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_URL_LENGTH) return null;
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  if (url.username || url.password || url.hash || !url.hostname) return null;
  if (!ASSET_PATH_RE.test(url.pathname)) return null;
  if (url.search !== `?kind=${kind}`) return null;
  if (expectedOrigin !== undefined && url.origin !== expectedOrigin) return null;
  return url.href;
}

/** Plain-text brand name (1..80 chars, no < >, no HTML entities, no control characters), or null. */
export function safeBrandName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length === 0 || text.length > BRAND_MAX) return null;
  if (/[<>\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(text) || /&#?[0-9a-z]+;/i.test(text)) return null;
  return text;
}

export type RichFields = { brand_name?: string; logo_url?: string; image_url?: string };

/** Reads only the three optional rich fields from an ad object. Anything invalid is simply left out (text-only fallback). */
export function readRichFields(ad: { brand_name?: unknown; logo_url?: unknown; image_url?: unknown }, expectedOrigin?: string): RichFields {
  const out: RichFields = {};
  const brand = safeBrandName(ad.brand_name);
  if (brand) out.brand_name = brand;
  const logo = safeAssetSrc(ad.logo_url, "logo", expectedOrigin);
  if (logo) out.logo_url = logo;
  const image = safeAssetSrc(ad.image_url, "image", expectedOrigin);
  if (image) out.image_url = image;
  return out;
}
