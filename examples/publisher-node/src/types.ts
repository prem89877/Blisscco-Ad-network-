// Blisscco v1 ads/match: minimal public types for a SERVER-SIDE publisher client.
// Standalone on purpose (no imports from the Blisscco app). Mirrors lib/ads/contract.ts.

export type TrackingEvent = "impression" | "click";

/** POST /api/v1/ads/match body. Only these 3 fields are accepted by the API. */
export type MatchRequest = {
  /** Lowercase slug ^[a-z0-9_]{1,50}$ (e.g. "gaming"). Never free text / prompts. */
  topic: string;
  /** Max 2 extra topic slugs, tried in order only if `topic` has no fill. */
  fallback_topics?: string[];
  /** Max 20 previously shown ad ids (UUID). */
  exclude_ad_ids?: string[];
};

export type PublicAd = {
  id: string;
  headline: string;
  body: string;
  cta_text: string | null;
  destination_url: string;
};

export type PublicTracking = {
  token: string;
  expires_at: string;
  events: TrackingEvent[];
  click_ref?: string;
};

/** 200: ad found. */
export type MatchSuccessResponse = {
  fill: true;
  sponsored: true;
  ad: PublicAd;
  /** Only present when tracking was opted in. */
  tracking?: PublicTracking;
};

/** 200: no eligible ad. */
export type MatchNoFillResponse = {
  fill: false;
};

/** Error codes the API can return in `error`. */
export type ApiErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "payload_too_large"
  | "unsupported_media_type"
  | "rate_limited"
  | "unavailable"
  /** Click endpoint only (GET /api/v1/ads/click): every bad/expired/unknown ref looks the same. */
  | "not_found";

/** Non-2xx JSON body. `reason` only exists for `invalid_request`; `fill:false` only for 503. */
export type ApiErrorResponse = {
  error: ApiErrorCode;
  reason?: string;
  fill?: false;
};

export type MatchOptions = {
  /** 8-64 chars [A-Za-z0-9_-]. Reuse the SAME key when retrying the SAME request. Auto-generated if omitted. */
  idempotencyKey?: string;
  /** Opt in to tracking token (sends `X-Blisscco-Tracking: 1`). */
  tracking?: boolean;
};

/** What `client.match()` returns on HTTP 200. Errors are thrown (see client.ts). */
export type MatchResult =
  | ({ idempotencyKey: string } & MatchSuccessResponse)
  | ({ idempotencyKey: string } & MatchNoFillResponse);

export type RetryConfig = {
  /** Extra attempts after the first (0-5). Default 2. 0 disables retries. */
  maxRetries?: number;
  /**
   * First backoff delay in ms (doubles each retry, jittered to 50-100%). Default 2000, so the first wait is 1000-2000 ms
   * and never below the publisher guide's "1 second or more". A smaller value is allowed but is your own choice.
   */
  baseDelayMs?: number;
  /** Cap for any wait (backoff and Retry-After) in ms. Default 5000 (max 60000). A longer Retry-After stops retrying. */
  maxDelayMs?: number;
};

export type BlissccoClientConfig = {
  /** e.g. "https://api.example.com". https required (http only for localhost). No credentials/query/hash. `fromEnv()` reads BLISSCCO_API_BASE_URL (fallback: BLISSCCO_BASE_URL). */
  baseUrl: string;
  /** Publisher API key `blc_live_<64 hex>`. Server-side only. `fromEnv()` reads BLISSCCO_PUBLISHER_API_KEY (fallback: BLISSCCO_API_KEY). */
  apiKey: string;
  /** Per-request timeout. Default 5000, allowed 100-30000. */
  timeoutMs?: number;
  /** Bounded retry for network errors, HTTP 429 and 503 only. */
  retry?: RetryConfig;
  /** Injectable for tests. Default: setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests (jitter). Default: Math.random. */
  random?: () => number;
  /** Injectable for tests. Default: global fetch. */
  fetch?: typeof fetch;
};

// ---------------------------------------------------------------------------
// Tracking (Day 21): impression + click. Mirrors lib/ads/impression.ts, lib/ads/click.ts,
// lib/ads/tracking-token.ts (bt1 token), lib/ads/click-ref.ts (bc1 ref) and the v1 tracking routes.
// ---------------------------------------------------------------------------

/** Input of `client.reportImpression()`. `token` = `tracking.token` from a match response (`bt1.<payload>.<sig>`). */
export type ImpressionRequest = {
  token: string;
};

/** Exact wire body of POST /api/v1/ads/impression. Only these 2 fields are accepted; `event` is added by the client. */
export type ImpressionRequestBody = {
  token: string;
  event: "impression";
};

/** 200 from POST /api/v1/ads/impression. `duplicate` = this serve already had its impression (safe, nothing new counted). */
export type ImpressionResult = {
  ok: true;
  status: "recorded" | "duplicate";
};

/** Input of `client.reportClick()`. `click_ref` = `tracking.click_ref` from a match response (`bc1.<payload>.<sig>`). */
export type ClickRequest = {
  click_ref: string;
};

/**
 * The click endpoint answers with a 302 redirect (it never says recorded/duplicate), so success is just `accepted`.
 * The redirect target is deliberately NOT returned and NOT followed.
 */
export type ClickResult = {
  ok: true;
  status: "accepted";
};
