import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  REVIVE_DEFAULT_TIMEOUT_MS,
  REVIVE_DISABLED_CONFIG,
  REVIVE_MAX_BODY_CHARS,
  REVIVE_MAX_TIMEOUT_MS,
  createReviveAdapter,
  parseReviveConfig,
  type ReviveFetchResponse,
  type ReviveFetcher,
} from "@/lib/ads/revive-adapter";
import { deliverClickToAdapter, type AdProviderAdapter } from "@/lib/ads/provider-adapter";

// Day 22 Part 1: Revive boundary. Koi live network / asli database nahi; fetcher aur database dono nakli.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const code = (f: string) => read(f).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
const walk = (dir: string): string[] =>
  readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${dir}/${e.name}`] : [],
  );

const URL_OK = "https://delivery.example.com/serve";
const good = (over: Record<string, unknown> = {}) => ({ enabled: true, deliveryUrl: URL_OK, ...over });
const res = (status: number, body: string, contentType = "application/json"): ReviveFetchResponse => ({ status, headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? contentType : null) }, text: async () => body });

const spyFetcher = (impl: ReviveFetcher = async () => res(200, "{}")) => {
  const calls: Array<{ url: string; init: Parameters<ReviveFetcher>[1] }> = [];
  const fetcher: ReviveFetcher = async (url, init) => {
    calls.push({ url, init });
    return impl(url, init);
  };
  return { fetcher, calls };
};

describe("day 22 part 1 | adapter contract", () => {
  it("fits the existing AdProviderAdapter boundary, is frozen, and has no click hook", async () => {
    const adapter = createReviveAdapter();
    const asBoundary: AdProviderAdapter = adapter;
    assert.equal(asBoundary.name, "revive");
    assert.ok(Object.isFrozen(adapter));
    assert.equal(typeof adapter.requestFill, "function");
    assert.equal(adapter.onClickRecorded, undefined);
    const ev = { serveRef: "bsr_x", publisherId: "p", creativeId: "c", occurredAtMs: 1 };
    assert.equal(await deliverClickToAdapter(adapter, ev), "skipped"); // click flow par koi asar nahi
  });

  it("valid config + fetcher: one plain GET to the configured URL, nothing extra added", async () => {
    const { fetcher, calls } = spyFetcher(async () => res(200, '{"any":"shape"}'));
    const out = await createReviveAdapter(good(), { fetcher }).requestFill();
    assert.deepEqual(out, { status: "fill", format: "json", payload: { any: "shape" } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, new URL(URL_OK).href);
    assert.equal(calls[0].init.method, "GET");
    assert.deepEqual(Object.keys(calls[0].init.headers), ["accept"]);
    assert.equal(calls[0].init.headers.accept, "application/json");
    assert.ok(calls[0].init.signal instanceof AbortSignal);
  });

  it("html format returns the raw body untouched; no field is interpreted", async () => {
    const { fetcher, calls } = spyFetcher(async () => res(200, "<div>x</div>", "text/html; charset=utf-8"));
    const out = await createReviveAdapter(good({ responseFormat: "html" }), { fetcher }).requestFill();
    assert.deepEqual(out, { status: "fill", format: "html", body: "<div>x</div>" });
    assert.equal(calls[0].init.headers.accept, "text/html");
  });

  it("failures never throw: fetcher throw/reject, non-2xx, empty, bad JSON, oversize, text() reject => no-fill", async () => {
    const cases: Array<[ReviveFetcher, string, Record<string, unknown>?]> = [
      [async () => { throw new Error("boom"); }, "network_error"],
      [() => { throw new Error("sync boom"); }, "network_error"],
      [() => Promise.reject(new Error("rej")), "network_error"],
      [async () => res(500, "{}"), "http_error"],
      [async () => res(302, "{}"), "http_error"],
      [async () => res(200, "   "), "empty_response"],
      [async () => res(200, "not json"), "bad_response"],
      [async () => res(200, `"${"a".repeat(REVIVE_MAX_BODY_CHARS)}"`), "too_large"],
      [async () => ({ ...res(200, ""), text: async () => { throw new Error("body"); } }), "network_error"],
      [async () => ({ ...res(200, ""), text: async () => 42 as unknown as string }), "bad_response"],
      [async () => null as unknown as ReviveFetchResponse, "http_error"],
    ];
    for (const [impl, reason] of cases) {
      const out = await createReviveAdapter(good(), { fetcher: impl }).requestFill();
      assert.deepEqual(out, { status: "no-fill", reason });
    }
  });

  it("a hanging fetcher => timeout no-fill, request is aborted, late rejection is not unhandled", async () => {
    let unhandled = 0;
    const onUnhandled = () => { unhandled += 1; };
    process.on("unhandledRejection", onUnhandled);
    try {
      let signal: AbortSignal | undefined;
      const hang: ReviveFetcher = (_u, init) => {
        signal = init.signal;
        return new Promise<ReviveFetchResponse>((_, reject) => setTimeout(() => reject(new Error("late")), 60));
      };
      const started = Date.now();
      const out = await createReviveAdapter(good({ timeoutMs: 10 }), { fetcher: hang }).requestFill();
      assert.deepEqual(out, { status: "no-fill", reason: "timeout" });
      assert.ok(Date.now() - started < 50, "caller must not wait for the slow fetcher");
      assert.equal(signal?.aborted, true);
      await new Promise((r) => setTimeout(r, 120));
      assert.equal(unhandled, 0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("a hanging body read also times out", async () => {
    const slowBody: ReviveFetcher = async () => ({ ...res(200, ""), text: () => new Promise<string>(() => undefined) });
    const out = await createReviveAdapter(good({ timeoutMs: 10 }), { fetcher: slowBody }).requestFill();
    assert.deepEqual(out, { status: "no-fill", reason: "timeout" });
  });
});

describe("day 22 part 1 | disabled by default", () => {
  it("no config, null, empty, array, non-object, enabled:false => no-fill 'disabled', fetcher never called", async () => {
    for (const cfg of [undefined, null, {}, [], "x", 0, true, { enabled: false, deliveryUrl: URL_OK }, { deliveryUrl: URL_OK }]) {
      const { fetcher, calls } = spyFetcher();
      assert.deepEqual(await createReviveAdapter(cfg, { fetcher }).requestFill(), { status: "no-fill", reason: "disabled" });
      assert.equal(calls.length, 0);
    }
  });

  it("the exported default config is frozen and disabled", () => {
    assert.ok(Object.isFrozen(REVIVE_DISABLED_CONFIG));
    assert.equal(REVIVE_DISABLED_CONFIG.enabled, false);
    assert.equal(REVIVE_DISABLED_CONFIG.deliveryUrl, "");
    assert.deepEqual(parseReviveConfig(REVIVE_DISABLED_CONFIG), { ok: false, reason: "disabled" });
  });

  it("enabled with a valid config but neither an injected fetcher nor a global one => no-fill 'no_fetcher'", async () => {
    const g = globalThis as unknown as { fetch?: unknown };
    const saved = g.fetch;
    g.fetch = undefined; // Part 2: global fetch ab default hai; yahan hata kar dekhte hain
    try {
      assert.deepEqual(await createReviveAdapter(good()).requestFill(), { status: "no-fill", reason: "no_fetcher" });
      assert.deepEqual(await createReviveAdapter(good(), {}).requestFill(), { status: "no-fill", reason: "no_fetcher" });
    } finally {
      g.fetch = saved;
    }
  });
});

describe("day 22 part 1 | invalid configuration => no-fill", () => {
  const bad: Array<[string, unknown]> = [
    ["enabled is a string", good({ enabled: "true" })],
    ["enabled is 1", good({ enabled: 1 })],
    ["missing url", { enabled: true }],
    ["empty url", good({ deliveryUrl: "" })],
    ["non-string url", good({ deliveryUrl: 42 })],
    ["unparseable url", good({ deliveryUrl: "not a url" })],
    ["http (not https)", good({ deliveryUrl: "http://delivery.example.com/serve" })],
    ["other protocol", good({ deliveryUrl: "javascript:alert(1)" })],
    ["ftp protocol", good({ deliveryUrl: "ftp://delivery.example.com/x" })],
    ["credentials in url", good({ deliveryUrl: "https://user:pass@delivery.example.com/x" })],
    ["username only in url", good({ deliveryUrl: "https://user@delivery.example.com/x" })],
    ["fragment in url", good({ deliveryUrl: `${URL_OK}#frag` })],
    ["surrounding whitespace", good({ deliveryUrl: ` ${URL_OK}` })],
    ["url too long", good({ deliveryUrl: `https://delivery.example.com/${"a".repeat(2100)}` })],
    ["timeout zero", good({ timeoutMs: 0 })],
    ["timeout negative", good({ timeoutMs: -5 })],
    ["timeout fractional", good({ timeoutMs: 10.5 })],
    ["timeout above max", good({ timeoutMs: REVIVE_MAX_TIMEOUT_MS + 1 })],
    ["timeout string", good({ timeoutMs: "100" })],
    ["timeout NaN", good({ timeoutMs: Number.NaN })],
    ["unknown response format", good({ responseFormat: "xml" })],
    ["response format not string", good({ responseFormat: 1 })],
  ];

  for (const [label, cfg] of bad) {
    it(`${label} => invalid_config, fetcher never called, no throw`, async () => {
      assert.deepEqual(parseReviveConfig(cfg), { ok: false, reason: "invalid_config" });
      const { fetcher, calls } = spyFetcher();
      assert.deepEqual(await createReviveAdapter(cfg, { fetcher }).requestFill(), { status: "no-fill", reason: "invalid_config" });
      assert.equal(calls.length, 0);
    });
  }

  it("hostile config objects (throwing getters / proxies) never throw", async () => {
    const getter = { get enabled(): boolean { throw new Error("evil"); } };
    const proxy = new Proxy({}, { get() { throw new Error("evil"); }, has() { throw new Error("evil"); } });
    for (const cfg of [getter, proxy]) {
      const out = await createReviveAdapter(cfg, { fetcher: spyFetcher().fetcher }).requestFill();
      assert.equal(out.status, "no-fill");
    }
  });

  it("valid config gets safe defaults and a frozen, normalized result", () => {
    const r = parseReviveConfig(good());
    assert.ok(r.ok);
    if (r.ok) {
      assert.deepEqual(r.config, { enabled: true, deliveryUrl: new URL(URL_OK).href, timeoutMs: REVIVE_DEFAULT_TIMEOUT_MS, responseFormat: "json" });
      assert.ok(Object.isFrozen(r.config));
    }
    const edge = parseReviveConfig(good({ timeoutMs: REVIVE_MAX_TIMEOUT_MS, responseFormat: "html" }));
    assert.ok(edge.ok && edge.config.timeoutMs === REVIVE_MAX_TIMEOUT_MS && edge.config.responseFormat === "html");
  });
});

describe("day 22 part 1 | isolation from database, billing and production serving", () => {
  const FILE = "lib/ads/revive-adapter.ts";

  it("running the adapter never touches the (fake) database client", async () => {
    const touched: string[] = [];
    const g = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
    const before = g.__TEST_SUPABASE__;
    g.__TEST_SUPABASE__ = new Proxy({}, { get(_t, p) { touched.push(String(p)); return undefined; } });
    try {
      await createReviveAdapter(undefined).requestFill();
      await createReviveAdapter(good({ timeoutMs: 0 })).requestFill();
      await createReviveAdapter(good(), { fetcher: spyFetcher().fetcher }).requestFill();
      assert.deepEqual(touched, []);
    } finally {
      g.__TEST_SUPABASE__ = before;
    }
  });

  it("module only has a TYPE import of provider-adapter; no DB, billing, ledger, env, server-only or client modules", () => {
    const src = code(FILE);
    const imports = src.match(/^\s*import\s[^;]+;/gm) ?? [];
    assert.deepEqual(imports.map((i) => i.replace(/\s+/g, " ").trim()), ['import type { AdProviderAdapter } from "./provider-adapter";']);
    assert.ok(!/\brequire\(|import\(/.test(src));
    assert.ok(!/supabase|createAdminClient|ledger|payout|billing|spend|budget|campaigns|serve-db|click-db|impression-db|candidate/i.test(src));
    assert.ok(!/process\.env|server-only|"use client"|'use client'|console\.|\bfetch\(|XMLHttpRequest|localStorage|document\.|window\./.test(src));
    assert.ok(!/SELECT |INSERT |UPDATE |\.rpc\(/.test(src));
  });

  it("no credentials or secrets are part of the config type or module", () => {
    const src = code(FILE).split("\n").filter((l) => !/^\s*(\/\*|\*)/.test(l)).join("\n"); // JSDoc lines bhi hata do
    assert.ok(!/apikey|api_key|token|secret|password|authorization|cookie/i.test(src.replace(/password !== ""/g, "").replace(/\.password/g, "")));
  });

  it("no stray references: nothing else in app, lib or components imports or mentions the Revive adapter", () => {
    for (const f of ["app", "lib", "components"].flatMap(walk)) {
      if (f === FILE || f === "lib/ads/fallback-provider.ts" || f === "app/dashboard/publisher/guide/page.tsx") continue; // Day 22 Part 4: guide sirf text me batata hai (koi import nahi) // Day 22 Part 3: alag, flag-gated wiring file (service.ts me naam nahi aata)
      assert.ok(!/revive/i.test(code(f)), `${f} must not reference Revive`);
    }
    for (const f of ["lib/ads/service.ts", "lib/ads/match-handler.ts", "lib/ads/serve.ts", "lib/ads/click.ts", "lib/ads/click-handler.ts", "lib/ads/impression.ts", "app/api/v1/ads/match/route.ts"]) {
      assert.ok(!/revive/i.test(code(f)), f);
    }
  });

  it("no SQL, migration, package, env or workflow file mentions Revive", () => {
    for (const f of readdirSync(path.join(ROOT, "supabase/sql"))) assert.ok(!/revive/i.test(read(`supabase/sql/${f}`)), f);
    assert.ok(!/revive/i.test(read("package.json")));
    for (const f of readdirSync(path.join(ROOT, ".github/workflows"))) assert.ok(!/revive/i.test(read(`.github/workflows/${f}`)), f);
    for (const f of readdirSync(ROOT).filter((n) => /^\.env/.test(n))) assert.ok(!/revive/i.test(read(f)), f);
  });

  it("existing boundary is unchanged: provider-adapter.ts still has no Revive, imports or network", () => {
    const a = code("lib/ads/provider-adapter.ts");
    assert.ok(!/^\s*import\s/m.test(a));
    assert.ok(!/revive|fetch\(|process\.env/i.test(a));
  });
});
