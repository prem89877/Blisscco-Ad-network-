// Diagnostics (Vercel logs): "button bohot der tak atka / error screen aayi" ka sabab dhoondhne ke liye.
// Ye module pure hai (koi import nahi, Node + Edge dono me chalta hai) taaki test me seedha chale.
// Niyam: sirf SAFE, chhoti, whitelisted cheezein log hoti hain (event ka naam, path bina query ke, ms, digest). Koi token / key / email / form value kabhi nahi.
// Har line "[diag]" se shuru hoti hai: Vercel > Logs me search box me `[diag]` likho.

export const DIAG_EVENTS = ["action_slow", "action_timeout", "action_failed", "error_boundary", "request_slow", "request_trace"] as const;
export type DiagEvent = (typeof DIAG_EVENTS)[number];

export function isDiagEvent(v: unknown): v is DiagEvent {
  return typeof v === "string" && (DIAG_EVENTS as readonly string[]).includes(v);
}

/** Server action / request itna dheema ho toh log hota hai (ms). Env DIAG_SLOW_MS se badal sakte ho. */
export const DEFAULT_SLOW_MS = 3_000;

export type DiagFields = Record<string, string | number | boolean | null | undefined>;

/** Ek value ko log ke liye safe banata hai: control chars / newline hatata hai (log injection nahi), lambai value kaat deta hai. */
export function cleanDiagText(value: unknown, max = 120): string {
  const s = typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : "";
  return s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Sirf path (query / hash kaat deta hai: query me token ho sakta hai). Path "/" se shuru na ho toh khali. */
export function cleanDiagPath(value: unknown): string {
  const s = cleanDiagText(value, 300);
  if (!s.startsWith("/") || s.startsWith("//")) return "";
  return s.split(/[?#]/)[0].slice(0, 200);
}

/** Vercel digest jaisi id (letters / digits / - _). Kuch aur ho toh khali. */
export function cleanDiagId(value: unknown): string {
  const s = cleanDiagText(value, 64);
  return /^[A-Za-z0-9_-]+$/.test(s) ? s : "";
}

export function cleanDiagMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.min(Math.round(value), 3_600_000);
}

/** Log ki ek line: `[diag] event=action_slow path=/dashboard ms=7200 ...` (key=value, khali values chhod deta hai). */
export function buildDiagLine(event: DiagEvent, fields: DiagFields): string {
  const parts: string[] = [`[diag] event=${event}`];
  for (const [key, raw] of Object.entries(fields)) {
    if (raw === undefined || raw === null || raw === "") continue;
    if (!/^[a-z][a-zA-Z0-9_]{0,30}$/.test(key)) continue;
    const v = cleanDiagText(raw, 160);
    if (v === "") continue;
    parts.push(/\s/.test(v) ? `${key}="${v.replace(/"/g, "'")}"` : `${key}=${v}`);
  }
  return parts.join(" ");
}

/** Vercel project logs me dikhne ke liye console.error (error level par filter karna aasan). */
export function diagLog(event: DiagEvent, fields: DiagFields): void {
  try {
    console.error(buildDiagLine(event, fields));
  } catch {
    // logging kabhi request ko nahi todta
  }
}

export function slowThresholdMs(env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {}): number {
  const n = Number(env.DIAG_SLOW_MS);
  return Number.isFinite(n) && n >= 100 && n <= 600_000 ? Math.round(n) : DEFAULT_SLOW_MS;
}

/** DIAG_VERBOSE=1 hone par har /dashboard request ki ek line (304 / conditional request pakadne ke liye). Default band. */
export function isDiagVerbose(env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {}): boolean {
  return env.DIAG_VERBOSE === "1";
}

/** startedAt se ab tak ms; threshold se zyada ho toh `request_slow` log karta hai. Lautata hai kitne ms lage. */
export function logIfSlow(label: string, startedAt: number, extra: DiagFields = {}, now: number = Date.now()): number {
  const ms = Math.max(0, now - startedAt);
  if (ms >= slowThresholdMs()) diagLog("request_slow", { label, ms, ...extra });
  return ms;
}
