import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";
import * as route from "../../examples/publisher-nextjs/app/api/blisscco-ad/route";
import * as safeUrl from "../../examples/publisher-nextjs/lib/safe-url";
import { handleClickGet } from "@/lib/ads/click-handler";
import { acceptClick, type ClickDeps, type ClickServeRow, type RecordClickOutcome } from "@/lib/ads/click";
import { mintClickRef, verifyClickRef } from "@/lib/ads/click-ref";
import { mintTrackingToken } from "@/lib/ads/tracking-token";
import { createIpGuard } from "@/lib/ads/ip-guard";

// Day 21 Part 4: click tracking in the Next.js publisher example, through Blisscco's EXISTING click flow
// (GET /api/v1/ads/click?ref=bc1... , validated by lib/ads/click.ts). MOCKED fetch + in-process handlers only:
// no network, no database, no production code or schema touched. The browser component runs for real (transpiled in-test)
// against a tiny fake React / IntersectionObserver / document / window.

const ROOT = path.join(__dirname, "..", "..", "..");
const COMPONENT_SRC = readFileSync(path.join(ROOT, "examples/publisher-nextjs/components/SponsoredAd.tsx"), "utf8");
const ROUTE_SRC = readFileSync(path.join(ROOT, "examples/publisher-nextjs/app/api/blisscco-ad/route.ts"), "utf8");
const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const KEY = `blc_live_${"e".repeat(64)}`;
const BASE = "https://ads.example.com";
const TOKEN = "bt1.eyJ2IjoxfQ.c2lnbmF0dXJlLXNlY3JldA";
const CLICK_REF = "bc1.eyJ2IjoxfQ.Y2xpY2stc2lnLXNlY3JldA";
const DEST = "https://example.com/laptops";
const ADVERTISER_DEST = "https://advertiser.example.net/landing?utm=secret-destination";
const AD = { id: "33333333-3333-4333-8333-333333333333", headline: "Fast laptops", body: "Sponsored deals", cta_text: "Shop", destination_url: DEST };
const TRACKING = { token: TOKEN, expires_at: "2099-01-01T00:00:00.000Z", events: ["impression", "click"], click_ref: CLICK_REF };
const FILL = { fill: true, sponsored: true, ad: AD, tracking: TRACKING };

// ---------------------------------------------------------------------------------------------------------------------
// Server route (mocked upstream fetch)
// ---------------------------------------------------------------------------------------------------------------------
type Upstream = { url: string; method: string; headers: Record<string, string>; body: string; redirect: unknown };
let upstream: Upstream[] = [];
let logs: string[] = [];
const realFetch = globalThis.fetch;
const realConsole = { log: console.log, error: console.error, warn: console.warn, info: console.info };
const savedEnv = { key: process.env.BLISSCCO_PUBLISHER_API_KEY, base: process.env.BLISSCCO_API_BASE_URL };

function setFetch(fn: (url: string, init: RequestInit) => Response | Promise<Response>): void {
  globalThis.fetch = (async (url: unknown, init: RequestInit) => {
    upstream.push({ url: String(url), method: String(init.method), headers: (init.headers ?? {}) as Record<string, string>, body: String(init.body ?? ""), redirect: init.redirect });
    return fn(String(url), init);
  }) as typeof fetch;
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const redirect302 = (location = ADVERTISER_DEST) => new Response(null, { status: 302, headers: { location } });

const isClickUrl = (u: string) => u.includes("/api/v1/ads/click");
/** match -> `match`, click GET -> `click`. */
function mockBlisscco(match: () => Response, click: () => Response = () => redirect302()): void {
  setFetch((url) => (isClickUrl(url) ? click() : match()));
}
function post(body: unknown, headers: Record<string, string> = { "content-type": "application/json" }): Promise<Response> {
  return route.POST(new Request("http://localhost/api/blisscco-ad", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));
}
const clickCalls = () => upstream.filter((c) => isClickUrl(c.url));
const text = async (r: Response) => (await r.clone().text()) + JSON.stringify([...r.headers.entries()]);
const resetEnv = () => {
  process.env.BLISSCCO_PUBLISHER_API_KEY = KEY;
  process.env.BLISSCCO_API_BASE_URL = BASE;
};

beforeEach(() => {
  upstream = [];
  logs = [];
  resetEnv();
  for (const m of ["log", "error", "warn", "info"] as const) console[m] = (...a: unknown[]) => void logs.push(a.map(String).join(" "));
  mockBlisscco(() => json(200, FILL));
});
afterEach(() => {
  globalThis.fetch = realFetch;
  Object.assign(console, realConsole);
  for (const [name, v] of [["BLISSCCO_PUBLISHER_API_KEY", savedEnv.key], ["BLISSCCO_API_BASE_URL", savedEnv.base]] as const) {
    if (v === undefined) delete process.env[name];
    else process.env[name] = v;
  }
});

describe("click ref handling (match route)", () => {
  it("returns the public click ref (and token) and nothing else from tracking: no expiry, events, destination or key", async () => {
    const res = await post({ topic: "gaming" });
    const body = await res.clone().json();
    assert.deepEqual(body.tracking, { token: TOKEN, click_ref: CLICK_REF });
    assert.deepEqual(Object.keys(body.tracking).sort(), ["click_ref", "token"]);
    const out = await text(res);
    for (const secret of ["expires_at", "events", "2099", "d".repeat(64), "blc_live_", ADVERTISER_DEST, "advertiser.example.net"]) assert.equal(out.includes(secret), false, secret);
  });

  it("each part is returned only when Blisscco granted that event and the value has the right shape", async () => {
    const cases: Array<[Record<string, unknown>, Record<string, unknown> | undefined]> = [
      [{ token: TOKEN, expires_at: "x", events: ["click"], click_ref: CLICK_REF }, { click_ref: CLICK_REF }],
      [{ token: TOKEN, expires_at: "x", events: ["impression"], click_ref: CLICK_REF }, { token: TOKEN }],
      [{ token: TOKEN, expires_at: "x", events: ["impression", "click"] }, { token: TOKEN }],
      [{ token: TOKEN, expires_at: "x", events: ["click"], click_ref: TOKEN }, undefined], // a bt1 token is not a click ref
      [{ token: TOKEN, expires_at: "x", events: ["click"], click_ref: "bc1.a.b&url=https://evil.example" }, undefined],
      [{ token: TOKEN, expires_at: "x", events: ["click"], click_ref: `bc1.${"a".repeat(600)}.b` }, undefined],
      [{ token: TOKEN, expires_at: "x", events: ["click"], click_ref: 42 }, undefined],
      [{ token: TOKEN, expires_at: "x", events: [], click_ref: CLICK_REF }, undefined],
    ];
    for (const [tracking, expected] of cases) {
      mockBlisscco(() => json(200, { ...FILL, tracking }));
      const body = await (await post({ topic: "gaming" })).json();
      assert.equal(body.fill, true);
      assert.deepEqual(body.tracking, expected, JSON.stringify(tracking));
    }
  });

  it("no-fill and an unsafe destination return no click ref at all", async () => {
    mockBlisscco(() => json(200, { fill: false, tracking: TRACKING }));
    const noFill = await post({ topic: "gaming" });
    assert.deepEqual(await noFill.clone().json(), { fill: false });
    assert.equal((await text(noFill)).includes(CLICK_REF), false);
    for (const destination_url of ["javascript:alert(1)", "http://example.com", "data:text/html,x", "https://user:pw@example.com", "https://exa mple.com", ""]) {
      mockBlisscco(() => json(200, { ...FILL, ad: { ...AD, destination_url } }));
      const res = await post({ topic: "gaming" });
      assert.deepEqual(await res.clone().json(), { fill: false }, destination_url);
      assert.equal((await text(res)).includes(CLICK_REF), false);
    }
    assert.equal(clickCalls().length, 0);
  });
});

describe("click forwarding (server route -> Blisscco GET /api/v1/ads/click)", () => {
  it("calls the existing click endpoint with ONLY ?ref=, a plain GET, no body, no API key, and does not follow the redirect", async () => {
    const res = await post({ click_ref: CLICK_REF, event: "click" });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.clone().json(), { ok: true, status: "accepted" });
    assert.equal(upstream.length, 1);
    const call = upstream[0];
    assert.equal(call.method, "GET");
    assert.equal(call.url, `${BASE}/api/v1/ads/click?ref=${encodeURIComponent(CLICK_REF)}`);
    assert.deepEqual([...new URL(call.url).searchParams.keys()], ["ref"]);
    assert.equal(call.body, "");
    assert.equal(call.redirect, "manual");
    assert.deepEqual(Object.keys(call.headers).map((h) => h.toLowerCase()), ["accept"]);
    assert.equal(JSON.stringify(call).includes("e".repeat(64)), false);
    assert.equal(JSON.stringify(call).toLowerCase().includes("bearer"), false);
  });

  it("the advertiser redirect target never reaches the browser: no Location header, no destination in the body", async () => {
    const res = await post({ click_ref: CLICK_REF, event: "click" });
    const out = await text(res);
    assert.equal(res.headers.get("location"), null);
    assert.equal(out.includes("advertiser.example.net") || out.includes("secret-destination"), false);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual([...res.headers.keys()].filter((h) => h.startsWith("access-control")), []);
  });

  it("is a single attempt, and a failing upstream is not retried by the route", async () => {
    mockBlisscco(() => json(200, FILL), () => json(503, { error: "unavailable" }));
    assert.equal((await post({ click_ref: CLICK_REF, event: "click" })).status, 503);
    assert.equal(clickCalls().length, 1);
  });

  it("does not forward browser cookies, auth, referer, forwarded-for or user-agent", async () => {
    await post({ click_ref: CLICK_REF, event: "click" }, { "content-type": "application/json", cookie: "session=abc", authorization: "Bearer browser-secret", referer: "https://site.example/chat?q=private-prompt", "x-forwarded-for": "1.2.3.4", "user-agent": "ua-secret" });
    const sent = JSON.stringify(upstream[0]);
    for (const leak of ["session=abc", "browser-secret", "private-prompt", "1.2.3.4", "ua-secret"]) assert.equal(sent.includes(leak), false, leak);
  });

  it("rejects extra fields, any destination-like field, a wrong event and a missing or malformed click_ref: 400 and NO upstream call", async () => {
    const cases: Array<[unknown, string]> = [
      [{ click_ref: CLICK_REF, event: "click", url: "https://evil.example" }, "unknown_field"],
      [{ click_ref: CLICK_REF, event: "click", destination_url: "https://evil.example" }, "unknown_field"],
      [{ click_ref: CLICK_REF, event: "click", redirect: "https://evil.example" }, "unknown_field"],
      [{ click_ref: CLICK_REF, event: "click", next: "https://evil.example" }, "unknown_field"],
      [{ click_ref: CLICK_REF, event: "click", topic: "gaming" }, "unknown_field"],
      [{ click_ref: CLICK_REF, event: "click", prompt: "my secret question" }, "unknown_field"],
      [{ click_ref: CLICK_REF, event: "click", messages: [{ role: "user", content: "hi" }] }, "unknown_field"],
      [{ click_ref: CLICK_REF, event: "click", user: { email: "a@b.com" } }, "unknown_field"],
      [{ click_ref: CLICK_REF, event: "click", token: TOKEN }, "unknown_field"],
      [{ click_ref: CLICK_REF, event: "impression" }, "invalid_event"],
      [{ click_ref: CLICK_REF, event: "serve" }, "invalid_event"],
      [{ click_ref: CLICK_REF }, "invalid_event"],
      [{ click_ref: TOKEN, event: "click" }, "invalid_click_ref"],
      [{ click_ref: "", event: "click" }, "invalid_click_ref"],
      [{ click_ref: "plain text from a chat", event: "click" }, "invalid_click_ref"],
      [{ click_ref: "bc1.a.b&url=https://evil.example", event: "click" }, "invalid_click_ref"],
      [{ click_ref: "bc1.a.b?ref=x", event: "click" }, "invalid_click_ref"],
      [{ click_ref: "bc1.a.b#frag", event: "click" }, "invalid_click_ref"],
      [{ click_ref: "bc1.a.b\n", event: "click" }, "invalid_click_ref"],
      [{ click_ref: "https://evil.example/", event: "click" }, "invalid_click_ref"],
      [{ click_ref: `bc1.${"a".repeat(600)}.b`, event: "click" }, "invalid_click_ref"],
      [{ click_ref: 42, event: "click" }, "invalid_click_ref"],
      [{ click_ref: [CLICK_REF], event: "click" }, "invalid_click_ref"],
      [{ click_ref: { ref: CLICK_REF }, event: "click" }, "invalid_click_ref"],
      [{ click_ref: null, event: "click" }, "invalid_click_ref"],
    ];
    for (const [body, reason] of cases) {
      const res = await post(body);
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
      assert.deepEqual(await res.json(), { error: "invalid_request", reason });
    }
    assert.equal(upstream.length, 0);
  });

  it("the three body shapes stay separate: click/impression bodies cannot be mixed or swapped", async () => {
    for (const body of [{ token: TOKEN, event: "click" }, { token: CLICK_REF, event: "impression" }, { token: TOKEN, click_ref: CLICK_REF, event: "impression" }, { topic: "gaming", click_ref: CLICK_REF, event: "click" }]) {
      assert.equal((await post(body)).status, 400, JSON.stringify(body));
    }
    assert.equal(upstream.length, 0);
  });

  it("keeps the shared guards: JSON content type, size limit, bad JSON", async () => {
    assert.equal((await post({ click_ref: CLICK_REF, event: "click" }, { "content-type": "text/plain" })).status, 415);
    assert.equal((await post({ click_ref: CLICK_REF, event: "click", pad: "x".repeat(2000) })).status, 413);
    assert.equal((await post("{nope")).status, 400);
    assert.equal(upstream.length, 0);
  });

  it("every upstream/config failure is a generic 503 { ok: false, error: 'unavailable' } with no ref, key or status leak", async () => {
    const mockClick = (c: () => Response) => mockBlisscco(() => json(200, FILL), c);
    const setups: Array<() => void> = [
      () => mockClick(() => json(404, { error: "not_found" })),
      () => mockClick(() => json(400, { error: "invalid_request", reason: "invalid_ref" })),
      () => mockClick(() => json(429, { error: "rate_limited" }, { "retry-after": "60" })),
      () => mockClick(() => json(405, { error: "method_not_allowed" })),
      () => mockClick(() => json(500, `boom ${KEY} ${CLICK_REF}`)),
      () => mockClick(() => json(200, { hello: "unexpected" })),
      () => mockClick(() => new Response(null, { status: 204 })), // prefetch answer: not a click
      () => mockClick(() => new Response(null, { status: 302 })), // redirect without Location
      () => setFetch(() => { throw new Error(`connect failed Bearer ${KEY} ${CLICK_REF}`); }),
      () => { delete process.env.BLISSCCO_PUBLISHER_API_KEY; },
      () => { process.env.BLISSCCO_PUBLISHER_API_KEY = "not-a-key"; },
      () => { delete process.env.BLISSCCO_API_BASE_URL; },
      () => { process.env.BLISSCCO_API_BASE_URL = "http://ads.example.com"; },
    ];
    for (const setup of setups) {
      setup();
      const res = await post({ click_ref: CLICK_REF, event: "click" });
      const out = await text(res);
      assert.equal(res.status, 503);
      assert.deepEqual(JSON.parse(await res.clone().text()), { ok: false, error: "unavailable" });
      assert.equal(/e{64}|blc_live_|bc1\.|not_found|rate_limited|not-a-key|boom|advertiser/.test(out), false);
      resetEnv();
      mockBlisscco(() => json(200, FILL));
    }
    const logged = logs.join("\n");
    assert.equal(logged.includes("e".repeat(64)) || logged.includes(CLICK_REF) || logged.includes("Bearer"), false);
    assert.ok(logs.length > 0 && logs.every((l) => l.startsWith("[blisscco-ad]")));
  });

  it("route exports stay POST-only (no GET/OPTIONS) with no CORS, and the click code never logs or reads the ref outside the contract", () => {
    assert.deepEqual(Object.keys(route).sort(), ["POST", "dynamic", "runtime"]);
    const code = codeOnly(ROUTE_SRC);
    assert.doesNotMatch(code, /access-control|cors/i);
    assert.doesNotMatch(code, /console\.\w+\([^)]*(click_ref|token|apiKey|process\.env)/);
    assert.match(code, /reportClick\(\{ click_ref: body\.click_ref \}\)/);
    assert.doesNotMatch(code, /\/api\/v1\/ads\/click|ads\/click\?/); // the click URL lives only in the node client, never re-invented here
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Real Blisscco click validation, in-process (lib/ads/click-ref.ts + lib/ads/click.ts + lib/ads/click-handler.ts), fake data store
// ---------------------------------------------------------------------------------------------------------------------
const SECRET = "k7f2-0123456789-abcdefghijklmnopqrstuvwxyz-click";
const OTHER_SECRET = "m4q9-0123456789-abcdefghijklmnopqrstuvwxyz-other";
const SERVE_REF = `bsr_${"ab12".repeat(10)}`;
const PUBLISHER_ID = "44444444-4444-4444-8444-444444444444";
const CREATIVE_ID = "55555555-5555-4555-8555-555555555555";
const NOW = Date.UTC(2026, 9, 31, 12, 0, 0);
const CONFIG = { secrets: [SECRET], ttlSeconds: 3600 };

function mint(config = CONFIG, servedAtMs = NOW - 60_000): string {
  const grant = mintClickRef(config, { serveRef: SERVE_REF, publisherId: PUBLISHER_ID, creativeId: CREATIVE_ID, servedAtMs, nowMs: NOW });
  assert.ok(grant, "test setup: a real click ref must mint");
  return grant.ref;
}

type World = { row: ClickServeRow | null; records: number; outcome: RecordClickOutcome; accepts: unknown[]; urls: string[] };
function world(over: Partial<ClickServeRow> = {}): World {
  return {
    row: { publisherId: PUBLISHER_ID, creativeId: CREATIVE_ID, servedAtMs: NOW - 60_000, destinationUrl: ADVERTISER_DEST, eligible: true, ...over },
    records: 0,
    outcome: { outcome: "recorded", destinationUrl: ADVERTISER_DEST },
    accepts: [],
    urls: [],
  };
}
/** Browser -> route -> (route's node client) -> REAL handleClickGet -> REAL acceptClick with fake lookup/record. */
function wireRealClick(w: World, config: typeof CONFIG | null = CONFIG): void {
  const deps: ClickDeps = {
    config,
    nowMs: () => NOW,
    lookupServe: async () => w.row,
    record: async () => { w.records += 1; return w.outcome; },
  };
  const guards = { requestGuard: createIpGuard(1000), failureGuard: createIpGuard(1000) };
  setFetch(async (url, init) => {
    if (!isClickUrl(url)) return json(200, FILL);
    w.urls.push(url);
    return handleClickGet(new Request(url, init), { ...guards, accept: async (ref) => { w.accepts.push(ref); return acceptClick(ref, deps); } });
  });
}

describe("in-process check against the real Blisscco click validation", () => {
  it("a genuine signed click ref passes the route's shape check, is validated by Blisscco, and is counted exactly once per request", async () => {
    const ref = mint();
    assert.match(ref, /^bc1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.equal(verifyClickRef(ref, CONFIG, NOW).ok, true);
    const w = world();
    wireRealClick(w);
    const res = await post({ click_ref: ref, event: "click" });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.clone().json(), { ok: true, status: "accepted" });
    assert.deepEqual(w.accepts, [ref]);
    assert.equal(w.records, 1);
    assert.deepEqual([...new URL(w.urls[0]).searchParams.keys()], ["ref"]);
    assert.equal((await text(res)).includes("advertiser.example.net"), false);
  });

  it("a repeat click or a not_counted outcome still answers 'accepted' (Blisscco decides what to count, not the example)", async () => {
    const ref = mint();
    for (const outcome of ["duplicate", "not_counted"] as const) {
      const w = world();
      w.outcome = { outcome, destinationUrl: ADVERTISER_DEST };
      wireRealClick(w);
      assert.deepEqual(await (await post({ click_ref: ref, event: "click" })).json(), { ok: true, status: "accepted" });
    }
  });

  it("a tampered, expired, wrong-secret, wrong-prefix or unknown-serve ref is refused by Blisscco and nothing is recorded", async () => {
    const good = mint();
    const [prefix, payload, sig] = good.split(".");
    const flipped = `${prefix}.${payload}.${sig.slice(0, -2)}${sig.endsWith("AA") ? "BB" : "AA"}`;
    const expiresSoon = (() => {
      const g = mintClickRef({ secrets: [SECRET], ttlSeconds: 3600 }, { serveRef: SERVE_REF, publisherId: PUBLISHER_ID, creativeId: CREATIVE_ID, servedAtMs: NOW - 10_000, nowMs: NOW - 10_000 });
      assert.ok(g);
      return g.ref;
    })();
    const otherSecret = mint({ secrets: [OTHER_SECRET], ttlSeconds: 3600 });
    const impressionToken = mintTrackingToken(CONFIG, { serveRef: SERVE_REF, publisherId: PUBLISHER_ID, servedAtMs: NOW - 60_000, nowMs: NOW });
    assert.ok(impressionToken);
    const cases: Array<[string, string, Partial<ClickServeRow> | null, typeof CONFIG | null]> = [
      ["tampered signature", flipped, {}, CONFIG],
      ["signed with another secret", otherSecret, {}, CONFIG],
      ["expired (checked against a later clock)", expiresSoon, {}, { secrets: [SECRET], ttlSeconds: 3600 }],
      ["unknown serve", good, null, CONFIG],
      ["serve belongs to another publisher", good, { publisherId: "66666666-6666-4666-8666-666666666666" }, CONFIG],
      ["serve belongs to another creative", good, { creativeId: "77777777-7777-4777-8777-777777777777" }, CONFIG],
      ["creative not eligible", good, { eligible: false }, CONFIG],
      ["database destination is unsafe (http)", good, { destinationUrl: "http://advertiser.example.net/" }, CONFIG],
      ["database destination is unsafe (javascript:)", good, { destinationUrl: "javascript:alert(1)" }, CONFIG],
      ["tracking secret not configured", good, {}, null],
    ];
    for (const [label, ref, rowOver, config] of cases) {
      const w = world(rowOver ?? {});
      if (rowOver === null) w.row = null;
      const clockLater = label.startsWith("expired") ? 3 * 3_600_000 : 0;
      wireRealClick(w, config);
      if (clockLater) {
        // Blisscco's own clock is later: the same ref is expired there.
        const deps: ClickDeps = { config: CONFIG, nowMs: () => NOW + clockLater, lookupServe: async () => w.row, record: async () => { w.records += 1; return w.outcome; } };
        const guards = { requestGuard: createIpGuard(1000), failureGuard: createIpGuard(1000) };
        setFetch(async (url, init) => handleClickGet(new Request(url, init), { ...guards, accept: (r) => acceptClick(r, deps) }));
      }
      const res = await post({ click_ref: ref, event: "click" });
      const out = await text(res);
      assert.equal(res.status, 503, label);
      assert.deepEqual(JSON.parse(await res.clone().text()), { ok: false, error: "unavailable" }, label);
      assert.equal(w.records, 0, label);
      assert.equal(/advertiser|invalid_signature|expired|unknown_serve|mismatch|not_found/.test(out), false, label);
    }
    // an impression token is not accepted as a click ref, by the route (shape) and by Blisscco (prefix)
    assert.equal((await post({ click_ref: impressionToken.token, event: "click" })).status, 400);
    assert.equal(verifyClickRef(impressionToken.token, CONFIG, NOW).ok, false);
  });

  it("many malformed refs never reach Blisscco, and refs that reach it but fail are not retried", async () => {
    const w = world();
    wireRealClick(w);
    for (const click_ref of ["", "bc1", "bc1..", "bc1.a", "BC1.a.b", "bc1.a.b.c", "bc1.a b.c"]) {
      assert.equal((await post({ click_ref, event: "click" })).status, 400, click_ref);
    }
    assert.equal(w.accepts.length, 0);
    const bogus = "bc1.AAAA.BBBB"; // right shape, not signed
    assert.equal((await post({ click_ref: bogus, event: "click" })).status, 503);
    assert.equal(w.accepts.length, 1);
    assert.equal(w.records, 0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Browser component: real code, fake React runtime
// ---------------------------------------------------------------------------------------------------------------------
type Hook = { value?: unknown; current?: unknown; deps?: unknown[]; cleanup?: unknown };
type El = { type: unknown; props: Record<string, unknown> };

class Instance {
  hooks: Hook[] = [];
  idx = 0;
  tree: El | null = null;
  pending: Array<() => void> = [];
  refs: Array<{ current: unknown }> = [];
  mounted = true;
  constructor(readonly fn: (p: Record<string, unknown>) => El | null, public props: Record<string, unknown>) {}
  render(): void {
    if (!this.mounted) return;
    current = this;
    this.idx = 0;
    this.pending = [];
    this.tree = this.fn(this.props);
    current = null;
    const refs: Array<{ current: unknown }> = [];
    const walk = (n: unknown): void => {
      if (typeof n !== "object" || n === null) return;
      if (Array.isArray(n)) return n.forEach(walk);
      const el = n as El;
      const r = el.props?.ref as { current: unknown } | undefined;
      if (r) { r.current = { fake: "element" }; refs.push(r); }
      walk(el.props?.children);
    };
    walk(this.tree);
    for (const r of this.refs) if (!refs.includes(r)) r.current = null;
    this.refs = refs;
    for (const run of this.pending) run();
  }
  unmount(): void {
    this.mounted = false;
    for (const h of this.hooks) if (typeof h.cleanup === "function") (h.cleanup as () => void)();
    for (const r of this.refs) r.current = null;
  }
}
let current: Instance | null = null;

const fakeReact = {
  useState<T>(init: T): [T, (v: T) => void] {
    const inst = current as Instance;
    const h = (inst.hooks[inst.idx] ??= { value: init });
    inst.idx++;
    return [h.value as T, (v: T) => { if (inst.mounted && h.value !== v) { h.value = v; inst.render(); } }];
  },
  useRef<T>(init: T): { current: T } {
    const inst = current as Instance;
    const h = (inst.hooks[inst.idx] ??= { current: init });
    inst.idx++;
    return h as unknown as { current: T };
  },
  useEffect(fn: () => void | (() => void), deps?: unknown[]): void {
    const inst = current as Instance;
    const h = (inst.hooks[inst.idx] ??= {});
    inst.idx++;
    const changed = !h.deps || !deps || deps.some((d, i) => d !== (h.deps as unknown[])[i]);
    if (!changed) return;
    inst.pending.push(() => {
      if (typeof h.cleanup === "function") (h.cleanup as () => void)();
      h.deps = deps;
      h.cleanup = fn();
    });
  },
};
const jsx = (type: unknown, props: Record<string, unknown>): El => ({ type, props });
const fakeJsxRuntime = { jsx, jsxs: jsx, Fragment: "fragment" };

function loadComponent(): (p: Record<string, unknown>) => El | null {
  const out = ts.transpileModule(COMPONENT_SRC, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const mod: { exports: { default?: unknown } } = { exports: {} };
  const req = (id: string): unknown => {
    if (id === "react") return fakeReact;
    if (id === "react/jsx-runtime") return fakeJsxRuntime;
    if (id === "../lib/safe-url") return safeUrl;
    throw new Error(`component imported something unexpected: ${id}`);
  };
  new Function("require", "exports", "module", out)(req, mod.exports, mod);
  return mod.exports.default as (p: Record<string, unknown>) => El | null;
}

class FakeObserver {
  static all: FakeObserver[] = [];
  observed: unknown[] = [];
  disconnected = false;
  constructor(readonly cb: (entries: Array<{ isIntersecting: boolean }>) => void, readonly options: { threshold?: number }) { FakeObserver.all.push(this); }
  observe(el: unknown): void { this.observed.push(el); }
  disconnect(): void { this.disconnected = true; }
  fire(isIntersecting: boolean): void { if (!this.disconnected) this.cb([{ isIntersecting }]); }
}
const docListeners = new Map<string, Set<() => void>>();
const fakeDocument = {
  visibilityState: "visible",
  addEventListener: (t: string, fn: () => void) => void (docListeners.get(t) ?? docListeners.set(t, new Set()).get(t))!.add(fn),
  removeEventListener: (t: string, fn: () => void) => void docListeners.get(t)?.delete(fn),
};
const fireDoc = (t: string) => [...(docListeners.get(t) ?? [])].forEach((fn) => fn());

type Req = { url: string; init: RequestInit; body: Record<string, unknown> };
let reqs: Req[] = [];
let events: string[] = [];
let opened: unknown[][] = [];
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
const matchReqs = () => reqs.filter((r) => !("event" in r.body));
const impReqs = () => reqs.filter((r) => r.body.event === "impression");
const clickReqs = () => reqs.filter((r) => r.body.event === "click");

type G = Record<string, unknown>;
const g = globalThis as unknown as G;
const savedGlobals: G = {};
function installBrowser(opts: { observer?: boolean } = {}): void {
  for (const k of ["IntersectionObserver", "document", "fetch", "window"]) savedGlobals[k] = g[k];
  FakeObserver.all = [];
  docListeners.clear();
  fakeDocument.visibilityState = "visible";
  g.document = fakeDocument;
  g.window = { open: (...args: unknown[]) => { events.push("open"); opened.push(args); return null; } };
  events = [];
  opened = [];
  if (opts.observer === false) delete g.IntersectionObserver;
  else g.IntersectionObserver = FakeObserver;
}
function restoreBrowser(): void {
  for (const k of Object.keys(savedGlobals)) {
    if (savedGlobals[k] === undefined) delete g[k];
    else g[k] = savedGlobals[k];
  }
}
/** Browser fetch to our own route: match answers with `matchResponse`, impression with `impResponse`. */
function browserFetch(matchResponse: () => Response, clickResponse: () => Response = () => json(200, { ok: true, status: "accepted" }), impResponse: () => Response = () => json(200, { ok: true, status: "recorded" })): void {
  reqs = [];
  g.fetch = async (url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    reqs.push({ url: String(url), init, body });
    events.push(body.event === "click" ? "fetch:click" : "fetch:other");
    return "event" in body ? (body.event === "click" ? clickResponse() : impResponse()) : matchResponse();
  };
}
async function mount(topic = "gaming"): Promise<Instance> {
  const inst = new Instance(loadComponent(), { topic });
  inst.render();
  await flush();
  return inst;
}
const shown = (inst: Instance) => inst.tree !== null;

const publicFill = (over: Record<string, unknown> = {}) => ({ fill: true, sponsored: true, ad: AD, tracking: { token: TOKEN, click_ref: CLICK_REF }, ...over });

type Node = { type: unknown; props: Record<string, unknown> };
function findAll(tree: unknown, pred: (n: Node) => boolean, out: Node[] = []): Node[] {
  if (typeof tree !== "object" || tree === null) return out;
  if (Array.isArray(tree)) { tree.forEach((t) => findAll(t, pred, out)); return out; }
  const n = tree as Node;
  if (pred(n)) out.push(n);
  findAll(n.props?.children, pred, out);
  return out;
}
const button = (inst: Instance): Node | undefined => findAll(inst.tree, (n) => n.type === "button")[0];
const press = (inst: Instance) => {
  const b = button(inst);
  assert.ok(b, "CTA button is rendered");
  (b.props.onClick as (e: { preventDefault(): void }) => void)({ preventDefault() {} });
};

describe("SponsoredAd component: click tracking", () => {
  beforeEach(() => installBrowser());
  afterEach(restoreBrowser);

  it("renders a button CTA and NO direct advertiser link (no <a>, no href, destination not in the markup)", async () => {
    browserFetch(() => json(200, publicFill()));
    const inst = await mount();
    assert.ok(button(inst));
    assert.equal(findAll(inst.tree, (n) => n.type === "a").length, 0);
    const html = JSON.stringify(inst.tree);
    assert.doesNotMatch(html, /"href"|example\.com\/laptops/);
    assert.match(html, /"children":"Sponsored"/);
    assert.match(html, /"aria-label":"Sponsored"/);
    assert.equal(opened.length, 0);
    assert.equal(clickReqs().length, 0); // rendering and viewing never count as a click
    inst.unmount();
  });

  it("a press sends exactly { click_ref, event: 'click' } to our own route, THEN opens the validated https destination safely", async () => {
    browserFetch(() => json(200, publicFill()));
    const inst = await mount();
    press(inst);
    await flush();
    assert.equal(clickReqs().length, 1);
    const r = clickReqs()[0];
    assert.equal(r.url, "/api/blisscco-ad");
    assert.equal(r.init.method, "POST");
    assert.deepEqual(r.body, { click_ref: CLICK_REF, event: "click" });
    assert.deepEqual(r.init.headers, { "Content-Type": "application/json" });
    assert.equal(r.init.credentials, "omit");
    assert.equal(r.init.keepalive, true);
    assert.deepEqual(opened, [[DEST, "_blank", "noopener,noreferrer"]]);
    assert.deepEqual(events.filter((e) => e !== "fetch:other"), ["fetch:click", "open"], "tracking request starts before the tab opens");
    inst.unmount();
  });

  it("the click request leaks nothing: no token, key, ad id, headline, topic, destination, cookies or user data", async () => {
    browserFetch(() => json(200, publicFill()));
    const inst = await mount();
    press(inst);
    await flush();
    const sent = JSON.stringify(clickReqs()[0]).toLowerCase();
    for (const leak of [TOKEN, "bt1.", KEY, "blc_live_", AD.id, AD.headline, "gaming", DEST, "example.com", "cookie", "authorization", "bearer"]) assert.equal(sent.includes(leak.toLowerCase()), false, leak);
    inst.unmount();
  });

  it("pressing again opens the destination again but reports the click ref only once", async () => {
    browserFetch(() => json(200, publicFill()));
    const inst = await mount();
    press(inst);
    press(inst);
    press(inst);
    await flush();
    assert.equal(clickReqs().length, 1);
    assert.equal(opened.length, 3);
    inst.unmount();
  });

  it("a failing click report (503, network error) never blocks the user: the destination still opens and the ad stays", async () => {
    browserFetch(() => json(200, publicFill()), () => json(503, { ok: false, error: "unavailable" }));
    const a = await mount();
    press(a);
    await flush();
    assert.equal(opened.length, 1);
    assert.ok(shown(a));
    a.unmount();

    browserFetch(() => json(200, publicFill()));
    const b = await mount();
    const original = g.fetch as (u: unknown, i: RequestInit) => Promise<Response>;
    g.fetch = async (u: unknown, i: RequestInit) => {
      if (String(i.body).includes('"click"')) throw new TypeError("network down");
      return original(u, i);
    };
    press(b);
    await flush();
    assert.equal(opened.length, 2);
    assert.ok(shown(b));
    b.unmount();
  });

  it("without a usable click ref (missing, impression token, wrong shape, injected URL, oversize) nothing is reported, but the validated destination still opens", async () => {
    for (const click_ref of [undefined, null, 7, TOKEN, "nope", "bc1.a.b&url=https://evil.example", "https://evil.example/", `bc1.${"a".repeat(600)}.b`]) {
      browserFetch(() => json(200, publicFill({ tracking: { token: TOKEN, ...(click_ref === undefined ? {} : { click_ref }) } })));
      const before = opened.length;
      const inst = await mount();
      press(inst);
      await flush();
      assert.equal(clickReqs().length, 0, String(click_ref));
      assert.equal(opened.length, before + 1, String(click_ref));
      assert.equal(opened.at(-1)?.[0], DEST);
      inst.unmount();
    }
  });

  it("the destination comes only from the validated ad: URL-like extras in the response or in the click ref never change what opens", async () => {
    browserFetch(() =>
      json(200, publicFill({ tracking: { token: TOKEN, click_ref: CLICK_REF, destination_url: "https://evil.example/", redirect: "https://evil.example/", url: "https://evil.example/" }, redirect_url: "https://evil.example/", destination: "https://evil.example/" })),
    );
    const inst = await mount();
    press(inst);
    await flush();
    assert.deepEqual(opened, [[DEST, "_blank", "noopener,noreferrer"]]);
    assert.equal(JSON.stringify(reqs).includes("evil.example"), false);
    inst.unmount();
  });

  it("unsafe destinations never render a CTA, so there is nothing to press: no click request, no window.open", async () => {
    for (const destination_url of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "http://example.com", "//example.com", "/relative", "https://user:pw@example.com", "https://trusted.com@evil.example/p", "https://exa mple.com", "", `https://example.com/${"a".repeat(2100)}`]) {
      browserFetch(() => json(200, publicFill({ ad: { ...AD, destination_url } })));
      const inst = await mount();
      assert.equal(shown(inst), false, destination_url);
      assert.equal(button(inst), undefined);
      for (const o of FakeObserver.all) o.fire(true);
      await flush();
      assert.equal(reqs.filter((r) => "event" in r.body).length, 0, destination_url);
      assert.equal(opened.length, 0);
      inst.unmount();
    }
  });

  it("no-fill, errors and malformed responses give no button, no click request and no window.open", async () => {
    const responses: Array<() => Response> = [
      () => json(200, { fill: false }),
      () => json(503, { fill: false, error: "unavailable" }),
      () => json(400, { error: "invalid_request", reason: "invalid_topic" }),
      () => json(200, "not json"),
      () => json(200, publicFill({ sponsored: false })),
      () => json(200, publicFill({ ad: null })),
      () => json(200, publicFill({ ad: { ...AD, headline: 5 } })),
    ];
    for (const res of responses) {
      browserFetch(res);
      const inst = await mount();
      assert.equal(button(inst), undefined);
      assert.equal(reqs.filter((r) => "event" in r.body).length, 0);
      assert.equal(opened.length, 0);
      inst.unmount();
    }
  });

  it("impressions and clicks are independent: viewing sends only the token, pressing sends only the click ref", async () => {
    browserFetch(() => json(200, publicFill()));
    const inst = await mount();
    FakeObserver.all[0].fire(true);
    await flush();
    assert.deepEqual(impReqs().map((r) => r.body), [{ token: TOKEN, event: "impression" }]);
    assert.equal(clickReqs().length, 0);
    assert.equal(opened.length, 0);
    press(inst);
    await flush();
    assert.deepEqual(clickReqs().map((r) => r.body), [{ click_ref: CLICK_REF, event: "click" }]);
    assert.equal(impReqs().length, 1);
    assert.equal(JSON.stringify(impReqs()[0]).includes(CLICK_REF), false);
    inst.unmount();
  });

  it("a new ad (new topic) reports its own click ref, not the previous one", async () => {
    const REF2 = "bc1.second.ref_2";
    let n = 0;
    browserFetch(() => json(200, publicFill({ tracking: { token: TOKEN, click_ref: n++ === 0 ? CLICK_REF : REF2 } })));
    const inst = await mount("gaming");
    press(inst);
    inst.props = { topic: "travel" };
    inst.render();
    await flush();
    press(inst);
    await flush();
    assert.deepEqual(clickReqs().map((r) => r.body.click_ref), [CLICK_REF, REF2]);
    inst.unmount();
  });
});

describe("component source: click flow, credentials and data", () => {
  it("has no direct advertiser link and no other way to navigate: only window.open from the click handler, noopener + noreferrer, after a safeHref re-check", () => {
    const code = codeOnly(COMPONENT_SRC);
    assert.doesNotMatch(code, /<a\b|href=|window\.location|location\.(href|assign|replace)|document\.location|sendBeacon|<form|<iframe/);
    assert.equal((code.match(/window\.open\(/g) ?? []).length, 1);
    assert.match(code, /window\.open\(target, "_blank", "noopener,noreferrer"\)/);
    assert.match(code, /const target = safeHref\(ad\.href\)/);
    assert.match(code, /if \(!target\) return;/);
  });

  it("never reads a destination from the page, URL, storage or cookies", () => {
    const code = codeOnly(COMPONENT_SRC);
    assert.doesNotMatch(code, /URLSearchParams|location\.|localStorage|sessionStorage|document\.cookie|document\.referrer|navigator\./);
    assert.match(code, /JSON\.stringify\(\{ click_ref: ref, event: "click" \}\)/);
  });

  it("never touches env, API key, Authorization, the node client or NEXT_PUBLIC, and only calls its own route with credentials omitted", () => {
    assert.doesNotMatch(COMPONENT_SRC, /process\.env|BLISSCCO_|blc_live_|apiKey|Authorization|publisher-node|Idempotency|NEXT_PUBLIC|dangerouslySetInnerHTML|innerHTML|eval\(/);
    assert.doesNotMatch(COMPONENT_SRC, /api\/v1\/ads|https?:\/\//);
    assert.deepEqual([...COMPONENT_SRC.matchAll(/fetch\(\s*"([^"]+)"/g)].map((m) => m[1]), ["/api/blisscco-ad", "/api/blisscco-ad", "/api/blisscco-ad"]);
    assert.equal((COMPONENT_SRC.match(/credentials: "omit"/g) ?? []).length, 3);
    assert.match(COMPONENT_SRC, /^"use client";/);
  });

  it("keeps the Sponsored disclosure and the safe-link validation", () => {
    assert.match(COMPONENT_SRC, />Sponsored<\/p>/);
    assert.match(COMPONENT_SRC, /aria-label="Sponsored"/);
    assert.match(COMPONENT_SRC, /d\.sponsored !== true/);
    assert.match(COMPONENT_SRC, /safeHref\(destination_url\)/);
    assert.match(COMPONENT_SRC, /if \(!ad\) return null/);
  });

  it("safeHref still allows only plain https links (shared by route and component)", () => {
    assert.equal(safeUrl.safeHref(DEST), DEST);
    for (const bad of ["javascript:alert(1)", "http://example.com", "https://u:p@example.com", "//example.com", "", null, 42]) assert.equal(safeUrl.safeHref(bad), null, String(bad));
  });
});
