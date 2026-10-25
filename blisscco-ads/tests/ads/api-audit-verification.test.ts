import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as legacyRoute from "@/app/api/ads/match/route";
import * as v1Route from "@/app/api/v1/ads/match/route";

// Day 7 (Part 2): audit ke baad POST /api/v1/ads/match aur purane /api/ads/match ki jaanch.
// Sirf wahi tests jo pehle se nahi the (purane tests: v1-route, mvp-e2e, publisher-auth, day7-hardening...).
// Database NAKLI hai (tests/register.cjs): asli Supabase / production data kabhi nahi chhuta.
// Ye file koi code nahi badalti: sirf route ke bahar se dekhti hai ki 8 audit points sach me chalte hain.

const KEY = `blc_live_${"e".repeat(64)}`;
const PUBLISHER_ID = "99999999-9999-4999-8999-999999999999";
const AUTH_OK = { outcome: "ok", publisher_id: PUBLISHER_ID, publisher_status: "active", unit_cost_usd: 0.002 };
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CAMP = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const BODY = '{"topic":"gaming"}';

type Reply = { data: unknown; error: { code?: string; message?: string } | null } | (() => never);
type Call = { name: string; args: Record<string, unknown> };
const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
let calls: Call[] = [];
let logged: string[] = [];
const realConsoleError = console.error;
const realDateNow = Date.now;

function row(n: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    creative_id: ID(n), headline: `Headline ${n}`, body: `Body ${n}`, cta_text: `CTA ${n}`, destination_url: `https://example.com/${n}`,
    creative_status: "approved", campaign_id: CAMP(n), campaign_status: "active", category: "gaming",
    start_date: "2020-01-01", end_date: null, total_budget: 100, daily_budget: null, spent_total: 0, spent_today: 0,
    advertiser_status: "active", advertiser_profile_status: "active", campaign_serves_today: 0, creative_serves_today: 0,
    ...over,
  };
}

function setDb(candidates: unknown = [row(1)], over: Record<string, Reply> = {}) {
  const replies: Record<string, Reply> = {
    authorize_publisher_key: { data: AUTH_OK, error: null },
    load_ad_candidates: { data: candidates, error: null },
    record_ad_serve: { data: { outcome: "ok" }, error: null },
    ...over,
  };
  globals.__TEST_SUPABASE__ = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const reply = replies[name];
      if (!reply) throw new Error(`test: unexpected rpc ${name}`);
      return typeof reply === "function" ? reply() : reply;
    },
  };
}

beforeEach(() => {
  calls = [];
  logged = [];
  console.error = (...args: unknown[]) => {
    logged.push(args.map((a) => String(a)).join(" "));
  };
  setDb();
});
afterEach(() => {
  console.error = realConsoleError;
  Date.now = realDateNow;
  delete globals.__TEST_SUPABASE__;
});

const names = () => calls.map((c) => c.name);

type Opts = { headers?: Record<string, string | null>; key?: string | null };
function req(url: string, body: string, opts: Opts = {}): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.key !== null) headers.authorization = `Bearer ${opts.key ?? KEY}`;
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    if (v === null) delete headers[k];
    else headers[k] = v;
  }
  return new Request(`https://blisscco.test${url}`, { method: "POST", headers, body });
}

const ROUTES = [
  { name: "v1", url: "/api/v1/ads/match", post: (r: Request) => v1Route.POST(r) },
  { name: "legacy", url: "/api/ads/match", post: (r: Request) => legacyRoute.POST(r) },
];

async function snap(res: Response) {
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return { status: res.status, text, json, headers: res.headers };
}

// Har IP sirf ek test me use hota hai: do tests ka IP-guard count mil nahi sakta.
let ipCounter = 0;
const freshIp = () => `198.51.100.${++ipCounter}`;

for (const route of ROUTES) {
  const go = async (body: string, opts: Opts = {}) => snap(await route.post(req(route.url, body, opts)));

  // -------------------------------------------------------------------------
  // 1 + 7. Authorized publisher => ad; sirf public fields + sponsored
  // -------------------------------------------------------------------------
  describe(`[${route.name}] 1+7: authorized publisher gets an ad with only approved public fields`, () => {
    it("200, sponsored:true, exactly 5 ad keys, JSON + no-store; internal DB columns never leak", async () => {
      setDb([
        row(1, {
          advertiser_email: "LEAK_EMAIL@example.com",
          advertiser_name: "LEAK_ADVERTISER",
          publisher_id: "LEAK_PUBLISHER",
          key_hash: "LEAK_HASH",
          internal_note: "LEAK_NOTE",
        }),
      ]);
      const r = await go(BODY);
      assert.equal(r.status, 200);
      assert.deepEqual(Object.keys(r.json ?? {}).sort(), ["ad", "fill", "sponsored"]);
      assert.equal(r.json?.fill, true);
      assert.strictEqual(r.json?.sponsored, true);
      assert.deepEqual(Object.keys((r.json?.ad ?? {}) as object).sort(), [
        "body", "cta_text", "destination_url", "headline", "id",
      ]);
      for (const secret of ["LEAK_", "total_budget", "spent", "campaign", "advertiser", "publisher", KEY, "blc_live"]) {
        assert.ok(!r.text.includes(secret), `response must not contain "${secret}"`);
      }
      assert.match(r.headers.get("content-type") ?? "", /application\/json/);
      assert.equal(r.headers.get("cache-control"), "no-store");
      assert.deepEqual(names(), ["authorize_publisher_key", "load_ad_candidates", "record_ad_serve"]);
    });
  });

  // -------------------------------------------------------------------------
  // 2. No-fill
  // -------------------------------------------------------------------------
  describe(`[${route.name}] 2: documented no-fill`, () => {
    it("valid request, no eligible campaign => exactly {fill:false} (200); nothing is recorded", async () => {
      setDb([]);
      const r = await go(BODY);
      assert.equal(r.status, 200);
      assert.deepEqual(r.json, { fill: false });
      assert.ok(!names().includes("record_ad_serve"));
    });

    it("unsupported / legacy / sensitive categories => same {fill:false}; the candidate query never runs", async () => {
      for (const topic of ["pets", "beauty", "health", "politics"]) {
        calls = [];
        const r = await go(JSON.stringify({ topic }));
        assert.equal(r.status, 200, topic);
        assert.deepEqual(r.json, { fill: false }, topic);
        assert.deepEqual(names(), ["authorize_publisher_key"], topic);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 3. Credentials
  // -------------------------------------------------------------------------
  describe(`[${route.name}] 3: bad credentials are all rejected the same way`, () => {
    const noDbCases: Array<[string, Opts]> = [
      ["missing Authorization header", { key: null }],
      ["empty Authorization header", { headers: { authorization: "" } }],
      ["wrong scheme (Basic)", { headers: { authorization: `Basic ${KEY}` } }],
      ["no scheme", { headers: { authorization: KEY } }],
      ["too-short key", { key: "blc_live_abc" }],
      ["wrong prefix", { key: `blc_test_${"e".repeat(64)}` }],
      ["uppercase hex key", { key: `blc_live_${"E".repeat(64)}` }],
      ["key with a trailing extra token", { headers: { authorization: `Bearer ${KEY} extra` } }],
    ];
    for (const [label, opts] of noDbCases) {
      it(`${label} => 401, WWW-Authenticate, database never called`, async () => {
        const r = await go(BODY, opts);
        assert.equal(r.status, 401);
        assert.deepEqual(r.json, { error: "unauthorized" });
        assert.equal(r.headers.get("www-authenticate"), 'Bearer realm="blisscco-ads"');
        assert.equal(calls.length, 0);
      });
    }

    it("unknown, revoked, expired and suspended-publisher keys look identical (database says unauthorized) and nothing else runs", async () => {
      // Database in sab cases me ek hi jawab deta hai (day-7-1 SQL: key active + expiry + publisher + profile active).
      setDb([row(1)], { authorize_publisher_key: { data: { outcome: "unauthorized" }, error: null } });
      const a = await go(BODY, { key: `blc_live_${"1".repeat(64)}` });
      const b = await go(BODY, { key: `blc_live_${"2".repeat(64)}` });
      assert.equal(a.status, 401);
      assert.equal(a.text, b.text);
      assert.equal(a.text, '{"error":"unauthorized"}');
      assert.deepEqual(names(), ["authorize_publisher_key", "authorize_publisher_key"]);
    });

    it("a database 'ok' with an inactive publisher status is NOT trusted (fail closed)", async () => {
      setDb([row(1)], {
        authorize_publisher_key: { data: { ...AUTH_OK, publisher_status: "suspended" }, error: null },
      });
      const r = await go(BODY);
      assert.notEqual(r.status, 200);
      assert.ok(!r.text.includes("Headline"));
      assert.ok(!names().includes("load_ad_candidates"));
    });
  });

  // -------------------------------------------------------------------------
  // 4. Bad requests
  // -------------------------------------------------------------------------
  describe(`[${route.name}] 4: bad requests are handled safely (database never called)`, () => {
    const bad: Array<[string, string, number, string]> = [
      ["empty body", "", 400, "invalid_json"],
      ["truncated JSON", '{"topic":"gam', 400, "invalid_json"],
      ["not JSON", "hello", 400, "invalid_json"],
      ["JSON null", "null", 400, "invalid_body"],
      ["JSON array", "[]", 400, "invalid_body"],
      ["JSON string", '"gaming"', 400, "invalid_body"],
      ["JSON number", "123", 400, "invalid_body"],
      ["missing topic", "{}", 400, "invalid_topic"],
      ["topic is a number", '{"topic":5}', 400, "invalid_topic"],
      ["topic is an array", '{"topic":["gaming"]}', 400, "invalid_topic"],
      ["uppercase topic", '{"topic":"Gaming"}', 400, "invalid_topic"],
      ["topic with a space", '{"topic":"video games"}', 400, "invalid_topic"],
      ["topic with a newline", '{"topic":"gaming\\n"}', 400, "invalid_topic"],
      ["topic 51 chars", JSON.stringify({ topic: "a".repeat(51) }), 400, "invalid_topic"],
      ["unexpected field: prompt", '{"topic":"gaming","prompt":"hi"}', 400, "unknown_field"],
      ["unexpected field: __proto__", '{"topic":"gaming","__proto__":{"x":1}}', 400, "unknown_field"],
      ["unexpected field: publisher_id", `{"topic":"gaming","publisher_id":"${PUBLISHER_ID}"}`, 400, "unknown_field"],
      ["exclude_ad_ids null", '{"topic":"gaming","exclude_ad_ids":null}', 400, "invalid_exclude_ad_ids"],
      ["exclude_ad_ids a string", '{"topic":"gaming","exclude_ad_ids":"x"}', 400, "invalid_exclude_ad_ids"],
      ["exclude_ad_ids not UUIDs", '{"topic":"gaming","exclude_ad_ids":["nope"]}', 400, "invalid_exclude_ad_ids"],
      ["exclude_ad_ids 21 items", JSON.stringify({ topic: "gaming", exclude_ad_ids: Array(21).fill(ID(1)) }), 400, "invalid_exclude_ad_ids"],
    ];
    for (const [label, body, status, reason] of bad) {
      it(`${label} => ${status} ${reason}`, async () => {
        const r = await go(body);
        assert.equal(r.status, status);
        assert.deepEqual(r.json, { error: "invalid_request", reason });
        assert.equal(calls.length, 0);
      });
    }

    it("oversize is counted in BYTES: 1100 two-byte characters (under 2048 characters) is 413", async () => {
      const body = JSON.stringify({ topic: "gaming", note: "é".repeat(1100) });
      assert.ok(body.length < 2048 && Buffer.byteLength(body) > 2048);
      const r = await go(body);
      assert.equal(r.status, 413);
      assert.deepEqual(r.json, { error: "payload_too_large" });
      assert.equal(calls.length, 0);
    });

    it("a lying Content-Length (negative / not a number / too small) cannot sneak an oversized body in", async () => {
      const big = JSON.stringify({ topic: "gaming", pad: "x".repeat(3000) });
      for (const cl of ["-1", "abc", "10"]) {
        const r = await go(big, { headers: { "content-length": cl } }).catch(() => null);
        // Kuch runtimes mismatched Content-Length par Request hi nahi banne dete: tab bhi kuch serve nahi hota.
        if (r === null) continue;
        assert.equal(r.status, 413, `content-length ${cl}`);
      }
      assert.equal(calls.length, 0);
    });

    it("missing or wrong content-type => 415 (database never called)", async () => {
      for (const ct of [null, "text/plain", "application/x-www-form-urlencoded", "application/jsonp"]) {
        const r = await go(BODY, { headers: { "content-type": ct } });
        assert.equal(r.status, 415, String(ct));
        assert.deepEqual(r.json, { error: "unsupported_media_type" });
      }
      assert.equal(calls.length, 0);
    });

    it("content-type is case-insensitive (APPLICATION/JSON works)", async () => {
      const r = await go(BODY, { headers: { "content-type": "APPLICATION/JSON" } });
      assert.equal(r.status, 200);
    });

    it("none of the error bodies contain the key, a stack trace or a file path", async () => {
      for (const body of ["{nope", '{"topic":"gaming","x":1}', "[]"]) {
        const r = await go(body);
        assert.ok(!r.text.includes(KEY));
        assert.ok(!/\bat\s+\S+\s+\(|node_modules|\.ts:|\.js:/.test(r.text));
      }
    });
  });

  // -------------------------------------------------------------------------
  // 5. Ineligible campaigns (har reason AKELA, poore route se)
  // -------------------------------------------------------------------------
  describe(`[${route.name}] 5: ineligible campaigns are excluded (one reason at a time)`, () => {
    const ineligible: Array<[string, Record<string, unknown>]> = [
      ["creative draft", { creative_status: "draft" }],
      ["creative pending_review", { creative_status: "pending_review" }],
      ["creative rejected", { creative_status: "rejected" }],
      ["creative paused", { creative_status: "paused" }],
      ["creative archived", { creative_status: "archived" }],
      ["campaign draft", { campaign_status: "draft" }],
      ["campaign pending_review", { campaign_status: "pending_review" }],
      ["campaign paused", { campaign_status: "paused" }],
      ["campaign completed", { campaign_status: "completed" }],
      ["campaign rejected", { campaign_status: "rejected" }],
      ["campaign archived", { campaign_status: "archived" }],
      ["expired (end_date in the past)", { end_date: "2020-02-01" }],
      ["future-dated (start_date tomorrow-ish)", { start_date: "2999-01-01" }],
      ["different category", { category: "travel" }],
      ["advertiser pending", { advertiser_status: "pending" }],
      ["advertiser suspended", { advertiser_status: "suspended" }],
      ["advertiser profile suspended", { advertiser_profile_status: "suspended" }],
      ["total budget used up", { spent_total: 100 }],
      ["daily budget used up", { daily_budget: 1, spent_today: 1 }],
      ["destination is http://", { destination_url: "http://example.com/x" }],
      ["destination is javascript:", { destination_url: "javascript:alert(1)" }],
      ["destination hides the real host after @", { destination_url: "https://trusted.com@evil.example/" }],
      ["empty headline", { headline: "   " }],
      ["headline over 90 chars", { headline: "h".repeat(91) }],
      ["malformed row (bad date)", { start_date: "2020-13-45" }],
    ];
    for (const [label, over] of ineligible) {
      it(`${label} => {fill:false}, no serve record`, async () => {
        setDb([row(1, over)]);
        const r = await go(BODY);
        assert.equal(r.status, 200);
        assert.deepEqual(r.json, { fill: false });
        assert.ok(!names().includes("record_ad_serve"));
      });
    }

    it("a bad row listed FIRST never hides the good one, and only the good one is recorded", async () => {
      setDb([row(2, { campaign_status: "paused" }), row(3, { end_date: "2020-02-01" }), row(1)]);
      const r = await go(BODY);
      assert.equal(r.status, 200);
      assert.equal((r.json?.ad as { id: string }).id, ID(1));
      const rec = calls.filter((c) => c.name === "record_ad_serve");
      assert.equal(rec.length, 1);
      assert.equal(rec[0].args.p_creative_id, ID(1));
    });

    it("boundaries: starts today and ends today is still eligible (UTC day, end date inclusive)", async () => {
      const today = new Date().toISOString().slice(0, 10);
      setDb([row(1, { start_date: today, end_date: today })]);
      const r = await go(BODY);
      assert.equal(r.status, 200);
      assert.equal(r.json?.fill, true);
    });

    it("boundaries: budget exactly reachable is eligible, one micro-dollar more is not", async () => {
      // unit cost 0.002 USD; 99.998 + 0.002 == 100 (allowed), 99.9981 + 0.002 > 100 (blocked)
      setDb([row(1, { spent_total: 99.998 })]);
      assert.equal((await go(BODY)).json?.fill, true);
      setDb([row(1, { spent_total: 99.9981 })]);
      assert.deepEqual((await go(BODY)).json, { fill: false });
    });

    it("duplicate rows for one creative are served once", async () => {
      setDb([row(1), row(1)]);
      const r = await go(BODY);
      assert.equal(r.json?.fill, true);
      assert.equal(calls.filter((c) => c.name === "record_ad_serve").length, 1);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Database failures
  // -------------------------------------------------------------------------
  describe(`[${route.name}] 6: database failures return a safe 503`, () => {
    const SECRET = "SECRET_PASSWORD_postgres://user:pw@host";
    const boom = (): never => {
      throw new Error(SECRET);
    };
    const failures: Array<[string, Record<string, Reply>, string[]]> = [
      ["authorize error (statement timeout 57014)", { authorize_publisher_key: { data: null, error: { code: "57014", message: SECRET } } }, ["authorize_publisher_key"]],
      ["authorize throws", { authorize_publisher_key: boom }, ["authorize_publisher_key"]],
      ["authorize returns nothing", { authorize_publisher_key: { data: null, error: null } }, ["authorize_publisher_key"]],
      ["load error", { load_ad_candidates: { data: null, error: { code: "42501", message: SECRET } } }, ["authorize_publisher_key", "load_ad_candidates"]],
      ["load throws", { load_ad_candidates: boom }, ["authorize_publisher_key", "load_ad_candidates"]],
      ["load returns a non-array", { load_ad_candidates: { data: { rows: [] }, error: null } }, ["authorize_publisher_key", "load_ad_candidates"]],
      ["record error", { record_ad_serve: { data: null, error: { code: "XX000", message: SECRET } } }, ["authorize_publisher_key", "load_ad_candidates", "record_ad_serve"]],
      ["record throws", { record_ad_serve: boom }, ["authorize_publisher_key", "load_ad_candidates", "record_ad_serve"]],
      ["record returns an unknown outcome", { record_ad_serve: { data: { outcome: "weird" }, error: null } }, ["authorize_publisher_key", "load_ad_candidates", "record_ad_serve"]],
    ];
    for (const [label, over, expectedCalls] of failures) {
      it(`${label} => 503 {fill:false,error:"unavailable"}, no ad, nothing leaks`, async () => {
        setDb([row(1)], over);
        const r = await go(BODY);
        assert.equal(r.status, 503);
        assert.equal(r.text, '{"fill":false,"error":"unavailable"}');
        assert.equal(r.headers.get("cache-control"), "no-store");
        assert.ok(!r.text.includes("Headline"));
        assert.ok(!r.text.includes("SECRET"));
        assert.deepEqual(names(), expectedCalls);
        assert.ok(!logged.join(" ").includes("SECRET"), "logs must carry only a static label + error code");
      });
    }

    it("the Supabase client cannot be created at all (missing env) => 503", async () => {
      delete globals.__TEST_SUPABASE__;
      const r = await go(BODY);
      assert.equal(r.status, 503);
      assert.equal(r.text, '{"fill":false,"error":"unavailable"}');
    });

    it("an outage (503) is never mistaken for 'no ad' (200)", async () => {
      setDb([], { load_ad_candidates: { data: null, error: { code: "XX000" } } });
      assert.equal((await go(BODY)).status, 503);
      setDb([]);
      assert.equal((await go(BODY)).status, 200);
    });
  });
}

// ---------------------------------------------------------------------------
// 8. Rate limiting (maujooda implementation: database rate limit + galat-key IP guard)
// ---------------------------------------------------------------------------
describe("8: rate limiting works as implemented", () => {
  const post = (route: (typeof ROUTES)[number], ip: string | null, opts: Opts = {}, body = BODY) =>
    route.post(req(route.url, body, { ...opts, headers: { ...(ip ? { "x-forwarded-for": ip } : {}), ...opts.headers } }));
  const BADKEY: Opts = { key: `blc_live_${"0".repeat(64)}` };
  const [V1, LEGACY] = ROUTES;

  it("database rate limit => 429 + Retry-After 60, body exact, no campaign query, no serve record (both routes)", async () => {
    setDb([row(1)], { authorize_publisher_key: { data: { outcome: "rate_limited" }, error: null } });
    for (const route of ROUTES) {
      calls = [];
      const r = await snap(await post(route, null));
      assert.equal(r.status, 429);
      assert.deepEqual(r.json, { error: "rate_limited" });
      assert.equal(r.headers.get("retry-after"), "60");
      assert.deepEqual(names(), ["authorize_publisher_key"]);
    }
  });

  it("database 429s do NOT count towards the wrong-key IP guard", async () => {
    const ip = freshIp();
    setDb([row(1)], { authorize_publisher_key: { data: { outcome: "rate_limited" }, error: null } });
    for (let i = 0; i < 30; i++) assert.equal((await post(V1, ip)).status, 429);
    setDb();
    assert.equal((await post(V1, ip)).status, 200);
  });

  it("IP guard: 20 wrong keys are 401, the 21st is 429; a VALID key from that IP is then blocked without a database call", async () => {
    const ip = freshIp();
    setDb([row(1)], { authorize_publisher_key: { data: { outcome: "unauthorized" }, error: null } });
    for (let i = 1; i <= 20; i++) assert.equal((await post(V1, ip, BADKEY)).status, 401, `attempt ${i}`);
    calls = [];
    setDb();
    const blocked = await snap(await post(V1, ip));
    assert.equal(blocked.status, 429);
    assert.deepEqual(blocked.json, { error: "rate_limited" });
    assert.equal(blocked.headers.get("retry-after"), "60");
    assert.equal(calls.length, 0);
  });

  it("IP guard is one shared wall for /api/v1/ads/match and /api/ads/match", async () => {
    const ip = freshIp();
    setDb([row(1)], { authorize_publisher_key: { data: { outcome: "unauthorized" }, error: null } });
    for (let i = 0; i < 10; i++) await post(V1, ip, BADKEY);
    for (let i = 0; i < 10; i++) await post(LEGACY, ip, BADKEY);
    setDb();
    assert.equal((await post(V1, ip)).status, 429);
    assert.equal((await post(LEGACY, ip)).status, 429);
  });

  it("IP guard: another IP is not affected", async () => {
    const bad = freshIp();
    const other = freshIp();
    setDb([row(1)], { authorize_publisher_key: { data: { outcome: "unauthorized" }, error: null } });
    for (let i = 0; i < 25; i++) await post(V1, bad, BADKEY);
    setDb();
    assert.equal((await post(V1, bad)).status, 429);
    assert.equal((await post(V1, other)).status, 200);
  });

  it("IP guard: successful and invalid-body requests never count as wrong keys", async () => {
    const ip = freshIp();
    for (let i = 0; i < 30; i++) assert.equal((await post(V1, ip)).status, 200);
    for (let i = 0; i < 30; i++) assert.equal((await post(V1, ip, {}, "{nope")).status, 400);
    assert.equal((await post(V1, ip)).status, 200);
  });

  it("IP guard: missing/garbage client IP => guard skipped (never blocks everyone together)", async () => {
    setDb([row(1)], { authorize_publisher_key: { data: { outcome: "unauthorized" }, error: null } });
    for (let i = 0; i < 25; i++) assert.equal((await post(V1, null, BADKEY)).status, 401);
    for (let i = 0; i < 25; i++) assert.equal((await post(V1, "not an ip!", BADKEY)).status, 401);
  });

  it("IP guard: the block ends after the 60 second window", async () => {
    const ip = freshIp();
    const t0 = realDateNow();
    Date.now = () => t0;
    setDb([row(1)], { authorize_publisher_key: { data: { outcome: "unauthorized" }, error: null } });
    for (let i = 0; i < 20; i++) await post(V1, ip, BADKEY);
    setDb();
    assert.equal((await post(V1, ip)).status, 429);
    Date.now = () => t0 + 59_000;
    assert.equal((await post(V1, ip)).status, 429, "still blocked inside the window");
    Date.now = () => t0 + 61_000;
    assert.equal((await post(V1, ip)).status, 200, "allowed again after the window");
  });
});
