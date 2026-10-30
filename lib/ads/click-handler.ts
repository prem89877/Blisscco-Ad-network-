import { NextResponse } from "next/server";
import { clientIpFromHeaders, createIpGuard, type IpGuard } from "@/lib/ads/ip-guard";
import { parseClickQuery, type ClickResult } from "@/lib/ads/click";
import { acceptClickForRef } from "@/lib/ads/service";

// GET /api/v1/ads/click?ref=<click ref>  : user ke click par Blisscco ka redirect.
// Query me SIRF `ref` (signed, expiry wala, serve + creative se bandha). Destination kabhi query/body se nahi: database ke creative row se aati hai.
// Jawab: 302 -> destination (https, jaanchi hui) | 204 (prefetch: kuch nahi hota) | 400 | 404 (ref ki har galti EK jaisa) | 429 | 503.
// Click sirf GET par (HEAD/POST/... = 405, route.ts me). Prefetch/prerender requests click nahi ginti.
// Is file me logging nahi hoti (ref, IP, URL kuch log nahi). Database error ka code click-db.ts me log hota hai.
// Redirect par Referrer-Policy: no-referrer (ref destination site ko leak na ho) aur no-store (click cache nahi hota).

export type ClickHandlerOptions = {
  /** Tests ke liye. Default: production wiring (service.ts). */
  accept?: (ref: unknown) => Promise<ClickResult>;
  requestGuard?: IpGuard;
  failureGuard?: IpGuard;
};

export const REQUESTS_PER_MINUTE_PER_IP = 300;
export const FAILURES_PER_MINUTE_PER_IP = 30;
const defaultRequestGuard = createIpGuard(REQUESTS_PER_MINUTE_PER_IP);
const defaultFailureGuard = createIpGuard(FAILURES_PER_MINUTE_PER_IP);

const BASE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Blisscco-Api-Version": "1",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};

const respond = (body: Record<string, unknown>, status: number, extra: Record<string, string> = {}): Response =>
  NextResponse.json(body, { status, headers: { ...BASE_HEADERS, ...extra } });

/** Browser/proxy ka prefetch ya prerender: asli click nahi, isliye na gino na redirect karo. */
export function isPrefetch(headers: Headers): boolean {
  const purpose = `${headers.get("sec-purpose") ?? ""} ${headers.get("purpose") ?? ""} ${headers.get("x-moz") ?? ""} ${headers.get("x-purpose") ?? ""}`.toLowerCase();
  return /prefetch|prerender|preview/.test(purpose) || headers.get("next-router-prefetch") !== null;
}

/** Public entry. Kuch bhi anjaana toot jaye toh bhi saaf JSON 503 (Next.js ka default 500 page nahi). */
export async function handleClickGet(request: Request, options: ClickHandlerOptions = {}): Promise<Response> {
  try {
    return await processClick(request, options);
  } catch {
    return respond({ error: "unavailable" }, 503);
  }
}

export function methodNotAllowed(): Response {
  return respond({ error: "method_not_allowed" }, 405, { Allow: "GET" });
}

async function processClick(request: Request, options: ClickHandlerOptions): Promise<Response> {
  const requestGuard = options.requestGuard ?? defaultRequestGuard;
  const failureGuard = options.failureGuard ?? defaultFailureGuard;
  const accept = options.accept ?? acceptClickForRef;
  const ip = clientIpFromHeaders(request.headers);
  const now = Date.now();

  // 0. Rate limit (database tak jaane se PEHLE). IP sirf memory me kuch seconds/minute rehti hai.
  if (requestGuard.isBlocked(ip, now) || failureGuard.isBlocked(ip, now)) return respond({ error: "rate_limited" }, 429, { "Retry-After": "60" });
  requestGuard.recordFailure(ip, now);

  // 1. Query ki strict jaanch: sirf `ref`.
  const parsed = parseClickQuery(new URL(request.url).searchParams);
  if (!parsed.ok) {
    failureGuard.recordFailure(ip, Date.now());
    return respond({ error: "invalid_request", reason: parsed.reason }, 400);
  }

  // 2. Prefetch: kuch nahi hota (na click, na redirect).
  if (isPrefetch(request.headers)) return new Response(null, { status: 204, headers: BASE_HEADERS });

  // 3. ref + serve + creative + destination + atomic click
  const result = await accept(parsed.ref);
  switch (result.kind) {
    case "redirect":
      return new Response(null, { status: 302, headers: { ...BASE_HEADERS, Location: result.location } });
    case "invalid":
      failureGuard.recordFailure(ip, Date.now());
      return respond({ error: "not_found" }, 404); // wajah nahi bataate
    case "unavailable_target":
      return respond({ error: "not_found" }, 404); // invalid jaisa hi jawab: endpoint se creative ki halat ka andaza nahi
    case "unavailable":
      return respond({ error: "unavailable" }, 503);
  }
}
