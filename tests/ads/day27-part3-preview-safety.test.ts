// Day 27 Part 3: the controlled JSON preview route cannot be steered by the browser, and the fixture stays isolated from live ad serving.
// Mocked fetch only; the Revive flag is never enabled; no network, DB, billing or tracking.
import * as route from "@/app/api/revive-json-preview/route";
import { defaultPreviewProvider, handlePreviewGet } from "@/lib/ads/revive-json-preview";
import { reviveFallbackEnabled } from "@/lib/ads/fallback-provider";
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = path.join(__dirname, "..", "..", "..");
const BUILD = path.join(__dirname, "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const importsOf = (f: string) => [...code(f).matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);

const ROUTE = "app/api/revive-json-preview/route.ts";
const PREVIEW_LIB = "lib/ads/revive-json-preview.ts";
const NOT_FOUND = '{"error":"not_found"}';
const EVIL = "https://evil.example.org/steal?x=1";
const EVIL_HEADLINE = "HACKED-HEADLINE-27";
const ENV_KEYS = ["REVIVE_JSON_PREVIEW_ENABLED", "REVIVE_FALLBACK_ENABLED", "REVIVE_DELIVERY_URL"] as const;
const saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
let fetchCalls = 0;

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  fetchCalls = 0;
  globalThis.fetch = (async () => { fetchCalls += 1; throw new Error("test: no network"); }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  assert.equal(fetchCalls, 0, "fetch was called");
});

const callRoute = (arg?: unknown) => (route.GET as unknown as (r?: unknown) => Promise<Response>)(arg);
const snap = async (r: Response) => `${r.status}|${JSON.stringify([...r.headers.entries()].sort())}|${await r.text()}`;

describe("day 27 part 3 | the browser cannot supply creative content or a destination", () => {
  const injected = {
    headline: EVIL_HEADLINE, body: "HACKED-BODY", cta_text: "HACKED-CTA", destination_url: EVIL,
    url: EVIL, redirect: EVIL, creative: JSON.stringify({ headline: EVIL_HEADLINE, destination_url: EVIL }), html: "<script>alert(1)</script>", provider: "evil",
  };
  const query = new URLSearchParams(injected).toString();
  const requests: Array<[string, Request]> = [
    ["query string", new Request(`https://app.example.com/api/revive-json-preview?${query}`)],
    ["repeated/array-style query", new Request(`https://app.example.com/api/revive-json-preview?destination_url=${encodeURIComponent(EVIL)}&destination_url[]=${encodeURIComponent(EVIL)}&headline[]=x`)],
    ["hostile headers + cookie", new Request("https://app.example.com/api/revive-json-preview", {
      headers: { cookie: `headline=${EVIL_HEADLINE}; destination_url=${EVIL}`, "x-destination-url": EVIL, "x-headline": EVIL_HEADLINE, referer: EVIL, origin: EVIL, host: "evil.example.org", "x-forwarded-host": "evil.example.org", authorization: "Bearer x" },
    })],
    ["JSON body on GET-like request", new Request("https://app.example.com/api/revive-json-preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(injected) })],
    ["form body", new Request("https://app.example.com/api/revive-json-preview", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: query })],
  ];

  it("enabled: every browser-supplied variant yields exactly the fixed fixture, byte-for-byte the same as a plain call", async () => {
    process.env.REVIVE_JSON_PREVIEW_ENABLED = "true";
    const baseline = await snap(await callRoute());
    assert.deepEqual(JSON.parse(baseline.split("|").slice(2).join("|")), defaultPreviewProvider());
    for (const [name, req] of requests) {
      const out = await snap(await callRoute(req));
      assert.equal(out, baseline, name);
      for (const s of [EVIL_HEADLINE, "HACKED", "evil.example.org", "evil", "<script"]) assert.ok(!out.includes(s), `${name}: ${s}`);
    }
  });

  it("disabled: browser input cannot enable the route or change the fixed 404 (query, headers, cookies, body, even REVIVE_JSON_PREVIEW_ENABLED=true in the URL)", async () => {
    const withFlags = new Request(`https://app.example.com/api/revive-json-preview?REVIVE_JSON_PREVIEW_ENABLED=true&enabled=true&${query}`, {
      headers: { cookie: "REVIVE_JSON_PREVIEW_ENABLED=true", "x-revive-json-preview-enabled": "true" },
    });
    const baseline = await snap(await callRoute());
    assert.equal(baseline.split("|").slice(2).join("|"), NOT_FOUND);
    for (const [name, req] of [...requests, ["flags in url/cookie/header", withFlags] as [string, Request]]) {
      assert.equal(await snap(await callRoute(req)), baseline, name);
    }
  });

  it("the returned destination is always the fixed https example.com fixture URL and never a browser value or a Blisscco redirect", async () => {
    process.env.REVIVE_JSON_PREVIEW_ENABLED = "true";
    for (const [name, req] of requests) {
      const body = JSON.parse(await (await callRoute(req)).text()) as { destination_url: string };
      assert.equal(body.destination_url, "https://example.com/blisscco-revive-test-fixture", name);
      assert.equal(new URL(body.destination_url).hostname, "example.com");
    }
  });

  it("only GET is exported: POST/PUT/PATCH/DELETE/HEAD/OPTIONS do not exist, so a browser body can never be handled", () => {
    assert.deepEqual(Object.keys(route).sort(), ["GET", "dynamic", "runtime"]);
    for (const m of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) assert.equal((route as Record<string, unknown>)[m], undefined, m);
  });

  it("the route takes no parameters and the handler passes the provider none (creative can only come from server code)", async () => {
    assert.equal(route.GET.length, 0);
    const argCounts: number[] = [];
    await handlePreviewGet({
      env: { REVIVE_JSON_PREVIEW_ENABLED: "true" },
      provider: (...a: unknown[]) => { argCounts.push(a.length); return defaultPreviewProvider(); },
    });
    assert.deepEqual(argCounts, [0]);
  });

  it("a hostile request object (every property access throws) cannot break or steer the route", async () => {
    process.env.REVIVE_JSON_PREVIEW_ENABLED = "true";
    const hostile = new Proxy({}, { get() { throw new Error("touched"); }, has() { throw new Error("touched"); }, ownKeys() { throw new Error("touched"); } });
    const baseline = await snap(await callRoute());
    assert.equal(await snap(await callRoute(hostile)), baseline);
  });

  it("source: no browser-input API is used anywhere in the route or the preview handler", () => {
    for (const f of [ROUTE, PREVIEW_LIB]) {
      assert.doesNotMatch(code(f), /searchParams|URLSearchParams|new URL|\brequest\b|\breq\b|\.url\b|\.json\(|\.text\(|\.formData\(|\.headers|cookies|next\/headers|params\b|nextUrl|NextRequest/i, f);
    }
  });
});

describe("day 27 part 3 | the fixture is isolated from live ad serving", () => {
  const LIVE = ["lib/ads/service.ts", "lib/ads/fallback-routing.ts", "app/api/v1/ads/match/route.ts"];
  const LIVE_PATTERN = /(^|\/)(service|fallback-routing|fallback-provider|match-handler|serve|serve-db|selection|revive-adapter|click|click-db|impression|impression-db|tracking-token)$|app\/api\/v1\/|\/ads\/match/;

  it("preview route and preview handler import only each other / the contract validator (nothing from live serving)", () => {
    assert.deepEqual(importsOf(ROUTE), ["@/lib/ads/revive-json-preview"]);
    assert.deepEqual(importsOf(PREVIEW_LIB), ["./revive-json-endpoint-contract"]);
    for (const spec of [...importsOf(ROUTE), ...importsOf(PREVIEW_LIB)]) assert.doesNotMatch(spec, LIVE_PATTERN, spec);
  });

  it("service.ts, fallback-routing.ts and the v1 match route do not import or mention the preview route, handler, placeholder or flag", () => {
    for (const f of [...LIVE, "lib/ads/match-handler.ts", "lib/ads/fallback-provider.ts", "lib/ads/revive-adapter.ts"]) {
      assert.doesNotMatch(code(f), /revive-json-preview|REVIVE_JSON_PREVIEW|handlePreviewGet|defaultPreviewProvider|getPlaceholderPreviewCreative/, f);
    }
  });

  it("loading the preview route pulls in NO live-serving module (checked in a clean process through the real module graph)", () => {
    const entry = path.join(BUILD, "app", "api", "revive-json-preview", "route.js");
    const script = `require(${JSON.stringify(entry)}); process.stdout.write(JSON.stringify(Object.keys(require.cache)));`;
    const out = spawnSync(process.execPath, ["--require", path.join(ROOT, "tests", "register.cjs"), "-e", script], { cwd: ROOT, encoding: "utf8" });
    assert.equal(out.status, 0, out.stderr);
    const loaded = (JSON.parse(out.stdout) as string[]).map((f) => f.split(path.sep).join("/"));
    const mine = loaded.filter((f) => f.includes("/.test-build/"));
    assert.ok(mine.some((f) => f.endsWith("app/api/revive-json-preview/route.js")));
    assert.ok(mine.some((f) => f.endsWith("lib/ads/revive-json-preview.js")));
    for (const bad of ["lib/ads/service", "lib/ads/fallback-routing", "lib/ads/fallback-provider", "lib/ads/revive-adapter", "lib/ads/match-handler", "app/api/v1/", "lib/ads/serve", "lib/ads/selection", "lib/ads/click-db", "lib/ads/impression", "lib/ads/candidate-loader", "lib/ledger", "lib/payouts", "supabase"]) {
      assert.ok(!mine.some((f) => f.includes(bad)), `preview route loaded ${bad}`);
    }
    // Exact set: the route, its handler, and the pure validators the Day 25 contract already depends on (URL/text rules, token/ref helpers). No DB, serving or fallback module.
    assert.deepEqual(mine.map((f) => f.split("/.test-build/")[1]).sort(), [
      "app/api/revive-json-preview/route.js", "lib/ads/revive-json-preview.js", "lib/ads/revive-json-endpoint-contract.js", "lib/ads/click.js",
      "lib/accounts/validation.js", "lib/campaigns/constants.js", "lib/ads/tracking-token.js", "lib/ads/click-ref.js", "lib/ads/provider-adapter.js", "lib/campaigns/creative-validation.js",
    ].sort(), "exact set of loaded project modules");
  });

  it("the Revive fallback flag stays OFF and is independent: the preview flag does not enable fallback and fallback flags do not enable the preview", async () => {
    process.env.REVIVE_JSON_PREVIEW_ENABLED = "true";
    assert.equal(process.env.REVIVE_FALLBACK_ENABLED, undefined);
    assert.equal(reviveFallbackEnabled(process.env), false);
    delete process.env.REVIVE_JSON_PREVIEW_ENABLED;
    process.env.REVIVE_FALLBACK_ENABLED = "true";
    process.env.REVIVE_DELIVERY_URL = "https://x.example.com/ad.json";
    assert.equal((await callRoute()).status, 404);
  });

  it("the route's response is never wired into serving: enabled preview makes no fetch, no DB call, and returns no tracking/click/impression data", async () => {
    process.env.REVIVE_JSON_PREVIEW_ENABLED = "true";
    const text = await (await callRoute()).text();
    assert.ok(!/tracking|click_ref|token|impression|serve_ref|revive_[0-9a-f]{8}/i.test(text), text);
    assert.deepEqual(Object.keys(JSON.parse(text) as object), ["headline", "body", "cta_text", "destination_url"]);
    assert.equal(fetchCalls, 0);
  });
});
