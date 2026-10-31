import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { inspect } from "node:util";
import path from "node:path";
import { REVIVE_MAX_BODY_BYTES, createReviveAdapter, type ReviveFillResult } from "@/lib/ads/revive-adapter";

// Day 22 Part 2: bounded Revive delivery client. globalThis.fetch NAKLI hai; asli network, credential ya Revive instance kabhi nahi chhuta.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const code = (f: string) => read(f).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
const walk = (dir: string): string[] =>
  readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${dir}/${e.name}`] : [],
  );

const SECRET_KEY = "SUPERSECRET123";
const HOST = "delivery.internal-revive.example.com";
const URL_WITH_SECRET = `https://${HOST}/serve?zoneid=7&key=${SECRET_KEY}`;
const RAW_MARK = "RAW-PROVIDER-BODY-9d1";
const ERR_MARK = "PROVIDER-ERROR-TEXT-77";
const cfg = (over: Record<string, unknown> = {}) => ({ enabled: true, deliveryUrl: URL_WITH_SECRET, timeoutMs: 60, ...over });

type FetchCall = { url: string; init: RequestInit };
type Impl = (url: string, init: RequestInit) => Promise<Response>;

const realFetch = globalThis.fetch;
let calls: FetchCall[] = [];
const mockFetch = (impl: Impl) => {
  calls = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return impl(String(input), init ?? {});
  }) as typeof fetch;
};
const json = (body: unknown, ct = "application/json") => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": ct } });
const run = (over: Record<string, unknown> = {}) => createReviveAdapter(cfg(over)).requestFill();
const reasonOf = (r: ReviveFillResult) => (r.status === "no-fill" ? r.reason : "fill");

beforeEach(() => {
  mockFetch(async () => {
    throw new Error("test: unexpected network call");
  });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("day 22 part 2 | valid response", () => {
  it("one server-side GET to ONLY the configured URL, with safe request options", async () => {
    mockFetch(async () => json({ anything: [1, 2] }));
    const out = await run();
    assert.deepEqual(out, { status: "fill", format: "json", payload: { anything: [1, 2] } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, new URL(URL_WITH_SECRET).href);
    assert.equal(calls[0].init.method, "GET");
    assert.equal(calls[0].init.redirect, "error");
    assert.equal(calls[0].init.credentials, "omit");
    assert.equal(calls[0].init.cache, "no-store");
    assert.deepEqual(calls[0].init.headers, { accept: "application/json" });
    assert.ok(calls[0].init.signal instanceof AbortSignal);
    assert.equal(calls[0].init.body, undefined);
  });

  it("html format: raw body, text/html accepted", async () => {
    mockFetch(async () => new Response("<p>hi</p>", { headers: { "content-type": "text/html; charset=utf-8" } }));
    assert.deepEqual(await run({ responseFormat: "html" }), { status: "fill", format: "html", body: "<p>hi</p>" });
    assert.equal((calls[0].init.headers as Record<string, string>).accept, "text/html");
  });

  it("content-type matching is case-insensitive and accepts only utf-8 charset", async () => {
    for (const ct of ["application/json", "Application/JSON", "application/json; charset=utf-8", 'application/json; charset="UTF-8"', "application/json;"]) {
      mockFetch(async () => json({ ok: true }, ct));
      assert.equal(reasonOf(await run()), "fill", ct);
    }
  });

  it("a body of exactly the size limit is accepted", async () => {
    const pad = "x".repeat(REVIVE_MAX_BODY_BYTES - `{"a":""}`.length);
    mockFetch(async () => new Response(`{"a":"${pad}"}`, { headers: { "content-type": "application/json" } }));
    assert.equal(reasonOf(await run()), "fill");
  });

  it("the fill result does not leak the raw body if it is accidentally serialized", async () => {
    mockFetch(async () => json({ marker: RAW_MARK }));
    const out = await run();
    assert.equal(out.status, "fill");
    assert.ok(!JSON.stringify(out).includes(RAW_MARK));
    assert.deepEqual(JSON.parse(JSON.stringify(out)), { status: "fill", format: "json" });
  });
});

describe("day 22 part 2 | invalid content type, status and malformed payload are rejected", () => {
  it("wrong / missing / unsupported content-type => bad_content_type (body never trusted)", async () => {
    for (const ct of ["text/plain", "text/html", "application/xml", "application/jsonp", "application/json-seq", "application/x-javascript", "application/json; charset=latin1", "application/json; boundary=x", "image/gif", ""]) {
      mockFetch(async () => new Response(JSON.stringify({ a: 1 }), { headers: ct === "" ? {} : { "content-type": ct } }));
      // string body ke saath runtime text/plain jodta hai; "" case neeche alag se
      if (ct === "") continue;
      assert.equal(reasonOf(await run()), "bad_content_type", ct);
    }
    mockFetch(async () => new Response(new Uint8Array([123, 125]))); // koi content-type nahi
    assert.equal(reasonOf(await run()), "bad_content_type");
    mockFetch(async () => json({ a: 1 })); // json mila par html maanga tha
    assert.equal(reasonOf(await run({ responseFormat: "html" })), "bad_content_type");
  });

  it("non-2xx => http_error; redirects are not followed", async () => {
    for (const status of [301, 302, 400, 404, 429, 500, 503]) {
      mockFetch(async () => new Response("{}", { status: status >= 300 && status < 400 ? 200 : status, headers: { "content-type": "application/json" } }));
      if (status < 400) continue;
      assert.equal(reasonOf(await run()), "http_error", String(status));
    }
    mockFetch(async () => {
      throw new TypeError("redirect mode is set to error");
    });
    assert.equal(reasonOf(await run()), "network_error");
    assert.equal(calls[0].init.redirect, "error");
  });

  it("malformed or unexpected payloads => no-fill", async () => {
    const bodies: Array<[string, string]> = [
      ["{not json", "bad_response"],
      ['{"a":', "bad_response"],
      ["null", "bad_response"],
      ["[]", "bad_response"],
      ['[{"a":1}]', "bad_response"],
      ['"text"', "bad_response"],
      ["42", "bad_response"],
      ["true", "bad_response"],
      ["", "empty_response"],
      ["   \n", "empty_response"],
    ];
    for (const [body, reason] of bodies) {
      mockFetch(async () => new Response(body, { headers: { "content-type": "application/json" } }));
      assert.equal(reasonOf(await run()), reason, JSON.stringify(body));
    }
  });

  it("invalid UTF-8 bytes => bad_response (html and json)", async () => {
    const bad = new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]);
    mockFetch(async () => new Response(bad, { headers: { "content-type": "application/json" } }));
    assert.equal(reasonOf(await run()), "bad_response");
    mockFetch(async () => new Response(bad, { headers: { "content-type": "text/html" } }));
    assert.equal(reasonOf(await run({ responseFormat: "html" })), "bad_response");
  });
});

describe("day 22 part 2 | response size limit", () => {
  it("a buffered body over the limit => too_large", async () => {
    mockFetch(async () => new Response(`{"a":"${"x".repeat(REVIVE_MAX_BODY_BYTES)}"}`, { headers: { "content-type": "application/json" } }));
    assert.equal(reasonOf(await run()), "too_large");
  });

  it("multi-byte text is counted in bytes, not characters", async () => {
    const body = `{"a":"${"\u20ac".repeat(Math.ceil(REVIVE_MAX_BODY_BYTES / 3))}"}`; // chars kam, bytes zyada
    assert.ok(body.length < REVIVE_MAX_BODY_BYTES);
    mockFetch(async () => new Response(body, { headers: { "content-type": "application/json" } }));
    assert.equal(reasonOf(await run()), "too_large");
  });

  it("a huge declared content-length is rejected without reading the body", async () => {
    let read = false;
    mockFetch(async () => {
      const r = new Response("{}", { headers: { "content-type": "application/json", "content-length": String(REVIVE_MAX_BODY_BYTES + 1) } });
      const orig = r.text.bind(r);
      Object.defineProperty(r, "text", { value: () => { read = true; return orig(); } });
      return r;
    });
    assert.equal(reasonOf(await run()), "too_large");
    assert.equal(read, false);
  });

  it("an endless stream is cut off at the limit and cancelled (never fully buffered)", async () => {
    const state = { pulls: 0, cancelled: false };
    mockFetch(async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(ctrl) { state.pulls += 1; ctrl.enqueue(new Uint8Array(1024).fill(97)); },
          cancel() { state.cancelled = true; },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    const started = Date.now();
    assert.equal(reasonOf(await run({ timeoutMs: 2000 })), "too_large");
    assert.ok(Date.now() - started < 1000);
    assert.equal(state.cancelled, true);
    assert.ok(state.pulls < 200, `pulled ${state.pulls} chunks`);
  });
});

describe("day 22 part 2 | timeout and network failure", () => {
  it("a fetch that never answers => timeout, request aborted, caller not blocked", async () => {
    let signal: AbortSignal | undefined;
    mockFetch((_u, init) => {
      signal = init.signal as AbortSignal;
      return new Promise<Response>(() => undefined);
    });
    const started = Date.now();
    assert.deepEqual(await run({ timeoutMs: 20 }), { status: "no-fill", reason: "timeout" });
    assert.ok(Date.now() - started < 200);
    assert.equal(signal?.aborted, true);
  });

  it("a body that stalls after the headers => timeout and the stream is cancelled", async () => {
    const state = { cancelled: false };
    let first = true;
    mockFetch(async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(ctrl) {
            if (first) { first = false; ctrl.enqueue(new TextEncoder().encode('{"a":')); return undefined; }
            return new Promise<void>(() => undefined);
          },
          cancel() { state.cancelled = true; },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    assert.deepEqual(await run({ timeoutMs: 30 }), { status: "no-fill", reason: "timeout" });
    assert.equal(state.cancelled, true);
  });

  it("the timeout is ONE deadline for fetch + body (slow headers plus slow body still times out)", async () => {
    mockFetch(async () => {
      await new Promise((r) => setTimeout(r, 35));
      return new Response(new ReadableStream<Uint8Array>({ start(c) { setTimeout(() => { try { c.enqueue(new TextEncoder().encode("{}")); c.close(); } catch { /* cancel ho chuka */ } }, 35); } }), { headers: { "content-type": "application/json" } });
    });
    assert.deepEqual(await run({ timeoutMs: 50 }), { status: "no-fill", reason: "timeout" });
  });

  it("late rejection after a timeout is not an unhandled rejection", async () => {
    let unhandled = 0;
    const on = () => { unhandled += 1; };
    process.on("unhandledRejection", on);
    try {
      mockFetch(() => new Promise<Response>((_, rej) => setTimeout(() => rej(new Error("late")), 50)));
      assert.equal(reasonOf(await run({ timeoutMs: 10 })), "timeout");
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(unhandled, 0);
    } finally {
      process.off("unhandledRejection", on);
    }
  });

  it("network failure (reject, sync throw, mid-body stream error) => network_error, never throws", async () => {
    mockFetch(async () => { throw new TypeError("fetch failed"); });
    assert.deepEqual(await run(), { status: "no-fill", reason: "network_error" });
    mockFetch(() => { throw new Error("sync"); });
    assert.deepEqual(await run(), { status: "no-fill", reason: "network_error" });
    mockFetch(async () =>
      new Response(new ReadableStream<Uint8Array>({ pull(c) { c.error(new Error("reset")); } }), { headers: { "content-type": "application/json" } }),
    );
    assert.deepEqual(await run(), { status: "no-fill", reason: "network_error" });
  });

  it("disabled / invalid config makes no request at all", async () => {
    for (const c of [undefined, { enabled: false, deliveryUrl: URL_WITH_SECRET }, cfg({ deliveryUrl: "http://x.example.com" }), cfg({ timeoutMs: 0 })]) {
      mockFetch(async () => json({ a: 1 }));
      await createReviveAdapter(c).requestFill();
      assert.equal(calls.length, 0);
    }
  });
});

describe("day 22 part 2 | secrets, URL, raw responses and provider errors are never disclosed", () => {
  const LEAKS = [SECRET_KEY, HOST, RAW_MARK, ERR_MARK, "zoneid"];
  const assertClean = (value: unknown) => {
    const text = typeof value === "string" ? value : JSON.stringify(value) + inspect(value, { depth: 5, showHidden: true });
    for (const needle of LEAKS) assert.ok(!text.includes(needle), `leaked: ${needle}`);
  };

  it("every no-fill result carries only a reason code, and nothing is logged", async () => {
    const logged: string[] = [];
    const methods = ["log", "info", "warn", "error", "debug", "trace"] as const;
    const saved = methods.map((m) => console[m]);
    methods.forEach((m) => { console[m] = (...a: unknown[]) => { logged.push(a.map(String).join(" ")); }; });
    const writes: string[] = [];
    const origOut = process.stdout.write;
    const origErr = process.stderr.write;
    process.stdout.write = ((c: unknown) => { writes.push(String(c)); return true; }) as typeof process.stdout.write;
    process.stderr.write = ((c: unknown) => { writes.push(String(c)); return true; }) as typeof process.stderr.write;
    const results: ReviveFillResult[] = [];
    try {
      const failing: Impl[] = [
        async () => { throw new Error(`${ERR_MARK} ${URL_WITH_SECRET}`); },
        async () => new Response(`${RAW_MARK} <html>`, { status: 500, headers: { "content-type": "text/html" } }),
        async () => new Response(`${RAW_MARK} not json`, { headers: { "content-type": "application/json" } }),
        async () => new Response(`{"${RAW_MARK}":`, { headers: { "content-type": "application/json" } }),
        async () => new Response(`${RAW_MARK}`, { headers: { "content-type": "text/plain" } }),
        async () => new Response(`["${RAW_MARK}"]`, { headers: { "content-type": "application/json" } }),
        async () => new Response(`{"${RAW_MARK}":"${"x".repeat(REVIVE_MAX_BODY_BYTES)}"}`, { headers: { "content-type": "application/json" } }),
        () => new Promise<Response>(() => undefined),
      ];
      for (const impl of failing) {
        mockFetch(impl);
        results.push(await run({ timeoutMs: 20 }));
      }
      results.push(await createReviveAdapter({ enabled: true, deliveryUrl: `http://${HOST}/x?key=${SECRET_KEY}` }).requestFill()); // invalid config
      results.push(await createReviveAdapter(undefined).requestFill());
    } finally {
      methods.forEach((m, i) => { console[m] = saved[i]; });
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    }
    for (const r of results) {
      assert.equal(r.status, "no-fill");
      assert.deepEqual(Object.keys(r).sort(), ["reason", "status"]);
      assertClean(r);
    }
    assert.deepEqual(logged, []);
    assertClean(writes.join(""));
  });

  it("the adapter object exposes no config, URL or credentials (JSON, keys, inspect)", () => {
    const adapter = createReviveAdapter(cfg());
    assert.deepEqual(Object.keys(adapter).sort(), ["name", "requestFill"]);
    assertClean(adapter);
    assertClean(Object.getOwnPropertyNames(adapter));
  });

  it("the URL/secret only ever goes to the fetch call itself, never as a header or body", async () => {
    mockFetch(async () => json({ a: 1 }));
    await run();
    const { init } = calls[0];
    assert.deepEqual(Object.keys(init.headers as object), ["accept"]);
    assert.equal(init.body, undefined);
    assert.ok(!JSON.stringify(init.headers).includes(SECRET_KEY));
  });
});

describe("day 22 part 2 | publishers, browser code and the match API are untouched", () => {
  const FILE = "lib/ads/revive-adapter.ts";

  it("module has no env, logging, DB, billing or client-only code and a single (global) fetch use", () => {
    const src = code(FILE);
    assert.ok(!/process\.env|console\.|server-only|"use client"|XMLHttpRequest|localStorage|document\.|window\./.test(src));
    assert.ok(!/supabase|createAdminClient|ledger|payout|billing|spend|budget|serve-db|click-db|impression-db/i.test(src));
    assert.equal((src.match(/globalThis/g) ?? []).length, 1);
    assert.deepEqual(src.match(/^\s*import\s[^;]+;/gm)?.map((i) => i.trim()), ['import type { AdProviderAdapter } from "./provider-adapter";']);
  });

  it("nothing in app, components or any other lib file references Revive (not attached; no browser/publisher exposure)", () => {
    for (const f of ["app", "components", "lib", "examples"].flatMap(walk)) {
      if (f === FILE || f === "lib/ads/fallback-provider.ts") continue; // Day 22 Part 3: flag-gated wiring file
      assert.ok(!/revive/i.test(code(f)), `${f} must not reference Revive`);
    }
  });

  it("match API contract and serving code do not mention Revive or the adapter", () => {
    for (const f of ["lib/ads/contract.ts", "lib/ads/match.ts", "lib/ads/match-handler.ts", "lib/ads/serve.ts", "lib/ads/service.ts", "app/api/v1/ads/match/route.ts", "app/api/ads/match/route.ts"]) {
      assert.ok(!/revive|revive-adapter/i.test(code(f)), f);
    }
  });

  it("no SQL, package, env or workflow file mentions Revive; no credential env var is introduced", () => {
    for (const f of readdirSync(path.join(ROOT, "supabase/sql"))) assert.ok(!/revive/i.test(read(`supabase/sql/${f}`)), f);
    assert.ok(!/revive/i.test(read("package.json")));
    for (const f of readdirSync(path.join(ROOT, ".github/workflows"))) assert.ok(!/revive/i.test(read(`.github/workflows/${f}`)), f);
    for (const f of readdirSync(ROOT).filter((n) => /^\.env/.test(n))) assert.ok(!/revive/i.test(read(f)), f);
  });
});
