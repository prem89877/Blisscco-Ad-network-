import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { hashApiKey, readBearerKey } from "@/lib/ads/api-key";
import { matchAd, parseMatchResult } from "@/lib/ads/match";
import { MAX_EXCLUDE_IDS, parseMatchRequest } from "@/lib/ads/validation";
import * as routeModule from "@/app/api/ads/match/route";

// Ye tests Day 5 ke maujooda (pehle se likhe) hisson ko chalate hain: request ki jaanch, API key helper,
// database-jawab parser, matchAd pul, aur route handler. Database NAKLI hai (tests/register.cjs), asli Supabase nahi.

const KEY = `blc_live_${"a".repeat(64)}`;
const UUID_1 = "11111111-1111-4111-8111-111111111111";
const UUID_2 = "22222222-2222-4222-8222-222222222222";

type RpcCall = { name: string; args: Record<string, unknown> };
type FakeRpcResponse = { data: unknown; error: { code?: string } | null };

const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
let rpcCalls: RpcCall[] = [];
let nextRpc: FakeRpcResponse | (() => never) = { data: { outcome: "no_fill" }, error: null };
const realConsoleError = console.error;

beforeEach(() => {
  rpcCalls = [];
  nextRpc = { data: { outcome: "no_fill" }, error: null };
  console.error = () => {}; // matchAd error par code log karta hai; test output saaf rakhne ke liye
  globals.__TEST_SUPABASE__ = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (typeof nextRpc === "function") return nextRpc();
      return nextRpc;
    },
  };
});

afterEach(() => {
  console.error = realConsoleError;
  delete globals.__TEST_SUPABASE__;
});

// ---------------- parseMatchRequest ----------------
describe("parseMatchRequest", () => {
  it("accepts a minimal valid body", () => {
    assert.deepEqual(parseMatchRequest('{"topic":"gaming"}'), { ok: true, value: { topic: "gaming", excludeAdIds: [] } });
  });

  it("dedupes and lowercases exclude_ad_ids", () => {
    const r = parseMatchRequest(JSON.stringify({ topic: "gaming", exclude_ad_ids: [UUID_1.toUpperCase(), UUID_1, UUID_2] }));
    assert.deepEqual(r, { ok: true, value: { topic: "gaming", excludeAdIds: [UUID_1, UUID_2] } });
  });

  it("accepts exactly MAX_EXCLUDE_IDS ids, rejects one more", () => {
    const ids = (n: number) =>
      Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    assert.equal(parseMatchRequest(JSON.stringify({ topic: "gaming", exclude_ad_ids: ids(MAX_EXCLUDE_IDS) })).ok, true);
    assert.deepEqual(parseMatchRequest(JSON.stringify({ topic: "gaming", exclude_ad_ids: ids(MAX_EXCLUDE_IDS + 1) })), {
      ok: false,
      reason: "invalid_exclude_ad_ids",
    });
  });

  it("rejects invalid JSON and non-object bodies", () => {
    assert.deepEqual(parseMatchRequest("{nope"), { ok: false, reason: "invalid_json" });
    assert.deepEqual(parseMatchRequest(""), { ok: false, reason: "invalid_json" });
    for (const raw of ["[]", "null", '"gaming"', "42", "true"]) {
      assert.deepEqual(parseMatchRequest(raw), { ok: false, reason: "invalid_body" }, raw);
    }
  });

  it("rejects any extra field (prompt, messages, user, __proto__) so conversation text cannot reach us", () => {
    for (const extra of ['"prompt":"hello"', '"messages":[]', '"user":"u1"', '"__proto__":1', '"context":"x"']) {
      assert.deepEqual(parseMatchRequest(`{"topic":"gaming",${extra}}`), { ok: false, reason: "unknown_field" }, extra);
    }
  });

  it("rejects bad topics", () => {
    const bad = ['{}', '{"topic":1}', '{"topic":null}', '{"topic":""}', '{"topic":"Gaming"}', '{"topic":"gaming!"}',
      '{"topic":"two words"}', `{"topic":"${"a".repeat(51)}"}`, '{"topic":["gaming"]}'];
    for (const raw of bad) assert.deepEqual(parseMatchRequest(raw), { ok: false, reason: "invalid_topic" }, raw);
  });

  it("rejects bad exclude_ad_ids", () => {
    for (const exclude of ['"x"', "1", "{}", '["not-a-uuid"]', "[1]", "[null]"]) {
      assert.deepEqual(
        parseMatchRequest(`{"topic":"gaming","exclude_ad_ids":${exclude}}`),
        { ok: false, reason: "invalid_exclude_ad_ids" },
        exclude,
      );
    }
  });

  it("a sensitive but well-formed topic passes validation (the taxonomy decides no-fill later)", () => {
    assert.equal(parseMatchRequest('{"topic":"health"}').ok, true);
  });
});

// ---------------- api key ----------------
describe("api key helpers", () => {
  it("readBearerKey accepts a correct header (case-insensitive scheme, surrounding spaces)", () => {
    assert.equal(readBearerKey(`Bearer ${KEY}`), KEY);
    assert.equal(readBearerKey(`bearer ${KEY}`), KEY);
    assert.equal(readBearerKey(`  Bearer   ${KEY}  `), KEY);
  });

  it("readBearerKey rejects wrong shapes", () => {
    const bad: Array<string | null> = [
      null,
      "",
      KEY,
      `Basic ${KEY}`,
      `Bearer ${KEY} extra`,
      `Bearer blc_test_${"a".repeat(64)}`,
      `Bearer blc_live_${"a".repeat(63)}`,
      `Bearer blc_live_${"a".repeat(65)}`,
      `Bearer blc_live_${"A".repeat(64)}`,
      `Bearer blc_live_${"g".repeat(64)}`,
    ];
    for (const h of bad) assert.equal(readBearerKey(h), null, String(h));
  });

  it("hashApiKey is SHA-256 hex (known vector) and never the key itself", () => {
    assert.equal(hashApiKey("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const h = hashApiKey(KEY);
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.notEqual(h, KEY);
    assert.equal(h, createHash("sha256").update(KEY).digest("hex"));
  });
});

// ---------------- parseMatchResult ----------------
describe("parseMatchResult", () => {
  const ad = { id: UUID_1, headline: "H", body: "B", cta_text: "Go", destination_url: "https://example.com/x" };

  it("parses ok and keeps only the 5 public fields", () => {
    const r = parseMatchResult({ outcome: "ok", ad: { ...ad, campaign_id: "c", advertiser_id: "a", budget: 5 } });
    assert.deepEqual(r, {
      outcome: "ok",
      ad: { id: UUID_1, headline: "H", body: "B", ctaText: "Go", destinationUrl: "https://example.com/x" },
    });
  });

  it("accepts a null cta_text", () => {
    const r = parseMatchResult({ outcome: "ok", ad: { ...ad, cta_text: null } });
    assert.equal(r.outcome === "ok" && r.ad.ctaText, null);
  });

  it("parses the simple outcomes", () => {
    for (const o of ["no_fill", "unauthorized", "rate_limited"] as const) {
      assert.deepEqual(parseMatchResult({ outcome: o }), { outcome: o });
    }
  });

  it("anything malformed becomes error (never throws, never leaks)", () => {
    const bad: unknown[] = [
      null,
      undefined,
      "ok",
      42,
      [],
      {},
      { outcome: 1 },
      { outcome: "surprise" },
      { outcome: "ok" },
      { outcome: "ok", ad: null },
      { outcome: "ok", ad: { ...ad, destination_url: "http://example.com" } },
      { outcome: "ok", ad: { ...ad, destination_url: "javascript:alert(1)" } },
      { outcome: "ok", ad: { ...ad, cta_text: 5 } },
      { outcome: "ok", ad: { ...ad, headline: undefined } },
      { outcome: "ok", ad: { ...ad, id: 7 } },
    ];
    for (const v of bad) assert.deepEqual(parseMatchResult(v), { outcome: "error" }, JSON.stringify(v));
  });
});

// ---------------- matchAd bridge ----------------
describe("matchAd (fake database)", () => {
  it("calls match_contextual_ad with hash, topic and exclude ids", async () => {
    nextRpc = { data: { outcome: "no_fill" }, error: null };
    const r = await matchAd("h".repeat(64), "gaming", [UUID_1]);
    assert.deepEqual(r, { outcome: "no_fill" });
    assert.deepEqual(rpcCalls, [
      { name: "match_contextual_ad", args: { p_key_hash: "h".repeat(64), p_topic: "gaming", p_exclude_ids: [UUID_1] } },
    ]);
  });

  it("database error -> error outcome", async () => {
    nextRpc = { data: null, error: { code: "42501" } };
    assert.deepEqual(await matchAd("h", "gaming", []), { outcome: "error" });
  });

  it("thrown exception -> error outcome", async () => {
    nextRpc = () => {
      throw new Error("boom");
    };
    assert.deepEqual(await matchAd("h", "gaming", []), { outcome: "error" });
  });

  it("missing admin client -> error outcome", async () => {
    delete globals.__TEST_SUPABASE__;
    assert.deepEqual(await matchAd("h", "gaming", []), { outcome: "error" });
  });
});

// ---------------- route handler ----------------
function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request("https://blisscco.test/api/ads/match", {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", ...headers },
    body,
  });
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe("POST /api/ads/match (route logic, fake database)", () => {
  const okAd = { id: UUID_1, headline: "H", body: "B", cta_text: null, destination_url: "https://example.com/x" };

  it("200 fill:true with only public ad fields; DB gets the key HASH, not the key", async () => {
    nextRpc = { data: { outcome: "ok", ad: { ...okAd, campaign_id: "secret-campaign", budget: 99 } }, error: null };
    const res = await routeModule.POST(post(JSON.stringify({ topic: "gaming", exclude_ad_ids: [UUID_2] })));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = await readJson(res);
    assert.deepEqual(body, {
      fill: true,
      sponsored: true,
      ad: { id: UUID_1, headline: "H", body: "B", cta_text: null, destination_url: "https://example.com/x" },
    });
    assert.ok(!JSON.stringify(body).includes("secret-campaign"));
    assert.equal(rpcCalls.length, 1);
    assert.equal(rpcCalls[0].args.p_key_hash, hashApiKey(KEY));
    assert.equal(rpcCalls[0].args.p_topic, "gaming");
    assert.deepEqual(rpcCalls[0].args.p_exclude_ids, [UUID_2]);
    assert.ok(!JSON.stringify(rpcCalls).includes(KEY));
  });

  it("200 fill:false when the database says no_fill (also for sensitive topic 'health')", async () => {
    nextRpc = { data: { outcome: "no_fill" }, error: null };
    const res = await routeModule.POST(post('{"topic":"health"}'));
    assert.equal(res.status, 200);
    assert.deepEqual(await readJson(res), { fill: false });
  });

  it("401 without key, with malformed key; database is never called", async () => {
    const noAuth = new Request("https://blisscco.test/api/ads/match", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"topic":"gaming"}',
    });
    const r1 = await routeModule.POST(noAuth);
    assert.equal(r1.status, 401);
    assert.match(r1.headers.get("www-authenticate") ?? "", /^Bearer/);
    const r2 = await routeModule.POST(post('{"topic":"gaming"}', { authorization: "Bearer short" }));
    assert.equal(r2.status, 401);
    assert.deepEqual(await readJson(r2), { error: "unauthorized" });
    assert.equal(rpcCalls.length, 0);
  });

  it("401 when the database says unauthorized (revoked/unknown key)", async () => {
    nextRpc = { data: { outcome: "unauthorized" }, error: null };
    const res = await routeModule.POST(post('{"topic":"gaming"}'));
    assert.equal(res.status, 401);
    assert.deepEqual(await readJson(res), { error: "unauthorized" });
  });

  it("429 with Retry-After when rate limited", async () => {
    nextRpc = { data: { outcome: "rate_limited" }, error: null };
    const res = await routeModule.POST(post('{"topic":"gaming"}'));
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("retry-after"), "60");
    assert.deepEqual(await readJson(res), { error: "rate_limited" });
  });

  it("415 for wrong content-type", async () => {
    const res = await routeModule.POST(post('{"topic":"gaming"}', { "content-type": "text/plain" }));
    assert.equal(res.status, 415);
    assert.equal(rpcCalls.length, 0);
  });

  it("413 for an oversized body", async () => {
    const big = JSON.stringify({ topic: "gaming", exclude_ad_ids: [], pad: "x".repeat(3000) });
    const res = await routeModule.POST(post(big));
    assert.equal(res.status, 413);
    assert.equal(rpcCalls.length, 0);
  });

  it("400 for unknown field (prompt), bad JSON and bad topic, with a reason", async () => {
    const r1 = await routeModule.POST(post('{"topic":"gaming","prompt":"hello"}'));
    assert.equal(r1.status, 400);
    assert.deepEqual(await readJson(r1), { error: "invalid_request", reason: "unknown_field" });
    const r2 = await routeModule.POST(post("{bad"));
    assert.equal(r2.status, 400);
    assert.deepEqual(await readJson(r2), { error: "invalid_request", reason: "invalid_json" });
    const r3 = await routeModule.POST(post('{"topic":"Gaming Now"}'));
    assert.equal(r3.status, 400);
    assert.deepEqual(await readJson(r3), { error: "invalid_request", reason: "invalid_topic" });
    assert.equal(rpcCalls.length, 0);
  });

  it("503 fill:false when the database fails or returns garbage", async () => {
    nextRpc = { data: null, error: { code: "XX000" } };
    const r1 = await routeModule.POST(post('{"topic":"gaming"}'));
    assert.equal(r1.status, 503);
    assert.deepEqual(await readJson(r1), { fill: false, error: "unavailable" });
    nextRpc = { data: { outcome: "ok", ad: { id: 1 } }, error: null };
    const r2 = await routeModule.POST(post('{"topic":"gaming"}'));
    assert.equal(r2.status, 503);
  });

  it("only POST is exported (browser GET gets 405 from Next)", () => {
    const methods = Object.keys(routeModule).filter((k) => /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/.test(k));
    assert.deepEqual(methods, ["POST"]);
  });
});
