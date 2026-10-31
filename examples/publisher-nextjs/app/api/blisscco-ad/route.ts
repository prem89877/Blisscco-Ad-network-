import { NextResponse } from "next/server";
// In your own project, copy examples/publisher-node/src/{client,types}.ts next to this app and fix this import path.
import { BlissccoClient } from "../../../../publisher-node/src/client";
import { safeHref } from "../../../lib/safe-url";

// SERVER-ONLY route. The browser sends just a topic; this route calls Blisscco with the secret key.
// The key is read from server env here and nowhere else. No CORS headers are added on purpose
// (same-origin only), and only POST is exported.
//
// Two request shapes, both POST, both same-origin:
//   { topic }                       -> match (tracking opted in). Returns the 5 public ad fields + { tracking: { token?, click_ref? } } only.
//   { token, event: "impression" }  -> the exact Blisscco impression body. Forwarded server-side with client.reportImpression()
//                                      (Blisscco's impression endpoint has no CORS, so the browser cannot call it directly).
//   { click_ref, event: "click" }   -> a real user click. Forwarded server-side with client.reportClick(), which calls Blisscco's
//                                      GET /api/v1/ads/click?ref=... (signature, expiry, serve and destination are validated THERE).
//                                      Blisscco's redirect target is never followed or returned; the browser opens the ad's own
//                                      validated https destination itself. No destination is ever accepted from the browser.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Topics this site is willing to request ads for. Keep it small; every entry must be a valid Blisscco topic slug. */
const ALLOWED_TOPICS: ReadonlySet<string> = new Set([
  "developer_tools",
  "education",
  "finance",
  "fitness",
  "food",
  "gaming",
  "lifestyle",
  "technology",
  "travel",
]);

const MAX_BODY_CHARS = 1024;
// Shape only (same as the node client / lib/ads/tracking-token.ts); Blisscco verifies signature and expiry.
const TRACKING_TOKEN_RE = /^bt1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const CLICK_REF_RE = /^bc1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MAX_TOKEN_LENGTH = 512;
const HEADERS = { "Cache-Control": "no-store" };

type Json = Record<string, unknown>;
const reply = (body: Json, status = 200) => NextResponse.json(body, { status, headers: HEADERS });
const invalid = (reason: string) => reply({ error: "invalid_request", reason }, 400);
// Any upstream/config problem looks the same to the browser: "no ad right now". No details, ever.
const unavailable = () => reply({ fill: false, error: "unavailable" }, 503);

const isToken = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_TOKEN_LENGTH && TRACKING_TOKEN_RE.test(v);
const isClickRef = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_TOKEN_LENGTH && CLICK_REF_RE.test(v);

function makeClient(): BlissccoClient {
  return new BlissccoClient({
    baseUrl: process.env.BLISSCCO_API_BASE_URL ?? "",
    apiKey: process.env.BLISSCCO_PUBLISHER_API_KEY ?? "",
    timeoutMs: 3000,
    retry: { maxRetries: 1, baseDelayMs: 100, maxDelayMs: 1000 },
  });
}

/** Impression report: body must be exactly { token, event: "impression" }. Nothing else is accepted or forwarded. */
async function reportImpression(body: Json): Promise<Response> {
  if (Object.keys(body).some((k) => k !== "token" && k !== "event")) return invalid("unknown_field");
  if (body.event !== "impression") return invalid("invalid_event");
  if (!isToken(body.token)) return invalid("invalid_token");
  try {
    // The impression endpoint needs no API key; the client sends none. Single attempt, no retry.
    const result = await makeClient().reportImpression({ token: body.token });
    return reply({ ok: true, status: result.status });
  } catch (err) {
    // Class name only. Expired/invalid tokens, rate limits and outages all look the same to the browser.
    console.error("[blisscco-ad] impression report failed:", err instanceof Error ? err.name : "unknown");
    return reply({ ok: false, error: "unavailable" }, 503);
  }
}

/** Click report: body must be exactly { click_ref, event: "click" }. No URL, destination or other field is ever accepted. */
async function reportClick(body: Json): Promise<Response> {
  if (Object.keys(body).some((k) => k !== "click_ref" && k !== "event")) return invalid("unknown_field");
  if (body.event !== "click") return invalid("invalid_event");
  if (!isClickRef(body.click_ref)) return invalid("invalid_click_ref");
  try {
    // The click endpoint needs no API key; the client sends none, does not follow the redirect and does not return its target.
    const result = await makeClient().reportClick({ click_ref: body.click_ref });
    return reply({ ok: true, status: result.status });
  } catch (err) {
    console.error("[blisscco-ad] click report failed:", err instanceof Error ? err.name : "unknown");
    return reply({ ok: false, error: "unavailable" }, 503);
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!/^application\/json\s*(;|$)/i.test(request.headers.get("content-type") ?? "")) {
    return reply({ error: "unsupported_media_type" }, 415);
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_CHARS) return reply({ error: "payload_too_large" }, 413);

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return invalid("unreadable_body");
  }
  if (raw.length > MAX_BODY_CHARS) return reply({ error: "payload_too_large" }, 413);

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return invalid("invalid_json");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return invalid("invalid_body");
  const body = data as Json;
  if ("click_ref" in body) return reportClick(body);
  if ("token" in body || "event" in body) return reportImpression(body);
  // Only `topic` is accepted. Prompts, messages, conversation text, user data: rejected, never forwarded.
  if (Object.keys(body).some((k) => k !== "topic")) return invalid("unknown_field");
  const topic = body.topic;
  if (typeof topic !== "string" || !ALLOWED_TOPICS.has(topic)) return invalid("invalid_topic");

  try {
    const result = await makeClient().match({ topic }, { tracking: true });
    if (!result.fill) return reply({ fill: false });

    const href = safeHref(result.ad.destination_url);
    if (!href) return reply({ fill: false }); // unsafe link => behave like no-fill, and no tracking token leaves the server
    // Explicit whitelist of the 5 public fields.
    const { id, headline, body: adBody, cta_text } = result.ad;
    const out: Json = { fill: true, sponsored: true, ad: { id, headline, body: adBody, cta_text, destination_url: href } };
    // Minimum tracking data for the browser: the impression token and the public click ref, each only if Blisscco granted that event.
    // No expires_at, events or anything else. The destination never travels with the click ref.
    const t = result.tracking;
    if (t) {
      const tracking: Json = {};
      if (t.events.includes("impression") && isToken(t.token)) tracking.token = t.token;
      if (t.events.includes("click") && isClickRef(t.click_ref)) tracking.click_ref = t.click_ref;
      if (Object.keys(tracking).length > 0) out.tracking = tracking;
    }
    return reply(out);
  } catch (err) {
    // Log only the error class name: never the message, key, URL or response body.
    console.error("[blisscco-ad] ad request failed:", err instanceof Error ? err.name : "unknown");
    return unavailable();
  }
}
