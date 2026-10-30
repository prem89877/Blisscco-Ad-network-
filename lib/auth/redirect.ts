// Open-redirect se bachav: login/logout ke baad sirf apne /dashboard ke andar ke path allowed.
// "https://evil.com", "//evil.com", "/\evil.com" jaise sab fallback par chale jaate hain.
const DEFAULT_PATH = "/dashboard";

export function safeNextPath(raw: unknown, fallback: string = DEFAULT_PATH): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 500) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;

  let parsed: URL;
  try {
    parsed = new URL(raw, "http://localhost");
  } catch {
    return fallback;
  }
  if (parsed.origin !== "http://localhost") return fallback;
  if (parsed.pathname !== "/dashboard" && !parsed.pathname.startsWith("/dashboard/")) return fallback;
  return parsed.pathname + parsed.search;
}
