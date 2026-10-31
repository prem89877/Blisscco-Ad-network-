import { createReviveAdapter, type ReviveAdapterDeps } from "./revive-adapter";
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
  return env[REVIVE_FALLBACK_FLAG] === "true";
}

function configFromEnv(env: FallbackEnv): Record<string, unknown> {
  const timeout = env.REVIVE_TIMEOUT_MS;
  return {
    enabled: reviveFallbackEnabled(env),
    deliveryUrl: env.REVIVE_DELIVERY_URL,
    ...(timeout === undefined || timeout === "" ? {} : { timeoutMs: /^\d{1,5}$/.test(timeout) ? Number(timeout) : Number.NaN }),
    ...(env.REVIVE_RESPONSE_FORMAT === undefined || env.REVIVE_RESPONSE_FORMAT === "" ? {} : { responseFormat: env.REVIVE_RESPONSE_FORMAT }),
  };
}

/** Har call par env se naya client (secret/URL rotate karna redeploy se). Kabhi throw nahi karta; sab failure => null (no-fill). */
export function providerFallbackFromEnv(env: FallbackEnv, deps: ReviveAdapterDeps = {}) {
  return {
    isEnabled: (): boolean => reviveFallbackEnabled(env),
    request: async (): Promise<FallbackOutcome> => {
      try {
        const out = await createReviveAdapter(configFromEnv(env), deps).requestFill();
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
