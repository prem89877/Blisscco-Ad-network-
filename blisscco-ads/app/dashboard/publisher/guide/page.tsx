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
  "",
  "export async function getSponsoredAd(topic: string, shownAdIds: string[] = []): Promise<SponsoredAd | null> {",
  "  if (!API_BASE || !API_KEY) return null; // not configured: just run without ads",
  "  if (Date.now() < pausedUntil) return null;",
  "  try {",
  '    const res = await fetch(API_BASE + "/api/v1/ads/match", {',
  '      method: "POST",',
  '      headers: { Authorization: "Bearer " + API_KEY, "Content-Type": "application/json" },',
  "      body: JSON.stringify({ topic: topic, exclude_ad_ids: shownAdIds }),",
  "      signal: AbortSignal.timeout(2000), // your own timeout: never make the chat wait for an ad",
  "    });",
  "    if (res.status === 429) {",
  '      pausedUntil = Date.now() + (Number(res.headers.get("Retry-After")) || 60) * 1000;',
  "      return null;",
  "    }",
  "    if (!res.ok) return null; // 400/401/413/415/503/...: continue without an ad",
  "    const data = (await res.json()) as MatchResponse;",
  "    return data.fill === true && data.sponsored === true ? data.ad : null;",
  "  } catch {",
  "    return null; // network error or timeout: continue without an ad",
  "  }",
  "}",
].join("\n");

const ERRORS: Array<{ status: string; body: string; meaning: string; action: string }> = [
  { status: "400", body: "invalid_request + reason", meaning: "The body broke the contract (bad JSON, unknown field, bad topic, bad exclude_ad_ids).", action: "Do not retry. Fix the request." },
  { status: "401", body: "unauthorized", meaning: "Key missing, malformed, unknown, revoked, or the publisher is not active.", action: "Do not retry. Check the key, then contact Blisscco." },
  { status: "405", body: "(none)", meaning: "Any method other than POST.", action: "Do not retry. Use POST." },
  { status: "413", body: "payload_too_large", meaning: "Body is over 2048 bytes.", action: "Do not retry. Send only topic and exclude_ad_ids." },
  { status: "415", body: "unsupported_media_type", meaning: "Content-Type is not application/json.", action: "Do not retry. Fix the header." },
  { status: "429", body: "rate_limited", meaning: "Too many requests for this key. The response carries Retry-After: 60.", action: "Stop asking for ads until Retry-After has passed, then retry once." },
  { status: "503 (or any 5xx)", body: "fill:false + error:unavailable", meaning: "Temporary failure on Blisscco's side.", action: "Retry at most once or twice, after 1 second or more with jitter. Then continue without an ad." },
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
        </Panel>

        <Panel title="2. Getting an API key">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-mist/75">
            <li>Sign up with the AI Publisher account type and save your platform details on the Publisher page.</li>
            <li>Blisscco reviews and approves the account by hand. Until it is approved, keys cannot be created.</li>
            <li>Once approved, create a key on the Publisher page. The key is shown once, and only a hash is stored, so a lost key cannot be recovered: create a new one and revoke the old one.</li>
            <li>Store the key straight in your server&apos;s secret manager or environment variables. Do not paste it into chat, tickets, screenshots or git.</li>
            <li>A publisher can hold up to 5 active keys. Choose an expiry when you create a key (90 days is the default) and revoke any key that may have leaked.</li>
          </ol>
          <p className="mt-3 text-xs text-mist/55">Keys start with a fixed prefix and are long random strings. This guide never shows a real one.</p>
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
          <p className="mt-3 text-sm font-medium">JSON body</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-mist/75">
            <li><code>topic</code> (required): lowercase slug, 1 to 50 characters of a-z, 0-9 and underscore. Not free text.</li>
            <li><code>exclude_ad_ids</code> (optional): up to 20 ad ids you already showed, as UUIDs. This is best-effort: if there is no other eligible ad, the same ad can come back.</li>
            <li>No other field is accepted. The body must be 2048 bytes or smaller.</li>
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
        </Panel>

        <Panel title="4. Responses">
          <p className="text-sm text-mist/75">
            Every response is JSON with <code>Cache-Control: no-store</code>. The v1 endpoint also sends{" "}
            <code>X-Blisscco-Api-Version: 1</code>.
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
            <li>Never loop. No retries inside a single chat turn beyond what the table says, and never block the chatbot&apos;s answer while waiting.</li>
            <li>Set your own timeout (the example uses 2 seconds). Blisscco does not set one for you yet.</li>
            <li>Rate limits are per key, per minute (60 by default; Blisscco can change it). The window is fixed, so a burst right at a minute boundary can briefly reach about twice the limit.</li>
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
            key leaks, contact Blisscco at once to have it revoked.
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
            <li>A request is counted as an ad serve. There is no impression or click reporting, and nothing here should be used for billing or payouts.</li>
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
