import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { FALLBACK_TOTAL_TIMEOUT_MS, fallbackAllowedFor, routeServeWithFallback, type FallbackDeps, type FallbackOutcome } from "@/lib/ads/fallback-routing";
import { providerFallbackFromEnv } from "@/lib/ads/fallback-provider";
import { serveAd, type ServeDeps, type ServeResult } from "@/lib/ads/serve";
import type { ReviveFetcher } from "@/lib/ads/revive-adapter";
import type { MatchedAd, MatchRequest } from "@/lib/ads/types";

// Day 22 Part 3: Blisscco-first fallback. Database, ledger, network sab NAKLI; asli Supabase / Revive kabhi nahi chhuta.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const code = (f: string) => read(f).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

const KEY = "hash_abc";
const AD: MatchedAd = { id: "00000000-0000-4000-8000-0000000000c1", headline: "H", body: "B", ctaText: "Go", destinationUrl: "https://advertiser.example.com/x" };
const REQ: MatchRequest = { topic: "gaming", excludeAdIds: [] };
const FILL: FallbackOutcome = { provider: "revive", format: "json", data: { marker: "RAW-DATA-42" } };
const NO_FILL_BLISSCCO = { source: "blisscco", result: { kind: "no_fill" } };

/** Blisscco ke apne serve ka chhota model + spy: kitni baar serve / provider / flag chala. */
function harness(serveResult: ServeResult | (() => Promise<ServeResult>), over: Partial<FallbackDeps> = {}, outcome: FallbackOutcome | (() => Promise<FallbackOutcome>) = FILL) {
  const seen = { serve: 0, flag: 0, provider: 0 };
  const deps: FallbackDeps = {
    serve: async () => {
      seen.serve += 1;
      return typeof serveResult === "function" ? serveResult() : serveResult;
    },
    isEnabled: () => {
      seen.flag += 1;
      return true;
    },
    request: async () => {
      seen.provider += 1;
      return typeof outcome === "function" ? outcome() : outcome;
    },
    ...over,
  };
  return { deps, seen };
}
const run = (h: ReturnType<typeof harness>, req: MatchRequest = REQ) => routeServeWithFallback(KEY, req, h.deps);

describe("day 22 part 3 | Blisscco fill takes precedence", () => {
  it("Blisscco ad => returned as-is, provider and flag are never consulted", async () => {
    const h = harness({ kind: "ad", ad: AD });
    assert.deepEqual(await run(h), { source: "blisscco", result: { kind: "ad", ad: AD } });
    assert.deepEqual(h.seen, { serve: 1, flag: 0, provider: 0 });
  });

  it("Blisscco's tracking grant passes through untouched", async () => {
    const tracking = { token: "t", expiresAt: "x", events: ["impression"], clickRef: "bc1.a.b" } as unknown as NonNullable<Extract<ServeResult, { kind: "ad" }>["tracking"]>;
    const h = harness({ kind: "ad", ad: AD, tracking });
    const out = await run(h);
    assert.equal(out.source, "blisscco");
    assert.equal(out.source === "blisscco" && out.result.kind === "ad" && out.result.tracking, tracking);
  });

  it("unauthorized / rate_limited / unavailable are NOT fallback cases (provider never called)", async () => {
    for (const kind of ["unauthorized", "rate_limited", "unavailable"] as const) {
      const h = harness({ kind });
      assert.deepEqual(await run(h), { source: "blisscco", result: { kind } });
      assert.equal(h.seen.provider, 0);
      assert.equal(h.seen.flag, 0);
    }
  });

  it("a throwing Blisscco serve => unavailable, no fallback", async () => {
    const h = harness(async () => { throw new Error("boom"); });
    assert.deepEqual(await run(h), { source: "blisscco", result: { kind: "unavailable" } });
    assert.equal(h.seen.provider, 0);
  });
});

describe("day 22 part 3 | provider fallback after Blisscco no-fill", () => {
  it("no_fill + flag on => provider fill with explicit attribution and no Blisscco charge/serve/impression", async () => {
    const h = harness({ kind: "no_fill" });
    const out = await run(h);
    assert.equal(out.source, "provider");
    if (out.source !== "provider") return;
    assert.equal(out.provider, "revive");
    assert.deepEqual(out.fill, { provider: "revive", format: "json", data: { marker: "RAW-DATA-42" } });
    assert.deepEqual(out.blisscco, { charged: false, serveRecorded: false, impressionClaimed: false });
    assert.deepEqual(h.seen, { serve: 1, flag: 1, provider: 1 });
    assert.ok(Object.isFrozen(out) && Object.isFrozen(out.fill));
  });

  it("order is Blisscco first, then flag, then provider", async () => {
    const order: string[] = [];
    const h = harness(async () => { order.push("blisscco"); return { kind: "no_fill" }; }, { isEnabled: () => { order.push("flag"); return true; } }, async () => { order.push("provider"); return FILL; });
    await run(h);
    assert.deepEqual(order, ["blisscco", "flag", "provider"]);
  });

  it("the fill result never leaks raw data if serialized; html fill works too", async () => {
    const out = await run(harness({ kind: "no_fill" }));
    assert.ok(!JSON.stringify(out).includes("RAW-DATA-42"));
    const html = await run(harness({ kind: "no_fill" }, {}, { provider: "revive", format: "html", data: "<p>x</p>" }));
    assert.equal(html.source, "provider");
  });

  it("sensitive topic (or sensitive fallback topic) => no provider call; an Idempotency-Key no longer blocks it (Day 22 Part 7)", async () => {
    for (const req of [
      { ...REQ, topic: "health" },
      { ...REQ, fallbackTopics: ["technology", "medical"] },
    ] as MatchRequest[]) {
      const h = harness({ kind: "no_fill" });
      assert.deepEqual(await run(h, req), NO_FILL_BLISSCCO);
      assert.equal(h.seen.provider, 0);
      assert.equal(fallbackAllowedFor(req), false);
    }
    assert.equal(fallbackAllowedFor(REQ), true);
    assert.equal(fallbackAllowedFor({ ...REQ, topic: "nonexistent_topic" }), true);
    const keyed = { ...REQ, idempotencyKey: "retry-key-0001" } as MatchRequest;
    assert.equal(fallbackAllowedFor(keyed), true);
    const h = harness({ kind: "no_fill" });
    assert.equal((await run(h, keyed)).source, "provider");
    assert.equal(h.seen.provider, 1);
  });
});

describe("day 22 part 3 | disabled by default and safe on any provider failure", () => {
  it("flag off (false, or throws) => existing no-fill, provider never called", async () => {
    for (const isEnabled of [() => false, () => { throw new Error("env"); }, () => "true" as unknown as boolean, () => 1 as unknown as boolean]) {
      const h = harness({ kind: "no_fill" }, { isEnabled });
      assert.deepEqual(await run(h), NO_FILL_BLISSCCO);
      assert.equal(h.seen.provider, 0);
    }
  });

  it("provider null / throw / reject => existing no-fill, never throws", async () => {
    for (const outcome of [null, async () => { throw new Error("boom"); }, () => { throw new Error("sync"); }, () => Promise.reject(new Error("rej"))] as Array<FallbackOutcome | (() => Promise<FallbackOutcome>)>) {
      assert.deepEqual(await run(harness({ kind: "no_fill" }, {}, outcome)), NO_FILL_BLISSCCO);
    }
  });

  it("malformed provider results => existing no-fill", async () => {
    const bad: unknown[] = [
      { provider: "revive", format: "xml", data: {} },
      { provider: "revive", format: "json", data: null },
      { provider: "revive", format: "json", data: [] },
      { provider: "revive", format: "json", data: "str" },
      { provider: "revive", format: "html", data: "   " },
      { provider: "revive", format: "html", data: { a: 1 } },
      { provider: "", format: "json", data: {} },
      { format: "json", data: {} },
      "fill",
      42,
      undefined,
    ];
    for (const b of bad) assert.deepEqual(await run(harness({ kind: "no_fill" }, {}, async () => b as FallbackOutcome)), NO_FILL_BLISSCCO, JSON.stringify(b)); // fn ke through: undefined default me na badle
  });

  it("a hanging provider => no-fill after the outer timeout; late rejection is not unhandled", async () => {
    let unhandled = 0;
    const on = () => { unhandled += 1; };
    process.on("unhandledRejection", on);
    try {
      const h = harness({ kind: "no_fill" }, { timeoutMs: 15 }, () => new Promise<FallbackOutcome>((_, rej) => setTimeout(() => rej(new Error("late")), 60)));
      const started = Date.now();
      assert.deepEqual(await run(h), NO_FILL_BLISSCCO);
      assert.ok(Date.now() - started < 50);
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(unhandled, 0);
    } finally {
      process.off("unhandledRejection", on);
    }
    assert.equal(FALLBACK_TOTAL_TIMEOUT_MS, 3500);
  });
});

describe("day 22 part 3 | fallback never touches Blisscco billing or serve records (real serveAd + fake deps)", () => {
  type Spy = { authorize: number; select: number; record: number; tracking: number; replay: number };
  function blisscco(select: ServeDeps["select"]) {
    const spy: Spy = { authorize: 0, select: 0, record: 0, tracking: 0, replay: 0 };
    const deps: ServeDeps = {
      authorize: async () => { spy.authorize += 1; return { outcome: "ok", publisher: { id: "p1", status: "active" }, unitCostUsd: 0.01 }; },
      select: async (r, c) => { spy.select += 1; return select(r, c); },
      record: async () => { spy.record += 1; return { outcome: "recorded", serve: { serveRef: "bsr_x", servedAtMs: 1 } }; },
      lookupReplay: async () => { spy.replay += 1; return { outcome: "none" }; },
      issueTracking: () => { spy.tracking += 1; return null; },
    };
    return { spy, serve: (k: string, r: MatchRequest) => serveAd(k, r, deps) };
  }
  const deps = (serve: FallbackDeps["serve"], request: FallbackDeps["request"]): FallbackDeps => ({ serve, isEnabled: () => true, request });

  it("Blisscco has no eligible ad => provider fill, and record / tracking / replay were NEVER called", async () => {
    const b = blisscco(async () => ({ fill: false, reason: "no_eligible_candidates" }));
    const out = await routeServeWithFallback(KEY, { ...REQ, trackingRequested: true }, deps(b.serve, async () => FILL));
    assert.equal(out.source, "provider");
    assert.equal(b.spy.record, 0, "no serve record / spend write for a provider ad");
    assert.equal(b.spy.tracking, 0, "no tracking token for a provider ad");
    assert.equal(b.spy.authorize, 1);
    assert.ok(b.spy.select >= 1);
    assert.ok(!JSON.stringify(out).includes("tracking"));
  });

  it("Blisscco fills => exactly one record, provider never called", async () => {
    const b = blisscco(async () => ({ fill: true, ad: AD, repeat: false, budgetEnforced: true }));
    let providerCalls = 0;
    const out = await routeServeWithFallback(KEY, REQ, deps(b.serve, async () => { providerCalls += 1; return FILL; }));
    assert.equal(out.source, "blisscco");
    assert.equal(out.source === "blisscco" && out.result.kind, "ad");
    assert.equal(b.spy.record, 1);
    assert.equal(providerCalls, 0);
  });

  it("budget rejected by the database on every attempt => no_fill => provider; extra record attempts are Blisscco's own, none for the provider", async () => {
    const b = blisscco(async () => ({ fill: true, ad: AD, repeat: false, budgetEnforced: true, nextAds: [] }));
    const spyRecord = { n: 0 };
    const serve: FallbackDeps["serve"] = (k, r) => serveAd(k, r, {
      authorize: async () => ({ outcome: "ok", publisher: { id: "p1", status: "active" }, unitCostUsd: 0.01 }),
      select: async () => ({ fill: true, ad: AD, repeat: false, budgetEnforced: true }),
      record: async () => { spyRecord.n += 1; return { outcome: "rejected" }; },
    });
    const out = await routeServeWithFallback(KEY, REQ, deps(serve, async () => FILL));
    assert.equal(out.source, "provider");
    assert.equal(spyRecord.n, 1, "only Blisscco's own (rejected) record attempt; nothing recorded for the provider");
    assert.equal(b.spy.record, 0);
  });

  it("candidate load failure (outage) and unauthorized publisher => no fallback at all", async () => {
    let providerCalls = 0;
    const provider = async () => { providerCalls += 1; return FILL; };
    const outage = blisscco(async () => ({ fill: false, reason: "candidate_load_failed" }));
    assert.deepEqual(await routeServeWithFallback(KEY, REQ, deps(outage.serve, provider)), { source: "blisscco", result: { kind: "unavailable" } });
    const unauth = (k: string, r: MatchRequest) => serveAd(k, r, { authorize: async () => ({ outcome: "unauthorized" }), select: async () => ({ fill: false, reason: "no_eligible_candidates" }), record: async () => ({ outcome: "rejected" }) });
    assert.deepEqual(await routeServeWithFallback(KEY, REQ, deps(unauth, provider)), { source: "blisscco", result: { kind: "unauthorized" } });
    assert.equal(providerCalls, 0);
  });

  it("the fake database client is never touched by routing or the provider wiring", async () => {
    const touched: string[] = [];
    const g = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
    const before = g.__TEST_SUPABASE__;
    g.__TEST_SUPABASE__ = new Proxy({}, { get(_t, p) { touched.push(String(p)); return undefined; } });
    try {
      const w = providerFallbackFromEnv({ REVIVE_FALLBACK_ENABLED: "true", REVIVE_DELIVERY_URL: "https://d.example.com/z" }, { fetcher: async () => { throw new Error("x"); } });
      await routeServeWithFallback(KEY, REQ, { serve: async () => ({ kind: "no_fill" }), ...w });
      assert.deepEqual(touched, []);
    } finally {
      g.__TEST_SUPABASE__ = before;
    }
  });
});

describe("day 22 part 3 | production wiring from server env (flag default off)", () => {
  const URL_OK = "https://delivery.example.com/serve?zoneid=3&key=SECRETKEY999";
  const jsonFetcher = (body: string, ct = "application/json") => {
    const calls: string[] = [];
    const fetcher: ReviveFetcher = async (url) => {
      calls.push(url);
      return new Response(body, { headers: { "content-type": ct } }) as unknown as Awaited<ReturnType<ReviveFetcher>>;
    };
    return { fetcher, calls };
  };
  const via = (env: Record<string, string | undefined>, fetcher: ReviveFetcher) => {
    const w = providerFallbackFromEnv(env, { fetcher });
    return routeServeWithFallback(KEY, REQ, { serve: async () => ({ kind: "no_fill" }), ...w });
  };

  it("flag unset / false / TRUE / 1 / empty => disabled, no request is made", async () => {
    for (const flag of [undefined, "false", "TRUE", "True", "1", "yes", "", " true"]) {
      const { fetcher, calls } = jsonFetcher('{"a":1}');
      assert.deepEqual(await via({ REVIVE_FALLBACK_ENABLED: flag, REVIVE_DELIVERY_URL: URL_OK }, fetcher), NO_FILL_BLISSCCO, String(flag));
      assert.equal(calls.length, 0);
    }
  });

  it("flag exactly 'true' + valid URL => provider fill attributed to revive", async () => {
    const { fetcher, calls } = jsonFetcher('{"a":1}');
    const out = await via({ REVIVE_FALLBACK_ENABLED: "true", REVIVE_DELIVERY_URL: URL_OK, REVIVE_TIMEOUT_MS: "500" }, fetcher);
    assert.equal(out.source, "provider");
    assert.equal(out.source === "provider" && out.provider, "revive");
    assert.deepEqual(out.source === "provider" && out.fill.data, { a: 1 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0], new URL(URL_OK).href);
  });

  it("html format from env works; bad url / bad timeout / bad format / missing url => no-fill without any request", async () => {
    const ok = jsonFetcher("<p>x</p>", "text/html");
    const html = await via({ REVIVE_FALLBACK_ENABLED: "true", REVIVE_DELIVERY_URL: URL_OK, REVIVE_RESPONSE_FORMAT: "html" }, ok.fetcher);
    assert.equal(html.source, "provider");
    const bads: Array<Record<string, string>> = [
      { REVIVE_DELIVERY_URL: "http://delivery.example.com/x" },
      { REVIVE_DELIVERY_URL: "not a url" },
      { REVIVE_DELIVERY_URL: URL_OK, REVIVE_TIMEOUT_MS: "abc" },
      { REVIVE_DELIVERY_URL: URL_OK, REVIVE_TIMEOUT_MS: "-1" },
      { REVIVE_DELIVERY_URL: URL_OK, REVIVE_TIMEOUT_MS: "999999" },
      { REVIVE_DELIVERY_URL: URL_OK, REVIVE_RESPONSE_FORMAT: "xml" },
      {},
    ];
    for (const b of bads) {
      const { fetcher, calls } = jsonFetcher('{"a":1}');
      assert.deepEqual(await via({ REVIVE_FALLBACK_ENABLED: "true", ...b }, fetcher), NO_FILL_BLISSCCO, JSON.stringify(b));
      assert.equal(calls.length, 0);
    }
  });

  it("provider failures (network, 500, wrong content-type, malformed, oversize) => existing no-fill; nothing leaks", async () => {
    const env = { REVIVE_FALLBACK_ENABLED: "true", REVIVE_DELIVERY_URL: URL_OK };
    const fetchers: ReviveFetcher[] = [
      async () => { throw new Error(`SECRETKEY999 ${URL_OK}`); },
      async () => new Response("{}", { status: 500, headers: { "content-type": "application/json" } }) as never,
      jsonFetcher('{"a":1}', "text/plain").fetcher,
      jsonFetcher("{broken").fetcher,
      jsonFetcher("[1,2]").fetcher,
      jsonFetcher(`{"a":"${"x".repeat(70000)}"}`).fetcher,
    ];
    for (const f of fetchers) {
      const out = await via(env, f);
      assert.deepEqual(out, NO_FILL_BLISSCCO);
      assert.ok(!JSON.stringify(out).includes("SECRETKEY999"));
    }
  });
});

describe("day 22 part 3 | static isolation", () => {
  const NEW = ["lib/ads/fallback-routing.ts", "lib/ads/fallback-provider.ts"];

  it("routing/provider modules import no database, billing, ledger, payout, serve-db, click/impression db or client-only code", () => {
    for (const f of NEW) {
      const src = code(f);
      const imports = (src.match(/^\s*import\s[^;]+;/gm) ?? []).join("\n");
      assert.ok(!/supabase|serve-db|click-db|impression-db|ledger|payout|candidate-loader|selection|budget|server-only/i.test(imports), f);
      assert.ok(!/process\.env|console\.|\bfetch\(|createAdminClient|"use client"/.test(src), f);
      assert.ok(!/\.rpc\(|SELECT |INSERT |UPDATE /.test(src), f);
    }
  });

  it("the routing module is provider-neutral (no Revive name); only the wiring file names it", () => {
    assert.ok(!/revive/i.test(code("lib/ads/fallback-routing.ts")));
    assert.ok(/revive/i.test(code("lib/ads/fallback-provider.ts")));
  });

  it("service.ts: Blisscco's own serveAdForPublisher is unchanged and nothing else calls the fallback path", () => {
    const svc = read("lib/ads/service.ts");
    assert.match(svc, /export function serveAdForPublisher\(keyHash: string, request: MatchRequest\): Promise<ServeResult> \{\n  return serveAd\(keyHash, request, productionDeps\);\n\}/);
    assert.match(svc, /serve: serveAdForPublisher/);
    assert.ok(!/revive/i.test(code("lib/ads/service.ts")));
    const users: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
        if (e.isDirectory()) walk(`${d}/${e.name}`);
        else if (/\.(ts|tsx)$/.test(e.name) && /serveAdWithFallbackForPublisher/.test(code(`${d}/${e.name}`))) users.push(`${d}/${e.name}`);
      }
    };
    for (const d of ["app", "lib", "components"]) walk(d);
    assert.deepEqual(users, ["lib/ads/service.ts"], "only service.ts calls the fallback path; the handler goes through serveMatchForPublisher");
  });

  it("match API contract, handler and routes do not name the fallback or Revive (handler only calls the neutral service entry point)", () => {
    for (const f of ["lib/ads/contract.ts", "lib/ads/match-handler.ts", "lib/ads/serve.ts", "lib/ads/serve-db.ts", "app/api/v1/ads/match/route.ts", "app/api/ads/match/route.ts"]) {
      assert.ok(!/fallback-routing|fallback-provider|serveAdWithFallback|revive/i.test(code(f)), f);
    }
    assert.match(code("lib/ads/match-handler.ts"), /serveMatchForPublisher\(hashApiKey\(key\), matchRequest\)/); // Day 22 Part 6: neutral entry point (service.ts)
  });

  it("no SQL, package or workflow change mentions the fallback; no credential env var is committed", () => {
    for (const f of readdirSync(path.join(ROOT, "supabase/sql"))) assert.ok(!/revive|REVIVE_/i.test(read(`supabase/sql/${f}`)), f);
    assert.ok(!/revive/i.test(read("package.json")));
    for (const f of readdirSync(ROOT).filter((n) => /^\.env/.test(n))) assert.ok(!/REVIVE_/.test(read(f)), f);
  });
});
