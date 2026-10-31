import { NextResponse } from "next/server";
// In your own project, copy examples/publisher-node/src/{client,types}.ts next to this app and fix this import path.
import { BlissccoClient } from "../../../../publisher-node/src/client";
import { safeHref } from "../../../lib/safe-url";

// SERVER-ONLY route. The browser sends just a topic; this route calls Blisscco with the secret key.
// The key is read from server env here and nowhere else. No CORS headers are added on purpose
// (same-origin only), and only POST is exported.

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
const HEADERS = { "Cache-Control": "no-store" };

type Json = Record<string, unknown>;
const reply = (body: Json, status = 200) => NextResponse.json(body, { status, headers: HEADERS });
const invalid = (reason: string) => reply({ error: "invalid_request", reason }, 400);
// Any upstream/config problem looks the same to the browser: "no ad right now". No details, ever.
const unavailable = () => reply({ fill: false, error: "unavailable" }, 503);

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
  // Only `topic` is accepted. Prompts, messages, conversation text, user data: rejected, never forwarded.
  if (Object.keys(body).some((k) => k !== "topic")) return invalid("unknown_field");
  const topic = body.topic;
  if (typeof topic !== "string" || !ALLOWED_TOPICS.has(topic)) return invalid("invalid_topic");

  try {
    const client = new BlissccoClient({
      baseUrl: process.env.BLISSCCO_API_BASE_URL ?? "",
      apiKey: process.env.BLISSCCO_PUBLISHER_API_KEY ?? "",
      timeoutMs: 3000,
      retry: { maxRetries: 1, baseDelayMs: 100, maxDelayMs: 1000 },
    });
    const result = await client.match({ topic });
    if (!result.fill) return reply({ fill: false });

    const href = safeHref(result.ad.destination_url);
    if (!href) return reply({ fill: false }); // unsafe link => behave like no-fill
    // Explicit whitelist of the 5 public fields. Tracking data and anything else is dropped.
    const { id, headline, body: adBody, cta_text } = result.ad;
    return reply({ fill: true, sponsored: true, ad: { id, headline, body: adBody, cta_text, destination_url: href } });
  } catch (err) {
    // Log only the error class name: never the message, key, URL or response body.
    console.error("[blisscco-ad] ad request failed:", err instanceof Error ? err.name : "unknown");
    return unavailable();
  }
}
