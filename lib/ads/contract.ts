import type { MatchedAd } from "./types";
import { CLICK_REF_PREFIX } from "./click-ref";
import { MAX_TOKEN_LENGTH, type TrackingEvent, type TrackingGrant } from "./tracking-token";
import type { ParseFailure } from "./validation";
import { safeDestination } from "./click";
import { BODY_MAX, CTA_MAX, HEADLINE_MAX } from "@/lib/campaigns/creative-validation";

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

/** JSON body. Sirf yahi teen fields allowed hain; baaki sab 400 `unknown_field`. */
export type MatchRequestBody = {
  /** Lowercase slug: ^[a-z0-9_]{1,50}$ (jaise "gaming"). Free text/prompt nahi. */
  topic: string;
  /**
   * Optional. Max 2 aur topic slugs (wahi format jo `topic` ka hai), priority order me. Sirf tab try hote hain jab `topic` par
   * ad na mile. Galat entry => 400 `invalid_topic`. Free text/prompt nahi.
   */
  fallback_topics?: string[];
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

/**
 * Sirf tab (opt-in header `X-Blisscco-Tracking: 1` + kamyab serve + server par tracking secret set). Serve ka reference token ke ANDAR hai
 * (opaque, signed). Token milna impression/click ka saboot nahi hai.
 */
export type PublicTracking = {
  /** Opaque, signed, time-limited token. Publisher ki API key nahi hai; iske saath key kabhi mat bhejo. */
  token: string;
  /** ISO 8601 UTC. Ye samay SERVE ke samay se bandha hai (retry se badhta nahi). */
  expires_at: string;
  /** Is token se kaun se events report ho sakte hain. */
  events: TrackingEvent[];
  /** Optional: signed click reference (bc1...). Sirf tab jab sahi se ban sake. Isme publisher/creative/serve id ya secret nahi hai. Destination yahan nahi. */
  click_ref?: string;
};

/** `tracking` ke exact keys (tests inhi se check karte hain). */
export const PUBLIC_TRACKING_FIELDS = ["token", "expires_at", "events"] as const;
/** Optional extra key (sirf valid click ref ban jaane par). */
export const PUBLIC_TRACKING_OPTIONAL_FIELDS = ["click_ref"] as const;

/** 200: ad mila. `sponsored` literal `true` hai: type level par bhi false ya missing ho nahi sakta. */
export type MatchSuccessResponse = {
  fill: true;
  sponsored: true;
  ad: PublicAd;
  /** Optional, backward-compatible addition. Opt-in na ho toh key hoti hi nahi. */
  tracking?: PublicTracking;
};

/** 200: koi eligible ad nahi (topic unsupported/sensitive, ya candidate nahi). Wajah kabhi nahi batate. */
export type MatchNoFillResponse = {
  fill: false;
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** 400 `reason` values. `unreadable_body` aur `invalid_idempotency_key` handler se aate hain, baaki validation.ts se. */
export type InvalidRequestReason = ParseFailure | "unreadable_body" | "invalid_idempotency_key" | "invalid_tracking_header";

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
export function buildAdResponse(ad: MatchedAd, tracking?: TrackingGrant): MatchSuccessResponse {
  const base: MatchSuccessResponse = { fill: true, sponsored: true, ad: toPublicAd(ad) };
  if (!tracking) return base;
  // Explicit whitelist: grant ke extra fields (agar kabhi aaye) bahar nahi jaate.
  // click_ref sirf tab: non-empty string jo `bc1.<payload>.<sig>` shape ka ho (warna chup-chaap hata diya jaata hai).
  const clickRef = isWellFormedClickRef(tracking.clickRef) ? tracking.clickRef : undefined;
  return {
    ...base,
    tracking: {
      token: tracking.token,
      expires_at: new Date(tracking.expiresAtMs).toISOString(),
      events: [...tracking.events],
      ...(clickRef ? { click_ref: clickRef } : {}),
    },
  };
}

const CLICK_REF_SHAPE_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** Sirf shape check (signature server ne mint ke waqt hi banayi hai). Galat/khali/bahut lamba => click_ref nahi. */
function isWellFormedClickRef(ref: unknown): ref is string {
  return (
    typeof ref === "string" &&
    ref.length > 0 &&
    ref.length <= MAX_TOKEN_LENGTH &&
    ref.startsWith(`${CLICK_REF_PREFIX}.`) &&
    CLICK_REF_SHAPE_RE.test(ref)
  );
}

// ---------------------------------------------------------------------------
// Day 22 Part 4: external provider ke creative => wahi PUBLIC ad fields (koi naya public field nahi).
// Provider-neutral. Raw HTML/script, provider ka internal data, kachcha URL kabhi bahar nahi. Tracking/click_ref kabhi nahi:
// provider ka ad Blisscco ka serve/charge/click-redirect nahi hai, isliye response me `tracking` key banti hi nahi.
// `provider` sirf INTERNAL attribution hai (response body me nahi jaata).
// ---------------------------------------------------------------------------

export type ProviderCreativeInput = {
  headline: string;
  body: string;
  ctaText: string | null;
  destinationUrl: string;
};

export type ProviderAdRejection = "invalid_provider" | "invalid_text" | "unsafe_destination";

export type ProviderAdOutcome =
  | { ok: true; provider: string; response: MatchSuccessResponse }
  | { ok: false; reason: ProviderAdRejection };

const PROVIDER_NAME_RE = /^[a-z][a-z0-9_]{0,29}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const ENTITY_RE = /&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i;

/** Plain text hi: koi < > ya & entity (encoded markup), koi control char; trim ke baad 1..max. Warna null. */
function plainText(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (text.length === 0 || text.length > max) return null;
  if (/[<>]/.test(text) || CONTROL_RE.test(text) || ENTITY_RE.test(text)) return null;
  return text;
}

/** Deterministic, non-secret public id (provider ad ka apna id/internal data nahi). Blisscco ad UUID nahi hai. */
function providerAdId(provider: string, headline: string, destination: string): string {
  let h = 0x811c9dc5;
  for (const ch of `${headline}\n${destination}`) {
    h = Math.imul(h ^ ch.codePointAt(0)!, 0x01000193) >>> 0;
  }
  return `${provider}_${h.toString(16).padStart(8, "0")}`;
}

/** Kabhi throw nahi karta. Destination project ke safe-destination rule (click.ts safeDestination) se; fail => reject, executable kuch nahi. */
export function buildProviderAdResponse(provider: string, creative: ProviderCreativeInput): ProviderAdOutcome {
  try {
    if (typeof provider !== "string" || !PROVIDER_NAME_RE.test(provider)) return { ok: false, reason: "invalid_provider" };
    if (creative === null || typeof creative !== "object") return { ok: false, reason: "invalid_text" };
    const headline = plainText(creative.headline, HEADLINE_MAX);
    const body = plainText(creative.body, BODY_MAX);
    if (headline === null || body === null) return { ok: false, reason: "invalid_text" };
    let cta: string | null = null;
    if (creative.ctaText !== null && creative.ctaText !== undefined && creative.ctaText.trim() !== "") {
      cta = plainText(creative.ctaText, CTA_MAX);
      if (cta === null) return { ok: false, reason: "invalid_text" };
    }
    const destination = safeDestination(creative.destinationUrl);
    if (destination === null) return { ok: false, reason: "unsafe_destination" };
    const ad: PublicAd = { id: providerAdId(provider, headline, destination), headline, body, cta_text: cta, destination_url: destination };
    return { ok: true, provider, response: { fill: true, sponsored: true, ad } };
  } catch {
    return { ok: false, reason: "invalid_text" };
  }
}
