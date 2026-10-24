import "server-only";
import { loadAdCandidates } from "./candidate-loader";
import { selectAd } from "./selection";
import { serveAd, type ServeDeps, type ServeResult } from "./serve";
import { authorizePublisher, recordServe } from "./serve-db";
import type { MatchRequest } from "./types";

// Production wiring: asli database + asli clock. Route sirf yahi function chalata hai.
//
// spendTracking = "unavailable": campaign_spend_daily me abhi koi kharch nahi likhta (impression tracking baaki hai),
// isliye budget check NAHI lagta aur hum use "enforced" bol kar jhooth nahi bolte. Impression tracking
// aane par (DAY6-SERVE-AND-SPEND-PLAN.md) ise "reliable" karna aur record_ad_serve me budget check jodna.

const productionDeps: ServeDeps = {
  authorize: authorizePublisher,
  select: (request, unitCostUsd) =>
    selectAd(request, {
      loadCandidates: loadAdCandidates,
      now: () => new Date(),
      unitCostUsd,
      spendTracking: "unavailable",
    }),
  record: recordServe,
};

export function serveAdForPublisher(keyHash: string, request: MatchRequest): Promise<ServeResult> {
  return serveAd(keyHash, request, productionDeps);
}
