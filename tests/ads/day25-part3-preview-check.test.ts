import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BODY_MAX, CTA_MAX, HEADLINE_MAX } from "@/lib/campaigns/creative-validation";
import { MAX_DESTINATION_LENGTH } from "@/lib/ads/click";
import { JSON_ENDPOINT_ALLOWED_FIELDS, JSON_ENDPOINT_MAX_BYTES } from "@/lib/ads/revive-json-endpoint-contract";
import { defaultPreviewProvider } from "@/lib/ads/revive-json-preview";

// Day 25 Part 3: scripts/revive-json-preview-check.mjs. fetch NAKLI hai: asli network, Preview, Revive, DB ya credential kabhi nahi chhuta.

const ROOT = path.join(__dirname, "..", "..", "..");
const SCRIPT = "scripts/revive-json-preview-check.mjs";
const PREVIEW = "https://blisscco-preview-abc.example.app";
const GOOD_ENV = { BLISSCCO_PREVIEW_URL: PREVIEW, BLISSCCO_PREVIEW_CHECK_CONFIRM: "yes" };

type Env = Record<string, string | undefined>;
type Call = { url: string; init: Record<string, unknown> };
type Result = { ok: boolean; code: number; reason: string; state?: string };
type Mod = {
  runPreviewCheck(d: { env?: unknown; fetchImpl?: unknown; log?: (m: string) => void; errLog?: (m: string) => void }): Promise<Result>;
  readCheckConfig(env: unknown): { ok: boolean; reason?: string; endpoint?: string };
  validateFixtureBody(b: unknown): { ok: boolean; reason?: string };
  redact(t: string, s: string[]): string;
  CHECK_PATH: string;
  PUBLIC_FIELDS: string[];
  HEADLINE_MAX: number; BODY_MAX: number; CTA_MAX: number; MAX_DESTINATION_LENGTH: number; MAX_RESPONSE_CHARS: number;
};

let modPromise: Promise<Mod> | undefined;
const load = () => (modPromise ??= import(pathToFileURL(path.join(ROOT, SCRIPT)).href) as Promise<Mod>);

const fixture = (over: Record<string, unknown> = {}) => ({
  headline: "TEST FIXTURE: Sample sponsored headline",
  body: "Static placeholder text for the preview route. Not a real advertiser.",
  cta_text: "Learn more",
  destination_url: "https://example.com/blisscco-revive-test-fixture",
  ...over,
});
const jsonRes = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

async function run(env: Env, impl: (url: string, init: Record<string, unknown>) => Promise<Response> | Response) {
  const calls: Call[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const mod = await load();
  const result = await mod.runPreviewCheck({
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

describe("day 25 part 3 | success", () => {
  it("enabled fixture passes: one GET, fixed path, no credentials/cookies/auth, redirect not followed", async () => {
    const r = await run(GOOD_ENV, () => jsonRes(fixture()));
    assert.deepEqual([r.result.ok, r.result.code, r.result.state], [true, 0, "enabled"]);
    assert.equal(r.calls.length, 1);
    assert.equal(r.calls[0].url, `${PREVIEW}/api/revive-json-preview`);
    const init = r.calls[0].init;
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "manual");
    assert.equal(init.credentials, "omit");
    assert.equal(init.cache, "no-store");
    assert.equal(init.body, undefined);
    const headers = init.headers as Record<string, string>;
    assert.deepEqual(Object.keys(headers), ["accept"]);
    assert.ok(!Object.keys(headers).some((h) => /authorization|cookie|api-key|tracking/i.test(h)));
    assert.match(r.out[0], /^PASS ok state=enabled$/);
    assert.equal(r.err.length, 0);
  });

  it("the real Day 24 default provider output passes the check", async () => {
    const mod = await load();
    assert.deepEqual(mod.validateFixtureBody(await defaultPreviewProvider()), { ok: true });
  });

  it("cta_text null is accepted", async () => {
    const r = await run(GOOD_ENV, () => jsonRes(fixture({ cta_text: null })));
    assert.equal(r.result.ok, true);
  });

  it("uses globalThis.fetch when no fetchImpl is injected (mocked here)", async () => {
    const real = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return jsonRes(fixture()); }) as typeof fetch;
    try {
      const mod = await load();
      const r = await mod.runPreviewCheck({ env: GOOD_ENV });
      assert.equal(r.ok, true);
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe("day 25 part 3 | disabled 404 and unavailable 503", () => {
  it("expect=disabled passes on exact 404 not_found with JSON + no-store", async () => {
    const r = await run({ ...GOOD_ENV, BLISSCCO_PREVIEW_CHECK_EXPECT: "disabled" }, () => jsonRes({ error: "not_found" }, 404));
    assert.deepEqual([r.result.ok, r.result.state], [true, "disabled"]);
    assert.match(r.out[0], /^PASS ok state=disabled$/);
  });

  it("default expectation fails with a fixed code on 404", async () => {
    const r = await run(GOOD_ENV, () => jsonRes({ error: "not_found" }, 404));
    assert.deepEqual([r.result.ok, r.result.code, r.result.reason], [false, 1, "unexpected_404"]);
    assert.match(r.err[0], /^FAIL unexpected_404$/);
  });

  it("expect=disabled fails if the route is actually serving (200)", async () => {
    const r = await run({ ...GOOD_ENV, BLISSCCO_PREVIEW_CHECK_EXPECT: "disabled" }, () => jsonRes(fixture()));
    assert.equal(r.result.reason, "unexpected_200");
  });

  it("expect=disabled fails on a wrong error body", async () => {
    const r = await run({ ...GOOD_ENV, BLISSCCO_PREVIEW_CHECK_EXPECT: "disabled" }, () => jsonRes({ error: "not_found", extra: 1 }, 404));
    assert.equal(r.result.reason, "unexpected_error_body");
  });

  it("expect=unavailable passes on exact 503 unavailable", async () => {
    const r = await run({ ...GOOD_ENV, BLISSCCO_PREVIEW_CHECK_EXPECT: "unavailable" }, () => jsonRes({ error: "unavailable" }, 503));
    assert.deepEqual([r.result.ok, r.result.state], [true, "unavailable"]);
  });

  it("default expectation fails with a fixed code on 503", async () => {
    const r = await run(GOOD_ENV, () => jsonRes({ error: "unavailable" }, 503));
    assert.equal(r.result.reason, "unexpected_503");
    assert.equal(r.result.code, 1);
  });

  it("other statuses give unexpected_status", async () => {
    for (const status of [400, 401, 429, 500]) {
      const r = await run(GOOD_ENV, () => jsonRes({ error: "x" }, status));
      assert.equal(r.result.reason, "unexpected_status");
    }
  });
});

describe("day 25 part 3 | invalid URL / configuration: exit 2, no request sent", () => {
  const cases: [string, Env, string][] = [
    ["missing url", { ...GOOD_ENV, BLISSCCO_PREVIEW_URL: undefined }, "missing_preview_url"],
    ["empty url", { ...GOOD_ENV, BLISSCCO_PREVIEW_URL: "" }, "missing_preview_url"],
    ["garbage url", { ...GOOD_ENV, BLISSCCO_PREVIEW_URL: "not a url" }, "invalid_preview_url"],
    ["http url", { ...GOOD_ENV, BLISSCCO_PREVIEW_URL: "http://blisscco-preview-abc.example.app" }, "preview_url_not_https"],
    ["url with credentials", { ...GOOD_ENV, BLISSCCO_PREVIEW_URL: "https://u:p@blisscco-preview-abc.example.app" }, "invalid_preview_url"],
    ["url with query", { ...GOOD_ENV, BLISSCCO_PREVIEW_URL: `${PREVIEW}/?x=1` }, "invalid_preview_url"],
    ["url with empty query marker", { ...GOOD_ENV, BLISSCCO_PREVIEW_URL: `${PREVIEW}?` }, "invalid_preview_url"],
    ["url with arbitrary path", { ...GOOD_ENV, BLISSCCO_PREVIEW_URL: `${PREVIEW}/api/other` }, "invalid_preview_url"],
    ["url already containing the check path", { ...GOOD_ENV, BLISSCCO_PREVIEW_URL: `${PREVIEW}/api/revive-json-preview` }, "invalid_preview_url"],
    ["url with fragment", { ...GOOD_ENV, BLISSCCO_PREVIEW_URL: `${PREVIEW}/#x` }, "invalid_preview_url"],
    ["padded url", { ...GOOD_ENV, BLISSCCO_PREVIEW_URL: ` ${PREVIEW}` }, "invalid_preview_url"],
    ["preview not confirmed (Production is never the default)", { ...GOOD_ENV, BLISSCCO_PREVIEW_CHECK_CONFIRM: undefined }, "preview_not_confirmed"],
    ["confirm is not exactly yes", { ...GOOD_ENV, BLISSCCO_PREVIEW_CHECK_CONFIRM: "YES" }, "preview_not_confirmed"],
    ["production host refused", { ...GOOD_ENV, BLISSCCO_PRODUCTION_HOST: "BLISSCCO-preview-abc.example.app" }, "production_host_refused"],
    ["bad expect", { ...GOOD_ENV, BLISSCCO_PREVIEW_CHECK_EXPECT: "fill" }, "invalid_expect"],
  ];
  for (const [name, env, reason] of cases) {
    it(name, async () => {
      const r = await run(env, () => jsonRes(fixture()));
      assert.deepEqual([r.result.ok, r.result.code, r.result.reason], [false, 2, reason]);
      assert.equal(r.calls.length, 0);
      assert.match(r.err[0], new RegExp(`^FAIL ${reason}$`));
      assert.equal(r.out.length, 0);
    });
  }

  it("no env object at all => exit 2, no request", async () => {
    const mod = await load();
    assert.equal(mod.readCheckConfig(undefined).ok, false);
    assert.equal(mod.readCheckConfig(null).ok, false);
  });

  it("extra env values (paths, queries, API keys) are ignored and never used", async () => {
    const env = { ...GOOD_ENV, BLISSCCO_CHECK_PATH: "/admin", BLISSCCO_PREVIEW_QUERY: "?a=1", BLISSCCO_PUBLISHER_API_KEY: `blc_live_${"ab".repeat(32)}` };
    const r = await run(env, () => jsonRes(fixture()));
    assert.equal(r.calls[0].url, `${PREVIEW}/api/revive-json-preview`);
    assert.equal(JSON.stringify(r.calls[0].init).includes("blc_live_"), false);
    assert.equal(r.all.includes("blc_live_"), false);
  });
});

describe("day 25 part 3 | redirect is never followed", () => {
  for (const status of [301, 302, 307, 308]) {
    it(`status ${status} => FAIL unexpected_redirect, Location never printed`, async () => {
      const r = await run(GOOD_ENV, () => new Response(null, { status, headers: { location: "https://evil-redirect-target.example.org/steal?t=LOCSECRET" } }));
      assert.deepEqual([r.result.ok, r.result.code, r.result.reason], [false, 1, "unexpected_redirect"]);
      assert.equal(r.calls.length, 1);
      assert.equal(r.all.includes("evil-redirect-target"), false);
      assert.equal(r.all.includes("LOCSECRET"), false);
    });
  }

  it("opaqueredirect response type is also a FAIL", async () => {
    const fake = { type: "opaqueredirect", status: 0, headers: new Headers(), text: async () => "" } as unknown as Response;
    const r = await run(GOOD_ENV, () => fake);
    assert.equal(r.result.reason, "unexpected_redirect");
  });
});

describe("day 25 part 3 | malformed JSON and invalid responses", () => {
  it("malformed JSON text", async () => {
    const r = await run(GOOD_ENV, () => jsonRes("{not json RAWMARK-91"));
    assert.deepEqual([r.result.ok, r.result.code, r.result.reason], [false, 1, "malformed_json"]);
    assert.equal(r.all.includes("RAWMARK-91"), false);
  });

  it("empty body", async () => {
    const r = await run(GOOD_ENV, () => jsonRes(""));
    assert.equal(r.result.reason, "malformed_json");
  });

  it("JSON array / null / string root => malformed_response", async () => {
    for (const body of ["[]", "null", "\"x\"", "42"]) {
      const r = await run(GOOD_ENV, () => jsonRes(body));
      assert.equal(r.result.reason, "malformed_response", body);
    }
  });

  it("wrong content type", async () => {
    const r = await run(GOOD_ENV, () => jsonRes(fixture(), 200, { "content-type": "text/html" }));
    assert.equal(r.result.reason, "bad_content_type");
  });

  it("missing content type", async () => {
    const res = new Response(JSON.stringify(fixture()), { status: 200, headers: { "cache-control": "no-store" } });
    res.headers.delete("content-type");
    const r = await run(GOOD_ENV, () => res);
    assert.equal(r.result.reason, "bad_content_type");
  });

  it("missing or wrong cache-control", async () => {
    for (const cc of ["public, max-age=60", "no-cache", ""]) {
      const res = new Response(JSON.stringify(fixture()), { status: 200, headers: { "content-type": "application/json", ...(cc ? { "cache-control": cc } : {}) } });
      const r = await run(GOOD_ENV, () => res);
      assert.equal(r.result.reason, "missing_no_store", cc);
    }
  });

  it("no-store inside a longer cache-control list is accepted", async () => {
    const r = await run(GOOD_ENV, () => jsonRes(fixture(), 200, { "cache-control": "private, No-Store" }));
    assert.equal(r.result.ok, true);
  });

  it("oversize body", async () => {
    const mod = await load();
    const r = await run(GOOD_ENV, () => jsonRes(fixture({ body: "a".repeat(mod.MAX_RESPONSE_CHARS) })));
    assert.equal(r.result.reason, "response_too_large");
  });

  it("network error and timeout abort give fixed reasons without error text", async () => {
    const a = await run(GOOD_ENV, () => { throw new Error("ECONNRESET https://secret-host.example.net/x?token=NETSECRET"); });
    assert.equal(a.result.reason, "network_error");
    assert.equal(a.all.includes("NETSECRET"), false);
    assert.equal(a.all.includes("secret-host"), false);
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const b = await run(GOOD_ENV, () => { throw abort; });
    assert.equal(b.result.reason, "timeout");
  });

  it("fixture contract violations", async () => {
    const cases: [string, Record<string, unknown>, string][] = [
      ["extra field", { ...fixture(), id: "x" }, "unexpected_fields"],
      ["extra html field", { ...fixture(), html: "<b>x</b>" }, "unexpected_fields"],
      ["missing field", (() => { const f: Record<string, unknown> = fixture(); delete f.body; return f; })(), "unexpected_fields"],
      ["missing cta_text key", (() => { const f: Record<string, unknown> = fixture(); delete f.cta_text; return f; })(), "unexpected_fields"],
      ["markup in headline", fixture({ headline: "TEST FIXTURE <b>x</b>" }), "invalid_field"],
      ["html entity in body", fixture({ body: "a &amp; b" }), "invalid_field"],
      ["empty headline", fixture({ headline: "  " }), "invalid_field"],
      ["headline too long", fixture({ headline: `TEST FIXTURE ${"a".repeat(100)}` }), "invalid_field"],
      ["cta too long", fixture({ cta_text: "c".repeat(31) }), "invalid_field"],
      ["control char in body", fixture({ body: "bad\u0007text" }), "invalid_field"],
      ["http destination", fixture({ destination_url: "http://example.com/x" }), "unsafe_destination"],
      ["javascript destination", fixture({ destination_url: "javascript:alert(1)" }), "unsafe_destination"],
      ["credentials in destination", fixture({ destination_url: "https://u:p@example.com/x" }), "unsafe_destination"],
      ["relative destination", fixture({ destination_url: "/relative" }), "unsafe_destination"],
      ["non-string destination", fixture({ destination_url: 5 }), "unsafe_destination"],
      ["no TEST FIXTURE label", fixture({ headline: "Sample sponsored headline" }), "missing_fixture_label"],
    ];
    for (const [name, body, reason] of cases) {
      const r = await run(GOOD_ENV, () => jsonRes(body));
      assert.deepEqual([r.result.ok, r.result.code, r.result.reason], [false, 1, reason], name);
    }
  });
});

describe("day 25 part 3 | secret-safe output", () => {
  const SECRET_HOST = "blisscco-preview-abc.example.app";

  it("success output has no URL, host, headers, cookies or response text", async () => {
    const r = await run(GOOD_ENV, () => jsonRes(fixture(), 200, { "set-cookie": "sid=COOKIESECRET-77; Path=/", "x-secret": "HDRSECRET-12" }));
    assert.equal(r.result.ok, true);
    for (const s of [SECRET_HOST, "https://", "COOKIESECRET", "HDRSECRET", "TEST FIXTURE", "example.com", "Learn more"]) assert.equal(r.all.includes(s), false, s);
    assert.equal(r.all, "PASS ok state=enabled");
  });

  it("failure output is only a fixed reason code", async () => {
    const r = await run(GOOD_ENV, () => jsonRes(fixture({ destination_url: "http://example.com/PRIVATE-PATH-55" }), 200, { "set-cookie": "sid=COOKIESECRET-77" }));
    assert.equal(r.all, "FAIL unsafe_destination");
    assert.equal(r.all.includes("PRIVATE-PATH-55"), false);
    assert.equal(r.all.includes("COOKIESECRET"), false);
  });

  it("a response echoing credentials or Revive internals is a FAIL and is not printed", async () => {
    const leaks = [`blc_live_${"cd".repeat(32)}`, "Bearer abcdefgh12345678", "REVIVE_DELIVERY_URL", "zoneid=77", "api_key=abc"];
    for (const leak of leaks) {
      const r = await run(GOOD_ENV, () => jsonRes(fixture({ body: `Static ${leak} text` })));
      assert.deepEqual([r.result.ok, r.result.reason], [false, "credential_leak"], leak);
      assert.equal(r.all.includes(leak), false, leak);
    }
  });

  it("a leaked response header is never echoed; env values never appear in output for any outcome", async () => {
    const env = { ...GOOD_ENV, BLISSCCO_PRODUCTION_HOST: "prod.example.org" };
    const outcomes = [
      () => jsonRes(fixture()),
      () => jsonRes("{bad"),
      () => jsonRes({ error: "not_found" }, 404),
      () => new Response(null, { status: 302, headers: { location: `${PREVIEW}/elsewhere` } }),
      () => { throw new Error(`fail at ${PREVIEW}`); },
    ];
    for (const impl of outcomes) {
      const r = await run(env, impl);
      for (const s of [SECRET_HOST, "prod.example.org", "yes", "https://"]) assert.equal(r.all.includes(s), false, s);
    }
  });

  it("redact() masks given strings", async () => {
    const mod = await load();
    assert.equal(mod.redact("go to blisscco-preview-abc.example.app now", [SECRET_HOST]), "go to [redacted] now");
  });
});

describe("day 25 part 3 | source guards and contract drift", () => {
  const src = readFileSync(path.join(ROOT, SCRIPT), "utf8");
  // comments hata kar sirf code dekhte hain
  const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

  it("constants match the real Day 24 contract and creative rules", async () => {
    const mod = await load();
    assert.equal(mod.HEADLINE_MAX, HEADLINE_MAX);
    assert.equal(mod.BODY_MAX, BODY_MAX);
    assert.equal(mod.CTA_MAX, CTA_MAX);
    assert.equal(mod.MAX_DESTINATION_LENGTH, MAX_DESTINATION_LENGTH);
    assert.equal(mod.MAX_RESPONSE_CHARS, JSON_ENDPOINT_MAX_BYTES);
    assert.deepEqual([...mod.PUBLIC_FIELDS].sort(), [...JSON_ENDPOINT_ALLOWED_FIELDS].sort());
    assert.equal(mod.PUBLIC_FIELDS.length, 4);
  });

  it("check path equals the real route path and is the only path in the script", async () => {
    const mod = await load();
    assert.equal(mod.CHECK_PATH, "/api/revive-json-preview");
    assert.ok(existsRoute());
    assert.equal((code.match(/\/api\/[a-z0-9/_-]+/g) ?? []).join(","), "/api/revive-json-preview");
  });

  it("script never reads cookies/API keys, sends auth, follows redirects or reads Location", () => {
    assert.match(code, /redirect:\s*"manual"/);
    assert.match(code, /credentials:\s*"omit"/);
    assert.match(code, /method:\s*"GET"/);
    for (const re of [/process\.env\.\w*KEY/i, /authorization/i, /set-cookie/i, /headers\.get\(\s*"cookie"/i, /headers\.get\(\s*"location"/i, /redirect:\s*"follow"/i, /entries\(\)/, /console\./, /NEXT_PUBLIC/, /BLISSCCO_PUBLISHER_API_KEY/]) {
      assert.equal(re.test(code), false, String(re));
    }
  });

  it("script has no db, supabase, revive-delivery, match-api or file-write imports", () => {
    const imports = [...code.matchAll(/import\s[^;]*from\s+"([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(imports, ["node:url"]);
    for (const re of [/supabase/i, /\/api\/v1\/ads/, /\/api\/ads\/match/, /writeFile|appendFile/, /REVIVE_DELIVERY_URL/]) assert.equal(re.test(code), false, String(re));
  });

  it("not wired into CI, npm scripts or production code", () => {
    const pkg = readFileSync(path.join(ROOT, "package.json"), "utf8");
    assert.equal(pkg.includes("revive-json-preview-check"), false);
    for (const wf of ["ci.yml", "integration.yml"]) assert.equal(readFileSync(path.join(ROOT, ".github", "workflows", wf), "utf8").includes("revive-json-preview-check"), false);
    for (const f of ["app/api/ads/match/route.ts", "app/api/v1/ads/match/route.ts", "app/api/revive-json-preview/route.ts", "lib/ads/fallback-routing.ts"]) {
      assert.equal(readFileSync(path.join(ROOT, f), "utf8").includes("revive-json-preview-check"), false, f);
    }
  });

  it("the Day 24 route and flag are unchanged: still default-off server-side flag", () => {
    const lib = readFileSync(path.join(ROOT, "lib/ads/revive-json-preview.ts"), "utf8");
    assert.match(lib, /PREVIEW_ENV_FLAG = "REVIVE_JSON_PREVIEW_ENABLED"/);
    assert.equal(/NEXT_PUBLIC_REVIVE_JSON_PREVIEW/.test(lib), false);
  });
});

function existsRoute(): boolean {
  try {
    readFileSync(path.join(ROOT, "app/api/revive-json-preview/route.ts"), "utf8");
    return true;
  } catch {
    return false;
  }
}
