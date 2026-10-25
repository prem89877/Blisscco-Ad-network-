// Verification email ka link kis site par jaye: PURA (pure) logic, koi next/headers nahi (isliye test ho sakta hai).
// Part 3 hardening: pehle x-forwarded-host / host header jaisa aaya waisa hi link me chala jata tha.
// Koi bahari vyakti header badal kar email ka link apni site par mod sakta tha (host header poisoning).
// Ab: (1) NEXT_PUBLIC_SITE_URL set hai toh wahi (sabse safe), (2) warna header tabhi maana jata hai jab wo
// ek saaf hostname ho (sirf letters, numbers, '-' , '.', optional port), (3) nahi toh localhost par girta hai.

const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i;
const FALLBACK_HOST = "localhost:3000";

export type SiteUrlInput = {
  envUrl: string | undefined;
  forwardedHost: string | null;
  host: string | null;
  forwardedProto: string | null;
};

/** Env wala URL tabhi jab wo saaf http(s) URL ho aur usme username/password na ho. Warna null. */
export function cleanEnvSiteUrl(raw: string | undefined): string | null {
  if (!raw || !/^https?:\/\/[^\s]+$/.test(raw)) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
  } catch {
    return null;
  }
  return raw.replace(/\/+$/, "");
}

/** Header ki value se ek saaf host nikalta hai (comma list ho toh pehla). Galat ho toh null. */
export function cleanHostHeader(raw: string | null): string | null {
  if (!raw) return null;
  const first = raw.split(",")[0].trim();
  if (first.length === 0 || first.length > 255) return null;
  return HOST_RE.test(first) ? first.toLowerCase() : null;
}

function isLocalHost(host: string): boolean {
  return host === "localhost" || host.startsWith("localhost:") || host === "127.0.0.1" || host.startsWith("127.0.0.1:");
}

export function resolveSiteUrl(input: SiteUrlInput): string {
  const fromEnv = cleanEnvSiteUrl(input.envUrl);
  if (fromEnv) return fromEnv;

  const host = cleanHostHeader(input.forwardedHost) ?? cleanHostHeader(input.host) ?? FALLBACK_HOST;
  // Asli (non-local) site par email ka link hamesha https. Header ke "http" par bharosa nahi.
  const proto = isLocalHost(host) && input.forwardedProto !== "https" ? "http" : "https";
  return `${proto}://${host}`;
}
