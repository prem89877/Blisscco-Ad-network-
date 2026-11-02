// Day 26 Part 1: the test-only Revive provider harness works for all 7 scenarios and cannot be enabled through the production match route by default.
// Only in-memory fakes: no real network, database, SQL, Revive server or billing. Asli adapter / fallback-provider / match route chalte hain.
import {
  HARNESS_ADAPTER_CONFIG, HARNESS_CREATIVE, HARNESS_DELIVERY_URL, HARNESS_ERROR_MARKER, HARNESS_EXPECTED, HARNESS_FALLBACK_ENV,
  HARNESS_SCENARIOS, HARNESS_UNSAFE_DESTINATION, createProviderHarness, type HarnessScenario,
} from "./helpers/day26-revive-provider-harness";
import { createReviveAdapter, extractReviveCreative } from "@/lib/ads/revive-adapter";
import { providerFallbackFromEnv, publicAdFromFallbackFill } from "@/lib/ads/fallback-provider";
import { db, installDb } from "../workflows/publisher-flow-stubs";
import { setupPublisher } from "@/app/dashboard/account/actions";
import { createKey } from "@/app/dashboard/publisher/actions";
import { adminDecision } from "@/app/dashboard/admin/actions";
import * as v1Route from "@/app/api/v1/ads/match/route";
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const HARNESS_FILE = "tests/ads/helpers/day26-revive-provider-harness.ts";
const idle = { status: "idle" } as never;
const PUBLIC_AD_FIELDS = ["id", "headline", "body", "cta_text", "destination_url"];
const ENV_KEYS = ["REVIVE_FALLBACK_ENABLED", "REVIVE_DELIVERY_URL", "REVIVE_TIMEOUT_MS", "REVIVE_RESPONSE_FORMAT", "REVIVE_JSON_PREVIEW_ENABLED"] as const;

const realFetch = globalThis.fetch;
const realConsole = { error: console.error, log: console.log, warn: console.warn, info: console.info };
const savedEnv: Record<string, string | undefined> = {};
let logs: unknown[][] = [];
let realFetchCalls = 0;
let ipCounter = 0;

const envSnapshot = () => JSON.stringify(ENV_KEYS.map((k) => [k, process.env[k] ?? null]));

beforeEach(() => {
  db.reset();
  installDb();
  logs = [];
  realFetchCalls = 0;
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  const sink = (...a: unknown[]) => void logs.push(a);
  console.error = sink; console.log = sink; console.warn = sink; console.info = sink;
  // Sentinel: if anything reaches the "real" fetch, the test fails.
  globalThis.fetch = (async () => { realFetchCalls += 1; throw new Error("test: real fetch must never be used"); }) as typeof fetch;
});
afterEach(() => {
  Object.assign(console, realConsole);
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  const text = JSON.stringify(logs);
  assert.ok(!text.includes(HARNESS_ERROR_MARKER) && !text.includes(HARNESS_DELIVERY_URL) && !text.includes("day26-harness"), "harness data leaked into a log");
  assert.equal(realFetchCalls, 0, "real fetch was called");
});

describe("day 26 part 1 | fixtures are clearly test-only", () => {
  it("scenario list is exactly the 7 required scenarios", () => {
    assert.deepEqual([...HARNESS_SCENARIOS], ["valid-fill", "no-fill", "timeout", "malformed-json", "unsafe-destination", "oversized-body", "provider-failure"]);
    assert.deepEqual(Object.keys(HARNESS_EXPECTED).sort(), [...HARNESS_SCENARIOS].sort());
  });

  it("delivery URL uses the reserved .invalid host (can never resolve); creative text says TEST ONLY; constants are frozen", () => {
    assert.equal(new URL(HARNESS_DELIVERY_URL).hostname.endsWith(".invalid"), true);
    assert.match(HARNESS_CREATIVE.headline, /TEST ONLY/);
    assert.match(HARNESS_CREATIVE.body, /TEST ONLY/);
    assert.match(HARNESS_CREATIVE.cta_text, /TEST ONLY/);
    assert.equal(new URL(HARNESS_CREATIVE.destination_url).hostname, "example.com");
    for (const o of [HARNESS_CREATIVE, HARNESS_ADAPTER_CONFIG, HARNESS_FALLBACK_ENV, HARNESS_EXPECTED]) assert.ok(Object.isFrozen(o));
  });

  it("harness source: no env/process access, no server, socket or network API, no real-fetch call, no production import beyond types", () => {
    const src = code(HARNESS_FILE);
    for (const bad of [/\bprocess\b/, /\.env\b/, /node:(http|https|net|tls|dgram|child_process|dns)/, /createServer|\.listen\(|XMLHttpRequest|WebSocket|EventSource/, /\brequire\(/, /globalThis\.fetch\s*\(/, /\bfetch\(/, /\bimport\(/]) {
      assert.ok(!bad.test(src), `forbidden pattern in harness: ${bad}`);
    }
    const imports = src.match(/^import .*$/gm) ?? [];
    assert.deepEqual(imports, ['import type { ReviveFetcher, ReviveFetchResponse } from "@/lib/ads/revive-adapter";']);
    assert.ok(!/SECRET|API_KEY|TOKEN|PASSWORD|blc_live_/i.test(src), "no credential-looking names");
  });

  it("creating, using and installing the harness never changes REVIVE_* / preview env values", async () => {
    const before = envSnapshot();
    for (const s of HARNESS_SCENARIOS) {
      const h = createProviderHarness(s);
      await createReviveAdapter(HARNESS_ADAPTER_CONFIG, { fetcher: h.fetcher }).requestFill();
      const restore = h.installAsGlobalFetch();
      restore();
    }
    assert.equal(envSnapshot(), before);
    assert.equal(process.env.REVIVE_FALLBACK_ENABLED, undefined);
  });
});

describe("day 26 part 1 | every scenario through the real adapter", () => {
  for (const scenario of HARNESS_SCENARIOS) {
    it(`${scenario}: matches the expected adapter outcome with exactly one safe request`, async () => {
      const h = createProviderHarness(scenario);
      const out = await createReviveAdapter(HARNESS_ADAPTER_CONFIG, { fetcher: h.fetcher }).requestFill();
      const expected = HARNESS_EXPECTED[scenario];
      assert.equal(out.status, expected.status);
      if (out.status === "no-fill") assert.equal(out.reason, expected.reason);
      assert.equal(h.calls.length, 1);
      assert.equal(h.unexpectedCalls, 0);
      assert.deepEqual(h.calls[0], { method: "GET", redirect: "error", credentials: "omit", cache: "no-store", headerNames: ["accept"], accept: "application/json" });
      const text = JSON.stringify(out);
      assert.ok(!text.includes(HARNESS_ERROR_MARKER) && !text.includes("day26-harness"), "result leaked provider data");
    });
  }

  it("valid-fill: payload is exactly the Day 25 contract object and extracts to a creative", async () => {
    const h = createProviderHarness("valid-fill");
    const out = await createReviveAdapter(HARNESS_ADAPTER_CONFIG, { fetcher: h.fetcher }).requestFill();
    assert.equal(out.status, "fill");
    if (out.status !== "fill" || out.format !== "json") throw new Error("expected json fill");
    assert.deepEqual(out.payload, HARNESS_CREATIVE);
    assert.equal(extractReviveCreative(out).ok, true);
  });

  it("timeout: the adapter aborts the request and answers no-fill (no hang)", async () => {
    const h = createProviderHarness("timeout");
    const out = await createReviveAdapter(HARNESS_ADAPTER_CONFIG, { fetcher: h.fetcher }).requestFill();
    assert.deepEqual({ ...out }, { status: "no-fill", reason: "timeout" });
    assert.equal(h.abortObserved, true);
  });

  it("unsafe-destination: the harness really sends an http:// destination, and it is rejected", async () => {
    const h = createProviderHarness("unsafe-destination");
    const raw = await (await h.fetch(HARNESS_DELIVERY_URL, { method: "GET" })).text();
    assert.ok(raw.includes(HARNESS_UNSAFE_DESTINATION) && HARNESS_UNSAFE_DESTINATION.startsWith("http://"));
    const out = await createReviveAdapter(HARNESS_ADAPTER_CONFIG, { fetcher: h.fetcher }).requestFill();
    assert.equal(out.status, "no-fill");
  });

  it("oversized-body: really larger than 65,536 bytes", async () => {
    const h = createProviderHarness("oversized-body");
    const bytes = new TextEncoder().encode(await (await h.fetch(HARNESS_DELIVERY_URL, { method: "GET" })).text()).byteLength;
    assert.ok(bytes > 65536, String(bytes));
  });

  it("deterministic: two runs of every scenario give identical results", async () => {
    for (const s of HARNESS_SCENARIOS) {
      const a = await createReviveAdapter(HARNESS_ADAPTER_CONFIG, { fetcher: createProviderHarness(s).fetcher }).requestFill();
      const b = await createReviveAdapter(HARNESS_ADAPTER_CONFIG, { fetcher: createProviderHarness(s).fetcher }).requestFill();
      assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), s);
    }
  });

  it("refuses any URL other than its own test-only URL (cannot be pointed at a real host)", async () => {
    const h = createProviderHarness("valid-fill");
    const out = await createReviveAdapter({ ...HARNESS_ADAPTER_CONFIG, deliveryUrl: "https://real-provider.example.net/serve?key=SECRETKEY99" }, { fetcher: h.fetcher }).requestFill();
    assert.deepEqual({ ...out }, { status: "no-fill", reason: "network_error" });
    assert.equal(h.unexpectedCalls, 1);
    assert.equal(h.calls.length, 0);
    assert.ok(!JSON.stringify(out).includes("SECRETKEY99"));
  });
});

describe("day 26 part 1 | every scenario through the fallback provider + public mapping", () => {
  for (const scenario of HARNESS_SCENARIOS) {
    it(`${scenario}: providerFallbackFromEnv -> publicAdFromFallbackFill`, async () => {
      const h = createProviderHarness(scenario);
      const provider = providerFallbackFromEnv(HARNESS_FALLBACK_ENV, { fetcher: h.fetcher });
      assert.equal(provider.isEnabled(), true);
      const outcome = await provider.request();
      if (scenario === "valid-fill") {
        assert.deepEqual(outcome, { provider: "revive", format: "json", data: HARNESS_CREATIVE });
        const ad = publicAdFromFallbackFill(outcome);
        assert.ok(ad !== null);
        assert.equal(ad!.sponsored, true);
        assert.deepEqual(Object.keys(ad!.ad).sort(), [...PUBLIC_AD_FIELDS].sort());
        assert.match(String(ad!.ad.id), /^revive_[0-9a-f]{8}$/);
        assert.ok(!("tracking" in ad!));
      } else {
        assert.equal(outcome, null);
        assert.equal(publicAdFromFallbackFill(outcome), null);
      }
      assert.equal(h.calls.length, 1);
    });
  }

  it("with an empty env record the provider is disabled and the harness is never called", async () => {
    const h = createProviderHarness("valid-fill");
    const provider = providerFallbackFromEnv({}, { fetcher: h.fetcher });
    assert.equal(provider.isEnabled(), false);
    assert.equal(await provider.request(), null);
    assert.equal(h.calls.length, 0);
  });
});

// --- Production match route (real route -> match-handler -> service -> fallback-provider -> adapter), in-memory db ---
function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}
async function run<T>(p: Promise<T>): Promise<void> {
  try { await p; } catch (e) { if (!/^REDIRECT:/.test(e instanceof Error ? e.message : "")) throw e; }
}
async function activeKey(): Promise<string> {
  await run(setupPublisher(idle, form({ name: "My Bot", websiteUrl: "https://bot.example.com", category: "gaming" })));
  await run(adminDecision(idle, form({ kind: "publisher", id: db.publisher!.id, decision: "active" })));
  return ((await createKey(idle, form({ label: "Prod server", expiry: "90" }))) as { newKey: string }).newKey;
}
async function match(key: string): Promise<Response> {
  return v1Route.POST(new Request("https://blisscco.test/api/v1/ads/match", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "x-forwarded-for": `10.26.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}` },
    body: '{"topic":"gaming"}',
  }));
}

describe("day 26 part 1 | the harness cannot be enabled through the production match route by default", () => {
  it("default (no REVIVE_* env): even with the harness installed as global fetch, the route stays no-fill and never calls it", async () => {
    const key = await activeKey();
    for (const scenario of HARNESS_SCENARIOS) {
      const h = createProviderHarness(scenario);
      const restore = h.installAsGlobalFetch();
      try {
        const res = await match(key);
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { fill: false }, scenario);
      } finally { restore(); }
      assert.equal(h.calls.length, 0, scenario);
      assert.equal(h.unexpectedCalls, 0, scenario);
    }
  });

  it("the harness env record alone changes nothing: process.env stays untouched and the route stays no-fill", async () => {
    const key = await activeKey();
    const h = createProviderHarness("valid-fill");
    const restore = h.installAsGlobalFetch();
    try {
      void HARNESS_FALLBACK_ENV; // importing/holding the record does not enable anything
      assert.equal(process.env.REVIVE_FALLBACK_ENABLED, undefined);
      assert.equal("REVIVE_DELIVERY_URL" in process.env, false); // presence only: a failure message must never echo the value
      assert.deepEqual(await (await match(key)).json(), { fill: false });
    } finally { restore(); }
    assert.equal(h.calls.length, 0);
  });

  it("flag set to anything but exact 'true' keeps the route off even with the harness URL configured", async () => {
    const key = await activeKey();
    const h = createProviderHarness("valid-fill");
    const restore = h.installAsGlobalFetch();
    try {
      for (const v of ["", "1", "TRUE", "yes", " true", "false"]) {
        process.env.REVIVE_FALLBACK_ENABLED = v;
        process.env.REVIVE_DELIVERY_URL = HARNESS_DELIVERY_URL;
        assert.deepEqual(await (await match(key)).json(), { fill: false }, v);
      }
    } finally { restore(); }
    assert.equal(h.calls.length, 0);
  });

  it("production source never imports or references the harness (lib/, app/, components/, middleware, config)", () => {
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(join(ROOT, dir))) {
        const rel = `${dir}/${name}`;
        const st = statSync(join(ROOT, rel));
        if (st.isDirectory()) { if (name !== "node_modules") walk(rel); continue; }
        if (!/\.(ts|tsx|js|mjs|cjs)$/.test(name)) continue;
        if (/day26|provider-harness|tests\/ads\/helpers/i.test(read(rel))) hits.push(rel);
      }
    };
    for (const d of ["lib", "app", "components", "config"]) walk(d);
    for (const f of ["middleware.ts", "next.config.mjs"]) if (/day26|provider-harness|tests\/ads\/helpers/i.test(read(f))) hits.push(f);
    assert.deepEqual(hits, []);
  });

  it("production route/service read the flag from process.env only (default OFF), not from anything the harness exports", () => {
    const service = code("lib/ads/service.ts");
    assert.ok(/providerFallbackFromEnv\(process\.env\)/.test(service));
    assert.ok(!/HARNESS|harness/.test(service + code("lib/ads/fallback-provider.ts") + code("lib/ads/revive-adapter.ts") + code("lib/ads/match-handler.ts") + code("app/api/v1/ads/match/route.ts")));
  });

  it("explicit opt-in control: only when the TEST itself sets the flag + harness URL does the route reach the harness (valid-fill => sponsored ad, others => no-fill)", async () => {
    const key = await activeKey();
    for (const scenario of HARNESS_SCENARIOS) {
      process.env.REVIVE_FALLBACK_ENABLED = "true";
      process.env.REVIVE_DELIVERY_URL = HARNESS_DELIVERY_URL;
      process.env.REVIVE_TIMEOUT_MS = "25";
      const h = createProviderHarness(scenario);
      const restore = h.installAsGlobalFetch();
      let body: Record<string, unknown>;
      try { body = (await (await match(key)).json()) as Record<string, unknown>; } finally { restore(); }
      assert.equal(h.calls.length, 1, scenario);
      if (scenario === "valid-fill") {
        assert.equal(body.fill, true);
        assert.equal(body.sponsored, true);
        assert.deepEqual(Object.keys(body.ad as object).sort(), [...PUBLIC_AD_FIELDS].sort());
        assert.ok(!("tracking" in body));
      } else {
        assert.deepEqual(body, { fill: false }, scenario);
      }
      const text = JSON.stringify(body);
      assert.ok(!text.includes(HARNESS_ERROR_MARKER) && !text.includes("day26-harness"), "public response leaked provider data");
    }
    assert.deepEqual(db.serves, []);
    assert.ok(!db.rpcCalls.some((c) => /ledger|payout|earning|impression|click/i.test(c.name)));
  });
});
