import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";
import * as route from "../../examples/publisher-nextjs/app/api/blisscco-ad/route";
import * as safeUrl from "../../examples/publisher-nextjs/lib/safe-url";
import { handleImpressionPost } from "@/lib/ads/impression-handler";
import { createIpGuard } from "@/lib/ads/ip-guard";

// Day 21 Part 3: safe impression reporting in the Next.js publisher example.
// MOCKED fetch + in-process handlers only: no network, no database, no production code or schema touched.
// The browser component is executed for real (transpiled in-test) against a tiny fake React / IntersectionObserver / document.

const ROOT = path.join(__dirname, "..", "..", "..");
const COMPONENT_PATH = path.join(ROOT, "examples/publisher-nextjs/components/SponsoredAd.tsx");
const COMPONENT_SRC = readFileSync(COMPONENT_PATH, "utf8");
const ROUTE_SRC = readFileSync(path.join(ROOT, "examples/publisher-nextjs/app/api/blisscco-ad/route.ts"), "utf8");

const KEY = `blc_live_${"d".repeat(64)}`;
const BASE = "https://ads.example.com";
const TOKEN = "bt1.eyJ2IjoxfQ.c2lnbmF0dXJlLXNlY3JldA";
const CLICK_REF = "bc1.eyJ2IjoxfQ.Y2xpY2stc2lnLXNlY3JldA";
const AD = { id: "22222222-2222-4222-8222-222222222222", headline: "Fast laptops", body: "Sponsored deals", cta_text: "Shop", destination_url: "https://example.com/laptops" };
const TRACKING = { token: TOKEN, expires_at: "2099-01-01T00:00:00.000Z", events: ["impression", "click"], click_ref: CLICK_REF };
const FILL = { fill: true, sponsored: true, ad: AD, tracking: TRACKING };

// ---------------------------------------------------------------------------------------------------------------------
// Server route (mocked upstream fetch)
// ---------------------------------------------------------------------------------------------------------------------
type Upstream = { url: string; method: string; headers: Record<string, string>; body: string };
let upstream: Upstream[] = [];
let logs: string[] = [];
const realFetch = globalThis.fetch;
const realConsole = { log: console.log, error: console.error, warn: console.warn, info: console.info };
const savedEnv = { key: process.env.BLISSCCO_PUBLISHER_API_KEY, base: process.env.BLISSCCO_API_BASE_URL };

function setFetch(fn: (url: string, init: RequestInit) => Response | Promise<Response>): void {
  globalThis.fetch = (async (url: unknown, init: RequestInit) => {
    upstream.push({ url: String(url), method: String(init.method), headers: init.headers as Record<string, string>, body: String(init.body ?? "") });
    return fn(String(url), init);
  }) as typeof fetch;
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** match -> `match` response, impression -> `impression` response. */
function mockBlisscco(match: () => Response, impression: () => Response = () => json(200, { ok: true, status: "recorded" })): void {
  setFetch((url) => (url.endsWith("/api/v1/ads/impression") ? impression() : match()));
}
function post(body: unknown, headers: Record<string, string> = { "content-type": "application/json" }): Promise<Response> {
  return route.POST(new Request("http://localhost/api/blisscco-ad", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));
}
const impressionCalls = () => upstream.filter((c) => c.url.endsWith("/api/v1/ads/impression"));
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

describe("tracking data handling (match route)", () => {
  it("opts in to tracking upstream and returns ONLY { tracking: { token, click_ref } } to the browser (Day 21 part 4 adds click_ref)", async () => {
    const res = await post({ topic: "gaming" });
    const body = await res.clone().json();
    assert.equal(upstream[0].headers["X-Blisscco-Tracking"], "1");
    assert.deepEqual(body, { fill: true, sponsored: true, ad: AD, tracking: { token: TOKEN, click_ref: CLICK_REF } });
    assert.deepEqual(Object.keys(body.tracking).sort(), ["click_ref", "token"]);
    const out = await text(res);
    for (const secret of ["expires_at", "events", "2099"]) assert.equal(out.includes(secret), false, secret);
  });

  it("never returns the API key or internal data, and the browser response is not cacheable", async () => {
    mockBlisscco(() => json(200, { ...FILL, ad: { ...AD, advertiser_email: "a@b.com", spent_total: 9 }, internal: { key: KEY } }));
    const res = await post({ topic: "gaming" });
    const out = await text(res);
    assert.equal(out.includes("d".repeat(64)) || out.includes("blc_live_") || out.includes("a@b.com") || out.includes("spent_total"), false);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual([...res.headers.keys()].filter((h) => h.startsWith("access-control")), []);
  });

  it("no usable impression token => the ad is returned without any tracking field", async () => {
    for (const tracking of [undefined, null, {}, { token: TOKEN, expires_at: "x", events: ["click"] }, { token: "nope", expires_at: "x", events: ["impression"] }, { token: `bt1.${"a".repeat(600)}.b`, expires_at: "x", events: ["impression"] }, { token: 42, expires_at: "x", events: ["impression"] }]) {
      mockBlisscco(() => json(200, { fill: true, sponsored: true, ad: AD, ...(tracking === undefined ? {} : { tracking }) }));
      const body = await (await post({ topic: "gaming" })).json();
      assert.equal(body.fill, true);
      assert.equal("tracking" in body, false, JSON.stringify(tracking));
    }
  });

  it("no-fill returns exactly { fill: false }: no token, no impression call", async () => {
    mockBlisscco(() => json(200, { fill: false, tracking: TRACKING }));
    const res = await post({ topic: "gaming" });
    assert.deepEqual(await res.clone().json(), { fill: false });
    assert.equal((await text(res)).includes(TOKEN), false);
    assert.equal(impressionCalls().length, 0);
  });

  it("an unsafe destination becomes no-fill and the tracking token does not leave the server", async () => {
    for (const destination_url of ["javascript:alert(1)", "http://example.com", "data:text/html,x", "https://user:pw@example.com", ""]) {
      mockBlisscco(() => json(200, { ...FILL, ad: { ...AD, destination_url } }));
      const res = await post({ topic: "gaming" });
      assert.deepEqual(await res.clone().json(), { fill: false }, destination_url);
      assert.equal((await text(res)).includes(TOKEN), false);
    }
    assert.equal(impressionCalls().length, 0);
  });
});

describe("impression forwarding (server route -> Blisscco impression endpoint)", () => {
  it("sends exactly { token, event } to /api/v1/ads/impression with only Content-Type/Accept (no API key, no Authorization)", async () => {
    const res = await post({ token: TOKEN, event: "impression" });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, status: "recorded" });
    assert.equal(upstream.length, 1);
    const call = upstream[0];
    assert.equal(call.url, `${BASE}/api/v1/ads/impression`);
    assert.equal(call.method, "POST");
    assert.deepEqual(JSON.parse(call.body), { token: TOKEN, event: "impression" });
    assert.deepEqual(Object.keys(JSON.parse(call.body)).sort(), ["event", "token"]);
    assert.deepEqual(Object.keys(call.headers).map((h) => h.toLowerCase()).sort(), ["accept", "content-type"]);
    assert.equal(JSON.stringify(call).includes("d".repeat(64)), false);
    assert.equal(JSON.stringify(call).toLowerCase().includes("bearer"), false);
  });

  it("passes a 'duplicate' result through, and nothing else from the upstream body", async () => {
    mockBlisscco(() => json(200, FILL), () => json(200, { ok: true, status: "duplicate", campaign_id: "c1", publisher_id: "p1" }));
    const res = await post({ token: TOKEN, event: "impression" });
    assert.deepEqual(await res.clone().json(), { ok: true, status: "duplicate" });
    assert.equal((await text(res)).includes("campaign_id"), false);
  });

  it("is a single attempt: a failing upstream is not retried by the route", async () => {
    mockBlisscco(() => json(200, FILL), () => json(503, { error: "unavailable" }));
    assert.equal((await post({ token: TOKEN, event: "impression" })).status, 503);
    assert.equal(impressionCalls().length, 1);
  });

  it("does not forward browser cookies, auth, referer, forwarded-for or user-agent", async () => {
    await post({ token: TOKEN, event: "impression" }, { "content-type": "application/json", cookie: "session=abc", authorization: "Bearer browser-secret", referer: "https://site.example/chat?q=private-prompt", "x-forwarded-for": "1.2.3.4", "user-agent": "ua-secret" });
    const sent = JSON.stringify(upstream[0]);
    for (const leak of ["session=abc", "browser-secret", "private-prompt", "1.2.3.4", "ua-secret"]) assert.equal(sent.includes(leak), false, leak);
  });

  it("rejects extra fields, a wrong event, and a missing or malformed token with 400 and NO upstream call", async () => {
    const cases: Array<[unknown, string]> = [
      [{ token: TOKEN, event: "impression", prompt: "my secret question" }, "unknown_field"],
      [{ token: TOKEN, event: "impression", messages: [{ role: "user", content: "hi" }] }, "unknown_field"],
      [{ token: TOKEN, event: "impression", user: { email: "a@b.com" } }, "unknown_field"],
      [{ token: TOKEN, event: "impression", ad_id: AD.id }, "unknown_field"],
      [{ token: TOKEN, event: "impression", topic: "gaming" }, "unknown_field"],
      [{ token: TOKEN, event: "impression", click_ref: CLICK_REF }, "unknown_field"],
      [{ token: TOKEN, event: "click" }, "invalid_event"],
      [{ token: TOKEN, event: "serve" }, "invalid_event"],
      [{ token: TOKEN }, "invalid_event"],
      [{ event: "impression" }, "invalid_token"],
      [{ token: "", event: "impression" }, "invalid_token"],
      [{ token: CLICK_REF, event: "impression" }, "invalid_token"],
      [{ token: "plain text from a chat", event: "impression" }, "invalid_token"],
      [{ token: `bt1.${"a".repeat(600)}.b`, event: "impression" }, "invalid_token"],
      [{ token: 42, event: "impression" }, "invalid_token"],
      [{ token: [TOKEN], event: "impression" }, "invalid_token"],
      [{ token: null, event: "impression" }, "invalid_token"],
    ];
    for (const [body, reason] of cases) {
      const res = await post(body);
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
      assert.deepEqual(await res.json(), { error: "invalid_request", reason });
    }
    assert.equal(upstream.length, 0);
  });

  it("keeps the shared guards: JSON content type, size limit, bad JSON", async () => {
    assert.equal((await post({ token: TOKEN, event: "impression" }, { "content-type": "text/plain" })).status, 415);
    assert.equal((await post({ token: TOKEN, event: "impression", pad: "x".repeat(2000) })).status, 413);
    assert.equal((await post("{nope")).status, 400);
    assert.equal(upstream.length, 0);
  });

  it("every upstream/config failure is a generic 503 { ok: false, error: 'unavailable' } with no token, key or status leak", async () => {
    const setups: Array<() => void> = [
      () => mockBlisscco(() => json(200, FILL), () => json(401, { error: "unauthorized", reason: KEY })),
      () => mockBlisscco(() => json(200, FILL), () => json(429, { error: "rate_limited" }, { "retry-after": "60" })),
      () => mockBlisscco(() => json(200, FILL), () => json(500, `boom ${KEY} ${TOKEN}`)),
      () => mockBlisscco(() => json(200, FILL), () => json(200, { hello: "unexpected" })),
      () => mockBlisscco(() => json(200, FILL), () => json(200, { ok: true, status: "something-else" })),
      () => setFetch(() => { throw new Error(`connect failed Bearer ${KEY} ${TOKEN}`); }),
      () => { delete process.env.BLISSCCO_PUBLISHER_API_KEY; },
      () => { process.env.BLISSCCO_PUBLISHER_API_KEY = "not-a-key"; },
      () => { delete process.env.BLISSCCO_API_BASE_URL; },
      () => { process.env.BLISSCCO_API_BASE_URL = "http://ads.example.com"; },
    ];
    for (const setup of setups) {
      setup();
      const res = await post({ token: TOKEN, event: "impression" });
      const out = await text(res);
      assert.equal(res.status, 503);
      assert.deepEqual(JSON.parse(await res.clone().text()), { ok: false, error: "unavailable" });
      assert.equal(/d{64}|blc_live_|bt1\.|unauthorized|rate_limited|not-a-key|boom/.test(out), false);
      resetEnv();
      mockBlisscco(() => json(200, FILL));
    }
    const logged = logs.join("\n");
    assert.equal(logged.includes("d".repeat(64)) || logged.includes(TOKEN) || logged.includes("Bearer"), false);
    assert.ok(logs.length > 0 && logs.every((l) => l.startsWith("[blisscco-ad]")));
  });

  it("route exports stay POST-only (no GET/OPTIONS) and contain no CORS", () => {
    assert.deepEqual(Object.keys(route).sort(), ["POST", "dynamic", "runtime"]);
    assert.doesNotMatch(ROUTE_SRC.replace(/\/\/.*$/gm, ""), /access-control|cors/i);
  });
});

describe("in-process check against the real impression handler contract", () => {
  it("what the route forwards is accepted by handleImpressionPost, which gets only (token, 'impression')", async () => {
    const accepted: Array<{ token: unknown; event: unknown }> = [];
    const guards = { requestGuard: createIpGuard(1000), failureGuard: createIpGuard(1000) };
    const seen: Array<{ headers: Headers }> = [];
    // Replace the impression leg with the real handler (accept() is stubbed: no database).
    setFetch(async (url, init) => {
      if (!url.endsWith("/api/v1/ads/impression")) return json(200, FILL);
      const req = new Request(url, init);
      seen.push({ headers: req.headers });
      return handleImpressionPost(req, { ...guards, accept: async (token, event) => { accepted.push({ token, event }); return { kind: "recorded" }; } });
    });
    const res = await post({ token: TOKEN, event: "impression" });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, status: "recorded" });
    assert.deepEqual(accepted, [{ token: TOKEN, event: "impression" }]);
    assert.equal(seen[0].headers.get("authorization"), null);
  });

  it("a rejected token (401 from Blisscco) is hidden from the browser behind the same generic 503", async () => {
    const guards = { requestGuard: createIpGuard(1000), failureGuard: createIpGuard(1000) };
    setFetch(async (url, init) => handleImpressionPost(new Request(url, init), { ...guards, accept: async () => ({ kind: "unauthorized" }) }));
    const res = await post({ token: TOKEN, event: "impression" });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { ok: false, error: "unavailable" });
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
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
const matchReqs = () => reqs.filter((r) => !("event" in r.body));
const impReqs = () => reqs.filter((r) => r.body.event === "impression");

type G = Record<string, unknown>;
const g = globalThis as unknown as G;
const savedGlobals: G = {};
function installBrowser(opts: { observer?: boolean } = {}): void {
  for (const k of ["IntersectionObserver", "document", "fetch"]) savedGlobals[k] = g[k];
  FakeObserver.all = [];
  docListeners.clear();
  fakeDocument.visibilityState = "visible";
  g.document = fakeDocument;
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
function browserFetch(matchResponse: () => Response, impResponse: () => Response = () => json(200, { ok: true, status: "recorded" })): void {
  reqs = [];
  g.fetch = async (url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    reqs.push({ url: String(url), init, body });
    return "event" in body ? impResponse() : matchResponse();
  };
}
async function mount(topic = "gaming"): Promise<Instance> {
  const inst = new Instance(loadComponent(), { topic });
  inst.render();
  await flush();
  return inst;
}
const shown = (inst: Instance) => inst.tree !== null;
const publicFill = (over: Record<string, unknown> = {}) => ({ fill: true, sponsored: true, ad: AD, tracking: { token: TOKEN }, ...over });

describe("SponsoredAd component: impression reporting", () => {
  beforeEach(() => installBrowser());
  afterEach(restoreBrowser);

  it("match request carries only { topic } and no credentials; the ad shows with the Sponsored label and safe link", async () => {
    browserFetch(() => json(200, publicFill()));
    const inst = await mount();
    assert.equal(matchReqs().length, 1);
    assert.equal(matchReqs()[0].url, "/api/blisscco-ad");
    assert.deepEqual(matchReqs()[0].body, { topic: "gaming" });
    assert.equal(matchReqs()[0].init.credentials, "omit");
    assert.ok(shown(inst));
    const html = JSON.stringify(inst.tree);
    assert.match(html, /"children":"Sponsored"/);
    assert.doesNotMatch(html, /"href"|example\.com\/laptops/); // no direct advertiser link (Day 21 part 4)
    assert.match(html, /"type":"button"/);
    inst.unmount();
  });

  it("an ad that is rendered but not yet on screen does not send an impression", async () => {
    browserFetch(() => json(200, publicFill()));
    const inst = await mount();
    assert.equal(FakeObserver.all.length, 1);
    assert.equal(FakeObserver.all[0].options.threshold, 0.5);
    assert.equal(impReqs().length, 0);
    inst.unmount();
  });

  it("sends exactly one impression { token, event } to our own route once the ad is on screen, however often it re-enters the view", async () => {
    browserFetch(() => json(200, publicFill()));
    const inst = await mount();
    const [obs] = FakeObserver.all;
    obs.fire(true);
    await flush();
    assert.equal(impReqs().length, 1);
    const r = impReqs()[0];
    assert.equal(r.url, "/api/blisscco-ad");
    assert.equal(r.init.method, "POST");
    assert.deepEqual(r.body, { token: TOKEN, event: "impression" });
    assert.deepEqual(r.init.headers, { "Content-Type": "application/json" });
    assert.equal(r.init.credentials, "omit");
    assert.equal(r.init.keepalive, true);
    assert.equal(obs.disconnected, true);
    obs.fire(true);
    obs.fire(false);
    obs.fire(true);
    fireDoc("visibilitychange");
    await flush();
    assert.equal(impReqs().length, 1);
    inst.unmount();
  });

  it("the impression request leaks nothing: no topic, ad id, headline, click_ref, cookies, user data or credentials", async () => {
    browserFetch(() => json(200, publicFill()));
    const inst = await mount();
    FakeObserver.all[0].fire(true);
    await flush();
    const sent = JSON.stringify(impReqs()[0]);
    for (const leak of [AD.id, AD.headline, "gaming", "click_ref", "bc1.", KEY, "blc_live_", "cookie", "authorization", "Bearer"]) assert.equal(sent.toLowerCase().includes(leak.toLowerCase()), false, leak);
    inst.unmount();
  });

  it("waits for a visible tab: hidden tab sends nothing until the tab becomes visible", async () => {
    browserFetch(() => json(200, publicFill()));
    fakeDocument.visibilityState = "hidden";
    const inst = await mount();
    FakeObserver.all[0].fire(true);
    await flush();
    assert.equal(impReqs().length, 0);
    fakeDocument.visibilityState = "visible";
    fireDoc("visibilitychange");
    await flush();
    assert.equal(impReqs().length, 1);
    inst.unmount();
  });

  it("ad scrolled out of view again before reporting sends nothing", async () => {
    browserFetch(() => json(200, publicFill()));
    const inst = await mount();
    const [obs] = FakeObserver.all;
    obs.fire(false);
    fireDoc("visibilitychange");
    await flush();
    assert.equal(impReqs().length, 0);
    inst.unmount();
  });

  it("unmounting before the ad is seen sends nothing and cleans up observer + listener", async () => {
    browserFetch(() => json(200, publicFill()));
    const inst = await mount();
    inst.unmount();
    assert.equal(FakeObserver.all[0].disconnected, true);
    assert.equal(docListeners.get("visibilitychange")?.size ?? 0, 0);
    assert.equal(impReqs().length, 0);
  });

  it("without IntersectionObserver the rendered ad is counted once (visible tab only)", async () => {
    restoreBrowser();
    installBrowser({ observer: false });
    browserFetch(() => json(200, publicFill()));
    const inst = await mount();
    assert.equal(impReqs().length, 1);
    assert.deepEqual(impReqs()[0].body, { token: TOKEN, event: "impression" });
    inst.unmount();
  });

  it("a failing impression request is swallowed: the ad stays visible and nothing is retried", async () => {
    browserFetch(() => json(200, publicFill()), () => json(503, { ok: false, error: "unavailable" }));
    const inst = await mount();
    FakeObserver.all[0].fire(true);
    await flush();
    assert.ok(shown(inst));
    assert.equal(impReqs().length, 1);
    g.fetch = async () => { throw new TypeError("network down"); };
    inst.unmount();
  });

  it("a network-level failure of the impression request does not throw or unmount the ad", async () => {
    browserFetch(() => json(200, publicFill()));
    const inst = await mount();
    const original = g.fetch as (u: unknown, i: RequestInit) => Promise<Response>;
    g.fetch = async (u: unknown, i: RequestInit) => {
      if (String(i.body).includes('"event"')) throw new TypeError("network down");
      return original(u, i);
    };
    FakeObserver.all[0].fire(true);
    await flush();
    assert.ok(shown(inst));
    inst.unmount();
  });

  it("no impression request for no-fill, errors, malformed JSON, non-sponsored, unsafe or incomplete ads", async () => {
    const responses: Array<() => Response> = [
      () => json(200, { fill: false }),
      () => json(503, { fill: false, error: "unavailable" }),
      () => json(400, { error: "invalid_request", reason: "invalid_topic" }),
      () => json(200, "not json"),
      () => json(200, "null"),
      () => json(200, publicFill({ sponsored: false })),
      () => json(200, publicFill({ sponsored: undefined })),
      () => json(200, publicFill({ fill: "true" })),
      () => json(200, publicFill({ ad: null })),
      () => json(200, publicFill({ ad: { ...AD, destination_url: "javascript:alert(1)" } })),
      () => json(200, publicFill({ ad: { ...AD, destination_url: "http://example.com" } })),
      () => json(200, publicFill({ ad: { ...AD, destination_url: "https://user:pw@example.com" } })),
      () => json(200, publicFill({ ad: { ...AD, headline: 5 } })),
      () => json(200, publicFill({ ad: { ...AD, id: undefined } })),
    ];
    for (const res of responses) {
      browserFetch(res);
      const inst = await mount();
      assert.equal(shown(inst), false);
      for (const o of FakeObserver.all) o.fire(true);
      fireDoc("visibilitychange");
      await flush();
      assert.equal(impReqs().length, 0);
      inst.unmount();
    }
  });

  it("a rejected fetch (offline) shows nothing and sends no impression", async () => {
    reqs = [];
    g.fetch = async () => { throw new TypeError("offline"); };
    const inst = await mount();
    assert.equal(shown(inst), false);
    assert.equal(FakeObserver.all.length, 0);
    inst.unmount();
  });

  it("an ad without a usable token (missing, wrong prefix, click_ref, oversize) is shown but never reported", async () => {
    for (const tracking of [undefined, null, {}, { token: 7 }, { token: "nope" }, { token: CLICK_REF }, { token: `bt1.${"a".repeat(600)}.b` }]) {
      browserFetch(() => json(200, publicFill({ tracking })));
      const inst = await mount();
      assert.ok(shown(inst), JSON.stringify(tracking));
      for (const o of FakeObserver.all) o.fire(true);
      await flush();
      assert.equal(impReqs().length, 0, JSON.stringify(tracking));
      inst.unmount();
    }
  });

  it("extra fields in the response (click_ref, advertiser data) are ignored and never sent back", async () => {
    browserFetch(() => json(200, publicFill({ tracking: { token: TOKEN, click_ref: CLICK_REF, events: ["impression"] }, internal: { advertiser: "secret-adv" } })));
    const inst = await mount();
    FakeObserver.all[0].fire(true);
    await flush();
    const sent = JSON.stringify(reqs);
    assert.equal(sent.includes(CLICK_REF) || sent.includes("secret-adv"), false);
    inst.unmount();
  });

  it("a new topic fetches a new ad and reports its own token once", async () => {
    const T2 = "bt1.second.token_2";
    let n = 0;
    browserFetch(() => json(200, publicFill({ tracking: { token: n++ === 0 ? TOKEN : T2 } })));
    const inst = await mount("gaming");
    FakeObserver.all.at(-1)!.fire(true);
    await flush();
    inst.props = { topic: "travel" };
    inst.render();
    await flush();
    FakeObserver.all.at(-1)!.fire(true);
    await flush();
    assert.deepEqual(impReqs().map((r) => r.body.token), [TOKEN, T2]);
    assert.deepEqual(matchReqs().map((r) => r.body), [{ topic: "gaming" }, { topic: "travel" }]);
    inst.unmount();
  });
});

describe("component source: no credentials, no raw prompt forwarding", () => {
  it("never touches env, API key, Authorization, the node client, NEXT_PUBLIC or unsafe HTML", () => {
    assert.doesNotMatch(COMPONENT_SRC, /process\.env|BLISSCCO_|blc_live_|apiKey|Authorization|publisher-node|Idempotency|NEXT_PUBLIC|dangerouslySetInnerHTML|innerHTML|eval\(|document\.write/);
    assert.doesNotMatch(COMPONENT_SRC, /localStorage|sessionStorage|document\.cookie|navigator\.sendBeacon/);
    assert.match(COMPONENT_SRC, /^"use client";/);
  });

  it("only ever calls our own /api/blisscco-ad route (no direct Blisscco endpoint), with credentials omitted", () => {
    const urls = [...COMPONENT_SRC.matchAll(/fetch\(\s*"([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(urls, ["/api/blisscco-ad", "/api/blisscco-ad", "/api/blisscco-ad"]);
    assert.doesNotMatch(COMPONENT_SRC, /api\/v1\/ads|https?:\/\//);
    assert.equal((COMPONENT_SRC.match(/credentials: "omit"/g) ?? []).length, 3);
    assert.match(COMPONENT_SRC, /JSON\.stringify\(\{ topic \}\)/);
    assert.match(COMPONENT_SRC, /JSON\.stringify\(\{ token, event: "impression" \}\)/);
  });

  it("keeps the Sponsored disclosure and the safe-link validation", () => {
    assert.match(COMPONENT_SRC, />Sponsored<\/p>/);
    assert.match(COMPONENT_SRC, /aria-label="Sponsored"/);
    assert.match(COMPONENT_SRC, /d\.sponsored !== true/);
    assert.match(COMPONENT_SRC, /safeHref\(destination_url\)/);
    assert.match(COMPONENT_SRC, /window\.open\(target, "_blank", "noopener,noreferrer"\)/);
    assert.match(COMPONENT_SRC, /if \(!ad\) return null/);
  });

  it("the route never logs a token and reads credentials only from server env", () => {
    const code = ROUTE_SRC.replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(code, /console\.\w+\([^)]*(token|apiKey|process\.env)/);
    assert.doesNotMatch(code, /NEXT_PUBLIC|"use client"/);
    assert.match(ROUTE_SRC, /process\.env\.BLISSCCO_PUBLISHER_API_KEY/);
  });
});
