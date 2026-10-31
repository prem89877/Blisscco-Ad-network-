import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as route from "../../examples/publisher-nextjs/app/api/blisscco-ad/route";
import { safeHref } from "../../examples/publisher-nextjs/lib/safe-url";
import { CATEGORY_OPTIONS } from "@/lib/campaigns/constants";

// Day 20 Part 3 (updated Day 21 Part 3 for tracking): Next.js publisher example. MOCKED fetch only: no network, no database, no production code touched.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, "examples/publisher-nextjs", f), "utf8");
const SRC = { route: read("app/api/blisscco-ad/route.ts"), component: read("components/SponsoredAd.tsx"), safeUrl: read("lib/safe-url.ts"), env: read(".env.example"), readme: read("README.md") };

const KEY = `blc_live_${"c".repeat(64)}`;
const BASE = "https://ads.example.com";
const AD = { id: "11111111-1111-4111-8111-111111111111", headline: "Level up", body: "Gaming laptops", cta_text: "Shop now", destination_url: "https://example.com/g" };
const FILL = { fill: true, sponsored: true, ad: AD };

type Upstream = { url: string; headers: Record<string, string>; body: string };
let upstream: Upstream[] = [];
let logs: string[] = [];
const realFetch = globalThis.fetch;
const realConsole = { log: console.log, error: console.error, warn: console.warn, info: console.info };
const savedEnv = { key: process.env.BLISSCCO_PUBLISHER_API_KEY, base: process.env.BLISSCCO_API_BASE_URL };

function mockUpstream(status: number, body: unknown, headers: Record<string, string> = {}): void {
  globalThis.fetch = (async (url: unknown, init: RequestInit) => {
    upstream.push({ url: String(url), headers: init.headers as Record<string, string>, body: String(init.body) });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  }) as typeof fetch;
}
function post(body: unknown, headers: Record<string, string> = { "content-type": "application/json" }, raw = false): Promise<Response> {
  return route.POST(new Request("http://localhost/api/blisscco-ad", { method: "POST", headers, body: raw ? (body as string) : JSON.stringify(body) }));
}
const text = async (r: Response) => await r.clone().text();

beforeEach(() => {
  upstream = [];
  logs = [];
  process.env.BLISSCCO_PUBLISHER_API_KEY = KEY;
  process.env.BLISSCCO_API_BASE_URL = BASE;
  for (const m of ["log", "error", "warn", "info"] as const) console[m] = (...a: unknown[]) => void logs.push(a.map(String).join(" "));
  mockUpstream(200, FILL);
});
afterEach(() => {
  globalThis.fetch = realFetch;
  Object.assign(console, realConsole);
  for (const [name, v] of [["BLISSCCO_PUBLISHER_API_KEY", savedEnv.key], ["BLISSCCO_API_BASE_URL", savedEnv.base]] as const) {
    if (v === undefined) delete process.env[name];
    else process.env[name] = v;
  }
});

describe("server-only key usage", () => {
  it("calls Blisscco from the server with the Bearer key, and the key never reaches the browser response", async () => {
    const res = await post({ topic: "gaming" });
    assert.equal(res.status, 200);
    assert.equal(upstream.length, 1);
    assert.equal(upstream[0].url, `${BASE}/api/v1/ads/match`);
    assert.equal(upstream[0].headers.Authorization, `Bearer ${KEY}`);
    assert.match(upstream[0].headers["Idempotency-Key"], /^[0-9a-f-]{36}$/);
    const out = (await text(res)) + JSON.stringify([...res.headers.entries()]);
    assert.equal(out.includes("c".repeat(64)), false);
    assert.equal(out.includes("blc_live_"), false);
  });

  it("only the route reads credentials; component and safe-url never touch env, key or the node client", () => {
    assert.match(SRC.route, /process\.env\.BLISSCCO_PUBLISHER_API_KEY/);
    assert.match(SRC.route, /process\.env\.BLISSCCO_API_BASE_URL/);
    for (const code of [SRC.component, SRC.safeUrl]) {
      assert.doesNotMatch(code, /process\.env|BLISSCCO_|blc_live_|apiKey|Authorization|publisher-node|Idempotency/);
    }
    assert.doesNotMatch(SRC.route + SRC.component, /NEXT_PUBLIC/);
    assert.match(SRC.component, /^"use client";/);
    assert.doesNotMatch(SRC.route, /^"use client"/m);
  });

  it(".env.example and README hold placeholders only, with no NEXT_PUBLIC key", () => {
    assert.match(SRC.env, /^BLISSCCO_PUBLISHER_API_KEY=/m);
    assert.match(SRC.env, /^BLISSCCO_API_BASE_URL=/m);
    for (const s of [SRC.env, SRC.readme]) {
      assert.doesNotMatch(s, /blc_live_[0-9a-f]{64}/);
      assert.doesNotMatch(s, /NEXT_PUBLIC_BLISSCCO/);
    }
    assert.match(SRC.env, /blc_live_REPLACE/);
    assert.match(SRC.readme, /no `NEXT_PUBLIC_` prefix/);
  });

  it("route exports only POST (+ runtime/dynamic): no GET, no OPTIONS, no CORS headers", async () => {
    assert.deepEqual(Object.keys(route).sort(), ["POST", "dynamic", "runtime"]);
    assert.doesNotMatch(SRC.route.replace(/\/\/.*$/gm, ""), /access-control|cors/i); // comments ignored
    const res = await post({ topic: "gaming" });
    assert.deepEqual([...res.headers.keys()].filter((h) => h.startsWith("access-control")), []);
    assert.equal(res.headers.get("cache-control"), "no-store");
  });
});

describe("topic validation", () => {
  it("every allowlisted topic is a real Blisscco category and is accepted", async () => {
    const real = CATEGORY_OPTIONS.map((o) => o.value as string);
    const listed = [...SRC.route.matchAll(/^\s+"([a-z_]+)",$/gm)].map((m) => m[1]);
    assert.ok(listed.length >= 5);
    for (const t of listed) {
      assert.ok(real.includes(t), `${t} is not a Blisscco category`);
      assert.equal((await post({ topic: t })).status, 200);
    }
    assert.equal(upstream.length, listed.length);
    assert.equal(JSON.parse(upstream[0].body).topic, listed[0]);
  });

  it("rejects non-allowlisted or malformed topics with 400 invalid_topic and never calls upstream", async () => {
    for (const topic of ["Gaming", " gaming", "gaming ", "", "health", "random", "__proto__", "constructor", "toString", "gaming;drop", "a".repeat(51), 123, null, ["gaming"], { a: 1 }, undefined]) {
      const res = await post({ topic });
      assert.equal(res.status, 400, JSON.stringify(topic));
      assert.deepEqual(await res.json(), { error: "invalid_request", reason: "invalid_topic" });
    }
    assert.equal((await post({})).status, 400);
    assert.equal(upstream.length, 0);
  });

  it("rejects bad JSON, bad shapes, wrong content type and oversized bodies", async () => {
    assert.deepEqual(await (await post("{nope", undefined, true)).json(), { error: "invalid_request", reason: "invalid_json" });
    assert.equal((await post("{nope", { "content-type": "application/json" }, true)).status, 400);
    assert.deepEqual(await (await post([], undefined)).json(), { error: "invalid_request", reason: "invalid_body" });
    assert.equal((await post("null", { "content-type": "application/json" }, true)).status, 400);
    assert.equal((await post({ topic: "gaming" }, { "content-type": "text/plain" })).status, 415);
    assert.equal((await post({ topic: "gaming" }, {})).status, 415);
    assert.equal((await post({ topic: "gaming", pad: "x".repeat(2000) })).status, 413);
    assert.equal(upstream.length, 0);
  });
});

describe("no raw conversation / prompt forwarding", () => {
  it("rejects every extra field (prompt, messages, conversation, user data...) before any upstream call", async () => {
    const extras: Array<Record<string, unknown>> = [
      { prompt: "my secret question" },
      { messages: [{ role: "user", content: "hi" }] },
      { conversation: "long chat text" },
      { context: "x" },
      { query: "x" },
      { user_message: "x" },
      { user: { email: "a@b.com" } },
      { fallback_topics: ["travel"] },
      { exclude_ad_ids: [AD.id] },
    ];
    for (const extra of extras) {
      const res = await post({ topic: "gaming", ...extra });
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { error: "invalid_request", reason: "unknown_field" });
    }
    assert.equal(upstream.length, 0);
  });

  it("forwards exactly {topic}, and only Blisscco headers (no cookies or browser headers)", async () => {
    await post({ topic: "travel" }, { "content-type": "application/json", cookie: "session=abc", authorization: "Bearer browser-token", "x-forwarded-for": "1.2.3.4", referer: "https://site.example/chat?q=secret", "user-agent": "x" });
    assert.equal(upstream[0].body, JSON.stringify({ topic: "travel" }));
    const names = Object.keys(upstream[0].headers).map((h) => h.toLowerCase()).sort();
    assert.deepEqual(names, ["accept", "authorization", "content-type", "idempotency-key", "x-blisscco-tracking"]);
    assert.equal(upstream[0].headers["X-Blisscco-Tracking"], "1");
    assert.equal(upstream[0].headers.Authorization, `Bearer ${KEY}`);
    assert.equal(JSON.stringify(upstream[0]).includes("browser-token"), false);
    assert.equal(JSON.stringify(upstream[0]).includes("secret"), false);
  });

  it("the component sends only {topic}", () => {
    assert.match(SRC.component, /JSON\.stringify\(\{ topic \}\)/);
    assert.match(SRC.component, /credentials: "omit"/);
    assert.match(SRC.component, /fetch\("\/api\/blisscco-ad"/);
  });
});

describe("Sponsored disclosure", () => {
  it("every filled response is marked sponsored:true; no-fill carries no ad", async () => {
    const filled = await (await post({ topic: "gaming" })).json();
    assert.equal(filled.fill, true);
    assert.equal(filled.sponsored, true);
    mockUpstream(200, { fill: false });
    assert.deepEqual(await (await post({ topic: "gaming" })).json(), { fill: false });
  });

  it("component shows an explicit Sponsored label and only renders when sponsored === true", () => {
    assert.match(SRC.component, />Sponsored<\/p>/);
    assert.match(SRC.component, /aria-label="Sponsored"/);
    assert.match(SRC.component, /d\.sponsored !== true/);
    assert.match(SRC.component, /if \(!ad\) return null/);
  });
});

describe("safe destination handling", () => {
  it("safeHref allows only plain https links", () => {
    assert.equal(safeHref("https://example.com/g?x=1#a"), "https://example.com/g?x=1#a");
    assert.equal(safeHref("https://example.com/a@b"), "https://example.com/a@b");
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>1</script>", "http://example.com", "ftp://example.com", "//example.com", "/relative", "https://trusted.com@evil.example/p", "https://user:pw@example.com", "https://exa mple.com", "https://example.com/\n", "", "https://", "not a url", "https://example.com/" + "a".repeat(2100), null, undefined, 42, {}]) {
      assert.equal(safeHref(bad), null, String(bad));
    }
  });

  it("route turns an unsafe upstream destination into no-fill", async () => {
    for (const destination_url of ["javascript:alert(1)", "http://example.com", "data:text/html,x", "https://user:pw@example.com", "https://exa mple.com", ""]) {
      mockUpstream(200, { ...FILL, ad: { ...AD, destination_url } });
      assert.deepEqual(await (await post({ topic: "gaming" })).json(), { fill: false }, destination_url);
    }
  });

  it("component has no direct advertiser link: it re-checks the URL, opens it only from the click handler with noopener+noreferrer, and never injects HTML", () => {
    assert.match(SRC.component, /safeHref\(destination_url\)/);
    assert.match(SRC.component, /safeHref\(ad\.href\)/);
    assert.doesNotMatch(SRC.component, /<a\b|href=\{/);
    assert.match(SRC.component, /window\.open\(target, "_blank", "noopener,noreferrer"\)/);
    assert.doesNotMatch(SRC.component, /dangerouslySetInnerHTML|innerHTML|eval\(|document\.write/);
  });
});

describe("response whitelist and upstream errors", () => {
  it("returns only the 5 public ad fields + { tracking: { token, click_ref } }; expires_at, events and extra data are dropped", async () => {
    mockUpstream(200, { ...FILL, ad: { ...AD, advertiser_email: "a@b.com", spent_total: 9 }, tracking: { token: "bt1.a.b", expires_at: "x", events: ["impression", "click"], click_ref: "bc1.a.b" }, internal: 1 });
    const body = await (await post({ topic: "gaming" })).json();
    assert.deepEqual(body, { fill: true, sponsored: true, ad: { ...AD, destination_url: "https://example.com/g" }, tracking: { token: "bt1.a.b", click_ref: "bc1.a.b" } });
    assert.deepEqual(Object.keys(body.ad).sort(), ["body", "cta_text", "destination_url", "headline", "id"]);
    assert.equal(upstream[0].headers["X-Blisscco-Tracking"], "1");
    assert.equal(/expires_at|events/.test(JSON.stringify(body)), false);
  });

  it("no usable impression tracking (missing, click-only events, malformed token) => ad is returned without tracking", async () => {
    for (const tracking of [undefined, { token: "bt1.a.b", expires_at: "x", events: ["click"] }, { token: "not-a-token", expires_at: "x", events: ["impression"], click_ref: "not-a-ref" }]) {
      mockUpstream(200, { ...FILL, ...(tracking ? { tracking } : {}) });
      const body = await (await post({ topic: "gaming" })).json();
      assert.equal(body.fill, true);
      assert.equal("tracking" in body, false);
    }
  });

  it("any upstream or config failure becomes a generic 503 {fill:false,error:'unavailable'} with no leakage", async () => {
    const cases: Array<() => void> = [
      () => mockUpstream(401, { error: "unauthorized", reason: KEY }),
      () => mockUpstream(429, { error: "rate_limited" }, { "retry-after": "60" }),
      () => mockUpstream(503, { fill: false, error: "unavailable" }),
      () => mockUpstream(500, `boom ${KEY}`),
      () => mockUpstream(200, { hello: "unexpected" }),
      () => {
        globalThis.fetch = (async () => { throw new Error(`connect failed Bearer ${KEY}`); }) as typeof fetch;
      },
      () => { delete process.env.BLISSCCO_PUBLISHER_API_KEY; },
      () => { process.env.BLISSCCO_PUBLISHER_API_KEY = "not-a-key"; },
      () => { delete process.env.BLISSCCO_API_BASE_URL; },
      () => { process.env.BLISSCCO_API_BASE_URL = "http://ads.example.com"; },
    ];
    for (const setup of cases) {
      setup();
      const res = await post({ topic: "gaming" });
      const out = await text(res);
      assert.equal(res.status, 503);
      assert.deepEqual(JSON.parse(out), { fill: false, error: "unavailable" });
      assert.equal(out.includes("c".repeat(64)) || /unauthorized|rate_limited|not-a-key/.test(out), false);
      beforeEachReset();
    }
    assert.equal(logs.join("\n").includes("c".repeat(64)), false);
    assert.equal(logs.join("\n").includes("Bearer"), false);
    assert.ok(logs.every((l) => l.startsWith("[blisscco-ad]")));
  });
});

function beforeEachReset(): void {
  process.env.BLISSCCO_PUBLISHER_API_KEY = KEY;
  process.env.BLISSCCO_API_BASE_URL = BASE;
  mockUpstream(200, FILL);
}
