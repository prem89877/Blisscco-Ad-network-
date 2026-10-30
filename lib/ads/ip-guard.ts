// IP par "galat key" ki roktham (best-effort, server memory me). PURA module: koi database/env/clock bahar se aata hai.
//
// Kyun: sahi-format par galat key har baar database tak jaati hai. Ye guard ek hi IP se bahut saari galat keys aane par
// database tak jaane se PEHLE 429 de deta hai.
// Limit: Vercel me har server instance ki memory alag hoti hai, isliye ye poori suraksha nahi, sirf pehli deewar hai.
// Asli (poori) rok ke liye Vercel Firewall rate-limit rule bhi lagao (DAY7-FIXES.md).
// IP sirf memory me rehti hai (kuch seconds/minute), database ya log me kabhi nahi jaati.

export const FAILURE_LIMIT = 20; // ek IP se 1 minute me itni galat key ke baad 429
export const WINDOW_MS = 60_000;
export const MAX_TRACKED_IPS = 5_000;

type Entry = { count: number; windowStart: number };

export type IpGuard = {
  /** true = is IP ko abhi rok do (database tak mat jao). */
  isBlocked(ip: string | null, now: number): boolean;
  /** Galat/missing key ya unauthorized jawab ke baad bulao. */
  recordFailure(ip: string | null, now: number): void;
};

export function createIpGuard(limit: number = FAILURE_LIMIT, windowMs: number = WINDOW_MS): IpGuard {
  const entries = new Map<string, Entry>();

  function prune(now: number): void {
    for (const [key, e] of entries) {
      if (now - e.windowStart >= windowMs) entries.delete(key);
    }
    // Phir bhi bahut zyada ho toh sabse purani hata do (memory kabhi nahi bharti).
    while (entries.size > MAX_TRACKED_IPS) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  return {
    isBlocked(ip, now) {
      if (!ip) return false;
      const e = entries.get(ip);
      if (!e) return false;
      if (now - e.windowStart >= windowMs) {
        entries.delete(ip);
        return false;
      }
      return e.count >= limit;
    },
    recordFailure(ip, now) {
      if (!ip) return;
      const e = entries.get(ip);
      if (!e || now - e.windowStart >= windowMs) {
        entries.delete(ip);
        entries.set(ip, { count: 1, windowStart: now });
      } else {
        e.count += 1;
      }
      if (entries.size > MAX_TRACKED_IPS) prune(now);
    },
  };
}

const IP_RE = /^[0-9a-fA-F:.]{3,45}$/;

/** Proxy header se client IP. Format galat/missing ho toh null (guard skip). Vercel pehla x-forwarded-for deta hai. */
export function clientIpFromHeaders(headers: { get(name: string): string | null }): string | null {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded ? forwarded.split(",")[0].trim() : "";
  const candidate = first || (headers.get("x-real-ip") ?? "").trim();
  return IP_RE.test(candidate) ? candidate : null;
}
