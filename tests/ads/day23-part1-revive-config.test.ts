import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  REVIVE_DEFAULT_TIMEOUT_MS,
  REVIVE_MAX_TIMEOUT_MS,
  createReviveAdapter,
  parseReviveConfig,
  parseReviveEnv,
  reviveEnvEnabled,
  reviveRawConfigFromEnv,
} from "@/lib/ads/revive-adapter";
import { providerFallbackFromEnv, reviveFallbackEnabled } from "@/lib/ads/fallback-provider";

// Day 23 Part 1: Revive env config hardening. Koi asli network/DB/Revive nahi; sirf pure parsing + nakli fetcher.

const ROOT = path.join(__dirname, "..", "..", "..");
const SECRET = "SECRETKEY-d23-91ab";
const URL_OK = `https://delivery.example.com/serve?zoneid=7&key=${SECRET}`;
const ENV_OK = { REVIVE_FALLBACK_ENABLED: "true", REVIVE_DELIVERY_URL: URL_OK };
const env = (over: Record<string, string | undefined> = {}) => ({ ...ENV_OK, ...over });

describe("day 23 part 1 | disabled by default", () => {
  it("empty, null and undefined env => disabled", () => {
    for (const e of [{}, null, undefined]) {
      const r = parseReviveEnv(e as never);
      assert.deepEqual(r, { ok: false, reason: "disabled" });
    }
  });

  it("only the exact string \"true\" enables it", () => {
    for (const v of [undefined, "", "1", "TRUE", "True", "yes", " true", "true ", "false", "on"]) {
      assert.equal(reviveEnvEnabled({ REVIVE_FALLBACK_ENABLED: v }), false, String(v));
      assert.equal(reviveFallbackEnabled({ REVIVE_FALLBACK_ENABLED: v }), false, String(v));
      assert.deepEqual(parseReviveEnv(env({ REVIVE_FALLBACK_ENABLED: v })), { ok: false, reason: "disabled" }, String(v));
    }
    assert.equal(reviveEnvEnabled({ REVIVE_FALLBACK_ENABLED: "true" }), true);
  });

  it("flag off => other bad variables are ignored (disabled, not invalid_config)", () => {
    const r = parseReviveEnv({ REVIVE_DELIVERY_URL: "http://bad", REVIVE_TIMEOUT_MS: "abc", REVIVE_RESPONSE_FORMAT: "xml" });
    assert.deepEqual(r, { ok: false, reason: "disabled" });
  });

  it("disabled adapter never calls the fetcher", async () => {
    let calls = 0;
    const out = await createReviveAdapter(reviveRawConfigFromEnv({}), { fetcher: async () => { calls++; throw new Error("no"); } }).requestFill();
    assert.deepEqual(out, { status: "no-fill", reason: "disabled" });
    assert.equal(calls, 0);
  });
});

describe("day 23 part 1 | missing and invalid variables", () => {
  const invalid = (e: Record<string, string | undefined>) => assert.deepEqual(parseReviveEnv(e), { ok: false, reason: "invalid_config" }, JSON.stringify(Object.keys(e)));

  it("enabled but URL missing or empty => invalid_config", () => {
    invalid({ REVIVE_FALLBACK_ENABLED: "true" });
    invalid({ REVIVE_FALLBACK_ENABLED: "true", REVIVE_DELIVERY_URL: "" });
  });

  it("non-https, malformed, padded, credentialed, fragment and over-long URLs => invalid_config", () => {
    for (const u of [
      `http://delivery.example.com/serve?key=${SECRET}`,
      `ftp://delivery.example.com/x?key=${SECRET}`,
      "not a url",
      "//delivery.example.com/x",
      ` ${URL_OK}`,
      `${URL_OK} `,
      `https://user:pw@delivery.example.com/x?key=${SECRET}`,
      `${URL_OK}#frag`,
      `https://delivery.example.com/${"a".repeat(2100)}?key=${SECRET}`,
    ]) invalid(env({ REVIVE_DELIVERY_URL: u }));
  });

  it("timeout: non-numeric, signed, decimal, padded, zero, too long and out-of-bounds => invalid_config", () => {
    for (const t of ["abc", "-1", "+5", "1.5", " 500", "500 ", "1e3", "0", "0000", "3001", "99999", "100000", String(REVIVE_MAX_TIMEOUT_MS + 1)]) {
      invalid(env({ REVIVE_TIMEOUT_MS: t }));
    }
  });

  it("response format: anything except exact json/html => invalid_config", () => {
    for (const f of ["xml", "JSON", "Json", " json", "json ", "text", "vast"]) invalid(env({ REVIVE_RESPONSE_FORMAT: f }));
  });

  it("garbage env shapes never throw", () => {
    for (const e of [null, undefined, 5, "x", [], () => 1, { get REVIVE_FALLBACK_ENABLED(): string { throw new Error("boom"); } }]) {
      assert.doesNotThrow(() => parseReviveEnv(e as never));
      assert.doesNotThrow(() => reviveEnvEnabled(e as never));
      assert.doesNotThrow(() => reviveRawConfigFromEnv(e as never));
    }
    assert.deepEqual(parseReviveEnv({ get REVIVE_FALLBACK_ENABLED(): string { throw new Error("boom"); } } as never), { ok: false, reason: "disabled" });
  });

  it("invalid config makes the adapter no-fill without any request", async () => {
    let calls = 0;
    const fetcher = async () => { calls++; throw new Error("no"); };
    for (const e of [env({ REVIVE_DELIVERY_URL: "http://x.example.com" }), env({ REVIVE_TIMEOUT_MS: "abc" }), env({ REVIVE_RESPONSE_FORMAT: "xml" })]) {
      const out = await createReviveAdapter(reviveRawConfigFromEnv(e), { fetcher }).requestFill();
      assert.deepEqual(out, { status: "no-fill", reason: "invalid_config" });
    }
    assert.equal(calls, 0);
  });
});

describe("day 23 part 1 | valid configuration", () => {
  it("defaults: json format and the Day 22 default timeout", () => {
    const r = parseReviveEnv(ENV_OK);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.config.enabled, true);
      assert.equal(r.config.responseFormat, "json");
      assert.equal(r.config.timeoutMs, REVIVE_DEFAULT_TIMEOUT_MS);
      assert.equal(r.config.deliveryUrl, new URL(URL_OK).href);
    }
  });

  it("empty optional variables behave as unset", () => {
    const r = parseReviveEnv(env({ REVIVE_TIMEOUT_MS: "", REVIVE_RESPONSE_FORMAT: "" }));
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.config.timeoutMs, REVIVE_DEFAULT_TIMEOUT_MS);
  });

  it("timeout bounds 1 and max are accepted; format html is accepted", () => {
    for (const t of ["1", "500", String(REVIVE_MAX_TIMEOUT_MS)]) {
      const r = parseReviveEnv(env({ REVIVE_TIMEOUT_MS: t }));
      assert.equal(r.ok, true, t);
      if (r.ok) assert.equal(r.config.timeoutMs, Number(t));
    }
    const h = parseReviveEnv(env({ REVIVE_RESPONSE_FORMAT: "html" }));
    assert.equal(h.ok && h.config.responseFormat, "html");
  });

  it("env parsing matches parseReviveConfig on the raw object (one contract)", () => {
    const e = env({ REVIVE_TIMEOUT_MS: "250", REVIVE_RESPONSE_FORMAT: "json" });
    assert.deepEqual(parseReviveEnv(e), parseReviveConfig({ enabled: true, deliveryUrl: URL_OK, timeoutMs: 250, responseFormat: "json" }));
  });

  it("valid env + json fetcher => fill through providerFallbackFromEnv, request is one plain GET to the configured URL", async () => {
    const seen: { url: string; init: Record<string, unknown> }[] = [];
    const fetcher = async (url: string, init: unknown) => {
      seen.push({ url, init: init as Record<string, unknown> });
      return new Response(JSON.stringify({ headline: "H", body: "B", destination_url: "https://example.com/x" }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const p = providerFallbackFromEnv(ENV_OK, { fetcher: fetcher as never });
    assert.equal(p.isEnabled(), true);
    const out = await p.request();
    assert.equal(out?.provider, "revive");
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, new URL(URL_OK).href);
    assert.equal(seen[0].init.method, "GET");
    assert.equal(seen[0].init.redirect, "error");
  });

  it("flag off => providerFallbackFromEnv makes no request and returns null", async () => {
    let calls = 0;
    const p = providerFallbackFromEnv({ REVIVE_DELIVERY_URL: URL_OK }, { fetcher: (async () => { calls++; throw new Error("no"); }) as never });
    assert.equal(p.isEnabled(), false);
    assert.equal(await p.request(), null);
    assert.equal(calls, 0);
  });
});

describe("day 23 part 1 | the delivery URL and its query never leak", () => {
  const leaks = (v: unknown) => {
    const text = typeof v === "string" ? v : JSON.stringify(v) + inspect(v, { depth: 6 });
    return text.includes(SECRET) || text.includes("zoneid") || text.includes("delivery.example.com");
  };

  it("config errors carry only a reason code", () => {
    for (const e of [env({ REVIVE_TIMEOUT_MS: "abc" }), env({ REVIVE_RESPONSE_FORMAT: "xml" }), env({ REVIVE_DELIVERY_URL: `http://delivery.example.com/?key=${SECRET}` }), env({ REVIVE_DELIVERY_URL: `https://u:p@delivery.example.com/?key=${SECRET}` })]) {
      const r = parseReviveEnv(e);
      assert.equal(r.ok, false);
      assert.deepEqual(Object.keys(r), ["ok", "reason"]);
      assert.equal(leaks(r), false);
    }
  });

  it("no-fill results for every config failure contain no URL or query", async () => {
    for (const e of [{}, env({ REVIVE_TIMEOUT_MS: "abc" }), env({ REVIVE_DELIVERY_URL: `http://delivery.example.com/?key=${SECRET}` })]) {
      const out = await createReviveAdapter(reviveRawConfigFromEnv(e)).requestFill();
      assert.equal(out.status, "no-fill");
      assert.equal(leaks(out), false);
    }
  });

  it("a fetcher that throws the URL in its message does not surface it", async () => {
    const fetcher = async (url: string) => { throw new Error(`connect failed ${url}`); };
    const out = await createReviveAdapter(reviveRawConfigFromEnv(ENV_OK), { fetcher: fetcher as never }).requestFill();
    assert.deepEqual(out, { status: "no-fill", reason: "network_error" });
    assert.equal(leaks(out), false);
    assert.equal(await providerFallbackFromEnv(ENV_OK, { fetcher: fetcher as never }).request(), null);
  });

  it("a valid config object stringified or inspected redacts the delivery URL", () => {
    const r = parseReviveEnv(ENV_OK);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(leaks(JSON.stringify(r)), false);
      assert.equal(leaks(inspect(r, { depth: 6 })), false);
      assert.equal(leaks(String(JSON.stringify(r.config))), false);
      assert.equal(r.config.deliveryUrl, new URL(URL_OK).href); // runtime use unchanged
    }
  });

  it("public match API output never contains the URL or any REVIVE_ name", () => {
    for (const f of ["lib/ads/match-handler.ts", "lib/ads/contract.ts", "app/api/v1/ads/match/route.ts", "app/api/ads/match/route.ts"]) {
      const src = readFileSync(path.join(ROOT, f), "utf8");
      assert.doesNotMatch(src, /REVIVE_[A-Z_]+|REVIVE_DELIVERY_URL/, f);
    }
  });

  it("revive-adapter.ts has no console/process.env use and does not put the URL into an Error", () => {
    const src = readFileSync(path.join(ROOT, "lib/ads/revive-adapter.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(src, /console\.|process\.env|new Error\(|\bthrow\b/);
  });
});
