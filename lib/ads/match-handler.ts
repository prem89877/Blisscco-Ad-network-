import { NextResponse } from "next/server";
import { hashApiKey, readBearerKey } from "@/lib/ads/api-key";
import { buildAdResponse, type MatchResponseBody } from "@/lib/ads/contract";
import { clientIpFromHeaders, createIpGuard, type IpGuard } from "@/lib/ads/ip-guard";
import { serveMatchForPublisher } from "@/lib/ads/service";
import { MAX_BODY_BYTES, parseIdempotencyKey, parseMatchRequest, parseTrackingOptIn } from "@/lib/ads/validation";

// Ad-match ka SHARED handler. Do routes isi ko chalate hain:
//   POST /api/ads/match      (purana, jaisa tha waisa; behaviour same)
//   POST /api/v1/ads/match   (naya, versioned public endpoint)
// Logic Day 5 route se jas ka tas yahan aaya hai (kuch duplicate nahi). Sirf do cheezein naye hain:
//   1. content-type ki strict jaanch (isJsonContentType)
//   2. options.extraHeaders: har jawab me jodne ke liye (v1 yahan version header lagata hai). JSON body kabhi nahi badalti.
// CORS jaan-boojh kar NAHI hai: key browser me nahi jaani chahiye.
// Har jawab ka shape lib/ads/contract.ts ke types se bandhta hai (contract: DAY6-ADS-MATCH-CONTRACT.md).
// Is file me logging nahi hai (key, hash, topic, body kuch log nahi hota). Errors ka code serve-db.ts me log hota hai.

export type MatchHandlerOptions = {
  /** Har response me jodne wale headers (jaise X-Blisscco-Api-Version). */
  extraHeaders?: Record<string, string>;
  /** Tests ke liye: galat-key guard bahar se. Default: is server instance ka apna guard. */
  ipGuard?: IpGuard;
};

// Ek IP se bahut zyada galat key aaye toh database tak jaane se pehle 429 (best-effort; Vercel Firewall alag se lagao).
const defaultIpGuard = createIpGuard();

const UNAUTHORIZED_HEADERS = { "WWW-Authenticate": 'Bearer realm="blisscco-ads"' };

/**
 * Sirf application/json (case-insensitive), optional parameters ke saath.
 * charset di ho toh utf-8 hi (JSON ka standard encoding; body UTF-8 se hi decode hota hai).
 * "application/jsonp", "application/json-patch+json", "application/jsonx" sab reject.
 */
export function isJsonContentType(header: string | null): boolean {
  if (!header) return false;
  const [mediaType, ...params] = header.split(";");
  if (mediaType.trim().toLowerCase() !== "application/json") return false;
  for (const param of params) {
    const eq = param.indexOf("=");
    if (eq === -1) continue;
    const name = param.slice(0, eq).trim().toLowerCase();
    if (name !== "charset") continue;
    const value = param.slice(eq + 1).trim().replace(/^"(.*)"$/, "$1").toLowerCase();
    if (value !== "utf-8" && value !== "utf8") return false;
  }
  return true;
}

/** Body ko limit ke andar padhta hai (chunked body se memory na bhare). Limit paar ho toh null. */
export async function readBodyLimited(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/**
 * Public entry. Kuch bhi anjaana toot jaye toh bhi publisher ko saaf JSON 503 milta hai (Next.js ka default 500 page nahi),
 * aur wo bhi no-store ke saath. Is file me logging nahi hoti (test se bandhi hai); asli errors serve-db.ts / serve.ts me log hote hain.
 */
export async function handleMatchPost(request: Request, options: MatchHandlerOptions = {}): Promise<Response> {
  try {
    return await processMatch(request, options);
  } catch {
    return NextResponse.json(
      { fill: false, error: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store", Vary: "Authorization", ...(options.extraHeaders ?? {}) } },
    );
  }
}

async function processMatch(request: Request, options: MatchHandlerOptions): Promise<Response> {
  const extra = options.extraHeaders ?? {};
  const guard = options.ipGuard ?? defaultIpGuard;
  const ip = clientIpFromHeaders(request.headers);
  const json = (body: MatchResponseBody, status: number, headers?: Record<string, string>) =>
    NextResponse.json(body, {
      status,
      // no-store: jawab kabhi cache nahi hota. Vary: Authorization: agar koi beech ka proxy galti se cache kare bhi,
      // toh ek publisher ka jawab doosre ki key par kabhi nahi jayega (defence in depth).
      headers: { "Cache-Control": "no-store", Vary: "Authorization", ...extra, ...headers },
    });

  // 0. Is IP se bahut galat keys aa chuki hain? Database tak mat jao.
  if (guard.isBlocked(ip, Date.now())) return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });

  // 1. Key ka format (database tak jaane se pehle). Galat/missing = hamesha ek jaisa 401.
  const key = readBearerKey(request.headers.get("authorization"));
  if (!key) {
    guard.recordFailure(ip, Date.now());
    return json({ error: "unauthorized" }, 401, UNAUTHORIZED_HEADERS);
  }

  // 2. Request ki shape
  if (!isJsonContentType(request.headers.get("content-type"))) {
    return json({ error: "unsupported_media_type" }, 415);
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413);
  }

  let raw: string | null;
  try {
    raw = await readBodyLimited(request, MAX_BODY_BYTES);
  } catch {
    return json({ error: "invalid_request", reason: "unreadable_body" }, 400);
  }
  if (raw === null) return json({ error: "payload_too_large" }, 413);

  const parsed = parseMatchRequest(raw);
  if (!parsed.ok) return json({ error: "invalid_request", reason: parsed.reason }, 400);

  // 2b. Optional `Idempotency-Key` header (retry-safety). Header ho par galat shape ka ho => 400 (chup-chaap ignore nahi:
  //     warna publisher sochega retry safe hai aur dobara charge ho jayega). Header na ho => pehle jaisa behaviour.
  const idem = parseIdempotencyKey(request.headers.get("idempotency-key"));
  if (!idem.ok) return json({ error: "invalid_request", reason: "invalid_idempotency_key" }, 400);
  // 2c. Optional `X-Blisscco-Tracking: 1` (opt-in). Header ho par "1" na ho => 400. Header na ho => jawab bilkul pehle jaisa.
  const tracking = parseTrackingOptIn(request.headers.get("x-blisscco-tracking"));
  if (!tracking.ok) return json({ error: "invalid_request", reason: "invalid_tracking_header" }, 400);
  const matchRequest = {
    ...parsed.value,
    ...(idem.value === undefined ? {} : { idempotencyKey: idem.value }),
    ...(tracking.value ? { trackingRequested: true } : {}),
  };

  // 3. Service: authorize + rate limit + category match + selection + serve record (+ optional, default-off provider fallback)
  const result = await serveMatchForPublisher(hashApiKey(key), matchRequest);

  switch (result.kind) {
    case "unauthorized":
      guard.recordFailure(ip, Date.now());
      return json({ error: "unauthorized" }, 401, UNAUTHORIZED_HEADERS);
    case "rate_limited":
      return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
    case "no_fill":
      return json({ fill: false }, 200);
    case "unavailable":
      return json({ fill: false, error: "unavailable" }, 503);
    case "ad":
      return json(buildAdResponse(result.ad, result.tracking), 200);
    case "provider_ad":
      // Day 22 Part 6: sirf server flag ON hone par (default band). Public response pehle se bana hai: tracking nahi, Blisscco serve/charge nahi.
      return json(result.response, 200);
  }
}
