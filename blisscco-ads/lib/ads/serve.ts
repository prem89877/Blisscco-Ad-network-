import { resolveCategory } from "./category-matching";
import type { CategorySlug } from "./taxonomy";
import type { SelectionOutcome, SelectionRequest } from "./selection";
import type { MatchedAd, MatchRequest } from "./types";

// Serve orchestrator (PURA: koi database/env/server-only nahi; saari cheezein `deps` se aati hain, isliye bina database ke test hota hai).
//
// Flow (har kadam fail-closed):
//   1. authorize   : publisher key + publisher/profile active + rate limit           (database)
//   2. category    : signal ko canonical slug me badlo; invalid/sensitive/unsupported => no-fill
//   3. select      : candidates load + eligibility + EK creative                      (TypeScript selection layer)
//   4. record      : creative dobara verify + serve log + daily counter               (database)
//   5. respond     : record hone ke BAAD hi ad wapas; warna no-fill
//
// Publisher ko SIRF ServeResult milta hai: no-fill ki wajah, campaign, advertiser, budget kuch nahi.

export type AuthorizeResult =
  | { outcome: "ok"; publisher: { id: string; status: string }; unitCostUsd: number }
  | { outcome: "unauthorized" }
  | { outcome: "rate_limited" }
  | { outcome: "error" };

export type RecordResult = { outcome: "recorded" } | { outcome: "rejected" } | { outcome: "error" };

export type ServeDeps = {
  authorize: (keyHash: string) => Promise<AuthorizeResult>;
  /** unitCostUsd authorize se aata hai, isliye selection ka wiring caller ke haath me hai. */
  select: (request: SelectionRequest, unitCostUsd: number) => Promise<SelectionOutcome>;
  record: (keyHash: string, creativeId: string, category: CategorySlug) => Promise<RecordResult>;
};

export type ServeResult =
  | { kind: "ad"; ad: MatchedAd }
  | { kind: "no_fill" }
  | { kind: "unauthorized" }
  | { kind: "rate_limited" }
  | { kind: "unavailable" };

/** Kabhi throw nahi karta: kuch bhi anjaana => "unavailable" (route 503 + fill:false deta hai). */
export async function serveAd(keyHash: string, request: MatchRequest, deps: ServeDeps): Promise<ServeResult> {
  try {
    // 1. Authorization (publisher id caller se kabhi nahi liya jaata: key hash se database batata hai)
    const auth = await deps.authorize(keyHash);
    switch (auth.outcome) {
      case "unauthorized":
        return { kind: "unauthorized" };
      case "rate_limited":
        return { kind: "rate_limited" };
      case "error":
        return { kind: "unavailable" };
      case "ok":
        break;
      default:
        return { kind: "unavailable" };
    }

    // 2. Category signal: sirf ek chhota supported category (alias/sensitive/unsupported ka faisla taxonomy karti hai)
    const resolved = resolveCategory(request.topic);
    if (!resolved.ok) return { kind: "no_fill" };

    // 3. Selection (publisher ka status authorize se aaya hai, caller ne nahi bheja)
    const outcome = await deps.select(
      {
        publisher: auth.publisher,
        category: resolved.category,
        excludeCreativeIds: request.excludeAdIds,
      },
      auth.unitCostUsd,
    );
    if (!outcome.fill) return { kind: "no_fill" };

    // 4. Record: database creative ko dobara verify karta hai. Record na ho toh ad nahi dete.
    const recorded = await deps.record(keyHash, outcome.ad.id, resolved.category);
    if (recorded.outcome === "rejected") return { kind: "no_fill" };
    if (recorded.outcome !== "recorded") return { kind: "unavailable" };

    // 5. Sirf 5 public fields
    const { id, headline, body, ctaText, destinationUrl } = outcome.ad;
    return { kind: "ad", ad: { id, headline, body, ctaText, destinationUrl } };
  } catch {
    return { kind: "unavailable" };
  }
}
