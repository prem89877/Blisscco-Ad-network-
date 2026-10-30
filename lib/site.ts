// Site ka asli web address (sitemap, social preview ke liye). Pehle NEXT_PUBLIC_SITE_URL, phir Vercel ka production URL.
// env bahar se aata hai taaki bina server ke test ho sake.

type SiteEnv = { NEXT_PUBLIC_SITE_URL?: string; VERCEL_PROJECT_PRODUCTION_URL?: string };

export const FALLBACK_SITE_URL = "http://localhost:3000";

export function siteBaseUrl(env: SiteEnv = process.env as SiteEnv): string {
  const explicit = (env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "");
  if (/^https?:\/\/[^\s/]+$/i.test(explicit)) return explicit;

  const vercel = (env.VERCEL_PROJECT_PRODUCTION_URL ?? "").trim().replace(/\/+$/, "");
  if (/^[a-z0-9.-]+$/i.test(vercel) && vercel.length > 0) return `https://${vercel}`;

  return FALLBACK_SITE_URL;
}
