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
