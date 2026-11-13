// Phase 6 Day 3 Part 2 (F1): Content-Security-Policy ki Report-Only definition. Sirf Preview par lagti hai (next.config.mjs).
// Report-Only = kuch block nahi hota; violations sirf browser DevTools console me dikhte hain. Koi secret yahan nahi aata.
// Supabase origin sirf signed Storage images (CreativePreview) ke liye img-src me jaata hai; public URL se nikalta hai.
export function supabaseOrigin(url) {
  try {
    const u = new URL(String(url ?? ""));
    return u.protocol === "https:" ? u.origin : "";
  } catch {
    return "";
  }
}

export function buildCspReportOnly(supabaseUrl) {
  const origin = supabaseOrigin(supabaseUrl);
  const img = ["'self'", "data:", "blob:", origin].filter(Boolean).join(" ");
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `img-src ${img}`,
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");
}

/** Sirf Vercel Preview par header deta hai; Production / local par khali list (koi badlav nahi). */
export function cspHeaders(env) {
  if (env.VERCEL_ENV !== "preview") return [];
  return [{ key: "Content-Security-Policy-Report-Only", value: buildCspReportOnly(env.NEXT_PUBLIC_SUPABASE_URL) }];
}
