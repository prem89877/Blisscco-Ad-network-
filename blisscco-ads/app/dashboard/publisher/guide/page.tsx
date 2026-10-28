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

// Publisher integration guide for the versioned Ad API (POST /api/v1/ads/match).
// Source of truth for the contract: DAY6-ADS-MATCH-CONTRACT.md and lib/ads/contract.ts.
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
  "{",
  '  "fill": true,',
  '  "sponsored": true,',
  '  "ad": {',
  '    "id": "3f2b8c1e-5a47-4d9e-9b62-7c1d8e4a6f10",',
  '    "headline": "Level up your game nights",',
  '    "body": "Compare gaming laptops built for long sessions.",',
  '    "cta_text": "Shop now",',
  '    "destination_url": "https://example.com/gaming-laptops"',
  "  },",
  '  "tracking": {',
  '    "token": "bt1.EXAMPLE-PAYLOAD.EXAMPLE-SIGNATURE",',
  '    "expires_at": "2026-10-28T11:00:00.000Z",',
  '    "events": ["impression", "click"]',
  "  }",
  "}",
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
        description="How a publisher's own server can request a clearly labelled, topic-matched sponsored ad from the versioned Blisscco Ad API."
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
        <Panel title="1. What the API does">
          <p className="text-sm text-mist/75">
            Your server sends one small request: a topic such as <code>gaming</code>. Blisscco replies with at most one
            sponsored ad whose campaign category matches that topic, or with a no-fill response when nothing eligible
            exists. Matching is by category only. Blisscco does not read conversations, does not build a profile of the
            person, and does not send anything to an external AI service. Your server decides the topic; the API
            rejects any prompt, message, user identifier or other extra field.
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
            Every response from the API itself is JSON with <code>Cache-Control: no-store</code>. The v1 endpoint also sends{" "}
            <code>X-Blisscco-Api-Version: 1</code>. The only exception is the platform&apos;s empty 405 for a method other than POST (see
            section 5).
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
          title="4a. Optional tracking token"
          note="Opt-in and backward compatible. It prepares later impression and click reporting; it does not report anything today."
        >
          <p className="text-sm text-mist/75">
            Add the header <code>X-Blisscco-Tracking: 1</code> to your server&apos;s request and a successful match also returns a{" "}
            <code>tracking</code> object next to the ad. Without that header the response is exactly the one in section 4, with the same
            five ad fields. Any other value for the header returns 400 with reason <code>invalid_tracking_header</code>.
          </p>
          <div className="mt-3 grid gap-3">
            <CodeBlock code={TRACKING_CURL_EXAMPLE} label="Request with tracking opt-in" />
            <CodeBlock code={TRACKING_SUCCESS_EXAMPLE} label="Successful match with tracking (example values, not a real token)" />
          </div>
          <p className="mt-4 text-sm font-medium">Fields</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-mist/75">
            <li><code>token</code>: an opaque, signed string that refers to this one ad delivery. Treat it as a sealed value: do not decode, edit, shorten or guess it. It never contains your API key.</li>
            <li><code>expires_at</code>: ISO 8601 time in UTC. It is counted from the moment the ad was served (default one hour), and a retry never extends it.</li>
            <li><code>events</code>: the event types this token may later be used for: <code>impression</code> and <code>click</code>.</li>
          </ul>
          <p className="mt-4 text-sm font-medium">What a token does and does not mean</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-mist/75">
            <li>Receiving a token does <strong>not</strong> mean the ad was shown, seen or clicked. A serve, an impression and a click are three different things, and a token is only permission to report the later two.</li>
            <li>There is no endpoint to send tokens to yet, and Blisscco counts no impressions or clicks. Do not use a token for billing, payouts or your own impression counts, and do not call anything that claims otherwise.</li>
            <li>The token is not your API key and not a secret you must hide like the key, but anyone who holds it can try to report events for that one ad delivery until it expires. Keep it with that ad only, and do not log it next to a person, session or conversation id.</li>
            <li>Your API key, <code>Idempotency-Key</code> and any other credential stay on your server. The browser may receive the five ad fields and, if you need it, the token for that same ad.</li>
          </ul>
          <p className="mt-4 text-sm font-medium">When <code>tracking</code> is absent</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-mist/75">
            <li>You did not send the opt-in header.</li>
            <li>The response is a no-fill, an error (400, 401, 429, 503) or anything other than a successfully recorded ad. These never carry a token.</li>
            <li>Tracking is not switched on at Blisscco, or the ad delivery is older than the token lifetime (for example a very late retry), or it was served before this feature existed.</li>
            <li>Your code must treat a missing <code>tracking</code> as normal: show the ad exactly as before.</li>
          </ul>
          <p className="mt-4 text-sm font-medium">Retries</p>
          <p className="mt-1 text-sm text-mist/75">
            Retrying with the same <code>Idempotency-Key</code> returns the same ad, the same delivery and the identical token. It does not create a second delivery or a second token. Use a different key for every new placement, never the same key for two ads.
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
            <li>Retry only 429 and 5xx. Never retry 4xx errors other than 429: they will fail the same way.</li>
            <li>
              Send an <code>Idempotency-Key</code> header on every request: a new random value (a UUID works) per ad placement, 8 to 64
              characters of letters, digits, <code>_</code> or <code>-</code>. If you retry that same placement after a timeout or a 5xx,
              send the same key. The value must be random: never put a user id, an email or any text from the conversation in it. Blisscco then returns the same ad and does not count a second serve. Keys are remembered for 48 hours.
              Without the header, a retry after a lost response can be counted as a second serve.
            </li>
            <li>Never loop. No retries inside a single chat turn beyond what the table says, and never block the chatbot&apos;s answer while waiting.</li>
            <li>Set your own timeout (the example uses 2 seconds). Blisscco does not set one for you yet.</li>
            <li>Rate limits are per key, per minute (60 by default; Blisscco can change it). The window is fixed, so a burst right at a minute boundary can briefly reach about twice the limit. Requests rejected before the key check (400, 413, 415) do not use up this quota. Separately, about 20 wrong keys per minute from one IP address earn a 429 for that IP.</li>
            <li>Error bodies never contain internal details. If you see one that does, report it to Blisscco.</li>
          </ul>
        </Panel>

        <Panel title="6. Showing the ad with a Sponsored label">
          <ul className="list-disc space-y-1 pl-5 text-sm text-mist/75">
            <li>Show the visible word <strong>Sponsored</strong> on every returned ad, next to the headline, in text (not colour or an icon alone). Do not hide, shrink or rename it.</li>
            <li>Keep the ad in its own box, after the assistant&apos;s answer. It must never read as the chatbot&apos;s own words or recommendation, and the chatbot must not rephrase it.</li>
            <li>Render <code>headline</code>, <code>body</code> and <code>cta_text</code> as plain text, never as HTML.</li>
            <li>Link to <code>destination_url</code> only if it starts with <code>https://</code>, using <code>rel=&quot;sponsored noopener noreferrer&quot;</code>.</li>
            <li>Remember the <code>id</code> of ads you showed and send it in <code>exclude_ad_ids</code> next time to reduce repeats.</li>
          </ul>
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
                  <td className="py-2 pr-3">Tracking <code>token</code> (section 4a)</td>
                  <td className="py-2 pr-3">Not your key, but treat it as a bearer value until it expires.</td>
                  <td className="py-2">Your server; the browser only with its own ad, if you need it there.</td>
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
            there is nothing that is safe to put in browser code except the ad fields you display.
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
            <li>Check the Sponsored label, the plain-text rendering and the link on every screen size you support.</li>
            <li>Search your built frontend files and the browser network tab: the key must appear nowhere.</li>
            <li>Ask Blisscco to revoke the test key when you are done.</li>
          </ol>
        </Panel>

        <Panel title="10. Known limitations" note="These are why this API should not be treated as ready for production use.">
          <ul className="list-disc space-y-1 pl-5 text-sm text-mist/75">
            <li>Accounts are approved by hand by the Blisscco team, so approval can take time.</li>
            <li>Advertiser budgets are enforced, and spend is counted when an ad is handed to you, not when a person sees it.</li>
            <li>A request is counted as an ad serve. There is no impression or click reporting, and nothing here should be used for billing or payouts. The optional tracking token (section 4a) does not change that: it does not prove that an ad was shown or clicked. Retries are safe only when you send the same <code>Idempotency-Key</code>.</li>
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
