import { NextResponse } from "next/server";
import { hashApiKey, readBearerKey } from "@/lib/ads/api-key";
import { serveAdForPublisher } from "@/lib/ads/service";
import { MAX_BODY_BYTES, parseMatchRequest } from "@/lib/ads/validation";

// Ad-match ka SHARED handler. Do routes isi ko chalate hain:
//   POST /api/ads/match      (purana, jaisa tha waisa; behaviour same)
//   POST /api/v1/ads/match   (naya, versioned public endpoint)
// Logic Day 5 route se jas ka tas yahan aaya hai (kuch duplicate nahi). Sirf do cheezein naye hain:
//   1. content-type ki strict jaanch (isJsonContentType)
//   2. options.extraHeaders: har jawab me jodne ke liye (v1 yahan version header lagata hai). JSON body kabhi nahi badalti.
// CORS jaan-boojh kar NAHI hai: key browser me nahi jaani chahiye.
// Is file me logging nahi hai (key, hash, topic, body kuch log nahi hota). Errors ka code serve-db.ts me log hota hai.

export type MatchHandlerOptions = {
  /** Har response me jodne wale headers (jaise X-Blisscco-Api-Version). */
  extraHeaders?: Record<string, string>;
};

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
async function readBodyLimited(request: Request, maxBytes: number): Promise<string | null> {
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

export async function handleMatchPost(request: Request, options: MatchHandlerOptions = {}): Promise<Response> {
  const extra = options.extraHeaders ?? {};
  const json = (body: Record<string, unknown>, status: number, headers?: Record<string, string>) =>
    NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...extra, ...headers } });

  // 1. Key ka format (database tak jaane se pehle). Galat/missing = hamesha ek jaisa 401.
  const key = readBearerKey(request.headers.get("authorization"));
  if (!key) return json({ error: "unauthorized" }, 401, UNAUTHORIZED_HEADERS);

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

  // 3. Service: authorize + rate limit + category match + selection + serve record
  const result = await serveAdForPublisher(hashApiKey(key), parsed.value);

  switch (result.kind) {
    case "unauthorized":
      return json({ error: "unauthorized" }, 401, UNAUTHORIZED_HEADERS);
    case "rate_limited":
      return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
    case "no_fill":
      return json({ fill: false }, 200);
    case "unavailable":
      return json({ fill: false, error: "unavailable" }, 503);
    case "ad":
      return json(
        {
          fill: true,
          sponsored: true,
          ad: {
            id: result.ad.id,
            headline: result.ad.headline,
            body: result.ad.body,
            cta_text: result.ad.ctaText,
            destination_url: result.ad.destinationUrl,
          },
        },
        200,
      );
  }
}
