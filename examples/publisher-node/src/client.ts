import { randomUUID } from "node:crypto";
import type {
  ApiErrorCode,
  BlissccoClientConfig,
  ClickRequest,
  ClickResult,
  ImpressionRequest,
  ImpressionRequestBody,
  ImpressionResult,
  MatchOptions,
  MatchRequest,
  MatchResult,
  RetryConfig,
} from "./types";

// SERVER-SIDE ONLY. Never import this file in browser code: it holds your secret API key.
// Rules: the key goes only into the Authorization header. It is never put in returned data,
// error messages, or logs (this file does no logging), and is stored in a #private field so
// JSON.stringify / console.log / util.inspect of the client cannot show it.

const API_KEY_RE = /^blc_live_[0-9a-f]{64}$/;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
const TOPIC_RE = /^[a-z0-9_]{1,50}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ERROR_CODES: readonly string[] = [
  "invalid_request",
  "unauthorized",
  "payload_too_large",
  "unsupported_media_type",
  "rate_limited",
  "unavailable",
];
const MATCH_PATH = "/api/v1/ads/match";
const IMPRESSION_PATH = "/api/v1/ads/impression";
const CLICK_PATH = "/api/v1/ads/click";
// Tracking routes can also answer 404 `not_found` (click). Kept separate so match error mapping is unchanged.
const TRACKING_ERROR_CODES: readonly string[] = [...ERROR_CODES, "not_found"];
// Same limit as lib/ads/tracking-token.ts MAX_TOKEN_LENGTH. Shape only: the server verifies signature/expiry.
const MAX_TRACKING_VALUE_LENGTH = 512;
const TRACKING_TOKEN_RE = /^bt1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const CLICK_REF_RE = /^bc1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const RETRYABLE_STATUS: readonly number[] = [429, 503];
// Publisher guide rule: wait "1 second or more with jitter" before a retry. Jitter keeps 50-100% of the backoff,
// so a 2000 ms base gives a first wait of 1000-2000 ms (never below 1 s), then 2000-4000 ms; every wait is capped by maxDelayMs.
const DEFAULT_RETRY = { maxRetries: 2, baseDelayMs: 2000, maxDelayMs: 5000 } as const;
const MAX_RETRIES_LIMIT = 5;
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_RESPONSE_CHARS = 65_536;

/** Bad baseUrl / apiKey / timeout. Message never contains the supplied values. */
export class BlissccoConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlissccoConfigError";
  }
}

/** Bad request input (caught before any network call). */
export class BlissccoRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlissccoRequestError";
  }
}

/** Timeout / connection failure. No cause or URL attached. */
export class BlissccoNetworkError extends Error {
  constructor(message = "Blisscco request failed (network or timeout)") {
    super(message);
    this.name = "BlissccoNetworkError";
  }
}

/** Non-2xx response, or a 200 with an unexpected body (code "invalid_response"). */
export class BlissccoApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | "invalid_response" | "unknown_error";
  readonly reason?: string;
  /** Seconds, from Retry-After (429 only). */
  readonly retryAfterSeconds?: number;
  constructor(init: { status: number; code: BlissccoApiError["code"]; reason?: string; retryAfterSeconds?: number }) {
    super(`Blisscco API error: HTTP ${init.status} ${init.code}${init.reason ? ` (${init.reason})` : ""}`);
    this.name = "BlissccoApiError";
    this.status = init.status;
    this.code = init.code;
    if (init.reason !== undefined) this.reason = init.reason;
    if (init.retryAfterSeconds !== undefined) this.retryAfterSeconds = init.retryAfterSeconds;
  }
}

/**
 * Thrown only when retries were enabled and ALL attempts failed with a temporary problem
 * (network error, 429 or 503), or the server asked to wait longer than `maxDelayMs`.
 * `safeNoFill` is always true: show no ad / your normal fallback for this placement.
 */
export class BlissccoRetryExhaustedError extends Error {
  readonly attempts: number;
  readonly lastStatus?: number;
  readonly lastCode: "network_error" | ApiErrorCode | "unknown_error";
  /** Same key used for every attempt of this placement (not a secret). */
  readonly idempotencyKey: string;
  readonly safeNoFill = true as const;
  constructor(init: { attempts: number; lastStatus?: number; lastCode: BlissccoRetryExhaustedError["lastCode"]; idempotencyKey: string }) {
    super(`Blisscco request failed after ${init.attempts} attempt(s): ${init.lastCode}${init.lastStatus ? ` (HTTP ${init.lastStatus})` : ""}`);
    this.name = "BlissccoRetryExhaustedError";
    this.attempts = init.attempts;
    this.lastCode = init.lastCode;
    this.idempotencyKey = init.idempotencyKey;
    if (init.lastStatus !== undefined) this.lastStatus = init.lastStatus;
  }
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

// Documented names (publisher guide, examples/publisher-nextjs) + the older names kept as a fallback.
const ENV_BASE_URL = "BLISSCCO_API_BASE_URL";
const ENV_API_KEY = "BLISSCCO_PUBLISHER_API_KEY";
const ENV_BASE_URL_LEGACY = "BLISSCCO_BASE_URL";
const ENV_API_KEY_LEGACY = "BLISSCCO_API_KEY";

/** First value that is a non-empty string, else undefined. */
function firstSet(...values: (string | undefined)[]): string | undefined {
  return values.find((v) => typeof v === "string" && v !== "");
}

/** Returns a normalized base URL (no trailing slash) or throws BlissccoConfigError. */
function parseBaseUrl(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw new BlissccoConfigError("baseUrl is required");
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new BlissccoConfigError("baseUrl is not a valid URL");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalHost(url.hostname))) {
    throw new BlissccoConfigError("baseUrl must use https (http is allowed only for localhost)");
  }
  if (url.username || url.password) throw new BlissccoConfigError("baseUrl must not contain credentials");
  if (url.search || url.hash) throw new BlissccoConfigError("baseUrl must not contain a query or fragment");
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function parseApiKey(value: unknown): string {
  if (typeof value !== "string" || value === "") throw new BlissccoConfigError("apiKey is required");
  if (!API_KEY_RE.test(value)) throw new BlissccoConfigError("apiKey has an invalid format");
  return value;
}

function parseTimeout(value: unknown): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 100 || value > 30_000) {
    throw new BlissccoConfigError("timeoutMs must be an integer between 100 and 30000");
  }
  return value;
}

function parseRetry(value: RetryConfig | undefined): { maxRetries: number; baseDelayMs: number; maxDelayMs: number } {
  if (value === undefined) return { ...DEFAULT_RETRY };
  if (typeof value !== "object" || value === null) throw new BlissccoConfigError("retry must be an object");
  const maxRetries = value.maxRetries ?? DEFAULT_RETRY.maxRetries;
  const baseDelayMs = value.baseDelayMs ?? DEFAULT_RETRY.baseDelayMs;
  const maxDelayMs = value.maxDelayMs ?? DEFAULT_RETRY.maxDelayMs;
  const int = (n: unknown, lo: number, hi: number) => typeof n === "number" && Number.isInteger(n) && n >= lo && n <= hi;
  if (!int(maxRetries, 0, MAX_RETRIES_LIMIT)) throw new BlissccoConfigError(`retry.maxRetries must be an integer between 0 and ${MAX_RETRIES_LIMIT}`);
  if (!int(baseDelayMs, 0, 10_000)) throw new BlissccoConfigError("retry.baseDelayMs must be an integer between 0 and 10000");
  if (!int(maxDelayMs, 0, 60_000) || maxDelayMs < baseDelayMs) throw new BlissccoConfigError("retry.maxDelayMs must be an integer between baseDelayMs and 60000");
  return { maxRetries, baseDelayMs, maxDelayMs };
}

/** Valid Retry-After = whole seconds (0-86400) or an HTTP date in the future. Anything else => undefined (ignored). */
function parseRetryAfterMs(header: string | null): number | undefined {
  if (header === null) return undefined;
  const v = header.trim();
  if (/^\d{1,6}$/.test(v)) {
    const sec = Number(v);
    return sec <= 86_400 ? sec * 1000 : undefined;
  }
  const at = Date.parse(v);
  if (!Number.isFinite(at)) return undefined;
  const ms = at - Date.now();
  return ms >= 0 && ms <= 86_400_000 ? ms : undefined;
}

type TrackingResponse = { status: number; body: unknown; retryAfterMs: number | undefined; hasLocation: boolean };

type Retryable = { retry: true; status?: number; code: BlissccoRetryExhaustedError["lastCode"]; retryAfterMs?: number };

function validateRequest(req: MatchRequest): void {
  if (typeof req !== "object" || req === null || Array.isArray(req)) throw new BlissccoRequestError("request must be an object");
  const allowed = ["topic", "fallback_topics", "exclude_ad_ids"];
  for (const k of Object.keys(req)) if (!allowed.includes(k)) throw new BlissccoRequestError(`unknown request field: ${k.slice(0, 30)}`);
  if (typeof req.topic !== "string" || !TOPIC_RE.test(req.topic)) throw new BlissccoRequestError("topic must match ^[a-z0-9_]{1,50}$");
  if (req.fallback_topics !== undefined) {
    const f = req.fallback_topics;
    if (!Array.isArray(f) || f.length > 2 || !f.every((t) => typeof t === "string" && TOPIC_RE.test(t))) {
      throw new BlissccoRequestError("fallback_topics must be at most 2 valid topic slugs");
    }
  }
  if (req.exclude_ad_ids !== undefined) {
    const e = req.exclude_ad_ids;
    if (!Array.isArray(e) || e.length > 20 || !e.every((id) => typeof id === "string" && UUID_RE.test(id))) {
      throw new BlissccoRequestError("exclude_ad_ids must be at most 20 UUIDs");
    }
  }
}

/** Checked BEFORE any request. Error messages never contain the supplied values or field names. */
function validateTrackingInput(req: unknown, field: "token" | "click_ref", re: RegExp): string {
  if (typeof req !== "object" || req === null || Array.isArray(req)) throw new BlissccoRequestError("request must be an object");
  const obj = req as Record<string, unknown>;
  if (Object.keys(obj).some((k) => k !== field)) throw new BlissccoRequestError(`request must contain only ${field}`);
  const value = obj[field];
  if (typeof value !== "string" || value.length === 0) throw new BlissccoRequestError(`${field} is required`);
  if (value.length > MAX_TRACKING_VALUE_LENGTH || !re.test(value)) throw new BlissccoRequestError(`${field} has an invalid format`);
  return value;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function looksLikeAd(v: unknown): boolean {
  return (
    isObj(v) &&
    typeof v.id === "string" &&
    typeof v.headline === "string" &&
    typeof v.body === "string" &&
    (v.cta_text === null || typeof v.cta_text === "string") &&
    typeof v.destination_url === "string"
  );
}

export class BlissccoClient {
  readonly #apiKey: string;
  readonly #endpoint: string;
  readonly #impressionEndpoint: string;
  readonly #clickEndpoint: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #retry: { maxRetries: number; baseDelayMs: number; maxDelayMs: number };
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #random: () => number;

  constructor(config: BlissccoClientConfig) {
    if (typeof config !== "object" || config === null) throw new BlissccoConfigError("config is required");
    const base = parseBaseUrl(config.baseUrl);
    this.#endpoint = `${base}${MATCH_PATH}`;
    this.#impressionEndpoint = `${base}${IMPRESSION_PATH}`;
    this.#clickEndpoint = `${base}${CLICK_PATH}`;
    this.#apiKey = parseApiKey(config.apiKey);
    this.#timeoutMs = parseTimeout(config.timeoutMs);
    this.#retry = parseRetry(config.retry);
    this.#sleep = config.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.#random = config.random ?? Math.random;
    this.#fetch = config.fetch ?? globalThis.fetch;
    if (typeof this.#fetch !== "function") throw new BlissccoConfigError("fetch is not available");
  }

  /**
   * Reads the environment names used by the publisher guide and the Next.js example (server environment only):
   *   BLISSCCO_API_BASE_URL and BLISSCCO_PUBLISHER_API_KEY.
   * Compatibility fallback (older Day 20 names), used ONLY when the documented name is unset or empty:
   *   BLISSCCO_BASE_URL and BLISSCCO_API_KEY.
   * If both names are set, the documented one wins. Missing values throw BlissccoConfigError naming the
   * variables only (never a value). Other problems (bad URL / key format) keep the normal constructor errors.
   */
  static fromEnv(env: Record<string, string | undefined> = process.env): BlissccoClient {
    const baseUrl = firstSet(env[ENV_BASE_URL], env[ENV_BASE_URL_LEGACY]);
    const apiKey = firstSet(env[ENV_API_KEY], env[ENV_API_KEY_LEGACY]);
    const missing = [...(baseUrl === undefined ? [ENV_BASE_URL] : []), ...(apiKey === undefined ? [ENV_API_KEY] : [])];
    if (missing.length > 0) throw new BlissccoConfigError(`Missing environment variable(s): ${missing.join(", ")}`);
    return new BlissccoClient({ baseUrl: baseUrl as string, apiKey: apiKey as string });
  }

  /** Safe against JSON.stringify(client). */
  toJSON(): { name: string } {
    return { name: "BlissccoClient" };
  }

  /**
   * POST /api/v1/ads/match. Resolves on HTTP 200 (fill or no-fill).
   * Temporary failures (network error/timeout, 429, 503) are retried up to `retry.maxRetries` times
   * with the SAME Idempotency-Key and body, so a retry can never create a second serve/charge.
   * Throws: BlissccoApiError (permanent 4xx etc.), BlissccoRetryExhaustedError (retries used up; show no ad),
   * BlissccoNetworkError / BlissccoApiError for 429/503 only when `maxRetries` is 0.
   */
  async match(request: MatchRequest, options: MatchOptions = {}): Promise<MatchResult> {
    validateRequest(request);
    const idempotencyKey = options.idempotencyKey ?? randomUUID();
    if (typeof idempotencyKey !== "string" || !IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
      throw new BlissccoRequestError("idempotencyKey must match ^[A-Za-z0-9_-]{8,64}$");
    }

    // Built ONCE: every attempt of this placement sends identical headers (same Idempotency-Key) and body.
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Idempotency-Key": idempotencyKey,
    };
    if (options.tracking === true) headers["X-Blisscco-Tracking"] = "1";
    const body = JSON.stringify(request);

    const { maxRetries, baseDelayMs, maxDelayMs } = this.#retry;
    for (let attempt = 1; ; attempt++) {
      const out = await this.#sendOnce(headers, body, idempotencyKey);
      if (!("retry" in out)) return out;

      if (maxRetries === 0) {
        // Retries disabled: behave like a plain single call.
        if (out.code === "network_error") throw new BlissccoNetworkError();
        throw new BlissccoApiError({
          status: out.status ?? 0,
          code: out.code as BlissccoApiError["code"],
          ...(out.retryAfterMs !== undefined && out.status === 429 ? { retryAfterSeconds: Math.ceil(out.retryAfterMs / 1000) } : {}),
        });
      }
      const exhausted = () =>
        new BlissccoRetryExhaustedError({
          attempts: attempt,
          lastCode: out.code,
          idempotencyKey,
          ...(out.status !== undefined ? { lastStatus: out.status } : {}),
        });
      if (attempt > maxRetries) throw exhausted();
      if (out.retryAfterMs !== undefined && out.retryAfterMs > maxDelayMs) throw exhausted(); // server wants a longer wait than we allow

      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const wait = out.retryAfterMs ?? Math.round(backoff * (0.5 + 0.5 * this.#random())); // jittered, never above maxDelayMs
      await this.#sleep(wait);
    }
  }

  /**
   * POST /api/v1/ads/impression with `{ token, event: "impression" }`. SERVER-SIDE: call it only after the ad was really shown.
   * The endpoint needs NO API key, so this call sends none (only Content-Type/Accept). The token is the only credential.
   * Resolves `{ ok: true, status: "recorded" | "duplicate" }`. Single attempt (no retry): resending is safe because
   * the server counts only the first impression per serve, so the caller may retry on BlissccoNetworkError / 429 / 503.
   * Throws BlissccoRequestError (bad input, nothing sent), BlissccoNetworkError, BlissccoApiError.
   */
  async reportImpression(request: ImpressionRequest): Promise<ImpressionResult> {
    const token = validateTrackingInput(request, "token", TRACKING_TOKEN_RE);
    const body: ImpressionRequestBody = { token, event: "impression" };
    const res = await this.#sendTracking(this.#impressionEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
    });
    if (res.status === 200 && isObj(res.body) && res.body.ok === true && (res.body.status === "recorded" || res.body.status === "duplicate")) {
      return { ok: true, status: res.body.status };
    }
    throw this.#trackingError(res);
  }

  /**
   * GET /api/v1/ads/click?ref=<click_ref>. SERVER-SIDE: call it only for a real user click (never for prefetch/crawlers).
   * The endpoint needs NO API key, so none is sent. The 302 redirect is NOT followed and its target is NOT returned.
   * Resolves `{ ok: true, status: "accepted" }` on the 302 (the server does not reveal recorded vs duplicate).
   * Single attempt. Throws BlissccoRequestError (bad input, nothing sent), BlissccoNetworkError, BlissccoApiError.
   */
  async reportClick(request: ClickRequest): Promise<ClickResult> {
    const ref = validateTrackingInput(request, "click_ref", CLICK_REF_RE);
    const res = await this.#sendTracking(`${this.#clickEndpoint}?ref=${encodeURIComponent(ref)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "manual", // never follow into the advertiser's site
    });
    if (res.status === 302 && res.hasLocation) return { ok: true, status: "accepted" };
    throw this.#trackingError(res);
  }

  /** One tracking HTTP attempt. Only status/parsed body/Retry-After are kept; no URL, header or raw text leaves this method. */
  async #sendTracking(url: string, init: { method: string; headers: Record<string, string>; body?: string; redirect: "error" | "manual" }): Promise<TrackingResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const res = await this.#fetch(url, { ...init, cache: "no-store", signal: controller.signal });
      let body: unknown;
      try {
        const text = await res.text();
        body = text.length > MAX_RESPONSE_CHARS ? undefined : JSON.parse(text);
      } catch {
        body = undefined;
      }
      return { status: res.status, body, retryAfterMs: parseRetryAfterMs(res.headers.get("retry-after")), hasLocation: res.headers.has("location") };
    } catch {
      throw new BlissccoNetworkError();
    } finally {
      clearTimeout(timer);
    }
  }

  /** Non-success tracking response -> safe error (allow-listed code/reason only; raw body is never copied). */
  #trackingError(res: TrackingResponse): BlissccoApiError {
    if (res.status < 400) return new BlissccoApiError({ status: res.status, code: "invalid_response" });
    const b = res.body;
    const code = isObj(b) && typeof b.error === "string" && TRACKING_ERROR_CODES.includes(b.error) ? (b.error as ApiErrorCode) : "unknown_error";
    const reason = isObj(b) && typeof b.reason === "string" && /^[a-z_]{1,40}$/.test(b.reason) ? b.reason : undefined;
    return new BlissccoApiError({
      status: res.status,
      code,
      ...(reason ? { reason } : {}),
      ...(res.status === 429 && res.retryAfterMs !== undefined ? { retryAfterSeconds: Math.ceil(res.retryAfterMs / 1000) } : {}),
    });
  }

  /** One HTTP attempt. Returns a result, or a Retryable marker; throws for permanent errors. */
  async #sendOnce(headers: Record<string, string>, requestBody: string, idempotencyKey: string): Promise<MatchResult | Retryable> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    let res: Response;
    let body: unknown;
    try {
      res = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers,
        body: requestBody,
        redirect: "error", // never forward the Authorization header to a redirect target
        cache: "no-store",
        signal: controller.signal,
      });
      try {
        const text = await res.text();
        body = text.length > MAX_RESPONSE_CHARS ? undefined : JSON.parse(text);
      } catch {
        body = undefined;
      }
    } catch {
      return { retry: true, code: "network_error" };
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 200) {
      if (isObj(body) && body.fill === false) return { fill: false, idempotencyKey };
      if (isObj(body) && body.fill === true && body.sponsored === true && looksLikeAd(body.ad)) {
        // Explicit whitelist: only contract fields are returned.
        const ad = body.ad as Record<string, unknown>;
        const result: MatchResult = {
          idempotencyKey,
          fill: true,
          sponsored: true,
          ad: {
            id: ad.id as string,
            headline: ad.headline as string,
            body: ad.body as string,
            cta_text: ad.cta_text as string | null,
            destination_url: ad.destination_url as string,
          },
        };
        const t = body.tracking;
        if (isObj(t) && typeof t.token === "string" && typeof t.expires_at === "string" && Array.isArray(t.events)) {
          result.tracking = {
            token: t.token,
            expires_at: t.expires_at,
            events: t.events.filter((e): e is "impression" | "click" => e === "impression" || e === "click"),
            ...(typeof t.click_ref === "string" ? { click_ref: t.click_ref } : {}),
          };
        }
        return result;
      }
      throw new BlissccoApiError({ status: 200, code: "invalid_response" });
    }

    // Non-200: only allow-listed codes/reasons are surfaced; raw body text is never copied.
    const code = isObj(body) && typeof body.error === "string" && ERROR_CODES.includes(body.error) ? (body.error as ApiErrorCode) : "unknown_error";
    const reason = isObj(body) && typeof body.reason === "string" && /^[a-z_]{1,40}$/.test(body.reason) ? body.reason : undefined;
    const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
    if (RETRYABLE_STATUS.includes(res.status)) {
      return { retry: true, status: res.status, code, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) };
    }
    // Permanent (400, 401, 413, 415, 5xx other than 503, ...): never retried.
    throw new BlissccoApiError({
      status: res.status,
      code,
      ...(reason ? { reason } : {}),
    });
  }
}
