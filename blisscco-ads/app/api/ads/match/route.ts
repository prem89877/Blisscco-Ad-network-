import { NextResponse } from "next/server";
import { hashApiKey, readBearerKey } from "@/lib/ads/api-key";
import { serveAdForPublisher } from "@/lib/ads/service";
import { MAX_BODY_BYTES, parseMatchRequest } from "@/lib/ads/validation";

// POST /api/ads/match
// Publisher ka SERVER (browser nahi) yahan topic slug bhejta hai, jawab me ek sponsored ad ya no-fill.
//   Authorization: Bearer blc_live_...
//   { "topic": "gaming", "exclude_ad_ids": ["<pichhle dikhaye ad ids, optional>"] }
// CORS jaan-boojh kar NAHI hai: key browser me nahi jaani chahiye.
// Publisher ko sirf ad ke public fields milte hain; advertiser/budget/campaign data kabhi nahi.
// Flow (lib/ads/service.ts): key authorize + rate limit -> category match -> campaign selection -> serve record -> jawab.
// Private campaign queries sirf server par chalti hain (service-role, database functions ke peeche).
// Production se pehle edge/IP rate limiting aur baaki items: DAY6-SERVE-INTEGRATION.md.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status: number, extraHeaders?: Record<string, string>) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...extraHeaders } });
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

export async function POST(request: Request) {
  // 1. Key ka format (database tak jaane se pehle). Galat/missing = hamesha ek jaisa 401.
  const key = readBearerKey(request.headers.get("authorization"));
  if (!key) {
    return json({ error: "unauthorized" }, 401, { "WWW-Authenticate": 'Bearer realm="blisscco-ads"' });
  }

  // 2. Request ki shape
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
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
      return json({ error: "unauthorized" }, 401, { "WWW-Authenticate": 'Bearer realm="blisscco-ads"' });
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
