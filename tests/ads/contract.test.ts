import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PUBLIC_AD_FIELDS, toPublicAd, buildAdResponse } from "@/lib/ads/contract";
import * as legacyRoute from "@/app/api/ads/match/route";
import * as v1Route from "@/app/api/v1/ads/match/route";

// Day 6 (prompt 4): POST /api/v1/ads/match ka request/response CONTRACT test.
// Do cheezein pakadte hain: (1) har jawab ka exact shape, (2) DAY6-ADS-MATCH-CONTRACT.md ke JSON examples
// asli jawab se bilkul milte hain (doc purana nahi ho sakta). Database NAKLI hai (tests/register.cjs).

const ROOT = path.join(__dirname, "..", "..", "..");
const KEY = `blc_live_${"c".repeat(64)}`;
const AD_ID = "3f2b8c1e-5a47-4d9e-9b62-7c1d8e4a6f10";
const OTHER_ID = "7a9d1c4e-2b35-4f68-8e01-5d3c9b7a2e44";
const PUBLISHER_ID = "99999999-9999-4999-8999-999999999999";
const CAMPAIGN_ID = "33333333-3333-4333-8333-333333333333";
const AUTH_OK = { outcome: "ok", publisher_id: PUBLISHER_ID, publisher_status: "active", unit_cost_usd: 0.002 };
const SECRET_TEXT = "secret connection string db.internal:5432 owner@advertiser.example";

type Reply = { data: unknown; error: { code?: string; message?: string } | null } | (() => never);
const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
let rpcNames: string[] = [];
let logged: string[] = [];
const realConsoleError = console.error;

function candidateRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    creative_id: AD_ID, headline: "Level up your game nights", body: "Compare gaming laptops built for long sessions.",
    cta_text: "Shop now", destination_url: "https://example.com/gaming-laptops",
    creative_status: "approved", campaign_id: CAMPAIGN_ID, campaign_status: "active", category: "gaming",
    start_date: "2020-01-01", end_date: null, total_budget: 100, daily_budget: null, spent_total: 0, spent_today: 0,
    advertiser_status: "active", advertiser_profile_status: "active", campaign_serves_today: 0, creative_serves_today: 0,
    ...over,
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
  logged = [];
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  setDb();
});
afterEach(() => {
  console.error = realConsoleError;
  delete globals.__TEST_SUPABASE__;
});

function req(url: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://blisscco.test${url}`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", ...headers },
    body,
  });
}
const ROUTES = [
  { name: "v1", url: "/api/v1/ads/match", post: (r: Request) => v1Route.POST(r) },
  { name: "legacy", url: "/api/ads/match", post: (r: Request) => legacyRoute.POST(r) },
];
type Call = { status: number; text: string; json: unknown; headers: Headers };
async function call(post: (r: Request) => Promise<Response>, url: string, body: string, headers?: Record<string, string>): Promise<Call> {
  const res = await post(req(url, body, headers));
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text), headers: res.headers };
}
const sortedKeys = (v: unknown) => Object.keys(v as object).sort();

for (const route of ROUTES) {
  const go = (body: string, headers?: Record<string, string>) => call(route.post, route.url, body, headers);

  describe(`${route.name}: request contract (only topic + exclude_ad_ids)`, () => {
    it("accepts the documented bodies", async () => {
      const ok = [
        '{"topic":"gaming"}',
        '{"topic":"gaming","exclude_ad_ids":[]}',
        `{"topic":"gaming","exclude_ad_ids":["${OTHER_ID}"]}`,
        `{"topic":"games","exclude_ad_ids":["${OTHER_ID.toUpperCase()}"]}`,
      ];
      for (const body of ok) {
        const res = await go(body);
        assert.equal(res.status, 200, body);
        assert.equal((res.json as { fill: boolean }).fill, true, body);
      }
    });

    it("rejects raw chatbot prompts, messages, user identifiers and any unexpected field with 400 unknown_field", async () => {
      const extras = ['"prompt":"hello"', '"messages":[{"role":"user","content":"hi"}]', '"message":"hi"', '"user_id":"u1"',
        '"user":"u1"', '"email":"a@b.co"', '"conversation":"..."', '"query":"best laptop"', '"text":"x"', '"context":"x"',
        '"session_id":"s"', '"ip":"1.2.3.4"', '"publisher_id":"p"', '"category":"gaming"', '"__proto__":{}', '"constructor":1'];
      for (const extra of extras) {
        const res = await go(`{"topic":"gaming",${extra}}`);
        assert.equal(res.status, 400, extra);
        assert.deepEqual(res.json, { error: "invalid_request", reason: "unknown_field" }, extra);
      }
      assert.equal(rpcNames.length, 0, "400 par database kabhi nahi chhuta");
    });

    it("a prompt is rejected even when topic is missing or the prompt is stuffed into topic", async () => {
      const a = await go('{"prompt":"I want to buy a gaming laptop"}');
      assert.deepEqual(a.json, { error: "invalid_request", reason: "unknown_field" });
      const b = await go(JSON.stringify({ topic: "I want to buy a gaming laptop under $1000 please help" }));
      assert.deepEqual(b.json, { error: "invalid_request", reason: "invalid_topic" });
      assert.equal(rpcNames.length, 0);
    });

    it("rejects bad JSON and bodies that are not an object", async () => {
      for (const body of ["{nope", "", "{", '{"topic":"gaming"}}']) {
        const res = await go(body);
        assert.equal(res.status, 400, body);
        assert.deepEqual(res.json, { error: "invalid_request", reason: "invalid_json" }, body);
      }
      for (const body of ["[]", "null", '"gaming"', "42", "true"]) {
        const res = await go(body);
        assert.equal(res.status, 400, body);
        assert.deepEqual(res.json, { error: "invalid_request", reason: "invalid_body" }, body);
      }
    });

    it("rejects bad topics (missing, wrong type, uppercase, spaces, punctuation, too long)", async () => {
      const bad = ["{}", '{"topic":1}', '{"topic":null}', '{"topic":""}', '{"topic":"Gaming"}', '{"topic":"video games"}',
        '{"topic":"gaming!"}', '{"topic":"game-ing"}', `{"topic":"${"a".repeat(51)}"}`, '{"topic":["gaming"]}', '{"topic":{"a":1}}'];
      for (const body of bad) {
        const res = await go(body);
        assert.equal(res.status, 400, body);
        assert.deepEqual(res.json, { error: "invalid_request", reason: "invalid_topic" }, body);
      }
      assert.equal((await go(`{"topic":"${"a".repeat(50)}"}`)).status, 200, "50 chars format ke andar hai (no-fill milega, 400 nahi)");
    });

    it("rejects bad exclude_ad_ids (not an array, null, non-uuid, non-string items, more than 20)", async () => {
      const ids = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
      const bad = [
        '{"topic":"gaming","exclude_ad_ids":"x"}',
        '{"topic":"gaming","exclude_ad_ids":null}',
        '{"topic":"gaming","exclude_ad_ids":{}}',
        '{"topic":"gaming","exclude_ad_ids":["not-a-uuid"]}',
        '{"topic":"gaming","exclude_ad_ids":[1]}',
        '{"topic":"gaming","exclude_ad_ids":[null]}',
        `{"topic":"gaming","exclude_ad_ids":["${AD_ID} "]}`,
        JSON.stringify({ topic: "gaming", exclude_ad_ids: ids(21) }),
      ];
      for (const body of bad) {
        const res = await go(body);
        assert.equal(res.status, 400, body.slice(0, 80));
        assert.deepEqual(res.json, { error: "invalid_request", reason: "invalid_exclude_ad_ids" }, body.slice(0, 80));
      }
      assert.equal((await go(JSON.stringify({ topic: "gaming", exclude_ad_ids: ids(20) }))).status, 200, "exactly 20 allowed");
    });

    it("request-size limit stays 2048 bytes (2048 ok, 2049 = 413), counted in bytes not characters", async () => {
      const base = '{"topic":"gaming"}';
      assert.equal((await go(base + " ".repeat(2048 - base.length))).status, 200);
      const big = await go(base + " ".repeat(2049 - base.length));
      assert.equal(big.status, 413);
      assert.deepEqual(big.json, { error: "payload_too_large" });
      // 1100 x "é" = 1100 chars (< 2048) lekin 2200 bytes (> 2048): limit bytes par lagti hai
      const multibyte = await go(JSON.stringify({ topic: "gaming", pad: "é".repeat(1100) }));
      assert.equal(multibyte.status, 413);
    });

    it("an unreadable body is 400 unreadable_body", async () => {
      const stream = new ReadableStream<Uint8Array>({ pull() { throw new Error("boom"); } });
      const request = new Request(`https://blisscco.test${route.url}`, {
        method: "POST",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: stream,
        // @ts-expect-error duplex Node/undici me stream body ke liye chahiye (DOM typings me nahi)
        duplex: "half",
      });
      const res = await route.post(request);
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { error: "invalid_request", reason: "unreadable_body" });
    });
  });

  describe(`${route.name}: success response (sponsored ad, public fields only)`, () => {
    it("exact shape: fill:true, sponsored:true, ad with exactly 5 fields", async () => {
      const res = await go('{"topic":"gaming"}');
      assert.equal(res.status, 200);
      assert.deepEqual(res.json, {
        fill: true,
        sponsored: true,
        ad: {
          id: AD_ID,
          headline: "Level up your game nights",
          body: "Compare gaming laptops built for long sessions.",
          cta_text: "Shop now",
          destination_url: "https://example.com/gaming-laptops",
        },
      });
      assert.deepEqual(sortedKeys(res.json), ["ad", "fill", "sponsored"]);
      assert.deepEqual(sortedKeys((res.json as { ad: object }).ad), [...PUBLIC_AD_FIELDS].sort());
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.match(res.headers.get("content-type") ?? "", /^application\/json/);
    });

    it("exclude_ad_ids is best-effort: another ad is preferred, but with no alternative the same ad may repeat (not a no-fill)", async () => {
      setDb({ load_ad_candidates: { data: [candidateRow(), candidateRow({ creative_id: OTHER_ID })], error: null } });
      const other = await go(`{"topic":"gaming","exclude_ad_ids":["${AD_ID}"]}`);
      assert.equal((other.json as { ad: { id: string } }).ad.id, OTHER_ID);
      setDb();
      const repeat = await go(`{"topic":"gaming","exclude_ad_ids":["${AD_ID}"]}`);
      assert.equal(repeat.status, 200);
      assert.equal((repeat.json as { ad: { id: string } }).ad.id, AD_ID);
    });

    it("cta_text may be null; sponsored is still true", async () => {
      setDb({ load_ad_candidates: { data: [candidateRow({ cta_text: null })], error: null } });
      const res = await go('{"topic":"gaming"}');
      assert.equal(res.status, 200);
      const body = res.json as { sponsored: unknown; ad: { cta_text: unknown } };
      assert.equal(body.ad.cta_text, null);
      assert.equal(body.sponsored, true);
    });

    it("every filled response (all topics and aliases) has sponsored === true", async () => {
      for (const topic of ["gaming", "games", "video_games", "technology", "tech", "travel", "food", "finance"]) {
        setDb({ load_ad_candidates: { data: [candidateRow({ category: ({ games: "gaming", video_games: "gaming", tech: "technology" } as Record<string, string>)[topic] ?? topic })], error: null } });
        const res = await go(JSON.stringify({ topic }));
        assert.equal(res.status, 200, topic);
        const body = res.json as { fill: boolean; sponsored?: unknown };
        assert.equal(body.fill, true, topic);
        assert.strictEqual(body.sponsored, true, topic);
      }
    });

    it("private columns from the database never reach the publisher (budget, advertiser, email, campaign, ids, key)", async () => {
      setDb({
        load_ad_candidates: {
          data: [candidateRow({
            advertiser_email: "owner@advertiser.example", advertiser_name: "Acme Ads Ltd", contact_email: "x@y.example",
            campaign_name: "Secret Q4 push", total_budget: 98765.43, daily_budget: 4321.09, spent_total: 111.5,
            advertiser_id: "55555555-5555-4555-8555-555555555555", api_key: KEY, key_hash: "deadbeef", internal_notes: "do not show",
          })],
          error: null,
        },
      });
      const res = await go('{"topic":"gaming"}');
      assert.equal(res.status, 200);
      for (const needle of ["advertiser", "email", "owner@", "Acme", "Secret Q4", "budget", "98765", "4321", "111.5", "spent",
        "campaign", CAMPAIGN_ID, PUBLISHER_ID, "55555555-5555", KEY, "blc_live_", "deadbeef", "internal_notes", "key_hash", "api_key"]) {
        assert.equal(res.text.includes(needle), false, `leak: ${needle}`);
      }
    });

    it("toPublicAd/buildAdResponse drop any extra property even if one slips into the internal object", () => {
      const dirty = { id: AD_ID, headline: "h", body: "b", ctaText: null, destinationUrl: "https://example.com", advertiserEmail: "a@b.co", budget: 5 };
      const ad = toPublicAd(dirty);
      assert.deepEqual(Object.keys(ad).sort(), [...PUBLIC_AD_FIELDS].sort());
      assert.deepEqual(buildAdResponse(dirty), { fill: true, sponsored: true, ad: { id: AD_ID, headline: "h", body: "b", cta_text: null, destination_url: "https://example.com" } });
    });
  });

  describe(`${route.name}: no-fill is always the same response`, () => {
    const cases: Array<{ name: string; body: string; db?: Record<string, Reply> }> = [
      { name: "unsupported topic", body: '{"topic":"astrology"}' },
      { name: "legacy inactive category", body: '{"topic":"beauty"}' },
      { name: "sensitive topic", body: '{"topic":"health"}' },
      { name: "no eligible candidate", body: '{"topic":"gaming"}', db: { load_ad_candidates: { data: [], error: null } } },
      { name: "wrong category candidates only", body: '{"topic":"gaming"}', db: { load_ad_candidates: { data: [candidateRow({ category: "travel" })], error: null } } },
      { name: "database rejects the serve record", body: '{"topic":"gaming"}', db: { record_ad_serve: { data: { outcome: "rejected" }, error: null } } },
    ];
    for (const c of cases) {
      it(`${c.name}: 200 {"fill":false}, no ad, no sponsored flag, no reason`, async () => {
        setDb(c.db);
        const res = await go(c.body);
        assert.equal(res.status, 200);
        assert.equal(res.text, '{"fill":false}');
        assert.equal(res.headers.get("cache-control"), "no-store");
      });
    }
  });

  describe(`${route.name}: error responses (shape, headers, no leaks)`, () => {
    it("401 unauthorized: missing/malformed key, and a key the database does not know", async () => {
      for (const authorization of ["", "Bearer nope", `Basic ${KEY}`, `Bearer blc_live_${"c".repeat(63)}`]) {
        const res = await go('{"topic":"gaming"}', { authorization });
        assert.equal(res.status, 401, authorization);
        assert.equal(res.text, '{"error":"unauthorized"}');
        assert.equal(res.headers.get("www-authenticate"), 'Bearer realm="blisscco-ads"');
      }
      assert.equal(rpcNames.length, 0);
      setDb({ authorize_publisher_key: { data: { outcome: "unauthorized" }, error: null } });
      const unknown = await go('{"topic":"gaming"}');
      assert.equal(unknown.status, 401);
      assert.equal(unknown.text, '{"error":"unauthorized"}');
      assert.equal(unknown.headers.get("www-authenticate"), 'Bearer realm="blisscco-ads"');
    });

    it("401 comes before body validation (a bad body without a key is still 401, not 400)", async () => {
      const res = await go("{nope", { authorization: "" });
      assert.equal(res.status, 401);
    });

    it("429 rate_limited with Retry-After: 60", async () => {
      setDb({ authorize_publisher_key: { data: { outcome: "rate_limited" }, error: null } });
      const res = await go('{"topic":"gaming"}');
      assert.equal(res.status, 429);
      assert.equal(res.text, '{"error":"rate_limited"}');
      assert.equal(res.headers.get("retry-after"), "60");
      assert.deepEqual(rpcNames, ["authorize_publisher_key"]);
    });

    it("413 and 415 have fixed bodies", async () => {
      const big = await go(JSON.stringify({ topic: "gaming", pad: "x".repeat(3000) }));
      assert.equal(big.status, 413);
      assert.equal(big.text, '{"error":"payload_too_large"}');
      const wrongType = await go('{"topic":"gaming"}', { "content-type": "text/plain" });
      assert.equal(wrongType.status, 415);
      assert.equal(wrongType.text, '{"error":"unsupported_media_type"}');
    });

    it("503 temporary failure: fixed body for every kind of database failure; nothing internal leaks (body, headers, logs)", async () => {
      const failures: Array<[string, Record<string, Reply>]> = [
        ["authorize rpc error", { authorize_publisher_key: { data: null, error: { code: "XX000", message: SECRET_TEXT } } }],
        ["authorize throws", { authorize_publisher_key: () => { throw new Error(SECRET_TEXT); } }],
        ["authorize garbage", { authorize_publisher_key: { data: { outcome: "ok", note: SECRET_TEXT }, error: null } }],
        ["record rpc error", { record_ad_serve: { data: null, error: { code: "57014", message: SECRET_TEXT } } }],
        ["record throws", { record_ad_serve: () => { throw new Error(SECRET_TEXT); } }],
      ];
      for (const [name, db] of failures) {
        logged = [];
        setDb(db);
        const res = await go('{"topic":"gaming"}');
        assert.equal(res.status, 503, name);
        assert.equal(res.text, '{"fill":false,"error":"unavailable"}', name);
        const everything = res.text + JSON.stringify([...res.headers.entries()]);
        assert.ok(!/secret|internal|5432|stack|advertiser\.example|XX000|57014/i.test(everything), `${name}: leak`);
        assert.ok(!logged.join("\n").includes(KEY), `${name}: key logged`);
        assert.ok(!/owner@|5432|secret/i.test(logged.join("\n")), `${name}: message logged`);
      }
    });

    it("a candidate-load failure is a 503 with a fixed body and never returns a database error", async () => {
      setDb({ load_ad_candidates: { data: null, error: { code: "XX000", message: SECRET_TEXT } } });
      const res = await go('{"topic":"gaming"}');
      assert.equal(res.status, 503);
      assert.equal(res.text, '{"fill":false,"error":"unavailable"}');
    });

    it("every JSON response is application/json with Cache-Control: no-store", async () => {
      const scenarios: Array<[string, Record<string, Reply> | undefined, Record<string, string> | undefined]> = [
        ['{"topic":"gaming"}', undefined, undefined],
        ['{"topic":"x"', undefined, undefined],
        ['{"topic":"gaming"}', undefined, { authorization: "" }],
        ['{"topic":"gaming"}', { authorize_publisher_key: { data: { outcome: "rate_limited" }, error: null } }, undefined],
        ['{"topic":"gaming"}', { authorize_publisher_key: { data: null, error: { code: "XX000" } } }, undefined],
        ['{"topic":"gaming"}', undefined, { "content-type": "text/plain" }],
      ];
      for (const [body, db, headers] of scenarios) {
        setDb(db);
        const res = await go(body, headers);
        assert.match(res.headers.get("content-type") ?? "", /^application\/json/);
        assert.equal(res.headers.get("cache-control"), "no-store");
        assert.equal(res.headers.get("access-control-allow-origin"), null, "CORS nahi");
      }
    });
  });
}

describe("contract document (DAY6-ADS-MATCH-CONTRACT.md) matches the real responses", () => {
  const doc = readFileSync(path.join(ROOT, "DAY6-ADS-MATCH-CONTRACT.md"), "utf8");
  const blocks = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]) as unknown);

  const examples: Array<[string, string, Record<string, Reply> | undefined, Record<string, string> | undefined]> = [
    ["success", '{"topic":"gaming"}', undefined, undefined],
    ["no-fill", '{"topic":"gaming"}', { load_ad_candidates: { data: [], error: null } }, undefined],
    ["invalid request", '{"topic":"gaming","prompt":"hello"}', undefined, undefined],
    ["unauthorized", '{"topic":"gaming"}', undefined, { authorization: "" }],
    ["rate limit", '{"topic":"gaming"}', { authorize_publisher_key: { data: { outcome: "rate_limited" }, error: null } }, undefined],
    ["temporary failure", '{"topic":"gaming"}', { authorize_publisher_key: { data: null, error: { code: "XX000" } } }, undefined],
    ["payload too large", JSON.stringify({ topic: "gaming", pad: "x".repeat(3000) }), undefined, undefined],
    ["unsupported media type", '{"topic":"gaming"}', undefined, { "content-type": "text/plain" }],
  ];
  for (const [name, body, db, headers] of examples) {
    it(`the "${name}" example in the document is exactly what the API returns`, async () => {
      setDb(db);
      const res = await call(v1Route.POST, "/api/v1/ads/match", body, headers);
      assert.ok(blocks.some((b) => JSON.stringify(b) === JSON.stringify(res.json)), `${name}: doc me ye JSON nahi mila: ${res.text}`);
    });
  }

  it("the document lists every status code and the version header", () => {
    for (const needle of ["200", "400", "401", "413", "415", "429", "503", "Retry-After", "WWW-Authenticate", "X-Blisscco-Api-Version", "sponsored"]) {
      assert.ok(doc.includes(needle), needle);
    }
  });
});
