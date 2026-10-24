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
// Route ab serve flow chalata hai (lib/ads/service.ts): authorize_publisher_key -> load_ad_candidates -> record_ad_serve.
// Fake database rpc ke NAAM se jawab deta hai.
const PUBLISHER_ID = "99999999-9999-4999-8999-999999999999";
const CAMPAIGN_ID = "33333333-3333-4333-8333-333333333333";

const AUTH_OK = { outcome: "ok", publisher_id: PUBLISHER_ID, publisher_status: "active", unit_cost_usd: 0.002 };

function candidateRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    creative_id: UUID_1,
    headline: "H",
    body: "B",
    cta_text: null,
    destination_url: "https://example.com/x",
    creative_status: "approved",
    campaign_id: CAMPAIGN_ID,
    campaign_status: "active",
    category: "gaming",
    start_date: "2020-01-01",
    end_date: null,
    total_budget: 100,
    daily_budget: null,
    spent_total: 0,
    spent_today: 0,
    advertiser_status: "active",
    advertiser_profile_status: "active",
    campaign_serves_today: 0,
    creative_serves_today: 0,
    ...over,
  };
}

type Reply = FakeRpcResponse | (() => never);
let replies: Record<string, Reply> = {};

function setDb(over: Record<string, Reply> = {}) {
  replies = {
    authorize_publisher_key: { data: AUTH_OK, error: null },
    load_ad_candidates: { data: [candidateRow()], error: null },
    record_ad_serve: { data: { outcome: "ok" }, error: null },
    ...over,
  };
  globals.__TEST_SUPABASE__ = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      const reply = replies[name];
      if (!reply) throw new Error(`test: unexpected rpc ${name}`);
      return typeof reply === "function" ? reply() : reply;
    },
  };
}

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

const rpcNames = () => rpcCalls.map((c) => c.name);

describe("POST /api/ads/match (route logic, fake database)", () => {
  beforeEach(() => setDb());

  it("200 fill:true with only public ad fields; DB gets the key HASH, never the key", async () => {
    setDb({ load_ad_candidates: { data: [candidateRow({ advertiser_name: "Secret Co", budget: 99 })], error: null } });
    const res = await routeModule.POST(post(JSON.stringify({ topic: "gaming", exclude_ad_ids: [UUID_2] })));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = await readJson(res);
    assert.deepEqual(body, {
      fill: true,
      sponsored: true,
      ad: { id: UUID_1, headline: "H", body: "B", cta_text: null, destination_url: "https://example.com/x" },
    });
    const text = JSON.stringify(body);
    for (const secret of ["Secret Co", CAMPAIGN_ID, "campaign", "budget", PUBLISHER_ID]) {
      assert.ok(!text.includes(secret), secret);
    }
    assert.deepEqual(rpcNames(), ["authorize_publisher_key", "load_ad_candidates", "record_ad_serve"]);
    assert.equal(rpcCalls[0].args.p_key_hash, hashApiKey(KEY));
    assert.deepEqual(rpcCalls[1].args, { p_category: "gaming", p_today: rpcCalls[1].args.p_today });
    assert.deepEqual(rpcCalls[2].args, { p_key_hash: hashApiKey(KEY), p_creative_id: UUID_1, p_topic: "gaming" });
    assert.ok(!JSON.stringify(rpcCalls).includes(KEY));
  });

  it("an alias signal ('games') is resolved to the canonical category before any query", async () => {
    const res = await routeModule.POST(post('{"topic":"games"}'));
    assert.equal(res.status, 200);
    assert.equal((await readJson(res)).fill, true);
    assert.equal(rpcCalls[1].args.p_category, "gaming");
    assert.equal(rpcCalls[2].args.p_topic, "gaming");
  });

  it("200 fill:false for sensitive/unsupported topics; candidates are never loaded", async () => {
    for (const topic of ["health", "politics", "beauty", "not_a_category"]) {
      rpcCalls = [];
      const res = await routeModule.POST(post(JSON.stringify({ topic })));
      assert.equal(res.status, 200, topic);
      assert.deepEqual(await readJson(res), { fill: false }, topic);
      assert.deepEqual(rpcNames(), ["authorize_publisher_key"], topic);
    }
  });

  it("200 fill:false when there is no eligible candidate; nothing is recorded", async () => {
    setDb({ load_ad_candidates: { data: [candidateRow({ creative_status: "pending_review" })], error: null } });
    const res = await routeModule.POST(post('{"topic":"gaming"}'));
    assert.equal(res.status, 200);
    assert.deepEqual(await readJson(res), { fill: false });
    assert.ok(!rpcNames().includes("record_ad_serve"));
  });

  it("200 fill:false (no ad shown) when the database rejects the serve record", async () => {
    setDb({ record_ad_serve: { data: { outcome: "rejected" }, error: null } });
    const res = await routeModule.POST(post('{"topic":"gaming"}'));
    assert.equal(res.status, 200);
    assert.deepEqual(await readJson(res), { fill: false });
  });

  it("exclude_ad_ids are honoured when an alternative exists", async () => {
    setDb({
      load_ad_candidates: {
        data: [candidateRow(), candidateRow({ creative_id: UUID_2, headline: "Other" })],
        error: null,
      },
    });
    const res = await routeModule.POST(post(JSON.stringify({ topic: "gaming", exclude_ad_ids: [UUID_1] })));
    const body = await readJson(res);
    assert.equal((body.ad as Record<string, unknown>).id, UUID_2);
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

  it("401 when the database says unauthorized (revoked/unknown key); no campaign query runs", async () => {
    setDb({ authorize_publisher_key: { data: { outcome: "unauthorized" }, error: null } });
    const res = await routeModule.POST(post('{"topic":"gaming"}'));
    assert.equal(res.status, 401);
    assert.deepEqual(await readJson(res), { error: "unauthorized" });
    assert.deepEqual(rpcNames(), ["authorize_publisher_key"]);
  });

  it("429 with Retry-After when rate limited; no campaign query runs", async () => {
    setDb({ authorize_publisher_key: { data: { outcome: "rate_limited" }, error: null } });
    const res = await routeModule.POST(post('{"topic":"gaming"}'));
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("retry-after"), "60");
    assert.deepEqual(await readJson(res), { error: "rate_limited" });
    assert.deepEqual(rpcNames(), ["authorize_publisher_key"]);
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

  it("503 fill:false when any database step fails or returns garbage; no internals leak", async () => {
    const cases: Array<Record<string, Reply>> = [
      { authorize_publisher_key: { data: null, error: { code: "XX000" } } },
      { authorize_publisher_key: { data: { outcome: "ok", publisher_id: "nope" }, error: null } },
      { load_ad_candidates: { data: null, error: { code: "42501" } } },
      { record_ad_serve: { data: null, error: { code: "XX000" } } },
      { record_ad_serve: { data: { outcome: "surprise" }, error: null } },
    ];
    for (const over of cases) {
      setDb(over);
      rpcCalls = [];
      const res = await routeModule.POST(post('{"topic":"gaming"}'));
      const loadFailed = "load_ad_candidates" in over;
      // Candidate load fail = safe no-fill (200); baaki sab 503
      assert.equal(res.status, loadFailed ? 200 : 503, JSON.stringify(Object.keys(over)));
      const body = await readJson(res);
      assert.equal(body.fill, false);
      assert.ok(!JSON.stringify(body).includes("42501"));
      assert.ok(!JSON.stringify(body).includes("XX000"));
    }
  });

  it("only POST is exported (browser GET gets 405 from Next)", () => {
    const methods = Object.keys(routeModule).filter((k) => /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/.test(k));
    assert.deepEqual(methods, ["POST"]);
  });
});
