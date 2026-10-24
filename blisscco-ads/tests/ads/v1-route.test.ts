import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isJsonContentType } from "@/lib/ads/match-handler";
import * as legacyRoute from "@/app/api/ads/match/route";
import * as v1Route from "@/app/api/v1/ads/match/route";

// Day 6 (Part 2): POST /api/v1/ads/match. Purana /api/ads/match jaisa chalta rahe, v1 usi handler par ho.
// Database NAKLI hai (tests/register.cjs). Asli Supabase kabhi nahi chhuta.

const ROOT = path.join(__dirname, "..", "..", "..");
const KEY = `blc_live_${"b".repeat(64)}`;
const UUID_1 = "11111111-1111-4111-8111-111111111111";
const PUBLISHER_ID = "99999999-9999-4999-8999-999999999999";
const CAMPAIGN_ID = "33333333-3333-4333-8333-333333333333";
const AUTH_OK = { outcome: "ok", publisher_id: PUBLISHER_ID, publisher_status: "active", unit_cost_usd: 0.002 };

type Reply = { data: unknown; error: { code?: string } | null } | (() => never);
const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
let rpcNames: string[] = [];
const realConsoleError = console.error;

function candidateRow(): Record<string, unknown> {
  return {
    creative_id: UUID_1, headline: "H", body: "B", cta_text: null, destination_url: "https://example.com/x",
    creative_status: "approved", campaign_id: CAMPAIGN_ID, campaign_status: "active", category: "gaming",
    start_date: "2020-01-01", end_date: null, total_budget: 100, daily_budget: null, spent_total: 0, spent_today: 0,
    advertiser_status: "active", advertiser_profile_status: "active", campaign_serves_today: 0, creative_serves_today: 0,
  };
}

function setDb(over: Record<string, Reply> = {}) {
  const replies: Record<string, Reply> = {
    authorize_publisher_key: { data: AUTH_OK, error: null },
    load_ad_candidates: { data: [candidateRow()], error: null },
    record_ad_serve: { data: { outcome: "ok" }, error: null },
    ...over,
  };
  globals.__TEST_SUPABASE__ = {
    rpc: async (name: string) => {
      rpcNames.push(name);
      const reply = replies[name];
      if (!reply) throw new Error(`test: unexpected rpc ${name}`);
      return typeof reply === "function" ? reply() : reply;
    },
  };
}

beforeEach(() => {
  rpcNames = [];
  console.error = () => {};
  setDb();
});
afterEach(() => {
  console.error = realConsoleError;
  delete globals.__TEST_SUPABASE__;
});

function req(path_: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://blisscco.test${path_}`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", ...headers },
    body,
  });
}
const callV1 = (body: string, headers?: Record<string, string>) => v1Route.POST(req("/api/v1/ads/match", body, headers));
const callLegacy = (body: string, headers?: Record<string, string>) => legacyRoute.POST(req("/api/ads/match", body, headers));

/** Ek hi body ko padhne ke liye: padhne se pehle clone nahi, seedha text. */
async function snapshot(res: Response) {
  return {
    status: res.status,
    body: await res.text(),
    cacheControl: res.headers.get("cache-control"),
    wwwAuthenticate: res.headers.get("www-authenticate"),
    retryAfter: res.headers.get("retry-after"),
  };
}

describe("v1 route: same behaviour as the legacy route", () => {
  const scenarios: Array<{
    name: string;
    body: string;
    headers?: Record<string, string>;
    db?: Record<string, Reply>;
    status: number;
  }> = [
    { name: "ad found", body: '{"topic":"gaming"}', status: 200 },
    { name: "alias topic", body: '{"topic":"games"}', status: 200 },
    { name: "sensitive topic => no-fill", body: '{"topic":"health"}', status: 200 },
    { name: "no eligible candidate", body: '{"topic":"gaming"}', db: { load_ad_candidates: { data: [], error: null } }, status: 200 },
    { name: "no key", body: '{"topic":"gaming"}', headers: { authorization: "" }, status: 401 },
    { name: "unknown key", body: '{"topic":"gaming"}', db: { authorize_publisher_key: { data: { outcome: "unauthorized" }, error: null } }, status: 401 },
    { name: "rate limited", body: '{"topic":"gaming"}', db: { authorize_publisher_key: { data: { outcome: "rate_limited" }, error: null } }, status: 429 },
    { name: "wrong content-type", body: '{"topic":"gaming"}', headers: { "content-type": "text/plain" }, status: 415 },
    { name: "unknown field", body: '{"topic":"gaming","prompt":"hi"}', status: 400 },
    { name: "bad json", body: "{nope", status: 400 },
    { name: "oversized", body: JSON.stringify({ topic: "gaming", pad: "x".repeat(3000) }), status: 413 },
    { name: "database error => 503", body: '{"topic":"gaming"}', db: { authorize_publisher_key: { data: null, error: { code: "XX000" } } }, status: 503 },
  ];

  for (const s of scenarios) {
    it(`${s.name}: identical status, body and headers (v1 only adds the version header)`, async () => {
      setDb(s.db);
      const legacy = await callLegacy(s.body, s.headers);
      const legacyRpc = [...rpcNames];
      rpcNames = [];
      setDb(s.db);
      const v1 = await callV1(s.body, s.headers);
      assert.equal(v1.status, s.status);
      assert.equal(legacy.status, s.status);
      assert.equal(v1.headers.get("x-blisscco-api-version"), "1");
      assert.equal(legacy.headers.get("x-blisscco-api-version"), null, "legacy gets no new header");
      assert.deepEqual(await snapshot(v1), await snapshot(legacy));
      assert.deepEqual(rpcNames, legacyRpc, "same database calls in the same order");
    });
  }

  it("ad response has only the public fields", async () => {
    const res = await callV1('{"topic":"gaming"}');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      fill: true,
      sponsored: true,
      ad: { id: UUID_1, headline: "H", body: "B", cta_text: null, destination_url: "https://example.com/x" },
    });
  });

  it("v1 exports only POST (+ Next route config); no CORS/OPTIONS", () => {
    const handlers = Object.keys(v1Route).filter((k) => /^(GET|PUT|PATCH|DELETE|OPTIONS|HEAD|POST)$/.test(k));
    assert.deepEqual(handlers, ["POST"]);
    assert.equal(v1Route.runtime, "nodejs");
    assert.equal(v1Route.dynamic, "force-dynamic");
    assert.equal(legacyRoute.runtime, "nodejs");
    assert.equal(legacyRoute.dynamic, "force-dynamic");
  });
});

describe("v1 route: content-type (strict)", () => {
  it("isJsonContentType accepts application/json with optional utf-8 charset", () => {
    for (const ok of ["application/json", "Application/JSON", " application/json ", "application/json; charset=utf-8",
      "application/json;charset=UTF-8", 'application/json; charset="utf-8"', "application/json; boundary=x"]) {
      assert.equal(isJsonContentType(ok), true, ok);
    }
  });

  it("isJsonContentType rejects look-alikes and other charsets", () => {
    for (const bad of [null, "", "text/plain", "application/jsonp", "application/jsonx", "application/json-patch+json",
      "application/x-json", "text/json", "application/json; charset=latin1", "application/json; charset=utf-16", "json"]) {
      assert.equal(isJsonContentType(bad), false, String(bad));
    }
  });

  it("route: charset=utf-8 works, jsonp is 415 and never reaches the database", async () => {
    const ok = await callV1('{"topic":"gaming"}', { "content-type": "application/json; charset=utf-8" });
    assert.equal(ok.status, 200);
    rpcNames = [];
    const bad = await callV1('{"topic":"gaming"}', { "content-type": "application/jsonp" });
    assert.equal(bad.status, 415);
    assert.deepEqual(await bad.json(), { error: "unsupported_media_type" });
    assert.equal(rpcNames.length, 0);
  });
});

describe("v1 route: body-size limit (2048 bytes)", () => {
  const padded = (bytes: number) => '{"topic":"gaming"}' + " ".repeat(bytes - '{"topic":"gaming"}'.length);

  it("exactly 2048 bytes is accepted, 2049 is 413 (streamed body, no content-length)", async () => {
    assert.equal(padded(2048).length, 2048);
    assert.equal((await callV1(padded(2048))).status, 200);
    rpcNames = [];
    const big = await callV1(padded(2049));
    assert.equal(big.status, 413);
    assert.deepEqual(await big.json(), { error: "payload_too_large" });
    assert.equal(rpcNames.length, 0);
  });

  it("a declared content-length above the limit is 413 before the body is read", async () => {
    const res = await callV1('{"topic":"gaming"}', { "content-length": "2049" });
    assert.equal(res.status, 413);
    assert.equal(rpcNames.length, 0);
  });

  it("a chunked body over the limit is cut off at 413", async () => {
    const chunk = new TextEncoder().encode('{"topic":"gaming","x":"' + "a".repeat(900));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 6) return controller.close();
        sent += 1;
        controller.enqueue(chunk);
      },
    });
    const request = new Request("https://blisscco.test/api/v1/ads/match", {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: stream,
      // @ts-expect-error duplex Node/undici me stream body ke liye chahiye (DOM typings me nahi)
      duplex: "half",
    });
    const res = await v1Route.POST(request);
    assert.equal(res.status, 413);
    assert.ok(sent <= 4, `body padhna jaldi ruk gaya (chunks padhe: ${sent})`);
    assert.equal(rpcNames.length, 0);
  });
});

describe("v1 route: auth order and safe errors", () => {
  it("no/malformed key => 401 with WWW-Authenticate and the version header; database never called", async () => {
    for (const authorization of ["", "Bearer nope", `Basic ${KEY}`, `Bearer blc_live_${"b".repeat(63)}`]) {
      const res = await callV1('{"topic":"gaming"}', { authorization });
      assert.equal(res.status, 401, authorization);
      assert.equal(res.headers.get("www-authenticate"), 'Bearer realm="blisscco-ads"');
      assert.equal(res.headers.get("x-blisscco-api-version"), "1");
      assert.deepEqual(await res.json(), { error: "unauthorized" });
    }
    assert.equal(rpcNames.length, 0);
  });

  it("429 keeps Retry-After and 503 keeps its fixed body; nothing internal leaks", async () => {
    setDb({ authorize_publisher_key: { data: { outcome: "rate_limited" }, error: null } });
    const limited = await callV1('{"topic":"gaming"}');
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "60");
    assert.deepEqual(await limited.json(), { error: "rate_limited" });

    setDb({ authorize_publisher_key: () => { throw new Error("secret connection string db.internal:5432"); } });
    const down = await callV1('{"topic":"gaming"}');
    assert.equal(down.status, 503);
    const text = await down.text();
    assert.deepEqual(JSON.parse(text), { fill: false, error: "unavailable" });
    assert.ok(!/secret|internal|5432|stack/i.test(text));
  });

  it("the database only ever sees the key HASH, never the key", async () => {
    const seen: unknown[] = [];
    globals.__TEST_SUPABASE__ = {
      rpc: async (name: string, args: unknown) => {
        seen.push({ name, args });
        if (name === "authorize_publisher_key") return { data: AUTH_OK, error: null };
        if (name === "load_ad_candidates") return { data: [candidateRow()], error: null };
        return { data: { outcome: "ok" }, error: null };
      },
    };
    assert.equal((await callV1('{"topic":"gaming"}')).status, 200);
    assert.ok(!JSON.stringify(seen).includes(KEY));
  });
});

describe("v1 route: source safety", () => {
  const files = ["app/api/ads/match/route.ts", "app/api/v1/ads/match/route.ts", "lib/ads/match-handler.ts"];
  const code = (f: string) => readFileSync(path.join(ROOT, f), "utf8").replace(/\/\/.*$/gm, "");

  it("no logging, no storage, no secrets, no CORS in the route files or the shared handler", () => {
    for (const f of files) {
      const src = code(f);
      assert.equal(/console\./.test(src), false, `${f}: console`);
      assert.equal(/lib\/supabase\/admin|SECRET_KEY|process\.env/.test(src), false, `${f}: secrets`);
      assert.equal(/access-control-allow/i.test(src) || /\bOPTIONS\b/.test(src), false, `${f}: cors`);
      assert.equal(/\bcookies\(|localStorage|writeFile|appendFile/.test(src), false, `${f}: storage`);
    }
  });

  it("both routes are thin wrappers over the shared handler (no duplicated logic)", () => {
    for (const f of ["app/api/ads/match/route.ts", "app/api/v1/ads/match/route.ts"]) {
      const src = code(f);
      assert.match(src, /handleMatchPost/, f);
      assert.equal(/hashApiKey|readBearerKey|parseMatchRequest|serveAdForPublisher/.test(src), false, f);
      assert.ok(src.split("\n").length < 25, `${f} thin rehna chahiye`);
    }
  });

  it("tsconfig.test.json compiles the v1 route (otherwise npm test would skip it)", () => {
    assert.match(readFileSync(path.join(ROOT, "tsconfig.test.json"), "utf8"), /app\/api\/v1\/ads\/match\/route\.ts/);
  });
});
