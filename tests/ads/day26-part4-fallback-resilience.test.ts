// Day 26 Part 4: safe no-fill when the Revive provider is unavailable or returns an invalid response.
// Chain under test (all REAL): v1 route -> match-handler -> service -> fallback-routing -> fallback-provider -> revive-adapter.
// Only the provider network edge is faked: the Day 26 harness (timeout / malformed-json / unsafe-destination / oversized-body / provider-failure)
// plus a few local failure shapes the harness does not have (network failure, redirect, bad content type, other HTTP errors).
// Mocked fetch + node:test fake timers only. No live request, no real timer wait, no weakened timeout/security check.
import {
  HARNESS_CREATIVE, HARNESS_DELIVERY_URL, HARNESS_ERROR_MARKER, HARNESS_TIMEOUT_MS, HARNESS_UNSAFE_DESTINATION,
  createProviderHarness, type HarnessScenario, type ProviderHarness,
} from "./helpers/day26-revive-provider-harness";
import { FALLBACK_TOTAL_TIMEOUT_MS } from "@/lib/ads/fallback-routing";
import { REVIVE_MAX_BODY_BYTES } from "@/lib/ads/revive-adapter";
import { db, installDb, type Camp, type Creative } from "../workflows/publisher-flow-stubs";
import { setupPublisher } from "@/app/dashboard/account/actions";
import { createKey } from "@/app/dashboard/publisher/actions";
import { adminDecision } from "@/app/dashboard/admin/actions";
import * as v1Route from "@/app/api/v1/ads/match/route";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";

const idle = { status: "idle" } as never;
const NO_FILL_BODY = '{"fill":false}';
const PUBLIC_AD_FIELDS = ["id", "headline", "body", "cta_text", "destination_url"].sort();
const ENV_KEYS = ["REVIVE_FALLBACK_ENABLED", "REVIVE_DELIVERY_URL", "REVIVE_TIMEOUT_MS", "REVIVE_RESPONSE_FORMAT"] as const;
const RAW_PROVIDER_SECRET = "DAY26-P4-RAW-PROVIDER-SECRET";
// Must never appear in any public response (body or headers) or in a log line.
const INTERNAL_STRINGS = [
  HARNESS_DELIVERY_URL, "day26-harness", ".invalid", HARNESS_ERROR_MARKER, HARNESS_UNSAFE_DESTINATION, RAW_PROVIDER_SECRET, "REVIVE_", "revive.",
  "timeout", "http_error", "bad_response", "too_large", "empty_response", "network_error", "invalid_config", "bad_content_type", "no_fetcher", "disabled",
  "javascript:", "evil.example", "user:pass",
];

const savedEnv: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
const realConsole = { error: console.error, log: console.log, warn: console.warn, info: console.info };
let logs: unknown[][] = [];
let realFetchCalls = 0;
let ipCounter = 0;
let restoreFetch: () => void = () => undefined;

// ---------- provider edge: one shape for harness scenarios AND the local failure shapes ----------
type Edge = { readonly fetch: typeof fetch; readonly calls: unknown[]; readonly signals: AbortSignal[]; readonly unexpected: () => number };
type LocalKind =
  | "network-failure" | "network-failure-sync" | "http-404" | "http-503" | "redirect-302" | "redirect-flag" | "redirect-final-url"
  | "content-type-html" | "content-type-missing" | "content-type-xml" | "content-length-oversized" | "stream-error" | "empty-200";

const enc = new TextEncoder();
function jsonBody(over: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...HARNESS_CREATIVE, ...over });
}
function withProps(res: Response, props: Record<string, unknown>): Response {
  for (const [k, v] of Object.entries(props)) Object.defineProperty(res, k, { value: v, configurable: true });
  return res;
}
function localResponse(kind: LocalKind): Response {
  const ok = jsonBody();
  switch (kind) {
    case "http-404": return new Response(`${RAW_PROVIDER_SECRET} not found`, { status: 404, headers: { "content-type": "application/json" } });
    case "http-503": return new Response(`${RAW_PROVIDER_SECRET} unavailable`, { status: 503, headers: { "content-type": "application/json" } });
    case "redirect-302": return new Response(ok, { status: 302, headers: { "content-type": "application/json", location: "https://evil.example/ad.json" } });
    case "redirect-flag": return withProps(new Response(ok, { status: 200, headers: { "content-type": "application/json" } }), { redirected: true });
    case "redirect-final-url": return withProps(new Response(ok, { status: 200, headers: { "content-type": "application/json" } }), { url: "https://evil.example/ad.json" });
    case "content-type-html": return new Response(ok, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    case "content-type-missing": return new Response(ok, { status: 200 });
    case "content-type-xml": return new Response(ok, { status: 200, headers: { "content-type": "application/xml" } });
    case "content-length-oversized": return new Response(ok, { status: 200, headers: { "content-type": "application/json", "content-length": String(REVIVE_MAX_BODY_BYTES + 1) } });
    case "stream-error": {
      let sent = false;
      const stream = new ReadableStream<Uint8Array>({
        pull(c) {
          if (!sent) { sent = true; c.enqueue(enc.encode('{"headline":"x"')); return; }
          c.error(new Error(`${RAW_PROVIDER_SECRET} connection reset`));
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
    }
    case "empty-200": return new Response("", { status: 200, headers: { "content-type": "application/json" } });
    default: throw new Error(`no response for ${kind}`);
  }
}
function localEdge(kind: LocalKind): Edge {
  const calls: unknown[] = [];
  const signals: AbortSignal[] = [];
  let unexpected = 0;
  const f = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String((input as { url?: unknown } | null)?.url ?? "");
    if (url !== HARNESS_DELIVERY_URL) { unexpected += 1; throw new Error("day26 part4: only the test-only delivery URL is served"); }
    calls.push(1);
    if (init?.signal) signals.push(init.signal);
    if (kind === "network-failure-sync") throw new Error(`${RAW_PROVIDER_SECRET} ECONNREFUSED`);
    if (kind === "network-failure") return Promise.reject(new TypeError(`${RAW_PROVIDER_SECRET} fetch failed`));
    return localResponse(kind);
  }) as typeof fetch;
  return { fetch: f, calls, signals, unexpected: () => unexpected };
}
function harnessEdge(h: ProviderHarness): Edge {
  return { fetch: h.fetch, calls: h.calls, signals: [], unexpected: () => h.unexpectedCalls };
}
function install(edge: Edge): void {
  restoreFetch();
  const previous = globalThis.fetch;
  globalThis.fetch = edge.fetch;
  restoreFetch = () => { globalThis.fetch = previous; };
}

type Failure = { name: string; edge: () => Edge; timer?: true };
const harnessFailure = (name: string, scenario: HarnessScenario, timer?: true): Failure => ({ name, edge: () => harnessEdge(createProviderHarness(scenario)), timer });
const localFailure = (name: string, kind: LocalKind): Failure => ({ name, edge: () => localEdge(kind) });

const FAILURES: Failure[] = [
  harnessFailure("provider timeout (harness hangs until aborted)", "timeout", true),
  localFailure("network failure (rejected fetch)", "network-failure"),
  localFailure("network failure (synchronous throw)", "network-failure-sync"),
  localFailure("network failure (body stream dies mid-read)", "stream-error"),
  harnessFailure("HTTP 500", "provider-failure"),
  localFailure("HTTP 404", "http-404"),
  localFailure("HTTP 503", "http-503"),
  localFailure("redirect rejected (302 + Location)", "redirect-302"),
  localFailure("redirect rejected (redirected flag)", "redirect-flag"),
  localFailure("redirect rejected (final URL differs)", "redirect-final-url"),
  localFailure("invalid content type (text/html)", "content-type-html"),
  localFailure("invalid content type (missing)", "content-type-missing"),
  localFailure("invalid content type (application/xml)", "content-type-xml"),
  harnessFailure("malformed JSON", "malformed-json"),
  harnessFailure("oversized response (streamed past the cap)", "oversized-body"),
  localFailure("oversized response (declared content-length)", "content-length-oversized"),
  harnessFailure("unsafe destination (http)", "unsafe-destination"),
  localFailure("empty 200 body", "empty-200"),
];

// ---------- lifecycle ----------
function setEnv(over: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}): void {
  process.env.REVIVE_FALLBACK_ENABLED = "true";
  process.env.REVIVE_DELIVERY_URL = HARNESS_DELIVERY_URL;
  process.env.REVIVE_TIMEOUT_MS = String(HARNESS_TIMEOUT_MS);
  for (const [k, v] of Object.entries(over)) process.env[k] = v;
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
  restoreFetch = () => undefined;
  mock.timers.enable({ apis: ["setTimeout"] }); // fake timers for every test: nothing waits in real time
});
afterEach(() => {
  mock.timers.reset();
  restoreFetch();
  Object.assign(console, realConsole);
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  const text = JSON.stringify(logs);
  for (const s of ["day26-harness", HARNESS_ERROR_MARKER, HARNESS_UNSAFE_DESTINATION, RAW_PROVIDER_SECRET, "evil.example"]) assert.ok(!text.includes(s), `leaked into a log: ${s}`);
  assert.equal(realFetchCalls, 0, "real fetch was called");
});

// ---------- helpers ----------
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
function match(key: string): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": `10.26.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`,
    authorization: `Bearer ${key}`,
  };
  return v1Route.POST(new Request("https://blisscco.test/api/v1/ads/match", { method: "POST", headers, body: '{"topic":"gaming"}' }));
}
const serveRpcs = () => db.rpcCalls.filter((c) => c.name === "record_ad_serve").length;
const headerText = (res: Response) => JSON.stringify([...res.headers.entries()]);

async function assertNoInternalExposure(res: Response, key: string): Promise<string> {
  const body = await res.text();
  const all = `${body}\n${headerText(res)}`;
  for (const s of INTERNAL_STRINGS) assert.ok(!all.includes(s), `public response exposes: ${s}`);
  assert.ok(!all.includes(key), "public response echoes the API key");
  return body;
}
/** Lets the async chain run (real macro-task turns; setTimeout is the only faked API) until the provider edge was called. */
async function untilCalled(edge: Edge): Promise<void> {
  for (let i = 0; i < 500 && edge.calls.length === 0; i++) await new Promise<void>((r) => setImmediate(r));
  assert.ok(edge.calls.length > 0, "provider was never called");
}
async function flush(times = 20): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise<void>((r) => setImmediate(r));
}
/** Runs one match request. A hanging provider is released only by advancing the fake clock to the configured timeout. */
async function matchResolvingFailure(key: string, edge: Edge, needsTimer: boolean): Promise<Response> {
  const pending = match(key);
  if (!needsTimer) return pending;
  let settled = false;
  void pending.then(() => { settled = true; }, () => { settled = true; });
  await untilCalled(edge);
  mock.timers.tick(HARNESS_TIMEOUT_MS - 1);
  await flush();
  assert.equal(settled, false, "request must still be waiting just before the configured timeout");
  mock.timers.tick(1);
  return pending;
}

// ---------- tests ----------
describe("day 26 part 4 | every provider failure => the existing safe no-fill, nothing exposed", () => {
  for (const f of FAILURES) {
    it(`${f.name}: exactly {"fill":false}, 200, one attempt, no provider data in body/headers/logs, nothing charged or recorded`, async () => {
      const key = await activeKey();
      setEnv();
      const edge = f.edge();
      install(edge);
      db.rpcCalls = [];
      const res = await matchResolvingFailure(key, edge, f.timer === true);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.equal(res.headers.get("x-blisscco-api-version"), "1");
      assert.equal(await assertNoInternalExposure(res, key), NO_FILL_BODY);
      assert.equal(edge.calls.length, 1, "exactly one bounded attempt, no retry");
      assert.equal(edge.unexpected(), 0);
      assert.equal(serveRpcs(), 0);
      assert.deepEqual(db.serves, []);
      assert.ok(!db.rpcCalls.some((c) => /ledger|payout|earning|impression|click/i.test(c.name)));
    });
  }

  it("provider request is always sent with the hardened options (GET, redirect error, no credentials, no-store, only Accept)", async () => {
    const key = await activeKey();
    setEnv();
    const h = createProviderHarness("provider-failure");
    install(harnessEdge(h));
    await match(key);
    assert.equal(h.calls.length, 1);
    assert.deepEqual(
      { method: h.calls[0].method, redirect: h.calls[0].redirect, credentials: h.calls[0].credentials, cache: h.calls[0].cache, headers: h.calls[0].headerNames, accept: h.calls[0].accept },
      { method: "GET", redirect: "error", credentials: "omit", cache: "no-store", headers: ["accept"], accept: "application/json" },
    );
  });

  it("a rejected response never leaks: HTTP error bodies, redirect Location and stream errors carry a marker that appears nowhere public", async () => {
    const key = await activeKey();
    setEnv();
    for (const kind of ["http-404", "http-503", "redirect-302", "stream-error", "network-failure"] as const) {
      const edge = localEdge(kind);
      install(edge);
      const res = await match(key);
      assert.equal(await assertNoInternalExposure(res, key), NO_FILL_BODY, kind);
    }
  });
});

describe("day 26 part 4 | unsafe destinations are rejected, never echoed", () => {
  const UNSAFE = [
    "http://example.com/insecure",
    "javascript:alert(1)",
    "https://user:pass@example.com/x",
    "data:text/html,<script>alert(1)</script>",
    "//evil.example/x",
    "ftp://example.com/file",
  ];
  for (const destination of UNSAFE) {
    it(`destination ${JSON.stringify(destination)} => {"fill":false}`, async () => {
      const key = await activeKey();
      setEnv();
      const edge: Edge = (() => {
        const calls: unknown[] = [];
        return {
          calls, signals: [], unexpected: () => 0,
          fetch: (async () => { calls.push(1); return new Response(jsonBody({ destination_url: destination }), { status: 200, headers: { "content-type": "application/json" } }); }) as typeof fetch,
        };
      })();
      install(edge);
      const res = await match(key);
      assert.equal(await assertNoInternalExposure(res, key), NO_FILL_BODY);
      assert.equal(edge.calls.length, 1);
      assert.equal(serveRpcs(), 0);
    });
  }
});

describe("day 26 part 4 | bounded timeout (fake timers)", () => {
  it("a hanging provider: still waiting 1ms before the configured timeout, no-fill exactly at it, request aborted, and well under the outer routing cap", async () => {
    const key = await activeKey();
    setEnv();
    const h = createProviderHarness("timeout");
    install(harnessEdge(h));
    const res = await matchResolvingFailure(key, harnessEdge(h), true);
    assert.equal(await assertNoInternalExposure(res, key), NO_FILL_BODY);
    assert.equal(h.abortObserved, true, "adapter must abort the hung request");
    assert.ok(HARNESS_TIMEOUT_MS < FALLBACK_TOTAL_TIMEOUT_MS);
    assert.equal(h.calls.length, 1);
  });

  it("the configured REVIVE_TIMEOUT_MS is honoured (not the 25ms test default): no-fill only after exactly that many fake ms", async () => {
    const key = await activeKey();
    setEnv({ REVIVE_TIMEOUT_MS: "300" });
    const h = createProviderHarness("timeout");
    install(harnessEdge(h));
    const pending = match(key);
    let settled = false;
    void pending.then(() => { settled = true; });
    await untilCalled(harnessEdge(h));
    mock.timers.tick(299);
    await flush();
    assert.equal(settled, false);
    mock.timers.tick(1);
    const res = await pending;
    assert.equal(await assertNoInternalExposure(res, key), NO_FILL_BODY);
    assert.equal(h.abortObserved, true);
  });

  it("a provider that answers headers fast but stalls the body is cut off at the same deadline (body read is bounded too)", async () => {
    const key = await activeKey();
    setEnv();
    let cancelled = false;
    const calls: unknown[] = [];
    const stalled = new ReadableStream<Uint8Array>({ start() { /* never enqueues, never closes */ }, cancel() { cancelled = true; } });
    const edge: Edge = {
      calls, signals: [], unexpected: () => 0,
      fetch: (async () => { calls.push(1); return new Response(stalled, { status: 200, headers: { "content-type": "application/json" } }); }) as typeof fetch,
    };
    install(edge);
    const pending = match(key);
    let settled = false;
    void pending.then(() => { settled = true; });
    await untilCalled(edge);
    await flush();
    assert.equal(settled, false);
    mock.timers.tick(HARNESS_TIMEOUT_MS);
    const res = await pending;
    assert.equal(await assertNoInternalExposure(res, key), NO_FILL_BODY);
    await flush();
    assert.equal(cancelled, true, "stalled body stream must be cancelled");
  });

  it("a response that arrives AFTER the deadline is ignored: still no-fill, no provider ad", async () => {
    const key = await activeKey();
    setEnv();
    const calls: unknown[] = [];
    let release: (r: Response) => void = () => undefined;
    const edge: Edge = {
      calls, signals: [], unexpected: () => 0,
      fetch: (() => { calls.push(1); return new Promise<Response>((r) => { release = r; }); }) as typeof fetch,
    };
    install(edge);
    const pending = match(key);
    await untilCalled(edge);
    mock.timers.tick(HARNESS_TIMEOUT_MS);
    const res = await pending;
    release(new Response(jsonBody(), { status: 200, headers: { "content-type": "application/json" } })); // valid fill, but too late
    await flush();
    assert.equal(await assertNoInternalExposure(res, key), NO_FILL_BODY);
  });
});

describe("day 26 part 4 | Blisscco eligibility and the next request are unaffected by a failed Revive attempt", () => {
  for (const f of FAILURES) {
    it(`after '${f.name}': a normal Blisscco request still succeeds, is charged once, and never touches the provider`, async () => {
      const key = await activeKey();
      setEnv();
      const edge = f.edge();
      install(edge);
      const failed = await matchResolvingFailure(key, edge, f.timer === true);
      assert.equal(await assertNoInternalExposure(failed, key), NO_FILL_BODY);
      assert.equal(serveRpcs(), 0);
      assert.equal(db.campaigns.length, 0);
      const attempts = edge.calls.length;

      addAd(); // Blisscco inventory becomes eligible after the failure
      const res = await match(key);
      assert.equal(res.status, 200);
      const body = JSON.parse(await assertNoInternalExposure(res, key)) as { fill: boolean; sponsored: boolean; ad: Record<string, unknown> };
      assert.deepEqual(Object.keys(body).sort(), ["ad", "fill", "sponsored"]);
      assert.equal(body.fill, true);
      assert.deepEqual(Object.keys(body.ad).sort(), PUBLIC_AD_FIELDS);
      assert.equal(body.ad.headline, "Visible headline");
      assert.ok(!String(body.ad.id).startsWith("revive_"));
      assert.equal(edge.calls.length, attempts, "Blisscco fill must not call the provider");
      assert.equal(serveRpcs(), 1);
      assert.ok(Math.abs(db.campaigns[0].spentTotal - 0.002) < 1e-9, `charged once, got ${db.campaigns[0].spentTotal}`);
    });
  }

  it("a failed attempt leaves a pre-existing Blisscco ad exactly as eligible as before (same ad, same charge) in every failure mode", async () => {
    const key = await activeKey();
    addAd();
    setEnv();
    let expectedCharge = 0;
    for (const f of FAILURES) {
      const edge = f.edge();
      install(edge);
      const res = await match(key); // Blisscco serves first, so the provider is not reached and cannot hang
      const body = JSON.parse(await assertNoInternalExposure(res, key)) as { fill: boolean; ad: { headline: string } };
      assert.equal(body.fill, true, f.name);
      assert.equal(body.ad.headline, "Visible headline", f.name);
      assert.equal(edge.calls.length, 0, f.name);
      expectedCharge += 0.002;
    }
    assert.ok(Math.abs(db.campaigns[0].spentTotal - expectedCharge) < 1e-9);
  });

  it("repeated failures do not poison state: failure, failure, then a healthy provider fill still works (no Blisscco ad needed)", async () => {
    const key = await activeKey();
    setEnv();
    for (const f of [FAILURES[1], FAILURES[4]]) {
      const edge = f.edge();
      install(edge);
      assert.equal(await (await match(key)).text(), NO_FILL_BODY, f.name);
    }
    const healthy = createProviderHarness("valid-fill");
    install(harnessEdge(healthy));
    const res = await match(key);
    const body = JSON.parse(await assertNoInternalExposure(res, key)) as { fill: boolean; sponsored: boolean; ad: Record<string, unknown> };
    assert.equal(body.fill, true);
    assert.equal(body.sponsored, true);
    assert.match(String(body.ad.id), /^revive_[0-9a-f]{8}$/);
    assert.equal(healthy.calls.length, 1);
    assert.equal(serveRpcs(), 0);
  });

  it("after a timed-out attempt, the very next request gets its own fresh deadline and completes normally", async () => {
    const key = await activeKey();
    setEnv();
    const hung = createProviderHarness("timeout");
    install(harnessEdge(hung));
    const first = await matchResolvingFailure(key, harnessEdge(hung), true);
    assert.equal(await first.text(), NO_FILL_BODY);

    addAd();
    install(harnessEdge(createProviderHarness("valid-fill")));
    const second = await match(key);
    assert.equal(second.status, 200);
    assert.equal(((await second.json()) as { fill: boolean }).fill, true);
    assert.equal(serveRpcs(), 1);
  });
});

describe("day 26 part 4 | guard rails of this test file", () => {
  it("provider URL that is not the harness URL is refused by the edge (no accidental live call) and still yields no-fill", async () => {
    const key = await activeKey();
    setEnv({ REVIVE_DELIVERY_URL: "https://real-provider.example.net/serve?key=SECRETKEY99" });
    const edge = localEdge("http-503");
    install(edge);
    const res = await match(key);
    assert.equal(await assertNoInternalExposure(res, key), NO_FILL_BODY);
    assert.equal(edge.unexpected(), 1);
    assert.equal(edge.calls.length, 0);
    assert.equal(realFetchCalls, 0);
  });
});
