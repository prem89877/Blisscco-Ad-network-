import "server-only";
import { loadAdCandidates } from "./candidate-loader";
import { acceptClick, type ClickResult } from "./click";
import type { MatchSuccessResponse } from "./contract";
import { mintClickRef } from "./click-ref";
import { lookupServeForClick, recordClickEvent } from "./click-db";
import { routeServeWithFallback, type RoutedServeResult } from "./fallback-routing";
import { providerFallbackFromEnv, publicAdFromFallbackFill } from "./fallback-provider";
import { acceptImpression, type ImpressionResult } from "./impression";
import { lookupServeForEvent, recordImpressionEvent } from "./impression-db";
import { selectAd } from "./selection";
import { serveAd, type ServeDeps, type ServeResult } from "./serve";
import { authorizePublisher, findIdempotentServe, recordServe } from "./serve-db";
import { mintTrackingToken, readTrackingConfig, trackingSecretStatus, type TrackingConfig } from "./tracking-token";
import type { MatchRequest } from "./types";
// NOTE (owner): Deployment se pehle impressions aur clicks ki ginti (tracking) aur baaki related cheezein (etc.) ka kaam/review kiya jayega.
// Tab tak "serve" hi charge ka aadhar hai (billing/payout ke liye use mat karna).

// Production wiring: asli database + asli clock. Route sirf yahi function chalata hai.
//
// spendTracking = "reliable" (Day 7): record_ad_serve (day-7-1 SQL) har serve ki keemat campaign_spend_daily me likhta hai
// aur budget paar hone par serve rok deta hai. Charge abhi "serve" par lagta hai (impression tracking alag feature hai).
// NOTE: day-7-1-budget-keys-retention.sql chalaye bina is code ko deploy mat karna: purani SQL budget nahi likhti.
// Day 9-3: `Idempotency-Key` header (optional) ke liye day-9-5-atomic-spend-idempotency.sql bhi pehle chalao. Header na ho toh
// purana 3-arg record_ad_serve hi chalta hai; header ho aur 9-5 na chali ho toh request 503 deti hai (charge nahi hota).

// Day 12 Part 3: tracking token. Secret SIRF server env (AD_TRACKING_SECRET, bina NEXT_PUBLIC_). Missing/kamzor ho toh tracking band:
// ad pehle jaisa milta hai, jawab me `tracking` nahi aata. Config har request par env se padhi jaati hai (secret rotate karna redeploy se).
let warnedTrackingOff = false;
function trackingConfig(): TrackingConfig | null {
  const config = readTrackingConfig(process.env);
  if (!config && !warnedTrackingOff) {
    warnedTrackingOff = true;
    // Sirf static label (secret ki value ya uska koi hissa log nahi). "set hi nahi" aur "set hai par code ne reject kiya" alag label se dikhte hain.
    if (trackingSecretStatus(process.env) === "rejected") console.error("[ads/serve] tracking secret rejected");
    else console.error("[ads/serve] tracking token off");
  }
  return config;
}

const productionDeps: ServeDeps = {
  authorize: authorizePublisher,
  select: (request, unitCostUsd) =>
    selectAd(request, {
      loadCandidates: loadAdCandidates,
      now: () => new Date(),
      unitCostUsd,
      spendTracking: "reliable",
    }),
  record: recordServe,
  lookupReplay: findIdempotentServe,
  issueTracking: (input) => {
    const config = trackingConfig();
    if (!config) return null;
    const { creativeId, ...tokenInput } = input;
    const nowMs = Date.now();
    const grant = mintTrackingToken(config, { ...tokenInput, nowMs });
    if (!grant) return null;
    // Day 17 Part 1: wahi config/secret, wahi mintClickRef(). Fail (null/throw) => grant bina click_ref ke; serve aur token par asar nahi.
    try {
      const click = mintClickRef(config, { ...tokenInput, creativeId, nowMs });
      return click ? { ...grant, clickRef: click.ref } : grant;
    } catch {
      return grant;
    }
  },
};

export function serveAdForPublisher(keyHash: string, request: MatchRequest): Promise<ServeResult> {
  return serveAd(keyHash, request, productionDeps);
}

// Day 22 Part 3: Blisscco-FIRST fallback (abhi route/match-handler se juda NAHI hai; publisher ka response contract wahi hai).
// serveAdForPublisher PEHLE chalta hai; sirf uska "no_fill" aane par, aur sirf server flag ON hone par, provider ko ek bounded koshish.
// Provider ka fill alag internal type me aata hai (source: "provider"): koi serve record, budget charge, tracking token ya impression nahi.
// Flag/URL har request par env se padhe jaate hain; flag default band hai, koi bhi galti => purana no-fill.
export function serveAdWithFallbackForPublisher(keyHash: string, request: MatchRequest): Promise<RoutedServeResult> {
  const provider = providerFallbackFromEnv(process.env);
  return routeServeWithFallback(keyHash, request, { serve: serveAdForPublisher, ...provider });
}

// Day 22 Part 6: match endpoint ka entry point. Blisscco-FIRST: serveAdWithFallbackForPublisher pehle Blisscco ka apna serve chalata hai.
// Flag band (default) => jawab bilkul purana (serveAdForPublisher jaisa). Sirf Blisscco no_fill + flag ON + provider ka safe fill => `provider_ad`.
// provider_ad me public response pehle se bana hota hai (tracking nahi, koi serve record/charge/impression nahi). Kabhi throw nahi karta.
export type MatchServeOutcome = ServeResult | Readonly<{ kind: "provider_ad"; response: MatchSuccessResponse }>;

export async function serveMatchForPublisher(keyHash: string, request: MatchRequest): Promise<MatchServeOutcome> {
  const routed = await serveAdWithFallbackForPublisher(keyHash, request);
  if (routed.source === "blisscco") return routed.result;
  const response = publicAdFromFallbackFill(routed.fill);
  return response ? { kind: "provider_ad", response } : { kind: "no_fill" };
}

// Day 12 Part 4: impression. Wahi trackingConfig() (secret ek hi jagah se padhta hai: yahi file). Token + serve ka milan + atomic write
// (day-12-7 SQL: record_ad_impression). Serve ki charge/spend ka isse koi lena-dena nahi: impression par doosri baar charge nahi hota.
export function acceptImpressionForToken(token: unknown, event: unknown): Promise<ImpressionResult> {
  return acceptImpression(token, event, {
    config: trackingConfig(),
    nowMs: () => Date.now(),
    lookupServe: lookupServeForEvent,
    record: recordImpressionEvent,
  });
}

// Day 12 Prompt 5 Part 3: click redirect. Wahi trackingConfig() (secret ek hi jagah se padhta hai: yahi file). Ref + serve + creative + destination
// (day-12-10 SQL: lookup_serve_for_click, record_ad_click). Charge/spend ka isse koi lena-dena nahi.
export function acceptClickForRef(ref: unknown): Promise<ClickResult> {
  return acceptClick(ref, {
    config: trackingConfig(),
    nowMs: () => Date.now(),
    lookupServe: lookupServeForClick,
    record: recordClickEvent,
  });
}
