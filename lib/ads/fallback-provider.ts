import { createReviveAdapter, extractReviveCreative, reviveEnvEnabled, reviveRawConfigFromEnv, type ReviveAdapterDeps } from "./revive-adapter";
import { buildProviderAdResponse, type MatchSuccessResponse } from "./contract";
import type { FallbackOutcome } from "./fallback-routing";

// Day 22 Part 3: Revive ko fallback routing se jodne wali CHHOTI wiring. Env khud nahi padhta (caller `env` deta hai: service.ts).
// Koi database/billing/ledger import nahi. Default: flag band => provider ko kuch nahi bheja jaata.
//
// Server-only env (koi NEXT_PUBLIC_ nahi; sab optional; flag na ho toh sab band):
//   REVIVE_FALLBACK_ENABLED  = "true" (sirf yahi exact value chalu karti hai)
//   REVIVE_DELIVERY_URL      = https delivery URL (ise kabhi log/return nahi kiya jaata)
//   REVIVE_TIMEOUT_MS        = optional integer (default adapter ka)
//   REVIVE_RESPONSE_FORMAT   = optional "json" | "html"

export type FallbackEnv = Readonly<Record<string, string | undefined>>;

export const REVIVE_FALLBACK_FLAG = "REVIVE_FALLBACK_ENABLED";

export function reviveFallbackEnabled(env: FallbackEnv): boolean {
  return reviveEnvEnabled(env); // Day 23 Part 1: parsing ek hi jagah (revive-adapter.ts)
}

/** Har call par env se naya client (secret/URL rotate karna redeploy se). Kabhi throw nahi karta; sab failure => null (no-fill). */
export function providerFallbackFromEnv(env: FallbackEnv, deps: ReviveAdapterDeps = {}) {
  return {
    isEnabled: (): boolean => reviveFallbackEnabled(env),
    request: async (): Promise<FallbackOutcome> => {
      try {
        const out = await createReviveAdapter(reviveRawConfigFromEnv(env), deps).requestFill();
        if (out.status !== "fill") return null;
        return out.format === "json"
          ? { provider: "revive", format: "json", data: out.payload }
          : { provider: "revive", format: "html", data: out.body };
      } catch {
        return null;
      }
    },
  };
}

/**
 * Day 22 Part 6: provider ka raw fill => publisher ko jaane wala PUBLIC match response (ya null = no-fill).
 * Raw fill pehle extractReviveCreative (sirf 4 allowlisted text fields), phir buildProviderAdResponse (plain text + safeDestination).
 * Response me `tracking` kabhi nahi hota. Kabhi throw nahi karta; koi bhi galti => null.
 */
export function publicAdFromFallbackFill(fill: unknown): MatchSuccessResponse | null {
  try {
    const creative = extractReviveCreative(fill);
    if (!creative.ok) return null;
    const mapped = buildProviderAdResponse(creative.provider, creative.creative);
    return mapped.ok ? mapped.response : null;
  } catch {
    return null;
  }
}
