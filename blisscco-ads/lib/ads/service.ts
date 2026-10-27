import "server-only";
import { loadAdCandidates } from "./candidate-loader";
import { selectAd } from "./selection";
import { serveAd, type ServeDeps, type ServeResult } from "./serve";
import { authorizePublisher, findIdempotentServe, recordServe } from "./serve-db";
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
};

export function serveAdForPublisher(keyHash: string, request: MatchRequest): Promise<ServeResult> {
  return serveAd(keyHash, request, productionDeps);
}
