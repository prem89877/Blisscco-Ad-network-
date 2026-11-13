import "server-only";
import { loadAdCandidates } from "./candidate-loader";
import { acceptClick, type ClickResult } from "./click";
import { mintClickRef } from "./click-ref";
import { lookupServeForClick, recordClickEvent } from "./click-db";
import { routeServeWithFallback, type RoutedServeResult } from "./fallback-routing";
import { lookupRichAssets } from "./rich-assets-db";
import { isRichAdDeliveryEnabled, richFieldsFromRecord, type RichAdFields } from "./rich-assets";
import { providerFallbackFromEnv, publicAdFromFallbackFill } from "./fallback-provider";
import type { MatchSuccessResponse } from "./contract";
import { acceptImpression, type ImpressionResult } from "./impression";
import { lookupServeForEvent, recordImpressionEvent } from "./impression-db";
import { isEmergencyStopEnforced, type StopState } from "./emergency-stop";
import { readAdServingState } from "./emergency-stop-db";
import { resolvePublisherRegionFromDb } from "./publisher-country-db";
import { loadCampaignTargetRegions } from "./campaign-regions-db";
import { isRegionalEligibilityEnforced } from "./regional-eligibility";
import { isPilotMetricsEnabled, type MetricSink } from "./pilot-monitoring";
import { recordRequestMetric } from "./pilot-metrics-db";
import { selectAd } from "./selection";
import { serveAd, type ServeDeps, type ServeResult } from "./serve";
import { authorizePublisher, findIdempotentServe, recordServe } from "./serve-db";
import { mintTrackingToken, readTrackingConfig, trackingSecretStatus, type TrackingConfig } from "./tracking-token";
import type { MatchRequest } from "./types";
// NOTE (owner): Deployment se pehle impressions aur clicks ki ginti (tracking) aur baaki related cheezein (etc.) ka kaam/review kiya jayega.
// Billing (Phase 6 Step 4 Part 2): serve par sirf budget HOLD; charge CPM = serve ka PEHLA valid impression, CPC = PEHLA valid click par (DB settle_event_billing). Serve ginti ko billing/payout ke liye use mat karna.

// Production wiring: asli database + asli clock. Route sirf yahi function chalata hai.
//
// spendTracking = "reliable" (Day 7): record_ad_serve budget RESERVE karta hai (spent + live holds <= budget) aur paar hone par serve rok deta hai.
// Serve par paisa NAHI katta (campaign_spend_daily nahi badalti): charge CPM = pehle valid impression, CPC = pehle valid click par (Phase 6 Step 4 Part 2).
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

// Phase 4 Step 3B: Rich Ad Delivery. Flag RICH_AD_DELIVERY_ENABLED exact "1" (default BAND: database ko bulaya bhi nahi jaata).
// Sirf read-only lookup (get_creative_rich_assets); fail ho toh ad text-only jaata hai.
async function loadRichFields(creativeId: string): Promise<RichAdFields | null> {
  if (!isRichAdDeliveryEnabled(process.env)) return null;
  const found = await lookupRichAssets(creativeId);
  return found.outcome === "ok" ? richFieldsFromRecord(found.record) : null;
}

const productionDeps: ServeDeps = {
  loadRich: loadRichFields,
  authorize: authorizePublisher,
  select: (request, unitCostUsd) =>
    selectAd(request, {
      loadCandidates: loadAdCandidates,
      now: () => new Date(),
      unitCostUsd,
      spendTracking: "reliable",
      loadCampaignRegions: loadCampaignTargetRegions,
    }),
  record: recordServe,
  lookupReplay: findIdempotentServe,
  // Phase 6 Step 2 Part 1 + 2: env REGIONAL_ELIGIBILITY_ENFORCED har request par padhta hai; exact "1" na ho toh gate hi nahi (purana behaviour,
  // database ko bulaya bhi nahi jaata). ON ho toh EK read-only rpc se verified country -> region: missing / invalid / pending / rejected => no-fill,
  // warna selection sirf us region ke liye eligible campaigns me se chunta hai. (Part 1 ka checkRegionalEligibility isi ke andar samaya hua hai: wahi gate.)
  resolvePublisherRegion: (publisherId) =>
    isRegionalEligibilityEnforced(process.env) ? resolvePublisherRegionFromDb(publisherId) : Promise.resolve({ outcome: "not_enforced" as const }),
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

// Day 22 Part 6: match endpoint ka neutral entry point (match-handler sirf isi ko bulata hai). Blisscco ka jawab jas ka tas;
// provider fill => { kind: "provider_ad", response } (tracking nahi, serve/charge nahi), ya safe no_fill.
export type MatchServeOutcome = ServeResult | { kind: "provider_ad"; response: MatchSuccessResponse };

export async function serveMatchForPublisher(keyHash: string, request: MatchRequest): Promise<MatchServeOutcome> {
  const routed = await serveAdWithFallbackForPublisher(keyHash, request);
  if (routed.source === "blisscco") return routed.result;
  const response = publicAdFromFallbackFill(routed.fill);
  return response ? { kind: "provider_ad", response } : { kind: "no_fill" };
}

// Day 12 Part 4: impression. Wahi trackingConfig() (secret ek hi jagah se padhta hai: yahi file). Token + serve ka milan + atomic write
// (day-12-7 SQL: record_ad_impression). CPM campaign ka charge yahin (serve ke PEHLE valid impression par, DB record_ad_impression) hota hai; duplicate impression par dobara kabhi nahi. CPC campaign me impression par charge nahi.
export function acceptImpressionForToken(token: unknown, event: unknown): Promise<ImpressionResult> {
  return acceptImpression(token, event, {
    config: trackingConfig(),
    nowMs: () => Date.now(),
    lookupServe: lookupServeForEvent,
    record: recordImpressionEvent,
  });
}

// Day 12 Prompt 5 Part 3: click redirect. Wahi trackingConfig() (secret ek hi jagah se padhta hai: yahi file). Ref + serve + creative + destination
// (day-12-10 SQL: lookup_serve_for_click, record_ad_click). CPC campaign ka charge yahin (serve ke PEHLE valid click par, DB record_ad_click) hota hai; duplicate/not_counted click par nahi. CPM campaign me click par charge nahi.
export function acceptClickForRef(ref: unknown): Promise<ClickResult> {
  return acceptClick(ref, {
    config: trackingConfig(),
    nowMs: () => Date.now(),
    lookupServe: lookupServeForClick,
    record: recordClickEvent,
  });
}

// Phase 3 Step 4: pilot monitoring ka production sink (match-handler isi ko bulata hai). Flag har request par env se padhta hai;
// default BAND (PILOT_METRICS_ENABLED ka exact value "1" chahiye). Band ho toh kuch nahi hota, database ko bulaya bhi nahi jaata.
// Sirf outcome + latency jaata hai; serve / billing / ledger ka koi lena-dena nahi. Fail ho toh reportMatchMetric nigal leta hai.
export const pilotMetricSink: MetricSink = (outcome, latencyMs) => {
  if (!isPilotMetricsEnabled(process.env)) return;
  return recordRequestMetric(outcome, latencyMs);
};

// Phase 5 Step 4: emergency stop ka production reader (match-handler isi ko bulata hai). Env EMERGENCY_STOP_ENFORCED har request par padhta hai;
// exact "1" na ho toh null (switch padha hi nahi jaata, database ko bulaya bhi nahi jaata). Sirf padhta hai; serve / billing se koi lena-dena nahi.
export function defaultStopCheck(): (() => Promise<StopState>) | null {
  return isEmergencyStopEnforced(process.env) ? readAdServingState : null;
}
