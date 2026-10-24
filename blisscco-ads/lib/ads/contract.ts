import type { MatchedAd } from "./types";
import type { ParseFailure } from "./validation";

// POST /api/v1/ads/match (aur purana /api/ads/match) ka PUBLIC request/response contract.
// Sirf TYPES + ek chhota mapper. Koi database/env/network nahi (pura pure module).
//
// Ye file "single source of truth" hai: match-handler.ts har jawab inhi types ke saath banata hai,
// isliye contract se bahar ka field compile hi nahi hota. Document: DAY6-ADS-MATCH-CONTRACT.md.
// Privacy: publisher ko sirf wahi milta hai jo sponsored ad dikhane ke liye chahiye.
// Advertiser (naam/email), campaign, budget, spend, publisher id, API key, hash, database error kabhi nahi.

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

/** JSON body. Sirf yahi do fields allowed hain; baaki sab 400 `unknown_field`. */
export type MatchRequestBody = {
  /** Lowercase slug: ^[a-z0-9_]{1,50}$ (jaise "gaming"). Free text/prompt nahi. */
  topic: string;
  /** Optional. Pichhle dikhaye ad ids (UUID), max 20. */
  exclude_ad_ids?: string[];
};

// ---------------------------------------------------------------------------
// Success + no-fill
// ---------------------------------------------------------------------------

/** Ad ke woh 5 public fields jo sponsored ad dikhane ke liye kaafi hain. */
export type PublicAd = {
  id: string;
  headline: string;
  body: string;
  cta_text: string | null;
  destination_url: string;
};

/** PublicAd ke exact keys (tests inhi se check karte hain ki koi extra key na ho). */
export const PUBLIC_AD_FIELDS = ["id", "headline", "body", "cta_text", "destination_url"] as const;

/** 200: ad mila. `sponsored` literal `true` hai: type level par bhi false ya missing ho nahi sakta. */
export type MatchSuccessResponse = {
  fill: true;
  sponsored: true;
  ad: PublicAd;
};

/** 200: koi eligible ad nahi (topic unsupported/sensitive, ya candidate nahi). Wajah kabhi nahi batate. */
export type MatchNoFillResponse = {
  fill: false;
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** 400 `reason` values. `unreadable_body` handler se aata hai, baaki validation.ts se. */
export type InvalidRequestReason = ParseFailure | "unreadable_body";

export type InvalidRequestResponse = { error: "invalid_request"; reason: InvalidRequestReason };
export type UnauthorizedResponse = { error: "unauthorized" };
export type PayloadTooLargeResponse = { error: "payload_too_large" };
export type UnsupportedMediaTypeResponse = { error: "unsupported_media_type" };
export type RateLimitedResponse = { error: "rate_limited" };
/** 503: temporary service failure. Publisher ise "abhi ad nahi" maane (fill:false). Andar ki koi detail nahi. */
export type ServiceUnavailableResponse = { fill: false; error: "unavailable" };

export type MatchErrorResponse =
  | InvalidRequestResponse
  | UnauthorizedResponse
  | PayloadTooLargeResponse
  | UnsupportedMediaTypeResponse
  | RateLimitedResponse
  | ServiceUnavailableResponse;

export type MatchResponseBody = MatchSuccessResponse | MatchNoFillResponse | MatchErrorResponse;

// ---------------------------------------------------------------------------
// Mapper (internal MatchedAd -> public wire format)
// ---------------------------------------------------------------------------

/** Explicit whitelist: extra properties (agar kisi galti se aa bhi jayein) yahan se aage nahi jaate. */
export function toPublicAd(ad: MatchedAd): PublicAd {
  return {
    id: ad.id,
    headline: ad.headline,
    body: ad.body,
    cta_text: ad.ctaText,
    destination_url: ad.destinationUrl,
  };
}

/** Har ad response yahin se banta hai, isliye `sponsored: true` kabhi chhoot nahi sakta. */
export function buildAdResponse(ad: MatchedAd): MatchSuccessResponse {
  return { fill: true, sponsored: true, ad: toPublicAd(ad) };
}
