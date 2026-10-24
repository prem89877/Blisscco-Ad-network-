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
};

/** Database function match_contextual_ad ka nateeja. */
export type MatchOutcome =
  | { outcome: "ok"; ad: MatchedAd }
  | { outcome: "no_fill" }
  | { outcome: "unauthorized" }
  | { outcome: "rate_limited" }
  | { outcome: "error" };
