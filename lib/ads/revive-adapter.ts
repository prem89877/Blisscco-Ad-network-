// Day 22 Part 2: Revive ke liye SERVER-SIDE, bounded delivery client (Part 1 ki seema ke andar).
//
// Abhi yeh production me attach NAHI hai (service.ts / match / click / impression kuch nahi badla). Default = DISABLED.
// Pure module: koi DB, billing, ledger, env, server-only, client-only import nahi. Sirf provider-adapter ka TYPE import hota hai.
//
// Protocol: configured delivery URL par ek plain GET (koi extra query/param/header nahi, sirf Accept). Revive ke koi undocumented
// field/endpoint nahi maane gaye; response sirf configured format ("json" ya "html") me raw + untrusted milta hai, koi field interpret nahi hoti.
// Yeh project ka CONFIGURED delivery contract hai; asli Revive instance ka format deploy se pehle manually verify karna hai.
//
// Niyam:
//   1. Config missing / disabled / invalid => no-fill. Kabhi throw nahi karta.
//   2. Ek hi deadline (timeoutMs) request + body padhne dono par. Timeout par request abort + no-fill.
//   3. Redirect follow nahi hota (redirect: "error"), koi cookie/auth nahi bhejta. Sirf configured URL hi call hota hai.
//   4. Status 2xx, content-type configured format se match, body <= REVIVE_MAX_BODY_BYTES (stream me ginta hai, zyada hote hi cancel),
//      valid UTF-8, json => sirf object. Baaki sab => no-fill.
//   5. Result me sirf reason code hota hai: delivery URL, provider error ya raw response kabhi nahi. Koi log nahi.
//   6. Fill ka data Blisscco ke billing, ledger, click ya impression ko nahi chhuta.

import type { AdProviderAdapter } from "./provider-adapter";

export type ReviveResponseFormat = "json" | "html";

export const REVIVE_RESPONSE_FORMATS: readonly ReviveResponseFormat[] = Object.freeze(["json", "html"] as const);
export const REVIVE_DEFAULT_TIMEOUT_MS = 800;
export const REVIVE_MAX_TIMEOUT_MS = 3000;
export const REVIVE_MAX_URL_LENGTH = 2048;
export const REVIVE_MAX_BODY_BYTES = 65536;
/** Part 1 ka purana naam (ab bytes me ginta hai). */
export const REVIVE_MAX_BODY_CHARS = REVIVE_MAX_BODY_BYTES;

/** Server-only config. Env se padhna caller ka kaam hai (is module ka nahi). Credential/secret is type me nahi hai. */
export type ReviveServerConfig = Readonly<{
  enabled: boolean;
  deliveryUrl: string;
  timeoutMs: number;
  responseFormat: ReviveResponseFormat;
}>;

/** Default: band. */
export const REVIVE_DISABLED_CONFIG: ReviveServerConfig = Object.freeze({
  enabled: false,
  deliveryUrl: "",
  timeoutMs: REVIVE_DEFAULT_TIMEOUT_MS,
  responseFormat: "json" as const,
});

export type ReviveConfigResult =
  | { ok: true; config: ReviveServerConfig }
  | { ok: false; reason: "disabled" | "invalid_config" };

/** Kabhi throw nahi karta. Sirf enabled === true (boolean) hi chalu karta hai. */
export function parseReviveConfig(input: unknown): ReviveConfigResult {
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input)) return { ok: false, reason: "disabled" };
    const raw = input as Record<string, unknown>;
    if (raw.enabled === undefined || raw.enabled === false) return { ok: false, reason: "disabled" };
    if (raw.enabled !== true) return { ok: false, reason: "invalid_config" };

    const url = raw.deliveryUrl;
    if (typeof url !== "string" || url.length === 0 || url.length > REVIVE_MAX_URL_LENGTH || url !== url.trim()) {
      return { ok: false, reason: "invalid_config" };
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, reason: "invalid_config" };
    }
    if (parsed.protocol !== "https:" || parsed.hostname === "" || parsed.username !== "" || parsed.password !== "" || parsed.hash !== "") {
      return { ok: false, reason: "invalid_config" };
    }

    let timeoutMs = REVIVE_DEFAULT_TIMEOUT_MS;
    if (raw.timeoutMs !== undefined) {
      const t = raw.timeoutMs;
      if (typeof t !== "number" || !Number.isInteger(t) || t < 1 || t > REVIVE_MAX_TIMEOUT_MS) return { ok: false, reason: "invalid_config" };
      timeoutMs = t;
    }

    let responseFormat: ReviveResponseFormat = "json";
    if (raw.responseFormat !== undefined) {
      if (raw.responseFormat !== "json" && raw.responseFormat !== "html") return { ok: false, reason: "invalid_config" };
      responseFormat = raw.responseFormat;
    }

    return { ok: true, config: Object.freeze({ enabled: true, deliveryUrl: parsed.href, timeoutMs, responseFormat }) };
  } catch {
    return { ok: false, reason: "invalid_config" };
  }
}

export type ReviveNoFillReason =
  | "disabled"
  | "invalid_config"
  | "no_fetcher"
  | "timeout"
  | "network_error"
  | "http_error"
  | "bad_content_type"
  | "too_large"
  | "empty_response"
  | "bad_response";

/** no-fill = Blisscco ka apna flow bina badlaav chalta hai. fill me raw, untrusted body (koi Revive field interpret nahi hui). */
export type ReviveFillResult =
  | Readonly<{ status: "no-fill"; reason: ReviveNoFillReason }>
  | Readonly<{ status: "fill"; format: "json"; payload: unknown }>
  | Readonly<{ status: "fill"; format: "html"; body: string }>;

export type ReviveBodyReader = Readonly<{
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(reason?: unknown): Promise<void>;
}>;

/** Caller (ya global fetch) ka minimal response shape. */
export type ReviveFetchResponse = Readonly<{
  status: number;
  headers: Readonly<{ get(name: string): string | null }>;
  body?: Readonly<{ getReader(): ReviveBodyReader }> | null;
  text(): Promise<string>;
}>;

export type ReviveFetchInit = Readonly<{
  method: "GET";
  headers: Readonly<Record<string, string>>;
  signal: AbortSignal;
  redirect: "error";
  credentials: "omit";
  cache: "no-store";
}>;

export type ReviveFetcher = (url: string, init: ReviveFetchInit) => Promise<ReviveFetchResponse>;

export type ReviveAdapterDeps = Readonly<{ fetcher?: ReviveFetcher }>;

export interface ReviveFallbackAdapter extends AdProviderAdapter {
  readonly name: "revive";
  /** Kabhi throw/reject nahi karta. */
  requestFill(): Promise<ReviveFillResult>;
}

const noFill = (reason: ReviveNoFillReason): ReviveFillResult => Object.freeze({ status: "no-fill" as const, reason });

/** Fill ko galti se JSON me serialize karne par raw body bahar na jaye: sirf status + format dikhta hai. */
function sealed<T extends object>(fill: T, format: ReviveResponseFormat): Readonly<T> {
  Object.defineProperty(fill, "toJSON", { value: () => ({ status: "fill", format }), enumerable: false });
  return Object.freeze(fill);
}

/** "application/json; charset=utf-8" => sirf exact media type + (optional) charset utf-8. */
function contentTypeMatches(header: string | null, format: ReviveResponseFormat): boolean {
  if (typeof header !== "string" || header.length === 0 || header.length > 200) return false;
  const [media, ...params] = header.split(";").map((x) => x.trim().toLowerCase());
  if (media !== (format === "json" ? "application/json" : "text/html")) return false;
  for (const param of params) {
    if (param === "") continue;
    if (param !== "charset=utf-8" && param !== 'charset="utf-8"') return false;
  }
  return true;
}

type ReadOutcome = { ok: true; text: string } | { ok: false; reason: ReviveNoFillReason };

/** Body ko REVIVE_MAX_BODY_BYTES tak hi padhta hai; zyada ho toh stream cancel. Deadline par bhi cancel. */
async function readBounded(res: ReviveFetchResponse, deadline: Promise<"timeout">): Promise<ReadOutcome> {
  const declared = res.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared.trim()) && Number(declared.trim()) > REVIVE_MAX_BODY_BYTES) {
    return { ok: false, reason: "too_large" };
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const body = res.body;
  if (!body || typeof body.getReader !== "function") {
    const readText = Promise.resolve().then(() => res.text());
    readText.catch(() => undefined);
    const text = await Promise.race([readText, deadline]);
    if (text === "timeout") return { ok: false, reason: "timeout" };
    if (typeof text !== "string") return { ok: false, reason: "bad_response" };
    if (new TextEncoder().encode(text).byteLength > REVIVE_MAX_BODY_BYTES) return { ok: false, reason: "too_large" };
    return { ok: true, text };
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = reader.read();
      next.catch(() => undefined);
      const r = await Promise.race([next, deadline]);
      if (r === "timeout") {
        reader.cancel().catch(() => undefined);
        return { ok: false, reason: "timeout" };
      }
      if (r.done) break;
      const chunk = r.value;
      if (!(chunk instanceof Uint8Array)) return { ok: false, reason: "bad_response" };
      total += chunk.byteLength;
      if (total > REVIVE_MAX_BODY_BYTES) {
        reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(chunk);
    }
  } catch {
    reader.cancel().catch(() => undefined);
    return { ok: false, reason: "network_error" };
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return { ok: true, text: decoder.decode(all) };
  } catch {
    return { ok: false, reason: "bad_response" };
  }
}

/** Global fetch tabhi use hota hai jab caller ne fetcher nahi diya; call ke samay padha jaata hai. Na ho => no-fill. */
function resolveFetcher(injected: ReviveFetcher | undefined): ReviveFetcher | undefined {
  if (typeof injected === "function") return injected;
  const g = (globalThis as unknown as { fetch?: unknown }).fetch;
  return typeof g === "function" ? (g as unknown as ReviveFetcher).bind(g) : undefined;
}

/** Click events ke liye koi onClickRecorded nahi (Revive ko click copy nahi jaati). Sirf requestFill. */
export function createReviveAdapter(rawConfig?: unknown, deps: ReviveAdapterDeps = {}): ReviveFallbackAdapter {
  const parsed = parseReviveConfig(rawConfig);
  const injected = deps?.fetcher;

  async function requestFill(): Promise<ReviveFillResult> {
    if (!parsed.ok) return noFill(parsed.reason);
    const send = resolveFetcher(injected);
    if (send === undefined) return noFill("no_fetcher");
    const { deliveryUrl, timeoutMs, responseFormat } = parsed.config;

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve("timeout");
        }, timeoutMs);
      });
      const call = Promise.resolve().then(() =>
        send(deliveryUrl, {
          method: "GET",
          headers: Object.freeze({ accept: responseFormat === "json" ? "application/json" : "text/html" }),
          signal: controller.signal,
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
        }),
      );
      call.catch(() => undefined); // timeout ke baad late reject => unhandled rejection nahi
      const res = await Promise.race([call, deadline]);
      if (res === "timeout") return noFill("timeout");
      if (!res || typeof res.status !== "number" || res.status < 200 || res.status > 299 || !res.headers || typeof res.headers.get !== "function") {
        return noFill("http_error");
      }
      if (!contentTypeMatches(res.headers.get("content-type"), responseFormat)) return noFill("bad_content_type");

      const read = await readBounded(res, deadline);
      if (!read.ok) return noFill(read.reason);
      if (read.text.trim() === "") return noFill("empty_response");

      if (responseFormat === "html") return sealed({ status: "fill" as const, format: "html" as const, body: read.text }, "html");
      let payload: unknown;
      try {
        payload = JSON.parse(read.text);
      } catch {
        return noFill("bad_response");
      }
      if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return noFill("bad_response");
      return sealed({ status: "fill" as const, format: "json" as const, payload }, "json");
    } catch {
      return noFill("network_error"); // provider error text kabhi aage nahi jaata
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  return Object.freeze({ name: "revive" as const, requestFill });
}

// ---------------------------------------------------------------------------
// Day 22 Part 4: verified fill => sirf EXTRACTED creative fields (koi mapping public response ki nahi; wo contract.ts me hai).
//
// Yeh Blisscco ka CONFIGURED JSON contract hai (asli Revive instance ka format deploy se pehle manually verify karna hai):
//   { "headline": string, "body": string, "cta_text": string | null (optional), "destination_url": string }
// Sirf yahi 4 fields padhi jaati hain; baaki sab (extra/internal provider data) yahin chhoot jaata hai.
// "html" format kabhi nahi: raw markup/script aage nahi jaata. Executable-markup wali keys ka creative reject.
// Destination yahan jaanchi NAHI jaati: contract.ts me project ke safe-destination rule se hoti hai (isliye kachcha URL aage "unvalidated" hai).
// ---------------------------------------------------------------------------

export const REVIVE_PROVIDER_NAME = "revive" as const;

export type ReviveCreativeFields = Readonly<{
  headline: string;
  body: string;
  ctaText: string | null;
  destinationUrl: string;
}>;

export type ReviveCreativeRejection = "not_a_fill" | "unsupported_format" | "unsupported_creative" | "invalid_creative";

export type ReviveCreativeResult =
  | Readonly<{ ok: true; provider: typeof REVIVE_PROVIDER_NAME; creative: ReviveCreativeFields }>
  | Readonly<{ ok: false; reason: ReviveCreativeRejection }>;

/** In keys ka matlab executable/markup creative: poora fill reject (field ignore nahi). */
const REVIVE_EXECUTABLE_KEYS: ReadonlySet<string> = new Set([
  "html", "script", "scripts", "js", "javascript", "iframe", "tag", "code", "markup", "adm", "creative_html", "ad_html", "body_html", "snippet", "embed", "vast", "xml",
]);

const rejectCreative = (reason: ReviveCreativeRejection): ReviveCreativeResult => Object.freeze({ ok: false as const, reason });
const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/**
 * Part 2 ka `fill` (status:"fill") ya Part 3 ka FallbackFill ({provider:"revive", format, data}) dono le sakta hai. Kabhi throw nahi karta.
 * Sirf JSON fill chalta hai; html => "unsupported_format". Result me sirf 4 allowlisted string fields aur provider ka naam.
 */
export function extractReviveCreative(fill: unknown): ReviveCreativeResult {
  try {
    if (fill === null || typeof fill !== "object") return rejectCreative("not_a_fill");
    const f = fill as Record<string, unknown>;
    let format: unknown;
    let data: unknown;
    if (f.status === "fill") {
      format = f.format;
      data = f.format === "json" ? f.payload : f.body;
    } else if (typeof f.provider === "string") {
      if (f.provider !== REVIVE_PROVIDER_NAME) return rejectCreative("not_a_fill");
      format = f.format;
      data = f.data;
    } else {
      return rejectCreative("not_a_fill");
    }
    if (format === "html") return rejectCreative("unsupported_format");
    if (format !== "json") return rejectCreative("not_a_fill");
    if (data === null || typeof data !== "object" || Array.isArray(data)) return rejectCreative("invalid_creative");
    const obj = data as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (REVIVE_EXECUTABLE_KEYS.has(key.toLowerCase())) return rejectCreative("unsupported_creative");
    }
    const str = (k: string): string | undefined => (hasOwn(obj, k) && typeof obj[k] === "string" ? (obj[k] as string) : undefined);
    const headline = str("headline");
    const body = str("body");
    const destinationUrl = str("destination_url");
    if (headline === undefined || body === undefined || destinationUrl === undefined) return rejectCreative("invalid_creative");
    let ctaText: string | null = null;
    if (hasOwn(obj, "cta_text") && obj.cta_text !== null && obj.cta_text !== undefined) {
      if (typeof obj.cta_text !== "string") return rejectCreative("invalid_creative");
      ctaText = obj.cta_text;
    }
    return Object.freeze({ ok: true as const, provider: REVIVE_PROVIDER_NAME, creative: Object.freeze({ headline, body, ctaText, destinationUrl }) });
  } catch {
    return rejectCreative("invalid_creative");
  }
}
