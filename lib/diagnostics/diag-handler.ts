// F2 (Phase 6 Day 3 Part 2): /api/diag ab login wali requests hi leta hai + per-user aur per-instance rate limit.
// PURA module: koi next / database import nahi. Login check (getUserId), clock aur log sab inject hote hain (test ke liye).
// Rate limit per-instance memory me hai (Day 2 ka accepted decision jaisa; Redis / shared storage nahi).
// Jawab: login nahi => 401, limit paar => 429 (Retry-After 60), baaki sab purani tarah khali 204 (bahar koi detail nahi).
import { buildDiagLine, cleanDiagId, cleanDiagMs, cleanDiagPath, cleanDiagText, isDiagEvent } from "@/lib/diagnostics/log";

export const DIAG_MAX_BODY_BYTES = 2048;
export const DIAG_PER_USER_PER_MINUTE = 30;
export const DIAG_PER_INSTANCE_PER_MINUTE = 120;
const MAX_TRACKED_USERS = 500;
const WINDOW_MS = 60_000;

const NO_STORE = { "Cache-Control": "no-store" };

export type DiagLimiter = { allow: (userId: string, now: number) => boolean };

/** Fixed 1-minute window: ek user ke liye aur poore instance ke liye alag cap. Tracked users bounded (memory nahi badhti). */
export function createDiagLimiter(perUser = DIAG_PER_USER_PER_MINUTE, perInstance = DIAG_PER_INSTANCE_PER_MINUTE): DiagLimiter {
  let instStart = 0;
  let instCount = 0;
  const users = new Map<string, { start: number; count: number }>();
  return {
    allow(userId, now) {
      if (now - instStart >= WINDOW_MS) {
        instStart = now;
        instCount = 0;
        for (const [k, v] of users) if (now - v.start >= WINDOW_MS) users.delete(k);
      }
      if (instCount >= perInstance) return false;
      let u = users.get(userId);
      if (!u || now - u.start >= WINDOW_MS) {
        if (!u && users.size >= MAX_TRACKED_USERS) {
          const oldest = users.keys().next().value;
          if (oldest !== undefined) users.delete(oldest);
        }
        u = { start: now, count: 0 };
        users.set(userId, u);
      }
      if (u.count >= perUser) return false;
      u.count += 1;
      instCount += 1;
      return true;
    },
  };
}

export type DiagDeps = {
  /** Verified user id (login wala) ya null. Kabhi throw nahi karna chahiye (throw hone par bhi 401 jaata hai). */
  getUserId: () => Promise<string | null>;
  now?: () => number;
  log?: (line: string) => void;
  limiter?: DiagLimiter;
};

const defaultLimiter = createDiagLimiter();

function quiet(): Response {
  return new Response(null, { status: 204, headers: NO_STORE });
}

function sameSite(request: Request): boolean {
  // Browser cross-site request par Sec-Fetch-Site: cross-site bhejta hai: seedha mana.
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "same-site" && fetchSite !== "none") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true; // same-origin request par browser Origin nahi bhi bhej sakta
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

export async function handleDiagPost(request: Request, deps: DiagDeps): Promise<Response> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.error(line));
  const limiter = deps.limiter ?? defaultLimiter;
  try {
    let userId: string | null = null;
    try {
      userId = await deps.getUserId();
    } catch {
      userId = null;
    }
    if (typeof userId !== "string" || userId.length === 0) {
      return new Response(null, { status: 401, headers: NO_STORE });
    }
    // Login pehle: bina login har request (kisi bhi Origin / header ke saath) hamesha 401 paati hai. Cross-site check uske baad.
    if (!sameSite(request)) return quiet();
    if (!limiter.allow(userId, now())) {
      return new Response(null, { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } });
    }

    const text = await request.text();
    if (text.length === 0 || text.length > DIAG_MAX_BODY_BYTES) return quiet();
    const body: unknown = JSON.parse(text);
    if (typeof body !== "object" || body === null || Array.isArray(body)) return quiet();
    const b = body as Record<string, unknown>;
    const event = b.event;
    if (!isDiagEvent(event)) return quiet();

    log(
      buildDiagLine(event, {
        source: "browser",
        path: cleanDiagPath(b.path),
        label: cleanDiagText(b.label, 60),
        boundary: cleanDiagText(b.boundary, 40),
        outcome: cleanDiagText(b.outcome, 20),
        ms: cleanDiagMs(b.ms),
        digest: cleanDiagId(b.digest),
        errName: cleanDiagText(b.errName, 60),
        errMsg: cleanDiagText(b.errMsg, 100),
        online: typeof b.online === "boolean" ? b.online : undefined,
        vercelId: cleanDiagId((request.headers.get("x-vercel-id") ?? "").split("::").pop()),
      }),
    );
  } catch {
    // diagnostics se kabhi koi error bahar nahi jaata
  }
  return quiet();
}
