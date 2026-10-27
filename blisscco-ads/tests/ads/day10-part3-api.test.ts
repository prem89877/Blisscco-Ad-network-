import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as legacyRoute from "@/app/api/ads/match/route";
import * as v1Route from "@/app/api/v1/ads/match/route";
import { handleMatchPost } from "@/lib/ads/match-handler";
import { createIpGuard } from "@/lib/ads/ip-guard";
import { ACTIVE_CATEGORIES } from "@/lib/ads/taxonomy";

// Day 10 Part 3: publisher ad request ka poora raasta (route -> key check -> validation -> category -> selection -> record -> JSON),
// dono URLs par (/api/ads/match purana, /api/v1/ads/match naya). Database NAKLI hai (tests/register.cjs).

const root = join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(join(root, f), "utf8");

const KEY = `blc_live_${"c".repeat(64)}`;
const WRONG_KEY = `blc_live_${"e".repeat(64)}`;
const AUTH_OK = { outcome: "ok", publisher_id: "99999999-9999-4999-8999-999999999999", publisher_status: "active", unit_cost_usd: 0.002 };
const ROW = {
  creative_id: "00000000-0000-4000-8000-000000000001", headline: "Level up", body: "Gaming laptops", cta_text: "Shop now", destination_url: "https://example.com/g",
  creative_status: "approved", campaign_id: "c0000000-0000-4000-8000-000000000001", campaign_status: "active", category: "gaming",
  start_date: "2020-01-01", end_date: null, total_budget: 100, daily_budget: null, spent_total: 0, spent_today: 0,
  advertiser_status: "active", advertiser_profile_status: "active", campaign_serves_today: 0, creative_serves_today: 0,
};

type Reply = { data: unknown; error: { code?: string; message?: string } | null };
const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
let rpcNames: string[] = [];
let logged: unknown[][] = [];
const realError = console.error;

function setDb(over: Record<string, Reply> = {}) {
  const replies: Record<string, Reply> = {
    authorize_publisher_key: { data: AUTH_OK, error: null },
    load_ad_candidates: { data: [ROW], error: null },
    record_ad_serve: { data: { outcome: "ok" }, error: null },
    ...over,
  };
  globals.__TEST_SUPABASE__ = {
    rpc: async (name: string) => {
      rpcNames.push(name);
      const r = replies[name];
      if (!r) throw new Error(`test: unexpected rpc ${name}`);
      return r;
    },
  };
}

beforeEach(() => {
  rpcNames = [];
  logged = [];
  console.error = (...a: unknown[]) => {
    logged.push(a);
  };
  setDb();
});
afterEach(() => {
  console.error = realError;
});

const ROUTES = [
  { name: "/api/ads/match (legacy)", post: legacyRoute.POST, versioned: false },
  { name: "/api/v1/ads/match", post: v1Route.POST, versioned: true },
];

function req(body: string, headers: Record<string, string> = {}, key: string | null = KEY): Request {
  const h: Record<string, string> = { "content-type": "application/json", ...headers };
  if (key) h.authorization = `Bearer ${key}`;
  return new Request("https://example.test/api/ads/match", { method: "POST", headers: h, body });
}

for (const r of ROUTES) {
  describe(`publisher ad request on ${r.name}`, () => {
    it("success: sponsored ad with exactly the 5 public fields; JSON, no-store, Vary", async () => {
      const res = await r.post(req('{"topic":"gaming"}'));
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type")?.startsWith("application/json"), true);
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.equal(res.headers.get("vary"), "Authorization");
      assert.equal(res.headers.get("x-blisscco-api-version"), r.versioned ? "1" : null);
      const body = await res.json();
      assert.deepEqual(Object.keys(body).sort(), ["ad", "fill", "sponsored"]);
      assert.equal(body.fill, true);
      assert.equal(body.sponsored, true);
      assert.deepEqual(Object.keys(body.ad).sort(), ["body", "cta_text", "destination_url", "headline", "id"]);
      assert.deepEqual(rpcNames, ["authorize_publisher_key", "load_ad_candidates", "record_ad_serve"]);
    });

    it("no-fill is always exactly {fill:false}: unsupported topic, sensitive topic, nothing eligible, ad rejected at record time", async () => {
      for (const topic of ["unknownthing", "health", "religion"]) {
        const res = await r.post(req(JSON.stringify({ topic })));
        assert.equal(res.status, 200, topic);
        assert.deepEqual(await res.json(), { fill: false }, topic);
      }
      setDb({ load_ad_candidates: { data: [], error: null } });
      assert.deepEqual(await (await r.post(req('{"topic":"gaming"}'))).json(), { fill: false });
      setDb({ record_ad_serve: { data: { outcome: "rejected" }, error: null } });
      assert.deepEqual(await (await r.post(req('{"topic":"gaming"}'))).json(), { fill: false });
    });

    it("required field and schema: topic must be a lowercase slug, nothing else is accepted (400, database never touched)", async () => {
      const bad: [string, string][] = [
        ["{}", "invalid_topic"],
        ['{"topic":"Gaming"}', "invalid_topic"],
        ['{"topic":5}', "invalid_topic"],
        ['{"topic":"gaming","exclude_ad_ids":"x"}', "invalid_exclude_ad_ids"],
        ["", "invalid_json"],
        ["[]", "invalid_body"],
      ];
      for (const [body, reason] of bad) {
        const res = await r.post(req(body));
        assert.equal(res.status, 400, body);
        assert.deepEqual(await res.json(), { error: "invalid_request", reason }, body);
      }
      assert.deepEqual(rpcNames, []);
    });

    it("privacy: any conversation, user or identity field is rejected before the database", async () => {
      const extras = ["messages", "prompt", "conversation", "user_id", "email", "ip", "user_agent", "text", "context", "publisher_id", "api_key"];
      for (const field of extras) {
        const res = await r.post(req(JSON.stringify({ topic: "gaming", [field]: "secret-user-text" })));
        assert.equal(res.status, 400, field);
        const text = JSON.stringify(await res.json());
        assert.equal(text.includes("secret-user-text"), false, field);
        assert.equal(text.includes(field), false, field);
      }
      assert.deepEqual(rpcNames, []);
    });

    it("authentication: missing, malformed, wrong and revoked keys all look the same (401), and malformed ones never reach the database", async () => {
      for (const key of [null, "nope", `blc_live_${"A".repeat(64)}`, `blc_live_${"c".repeat(63)}`]) {
        const res = await r.post(req('{"topic":"gaming"}', {}, key));
        assert.equal(res.status, 401, String(key));
        assert.deepEqual(await res.json(), { error: "unauthorized" });
        assert.match(res.headers.get("www-authenticate") ?? "", /^Bearer/);
      }
      assert.deepEqual(rpcNames, []);
      setDb({ authorize_publisher_key: { data: { outcome: "unauthorized" }, error: null } });
      const res = await r.post(req('{"topic":"gaming"}', {}, WRONG_KEY));
      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { error: "unauthorized" });
      assert.deepEqual(rpcNames, ["authorize_publisher_key"]);
    });

    it("rate limit: 429 with Retry-After and a fixed body; no ad lookup happens", async () => {
      setDb({ authorize_publisher_key: { data: { outcome: "rate_limited" }, error: null } });
      const res = await r.post(req('{"topic":"gaming"}'));
      assert.equal(res.status, 429);
      assert.equal(res.headers.get("retry-after"), "60");
      assert.deepEqual(await res.json(), { error: "rate_limited" });
      assert.deepEqual(rpcNames, ["authorize_publisher_key"]);
    });

    it("size and type limits: 413 and 415 with fixed bodies", async () => {
      const big = await r.post(req(JSON.stringify({ topic: "gaming", pad: "x".repeat(3000) })));
      assert.equal(big.status, 413);
      assert.deepEqual(await big.json(), { error: "payload_too_large" });
      const wrongType = await r.post(req('{"topic":"gaming"}', { "content-type": "text/plain" }));
      assert.equal(wrongType.status, 415);
      assert.deepEqual(await wrongType.json(), { error: "unsupported_media_type" });
      assert.deepEqual(rpcNames, []);
    });

    it("internal errors never leak: every database failure is 503 {fill:false,error:'unavailable'}", async () => {
      const failures: Record<string, Reply>[] = [
        { authorize_publisher_key: { data: null, error: { code: "42P01", message: 'relation "campaigns" does not exist' } } },
        { load_ad_candidates: { data: null, error: { code: "XX000", message: "internal secret detail" } } },
        { record_ad_serve: { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } } },
        { authorize_publisher_key: { data: { outcome: "surprise" }, error: null } },
      ];
      for (const over of failures) {
        setDb(over);
        const res = await r.post(req('{"topic":"gaming"}'));
        assert.equal(res.status, 503);
        assert.deepEqual(await res.json(), { fill: false, error: "unavailable" });
      }
      const text = JSON.stringify(logged);
      assert.equal(/campaigns|secret detail|duplicate key|blc_live_/.test(text), false, "logs must hold only static labels and codes");
    });
  });
}

describe("legacy and v1 stay compatible", () => {
  it("same status and same JSON body for every kind of request (only the version header differs)", async () => {
    const cases: [string, string | null, Record<string, Reply>?][] = [
      ['{"topic":"gaming"}', KEY],
      ['{"topic":"health"}', KEY],
      ['{"topic":"gaming","x":1}', KEY],
      ['{"topic":"gaming"}', null],
      ['{"topic":"gaming"}', KEY, { authorize_publisher_key: { data: { outcome: "rate_limited" }, error: null } }],
      ['{"topic":"gaming"}', KEY, { load_ad_candidates: { data: null, error: { code: "XX000" } } }],
    ];
    for (const [body, key, over] of cases) {
      setDb(over);
      const a = await legacyRoute.POST(req(body, {}, key));
      setDb(over);
      const b = await v1Route.POST(req(body, {}, key));
      assert.equal(a.status, b.status, body);
      assert.deepEqual(await a.json(), await b.json(), body);
    }
  });

  it("both routes export only POST and share one handler", () => {
    for (const mod of [legacyRoute, v1Route]) {
      assert.deepEqual(Object.keys(mod).filter((k) => /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/.test(k)), ["POST"]);
    }
    for (const f of ["app/api/ads/match/route.ts", "app/api/v1/ads/match/route.ts"]) assert.match(read(f), /handleMatchPost\(/);
  });
});

describe("wrong-key flood guard (before the database)", () => {
  it("after the limit of wrong keys from one IP, even a well-formed request gets 429 with no database call", async () => {
    const guard = createIpGuard(3, 60_000);
    const headers = { "x-forwarded-for": "203.0.113.9" };
    for (let i = 0; i < 3; i++) {
      const res = await handleMatchPost(req('{"topic":"gaming"}', headers, null), { ipGuard: guard });
      assert.equal(res.status, 401);
    }
    rpcNames = [];
    const blocked = await handleMatchPost(req('{"topic":"gaming"}', headers), { ipGuard: guard });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get("retry-after"), "60");
    assert.deepEqual(rpcNames, []);
    // doosra IP asar se bahar
    const other = await handleMatchPost(req('{"topic":"gaming"}', { "x-forwarded-for": "198.51.100.4" }), { ipGuard: guard });
    assert.equal(other.status, 200);
  });
});

describe("guide matches the API (no drift)", () => {
  const guide = read("app/dashboard/publisher/guide/page.tsx");
  it("lists exactly the supported topics", () => {
    const block = /Supported topics:([\s\S]*?)A few aliases/.exec(guide);
    assert.ok(block, "supported topics paragraph not found");
    const listed = Array.from(block[1].matchAll(/<code>([a-z_]+)<\/code>/g)).map((m) => m[1]).sort();
    assert.deepEqual(listed, ACTIVE_CATEGORIES.map((c) => c.slug).sort());
  });
  it("documents every status the API can return and the Retry-After value", () => {
    for (const status of ['"400"', '"401"', '"405"', '"413"', '"415"', '"429"', '"503 (or any 5xx)"']) assert.ok(guide.includes(`status: ${status}`), status);
    for (const body of ["invalid_request", "unauthorized", "payload_too_large", "unsupported_media_type", "rate_limited", "unavailable"]) assert.ok(guide.includes(body), body);
    assert.match(guide, /Retry-After: 60/);
  });
  it("tells publishers the privacy rules: no conversation text, no user data in the Idempotency-Key, server-side key only", () => {
    assert.match(guide, /never put a user id, an email or any text from the conversation/);
    assert.match(guide, /rejects any prompt, message, user identifier or other extra field/);
    assert.match(guide, /Server to server only/);
    assert.match(guide, /Rotate/);
  });
  it("documents the two URLs as one contract (v1 version header, same handler)", () => {
    assert.match(guide, /X-Blisscco-Api-Version: 1/);
    assert.match(guide, /POST \/api\/v1\/ads\/match/);
  });
});
