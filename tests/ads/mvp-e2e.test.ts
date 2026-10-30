import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as legacyRoute from "@/app/api/ads/match/route";
import * as v1Route from "@/app/api/v1/ads/match/route";

// Day 6 (final review): Week 1 MVP ki ek line ko poore route se saabit karta hai:
//   "authorized publisher supported category bheje => SAHI eligible sponsored ad structured JSON me mile."
// Database NAKLI hai (tests/register.cjs) aur jaan-boojh kar GALAT/purani rows bhi lautata hai
// (paused campaign, rejected creative, expired, future, galat category, suspended advertiser/profile),
// taaki dikhe ki TypeScript layer unhe dobara rokti hai (defense in depth). Dono routes par chalta hai.

const KEY = `blc_live_${"d".repeat(64)}`;
const KEY_HASH = createHash("sha256").update(KEY, "utf8").digest("hex");
const PUBLISHER_ID = "99999999-9999-4999-8999-999999999999";
const AUTH_OK = { outcome: "ok", publisher_id: PUBLISHER_ID, publisher_status: "active", unit_cost_usd: 0.002 };

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CAMP = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function row(n: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    creative_id: ID(n), headline: `Headline ${n}`, body: `Body ${n}`, cta_text: `CTA ${n}`, destination_url: `https://example.com/${n}`,
    creative_status: "approved", campaign_id: CAMP(n), campaign_status: "active", category: "gaming",
    start_date: "2020-01-01", end_date: null, total_budget: 100, daily_budget: null, spent_total: 0, spent_today: 0,
    advertiser_status: "active", advertiser_profile_status: "active", campaign_serves_today: 0, creative_serves_today: 0,
    ...over,
  };
}

// Ek sahi (1) aur saat galat rows (2..8).
const GOOD = row(1);
const BAD_ROWS = [
  row(2, { creative_status: "rejected" }),
  row(3, { campaign_status: "paused" }),
  row(4, { category: "travel" }),
  row(5, { end_date: "2020-12-31" }),
  row(6, { start_date: "2999-01-01" }),
  row(7, { advertiser_status: "suspended" }),
  row(8, { advertiser_profile_status: "suspended" }),
];

type Reply = { data: unknown; error: { code?: string; message?: string } | null } | (() => never);
type Call = { name: string; args: Record<string, unknown> };
const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
let calls: Call[] = [];
const realConsoleError = console.error;

function setDb(candidates: unknown[], over: Record<string, Reply> = {}) {
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
  console.error = () => {};
});
afterEach(() => {
  console.error = realConsoleError;
  delete globals.__TEST_SUPABASE__;
});

const ROUTES = [
  { name: "v1", url: "/api/v1/ads/match", post: (r: Request) => v1Route.POST(r) },
  { name: "legacy", url: "/api/ads/match", post: (r: Request) => legacyRoute.POST(r) },
];

function req(url: string, body: unknown, key: string | null = KEY): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key) headers.authorization = `Bearer ${key}`;
  return new Request(`https://blisscco.test${url}`, { method: "POST", headers, body: JSON.stringify(body) });
}

for (const route of ROUTES) {
  const go = async (body: unknown, key: string | null = KEY) => {
    const res = await route.post(req(route.url, body, key));
    const text = await res.text();
    return { status: res.status, text, json: JSON.parse(text) as Record<string, unknown> };
  };
  const names = () => calls.map((c) => c.name);

  describe(`MVP (${route.name}): authorized publisher + supported category => the correct eligible ad`, () => {
    it("serves ONLY the eligible ad even when the database also returns paused/rejected/expired/future/wrong-category/suspended rows", async () => {
      setDb([...BAD_ROWS, GOOD]);
      const res = await go({ topic: "gaming" });
      assert.equal(res.status, 200);
      assert.deepEqual(res.json, {
        fill: true,
        sponsored: true,
        ad: { id: ID(1), headline: "Headline 1", body: "Body 1", cta_text: "CTA 1", destination_url: "https://example.com/1" },
      });
      for (let n = 2; n <= 8; n++) {
        assert.equal(res.text.includes(`Headline ${n}`), false, `ineligible ad ${n} leaked`);
        assert.equal(res.text.includes(ID(n)), false, `ineligible id ${n} leaked`);
      }
    });

    it("database calls: authorize -> load -> record, with the key HASH, the canonical category and the served creative (never a publisher id from the caller)", async () => {
      setDb([...BAD_ROWS, GOOD]);
      await go({ topic: "gaming" });
      assert.deepEqual(names(), ["authorize_publisher_key", "load_ad_candidates", "record_ad_serve"]);
      assert.deepEqual(calls[0].args, { p_key_hash: KEY_HASH });
      assert.equal(calls[1].args.p_category, "gaming");
      assert.match(String(calls[1].args.p_today), /^\d{4}-\d{2}-\d{2}$/);
      assert.deepEqual(calls[2].args, { p_key_hash: KEY_HASH, p_creative_id: ID(1), p_topic: "gaming" });
      assert.equal(JSON.stringify(calls).includes(KEY), false, "plain key database ko kabhi nahi jaati");
      assert.equal(JSON.stringify(calls).includes(PUBLISHER_ID), false, "publisher id database ko wapas nahi bheji jaati");
    });

    it("an alias topic (games) is served as the canonical category (gaming)", async () => {
      setDb([GOOD]);
      const res = await go({ topic: "games" });
      assert.equal((res.json.ad as { id: string }).id, ID(1));
      assert.equal(calls[1].args.p_category, "gaming");
      assert.equal(calls[2].args.p_topic, "gaming");
    });

    it("only ineligible rows => no-fill, and nothing is recorded", async () => {
      setDb(BAD_ROWS);
      const res = await go({ topic: "gaming" });
      assert.equal(res.status, 200);
      assert.equal(res.text, '{"fill":false}');
      assert.deepEqual(names(), ["authorize_publisher_key", "load_ad_candidates"]);
    });

    it("exclude_ad_ids picks the other eligible ad", async () => {
      setDb([row(1), row(9)]);
      const res = await go({ topic: "gaming", exclude_ad_ids: [ID(1)] });
      assert.equal((res.json.ad as { id: string }).id, ID(9));
      assert.equal(calls[2].args.p_creative_id, ID(9));
    });

    it("a sensitive topic never reaches the candidate query", async () => {
      setDb([GOOD]);
      const res = await go({ topic: "health" });
      assert.equal(res.text, '{"fill":false}');
      assert.deepEqual(names(), ["authorize_publisher_key"]);
    });

    it("revoked/unknown key => 401 and no candidate query or serve record", async () => {
      setDb([GOOD], { authorize_publisher_key: { data: { outcome: "unauthorized" }, error: null } });
      const res = await go({ topic: "gaming" });
      assert.equal(res.status, 401);
      assert.equal(res.text, '{"error":"unauthorized"}');
      assert.deepEqual(names(), ["authorize_publisher_key"]);
    });

    it("key revoked between authorize and record => the ad is NOT shown (safe no-fill)", async () => {
      setDb([GOOD], { record_ad_serve: { data: { outcome: "unauthorized" }, error: null } });
      const res = await go({ topic: "gaming" });
      assert.equal(res.status, 200);
      assert.equal(res.text, '{"fill":false}');
    });

    it("rate limited => 429 and no candidate query or serve record", async () => {
      setDb([GOOD], { authorize_publisher_key: { data: { outcome: "rate_limited" }, error: null } });
      const res = await go({ topic: "gaming" });
      assert.equal(res.status, 429);
      assert.deepEqual(names(), ["authorize_publisher_key"]);
    });

    it("serve record fails => 503 and the ad is NOT shown", async () => {
      setDb([GOOD], { record_ad_serve: { data: null, error: { code: "XX000", message: "secret internal detail" } } });
      const res = await go({ topic: "gaming" });
      assert.equal(res.status, 503);
      assert.equal(res.text, '{"fill":false,"error":"unavailable"}');
      assert.equal(res.text.includes("Headline"), false);
    });
  });
}

describe("MVP: both routes return identical bodies for the mixed-candidate scenarios", () => {
  const scenarios: Array<[string, unknown[], unknown]> = [
    ["eligible among ineligible", [...BAD_ROWS, GOOD], { topic: "gaming" }],
    ["alias topic", [GOOD], { topic: "games" }],
    ["only ineligible", BAD_ROWS, { topic: "gaming" }],
    ["excluded alternative", [row(1), row(9)], { topic: "gaming", exclude_ad_ids: [ID(1)] }],
    ["sensitive topic", [GOOD], { topic: "health" }],
  ];
  for (const [name, rows, body] of scenarios) {
    it(name, async () => {
      setDb(rows);
      const a = await v1Route.POST(req("/api/v1/ads/match", body));
      const b = await legacyRoute.POST(req("/api/ads/match", body));
      assert.equal(a.status, b.status);
      assert.equal(await a.text(), await b.text());
    });
  }
});
