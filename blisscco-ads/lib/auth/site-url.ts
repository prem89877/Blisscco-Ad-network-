import { headers } from "next/headers";

// Verification email ka link kis site par jaye. Optional NEXT_PUBLIC_SITE_URL set ho toh wahi.
// Warna current request ka host. Supabase phir bhi sirf "Redirect URLs" list wale URLs hi maanta hai.
export async function getSiteUrl(): Promise<string> {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv && /^https?:\/\/[^\s]+$/.test(fromEnv)) return fromEnv.replace(/\/+$/, "");

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
