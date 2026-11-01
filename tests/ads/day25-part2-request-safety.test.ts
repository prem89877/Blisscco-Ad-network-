import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  REVIVE_DEFAULT_TIMEOUT_MS,
  REVIVE_MAX_BODY_BYTES,
  REVIVE_MAX_TIMEOUT_MS,
  createReviveAdapter,
  parseReviveConfig,
  parseReviveEnv,
  type ReviveFetchInit,
  type ReviveFetcher,
  type ReviveFillResult,
} from "@/lib/ads/revive-adapter";

// Day 25 Part 2: redirect, timeout, abort, status, content type, size aur safe-error. Sirf mocked fetcher: koi real network, Revive server, DB ya credential nahi.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

const SECRET = "SECRETKEY-4417-zz";
const RAW_MARK = "RAW-PROVIDER-BODY-9d1";
const ERR_MARK = "PROVIDER-ERROR-TEXT-77";
const URL_WITH_SECRET = `https://delivery.example.com/serve?zoneid=7&key=${SECRET}`;
const HREF = new URL(URL_WITH_SECRET).href;
const GOOD = { headline: "Sample headline", body: "Sample body text.", cta_text: "Learn more", destination_url: "https://example.com/landing" };
const NO_FILL_REASONS = ["disabled", "invalid_config", "no_fetcher", "timeout", "network_error", "http_error", "bad_content_type", "too_large", "empty_response", "bad_response"];

type Res = Awaited<ReturnType<ReviveFetcher>>;
const asRes = (r: unknown) => r as Res;
const goodBody = JSON.stringify(GOOD);

/** Body ek stream jo batata hai ki cancel hui ya nahi. Response ke saath di jaati hai. */
function trackedStream(text: string) {
  const state = { cancelled: false, pulls: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(c) { state.pulls += 1; c.enqueue(new TextEncoder().encode(text)); c.close(); },
    cancel() { state.cancelled = true; },
  });
  return { stream, state };
}
function respond(opts: { status?: number; ct?: string | null; text?: string; extra?: Record<string, unknown>; headers?: Record<string, string> } = {}) {
  const { stream, state } = trackedStream(opts.text ?? goodBody);
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.ct !== null) headers["content-type"] = opts.ct ?? "application/json";
  // 204/205/3xx par Response body nahi leta; isliye status 200 se banao aur status override karo
  const real = new Response(stream, { status: 200, headers });
  Object.defineProperty(real, "status", { value: opts.status ?? 200 });
  for (const [k, v] of Object.entries(opts.extra ?? {})) Object.defineProperty(real, k, { value: v });
  return { res: asRes(real), state };
}

let calls: Array<{ url: string; init: ReviveFetchInit }> = [];
let logged: string[] = [];
let realNetworkCalls = 0;
const realFetch = globalThis.fetch;
const consoleMethods = ["log", "info", "warn", "error", "debug", "trace"] as const;
const originals: Record<string, (...a: unknown[]) => void> = {};
const timers = () => process.getActiveResourcesInfo().filter((n) => n === "Timeout").length;

const run = (fetcher: ReviveFetcher, over: Record<string, unknown> = {}) =>
  createReviveAdapter({ enabled: true, deliveryUrl: URL_WITH_SECRET, timeoutMs: 200, ...over }, {
    fetcher: (async (u, i) => { calls.push({ url: u, init: i }); return fetcher(u, i); }) as ReviveFetcher,
  }).requestFill();
const reasonOf = (r: ReviveFillResult) => (r.status === "no-fill" ? r.reason : "fill");
const tick = () => new Promise<void>((r) => setImmediate(r));

beforeEach(() => {
  calls = [];
  logged = [];
  realNetworkCalls = 0;
  for (const m of consoleMethods) {
    originals[m] = console[m] as (...a: unknown[]) => void;
    (console as unknown as Record<string, unknown>)[m] = (...a: unknown[]) => { logged.push(a.map(String).join(" ")); };
  }
  globalThis.fetch = (async () => { realNetworkCalls += 1; throw new Error("test: real network must never be called"); }) as typeof fetch;
});
afterEach(() => {
  for (const m of consoleMethods) (console as unknown as Record<string, unknown>)[m] = originals[m];
  globalThis.fetch = realFetch;
  assert.deepEqual(logged, [], "nothing may be logged");
  assert.equal(realNetworkCalls, 0, "only the mocked fetcher may be used");
});

describe("day 25 part 2 | redirects are rejected, never followed", () => {
  it("every request asks the platform fetch to error on redirect, with no cookies or credentials", async () => {
    await run(async () => respond().res);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.redirect, "error");
    assert.equal(calls[0].init.credentials, "omit");
    assert.equal(calls[0].init.cache, "no-store");
    assert.equal(calls[0].init.method, "GET");
    assert.deepEqual(Object.keys(calls[0].init.headers), ["accept"]);
  });

  it("3xx statuses (even with a valid JSON body and a Location header) => http_error, and no second request is made", async () => {
    for (const status of [300, 301, 302, 303, 304, 305, 307, 308]) {
      calls = [];
      const { res, state } = respond({ status, headers: { location: `https://evil.example.org/${RAW_MARK}` } });
      assert.equal(reasonOf(await run(async () => res)), "http_error", String(status));
      assert.equal(calls.length, 1, `${status}: Location must never be followed`);
      assert.equal(state.cancelled, true, `${status}: body must be discarded`);
      assert.ok(!calls.some((c) => c.url.includes("evil.example.org")));
    }
  });

  it("a platform fetch that errors on redirect => network_error with no detail", async () => {
    const out = await run(async () => { throw new TypeError(`redirect mode is set to error: ${URL_WITH_SECRET} ${ERR_MARK}`); });
    assert.deepEqual(out, { status: "no-fill", reason: "network_error" });
  });

  it("a lax fetcher that followed a redirect anyway (redirected:true) => http_error even with a 200 and valid JSON", async () => {
    const { res, state } = respond({ extra: { redirected: true } });
    assert.equal(reasonOf(await run(async () => res)), "http_error");
    assert.equal(state.cancelled, true);
  });

  it("an opaque redirect response type => http_error", async () => {
    for (const type of ["opaqueredirect", "opaque"]) {
      assert.equal(reasonOf(await run(async () => respond({ extra: { type } }).res)), "http_error", type);
    }
  });

  it("a final URL that differs from the configured URL (host, path, query or scheme) => http_error", async () => {
    for (const finalUrl of ["https://evil.example.org/serve?zoneid=7", "https://delivery.example.com/other?zoneid=7", "https://delivery.example.com/serve?zoneid=8", "http://delivery.example.com/serve?zoneid=7", "not a url"]) {
      assert.equal(reasonOf(await run(async () => respond({ extra: { url: finalUrl } }).res)), "http_error", finalUrl);
    }
  });

  it("the same final URL (or none) is fine", async () => {
    assert.equal(reasonOf(await run(async () => respond({ extra: { url: HREF } }).res)), "fill");
    assert.equal(reasonOf(await run(async () => respond({ extra: { url: "" } }).res)), "fill");
    assert.equal(reasonOf(await run(async () => respond().res)), "fill");
  });

  it("the delivery URL, its query and the redirect target never appear in the result", async () => {
    const out = await run(async () => respond({ status: 302, headers: { location: `https://evil.example.org/?k=${SECRET}` } }).res);
    assert.deepEqual(out, { status: "no-fill", reason: "http_error" });
  });
});

describe("day 25 part 2 | status and content type are checked before parsing", () => {
  it("non-2xx statuses => http_error, and the body is neither read nor kept open", async () => {
    for (const status of [100, 199, 400, 401, 403, 404, 410, 429, 500, 502, 503, 504]) {
      const { res, state } = respond({ status, text: RAW_MARK });
      assert.equal(reasonOf(await run(async () => res)), "http_error", String(status));
      assert.equal(state.cancelled, true, `${status}: body discarded`);
    }
  });

  it("2xx statuses are accepted (guide: Status 2xx)", async () => {
    for (const status of [200, 201, 202, 203]) assert.equal(reasonOf(await run(async () => respond({ status }).res)), "fill", String(status));
  });

  it("unexpected content types => bad_content_type, body discarded and never parsed", async () => {
    const cts: Array<string | null> = [null, "", "text/html", "text/html; charset=utf-8", "text/plain", "application/javascript", "application/xml", "application/json5", "application/vnd.api+json", "application/problem+json", "application/jsonp", "application/json; charset=latin1", "application/json; boundary=x", "multipart/form-data", `application/json; ${"x".repeat(300)}`];
    for (const ct of cts) {
      const { res, state } = respond({ ct, text: goodBody });
      assert.equal(reasonOf(await run(async () => res)), "bad_content_type", String(ct).slice(0, 40));
      assert.equal(state.cancelled, true, "body discarded");
    }
  });

  it("status is checked before content type, content type before the body is read", async () => {
    const { res, state } = respond({ status: 500, ct: "text/html" });
    assert.equal(reasonOf(await run(async () => res)), "http_error");
    const second = respond({ ct: "text/html" });
    assert.equal(reasonOf(await run(async () => second.res)), "bad_content_type");
    assert.equal(second.state.pulls <= 1, true, "at most the Response's own prefetch, never an adapter read");
    assert.equal(state.cancelled, true);
  });

  it("a valid status and content type with bad JSON => bad_response, with no raw text in the result", async () => {
    const out = await run(async () => respond({ text: `{"headline":"${RAW_MARK}` }).res);
    assert.deepEqual(out, { status: "no-fill", reason: "bad_response" });
  });

  it("a malformed response object (no headers, string status, null) => no-fill, never a throw", async () => {
    for (const weird of [null, undefined, {}, { status: "200" }, { status: 200 }, { status: 200, headers: {} }, { status: NaN, headers: { get: () => "application/json" } }]) {
      const out = await run(async () => weird as unknown as Res);
      assert.equal(out.status, "no-fill");
      assert.ok(NO_FILL_REASONS.includes(reasonOf(out)));
    }
  });
});

describe("day 25 part 2 | response size limit", () => {
  const over = JSON.stringify({ ...GOOD, pad: "x".repeat(REVIVE_MAX_BODY_BYTES) });

  it("the limit is the documented 65,536 bytes", () => {
    assert.equal(REVIVE_MAX_BODY_BYTES, 65536);
  });

  it("a declared content-length over the limit => too_large, body not read and discarded", async () => {
    const { res, state } = respond({ headers: { "content-length": String(REVIVE_MAX_BODY_BYTES + 1) } });
    assert.equal(reasonOf(await run(async () => res)), "too_large");
    assert.ok(state.pulls <= 1);
    assert.equal(state.cancelled, true);
  });

  it("an undeclared oversized body is counted while streaming and cancelled", async () => {
    let pulls = 0;
    let cancelled = false;
    const chunk = new Uint8Array(8192).fill(0x61);
    const stream = new ReadableStream<Uint8Array>({ pull(c) { pulls += 1; c.enqueue(chunk); }, cancel() { cancelled = true; } });
    const out = await run(async () => asRes(new Response(stream, { status: 200, headers: { "content-type": "application/json" } })));
    assert.equal(reasonOf(out), "too_large");
    assert.ok(pulls < 50, `pulled ${pulls} chunks`);
    await tick();
    assert.equal(cancelled, true);
  });

  it("a buffered oversized body, multi-byte text counted in bytes, and a lying content-length are all too_large", async () => {
    assert.equal(reasonOf(await run(async () => respond({ text: over }).res)), "too_large");
    const euro = JSON.stringify({ ...GOOD, pad: "\u20ac".repeat(Math.ceil(REVIVE_MAX_BODY_BYTES / 3)) });
    assert.ok(euro.length < REVIVE_MAX_BODY_BYTES);
    assert.equal(reasonOf(await run(async () => respond({ text: euro }).res)), "too_large");
    assert.equal(reasonOf(await run(async () => respond({ text: over, headers: { "content-length": "10" } }).res)), "too_large");
  });

  it("a body of exactly the limit is accepted, one byte more is not", async () => {
    const base = JSON.stringify({ ...GOOD, pad: "" });
    const exact = JSON.stringify({ ...GOOD, pad: "x".repeat(REVIVE_MAX_BODY_BYTES - base.length) });
    const plusOne = JSON.stringify({ ...GOOD, pad: "x".repeat(REVIVE_MAX_BODY_BYTES - base.length + 1) });
    assert.equal(new TextEncoder().encode(exact).byteLength, REVIVE_MAX_BODY_BYTES);
    assert.equal(reasonOf(await run(async () => respond({ text: exact }).res)), "fill");
    assert.equal(reasonOf(await run(async () => respond({ text: plusOne }).res)), "too_large");
  });
});

describe("day 25 part 2 | timeout uses the existing configuration", () => {
  it("the configured timeout is the one used: default 800 ms, max 3000 ms, out of range => invalid_config", () => {
    assert.equal(REVIVE_DEFAULT_TIMEOUT_MS, 800);
    assert.equal(REVIVE_MAX_TIMEOUT_MS, 3000);
    const def = parseReviveConfig({ enabled: true, deliveryUrl: URL_WITH_SECRET });
    assert.ok(def.ok && def.config.timeoutMs === 800);
    for (const t of [0, -1, 1.5, 3001, Number.NaN, "100", Infinity]) {
      assert.deepEqual(parseReviveConfig({ enabled: true, deliveryUrl: URL_WITH_SECRET, timeoutMs: t }), { ok: false, reason: "invalid_config" }, String(t));
    }
    assert.deepEqual(parseReviveEnv({ REVIVE_FALLBACK_ENABLED: "true", REVIVE_DELIVERY_URL: URL_WITH_SECRET, REVIVE_TIMEOUT_MS: "3001" }), { ok: false, reason: "invalid_config" });
  });

  it("a request that never answers => timeout after about the configured time, and the request is aborted", async () => {
    let signal: AbortSignal | undefined;
    const t0 = Date.now();
    const out = await run((_u, init) => { signal = init.signal; return new Promise<Res>(() => undefined); }, { timeoutMs: 40 });
    const took = Date.now() - t0;
    assert.deepEqual(out, { status: "no-fill", reason: "timeout" });
    assert.ok(took >= 30 && took < 800, `took ${took} ms`);
    assert.equal(signal?.aborted, true);
  });

  it("the deadline covers the body read too: headers arrive but the body stalls => timeout and the stream is cancelled", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => undefined); }, cancel() { cancelled = true; } });
    const out = await run(async () => asRes(new Response(stream, { status: 200, headers: { "content-type": "application/json" } })), { timeoutMs: 40 });
    assert.equal(reasonOf(out), "timeout");
    await tick();
    assert.equal(cancelled, true);
  });

  it("a response that arrives after the deadline is discarded (body cancelled), not used", async () => {
    const late = respond();
    const out = await run(() => new Promise<Res>((resolve) => setTimeout(() => resolve(late.res), 80)), { timeoutMs: 20 });
    assert.equal(reasonOf(out), "timeout");
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(late.state.cancelled, true);
  });

  it("a late rejection after the deadline is not an unhandled rejection and leaks nothing", async () => {
    let unhandled = 0;
    const onUnhandled = () => { unhandled += 1; };
    process.on("unhandledRejection", onUnhandled);
    try {
      const out = await run(() => new Promise<Res>((_, rej) => setTimeout(() => rej(new Error(`${ERR_MARK} ${SECRET}`)), 70)), { timeoutMs: 15 });
      assert.deepEqual(out, { status: "no-fill", reason: "timeout" });
      await new Promise((r) => setTimeout(r, 140));
      assert.equal(unhandled, 0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("day 25 part 2 | abort handling", () => {
  it("a fetcher that rejects with an AbortError (carrying secrets) after the timeout aborts it => still just 'timeout'", async () => {
    const out = await run((_u, init) => new Promise<Res>((_, rej) => init.signal.addEventListener("abort", () => rej(new DOMException(`aborted ${URL_WITH_SECRET} ${ERR_MARK}`, "AbortError")))), { timeoutMs: 25 });
    assert.deepEqual(out, { status: "no-fill", reason: "timeout" });
  });

  it("an AbortError that is not caused by our deadline => network_error, no detail", async () => {
    const out = await run(async () => { throw new DOMException(`aborted ${ERR_MARK}`, "AbortError"); });
    assert.deepEqual(out, { status: "no-fill", reason: "network_error" });
  });

  it("every non-fill result aborts the request signal (connection released); a fill does not", async () => {
    const seen: AbortSignal[] = [];
    const record = (make: () => Res | Promise<Res>): ReviveFetcher => async (_u, init) => { seen.push(init.signal); return make(); };
    const bad: ReviveFetcher[] = [
      record(() => respond({ status: 500 }).res),
      record(() => respond({ ct: "text/html" }).res),
      record(() => respond({ text: "not json" }).res),
      record(() => respond({ extra: { redirected: true } }).res),
      record(() => respond({ headers: { "content-length": String(REVIVE_MAX_BODY_BYTES + 5) } }).res),
    ];
    for (const f of bad) assert.notEqual(reasonOf(await run(f)), "fill");
    assert.equal(seen.length, bad.length);
    for (const s of seen) assert.equal(s.aborted, true);

    const ok: AbortSignal[] = [];
    const out = await run(async (_u, init) => { ok.push(init.signal); return respond().res; });
    assert.equal(out.status, "fill");
    assert.equal(ok[0].aborted, false);
  });

  it("a throwing body cancel never turns into a throw or an unhandled rejection", async () => {
    let unhandled = 0;
    const onUnhandled = () => { unhandled += 1; };
    process.on("unhandledRejection", onUnhandled);
    try {
      const broken = { status: 500, headers: { get: () => "application/json" }, body: { cancel: () => Promise.reject(new Error(SECRET)), getReader: () => { throw new Error(SECRET); } }, text: async () => RAW_MARK } as unknown as Res;
      assert.equal(reasonOf(await run(async () => broken)), "http_error");
      const throwing = { status: 500, headers: { get: () => "application/json" }, body: { cancel: () => { throw new Error(SECRET); } }, text: async () => RAW_MARK } as unknown as Res;
      assert.equal(reasonOf(await run(async () => throwing)), "http_error");
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(unhandled, 0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("day 25 part 2 | no timers or listeners are left behind", () => {
  const scenarios: Array<[string, ReviveFetcher, Record<string, unknown>?]> = [
    ["valid fill", async () => respond().res],
    ["http 500", async () => respond({ status: 500 }).res],
    ["redirect 302", async () => respond({ status: 302 }).res],
    ["bad content type", async () => respond({ ct: "text/html" }).res],
    ["oversized", async () => respond({ text: JSON.stringify({ ...GOOD, pad: "x".repeat(REVIVE_MAX_BODY_BYTES) }) }).res],
    ["bad json", async () => respond({ text: "nope" }).res],
    ["throwing fetcher", async () => { throw new Error(SECRET); }],
    ["timeout", () => new Promise<Res>(() => undefined), { timeoutMs: 25 }],
    ["stalled body", async () => asRes(new Response(new ReadableStream<Uint8Array>({ pull() { return new Promise(() => undefined); } }), { status: 200, headers: { "content-type": "application/json" } })), { timeoutMs: 25 }],
  ];

  it("after every outcome the adapter's timer is cleared (no active Timeout left) and its signal has no listeners", async () => {
    for (const [name, fetcher, over] of scenarios) {
      await tick();
      const before = timers();
      let signal: AbortSignal | undefined;
      await run(async (u, init) => { signal = init.signal; return fetcher(u, init); }, { timeoutMs: 700, ...(over ?? {}) });
      await tick();
      assert.ok(timers() <= before, `${name}: ${timers() - before} timer(s) left active`);
      assert.ok(signal, name);
      assert.equal(getEventListeners(signal, "abort").length, 0, `${name}: abort listener left on the signal`);
    }
  });

  it("many runs in a row do not accumulate timers", async () => {
    await tick();
    const before = timers();
    for (let i = 0; i < 25; i += 1) await run(async () => respond({ status: i % 2 === 0 ? 200 : 503 }).res, { timeoutMs: 700 });
    await tick();
    assert.ok(timers() <= before, `${timers() - before} timer(s) left active`);
  });

  it("the source adds no listeners, intervals or global state", () => {
    const src = read("lib/ads/revive-adapter.ts").split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join("\n");
    assert.doesNotMatch(src, /addEventListener|removeEventListener|setInterval|\.on\(|\.once\(|process\./);
    assert.equal((src.match(/setTimeout\(/g) ?? []).length, 1);
    assert.equal((src.match(/clearTimeout\(/g) ?? []).length, 1);
  });
});

describe("day 25 part 2 | internal provider errors never leak", () => {
  const LEAKS = [SECRET, RAW_MARK, ERR_MARK, "zoneid=7", "delivery.example.com", "evil.example.org"];
  const scenarios: Array<[string, ReviveFetcher, Record<string, unknown>?]> = [
    ["throw", async () => { throw new Error(`${ERR_MARK} ${URL_WITH_SECRET}`); }],
    ["non-error throw", async () => { throw `${ERR_MARK} ${SECRET}`; }],
    ["500 body", async () => respond({ status: 500, text: RAW_MARK }).res],
    ["redirect", async () => respond({ status: 301, headers: { location: `https://evil.example.org/?k=${SECRET}` }, text: RAW_MARK }).res],
    ["followed redirect", async () => respond({ text: RAW_MARK, extra: { redirected: true, url: `https://evil.example.org/?k=${SECRET}` } }).res],
    ["html", async () => respond({ ct: "text/html", text: `<b>${RAW_MARK}</b>` }).res],
    ["bad json", async () => respond({ text: `{"x":"${RAW_MARK}` }).res],
    ["oversized", async () => respond({ text: RAW_MARK.repeat(10000) }).res],
    ["stream error", async () => asRes(new Response(new ReadableStream<Uint8Array>({ pull(c) { c.error(new Error(`${ERR_MARK} ${SECRET}`)); } }), { status: 200, headers: { "content-type": "application/json" } }))],
    ["timeout", () => new Promise<Res>(() => undefined), { timeoutMs: 20 }],
  ];

  it("every failure is exactly { status: 'no-fill', reason } with a fixed code and no input text", async () => {
    const util = await import("node:util");
    for (const [name, fetcher, over] of scenarios) {
      const out = await run(fetcher, over ?? {});
      assert.equal(out.status, "no-fill", name);
      assert.deepEqual(Object.keys(out).sort(), ["reason", "status"], name);
      assert.ok(NO_FILL_REASONS.includes(reasonOf(out)), `${name}: ${reasonOf(out)}`);
      const shown = [JSON.stringify(out), String(out), util.inspect(out, { depth: 6 })].join(" ");
      for (const needle of LEAKS) assert.ok(!shown.includes(needle), `${name}: leaked ${needle}`);
    }
  });

  it("the invalid-config result carries only a reason code, never the URL", async () => {
    for (const deliveryUrl of [`http://delivery.example.com/?key=${SECRET}`, `https://u:${SECRET}@delivery.example.com/`, `https://delivery.example.com/#${SECRET}`]) {
      const out = await createReviveAdapter({ enabled: true, deliveryUrl }, { fetcher: async () => respond().res }).requestFill();
      assert.deepEqual(out, { status: "no-fill", reason: "invalid_config" });
    }
  });
});

describe("day 25 part 2 | Day 22/23 fallback contract is preserved", () => {
  it("a valid response still gives the same sealed JSON fill, and the request shape is unchanged", async () => {
    const out = await run(async () => respond().res);
    assert.deepEqual(out, { status: "fill", format: "json", payload: GOOD });
    assert.deepEqual(JSON.parse(JSON.stringify(out)), { status: "fill", format: "json" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, HREF);
  });

  it("disabled by default: no config, a disabled config, or an env without the exact flag => no request at all", async () => {
    let n = 0;
    const f: ReviveFetcher = async () => { n += 1; return respond().res; };
    assert.deepEqual(await createReviveAdapter(undefined, { fetcher: f }).requestFill(), { status: "no-fill", reason: "disabled" });
    assert.deepEqual(await createReviveAdapter({ enabled: false, deliveryUrl: URL_WITH_SECRET }, { fetcher: f }).requestFill(), { status: "no-fill", reason: "disabled" });
    for (const env of [{}, { REVIVE_FALLBACK_ENABLED: "TRUE", REVIVE_DELIVERY_URL: URL_WITH_SECRET }, { REVIVE_JSON_PREVIEW_ENABLED: "true", REVIVE_DELIVERY_URL: URL_WITH_SECRET }]) {
      assert.deepEqual(parseReviveEnv(env), { ok: false, reason: "disabled" });
    }
    assert.equal(n, 0);
  });

  it("the reason codes are still exactly the fixed Day 22/23 set (no new public reason)", async () => {
    const seen = new Set<string>();
    for (const [, fetcher, over] of [
      ["a", async () => respond({ status: 302 }).res],
      ["b", async () => respond({ ct: "text/html" }).res],
      ["c", async () => respond({ text: "x" }).res],
      ["d", async () => { throw new Error("x"); }],
      ["e", () => new Promise<Res>(() => undefined)],
    ] as Array<[string, ReviveFetcher, number?]>) {
      seen.add(reasonOf(await run(fetcher, { timeoutMs: over ?? 20 })));
    }
    for (const r of seen) assert.ok(NO_FILL_REASONS.includes(r), r);
  });

  it("source: redirect is always 'error', never follow or manual; the adapter is not wired into serving", () => {
    const src = read("lib/ads/revive-adapter.ts").split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join("\n");
    assert.match(src, /redirect: "error"/);
    assert.doesNotMatch(src, /redirect: "(follow|manual)"/);
    for (const f of ["lib/ads/service.ts", "lib/ads/match-handler.ts", "app/api/v1/ads/match/route.ts", "app/api/ads/match/route.ts"]) assert.doesNotMatch(read(f), /revive/i, f);
  });
});
