import { resolveCategory } from "./category-matching";
import type { CategorySlug } from "./taxonomy";
import type { SelectionOutcome, SelectionRequest } from "./selection";
import type { MatchedAd, MatchRequest } from "./types";
// NOTE (owner): Deployment se pehle impressions aur clicks ki ginti (tracking) aur baaki related cheezein (etc.) ka kaam/review kiya jayega.
// Tab tak "serve" hi charge ka aadhar hai (billing/payout ke liye use mat karna).

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

/** Ek request me record_ad_serve ke kul kitne try (pehla chuna hua + selection ke nextAds). Latency ki seema. */
const MAX_RECORD_ATTEMPTS = 3;

export type AuthorizeResult =
  | { outcome: "ok"; publisher: { id: string; status: string }; unitCostUsd: number }
  | { outcome: "unauthorized" }
  | { outcome: "rate_limited" }
  | { outcome: "error" };

export type RecordResult =
  | { outcome: "recorded"; replayedAd?: MatchedAd }
  | { outcome: "rejected" }
  | { outcome: "error" };

export type ReplayResult =
  | { outcome: "found"; ad: MatchedAd }
  | { outcome: "none" }
  | { outcome: "rejected" }
  | { outcome: "unauthorized" }
  | { outcome: "error" };

export type ServeDeps = {
  authorize: (keyHash: string) => Promise<AuthorizeResult>;
  /** unitCostUsd authorize se aata hai, isliye selection ka wiring caller ke haath me hai. */
  select: (request: SelectionRequest, unitCostUsd: number) => Promise<SelectionOutcome>;
  /** idempotencyKey sirf tab aata hai jab publisher ne `Idempotency-Key` bheji ho. */
  record: (keyHash: string, creativeId: string, category: CategorySlug, idempotencyKey?: string) => Promise<RecordResult>;
  /** Optional: selection se PEHLE "ye key pehle charge ho chuki hai?" (retry me wahi ad, dobara charge nahi). */
  lookupReplay?: (keyHash: string, idempotencyKey: string) => Promise<ReplayResult>;
};

export type ServeResult =
  | { kind: "ad"; ad: MatchedAd }
  | { kind: "no_fill" }
  | { kind: "unauthorized" }
  | { kind: "rate_limited" }
  | { kind: "unavailable" };

/** Sirf 5 public fields (extra property kabhi bahar nahi jaati). */
function publicFields(ad: MatchedAd): MatchedAd {
  const { id, headline, body, ctaText, destinationUrl } = ad;
  return { id, headline, body, ctaText, destinationUrl };
}

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

    // 1b. Retry check: publisher ne `Idempotency-Key` bheji ho aur wo pehle charge ho chuki ho => wahi ad, DOBARA charge nahi.
    //     Ye selection se pehle hota hai, taaki pehli request se budget khatam ho gaya ho tab bhi retry ko wahi ad mile.
    //     Lookup fail ho toh 503 (andaza nahi laga sakte ki charge hua ya nahi; dobara charge karne se behtar hai ruk jana).
    if (request.idempotencyKey !== undefined && deps.lookupReplay) {
      const replay = await deps.lookupReplay(keyHash, request.idempotencyKey);
      switch (replay.outcome) {
        case "found":
          return { kind: "ad", ad: publicFields(replay.ad) };
        case "rejected":
          return { kind: "no_fill" };
        case "unauthorized":
          return { kind: "unauthorized" };
        case "none":
          break;
        default:
          return { kind: "unavailable" };
      }
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
    if (!outcome.fill) {
      // Database padhne me dikkat = outage (503), "koi ad nahi" (200 no-fill) nahi: dono me farak dikhna chahiye.
      if (outcome.reason === "candidate_load_failed") return { kind: "unavailable" };
      return { kind: "no_fill" };
    }

    // 4. Record: database creative ko dobara verify karta hai. Record na ho toh ad nahi dete.
    //    Retry-key hone par wahi key do requests ek saath aayein toh database ek hi baar charge karta hai; doosri ko
    //    pehle charge hue creative ka ad milta hai (replayedAd), selection ne kuch bhi chuna ho.
    //    Agar DB chune hue creative ko reject kare (budget khatam / race / paused), toh selection ke agle eligible
    //    creatives (max 2) try hote hain: kul MAX_RECORD_ATTEMPTS record calls. Reject par kuch likha nahi jaata
    //    (na spend, na idempotency key), isliye agla try safe hai. Error par ruk jaate hain (503), koi guess nahi.
    const attempts = [outcome.ad, ...(outcome.nextAds ?? [])].slice(0, MAX_RECORD_ATTEMPTS);
    for (const attempt of attempts) {
      const recorded =
        request.idempotencyKey === undefined
          ? await deps.record(keyHash, attempt.id, resolved.category)
          : await deps.record(keyHash, attempt.id, resolved.category, request.idempotencyKey);
      if (recorded.outcome === "recorded") {
        // 5. Sirf 5 public fields
        return { kind: "ad", ad: publicFields(recorded.replayedAd ?? attempt) };
      }
      if (recorded.outcome !== "rejected") return { kind: "unavailable" };
    }
    return { kind: "no_fill" };
  } catch {
    return { kind: "unavailable" };
  }
}
