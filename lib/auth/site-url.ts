import { headers } from "next/headers";
import { resolveSiteUrl } from "./site-url-parse";

// Verification email ka link kis site par jaye. Optional NEXT_PUBLIC_SITE_URL set ho toh wahi.
// Warna current request ka host, par sirf tab jab wo saaf hostname ho (poori jaanch: site-url-parse.ts).
// Supabase phir bhi sirf "Redirect URLs" list wale URLs hi maanta hai (dusri deewar).
export async function getSiteUrl(): Promise<string> {
  const h = await headers();
  return resolveSiteUrl({
    envUrl: process.env.NEXT_PUBLIC_SITE_URL,
    forwardedHost: h.get("x-forwarded-host"),
    host: h.get("host"),
    forwardedProto: h.get("x-forwarded-proto"),
  });
}
