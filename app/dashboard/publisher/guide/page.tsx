import type { Metadata } from "next";
import Link from "next/link";
import PageHeader from "@/components/dashboard/PageHeader";
import Panel from "@/components/dashboard/Panel";
import IntegrationSteps from "@/components/dashboard/IntegrationSteps";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import CodeBlock from "@/components/ui/CodeBlock";
import { requireAccount } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Integration Guide | Blisscco Dashboard" };

// Publisher integration guide for the versioned Ad API: POST /api/v1/ads/match, POST /api/v1/ads/impression, GET /api/v1/ads/click.
// Source of truth for the contract: DAY6-ADS-MATCH-CONTRACT.md, lib/ads/contract.ts and the impression and click route handlers.
// Day 15 Part 4: tests/ads/publisher-guide.test.ts checks this page against the real code. This page imports none of those modules.
// Day 20 Part 4: pilot quickstart (examples/publisher-node, examples/publisher-nextjs) and troubleshooting, checked by the same tests.
// Rules for this page: no real key, no real publisher, no deployment URL, no claim about third-party chatbots,
// no claim of production readiness. Code samples are plain strings (no template literals) so nothing is interpolated.

const CURL_EXAMPLE = [
  'curl -i -X POST "https://YOUR-BLISSCCO-API-HOST/api/v1/ads/match" \\',
  '  -H "Authorization: Bearer $BLISSCCO_PUBLISHER_API_KEY" \\',
  '  -H "Content-Type: application/json" \\',
  '  -H "Idempotency-Key: 7b0e3c1a-1c2d-4e5f-8a9b-0c1d2e3f4a5b" \\',
  "  -d '{\"topic\":\"gaming\"}'",
].join("\n");

const REQUEST_EXAMPLE = [
  "{",
  '  "topic": "gaming",',
  '  "exclude_ad_ids": []',
  "}",
].join("\n");

const SUCCESS_EXAMPLE = [
  "{",
  '  "fill": true,',
  '  "sponsored": true,',
  '  "ad": {',
  '    "id": "3f2b8c1e-5a47-4d9e-9b62-7c1d8e4a6f10",',
  '    "headline": "Level up your game nights",',
  '    "body": "Compare gaming laptops built for long sessions.",',
  '    "cta_text": "Shop now",',
  '    "destination_url": "https://example.com/gaming-laptops"',
  "  }",
  "}",
].join("\n");

const NO_FILL_EXAMPLE = '{ "fill": false }';

// Optional tracking token (opt-in header). Example values only: the token below is NOT a real token.
const TRACKING_CURL_EXAMPLE = [
  'curl -i -X POST "https://YOUR-BLISSCCO-API-HOST/api/v1/ads/match" \\',
  '  -H "Authorization: Bearer $BLISSCCO_PUBLISHER_API_KEY" \\',
  '  -H "Content-Type: application/json" \\',
  '  -H "Idempotency-Key: 7b0e3c1a-1c2d-4e5f-8a9b-0c1d2e3f4a5b" \\',
  '  -H "X-Blisscco-Tracking: 1" \\',
  "  -d '{\"topic\":\"gaming\"}'",
].join("\n");

const TRACKING_SUCCESS_EXAMPLE = [
  '{',
  '  "fill": true,',
  '  "sponsored": true,',
  '  "ad": {',
  '    "id": "3f2b8c1e-5a47-4d9e-9b62-7c1d8e4a6f10",',
  '    "headline": "Level up your game nights",',
  '    "body": "Compare gaming laptops built for long sessions.",',
  '    "cta_text": "Shop now",',
  '    "destination_url": "https://example.com/gaming-laptops"',
  '  },',
  '  "tracking": {',
  '    "token": "bt1.EXAMPLE-PAYLOAD.EXAMPLE-SIGNATURE",',
  '    "expires_at": "2026-10-28T11:00:00.000Z",',
  '    "events": ["impression", "click"],',
  '    "click_ref": "bc1.EXAMPLE-PAYLOAD.EXAMPLE-SIGNATURE"',
  '  }',
  '}',
].join("\n");

const SERVER_EXAMPLE = [
  "// Runs on YOUR backend only. Never import this file into browser or frontend code.",
  "type SponsoredAd = {",
  "  id: string;",
  "  headline: string;",
  "  body: string;",
  "  cta_text: string | null;",
  "  destination_url: string;",
  "};",
  "type MatchResponse =",
  "  | { fill: true; sponsored: true; ad: SponsoredAd }",
  "  | { fill: false; error?: string };",
  "",
  "// Server environment variables. Do NOT give them a public prefix (NEXT_PUBLIC_, VITE_, REACT_APP_).",
  "const API_BASE = process.env.BLISSCCO_API_BASE_URL; // given to you by Blisscco",
  "const API_KEY = process.env.BLISSCCO_PUBLISHER_API_KEY; // secret, kept out of git",
  "",
  "let pausedUntil = 0; // epoch ms: stop asking for ads while rate limited",
  "const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));",
  "",
  "// One new Idempotency-Key per ad placement. If YOU retry that same placement, the SAME key is reused (see section 5).",
  "export async function getSponsoredAd(",
  "  topic: string, // a supported topic slug that YOUR code chose (see section 1), never user text",
  "  shownAdIds: string[] = [],",
  "  idempotencyKey: string = crypto.randomUUID(),",
  "): Promise<SponsoredAd | null> {",
  "  if (!API_BASE || !API_KEY) return null; // not configured: just run without ads",
  "  if (Date.now() < pausedUntil) return null;",
  "  for (let attempt = 0; attempt < 2; attempt++) {",
  "    try {",
  "      const res = await fetch(API_BASE + \"/api/v1/ads/match\", {",
  "        method: \"POST\",",
  "        headers: {",
  "          Authorization: \"Bearer \" + API_KEY,",
  "          \"Content-Type\": \"application/json\",",
  "          \"Idempotency-Key\": idempotencyKey, // same key on a retry = no second charge",
  "        },",
  "        body: JSON.stringify({ topic: topic, exclude_ad_ids: shownAdIds }),",
  "        signal: AbortSignal.timeout(2000), // your own timeout: never make the chat wait for an ad",
  "      });",
  "      if (res.status === 429) {",
  "        pausedUntil = Date.now() + (Number(res.headers.get(\"Retry-After\")) || 60) * 1000;",
  "        return null;",
  "      }",
  "      if (res.ok) {",
  "        const data = (await res.json()) as MatchResponse;",
  "        return data.fill === true && data.sponsored === true ? data.ad : null;",
  "      }",
  "      if (res.status < 500) return null; // 400/401/413/415: fix the request, never retry",
  "    } catch {",
  "      // network error or timeout: fall through to ONE retry",
  "    }",
  "    if (attempt === 0) await sleep(1000 + Math.random() * 500); // wait 1s or more, with jitter",
  "  }",
  "  return null; // still failing: continue without an ad",
  "}",
].join("\n");

const PROXY_EXAMPLE = [
  "// proxy.mjs: Node 18+, no dependencies. Runs on YOUR backend; the key never leaves it.",
  "// Your frontend calls GET /sponsored?area=coding on YOUR server and receives only the public ad fields.",
  "import { createServer } from \"node:http\";",
  "import { randomUUID } from \"node:crypto\";",
  "",
  "const API_BASE = process.env.BLISSCCO_API_BASE_URL; // given to you by Blisscco",
  "const API_KEY = process.env.BLISSCCO_PUBLISHER_API_KEY; // secret, kept out of git",
  "",
  "// YOUR fixed mapping from a product area to a Blisscco topic. Your code decides it, not the user's message.",
  "const TOPIC_BY_AREA = new Map([",
  "  [\"coding\", \"developer_tools\"],",
  "  [\"gaming\", \"gaming\"],",
  "  [\"travel\", \"travel\"],",
  "]);",
  "",
  "async function fetchAd(topic) {",
  "  if (!API_BASE || !API_KEY) return null;",
  "  try {",
  "    const res = await fetch(API_BASE + \"/api/v1/ads/match\", {",
  "      method: \"POST\",",
  "      headers: {",
  "        Authorization: \"Bearer \" + API_KEY,",
  "        \"Content-Type\": \"application/json\",",
  "        \"Idempotency-Key\": randomUUID(), // random, one per placement; never a user id or text",
  "      },",
  "      body: JSON.stringify({ topic: topic }),",
  "      signal: AbortSignal.timeout(2000),",
  "    });",
  "    if (!res.ok) return null; // 429, 5xx, anything else: no ad",
  "    const data = await res.json();",
  "    return data.fill === true && data.sponsored === true ? data.ad : null;",
  "  } catch {",
  "    return null; // network error or timeout: no ad",
  "  }",
  "}",
  "",
  "createServer(async (req, res) => {",
  "  const url = new URL(req.url, \"http://localhost\");",
  "  if (req.method !== \"GET\" || url.pathname !== \"/sponsored\") {",
  "    res.writeHead(404).end();",
  "    return;",
  "  }",
  "  const topic = TOPIC_BY_AREA.get(url.searchParams.get(\"area\") ?? \"\");",
  "  const ad = topic ? await fetchAd(topic) : null;",
  "  if (!ad) {",
  "    res.writeHead(204).end(); // no ad: the browser shows nothing",
  "    return;",
  "  }",
  "  res.writeHead(200, { \"Content-Type\": \"application/json\", \"Cache-Control\": \"no-store\" });",
  "  // Only the five public ad fields go to the browser. Never the key, never the raw upstream response.",
  "  res.end(JSON.stringify({",
  "    sponsored: true,",
  "    ad: { id: ad.id, headline: ad.headline, body: ad.body, cta_text: ad.cta_text, destination_url: ad.destination_url },",
  "  }));",
  "}).listen(Number(process.env.PORT) || 3000);",
].join("\n");

// Day 15 Part 4: impression and click endpoints. Example values only: the tokens and references below are NOT real.
const IMPRESSION_REQUEST_EXAMPLE = [
  "{",
  "  \"token\": \"bt1.EXAMPLE-PAYLOAD.EXAMPLE-SIGNATURE\",",
  "  \"event\": \"impression\"",
  "}",
].join("\n");

const IMPRESSION_CURL_EXAMPLE = [
  "curl -i -X POST \"https://YOUR-BLISSCCO-API-HOST/api/v1/ads/impression\" \\",
  "  -H \"Content-Type: application/json\" \\",
  "  -d '{\"token\":\"bt1.EXAMPLE-PAYLOAD.EXAMPLE-SIGNATURE\",\"event\":\"impression\"}'",
].join("\n");

const IMPRESSION_RECORDED_EXAMPLE = [
  "{ \"ok\": true, \"status\": \"recorded\" }",
].join("\n");

const IMPRESSION_DUPLICATE_EXAMPLE = [
  "{ \"ok\": true, \"status\": \"duplicate\" }",
].join("\n");

const CLICK_CURL_EXAMPLE = [
  '# Format only. The ref value is a placeholder: use the tracking.click_ref from YOUR OWN match response, URL-encoded, never a value you made up.',
  'curl -i "https://YOUR-BLISSCCO-API-HOST/api/v1/ads/click?ref=bc1.EXAMPLE-PAYLOAD.EXAMPLE-SIGNATURE"',
].join("\n");

const CLICK_RESPONSE_EXAMPLE = [
  "HTTP/1.1 302 Found",
  "Location: https://example.com/gaming-laptops",
  "Cache-Control: no-store",
  "Referrer-Policy: no-referrer",
].join("\n");

const TRACKED_SERVER_EXAMPLE = [
  '// Runs on YOUR backend only. Never import this file into browser or frontend code.',
  'type SponsoredAd = {',
  '  id: string;',
  '  headline: string;',
  '  body: string;',
  '  cta_text: string | null;',
  '  destination_url: string;',
  '};',
  'type Tracking = { token: string; expires_at: string; events: string[]; click_ref?: string }; // token = bt1 (impressions), click_ref = bc1 (clicks)',
  'type TrackedAd = { ad: SponsoredAd; tracking: Tracking | null };',
  'export type ImpressionOutcome = "recorded" | "duplicate" | "dropped" | "failed";',
  '',
  'const API_BASE = process.env.BLISSCCO_API_BASE_URL; // given to you by Blisscco',
  'const API_KEY = process.env.BLISSCCO_PUBLISHER_API_KEY; // secret, kept out of git',
  'const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));',
  '',
  '// A click reference is "bc1." + two base64url parts. A tracking token ("bt1.") never passes this check.',
  "const CLICK_REF_SHAPE = /^bc1\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$/;",
  '',
  '// STEP 1: a SERVE. Ask for an ad and opt in to tracking (token for impressions, click_ref for clicks). Getting an ad is NOT an impression yet.',
  'export async function getTrackedAd(',
  '  topic: string, // a topic slug that YOUR code chose, never user text',
  '  idempotencyKey: string = crypto.randomUUID(), // one new key per placement; reuse it only when YOU retry that placement',
  '): Promise<TrackedAd | null> {',
  '  if (!API_BASE || !API_KEY) return null; // not configured: just run without ads',
  '  for (let attempt = 0; attempt < 2; attempt++) {',
  '    try {',
  '      const res = await fetch(API_BASE + "/api/v1/ads/match", {',
  '        method: "POST",',
  '        headers: {',
  '          Authorization: "Bearer " + API_KEY,',
  '          "Content-Type": "application/json",',
  '          "Idempotency-Key": idempotencyKey,',
  '          "X-Blisscco-Tracking": "1", // opt in: a successful match may now carry tracking.token (bt1) and tracking.click_ref (bc1)',
  '        },',
  '        body: JSON.stringify({ topic: topic }),',
  '        signal: AbortSignal.timeout(2000),',
  '      });',
  '      if (res.ok) {',
  '        const data = (await res.json()) as { fill?: boolean; sponsored?: boolean; ad?: SponsoredAd; tracking?: Tracking };',
  '        if (data.fill !== true || data.sponsored !== true || !data.ad) return null;',
  '        return { ad: data.ad, tracking: data.tracking ?? null }; // a missing tracking object (or a missing click_ref) is normal: show the ad anyway',
  '      }',
  '      if (res.status < 500) return null; // 400, 401, 429 and the rest: do not retry here',
  '    } catch {',
  '      // network error or timeout: fall through to ONE retry with the SAME Idempotency-Key',
  '    }',
  '    if (attempt === 0) await sleep(1000 + Math.random() * 500);',
  '  }',
  '  return null;',
  '}',
  '',
  '// STEP 2: an IMPRESSION. Call this only after the ad was really displayed to a person, never just because you received it.',
  '// There is no API key here: the token is the permission. Send it from your server (the endpoint has no CORS).',
  'export async function reportImpression(tracking: Tracking | null): Promise<ImpressionOutcome> {',
  '  if (!API_BASE || !tracking) return "dropped"; // no token: there is nothing to report',
  '  if (Date.now() >= Date.parse(tracking.expires_at)) return "dropped"; // expired: the API would answer 401',
  '  for (let attempt = 0; attempt < 3; attempt++) {',
  '    try {',
  '      const res = await fetch(API_BASE + "/api/v1/ads/impression", {',
  '        method: "POST",',
  '        headers: { "Content-Type": "application/json" }, // no Authorization header, no Idempotency-Key',
  '        body: JSON.stringify({ token: tracking.token, event: "impression" }),',
  '        signal: AbortSignal.timeout(2000),',
  '      });',
  '      if (res.ok) {',
  '        const data = (await res.json()) as { status?: string };',
  '        if (data.status === "recorded" || data.status === "duplicate") return data.status; // both mean: done',
  '        return "failed";',
  '      }',
  '      if (res.status === 429) return "failed"; // rate limited: stop, wait for Retry-After, do not loop',
  '      if (res.status < 500) return "dropped"; // 400, 401, 413, 415: retrying cannot help, drop the token',
  '    } catch {',
  '      // network error or timeout: retrying is safe, because one serve can only ever count one impression',
  '    }',
  '    if (attempt < 2) await sleep(1000 + Math.random() * 500);',
  '  }',
  '  return "failed"; // still failing: carry on, the ad was already shown',
  '}',
  '',
  '// STEP 3: a CLICK link. Build it from the returned tracking.click_ref (bc1), NEVER from ad.destination_url.',
  "// The person's browser opens this link (GET, no API key). The click endpoint checks the reference, takes the destination from",
  "// Blisscco's own database (never from the query) and redirects there, so a click is recorded only on this path.",
  '// null = no link (no click_ref, not a bc1 reference, expired, or not configured): show the ad without a link.',
  'export function buildClickUrl(tracking: Tracking | null): string | null {',
  '  if (!API_BASE || !tracking || typeof tracking.click_ref !== "string") return null;',
  '  if (tracking.click_ref.length > 512 || !CLICK_REF_SHAPE.test(tracking.click_ref)) return null; // the bt1 token is not a click reference',
  '  if (Date.now() >= Date.parse(tracking.expires_at)) return null; // the click_ref expires at the same time as the token',
  "  return API_BASE.replace(/\\/+$/, \"\") + \"/api/v1/ads/click?ref=\" + encodeURIComponent(tracking.click_ref);",
  '}',
].join("\n");

const RENDER_EXAMPLE = [
  '// Safe rendering of the five public ad fields. It holds no secret, so it may run on your server or in your frontend.',
  'type PublicAd = {',
  '  id: string;',
  '  headline: string;',
  '  body: string;',
  '  cta_text: string | null;',
  '  destination_url: string;',
  '};',
  '',
  'const escapeHtml = (text: string) =>',
  '  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");',
  '',
  '// clickUrl comes from buildClickUrl() (section 4d): your configured API base URL + "/api/v1/ads/click?ref=" + the returned click_ref.',
  "// It is NEVER built from ad.destination_url. The click endpoint redirects to the destination it verified in Blisscco's own database.",
  '// A link made straight from destination_url is NOT reported to Blisscco and skips that check, so this example never makes one.',
  "const CLICK_LINK = /^https:\\/\\/[^\\s?#]+\\/api\\/v1\\/ads\\/click\\?ref=bc1\\.[A-Za-z0-9_.%-]+$/;",
  '',
  "// Render this in its own box AFTER the assistant's answer. The Sponsored label is always there and is plain text.",
  'export function renderSponsoredAd(ad: PublicAd, clickUrl: string | null): string {',
  '  // Only a Blisscco click link becomes clickable. No click_ref (so clickUrl is null) = the ad is shown without a link.',
  '  const action =',
  '    clickUrl !== null && CLICK_LINK.test(clickUrl)',
  "      ? \"<a href=\\\"\" + escapeHtml(clickUrl) + \"\\\" rel=\\\"sponsored noopener noreferrer\\\">\" + escapeHtml(ad.cta_text ?? \"Learn more\") + \"</a>\"",
  '      : "";',
  '  return (',
  "    \"<aside aria-label=\\\"Sponsored\\\"><span>Sponsored</span>\" +",
  '    "<p><strong>" + escapeHtml(ad.headline) + "</strong></p>" +',
  '    "<p>" + escapeHtml(ad.body) + "</p>" + action + "</aside>"',
  '  );',
  '}',
].join("\n");

// Day 20 Part 4: quickstart samples. They match examples/publisher-node/src/client.ts and examples/publisher-nextjs/.
const NODE_QUICKSTART_EXAMPLE = [
  '// Runs on YOUR backend only. Copy examples/publisher-node/src/client.ts and types.ts next to this file.',
  'import { randomUUID } from "node:crypto";',
  'import { BlissccoClient } from "./client";',
  '',
  '// Server environment variables. Never give them a public prefix. Built on first use, so a missing or malformed',
  '// value is caught below as "no ad" instead of stopping your server at start-up.',
  'let client: BlissccoClient | null = null;',
  'function getClient(): BlissccoClient {',
  '  client ??= new BlissccoClient({',
  '    baseUrl: process.env.BLISSCCO_API_BASE_URL ?? "", // given to you by Blisscco',
  '    apiKey: process.env.BLISSCCO_PUBLISHER_API_KEY ?? "", // secret, kept out of git',
  '    timeoutMs: 3000,',
  '    retry: { maxRetries: 2, baseDelayMs: 2000, maxDelayMs: 5000 }, // network errors, 429 and 503 only; waits are jittered, 1 second at least',
  '  });',
  '  return client;',
  '}',
  '',
  '// topic: a supported slug that YOUR code chose, never conversation text.',
  '// placementKey: one new random value per ad placement. The client reuses it for its own retries, and so should you.',
  'export async function sponsoredAdFor(topic: string, placementKey: string = randomUUID()) {',
  '  try {',
  '    const result = await getClient().match({ topic: topic }, { idempotencyKey: placementKey });',
  '    return result.fill ? result.ad : null; // no-fill is normal: show nothing',
  '  } catch (err) {',
  '    // 400, 401, 413 and 415 throw BlissccoApiError (fix the request). A temporary failure that used up its retries',
  '    // throws BlissccoRetryExhaustedError. Either way: no ad. Log the class name only, never the message or the key.',
  '    console.error("[blisscco] ad request failed:", err instanceof Error ? err.name : "unknown");',
  '    return null;',
  '  }',
  '}',
].join("\n");

const NEXTJS_ENV_EXAMPLE = [
  '# .env.local: server only, never commit it. Neither name gets a NEXT_PUBLIC_ prefix.',
  'BLISSCCO_PUBLISHER_API_KEY=paste-your-key-from-the-publisher-page',
  'BLISSCCO_API_BASE_URL=https://YOUR-BLISSCCO-API-HOST',
].join("\n");

const NEXTJS_USAGE_EXAMPLE = [
  '// Any page or component in your app. The topic is a fixed literal that YOUR code chose.',
  'import SponsoredAd from "../components/SponsoredAd";',
  '',
  'export default function Page() {',
  '  return (',
  '    <main>',
  "      {/* the assistant's own answer goes here, first */}",
  '      <SponsoredAd topic="gaming" />',
  '    </main>',
  '  );',
  '}',
].join("\n");

type Row = { status: string; body: string; meaning: string; action: string };

const IMPRESSION_ERRORS: Row[] = [
  { status: "200", body: "ok:true + status:recorded", meaning: "This was the first impression reported for that ad delivery, and it is now recorded.", action: "Nothing. Do not send it again." },
  { status: "200", body: "ok:true + status:duplicate", meaning: "An impression for that ad delivery was already recorded (a retry, a replay or a double callback). Nothing new was counted.", action: "Treat it as success. Do not send it again." },
  { status: "400", body: "invalid_request + reason", meaning: "The body broke the contract: reason is invalid_json, invalid_body, unknown_field (only token and event are allowed), invalid_token (empty or over 512 characters), invalid_event (it must be exactly impression) or unreadable_body.", action: "Do not retry. Fix the request." },
  { status: "401", body: "unauthorized", meaning: "The token was not accepted: edited, expired, not issued for your account, for an unknown ad delivery, or for one that is too old. All of these look identical on purpose.", action: "Do not retry. Drop that token." },
  { status: "405", body: "(empty)", meaning: "Any method other than POST. This answer comes from the hosting platform, so it has no JSON body.", action: "Do not retry. Use POST." },
  { status: "413", body: "payload_too_large", meaning: "The body is over 1024 bytes.", action: "Do not retry. Send only token and event." },
  { status: "415", body: "unsupported_media_type", meaning: "Content-Type is not application/json.", action: "Do not retry. Fix the header." },
  { status: "429", body: "rate_limited", meaning: "Too many requests, or too many rejected tokens, from your IP address in the current minute. The response carries Retry-After: 60.", action: "Stop sending until Retry-After has passed, then send once." },
  { status: "503", body: "unavailable", meaning: "Temporary failure on Blisscco's side. Nothing was recorded.", action: "Retry up to twice, after 1 second or more with jitter. Sending the same token again is safe." },
];

const CLICK_ERRORS: Row[] = [
  { status: "302", body: "(empty) + Location", meaning: "The person is sent to the ad's destination. This happens for the first click, for a repeat click, and when the click was not counted. The response does not say which.", action: "Nothing. The browser follows it." },
  { status: "204", body: "(empty)", meaning: "A browser prefetch or prerender asked for a correctly formed click link (exactly one ref parameter). Nothing was counted and nobody was redirected. A prefetch of a malformed link is answered 400, like any other request.", action: "Nothing." },
  { status: "400", body: "invalid_request + reason", meaning: "The query broke the contract: reason is missing_ref, unexpected_parameter (only ref is allowed, once) or invalid_ref (empty or over 512 characters).", action: "Do not retry. Fix the link." },
  { status: "404", body: "not_found", meaning: "The reference was not accepted: edited, expired, for an unknown ad delivery, or for an ad that can no longer be clicked. All of these look identical on purpose.", action: "Do not retry. Send the person to nothing, or to a page of your own." },
  { status: "405", body: "method_not_allowed + Allow: GET", meaning: "Any method other than GET, including HEAD and POST, so a crawler cannot count a click.", action: "Do not retry. Use GET." },
  { status: "429", body: "rate_limited", meaning: "Too many requests, or too many malformed click links (400) or rejected references (404), from one IP address in the current minute. The response carries Retry-After: 60.", action: "Wait for Retry-After, then try again." },
  { status: "503", body: "unavailable", meaning: "Temporary failure on Blisscco's side. The person is not redirected.", action: "Trying the same link again later is safe." },
];

const TROUBLESHOOTING: Row[] = [
  { status: "400", body: "invalid_request + reason", meaning: "Match reasons: invalid_json, invalid_body, unknown_field (any field other than topic, fallback_topics and exclude_ad_ids, for example prompt, messages or user_id), invalid_topic (not 1 to 50 of a-z, 0-9 and underscore, or a bad fallback topic), invalid_exclude_ad_ids (more than 20, or not UUIDs), invalid_idempotency_key (not 8 to 64 letters, digits, _ or -) and invalid_tracking_header (X-Blisscco-Tracking is not exactly 1). Your own Next.js route also answers 400 invalid_topic for a topic outside its allowlist, and unknown_field for anything except topic.", action: "Do not retry. Read reason, fix the request and send only a topic." },
  { status: "401", body: "unauthorized", meaning: "The key was not accepted: missing, not sent as Bearer, a space and the key, edited, revoked, expired, or the publisher account is not Approved. On the impression endpoint it means the token was not accepted (section 4c).", action: "Do not retry. Check that the server really loads BLISSCCO_PUBLISHER_API_KEY (restart or redeploy after changing it), then check the key and the account status on the Publisher page, and rotate the key if needed (section 2). Behind the Next.js example you only see 503, so reproduce with cURL (section 3)." },
  { status: "413", body: "payload_too_large", meaning: "The match body is over 2048 bytes (impression: 1024 bytes). The usual cause is conversation text or a long list in the body. Your own Next.js route has a smaller limit of 1024 characters.", action: "Do not retry. Send only the topic. Never forward conversation text." },
  { status: "415", body: "unsupported_media_type", meaning: "Content-Type is not application/json.", action: "Do not retry. Send Content-Type: application/json, also on the browser call to your own route." },
  { status: "429", body: "rate_limited + Retry-After: 60", meaning: "Too many requests for this key in the current minute, or too many wrong keys from your IP address. The Node client does not wait it out: 60 seconds is above its default 5 second cap, so it stops at once and throws BlissccoRetryExhaustedError (last status 429).", action: "Stop asking for ads for that long, then send one request. Do not loop. If it keeps happening with a correct key, slow down." },
  { status: "503", body: "fill:false + error:unavailable", meaning: "Temporary failure on Blisscco's side. The Next.js example also returns this 503 to the browser for ANY failure behind it: a missing or malformed key or base URL (BlissccoConfigError in your server log), a 401 or a 429.", action: "Retry at most twice, after 1 second or more, with the SAME Idempotency-Key (the Node client does this by itself). If it never clears, check the error class name in your server log and your two environment variables, then reproduce with cURL." },
  { status: "200 no-fill", body: "fill:false", meaning: "Not an error, and the reason is never disclosed: an unsupported or sensitive topic, no eligible approved ad for that category, or an ad that could not be recorded. The Next.js example also returns fill:false when the ad's destination is not a plain https link.", action: "Show nothing. Try another supported topic, and ask Blisscco whether your test setup has an eligible ad for it (section 9). Do not retry in a loop." },
  { status: "200 without tracking", body: "no tracking object, or tracking without click_ref", meaning: "You did not send X-Blisscco-Tracking: 1 (Node client: pass tracking: true in the match options; the Next.js example never opts in), the response was a no-fill or an error, tracking is switched off at Blisscco, a retry came after expires_at, or Blisscco could not sign a click_ref.", action: "Normal. Show the ad with the Sponsored label, report no impression and build no Blisscco click link. Never invent a token or click_ref, and never use destination_url as a stand-in (section 4a)." },
  { status: "401 / 404", body: "unauthorized (impression) / not_found (click)", meaning: "The token or click_ref is past its expires_at (counted from the serve: one hour by default, never more than 24 hours), or it was edited, or it was never valid. All of these look the same on purpose. A match retry with the same Idempotency-Key after expires_at returns the ad but no tracking.", action: "Do not retry and do not try to refresh it: drop it. Report impressions soon after display, and check expires_at before sending. A new ad request with a NEW Idempotency-Key is a new serve and is charged as a new serve." },
];

function StatusTable({ caption, rows }: { caption: string; rows: Row[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-wide text-mist/55">
            <th scope="col" className="py-2 pr-3 font-medium">Status</th>
            <th scope="col" className="py-2 pr-3 font-medium">Body</th>
            <th scope="col" className="py-2 pr-3 font-medium">Meaning</th>
            <th scope="col" className="py-2 font-medium">What to do</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e, i) => (
            <tr key={e.status + e.body + i} className="border-b border-line/60 align-top text-mist/75">
              <td className="py-2 pr-3 font-mono text-xs">{e.status}</td>
              <td className="py-2 pr-3 font-mono text-xs">{e.body}</td>
              <td className="py-2 pr-3">{e.meaning}</td>
              <td className="py-2">{e.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ERRORS: Array<{ status: string; body: string; meaning: string; action: string }> = [
  { status: "400", body: "invalid_request + reason", meaning: "The request broke the contract (bad JSON, unknown field, bad topic, bad exclude_ad_ids, an Idempotency-Key that is not 8 to 64 letters, digits, _ or - (reason invalid_idempotency_key), or an X-Blisscco-Tracking header whose value is not exactly 1 (reason invalid_tracking_header)).", action: "Do not retry. Fix the request." },
  { status: "401", body: "unauthorized", meaning: "Key missing, malformed, unknown, revoked or expired, or the publisher account is not active (pending or suspended). All of these look identical on purpose.", action: "Do not retry. Check the key and the account status on the Publisher page, then create a new key or contact Blisscco." },
  { status: "405", body: "(empty)", meaning: "Any method other than POST. This answer comes from the hosting platform, so it has no JSON body.", action: "Do not retry. Use POST." },
  { status: "413", body: "payload_too_large", meaning: "Body is over 2048 bytes.", action: "Do not retry. Send only topic, fallback_topics and exclude_ad_ids." },
  { status: "415", body: "unsupported_media_type", meaning: "Content-Type is not application/json.", action: "Do not retry. Fix the header." },
  { status: "429", body: "rate_limited", meaning: "Too many requests for this key in the current minute, or too many wrong keys from your IP address. The response carries Retry-After: 60.", action: "Stop asking for ads until Retry-After has passed, then retry once. If it keeps happening with a correct key, you are over your limit: slow down." },
  { status: "503 (or any 5xx)", body: "fill:false + error:unavailable", meaning: "Temporary failure on Blisscco's side.", action: "Retry at most once or twice, after 1 second or more with jitter, and send the SAME Idempotency-Key. Then continue without an ad." },
];

export default async function PublisherGuidePage() {
  const account = await requireAccount();
  // Sirf publisher /dashboard/publisher khol sakta hai; baaki roles ko wahan se Overview par bhej diya jata hai.
  const isPublisher = account.role === "publisher";
  const backHref = isPublisher ? "/dashboard/publisher" : "/dashboard";
  const backLabel = isPublisher ? "Back to publisher dashboard" : "Back to overview";
  return (
    <>
      <p className="mb-3 text-sm">
        <Link href={backHref} className="rounded text-aqua underline-offset-2 hover:underline">
          &larr; {backLabel}
        </Link>
      </p>

      <PageHeader
        title="Integration Guide"
        description="How a publisher's own server can request a clearly labelled, topic-matched sponsored ad from the versioned Blisscco Ad API, and report that the ad was shown."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Status">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">Limited, manual access</Badge>
            <Badge tone="violet">Not ready for production use</Badge>
          </div>
          <p className="mt-3 text-sm text-mist/75">
            The API exists, but access is limited and accounts are approved by hand. Once your publisher account is
            approved, you create your own keys on the Publisher page (not on this page). Nothing on this page connects to
            a server. Ads can only appear inside a product whose owner has integrated and authorised the Blisscco API.
            Blisscco has no integration with ChatGPT or any other third-party chatbot. The limitations at the end of this
            guide still apply, so do not roll this out to real users yet.
          </p>
        </Panel>

        <Panel title="Integration steps">
          <IntegrationSteps />
        </Panel>
      </div>

      <div className="mt-6 grid gap-4">
        <Panel
          title="Pilot quickstart: Node.js and Next.js"
          note="Samples from the Blisscco repository, not a published package. Their automated tests use a mocked Blisscco API. No third-party integration has been tested."
        >
          <p className="text-sm text-mist/75">
            For a first pilot, start from <code>examples/publisher-node/</code> (a dependency-free server client, Node 18 or newer) or{" "}
            <code>examples/publisher-nextjs/</code> (a server route plus a small component). Everything runs on your own server; the
            browser never sees the key. Sections 1 to 10 below remain the full contract.
          </p>
          <p className="mt-3 text-sm font-medium">Before you start</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-mist/75">
            <li>Your publisher account is Approved and you created a key on the Publisher page (section 2).</li>
            <li>You have the API host from Blisscco. This guide does not publish one (section 3).</li>
            <li>Both samples are server-side. Use a test key and the test setup Blisscco confirms (section 9).</li>
          </ul>

          <p className="mt-4 text-sm font-medium">Node.js: examples/publisher-node/</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-mist/75">
            <li>Copy <code>src/client.ts</code> and <code>src/types.ts</code> into your backend.</li>
            <li>Set <code>BLISSCCO_API_BASE_URL</code> and <code>BLISSCCO_PUBLISHER_API_KEY</code> in your server environment.</li>
            <li>Call <code>client.match()</code> once per ad placement, as below.</li>
          </ol>
          <div className="mt-3">
            <CodeBlock code={NODE_QUICKSTART_EXAMPLE} label="Node.js quickstart (server-side TypeScript)" />
          </div>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-mist/75">
            <li><code>match()</code> resolves on a 200 (an ad or a no-fill) and throws on everything else.</li>
            <li>It retries only network errors, timeouts, 429 and 503, up to <code>maxRetries</code> times, with the same <code>Idempotency-Key</code> and body. 400, 401, 413 and 415 are never retried.</li>
            <li>The client&apos;s default first wait is about 100 to 200 ms. The sample above sets <code>baseDelayMs: 2000</code>, so every wait is at least 1 second, as section 5 asks.</li>
            <li>It does not report impressions or clicks. Pass <code>{"{ tracking: true }"}</code> to <code>match()</code> to opt in to tracking, then follow sections 4a to 4d.</li>
            <li><code>BlissccoClient.fromEnv()</code> reads <code>BLISSCCO_BASE_URL</code> and <code>BLISSCCO_API_KEY</code>, which are different names from the ones in this guide. Use the constructor as shown, or set the names <code>fromEnv()</code> reads.</li>
          </ul>

          <p className="mt-4 text-sm font-medium">Next.js: examples/publisher-nextjs/</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-mist/75">
            <li>Copy <code>app/api/blisscco-ad/route.ts</code>, <code>components/SponsoredAd.tsx</code> and <code>lib/safe-url.ts</code> into your app, plus the two Node client files above. Fix the client import path in <code>route.ts</code>.</li>
            <li>Create <code>.env.local</code> from <code>.env.example</code> with your own values. On your host, add the same two variables without a public prefix and redeploy.</li>
            <li>Render the component after your assistant&apos;s answer.</li>
          </ol>
          <div className="mt-3 grid gap-3">
            <CodeBlock code={NEXTJS_ENV_EXAMPLE} label="Environment variables (placeholders, not a real key)" />
            <CodeBlock code={NEXTJS_USAGE_EXAMPLE} label="Using the component" />
          </div>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-mist/75">
            <li>The browser calls your own <code>POST /api/blisscco-ad</code> with only <code>{'{"topic":"gaming"}'}</code>. Your route calls Blisscco with the key. The key is read in that route and nowhere else.</li>
            <li>The route&apos;s allowlist holds the nine supported topics. Shorten it to the ones you really use. Any other topic gets a 400 from your own route.</li>
            <li>Every failure behind the route (a missing key, 401, 429, 5xx, a timeout) reaches the browser as the same 503, and the component then shows nothing. See the troubleshooting table (section 5a).</li>
            <li>Each browser call makes a new <code>Idempotency-Key</code>, so a second call to your route is a new placement and a new serve.</li>
            <li>The sample does not opt in to tracking, so it reports no impressions or clicks, and its link goes straight to the advertiser&apos;s https address. That differs from section 6. Use it to check fill and layout only, and follow sections 4a to 4d for counted impressions and clicks.</li>
          </ul>

          <p className="mt-4 text-sm font-medium">Rules for every pilot integration</p>
          <ul className="mt-1 list-disc space-y-2 pl-5 text-sm text-mist/75">
            <li><strong>Key storage:</strong> the API key lives only in your server&apos;s environment variables or secret manager. Never put it in browser code, a mobile app, a variable with a public prefix such as <code>NEXT_PUBLIC_</code>, git, logs, tickets or chat. If it may have leaked, revoke it on the Publisher page first (section 2).</li>
            <li><strong>Idempotency-Key reuse:</strong> use one new random key per ad placement (a UUID works; 8 to 64 letters, digits, <code>_</code> or <code>-</code>). When you retry that same placement after a timeout, a 429 or a 5xx, send the same key, so no second serve is counted. A new placement gets a new key, and a key never contains a user id or text.</li>
            <li><strong>Sponsored disclosure:</strong> show the visible word <strong>Sponsored</strong> as text on every ad, in its own box after the assistant&apos;s answer, and never present it as the chatbot&apos;s own words (section 6). Show nothing at all for a no-fill.</li>
            <li><strong>Topic categories:</strong> request only these supported topics, <code>developer_tools</code>, <code>education</code>, <code>finance</code>, <code>fitness</code>, <code>food</code>, <code>gaming</code>, <code>lifestyle</code>, <code>technology</code>, <code>travel</code>. Your code picks one from a fixed list. Sensitive topics never return an ad (section 1).</li>
            <li><strong>No raw conversations:</strong> never forward a chatbot conversation to Blisscco: no user message, assistant answer, prompt, transcript, summary or keyword list, and no user id, email or session id. The only signal is the topic slug your code chose. The API rejects any other field with a 400.</li>
          </ul>
        </Panel>

        <Panel title="1. What the API does">
          <p className="text-sm text-mist/75">
            Your server sends one small request: a topic such as <code>gaming</code>. Blisscco replies with at most one
            sponsored ad whose campaign category matches that topic, or with a no-fill response when nothing eligible
            exists. Matching is by category only. Blisscco does not read conversations, does not build a profile of the
            person, and does not send anything to an external AI service. Your server decides the topic; the API
            rejects any prompt, message, user identifier or other extra field.
          </p>
          <p className="mt-3 text-sm text-mist/75">
            Three endpoints exist: <code>POST /api/v1/ads/match</code> (request an ad, section 3),{" "}
            <code>POST /api/v1/ads/impression</code> (report that a person was shown that ad, section 4c) and{" "}
            <code>GET /api/v1/ads/click</code> (the click redirect, section 4d). Getting an ad, showing it and clicking it are three
            different events (section 4b).
          </p>
          <p className="mt-3 text-sm text-mist/75">
            Supported topics: <code>developer_tools</code>, <code>education</code>, <code>finance</code>,{" "}
            <code>fitness</code>, <code>food</code>, <code>gaming</code>, <code>lifestyle</code>,{" "}
            <code>technology</code>, <code>travel</code>. A few aliases such as <code>games</code> and <code>tech</code>{" "}
            also work. Sensitive topics (for example health, religion, politics) never return an ad, and you should not
            request ads in sensitive conversations in the first place.
          </p>
          <p className="mt-3 text-sm font-medium">Privacy-safe topic signals</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-mist/75">
            <li>The topic is the only contextual signal the API accepts. It is one coarse category slug, never a sentence, a keyword list or a summary of what the person said.</li>
            <li>Choose the topic in your own code, from a fixed list you control (for example the product area or placement the person is in). Do not copy it from the message text, and do not build it from several messages or from a history of the person.</li>
            <li>Send nothing that identifies a person: no user id, email, IP address, device id, session id, conversation id or location. The API rejects any such extra field with a 400.</li>
            <li>The topic must be lowercase letters, digits and underscores, for example <code>developer_tools</code>. <code>Gaming</code> or <code>video games</code> (capital letter, space) returns 400 <code>invalid_topic</code>.</li>
            <li>A well-formed topic that is not supported, or is sensitive, is not an error: it returns the normal no-fill response, so you cannot use the API to find out why.</li>
            <li>Blisscco stores the topic with each served ad for counting. It is a category, not a profile, and it should never be tied to a person on your side either.</li>
          </ul>
        </Panel>

        <Panel title="2. Approval, API keys, revocation and rotation">
          <p className="text-sm font-medium">Approval process</p>
          <ol className="mt-1 list-decimal space-y-2 pl-5 text-sm text-mist/75">
            <li>Sign up with the AI Publisher account type and save your platform details on the Publisher page. The account starts as <strong>Waiting for approval</strong>.</li>
            <li>Blisscco reviews each account by hand and sets it to <strong>Approved</strong> or <strong>Suspended</strong>. The Publisher page shows the current status. This guide does not promise a review time.</li>
            <li>Until the account is Approved, keys cannot be created, and any key that already exists is refused with 401. If an Approved account is later Suspended, all of its keys stop working at once; they work again only if the account is reinstated and the keys were not revoked or expired.</li>
          </ol>

          <p className="mt-4 text-sm font-medium">Key generation</p>
          <ol className="mt-1 list-decimal space-y-2 pl-5 text-sm text-mist/75">
            <li>Once approved, create a key on the Publisher page. You can give it a name (up to 60 characters) and choose an expiry: 30 days, 90 days (the default), 1 year or no expiry.</li>
            <li>Blisscco generates the key on its server from 32 random bytes. It looks like <code>blc_live_</code> followed by 64 lowercase hex characters. The key is shown once; only a one-way hash is stored, so a lost key cannot be recovered or shown again. Create a new one and revoke the old one.</li>
            <li>Store the key straight in your server&apos;s secret manager or environment variables. Do not paste it into chat, tickets, screenshots or git.</li>
            <li>A publisher can hold up to 5 active keys, and creating keys may also be limited per day. Use a separate, named key for each server or environment so one can be revoked without touching the others.</li>
          </ol>
          <p className="mt-3 text-xs text-mist/55">This guide never shows a real key, and the examples use environment variables instead.</p>

          <p className="mt-4 text-sm font-medium">Revocation</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-mist/75">
            <li>Revoke a key on the Publisher page (Revoke, then confirm). It stops working immediately: the next request with it returns 401. Revoking cannot be undone.</li>
            <li>You can revoke at any time, including while the account is suspended. If a key may have leaked, revoke it first and create a replacement afterwards.</li>
            <li>An expired key behaves like a revoked one (401). The Publisher page marks it Expired.</li>
          </ul>

          <p className="mt-4 text-sm font-medium">Rotation without downtime</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-mist/75">
            <li>On the Publisher page choose Rotate on the key and pick an expiry. This creates a new key with the same name. The old key keeps working.</li>
            <li>Copy the new key into your server&apos;s secret manager and deploy.</li>
            <li>Confirm requests succeed with the new key (the Publisher page shows when each key was last used).</li>
            <li>Revoke the old key.</li>
          </ol>
          <p className="mt-2 text-xs text-mist/55">Rotating counts towards the 5 active keys, so revoke an old key first if you already have 5. Rotate before an expiry date, not after.</p>
        </Panel>

        <Panel title="3. Making a request" note="Server to server only. Do not call this from a browser.">
          <p className="text-sm text-mist/75">
            <code>POST /api/v1/ads/match</code> on the API host Blisscco gives you. This guide does not publish a host
            name, so the examples use a placeholder.
          </p>
          <p className="mt-3 text-sm font-medium">Required headers</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-mist/75">
            <li><code>Authorization: Bearer YOUR_PUBLISHER_API_KEY</code></li>
            <li><code>Content-Type: application/json</code> (optionally with <code>charset=utf-8</code>)</li>
          </ul>
          <p className="mt-3 text-sm font-medium">Optional header</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-mist/75">
            <li><code>Idempotency-Key</code>: a random value of 8 to 64 letters, digits, <code>_</code> or <code>-</code>, new for each ad placement. Recommended; see section 5.</li>
          </ul>
          <p className="mt-3 text-sm font-medium">JSON body</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-mist/75">
            <li><code>topic</code> (required): lowercase slug, 1 to 50 characters of a-z, 0-9 and underscore. Not free text.</li>
            <li><code>fallback_topics</code> (optional): up to 2 more topic slugs, in your order of preference, in the same format as <code>topic</code>. They are tried only if there is no eligible ad for <code>topic</code>. Nothing is guessed from page text. If <code>topic</code> is a sensitive subject (for example health, religion or politics) no ad is served and the fallbacks are not used.</li>
            <li><code>exclude_ad_ids</code> (optional): up to 20 ad ids you already showed, as UUIDs. This is best-effort: if there is no other eligible ad, the same ad can come back.</li>
            <li>No other field is accepted. The body must be 2048 bytes or smaller.</li>
            <li>The key is not a body field: it goes only in the <code>Authorization</code> header, and only the format <code>Bearer</code> + a space + the key is accepted.</li>
          </ul>
          <div className="mt-3 grid gap-3">
            <CodeBlock code={REQUEST_EXAMPLE} label="Request body" />
            <CodeBlock code={CURL_EXAMPLE} label="cURL example" />
          </div>
          <p className="mt-4 text-sm font-medium">Server-side TypeScript example</p>
          <p className="mt-1 text-sm text-mist/75">
            Reads the key from a server environment variable, has its own timeout, and returns <code>null</code> on any
            problem so your chatbot carries on without an ad.
          </p>
          <div className="mt-3">
            <CodeBlock code={SERVER_EXAMPLE} label="Server-side TypeScript example" />
          </div>
          <p className="mt-4 text-sm font-medium">Server-side JavaScript example (backend for your own frontend)</p>
          <p className="mt-1 text-sm text-mist/75">
            A dependency-free Node 18+ server. Your browser or app calls your own <code>/sponsored</code> route, never Blisscco. The
            topic comes from a fixed map in your code, and the browser gets only the five public ad fields.
          </p>
          <div className="mt-3">
            <CodeBlock code={PROXY_EXAMPLE} label="Server-side JavaScript example" />
          </div>
        </Panel>

        <Panel title="4. Responses">
          <p className="text-sm text-mist/75">
            Every response from the match and impression endpoints is JSON with <code>Cache-Control: no-store</code>. All v1 endpoints also send{" "}
            <code>X-Blisscco-Api-Version: 1</code>. The exceptions are the platform&apos;s empty 405 for a method other than POST (see
            section 5) and the click endpoint, whose 302 and 204 answers have no body (section 4d).
          </p>
          <p className="mt-3 text-sm font-medium">Successful match (200)</p>
          <div className="mt-2">
            <CodeBlock code={SUCCESS_EXAMPLE} label="Successful match response" />
          </div>
          <p className="mt-2 text-sm text-mist/75">
            <code>sponsored</code> is always <code>true</code> on a match. <code>cta_text</code> can be{" "}
            <code>null</code>. Only these five ad fields are returned.
          </p>
          <p className="mt-4 text-sm font-medium">No-fill (200)</p>
          <div className="mt-2">
            <CodeBlock code={NO_FILL_EXAMPLE} label="No-fill response" />
          </div>
          <p className="mt-2 text-sm text-mist/75">
            Always the same body, whatever the reason: unsupported or sensitive topic, no eligible ad, or an ad that
            could not be recorded. The reason is deliberately not disclosed.
          </p>
        </Panel>

        <Panel
          title="4a. Optional tracking: token and click_ref"
          note="Opt-in and backward compatible. token (bt1) is for impression reporting (section 4c); click_ref (bc1) is for the click redirect (section 4d). Receiving either reports nothing by itself."
        >
          <p className="text-sm text-mist/75">
            Add the header <code>X-Blisscco-Tracking: 1</code> to your server&apos;s request and a successful match also returns a{" "}
            <code>tracking</code> object next to the ad. Without that header the response is exactly the one in section 4, with the same
            five ad fields and no <code>tracking</code> object at all. Any other value for the header returns 400 with reason <code>invalid_tracking_header</code>.
          </p>
          <div className="mt-3 grid gap-3">
            <CodeBlock code={TRACKING_CURL_EXAMPLE} label="Request with tracking opt-in" />
            <CodeBlock code={TRACKING_SUCCESS_EXAMPLE} label="Successful match with tracking (example values, not a real token or click_ref)" />
          </div>
          <p className="mt-4 text-sm font-medium">Fields</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-mist/75">
            <li><code>token</code>: an opaque, signed string that refers to this one ad delivery. Treat it as a sealed value: do not decode, edit, shorten or guess it. It never contains your API key.</li>
            <li><code>expires_at</code>: ISO 8601 time in UTC. It is counted from the moment the ad was served (one hour by default, never more than 24 hours), and a retry never extends it. After it, the impression endpoint answers 401.</li>
            <li><code>events</code>: the event types the token is issued for: <code>impression</code> and <code>click</code>. In practice the token is accepted only by the impression endpoint. The click endpoint takes a different value, <code>click_ref</code>, and refuses the token.</li>
            <li><code>click_ref</code> (optional): an opaque, signed string that starts with <code>bc1.</code>. It refers to the same ad delivery and expires at the same time as the token. It is present only when Blisscco could sign it, so it can be missing even when <code>token</code> is present. It never contains your API key, your publisher id, the ad&apos;s id or a destination address. Treat it as a sealed value: do not decode, edit, shorten or guess it, and do not try to make a reference yourself. Receiving it does not mean anyone clicked.</li>
          </ul>
          <p className="mt-4 text-sm font-medium">Two different values for two different jobs</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <caption className="sr-only">tracking.token and tracking.click_ref compared</caption>
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-mist/55">
                  <th scope="col" className="py-2 pr-3 font-medium">Field</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Starts with</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Used for</th>
                  <th scope="col" className="py-2 font-medium">Sent to</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-line/60 align-top text-mist/75">
                  <td className="py-2 pr-3 font-mono text-xs">tracking.token</td>
                  <td className="py-2 pr-3 font-mono text-xs">bt1.</td>
                  <td className="py-2 pr-3">Impression reporting, after the ad was displayed.</td>
                  <td className="py-2">Your server calls <code>POST /api/v1/ads/impression</code> (section 4c).</td>
                </tr>
                <tr className="align-top text-mist/75">
                  <td className="py-2 pr-3 font-mono text-xs">tracking.click_ref</td>
                  <td className="py-2 pr-3 font-mono text-xs">bc1.</td>
                  <td className="py-2 pr-3">The click redirect and click recording.</td>
                  <td className="py-2">The person&apos;s browser opens <code>GET /api/v1/ads/click?ref=...</code> (section 4d).</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-sm text-mist/75">
            They are signed differently and are not interchangeable: the click endpoint refuses a <code>bt1</code> token, and the impression endpoint refuses a <code>bc1</code> reference.
          </p>
          <p className="mt-4 text-sm font-medium">What a token does and does not mean</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-mist/75">
            <li>Receiving a token or a <code>click_ref</code> does <strong>not</strong> mean the ad was shown, seen or clicked. A serve, an impression and a click are three different things (section 4b). The token is only permission to report an impression, and the <code>click_ref</code> is only what the click link needs.</li>
            <li>An impression exists only when the impression endpoint answers <code>recorded</code> or <code>duplicate</code>. Do not treat a token, or your own page load, as an impression, and do not report one for an ad nobody saw.</li>
            <li>The token is not your API key, but anyone who holds it can report an impression for that one ad delivery until it expires. Keep it with that ad only, and do not log it next to a person, session or conversation id. The <code>click_ref</code> is not your API key either, but anyone who holds it can open the click link for that one delivery until it expires, so keep it with that ad and out of your logs.</li>
            <li>Your API key, <code>Idempotency-Key</code> and any other credential stay on your server, and never go into a click link. The impression endpoint has no CORS, so report impressions from your server. If your frontend must tell you that the ad was displayed, let it call your own backend, which then holds the token and makes the call.</li>
          </ul>
          <p className="mt-4 text-sm font-medium">When <code>tracking</code> or <code>click_ref</code> is absent</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-mist/75">
            <li>You did not send the opt-in header.</li>
            <li>The response is a no-fill, an error (400, 401, 429, 503) or anything other than a successfully recorded ad. These never carry a token.</li>
            <li>Tracking is not switched on at Blisscco, or it was served before this feature existed.</li>
            <li>The ad delivery is already older than the tracking lifetime. For example, you retried an earlier request with the same <code>Idempotency-Key</code> after <code>expires_at</code> of the first response had passed. You still get the original ad, but without a <code>tracking</code> object (see Retries below).</li>
            <li>Blisscco could not sign a click reference for that delivery. Then <code>tracking</code> has only <code>token</code>, <code>expires_at</code> and <code>events</code>, with no <code>click_ref</code> key.</li>
            <li>Your code must treat a missing <code>tracking</code>, or a missing <code>click_ref</code>, as normal: show the ad, with no Blisscco click link and no impression report. Never replace a missing <code>click_ref</code> with your own link or with the token, never make up a tracking reference yourself, and never keep an old one to use after its <code>expires_at</code>.</li>
          </ul>
          <p className="mt-4 text-sm font-medium">Retries</p>
          <p className="mt-1 text-sm text-mist/75">
            Retrying with the same <code>Idempotency-Key</code> reuses the original ad and the original serve (the delivery). It does not create a second delivery or a second charge, and it does not create a second click. The ad is the one that was first served, as long as it is still eligible; if it is no longer eligible, the retry is a no-fill and Blisscco does not pick a different ad. Use a different key for every new placement, never the same key for two ads.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-mist/75">
            <li><strong>While the original tracking lifetime is still valid</strong> (before the <code>expires_at</code> of the first response), the retry returns the identical <code>tracking.token</code> and <code>tracking.click_ref</code>, with the same <code>expires_at</code>. The lifetime is counted from the original serve, so a retry never extends it.</li>
            <li><strong>At or after that <code>expires_at</code></strong>, the retry still returns the original ad, but with no <code>tracking</code> object, so there is no <code>tracking.token</code> and no <code>tracking.click_ref</code>. Blisscco does not issue a fresh token or click reference for an old serve.</li>
            <li>An expired credential can never be refreshed by replaying an old serve, and a retry is not a way to get new tracking. To get new credentials, make a new ad request with a new <code>Idempotency-Key</code>. That is a new serve and it is charged as a new serve.</li>
            <li>So a retry can return an ad without tracking. Handle that safely: show the ad with the Sponsored label, do not report an impression, and show no Blisscco click link. Do not generate your own tracking reference, and do not reuse a token or <code>click_ref</code> after its <code>expires_at</code>.</li>
          </ul>
        </Panel>

        <Panel
          title="4b. Serve, impression and click are three different events"
          note="Blisscco records each one separately. Never use one as proof of another."
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <caption className="sr-only">The difference between an ad serve, an impression and a click</caption>
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-mist/55">
                  <th scope="col" className="py-2 pr-3 font-medium">Event</th>
                  <th scope="col" className="py-2 pr-3 font-medium">What it means</th>
                  <th scope="col" className="py-2 pr-3 font-medium">How it is recorded</th>
                  <th scope="col" className="py-2 font-medium">Effect on spend</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-line/60 align-top text-mist/75">
                  <td className="py-2 pr-3 font-medium">Ad serve</td>
                  <td className="py-2 pr-3">Blisscco handed an ad to your server. Nobody has necessarily seen it.</td>
                  <td className="py-2 pr-3">Automatically, on a successful <code>POST /api/v1/ads/match</code>. A retry with the same <code>Idempotency-Key</code> is not a second serve.</td>
                  <td className="py-2">The only event that is charged.</td>
                </tr>
                <tr className="border-b border-line/60 align-top text-mist/75">
                  <td className="py-2 pr-3 font-medium">Impression</td>
                  <td className="py-2 pr-3">You report that the ad was displayed to a person.</td>
                  <td className="py-2 pr-3">Only when you send the tracking token to <code>POST /api/v1/ads/impression</code>. At most one per serve.</td>
                  <td className="py-2">None. It is not charged again.</td>
                </tr>
                <tr className="align-top text-mist/75">
                  <td className="py-2 pr-3 font-medium">Click</td>
                  <td className="py-2 pr-3">A person followed the Blisscco click link (built from <code>click_ref</code>) and was redirected to the destination.</td>
                  <td className="py-2 pr-3">Only through <code>GET /api/v1/ads/click</code>, and only if the impression was recorded first. At most one per serve.</td>
                  <td className="py-2">None. It is not charged again.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-mist/75">
            Impressions and clicks are reporting counts. They do not change spend, and they do not add earnings. Blisscco
            does not guess an impression from a serve, or a click from an impression.
          </p>
        </Panel>

        <Panel
          title="4c. Reporting an impression"
          note="POST /api/v1/ads/impression. Server to server. No API key: the tracking token is the permission."
        >
          <p className="text-sm text-mist/75">
            Send the <code>tracking.token</code> from a match response (section 4a) once the ad has really been displayed. The request has
            two things: <code>Content-Type: application/json</code> and a JSON body with exactly two fields, <code>token</code> and{" "}
            <code>event</code>, where <code>event</code> must be the word <code>impression</code>. Any other field, or the event{" "}
            <code>click</code> or <code>serve</code>, returns 400. Do not send your API key to this endpoint.
          </p>
          <div className="mt-3 grid gap-3">
            <CodeBlock code={IMPRESSION_REQUEST_EXAMPLE} label="Request body (example values, not a real token)" />
            <CodeBlock code={IMPRESSION_CURL_EXAMPLE} label="cURL example" />
            <CodeBlock code={IMPRESSION_RECORDED_EXAMPLE} label="Response, first report for this ad delivery (200)" />
            <CodeBlock code={IMPRESSION_DUPLICATE_EXAMPLE} label="Response, already reported (200)" />
          </div>
          <p className="mt-4 text-sm font-medium">Expiry and duplicates</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-mist/75">
            <li>The token expires at <code>expires_at</code>, which is counted from the serve (one hour by default). An impression is also never accepted more than 24 hours after the serve. Send it soon after the ad is displayed, not in a nightly batch.</li>
            <li>Only the first impression of an ad delivery counts. Every later report for the same delivery answers <code>duplicate</code>, which is a success, and adds nothing. This holds even when two requests arrive at the same moment.</li>
            <li>The <code>Idempotency-Key</code> header belongs to the match request only. The impression endpoint does not need it: the duplicate rule already makes a retry harmless.</li>
            <li>A 401 never explains why. Do not retry it, and do not try to decode or repair the token.</li>
          </ul>
          <p className="mt-4 text-sm font-medium">Responses</p>
          <div className="mt-2">
            <StatusTable caption="Impression endpoint status codes, what they mean and what to do" rows={IMPRESSION_ERRORS} />
          </div>
          <p className="mt-3 text-sm text-mist/75">
            Rate limits are best-effort and per IP address: about 300 requests per minute, and about 30 rejected tokens per minute.
            Responses are JSON with <code>Cache-Control: no-store</code> and <code>X-Blisscco-Api-Version: 1</code>.
          </p>
          <p className="mt-4 text-sm font-medium">Safe server-side example</p>
          <p className="mt-1 text-sm text-mist/75">
            Step 1 asks for an ad with tracking opted in. Step 2 reports the impression with <code>tracking.token</code> only after display, retries only 5xx and network
            errors, and gives up quietly. Step 3 builds the click link from <code>tracking.click_ref</code> (section 4d). If any step fails, your chatbot carries on without an error.
          </p>
          <div className="mt-3">
            <CodeBlock code={TRACKED_SERVER_EXAMPLE} label="Server-side TypeScript example: ad with tracking, impression, click link" />
          </div>
        </Panel>

        <Panel
          title="4d. Click redirect"
          note="GET /api/v1/ads/click?ref=<click_ref>. The person's browser follows this link. No API key."
        >
          <p className="text-sm text-mist/75">
            When you opt in (section 4a), a successful match can include <code>tracking.click_ref</code>. Your click link is your API
            base URL, the path <code>/api/v1/ads/click</code> and that value as the single query parameter <code>ref</code>, passed through{" "}
            <code>encodeURIComponent()</code>. The click endpoint checks the reference, looks up the ad&apos;s destination in
            Blisscco&apos;s own database, and only then redirects the person there. You do not send the destination, and the endpoint
            never reads one from the link. Do not invent a field such as a click URL, do not send the tracking token to the click
            endpoint (it is a different value and is refused), and do not try to make a reference yourself.
          </p>
          <p className="mt-3 text-sm text-mist/75">
            The match response still contains <code>destination_url</code>, because it is one of the five public ad fields. It tells
            you where the ad leads, but do not use it as the link: a link built from it skips the redirect check and its clicks are
            not reported to Blisscco. If a response has no <code>click_ref</code>, show the ad without a link (section 6).
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-mist/75">
            <li>Build the link on your server with <code>buildClickUrl()</code> from the example in section 4c, and give the finished link to the browser. Your API key is never part of it and never goes to the browser.</li>
            <li>The only query parameter is <code>ref</code>, exactly once. A destination is never taken from the query: the redirect goes to the address stored with the ad, and only if it is a valid <code>https://</code> address.</li>
            <li>Only <code>GET</code> works. <code>HEAD</code>, <code>POST</code> and every other method return 405, so a crawler cannot count a click. Browser prefetch and prerender requests return 204 and count nothing.</li>
            <li>A click is counted only if the impression for that ad delivery was recorded first (section 4c). Without it the person is still redirected, but the click is not counted. Only the first click of an ad delivery counts; later clicks are redirected and add nothing.</li>
            <li>A reference expires together with the token (counted from the serve, one hour by default), and a click is never accepted more than 24 hours after the serve. An invalid, expired or unknown reference returns 404 and no redirect.</li>
            <li>The redirect carries <code>Referrer-Policy: no-referrer</code> and <code>Cache-Control: no-store</code>, so the reference is not leaked to the advertiser and the click is not cached.</li>
            <li>No CORS is needed: it is a normal link the person follows, not a script call.</li>
          </ul>
          <div className="mt-3 grid gap-3">
            <CodeBlock code={CLICK_CURL_EXAMPLE} label="Click link (format only, placeholder reference)" />
            <CodeBlock code={CLICK_RESPONSE_EXAMPLE} label="Click response (302)" />
          </div>
          <p className="mt-4 text-sm font-medium">Responses</p>
          <div className="mt-2">
            <StatusTable caption="Click endpoint status codes, what they mean and what to do" rows={CLICK_ERRORS} />
          </div>
          <p className="mt-3 text-sm text-mist/75">
            Rate limits are the same best-effort, per-IP limits as the impression endpoint. A click does not change spend.
          </p>
        </Panel>

        <Panel title="5. Errors and retries">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <caption className="sr-only">API status codes, what they mean and what to do</caption>
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-mist/55">
                  <th scope="col" className="py-2 pr-3 font-medium">Status</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Body</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Meaning</th>
                  <th scope="col" className="py-2 font-medium">What to do</th>
                </tr>
              </thead>
              <tbody>
                {ERRORS.map((e) => (
                  <tr key={e.status} className="border-b border-line/60 align-top text-mist/75">
                    <td className="py-2 pr-3 font-mono text-xs">{e.status}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{e.body}</td>
                    <td className="py-2 pr-3">{e.meaning}</td>
                    <td className="py-2">{e.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-mist/75">
            <li>Retry only 429 and 5xx. Never retry 4xx errors other than 429: they will fail the same way. The same rule applies to the impression endpoint (section 4c), where resending the same token is safe because only the first impression counts.</li>
            <li>
              Send an <code>Idempotency-Key</code> header on every request: a new random value (a UUID works) per ad placement, 8 to 64
              characters of letters, digits, <code>_</code> or <code>-</code>. If you retry that same placement after a timeout or a 5xx,
              send the same key. The value must be random: never put a user id, an email or any text from the conversation in it. Blisscco then reuses the original ad and serve and does not count a second serve. Tracking credentials come back with that retry only while their original lifetime is still valid (section 4a); a late retry returns the ad without <code>tracking</code>. Keys are remembered for 48 hours.
              Without the header, a retry after a lost response can be counted as a second serve.
            </li>
            <li>Never loop. No retries inside a single chat turn beyond what the table says, and never block the chatbot&apos;s answer while waiting.</li>
            <li>Set your own timeout (the example uses 2 seconds). Blisscco does not set one for you yet.</li>
            <li>Rate limits are per key, per minute (60 by default; Blisscco can change it). The window is fixed, so a burst right at a minute boundary can briefly reach about twice the limit. Requests rejected before the key check (400, 413, 415) do not use up this quota. Separately, about 20 wrong keys per minute from one IP address earn a 429 for that IP.</li>
            <li>Error bodies never contain internal details. If you see one that does, report it to Blisscco.</li>
          </ul>
        </Panel>

        <Panel
          title="5a. Troubleshooting"
          note="Match status codes are from section 5; impression and click codes are in sections 4c and 4d."
        >
          <p className="text-sm text-mist/75">
            Find the symptom, check the likely cause, then apply the fix. If you use the Next.js example, your own route sits in
            between: it answers 400 for a bad or non-allowlisted topic and hides every upstream failure behind its own 503. Send the
            same request with cURL (section 3) and your key to see the real status.
          </p>
          <div className="mt-3">
            <StatusTable caption="Troubleshooting: symptom, cause and fix" rows={TROUBLESHOOTING} />
          </div>
        </Panel>

        <Panel title="6. Showing the ad with a Sponsored label">
          <ul className="list-disc space-y-1 pl-5 text-sm text-mist/75">
            <li>Show the visible word <strong>Sponsored</strong> on every returned ad, next to the headline, in text (not colour or an icon alone). Do not hide, shrink or rename it.</li>
            <li>Keep the ad in its own box, after the assistant&apos;s answer. It must never read as the chatbot&apos;s own words or recommendation, and the chatbot must not rephrase it.</li>
            <li>Render <code>headline</code>, <code>body</code> and <code>cta_text</code> as plain text, never as HTML.</li>
            <li>Make the call-to-action a link to the Blisscco click URL only: <code>{'{API base URL}/api/v1/ads/click?ref='}</code> followed by <code>encodeURIComponent(tracking.click_ref)</code>, with <code>rel=&quot;sponsored noopener noreferrer&quot;</code>. The click endpoint performs the redirect, using the destination it verified in its own database (section 4d).</li>
            <li>Never link straight to <code>destination_url</code>, and never build a redirect address from it or from any value a person or an advertiser typed. With such a link the click is not reported to Blisscco. If there is no <code>click_ref</code>, show the ad without a link.</li>
            <li>Remember the <code>id</code> of ads you showed and send it in <code>exclude_ad_ids</code> next time to reduce repeats.</li>
            <li>Report the impression (section 4c) only after the labelled ad is on screen. Never report it for an ad you dropped, hid or did not render.</li>
          </ul>
          <p className="mt-4 text-sm font-medium">Rendering example</p>
          <p className="mt-1 text-sm text-mist/75">
            Escapes every text field, always includes the Sponsored label, and makes the call-to-action clickable only for an <code>https://</code> Blisscco click link with a <code>bc1.</code> reference. <code>destination_url</code> is never used as the link.
          </p>
          <div className="mt-3">
            <CodeBlock code={RENDER_EXAMPLE} label="Sponsored ad rendering example (TypeScript, click link from click_ref)" />
          </div>
          <div className="mt-4 max-w-md rounded-lg border border-line bg-ink p-4">
            <span className="inline-block rounded bg-mist/10 px-2 py-0.5 text-xs font-medium text-mist/80">Sponsored</span>
            <p className="mt-2 text-sm font-medium">Sample Advertiser: example headline</p>
            <p className="mt-1 text-sm text-mist/65">Example ad text shown after the assistant&apos;s own answer. This is not a real ad.</p>
          </div>
        </Panel>

        <Panel title="7. Handling no-fill without breaking the chat">
          <ul className="list-disc space-y-1 pl-5 text-sm text-mist/75">
            <li>No-fill is normal, not an error. Show nothing: no placeholder, no apology, no empty Sponsored box.</li>
            <li>Send the chatbot&apos;s answer first or in parallel. If the ad arrives late, or not at all, drop it.</li>
            <li>The same goes for every failure in section 5: timeouts, 429, 5xx, a missing key. The user should never see an ad-related error.</li>
            <li>Do not re-request in a loop for the same turn. One request per placement is enough.</li>
            <li>Skip the request entirely for sensitive or private conversations.</li>
            <li>Do not log keys, topics tied to a person, or conversation text with your ad requests. Counting fills and no-fills is enough.</li>
          </ul>
        </Panel>

        <Panel title="8. Why the key must stay on your server">
          <p className="text-sm text-mist/75">
            The key is a password for your publisher account. Anyone who gets it can request ads as you, use up your
            rate limit and put your account at risk. Browser JavaScript, mobile app bundles, public environment
            variables (any prefix that is shipped to the client), frontend components and public repositories are all
            readable by users, so the key must never be there. The API has no CORS support on purpose, so browser calls
            do not work. Call it from your backend, and send the browser only the ad fields it needs to display. If a
            key leaks, revoke it on the Publisher page at once (see section 2).
          </p>
          <p className="mt-4 text-sm font-medium">Private key or public value?</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[30rem] text-left text-sm">
              <caption className="sr-only">Which values are private and which are safe to show</caption>
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-mist/55">
                  <th scope="col" className="py-2 pr-3 font-medium">Value</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Private?</th>
                  <th scope="col" className="py-2 font-medium">Where it may live</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-line/60 align-top text-mist/75">
                  <td className="py-2 pr-3">Full API key (<code>blc_live_</code> + 64 hex characters)</td>
                  <td className="py-2 pr-3">Private. Never share.</td>
                  <td className="py-2">Server environment variable or secret manager only.</td>
                </tr>
                <tr className="border-b border-line/60 align-top text-mist/75">
                  <td className="py-2 pr-3">Key name, the start and last 4 characters shown on the Publisher page</td>
                  <td className="py-2 pr-3">Identifier only. It cannot be used to call the API.</td>
                  <td className="py-2">Fine in your own notes and tickets to say which key you mean.</td>
                </tr>
                <tr className="border-b border-line/60 align-top text-mist/75">
                  <td className="py-2 pr-3">Returned ad fields (<code>id</code>, <code>headline</code>, <code>body</code>, <code>cta_text</code>, <code>destination_url</code>)</td>
                  <td className="py-2 pr-3">Public. They are meant to be displayed.</td>
                  <td className="py-2">Your server may send them to the browser.</td>
                </tr>
                <tr className="border-b border-line/60 align-top text-mist/75">
                  <td className="py-2 pr-3">Tracking <code>token</code> (sections 4a and 4c)</td>
                  <td className="py-2 pr-3">Not your key, but treat it as a bearer value until it expires.</td>
                  <td className="py-2">Your server. Report impressions from there; the endpoint has no CORS.</td>
                </tr>
                <tr className="border-b border-line/60 align-top text-mist/75">
                  <td className="py-2 pr-3"><code>tracking.click_ref</code> and the click link built from it (sections 4a and 4d)</td>
                  <td className="py-2 pr-3">Not your key. A bearer value for one ad delivery until it expires.</td>
                  <td className="py-2">The click link in the person&apos;s browser, which is its purpose. Never put your API key in it, and keep the reference out of logs.</td>
                </tr>
                <tr className="align-top text-mist/75">
                  <td className="py-2 pr-3"><code>Idempotency-Key</code></td>
                  <td className="py-2 pr-3">Not a credential, but keep it random and unlinked to a person.</td>
                  <td className="py-2">Your server only.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-mist/75">
            This API has no public or &quot;site&quot; key and no publisher id to put in a page. The one credential is the private key, so
            there is nothing that is safe to put in browser code except the ad fields you display and the finished click link.
          </p>
        </Panel>

        <Panel title="9. Test before any production rollout">
          <p className="text-sm text-mist/75">
            Blisscco does not publish a staging environment. Ask for a test publisher with its own test key, and use
            it only against whatever test setup Blisscco confirms. Keep test and real keys in separate environment
            variables, and never use a real key in development.
          </p>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-mist/75">
            <li>A valid request returns 200: either an ad or <code>{'{"fill":false}'}</code> (an ad appears only if the test setup has an eligible one).</li>
            <li><code>{'{"topic":"health"}'}</code> returns no-fill.</li>
            <li>The same call with the last character of the key changed returns 401.</li>
            <li>A body with an extra field, from a throwaway script, returns 400.</li>
            <li>Simulate 429 and 503 with a mock server. Confirm the chatbot still answers normally.</li>
            <li>Match with <code>X-Blisscco-Tracking: 1</code>, then report the impression twice with the same token. The first answer is <code>recorded</code>, the second is <code>duplicate</code>.</li>
            <li>Change one character of the token. The impression endpoint returns 401 and nothing is recorded.</li>
            <li>Build the click link from <code>tracking.click_ref</code>, open it in a browser and confirm you are redirected to the ad&apos;s destination. Then change one character of the reference: the endpoint returns 404 and no redirect.</li>
            <li>Check that no link on your page points straight at <code>destination_url</code>, and that the tracking token is never put in a click link.</li>
            <li>Confirm your code never calls the impression endpoint before the ad is displayed, and never sends your API key to it.</li>
            <li>Check the Sponsored label, the plain-text rendering and the link on every screen size you support.</li>
            <li>Search your built frontend files and the browser network tab: the key must appear nowhere.</li>
            <li>Ask Blisscco to revoke the test key when you are done.</li>
          </ol>
        </Panel>

        <Panel title="10. Known limitations" note="These are why this API should not be treated as ready for production use.">
          <ul className="list-disc space-y-1 pl-5 text-sm text-mist/75">
            <li>Accounts are approved by hand by the Blisscco team, so approval can take time.</li>
            <li>Advertiser budgets are enforced, and spend is counted when an ad is handed to you, not when a person sees it.</li>
            <li>A match request is counted as an ad serve, and that is the only charged event. Impressions and clicks are reporting counts that you or the person trigger; they do not change spend. A tracking token does not prove that an ad was shown or clicked. Match retries are safe only when you send the same <code>Idempotency-Key</code>. A retry reuses the original serve but never refreshes expired tracking credentials.</li>
            <li><code>click_ref</code> is optional and appears only when you opt in and Blisscco could sign it. Without it there is no Blisscco click link, and a link straight to <code>destination_url</code> is not reported (section 4d).</li>
            <li>The impression endpoint has no CORS, so impressions must be reported from your server. A click is counted only after its impression was recorded.</li>
            <li>Impression and click counts depend on your integration reporting honestly. Do not use them on their own for billing or payouts.</li>
            <li>Rate limiting is per key, plus a best-effort guard against repeated wrong keys from one IP. Add your own edge protection too.</li>
            <li>Database calls time out after 8 seconds. A Blisscco outage returns 503 with error unavailable, while a plain no-fill (200) means no matching ad.</li>
            <li>No staging environment is published.</li>
            <li>The contract can still change; the <code>v1</code> path and its version header are the only stability signal.</li>
          </ul>
        </Panel>
      </div>

      <div className="mt-6">
        <Button href={backHref} variant="secondary">{backLabel}</Button>
      </div>
    </>
  );
}
