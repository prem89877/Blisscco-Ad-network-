// Day 26 Part 2: complete Blisscco-first / Revive-fallback match flow, using the REAL v1 route -> match-handler -> service -> fallback-routing ->
// fallback-provider -> revive-adapter chain, an in-memory database (tests/workflows stubs) and the Day 26 provider harness (no network, no real Revive).
// Existing DI patterns: routeServeWithFallback(deps) for ordering; globalThis.fetch + process.env (the production wiring) for end-to-end, both restored after every test.
import {
  HARNESS_CREATIVE, HARNESS_DELIVERY_URL, HARNESS_ERROR_MARKER, HARNESS_FALLBACK_ENV, HARNESS_SCENARIOS, HARNESS_UNSAFE_DESTINATION,
  createProviderHarness, type HarnessScenario, type ProviderHarness,
} from "./helpers/day26-revive-provider-harness";
import { routeServeWithFallback, fallbackAllowedFor } from "@/lib/ads/fallback-routing";
import { providerFallbackFromEnv } from "@/lib/ads/fallback-provider";
import type { ServeResult } from "@/lib/ads/serve";
import type { MatchRequest } from "@/lib/ads/types";
import { db, installDb, type Camp, type Creative } from "../workflows/publisher-flow-stubs";
import { setupPublisher } from "@/app/dashboard/account/actions";
import { createKey } from "@/app/dashboard/publisher/actions";
import { adminDecision } from "@/app/dashboard/admin/actions";
import * as v1Route from "@/app/api/v1/ads/match/route";
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

const idle = { status: "idle" } as never;
const PUBLIC_AD_FIELDS = ["id", "headline", "body", "cta_text", "destination_url"].sort();
const ENV_KEYS = ["REVIVE_FALLBACK_ENABLED", "REVIVE_DELIVERY_URL", "REVIVE_TIMEOUT_MS", "REVIVE_RESPONSE_FORMAT"] as const;
const FAILURE_SCENARIOS = HARNESS_SCENARIOS.filter((s) => s !== "valid-fill");
// Strings that must never appear in any public response body or header.
const INTERNAL_STRINGS = [
  HARNESS_DELIVERY_URL, "day26-harness", ".invalid", HARNESS_ERROR_MARKER, HARNESS_UNSAFE_DESTINATION, "REVIVE_", "revive.", "SECRETKEY",
  "timeout", "http_error", "bad_response", "too_large", "empty_response", "network_error", "invalid_config", "bad_content_type", "no_fetcher", "disabled",
];

const savedEnv: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
const realConsole = { error: console.error, log: console.log, warn: console.warn, info: console.info };
let logs: unknown[][] = [];
let realFetchCalls = 0;
let ipCounter = 0;
let harness: ProviderHarness;
let restoreFetch: () => void = () => undefined;

function setEnv(over: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}): void {
  process.env.REVIVE_FALLBACK_ENABLED = "true";
  process.env.REVIVE_DELIVERY_URL = HARNESS_DELIVERY_URL;
  process.env.REVIVE_TIMEOUT_MS = "25";
  for (const [k, v] of Object.entries(over)) process.env[k] = v;
}
/** Installs the harness for a scenario as the global fetch (the production provider path uses it). Restored in afterEach. */
function useHarness(scenario: HarnessScenario): ProviderHarness {
  restoreFetch();
  harness = createProviderHarness(scenario);
  restoreFetch = harness.installAsGlobalFetch();
  return harness;
}

beforeEach(() => {
  db.reset();
  installDb();
  logs = [];
  realFetchCalls = 0;
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  const sink = (...a: unknown[]) => void logs.push(a);
  console.error = sink; console.log = sink; console.warn = sink; console.info = sink;
  globalThis.fetch = (async () => { realFetchCalls += 1; throw new Error("test: real fetch must never be used"); }) as typeof fetch;
  harness = createProviderHarness("valid-fill");
  restoreFetch = () => undefined;
});
afterEach(() => {
  restoreFetch();
  Object.assign(console, realConsole);
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  const text = JSON.stringify(logs);
  for (const s of ["day26-harness", HARNESS_ERROR_MARKER, HARNESS_UNSAFE_DESTINATION]) assert.ok(!text.includes(s), `leaked into a log: ${s}`);
  assert.equal(realFetchCalls, 0, "real fetch was called");
});

// ---------- helpers (same pattern as day22-part6) ----------
function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}
async function run(p: Promise<unknown>): Promise<unknown> {
  try { return await p; } catch (e) { if (/^REDIRECT:/.test(e instanceof Error ? e.message : "")) return undefined; throw e; }
}
async function activeKey(): Promise<string> {
  await run(setupPublisher(idle, form({ name: "My Bot", websiteUrl: "https://bot.example.com", category: "gaming" })));
  await run(adminDecision(idle, form({ kind: "publisher", id: db.publisher!.id, decision: "active" })));
  return ((await createKey(idle, form({ label: "Prod server", expiry: "90" }))) as { newKey: string }).newKey;
}
function addAd(over: { camp?: Partial<Camp>; cr?: Partial<Creative> } = {}): void {
  const campaignId = db.id();
  db.campaigns.push({ id: campaignId, status: "active", category: "gaming", startDate: "2020-01-01", endDate: null, totalBudget: 100, dailyBudget: null, spentTotal: 0, spentToday: 0, ...over.camp });
  db.creatives.push({ id: db.id(), campaignId, status: "approved", headline: "Visible headline", body: "Body text", ctaText: "Play", destinationUrl: "https://games.example.com/x", ...over.cr });
}
async function match(key: string | null, over: { body?: string; headers?: Record<string, string>; omitContentType?: boolean } = {}): Promise<Response> {
  const headers: Record<string, string> = {
    ...(over.omitContentType ? {} : { "content-type": "application/json" }),
    "x-forwarded-for": `10.26.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`,
    ...(key === null ? {} : { authorization: `Bearer ${key}` }),
    ...over.headers,
  };
  return v1Route.POST(new Request("https://blisscco.test/api/v1/ads/match", { method: "POST", headers, body: over.body ?? '{"topic":"gaming"}' }));
}
const serveRpcs = () => db.rpcCalls.filter((c) => c.name === "record_ad_serve").length;
const headerText = (res: Response) => JSON.stringify([...res.headers.entries()]);

/** Every public response (body + headers) must be free of provider URL, raw provider body, credentials and internal reasons. */
async function assertNoInternalExposure(res: Response, key: string | null): Promise<string> {
  const body = await res.text();
  // "payload_too_large" is the documented PUBLIC 413 error code, not the provider reason "too_large".
  const all = `${body}\n${headerText(res)}`.split("payload_too_large").join("");
  for (const s of INTERNAL_STRINGS) assert.ok(!all.includes(s), `public response exposes: ${s}`);
  if (key) assert.ok(!all.includes(key), "public response echoes the API key");
  return body;
}

describe("day 26 part 2 | Blisscco eligible fill always wins", () => {
  for (const scenario of HARNESS_SCENARIOS) {
    it(`flag ON + provider scenario '${scenario}': the Blisscco ad is served and charged once; the provider is never called`, async () => {
      const key = await activeKey();
      addAd();
      setEnv();
      const h = useHarness(scenario);
      const res = await match(key);
      assert.equal(res.status, 200);
      const text = await assertNoInternalExposure(res, key);
      const body = JSON.parse(text) as { fill: boolean; sponsored: boolean; ad: Record<string, unknown>; tracking?: unknown };
      assert.deepEqual(Object.keys(body).sort(), ["ad", "fill", "sponsored"]);
      assert.equal(body.fill, true);
      assert.equal(body.sponsored, true);
      assert.deepEqual(Object.keys(body.ad).sort(), PUBLIC_AD_FIELDS);
      assert.equal(body.ad.headline, "Visible headline");
      assert.ok(!String(body.ad.id).startsWith("revive_"));
      assert.equal(h.calls.length, 0);
      assert.equal(h.unexpectedCalls, 0);
      assert.equal(serveRpcs(), 1);
      assert.ok(Math.abs(db.campaigns[0].spentTotal - 0.002) < 1e-9);
    });
  }

  it("routing order (DI): serve runs first; the provider runs only after a genuine no_fill", async () => {
    const order: string[] = [];
    const h = createProviderHarness("valid-fill");
    const provider = providerFallbackFromEnv(HARNESS_FALLBACK_ENV, { fetcher: h.fetcher });
    const request = { topic: "gaming" } as unknown as MatchRequest;
    const route = (result: ServeResult | "throw", isEnabled = () => true) =>
      routeServeWithFallback("hash", request, {
        serve: async () => { order.push("serve"); if (result === "throw") throw new Error("boom"); return result; },
        isEnabled,
        request: async () => { order.push("provider"); return provider.request(); },
      });

    const noFill = await route({ kind: "no_fill" });
    assert.deepEqual(order, ["serve", "provider"]);
    assert.equal(noFill.source, "provider");
    assert.deepEqual(noFill.source === "provider" ? noFill.blisscco : null, { charged: false, serveRecorded: false, impressionClaimed: false });

    for (const other of [{ kind: "unauthorized" }, { kind: "rate_limited" }, { kind: "unavailable" }, "throw"] as Array<ServeResult | "throw">) {
      order.length = 0;
      const out = await route(other);
      assert.deepEqual(order, ["serve"], JSON.stringify(other));
      assert.equal(out.source, "blisscco");
    }
    assert.equal(h.calls.length, 1);
  });
});

describe("day 26 part 2 | Revive only after Blisscco no-fill AND only with the server flag", () => {
  it("flag ON + Blisscco no-fill + valid provider fill => sponsored provider ad, exact public fields, no tracking, nothing charged or recorded", async () => {
    const key = await activeKey();
    setEnv();
    const h = useHarness("valid-fill");
    db.rpcCalls = [];
    const res = await match(key);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("vary"), "Authorization");
    assert.equal(res.headers.get("x-blisscco-api-version"), "1");
    assert.match(res.headers.get("content-type") ?? "", /^application\/json/);
    const text = await assertNoInternalExposure(res, key);
    const body = JSON.parse(text) as { fill: boolean; sponsored: boolean; ad: Record<string, unknown> };
    assert.deepEqual(Object.keys(body).sort(), ["ad", "fill", "sponsored"]);
    assert.equal(body.fill, true);
    assert.equal(body.sponsored, true);
    assert.deepEqual(Object.keys(body.ad).sort(), PUBLIC_AD_FIELDS);
    assert.match(String(body.ad.id), /^revive_[0-9a-f]{8}$/);
    assert.equal(body.ad.headline, HARNESS_CREATIVE.headline);
    assert.equal(body.ad.body, HARNESS_CREATIVE.body);
    assert.equal(body.ad.cta_text, HARNESS_CREATIVE.cta_text);
    assert.equal(body.ad.destination_url, HARNESS_CREATIVE.destination_url);
    assert.equal(h.calls.length, 1);
    assert.equal(serveRpcs(), 0);
    assert.deepEqual(db.serves, []);
    assert.ok(!db.rpcCalls.some((c) => /ledger|payout|earning|impression|click/i.test(c.name)));
  });

  for (const scenario of FAILURE_SCENARIOS) {
    it(`flag ON + Blisscco no-fill + provider '${scenario}' => exactly {"fill":false}, one provider attempt, no internal reason exposed`, async () => {
      const key = await activeKey();
      setEnv();
      const h = useHarness(scenario);
      const res = await match(key);
      assert.equal(res.status, 200);
      assert.equal(await assertNoInternalExposure(res, key), '{"fill":false}');
      assert.equal(h.calls.length, 1);
      assert.equal(serveRpcs(), 0);
    });
  }

  it("flag OFF (unset or any value but exact 'true') + Blisscco no-fill => {fill:false}; the provider is never called", async () => {
    const key = await activeKey();
    const h = useHarness("valid-fill");
    assert.equal(await (await match(key)).text(), '{"fill":false}');
    for (const v of ["", "1", "TRUE", "yes", " true", "false"]) {
      process.env.REVIVE_FALLBACK_ENABLED = v;
      process.env.REVIVE_DELIVERY_URL = HARNESS_DELIVERY_URL;
      assert.equal(await (await match(key)).text(), '{"fill":false}', v);
    }
    assert.equal(h.calls.length, 0);
  });

  it("flag ON but config invalid (URL missing / http / bad timeout / bad format) => {fill:false} and no request is made", async () => {
    const key = await activeKey();
    const h = useHarness("valid-fill");
    process.env.REVIVE_FALLBACK_ENABLED = "true";
    assert.equal(await (await match(key)).text(), '{"fill":false}');
    process.env.REVIVE_DELIVERY_URL = "http://day26-harness.invalid/test-only/ad.json";
    assert.equal(await (await match(key)).text(), '{"fill":false}');
    process.env.REVIVE_DELIVERY_URL = HARNESS_DELIVERY_URL;
    process.env.REVIVE_TIMEOUT_MS = "abc";
    assert.equal(await (await match(key)).text(), '{"fill":false}');
    process.env.REVIVE_TIMEOUT_MS = "25";
    process.env.REVIVE_RESPONSE_FORMAT = "xml";
    assert.equal(await (await match(key)).text(), '{"fill":false}');
    assert.equal(h.calls.length, 0);
    assert.equal(h.unexpectedCalls, 0);
  });

  it("flag ON + a URL that is not the harness URL => no-fill, the harness refuses it, and the real URL/key text is never exposed", async () => {
    const key = await activeKey();
    setEnv({ REVIVE_DELIVERY_URL: "https://real-provider.example.net/serve?key=SECRETKEY99" });
    const h = useHarness("valid-fill");
    const res = await match(key);
    assert.equal(await assertNoInternalExposure(res, key), '{"fill":false}');
    assert.equal(h.unexpectedCalls, 1);
    assert.equal(h.calls.length, 0);
  });

  it("legacy-free: the provider id is stable-shaped but never a Blisscco id, and a provider ad is not idempotent-charged (no serve record)", async () => {
    const key = await activeKey();
    setEnv();
    useHarness("valid-fill");
    const a = await (await match(key)).json() as { ad: { id: string } };
    const b = await (await match(key)).json() as { ad: { id: string } };
    assert.match(a.ad.id, /^revive_[0-9a-f]{8}$/);
    assert.match(b.ad.id, /^revive_[0-9a-f]{8}$/);
    assert.equal(serveRpcs(), 0);
  });
});

describe("day 26 part 2 | requests that must NOT invoke Revive (flag ON, harness valid-fill)", () => {
  it("invalid publisher authentication: missing, malformed, unknown and wrong-shape keys => 401 {error:'unauthorized'}", async () => {
    const key = await activeKey();
    setEnv();
    const h = useHarness("valid-fill");
    const bad: Array<string | null> = [null, "not-a-key", `blc_live_${"0".repeat(64)}`, `blc_live_${key.slice(9, 20)}`];
    for (const k of bad) {
      const res = await match(k);
      assert.equal(res.status, 401, String(k));
      assert.equal(res.headers.get("www-authenticate"), 'Bearer realm="blisscco-ads"');
      assert.equal(await assertNoInternalExposure(res, k), '{"error":"unauthorized"}');
    }
    assert.equal(h.calls.length, 0);
    assert.equal(serveRpcs(), 0);
  });

  it("a suspended publisher's valid key => 401 and no provider call", async () => {
    const key = await activeKey();
    setEnv();
    const h = useHarness("valid-fill");
    db.publisher!.status = "suspended";
    const res = await match(key);
    assert.equal(res.status, 401);
    assert.equal(await assertNoInternalExposure(res, key), '{"error":"unauthorized"}');
    assert.equal(h.calls.length, 0);
  });

  it("a rate-limited key => 429 {error:'rate_limited'}; the provider is not called for the limited request", async () => {
    const key = await activeKey();
    setEnv();
    const h = useHarness("valid-fill");
    db.rateLimit = 1;
    assert.equal((await match(key)).status, 200);
    const callsAfterFirst = h.calls.length;
    const limited = await match(key);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "60");
    assert.equal(await assertNoInternalExposure(limited, key), '{"error":"rate_limited"}');
    assert.equal(h.calls.length, callsAfterFirst);
  });

  it("invalid requests (wrong content-type, bad JSON, missing/invalid topic, extra field, oversize body, bad Idempotency-Key, bad tracking header) => 4xx and no provider call", async () => {
    const key = await activeKey();
    setEnv();
    const h = useHarness("valid-fill");
    const cases: Array<[string, Parameters<typeof match>[1], number, string]> = [
      ["wrong content-type", { headers: { "content-type": "text/plain" } }, 415, "unsupported_media_type"],
      ["no content-type", { omitContentType: true }, 415, "unsupported_media_type"],
      ["bad JSON", { body: "{broken" }, 400, "invalid_request"],
      ["missing topic", { body: "{}" }, 400, "invalid_request"],
      ["invalid topic slug", { body: '{"topic":"Not A Slug!"}' }, 400, "invalid_request"],
      ["extra field", { body: '{"topic":"gaming","prompt":"secret"}' }, 400, "invalid_request"],
      ["invalid fallback_topics", { body: '{"topic":"gaming","fallback_topics":"x"}' }, 400, "invalid_request"],
      ["oversize body", { body: JSON.stringify({ topic: "gaming", exclude_ad_ids: ["x".repeat(20000)] }) }, 413, "payload_too_large"],
      ["bad Idempotency-Key", { headers: { "idempotency-key": "short" } }, 400, "invalid_request"],
      ["bad tracking header", { headers: { "x-blisscco-tracking": "yes" } }, 400, "invalid_request"],
    ];
    for (const [name, over, status, error] of cases) {
      const res = await match(key, over);
      assert.equal(res.status, status, name);
      const text = await assertNoInternalExposure(res, key);
      assert.equal((JSON.parse(text) as { error: string }).error, error, name);
    }
    assert.equal(h.calls.length, 0);
    assert.equal(serveRpcs(), 0);
  });

  it("blocked sensitive topics (topic or fallback_topics) => never a provider call, never a provider ad", async () => {
    const key = await activeKey();
    setEnv();
    const h = useHarness("valid-fill");
    for (const body of [
      '{"topic":"health"}', '{"topic":"religion"}', '{"topic":"politics"}',
      '{"topic":"gaming","fallback_topics":["health"]}', '{"topic":"gaming","fallback_topics":["politics","gaming"]}',
    ]) {
      const res = await match(key, { body });
      assert.ok(res.status === 200 || res.status === 400, body);
      const text = await assertNoInternalExposure(res, key);
      const parsed = JSON.parse(text) as Record<string, unknown>;
      assert.notEqual(parsed.fill, true, body);
      assert.ok(!text.includes("revive_"), body);
    }
    assert.equal(h.calls.length, 0);
  });

  it("fallbackAllowedFor (DI): sensitive topic or sensitive fallback topic => false; ordinary topic => true", () => {
    assert.equal(fallbackAllowedFor({ topic: "health" } as unknown as MatchRequest), false);
    assert.equal(fallbackAllowedFor({ topic: "gaming", fallbackTopics: ["politics"] } as unknown as MatchRequest), false);
    assert.equal(fallbackAllowedFor({ topic: "gaming" } as unknown as MatchRequest), true);
  });

  it("disabled fallback (DI): isEnabled false or throwing => provider request is never invoked", async () => {
    let providerCalls = 0;
    for (const isEnabled of [() => false, () => { throw new Error("x"); }]) {
      const out = await routeServeWithFallback("hash", { topic: "gaming" } as unknown as MatchRequest, {
        serve: async () => ({ kind: "no_fill" }) as ServeResult,
        isEnabled,
        request: async () => { providerCalls += 1; return null; },
      });
      assert.equal(out.source, "blisscco");
    }
    assert.equal(providerCalls, 0);
  });
});

describe("day 26 part 2 | Idempotency-Key requests (Day 22 Part 7 decision: a key does NOT block fallback; Blisscco still runs first)", () => {
  it("keyed request served by Blisscco, and its keyed retry (replay) => no provider call, charged once", async () => {
    const key = await activeKey();
    addAd();
    setEnv();
    const h = useHarness("valid-fill");
    const headers = { "idempotency-key": "same-placement-26" };
    const a = await (await match(key, { headers })).json() as { ad: { id: string } };
    const b = await (await match(key, { headers })).json() as { ad: { id: string } };
    assert.equal(a.ad.id, b.ad.id);
    assert.ok(!a.ad.id.startsWith("revive_"));
    assert.equal(h.calls.length, 0);
    assert.ok(Math.abs(db.campaigns[0].spentTotal - 0.002) < 1e-9, `charged once, got ${db.campaigns[0].spentTotal}`);
  });

  it("invalid Idempotency-Key => 400 and no provider call", async () => {
    const key = await activeKey();
    setEnv();
    const h = useHarness("valid-fill");
    const res = await match(key, { headers: { "idempotency-key": "bad key with spaces" } });
    assert.equal(res.status, 400);
    assert.equal(h.calls.length, 0);
  });

  it("keyed request + flag OFF + Blisscco no-fill => {fill:false}; provider not called", async () => {
    const key = await activeKey();
    const h = useHarness("valid-fill");
    assert.equal(await (await match(key, { headers: { "idempotency-key": "retry-key-0026" } })).text(), '{"fill":false}');
    assert.equal(h.calls.length, 0);
  });

  it("keyed request + flag ON + Blisscco no-fill => documented behaviour: one provider attempt, a provider ad with no serve/charge/tracking", async () => {
    const key = await activeKey();
    setEnv();
    const h = useHarness("valid-fill");
    const res = await match(key, { headers: { "idempotency-key": "retry-key-0026" } });
    const text = await assertNoInternalExposure(res, key);
    const body = JSON.parse(text) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["ad", "fill", "sponsored"]);
    assert.match(String((body.ad as { id: string }).id), /^revive_[0-9a-f]{8}$/);
    assert.equal(h.calls.length, 1);
    assert.equal(serveRpcs(), 0);
    assert.deepEqual(db.serves, []);
  });
});

describe("day 26 part 2 | public response exactness and no leakage across every outcome", () => {
  it("tracking opt-in header on a provider ad still gives no tracking object", async () => {
    const key = await activeKey();
    setEnv();
    useHarness("valid-fill");
    const body = await (await match(key, { headers: { "x-blisscco-tracking": "1" } })).json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["ad", "fill", "sponsored"]);
  });

  it("every harness scenario x (Blisscco ad | no ad): body is one of exactly two shapes, headers carry no provider data", async () => {
    const key = await activeKey();
    setEnv();
    for (const withBlisscco of [false, true]) {
      if (withBlisscco) addAd();
      for (const scenario of HARNESS_SCENARIOS) {
        useHarness(scenario);
        const res = await match(key);
        assert.equal(res.status, 200, scenario);
        const text = await assertNoInternalExposure(res, key);
        const body = JSON.parse(text) as Record<string, unknown>;
        const keys = Object.keys(body).sort().join(",");
        assert.ok(keys === "fill" || keys === "ad,fill,sponsored", `${scenario}: ${keys}`);
        if (keys === "fill") assert.equal(body.fill, false);
        else assert.deepEqual(Object.keys(body.ad as object).sort(), PUBLIC_AD_FIELDS);
      }
    }
  });

  it("the provider's raw body, error text and URL never reach a response: provider-failure and unsafe-destination bodies are not echoed", async () => {
    const key = await activeKey();
    setEnv();
    for (const scenario of ["provider-failure", "unsafe-destination", "malformed-json", "oversized-body"] as const) {
      const h = useHarness(scenario);
      const res = await match(key);
      assert.equal(await assertNoInternalExposure(res, key), '{"fill":false}', scenario);
      assert.equal(h.calls.length, 1);
    }
  });
});
