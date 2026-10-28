// Matching engine ke types. Publisher ko jo dikhta hai wahi yahan hai: advertiser, campaign, budget kuch nahi.

export type MatchedAd = {
  id: string;
  headline: string;
  body: string;
  ctaText: string | null;
  destinationUrl: string;
};

/** Publisher ki request: sirf topic slug + (optional) pichhle dikhaye ad ids. Koi prompt/free text nahi. */
export type MatchRequest = {
  topic: string;
  excludeAdIds: string[];
  /**
   * Optional (Day 11 Part 3): publisher ke khud diye 1-2 aur topic slugs, priority order me. `topic` par koi ad na mile
   * (unsupported / eligible nahi / DB ne reject kiya) tabhi agla try hota hai. Insaan ya page ke baare me kuch infer nahi hota.
   * Sensitive `topic` par fallback kabhi nahi chalta (seedha no-fill).
   */
  fallbackTopics?: string[];
  /**
   * Optional retry-key (HTTP header `Idempotency-Key`, body me nahi). Wahi key dobara aaye toh dobara charge nahi hota,
   * wahi ad milta hai. Header na ho toh pehle jaisa behaviour.
   */
  idempotencyKey?: string;
};

/** Database function match_contextual_ad ka nateeja. */
export type MatchOutcome =
  | { outcome: "ok"; ad: MatchedAd }
  | { outcome: "no_fill" }
  | { outcome: "unauthorized" }
  | { outcome: "rate_limited" }
  | { outcome: "error" };
