import { resolveCategory } from "./category-matching";
import type { ServeResult } from "./serve";
import type { MatchRequest } from "./types";

// Day 22 Part 3: Blisscco-first fallback ROUTING (PURA: koi database/env/network/server-only/logging nahi; sab kuch `deps` se aata hai).
//
// Order: (1) Blisscco ka apna serveAd() PEHLE chalta hai, jaisa pehle chalta tha. (2) Sirf jab uska jawab "no_fill" ho, aur server-side flag ON ho,
// tab ek external provider se ek bounded koshish hoti hai. Provider kuch bhi galat kare => wahi purana safe no-fill.
//
// Provider ka fill KABHI Blisscco ka ad nahi banta: koi serve record nahi, koi advertiser budget/spend charge nahi, koi tracking token nahi,
// koi impression/click claim nahi. Result me `source: "provider"` + `provider` naam + `blisscco` ke teen flags (sab false) saaf likhe hain.
// Yeh INTERNAL type hai: publisher ko jaane wala match response (contract.ts) isse nahi badla.

/** Provider ka raw, untrusted fill. Koi field interpret nahi hui. */
export type FallbackFill = Readonly<{ provider: string; format: "json" | "html"; data: unknown }>;

/** null = no-fill (disabled, config galat, timeout, malformed, error: sab ek jaise). */
export type FallbackOutcome = FallbackFill | null;

export type RoutedServeResult =
  | Readonly<{ source: "blisscco"; result: ServeResult }>
  | Readonly<{
      source: "provider";
      provider: string;
      fill: FallbackFill;
      /** Provider ke fill par Blisscco ne kuch nahi kiya: teeno hamesha false. */
      blisscco: Readonly<{ charged: false; serveRecorded: false; impressionClaimed: false }>;
    }>;

export type FallbackDeps = {
  /** Blisscco ka apna serve (production me serveAdForPublisher). */
  serve: (keyHash: string, request: MatchRequest) => Promise<ServeResult>;
  /** Server-side flag. Default disabled; throw => disabled. */
  isEnabled: () => boolean;
  /** Provider se ek bounded koshish. Kabhi throw na kare (karega toh bhi no-fill maana jayega). */
  request: () => Promise<FallbackOutcome>;
  /** Upar se ek aur sakht seema (provider ka apna timeout bhi hota hai). */
  timeoutMs?: number;
};

export const FALLBACK_TOTAL_TIMEOUT_MS = 3500;

const BLISSCCO_NO_FILL: RoutedServeResult = Object.freeze({ source: "blisscco" as const, result: Object.freeze({ kind: "no_fill" as const }) });
const NOT_CHARGED = Object.freeze({ charged: false as const, serveRecorded: false as const, impressionClaimed: false as const });

/**
 * Fallback sirf tab jab topic/fallback_topics me koi sensitive category nahi.
 * Day 22 Part 7: Idempotency-Key ab fallback nahi rokti. Provider fill par koi charge/serve record nahi hota, isliye retry se double charge ka khatra nahi
 * (retry par Blisscco ka apna serve pehle chalta hai: purana ad replay hota hai). Bas provider ka fill idempotent nahi: do request par do alag ad aa sakte hain.
 * (Blisscco sensitive topic par fallback se bhi no-fill deta hai; provider ko bhi nahi jaane dete.)
 */
export function fallbackAllowedFor(request: MatchRequest): boolean {
  for (const raw of [request.topic, ...(request.fallbackTopics ?? [])]) {
    const r = resolveCategory(raw);
    if (!r.ok && r.reason === "sensitive_category") return false;
  }
  return true;
}

function sealed(fill: FallbackFill): FallbackFill {
  const copy = { provider: fill.provider, format: fill.format, data: fill.data };
  // Galti se JSON me serialize hone par raw data bahar na jaye.
  Object.defineProperty(copy, "toJSON", { value: () => ({ provider: copy.provider, format: copy.format }), enumerable: false });
  return Object.freeze(copy);
}

function validFill(x: unknown): x is FallbackFill {
  if (x === null || typeof x !== "object") return false;
  const f = x as Record<string, unknown>;
  if (typeof f.provider !== "string" || f.provider.length === 0) return false;
  if (f.format === "json") return f.data !== null && typeof f.data === "object" && !Array.isArray(f.data);
  if (f.format === "html") return typeof f.data === "string" && f.data.trim() !== "";
  return false;
}

async function tryProvider(deps: FallbackDeps): Promise<FallbackOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const call = Promise.resolve().then(() => deps.request());
    call.catch(() => undefined); // timeout ke baad late reject => unhandled rejection nahi
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), Math.max(1, deps.timeoutMs ?? FALLBACK_TOTAL_TIMEOUT_MS));
    });
    const out = await Promise.race([call, timeout]);
    if (out === "timeout" || !validFill(out)) return null;
    return sealed(out);
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Kabhi throw nahi karta. */
export async function routeServeWithFallback(keyHash: string, request: MatchRequest, deps: FallbackDeps): Promise<RoutedServeResult> {
  let blisscco: ServeResult;
  try {
    blisscco = await deps.serve(keyHash, request);
  } catch {
    return Object.freeze({ source: "blisscco" as const, result: Object.freeze({ kind: "unavailable" as const }) });
  }
  // Sirf genuine "koi eligible ad nahi". ad / unauthorized / rate_limited / unavailable jaise ke taise (provider ko bulaya hi nahi jaata).
  if (blisscco.kind !== "no_fill") return Object.freeze({ source: "blisscco" as const, result: blisscco });

  let enabled = false;
  try {
    enabled = deps.isEnabled() === true;
  } catch {
    enabled = false;
  }
  if (!enabled || !fallbackAllowedFor(request)) return BLISSCCO_NO_FILL;

  const fill = await tryProvider(deps);
  if (!fill) return BLISSCCO_NO_FILL;
  return Object.freeze({ source: "provider" as const, provider: fill.provider, fill, blisscco: NOT_CHARGED });
}
