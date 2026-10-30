import { NextResponse } from "next/server";
import { clientIpFromHeaders, createIpGuard, type IpGuard } from "@/lib/ads/ip-guard";
import { MAX_IMPRESSION_BODY_BYTES, parseImpressionRequest, type ImpressionResult } from "@/lib/ads/impression";
import { isJsonContentType, readBodyLimited } from "@/lib/ads/match-handler";
import { acceptImpressionForToken } from "@/lib/ads/service";

// POST /api/v1/ads/impression : browser (ya publisher server) yahan ek signed tracking token bhejta hai: "ye serve dikha".
//   { "token": "bt1....", "event": "impression" }
// Koi API key nahi (key browser me kabhi nahi jaani chahiye); token hi ijazat hai (HMAC, serve se bandha, expiry wala).
// Jawab: 200 {ok:true,status:"recorded"|"duplicate"} | 400 | 401 (sab token/serve galtiyan EK jaisi) | 413 | 415 | 429 | 503. Kabhi koi campaign/publisher/serve data nahi.
// CORS jaan-boojh kar NAHI hai (project ka niyam: koi wildcard CORS nahi, day10-part6 ka test isse bandhta hai). Isliye token publisher ke SERVER se
// (ya same-origin proxy se) aana chahiye; kisi doosre origin ka browser seedha yahan POST nahi kar sakta. Browser se seedha beacon ke liye publisher-wise
// origin allowlist chahiye (abhi schema me nahi): alag faisla, alag part (DAY12-PART4-IMPRESSION.md).
// Is file me logging nahi hoti (token, IP, body kuch log nahi). Database ke error ka code impression-db.ts me log hota hai.

export type ImpressionHandlerOptions = {
  /** Tests ke liye. Default: production wiring (service.ts). */
  accept?: (token: unknown, event: unknown) => Promise<ImpressionResult>;
  /** Tests ke liye: sabhi requests ki guard / galat-token ki guard bahar se. Default: is server instance ke apne. */
  requestGuard?: IpGuard;
  failureGuard?: IpGuard;
};

// Best-effort (har server instance ki memory alag): asli (poori) rok ke liye Vercel Firewall rate-limit rule bhi lagao (DAY12-PART4-IMPRESSION.md).
// Database ki taraf se bhi seema hai: ek serve par kitni bhi requests aayen, ek hi impression ban sakta hai (unique constraint).
export const REQUESTS_PER_MINUTE_PER_IP = 300;
export const FAILURES_PER_MINUTE_PER_IP = 30;
const defaultRequestGuard = createIpGuard(REQUESTS_PER_MINUTE_PER_IP);
const defaultFailureGuard = createIpGuard(FAILURES_PER_MINUTE_PER_IP);

const BASE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Blisscco-Api-Version": "1",
  "X-Content-Type-Options": "nosniff",
};

const respond = (body: Record<string, unknown>, status: number, extra: Record<string, string> = {}): Response =>
  NextResponse.json(body, { status, headers: { ...BASE_HEADERS, ...extra } });

/** Public entry. Kuch bhi anjaana toot jaye toh bhi saaf JSON 503 (Next.js ka default 500 page nahi). */
export async function handleImpressionPost(request: Request, options: ImpressionHandlerOptions = {}): Promise<Response> {
  try {
    return await processImpression(request, options);
  } catch {
    return respond({ error: "unavailable" }, 503);
  }
}

async function processImpression(request: Request, options: ImpressionHandlerOptions): Promise<Response> {
  const requestGuard = options.requestGuard ?? defaultRequestGuard;
  const failureGuard = options.failureGuard ?? defaultFailureGuard;
  const accept = options.accept ?? acceptImpressionForToken;
  const ip = clientIpFromHeaders(request.headers);
  const now = Date.now();

  // 0. Rate limit (database tak jaane se PEHLE). IP sirf memory me kuch seconds/minute rehti hai, kahin log/store nahi hoti.
  //    Har request ginti me aati hai (recordFailure yahan "ek hit" ka kaam karta hai); galat token alag se ginta hai.
  if (requestGuard.isBlocked(ip, now) || failureGuard.isBlocked(ip, now)) return respond({ error: "rate_limited" }, 429, { "Retry-After": "60" });
  requestGuard.recordFailure(ip, now);

  // 1. Request ki shape (content type, size) : database tak jaane se pehle.
  if (!isJsonContentType(request.headers.get("content-type"))) return respond({ error: "unsupported_media_type" }, 415);
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_IMPRESSION_BODY_BYTES) return respond({ error: "payload_too_large" }, 413);

  let raw: string | null;
  try {
    raw = await readBodyLimited(request, MAX_IMPRESSION_BODY_BYTES);
  } catch {
    return respond({ error: "invalid_request", reason: "unreadable_body" }, 400);
  }
  if (raw === null) return respond({ error: "payload_too_large" }, 413);

  const parsed = parseImpressionRequest(raw);
  if (!parsed.ok) return respond({ error: "invalid_request", reason: parsed.reason }, 400);

  // 2. Token + serve + atomic write
  const result = await accept(parsed.value.token, parsed.value.event);
  switch (result.kind) {
    case "recorded":
      return respond({ ok: true, status: "recorded" }, 200);
    case "duplicate":
      return respond({ ok: true, status: "duplicate" }, 200);
    case "unauthorized":
      failureGuard.recordFailure(ip, Date.now());
      return respond({ error: "unauthorized" }, 401);
    case "unavailable":
      return respond({ error: "unavailable" }, 503);
  }
}
