import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  REVIVE_MAX_BODY_BYTES,
  createReviveAdapter,
  extractReviveCreative,
  parseReviveConfig,
  parseReviveEnv,
  type ReviveFetcher,
  type ReviveFillResult,
} from "@/lib/ads/revive-adapter";
import { JSON_ENDPOINT_MAX_BYTES, validateJsonEndpointPayload } from "@/lib/ads/revive-json-endpoint-contract";

// Day 25 Part 1: Revive adapter <-> documented JSON endpoint contract. Sirf mocked fetcher: koi real network, Revive server, DB ya credential nahi.

const ROOT = path.join(__dirname, "..", "..", "..");
const ADAPTER = "lib/ads/revive-adapter.ts";
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

const SECRET = "SECRETKEY-4417-zz";
const RAW_MARK = "RAW-PROVIDER-BODY-9d1";
const ERR_MARK = "PROVIDER-ERROR-TEXT-77";
const URL_WITH_SECRET = `https://delivery.example.com/serve?zoneid=7&key=${SECRET}`;
const GOOD = { headline: "Sample headline", body: "Sample body text.", cta_text: "Learn more", destination_url: "https://example.com/landing" };
const NO_FILL_REASONS = ["disabled", "invalid_config", "no_fetcher", "timeout", "network_error", "http_error", "bad_content_type", "too_large", "empty_response", "bad_response"];

type Res = Awaited<ReturnType<ReviveFetcher>>;
const asRes = (r: Response) => r as unknown as Res;
const jsonRes = (body: unknown, ct = "application/json") => asRes(new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200, headers: { "content-type": ct } }));
const bytesRes = (bytes: Uint8Array, ct = "application/json") => asRes(new Response(bytes as unknown as BodyInit, { status: 200, headers: { "content-type": ct } }));

let calls: string[] = [];
const run = (fetcher: ReviveFetcher, over: Record<string, unknown> = {}) =>
  createReviveAdapter({ enabled: true, deliveryUrl: URL_WITH_SECRET, timeoutMs: 200, ...over }, { fetcher: (async (u, i) => { calls.push(u); return fetcher(u, i); }) as ReviveFetcher }).requestFill();
const reasonOf = (r: ReviveFillResult) => (r.status === "no-fill" ? r.reason : "fill");

// Sab console output pakdo: koi bhi path kuch log kare toh test fail.
const realFetch = globalThis.fetch;
const consoleMethods = ["log", "info", "warn", "error", "debug", "trace"] as const;
const originals: Record<string, (...a: unknown[]) => void> = {};
let logged: string[] = [];
let realNetworkCalls = 0;

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

describe("day 25 part 1 | valid JSON", () => {
  it("a valid contract response => fill, and the safe creative mapping is unchanged", async () => {
    const out = await run(async () => jsonRes(GOOD));
    assert.equal(out.status, "fill");
    assert.deepEqual(out, { status: "fill", format: "json", payload: GOOD });
    const x = extractReviveCreative(out);
    assert.deepEqual(x, { ok: true, provider: "revive", creative: { headline: GOOD.headline, body: GOOD.body, ctaText: GOOD.cta_text, destinationUrl: GOOD.destination_url } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0], new URL(URL_WITH_SECRET).href);
  });

  it("the adapter accepts exactly what the contract validator accepts (cta null / omitted / extra ignorable fields)", async () => {
    const variants: Array<Record<string, unknown>> = [
      GOOD,
      { ...GOOD, cta_text: null },
      { headline: GOOD.headline, body: GOOD.body, destination_url: GOOD.destination_url },
      { ...GOOD, internal_note: "ignored", price: 5 },
    ];
    for (const v of variants) {
      assert.equal(validateJsonEndpointPayload(v).ok, true);
      assert.equal(reasonOf(await run(async () => jsonRes(v))), "fill", JSON.stringify(v));
    }
  });

  it("extra provider fields never reach the extracted creative", async () => {
    const out = await run(async () => jsonRes({ ...GOOD, internal_note: RAW_MARK }));
    const x = extractReviveCreative(out);
    assert.ok(x.ok);
    assert.deepEqual(Object.keys(x.creative).sort(), ["body", "ctaText", "destinationUrl", "headline"]);
    assert.ok(!JSON.stringify(x).includes(RAW_MARK));
  });

  it("content type: application/json with optional utf-8 charset is supported, case-insensitive", async () => {
    for (const ct of ["application/json", "Application/JSON", "application/json; charset=utf-8", 'application/json; charset="UTF-8"']) {
      assert.equal(reasonOf(await run(async () => jsonRes(GOOD, ct))), "fill", ct);
    }
  });

  it("the request is one plain GET with only the accept header, no redirects, no credentials", async () => {
    let seen: Parameters<ReviveFetcher>[1] | undefined;
    await run(async (_u, init) => { seen = init; return jsonRes(GOOD); });
    assert.ok(seen);
    assert.equal(seen.method, "GET");
    assert.deepEqual(Object.keys(seen.headers), ["accept"]);
    assert.equal(seen.headers.accept, "application/json");
    assert.equal(seen.redirect, "error");
    assert.equal(seen.credentials, "omit");
    assert.equal(seen.cache, "no-store");
  });
});

describe("day 25 part 1 | unsupported HTML / script responses", () => {
  it("a text/html response in JSON mode => bad_content_type", async () => {
    for (const ct of ["text/html", "text/html; charset=utf-8", "application/javascript", "text/javascript", "application/xhtml+xml", "application/json5", "application/vnd.api+json", "text/plain"]) {
      assert.equal(reasonOf(await run(async () => jsonRes(`<script>alert("${RAW_MARK}")</script>`, ct))), "bad_content_type", ct);
    }
  });

  it("a missing content type or an unknown charset => bad_content_type", async () => {
    assert.equal(reasonOf(await run(async () => asRes(new Response(JSON.stringify(GOOD), { status: 200 })))), "bad_content_type");
    assert.equal(reasonOf(await run(async () => jsonRes(GOOD, "application/json; charset=latin1"))), "bad_content_type");
    assert.equal(reasonOf(await run(async () => jsonRes(GOOD, "application/json; boundary=x"))), "bad_content_type");
  });

  it("HTML sent with a JSON content type is not valid JSON => bad_response", async () => {
    for (const body of [`<html><body>${RAW_MARK}</body></html>`, `<script src="https://evil.example.org/a.js"></script>`, `<a href="https://example.com">x</a>`]) {
      assert.equal(reasonOf(await run(async () => jsonRes(body))), "bad_response");
    }
  });

  it("executable / markup keys reject the whole response, whatever the case", async () => {
    for (const key of ["html", "HTML", "script", "iframe", "adm", "tag", "code", "markup", "embed", "vast", "xml", "creative_html", "ad_html", "body_html", "snippet", "js", "javascript", "scripts"]) {
      assert.equal(reasonOf(await run(async () => jsonRes({ ...GOOD, [key]: `<b>${RAW_MARK}</b>` }))), "bad_response", key);
    }
  });

  it("markup, entities and control characters inside the text fields => bad_response", async () => {
    const bad: Array<Record<string, unknown>> = [
      { ...GOOD, headline: "<script>alert(1)</script>" },
      { ...GOOD, body: "<img src=x onerror=alert(1)>" },
      { ...GOOD, cta_text: "<b>Go</b>" },
      { ...GOOD, headline: "Fish &amp; chips" },
      { ...GOOD, body: "a\nb" },
      { ...GOOD, headline: "x".repeat(91) },
      { ...GOOD, headline: "   " },
    ];
    for (const v of bad) assert.equal(reasonOf(await run(async () => jsonRes(v))), "bad_response", JSON.stringify(v).slice(0, 60));
  });

  it("html response format never becomes a creative, even end to end", async () => {
    const out = await run(async () => jsonRes(`<b>${RAW_MARK}</b>`, "text/html"), { responseFormat: "html" });
    assert.deepEqual(extractReviveCreative(out), { ok: false, reason: "unsupported_format" });
    assert.ok(!JSON.stringify(out).includes(RAW_MARK));
  });
});

describe("day 25 part 1 | malformed JSON", () => {
  it("malformed or non-object JSON => bad_response (empty => empty_response)", async () => {
    const bodies = ['{"headline":', "not json", "{'headline':'x'}", "null", "true", "123", '"text"', "[]", "[" + JSON.stringify(GOOD) + "]", "{}", '{"a":1}'];
    for (const b of bodies) assert.equal(reasonOf(await run(async () => jsonRes(b))), "bad_response", b);
    assert.equal(reasonOf(await run(async () => jsonRes(""))), "empty_response");
    assert.equal(reasonOf(await run(async () => jsonRes("   \n "))), "empty_response");
  });

  it("missing required fields or wrong field types => bad_response", async () => {
    const bad: Array<Record<string, unknown>> = [
      { body: GOOD.body, destination_url: GOOD.destination_url },
      { headline: GOOD.headline, destination_url: GOOD.destination_url },
      { headline: GOOD.headline, body: GOOD.body },
      { ...GOOD, headline: 5 },
      { ...GOOD, body: ["x"] },
      { ...GOOD, cta_text: 7 },
      { ...GOOD, destination_url: null },
    ];
    for (const v of bad) assert.equal(reasonOf(await run(async () => jsonRes(v))), "bad_response", JSON.stringify(v).slice(0, 60));
  });

  it("invalid UTF-8 bytes => bad_response", async () => {
    assert.equal(reasonOf(await run(async () => bytesRes(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d])))), "bad_response");
  });

  it("__proto__ / constructor keys do not pollute anything and are not accepted as fields", async () => {
    const body = `{"__proto__":{"polluted":true},"constructor":{"x":1},"headline":"h","body":"b","destination_url":"https://example.com/a"}`;
    const out = await run(async () => jsonRes(body));
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
    if (out.status === "fill") assert.ok(extractReviveCreative(out).ok);
  });
});

describe("day 25 part 1 | invalid destination (HTTPS only)", () => {
  const dests = [
    "http://example.com/a",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "ftp://example.com/a",
    "//example.com/a",
    "/relative/path",
    "example.com/a",
    "https://user:pass@example.com/a",
    "https://:pw@example.com/a",
    `https://example.com/${"a".repeat(2100)}`,
    "https://",
    "",
    "   ",
  ];

  it("every unsafe or malformed destination => bad_response, and no creative can be extracted", async () => {
    for (const d of dests) {
      const out = await run(async () => jsonRes({ ...GOOD, destination_url: d }));
      assert.equal(reasonOf(out), "bad_response", d.slice(0, 40));
      assert.equal(extractReviveCreative(out).ok, false);
    }
  });

  it("a plain https destination is accepted and normalized by the contract", async () => {
    const out = await run(async () => jsonRes({ ...GOOD, destination_url: "https://example.com/landing?a=1" }));
    assert.equal(out.status, "fill");
  });
});

describe("day 25 part 1 | oversized responses", () => {
  it("the adapter limit equals the documented 65,536-byte contract limit", () => {
    assert.equal(REVIVE_MAX_BODY_BYTES, 65536);
    assert.equal(REVIVE_MAX_BODY_BYTES, JSON_ENDPOINT_MAX_BYTES);
  });

  it("a body of exactly the limit (valid creative + ignorable pad) is accepted", async () => {
    const base = JSON.stringify({ ...GOOD, pad: "" });
    const exact = JSON.stringify({ ...GOOD, pad: "x".repeat(REVIVE_MAX_BODY_BYTES - base.length) });
    assert.equal(new TextEncoder().encode(exact).byteLength, REVIVE_MAX_BODY_BYTES);
    assert.equal(reasonOf(await run(async () => jsonRes(exact))), "fill");
  });

  it("one byte over the limit => too_large", async () => {
    const base = JSON.stringify({ ...GOOD, pad: "" });
    const over = JSON.stringify({ ...GOOD, pad: "x".repeat(REVIVE_MAX_BODY_BYTES - base.length + 1) });
    assert.equal(new TextEncoder().encode(over).byteLength, REVIVE_MAX_BODY_BYTES + 1);
    assert.equal(reasonOf(await run(async () => jsonRes(over))), "too_large");
  });

  it("a huge buffered body => too_large", async () => {
    assert.equal(reasonOf(await run(async () => jsonRes(JSON.stringify({ ...GOOD, pad: "x".repeat(REVIVE_MAX_BODY_BYTES * 2) })))), "too_large");
  });

  it("multi-byte text is counted in bytes, not characters", async () => {
    const body = JSON.stringify({ ...GOOD, pad: "\u20ac".repeat(Math.ceil(REVIVE_MAX_BODY_BYTES / 3)) });
    assert.ok(body.length < REVIVE_MAX_BODY_BYTES);
    assert.equal(reasonOf(await run(async () => jsonRes(body))), "too_large");
  });

  it("a declared content-length over the limit is rejected without reading the body", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(c) { pulled += 1; c.enqueue(new TextEncoder().encode(JSON.stringify(GOOD))); c.close(); } });
    const res = asRes(new Response(stream, { status: 200, headers: { "content-type": "application/json", "content-length": String(REVIVE_MAX_BODY_BYTES + 1) } }));
    assert.equal(reasonOf(await run(async () => res)), "too_large");
    assert.ok(pulled <= 1, `body was read: ${pulled} pulls`); // 1 = Response ka apna prefetch, adapter ka nahi
  });

  it("an endless stream is cut off and cancelled shortly after the limit", async () => {
    let pulls = 0;
    let cancelled = false;
    const chunk = new Uint8Array(8192).fill(0x61);
    const stream = new ReadableStream<Uint8Array>({ pull(c) { pulls += 1; c.enqueue(chunk); }, cancel() { cancelled = true; } });
    const out = await run(async () => asRes(new Response(stream, { status: 200, headers: { "content-type": "application/json" } })));
    assert.equal(reasonOf(out), "too_large");
    assert.ok(pulls < 50, `pulled ${pulls} chunks`);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(cancelled, true);
  });
});

describe("day 25 part 1 | provider failure => fixed safe results", () => {
  it("non-2xx statuses (including redirects) => http_error", async () => {
    for (const status of [100, 199, 300, 301, 302, 304, 307, 400, 401, 403, 404, 429, 500, 502, 503]) {
      const res = { status, headers: { get: () => "application/json" }, text: async () => JSON.stringify(GOOD) } as unknown as Res;
      assert.equal(reasonOf(await run(async () => res)), "http_error", String(status));
    }
  });

  it("a fetcher that throws, rejects or throws a non-Error => network_error", async () => {
    const makers: Array<() => Promise<Res>> = [
      () => { throw new Error(`boom ${ERR_MARK} ${SECRET}`); },
      async () => { throw new Error(`boom ${ERR_MARK} ${SECRET}`); },
      () => Promise.reject(new TypeError(`redirect mode is set to error: ${URL_WITH_SECRET}`)),
      async () => { throw `string ${ERR_MARK}`; },
      async () => { throw { toString() { throw new Error(SECRET); } }; },
    ];
    for (const m of makers) assert.equal(reasonOf(await run(m)), "network_error");
  });

  it("a malformed fetch response object => http_error or network_error, never a throw", async () => {
    for (const weird of [null, undefined, {}, { status: "200" }, { status: 200 }, { status: 200, headers: {} }]) {
      const out = await run(async () => weird as unknown as Res);
      assert.equal(out.status, "no-fill");
      assert.ok(NO_FILL_REASONS.includes(reasonOf(out)));
    }
  });

  it("a stream that errors midway => network_error", async () => {
    const stream = new ReadableStream<Uint8Array>({ pull(c) { c.error(new Error(`${ERR_MARK} ${SECRET}`)); } });
    assert.equal(reasonOf(await run(async () => asRes(new Response(stream, { status: 200, headers: { "content-type": "application/json" } })))), "network_error");
  });

  it("a request that never answers hits the deadline => timeout (and the request is aborted)", async () => {
    let aborted = false;
    const t0 = Date.now();
    const out = await run((_u, init) => { init.signal.addEventListener("abort", () => { aborted = true; }); return new Promise<Res>(() => undefined); }, { timeoutMs: 30 });
    assert.equal(reasonOf(out), "timeout");
    assert.equal(aborted, true);
    assert.ok(Date.now() - t0 < 1000);
  });

  it("a body that stalls after the headers => timeout", async () => {
    const stream = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => undefined); } });
    const out = await run(async () => asRes(new Response(stream, { status: 200, headers: { "content-type": "application/json" } })), { timeoutMs: 30 });
    assert.equal(reasonOf(out), "timeout");
  });

  it("a late rejection after the deadline is not an unhandled rejection", async () => {
    let unhandled = 0;
    const onUnhandled = () => { unhandled += 1; };
    process.on("unhandledRejection", onUnhandled);
    try {
      const out = await run(() => new Promise<Res>((_, rej) => setTimeout(() => rej(new Error(SECRET)), 60)), { timeoutMs: 15 });
      assert.equal(reasonOf(out), "timeout");
      await new Promise((r) => setTimeout(r, 120));
      assert.equal(unhandled, 0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("disabled, invalid config and no fetcher => no-fill without any request", async () => {
    let n = 0;
    const f: ReviveFetcher = async () => { n += 1; return jsonRes(GOOD); };
    assert.deepEqual(await createReviveAdapter(undefined, { fetcher: f }).requestFill(), { status: "no-fill", reason: "disabled" });
    assert.deepEqual(await createReviveAdapter({ enabled: false, deliveryUrl: URL_WITH_SECRET }, { fetcher: f }).requestFill(), { status: "no-fill", reason: "disabled" });
    assert.deepEqual(await createReviveAdapter({ enabled: true, deliveryUrl: "http://delivery.example.com/x" }, { fetcher: f }).requestFill(), { status: "no-fill", reason: "invalid_config" });
    assert.deepEqual(await createReviveAdapter({ enabled: true, deliveryUrl: `https://u:p@delivery.example.com/x?k=${SECRET}` }, { fetcher: f }).requestFill(), { status: "no-fill", reason: "invalid_config" });
    assert.equal(n, 0);
  });

  it("the Revive fallback stays disabled by default: an empty env or only the preview flag never enables it", async () => {
    assert.deepEqual(parseReviveEnv({}), { ok: false, reason: "disabled" });
    assert.deepEqual(parseReviveEnv({ REVIVE_JSON_PREVIEW_ENABLED: "true", REVIVE_DELIVERY_URL: URL_WITH_SECRET }), { ok: false, reason: "disabled" });
    assert.deepEqual(parseReviveEnv({ REVIVE_FALLBACK_ENABLED: "TRUE", REVIVE_DELIVERY_URL: URL_WITH_SECRET }), { ok: false, reason: "disabled" });
  });
});

describe("day 25 part 1 | secrets, raw bodies and errors never leak", () => {
  const scenarios: Array<[string, () => Promise<Res>, Record<string, unknown>?]> = [
    ["valid fill", async () => jsonRes({ ...GOOD, internal_note: RAW_MARK })],
    ["html content type", async () => jsonRes(`<b>${RAW_MARK}</b>`, "text/html")],
    ["malformed json", async () => jsonRes(`{"headline":"${RAW_MARK}`)],
    ["invalid destination", async () => jsonRes({ ...GOOD, destination_url: `http://u:${SECRET}@evil.example.org/${RAW_MARK}` })],
    ["executable key", async () => jsonRes({ ...GOOD, html: `<b>${RAW_MARK}</b>` })],
    ["markup in text", async () => jsonRes({ ...GOOD, headline: `<b>${RAW_MARK}</b>` })],
    ["oversized", async () => jsonRes(JSON.stringify({ ...GOOD, pad: RAW_MARK.repeat(10000) }))],
    ["http 500", async () => ({ status: 500, headers: { get: () => "application/json" }, text: async () => RAW_MARK }) as unknown as Res],
    ["throwing fetcher", async () => { throw new Error(`${ERR_MARK} ${URL_WITH_SECRET} ${SECRET}`); }],
    ["timeout", () => new Promise<Res>(() => undefined), { timeoutMs: 20 }],
  ];

  it("no result (JSON, string, inspect) contains the delivery URL, its query, the secret, raw body or provider error text", async () => {
    const util = await import("node:util");
    const LEAKS = [SECRET, RAW_MARK, ERR_MARK, "zoneid=7", "delivery.example.com", "evil.example.org", "serve?"];
    for (const [name, fetcher, over] of scenarios) {
      const out = await run(fetcher, over ?? {});
      const shown = [JSON.stringify(out), String(out), util.inspect(out, { depth: 6 })].join(" ");
      // fill ke andar raw payload memory me rehta hai, par serialize/inspect-safe form me nahi: sirf JSON.stringify jaanchte hain
      for (const needle of LEAKS) assert.ok(!JSON.stringify(out).includes(needle), `${name}: leaked ${needle}`);
      if (out.status === "no-fill") {
        assert.deepEqual(Object.keys(out).sort(), ["reason", "status"], name);
        assert.ok(NO_FILL_REASONS.includes(out.reason), `${name}: ${out.reason}`);
        for (const needle of LEAKS) assert.ok(!shown.includes(needle), `${name}: leaked ${needle} in string forms`);
      } else {
        assert.deepEqual(JSON.parse(JSON.stringify(out)), { status: "fill", format: "json" }, name);
      }
    }
  });

  it("failures from the validator give only the fixed adapter reason, never validator or input detail", async () => {
    for (const body of [{ ...GOOD, headline: `<b>${SECRET}</b>` }, { ...GOOD, destination_url: `javascript:${SECRET}` }, { ...GOOD, [`html`]: SECRET }]) {
      const out = await run(async () => jsonRes(body));
      assert.deepEqual(out, { status: "no-fill", reason: "bad_response" });
    }
  });

  it("the parsed config redacts the delivery URL when serialized or inspected", async () => {
    const util = await import("node:util");
    const parsed = parseReviveConfig({ enabled: true, deliveryUrl: URL_WITH_SECRET });
    assert.ok(parsed.ok);
    for (const shown of [JSON.stringify(parsed), util.inspect(parsed, { depth: 6 })]) {
      assert.ok(!shown.includes(SECRET) && !shown.includes("zoneid"), shown);
    }
  });

  it("an invalid config result carries only a reason code, not the URL", async () => {
    const out = await createReviveAdapter({ enabled: true, deliveryUrl: `http://x.example.com/?k=${SECRET}` }).requestFill();
    assert.deepEqual(out, { status: "no-fill", reason: "invalid_config" });
    assert.ok(!JSON.stringify(out).includes(SECRET));
  });

  it("the adapter source never logs, reads env or touches credentials, and imports only the validator and the provider type", () => {
    const src = read(ADAPTER).split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join("\n"); // comment lines (// , /** , *) hata do
    assert.doesNotMatch(src, /console\.|process\.env|server-only|localStorage|document\.|window\./);
    assert.doesNotMatch(src.replace(/password !== ""/g, "").replace(/\.password/g, ""), /apikey|api_key|secret|authorization|cookie/i);
    assert.deepEqual(src.match(/^\s*import\s[^;]+;/gm)?.map((i) => i.trim()), [
      'import { validateJsonEndpointText } from "./revive-json-endpoint-contract";',
      'import type { AdProviderAdapter } from "./provider-adapter";',
    ]);
    assert.doesNotMatch(src, /supabase|createAdminClient|ledger|payout|billing|spend|budget|serve-db|click-db|impression-db/i);
  });

  it("the adapter is still not wired into production code (service, match route, fallback flag default unchanged)", () => {
    for (const f of ["lib/ads/service.ts", "lib/ads/match-handler.ts", "app/api/v1/ads/match/route.ts", "app/api/ads/match/route.ts"]) {
      assert.doesNotMatch(read(f), /revive/i, f);
    }
    assert.doesNotMatch(read("package.json"), /revive/i);
  });
});
