import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PUBLIC_AD_FIELDS } from "@/lib/ads/contract";
import { MAX_DESTINATION_LENGTH } from "@/lib/ads/click";
import { BODY_MAX, CTA_MAX, HEADLINE_MAX } from "@/lib/campaigns/creative-validation";

// Day 23 Part 3: scripts/revive-preview-smoke-test.mjs. fetch NAKLI hai: asli network, Preview, Revive, DB ya credential kabhi nahi chhuta.

const ROOT = path.join(__dirname, "..", "..", "..");
const SCRIPT = "scripts/revive-preview-smoke-test.mjs";
const KEY = `blc_live_${"ab".repeat(32)}`;
const REVIVE_URL = "https://delivery.revive-secret.example.net/serve?zoneid=77&token=REVIVETOKEN9911";
const PREVIEW = "https://blisscco-preview-abc.example.app";
const GOOD_ENV = { BLISSCCO_PREVIEW_URL: PREVIEW, BLISSCCO_PUBLISHER_API_KEY: KEY, BLISSCCO_SMOKE_CONFIRM_PREVIEW: "yes" };

type Env = Record<string, string | undefined>;
type Call = { url: string; init: Record<string, unknown> };
type Result = { ok: boolean; code: number; reason: string; kind?: string; source?: string };
type Mod = {
  runSmokeTest(d: { env?: unknown; fetchImpl?: unknown; log?: (m: string) => void; errLog?: (m: string) => void }): Promise<Result>;
  readSmokeConfig(env: unknown): { ok: boolean; reason?: string };
  validatePublicResponse(b: unknown): { ok: boolean; reason?: string; kind?: string; source?: string };
  redact(t: string, s: string[]): string;
  PUBLIC_AD_FIELDS: string[];
  HEADLINE_MAX: number; BODY_MAX: number; CTA_MAX: number; MAX_DESTINATION_LENGTH: number;
};

let modPromise: Promise<Mod> | undefined;
const load = () => (modPromise ??= import(pathToFileURL(path.join(ROOT, SCRIPT)).href) as Promise<Mod>);

const reviveAd = (over: Record<string, unknown> = {}) => ({
  id: "revive_1a2b3c4d",
  headline: "TEST FIXTURE: Sample sponsored headline",
  body: "Static placeholder text.",
  cta_text: "Learn more",
  destination_url: "https://example.com/blisscco-revive-test-fixture",
  ...over,
});
const fillBody = (adOver: Record<string, unknown> = {}, top: Record<string, unknown> = {}) => ({ fill: true, sponsored: true, ad: reviveAd(adOver), ...top });
const jsonRes = (body: unknown, status = 200, ct = "application/json") =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": ct } });

async function run(env: Env, impl: (url: string, init: Record<string, unknown>) => Promise<Response> | Response) {
  const calls: Call[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const mod = await load();
  const result = await mod.runSmokeTest({
    env,
    fetchImpl: async (url: string, init: Record<string, unknown>) => {
      calls.push({ url, init });
      return impl(url, init);
    },
    log: (m) => out.push(m),
    errLog: (m) => err.push(m),
  });
  return { result, calls, out, err, all: [...out, ...err].join("\n") };
}

describe("day 23 part 3 | success and no-fill", () => {
  it("revive fill passes: one POST, Bearer key only in the header, no tracking opt-in, redirect not followed", async () => {
    const r = await run(GOOD_ENV, () => jsonRes(fillBody()));
    assert.deepEqual([r.result.ok, r.result.code, r.result.kind, r.result.source], [true, 0, "fill", "revive"]);
    assert.equal(r.calls.length, 1);
    assert.equal(r.calls[0].url, `${PREVIEW}/api/v1/ads/match`);
    const init = r.calls[0].init;
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "manual");
    assert.equal(init.credentials, "omit");
    assert.equal(init.cache, "no-store");
    const headers = init.headers as Record<string, string>;
    assert.equal(headers.authorization, `Bearer ${KEY}`);
    assert.ok(!Object.keys(headers).some((h) => /tracking|idempotency/i.test(h)));
    assert.deepEqual(JSON.parse(String(init.body)), { topic: "technology" });
    assert.equal(r.all.includes(KEY), false);
    assert.match(r.out[0], /^PASS ok kind=fill source=revive$/);
    assert.equal(r.err.length, 0);
  });

  it("no-fill passes", async () => {
    const r = await run(GOOD_ENV, () => jsonRes({ fill: false }));
    assert.deepEqual([r.result.ok, r.result.code, r.result.kind], [true, 0, "no_fill"]);
    assert.match(r.out[0], /^PASS ok kind=no_fill/);
  });

  it("cta_text null is fine; custom topic is sent; Blisscco's own fill is reported as source=blisscco", async () => {
    const r = await run({ ...GOOD_ENV, BLISSCCO_SMOKE_TOPIC: "gaming" }, () => jsonRes(fillBody({ id: "0b1f2e3d-4c5b-4a69-8877-665544332211", cta_text: null })));
    assert.equal(r.result.ok, true);
    assert.equal(r.result.source, "blisscco");
    assert.deepEqual(JSON.parse(String(r.calls[0].init.body)), { topic: "gaming" });
  });

  it("BLISSCCO_SMOKE_EXPECT is enforced", async () => {
    assert.equal((await run({ ...GOOD_ENV, BLISSCCO_SMOKE_EXPECT: "revive_fill" }, () => jsonRes(fillBody()))).result.ok, true);
    assert.equal((await run({ ...GOOD_ENV, BLISSCCO_SMOKE_EXPECT: "revive_fill" }, () => jsonRes({ fill: false }))).result.reason, "expected_revive_fill");
    assert.equal((await run({ ...GOOD_ENV, BLISSCCO_SMOKE_EXPECT: "revive_fill" }, () => jsonRes(fillBody({ id: "0b1f2e3d-4c5b-4a69-8877-665544332211" })))).result.reason, "expected_revive_fill");
    assert.equal((await run({ ...GOOD_ENV, BLISSCCO_SMOKE_EXPECT: "no_fill" }, () => jsonRes({ fill: false }))).result.ok, true);
    assert.equal((await run({ ...GOOD_ENV, BLISSCCO_SMOKE_EXPECT: "no_fill" }, () => jsonRes(fillBody()))).result.reason, "expected_no_fill");
  });

  it("uses globalThis.fetch when no fetchImpl is injected (mocked here)", async () => {
    const real = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return jsonRes({ fill: false }); }) as typeof fetch;
    try {
      const mod = await load();
      const r = await mod.runSmokeTest({ env: GOOD_ENV });
      assert.equal(r.ok, true);
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe("day 23 part 3 | invalid configuration: exit 2, no request sent", () => {
  const cases: [string, Env, string][] = [
    ["missing url", { ...GOOD_ENV, BLISSCCO_PREVIEW_URL: undefined }, "missing_preview_url"],
    ["empty url", { ...GOOD_ENV, BLISSCCO_PREVIEW_URL: "" }, "missing_preview_url"],
    ["missing key", { ...GOOD_ENV, BLISSCCO_PUBLISHER_API_KEY: undefined }, "missing_api_key"],
    ["bad key format", { ...GOOD_ENV, BLISSCCO_PUBLISHER_API_KEY: "blc_live_short" }, "invalid_api_key_format"],
    ["http url", { ...GOOD_ENV, BLISSCCO_PREVIEW_URL: "http://blisscco-preview-abc.example.app" }, "preview_url_not_https"],
    ["garbage url", { ...GOOD_ENV, BLISSCCO_PREVIEW_URL: "not a url" }, "invalid_preview_url"],
    ["url with credentials", { ...GOOD_ENV, BLISSCCO_PREVIEW_URL: "https://u:p@blisscco-preview-abc.example.app" }, "invalid_preview_url"],
    ["url with query", { ...GOOD_ENV, BLISSCCO_PREVIEW_URL: `${PREVIEW}/?x=1` }, "invalid_preview_url"],
    ["url with path", { ...GOOD_ENV, BLISSCCO_PREVIEW_URL: `${PREVIEW}/api` }, "invalid_preview_url"],
    ["url with fragment", { ...GOOD_ENV, BLISSCCO_PREVIEW_URL: `${PREVIEW}/#x` }, "invalid_preview_url"],
    ["padded url", { ...GOOD_ENV, BLISSCCO_PREVIEW_URL: ` ${PREVIEW}` }, "invalid_preview_url"],
    ["preview not confirmed", { ...GOOD_ENV, BLISSCCO_SMOKE_CONFIRM_PREVIEW: undefined }, "preview_not_confirmed"],
    ["confirm is not exactly yes", { ...GOOD_ENV, BLISSCCO_SMOKE_CONFIRM_PREVIEW: "YES" }, "preview_not_confirmed"],
    ["production host refused", { ...GOOD_ENV, BLISSCCO_PRODUCTION_HOST: "BLISSCCO-preview-abc.example.app" }, "production_host_refused"],
    ["bad topic", { ...GOOD_ENV, BLISSCCO_SMOKE_TOPIC: "Bad Topic!" }, "invalid_topic"],
    ["bad expect", { ...GOOD_ENV, BLISSCCO_SMOKE_EXPECT: "fill" }, "invalid_expect"],
    ["non-https revive url (leak-check)", { ...GOOD_ENV, BLISSCCO_SMOKE_REVIVE_URL: "http://delivery.example.net/x?key=SECRETKEY1" }, "invalid_revive_url"],
  ];
  for (const [name, env, reason] of cases) {
    it(name, async () => {
      const r = await run(env, () => jsonRes({ fill: false }));
      assert.deepEqual([r.result.ok, r.result.code, r.result.reason], [false, 2, reason]);
      assert.equal(r.calls.length, 0);
      assert.equal(r.out.length, 0);
      assert.match(r.err[0], /^FAIL /);
      assert.equal(r.all.includes(KEY), false);
      assert.equal(r.all.includes("example.app"), false);
    });
  }

  it("missing env object never throws", async () => {
    const mod = await load();
    for (const e of [undefined, null, 5, "x", []]) {
      const r = await mod.runSmokeTest({ env: e, fetchImpl: () => { throw new Error("no"); } });
      assert.deepEqual([r.ok, r.code], [false, 2]);
    }
  });
});

describe("day 23 part 3 | unexpected status, redirects, malformed responses: exit 1", () => {
  it("unexpected statuses are reported as fixed codes only", async () => {
    const map: Record<number, string> = { 400: "http_400", 401: "http_401", 413: "http_413", 415: "http_415", 429: "http_429", 503: "http_503", 500: "unexpected_status", 404: "unexpected_status", 201: "unexpected_status" };
    for (const [status, reason] of Object.entries(map)) {
      const r = await run(GOOD_ENV, () => jsonRes({ error: "x" }, Number(status)));
      assert.deepEqual([r.result.ok, r.result.code, r.result.reason], [false, 1, reason], status);
    }
  });

  it("a redirect is never followed and its Location is never printed or requested", async () => {
    const r = await run(GOOD_ENV, () => new Response(null, { status: 302, headers: { location: "https://evil.example.org/steal?x=1" } }));
    assert.deepEqual([r.result.ok, r.result.code, r.result.reason], [false, 1, "unexpected_redirect"]);
    assert.equal(r.calls.length, 1);
    assert.equal(r.all.includes("evil.example.org"), false);
    for (const s of [301, 307, 308]) assert.equal((await run(GOOD_ENV, () => new Response(null, { status: s, headers: { location: "https://evil.example.org/" } }))).result.reason, "unexpected_redirect");
  });

  it("malformed JSON, empty body, wrong content type, oversized body", async () => {
    assert.equal((await run(GOOD_ENV, () => jsonRes("{not json"))).result.reason, "malformed_json");
    assert.equal((await run(GOOD_ENV, () => jsonRes(""))).result.reason, "malformed_json");
    assert.equal((await run(GOOD_ENV, () => jsonRes(JSON.stringify({ fill: false }), 200, "text/html"))).result.reason, "bad_content_type");
    assert.equal((await run(GOOD_ENV, () => jsonRes(JSON.stringify({ fill: false, pad: "x".repeat(70000) })))).result.reason, "response_too_large");
  });

  it("JSON of the wrong shape", async () => {
    for (const b of [[], null, 5, "str", {}, { fill: "yes" }, { fill: 1 }]) {
      const r = await run(GOOD_ENV, () => jsonRes(JSON.stringify(b)));
      assert.equal(r.result.ok, false, JSON.stringify(b));
      assert.equal(r.result.code, 1);
    }
  });

  it("contract violations: no Sponsored disclosure, extra fields, tracking, bad ad fields, unsafe destination", async () => {
    const expectReason = async (body: unknown, reason: string) => assert.equal((await run(GOOD_ENV, () => jsonRes(body))).result.reason, reason, reason);
    await expectReason({ fill: true, ad: reviveAd() }, "missing_sponsored_disclosure");
    await expectReason(fillBody({}, { sponsored: false }), "missing_sponsored_disclosure");
    await expectReason(fillBody({}, { sponsored: "true" }), "missing_sponsored_disclosure");
    await expectReason(fillBody({}, { tracking: { token: "bt1.a.b", expires_at: "x", events: [] } }), "tracking_present");
    await expectReason({ fill: false, tracking: {} }, "tracking_present");
    await expectReason(fillBody({}, { provider: "revive" }), "unexpected_fields");
    await expectReason({ fill: false, reason: "x" }, "unexpected_fields");
    await expectReason(fillBody({ provider_data: { zone: 1 } }), "unexpected_ad_fields");
    await expectReason({ fill: true, sponsored: true, ad: (({ id, ...rest }) => rest)(reviveAd()) }, "unexpected_ad_fields");
    await expectReason(fillBody({ headline: "<b>x</b>" }), "invalid_ad_field");
    await expectReason(fillBody({ body: "a &amp; b" }), "invalid_ad_field");
    await expectReason(fillBody({ headline: "h".repeat(HEADLINE_MAX + 1) }), "invalid_ad_field");
    await expectReason(fillBody({ cta_text: 5 }), "invalid_ad_field");
    await expectReason(fillBody({ destination_url: "http://example.com/x" }), "unsafe_destination");
    await expectReason(fillBody({ destination_url: "javascript:alert(1)" }), "unsafe_destination");
    await expectReason(fillBody({ destination_url: "https://u:p@example.com/x" }), "unsafe_destination");
  });

  it("network error and timeout produce fixed codes", async () => {
    const mod = await load();
    const boom = await mod.runSmokeTest({ env: GOOD_ENV, fetchImpl: async () => { throw new Error("x"); } });
    assert.deepEqual([boom.ok, boom.code, boom.reason], [false, 1, "network_error"]);
    const abort = await mod.runSmokeTest({ env: GOOD_ENV, fetchImpl: async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; } });
    assert.equal(abort.reason, "timeout");
  });
});

describe("day 23 part 3 | secret redaction and credential leakage", () => {
  const withRevive = { ...GOOD_ENV, BLISSCCO_SMOKE_REVIVE_URL: REVIVE_URL };

  it("a response that echoes the API key fails and the key is never printed", async () => {
    const r = await run(GOOD_ENV, () => jsonRes(fillBody({ body: `key ${KEY}` })));
    assert.deepEqual([r.result.ok, r.result.code, r.result.reason], [false, 1, "credential_leak"]);
    assert.equal(r.all.includes(KEY), false);
    assert.equal(r.all.includes("blc_live_"), false);
  });

  it("a response that contains any part of the configured Revive URL fails and none of it is printed", async () => {
    for (const leak of ["delivery.revive-secret.example.net", "REVIVETOKEN9911", "zoneid=77", REVIVE_URL]) {
      const r = await run(withRevive, () => jsonRes(fillBody({ body: `see ${leak}` })));
      assert.equal(r.result.reason, "credential_leak", leak);
      assert.equal(r.all.includes("revive-secret"), false);
      assert.equal(r.all.includes("REVIVETOKEN9911"), false);
      assert.equal(r.all.includes("zoneid"), false);
    }
  });

  it("leaks through response headers fail too", async () => {
    const res = () => new Response(JSON.stringify({ fill: false }), { status: 200, headers: { "content-type": "application/json", "x-debug": `Bearer ${KEY}` } });
    const r = await run(GOOD_ENV, res);
    assert.equal(r.result.reason, "credential_leak");
    assert.equal(r.all.includes(KEY), false);
  });

  it("generic credential-like or REVIVE_ names in the response fail even without a configured URL", async () => {
    for (const s of ["REVIVE_DELIVERY_URL", "zoneid=5", "api_key=abc", `blc_live_${"cd".repeat(32)}`]) {
      assert.equal((await run(GOOD_ENV, () => jsonRes(fillBody({ body: s })))).result.reason, "credential_leak", s);
    }
  });

  it("a fetch error whose message contains the key, endpoint and Revive URL never reaches the output", async () => {
    const r = await run(withRevive, () => { throw new Error(`connect failed ${PREVIEW}/api/v1/ads/match Bearer ${KEY} ${REVIVE_URL}`); });
    assert.equal(r.result.reason, "network_error");
    for (const s of [KEY, PREVIEW, "example.app", REVIVE_URL, "revive-secret", "REVIVETOKEN9911"]) assert.equal(r.all.includes(s), false, s);
  });

  it("success output never contains the key, the Preview URL or the Revive URL; result object has no secret either", async () => {
    const r = await run(withRevive, () => jsonRes(fillBody()));
    assert.equal(r.result.ok, true);
    const dump = r.all + JSON.stringify(r.result);
    for (const s of [KEY, "example.app", "revive-secret", "REVIVETOKEN9911"]) assert.equal(dump.includes(s), false, s);
  });

  it("redact() removes every secret occurrence", async () => {
    const mod = await load();
    assert.equal(mod.redact(`a ${KEY} b ${KEY}`, [KEY]), "a [redacted] b [redacted]");
  });
});

describe("day 23 part 3 | parity with the existing contract and static safety", () => {
  const src = readFileSync(path.join(ROOT, SCRIPT), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("script constants match the contract's constants", async () => {
    const mod = await load();
    assert.deepEqual([...mod.PUBLIC_AD_FIELDS], [...PUBLIC_AD_FIELDS]);
    assert.deepEqual([mod.HEADLINE_MAX, mod.BODY_MAX, mod.CTA_MAX, mod.MAX_DESTINATION_LENGTH], [HEADLINE_MAX, BODY_MAX, CTA_MAX, MAX_DESTINATION_LENGTH]);
  });

  it("the Blisscco fixture ad passes the script's validator", async () => {
    const mod = await load();
    const fx = JSON.parse(readFileSync(path.join(ROOT, "examples/revive-provider/ad.json"), "utf8"));
    const v = mod.validatePublicResponse({ fill: true, sponsored: true, ad: { id: "revive_00000000", ...fx } });
    assert.equal(v.ok, true);
  });

  it("no hardcoded key, URL, console logging, shell or file access; redirects are never followed", () => {
    assert.doesNotMatch(code, /blc_live_[0-9a-f]{20,}/);
    assert.doesNotMatch(code, /https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i);
    assert.doesNotMatch(code, /console\.|child_process|node:fs|readFile|writeFile|exec\(|spawn\(/);
    assert.match(code, /redirect:\s*"manual"/);
    assert.doesNotMatch(code, /redirect:\s*"follow"/);
    assert.doesNotMatch(code, /x-blisscco-tracking/i);
  });

  it("the script is manual only: not in package.json scripts, not in any CI workflow, not imported by app/lib", () => {
    assert.doesNotMatch(readFileSync(path.join(ROOT, "package.json"), "utf8"), /revive-preview-smoke-test|smoke/i);
    const wf = path.join(ROOT, ".github/workflows");
    if (existsSync(wf)) for (const f of readdirSync(wf)) assert.doesNotMatch(readFileSync(path.join(wf, f), "utf8"), /revive-preview-smoke-test|BLISSCCO_PUBLISHER_API_KEY|BLISSCCO_PREVIEW_URL/i, f);
    const walk = (d: string): string[] => readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
    for (const f of ["app", "lib", "components"].flatMap(walk)) {
      if (/\.(ts|tsx|js|mjs)$/.test(f)) assert.doesNotMatch(readFileSync(path.join(ROOT, f), "utf8"), /revive-preview-smoke-test/, f);
    }
  });

  it("only Preview-guarded: refuses to send unless BLISSCCO_SMOKE_CONFIRM_PREVIEW is exactly yes", () => {
    assert.match(code, /BLISSCCO_SMOKE_CONFIRM_PREVIEW\s*!==\s*"yes"/);
  });
});
