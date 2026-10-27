import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as v1Route from "@/app/api/v1/ads/match/route";
import * as legacyRoute from "@/app/api/ads/match/route";

// Day 9 Part 4: ad selection must NEVER serve a paused campaign, an unapproved/rejected creative, a campaign outside its
// schedule, or one whose budget is used up. Poore route se saabit hota hai (nakli database, asli kabhi nahi chhuta).
// Database ko JAAN-BOOJH KAR galat rows bhi lautane diye jaate hain: TypeScript layer unhe dobara rokti hai (defense in depth).

const KEY = `blc_live_${"e".repeat(64)}`;
const KEY_HASH = createHash("sha256").update(KEY, "utf8").digest("hex");
const PUBLISHER_ID = "99999999-9999-4999-8999-999999999999";
const AUTH_OK = { outcome: "ok", publisher_id: PUBLISHER_ID, publisher_status: "active", unit_cost_usd: 0.002 };
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CAMP = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TODAY = new Date().toISOString().slice(0, 10);
const addDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

function row(n: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    creative_id: ID(n), headline: `Headline ${n}`, body: `Body ${n}`, cta_text: `CTA ${n}`, destination_url: `https://example.com/${n}`,
    creative_status: "approved", campaign_id: CAMP(n), campaign_status: "active", category: "gaming",
    start_date: addDays(-30), end_date: null, total_budget: 100, daily_budget: null, spent_total: 0, spent_today: 0,
    advertiser_status: "active", advertiser_profile_status: "active", campaign_serves_today: 0, creative_serves_today: 0,
    ...over,
  };
}

// Har galat row ka naam + wajah. Har ek ALAG se test hota hai (sirf wahi row database se aaye, saath me koi sahi row nahi).
const INELIGIBLE: [string, Record<string, unknown>][] = [
  ["campaign paused", { campaign_status: "paused" }],
  ["campaign draft", { campaign_status: "draft" }],
  ["campaign pending_review", { campaign_status: "pending_review" }],
  ["campaign rejected", { campaign_status: "rejected" }],
  ["campaign completed", { campaign_status: "completed" }],
  ["campaign archived", { campaign_status: "archived" }],
  ["creative draft", { creative_status: "draft" }],
  ["creative pending_review (not approved yet)", { creative_status: "pending_review" }],
  ["creative rejected", { creative_status: "rejected" }],
  ["creative paused", { creative_status: "paused" }],
  ["creative archived", { creative_status: "archived" }],
  ["ended yesterday", { end_date: addDays(-1) }],
  ["starts tomorrow", { start_date: addDays(1) }],
  ["total budget fully spent", { total_budget: 10, spent_total: 10 }],
  ["total budget overspent", { total_budget: 10, spent_total: 10.5 }],
  ["less than one serve left in total budget", { total_budget: 10, spent_total: 9.9985 }],
  ["daily budget fully spent", { daily_budget: 5, spent_today: 5 }],
  ["less than one serve left in daily budget", { daily_budget: 5, spent_today: 4.999 }],
  ["advertiser suspended", { advertiser_status: "suspended" }],
  ["advertiser pending", { advertiser_status: "pending" }],
  ["advertiser profile suspended", { advertiser_profile_status: "suspended" }],
  ["wrong category", { category: "travel" }],
];

type Reply = { data: unknown; error: { code?: string; message?: string } | null };
type Call = { name: string; args: Record<string, unknown> };
const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
let calls: Call[] = [];
const realConsoleError = console.error;

function setDb(candidates: unknown[], over: Record<string, Reply> = {}) {
  const replies: Record<string, Reply> = {
    authorize_publisher_key: { data: AUTH_OK, error: null },
    find_idempotent_serve: { data: { outcome: "none" }, error: null },
    load_ad_candidates: { data: candidates, error: null },
    record_ad_serve: { data: { outcome: "ok" }, error: null },
    ...over,
  };
  globals.__TEST_SUPABASE__ = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const reply = replies[name];
      if (!reply) throw new Error(`test: unexpected rpc ${name}`);
      return reply;
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

const names = () => calls.map((c) => c.name);

for (const route of [
  { name: "v1", url: "/api/v1/ads/match", post: (r: Request) => v1Route.POST(r) },
  { name: "legacy", url: "/api/ads/match", post: (r: Request) => legacyRoute.POST(r) },
]) {
  const go = async (body: unknown, headers: Record<string, string> = {}) => {
    const res = await route.post(
      new Request(`https://blisscco.test${route.url}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, ...headers },
        body: JSON.stringify(body),
      }),
    );
    const text = await res.text();
    return { status: res.status, text };
  };

  describe(`day 9 part 4 (${route.name}): ineligible campaigns/creatives never get an ad`, () => {
    for (const [label, over] of INELIGIBLE) {
      it(`no-fill and no charge when the only candidate is: ${label}`, async () => {
        setDb([row(1, over)]);
        const res = await go({ topic: "gaming" });
        assert.equal(res.status, 200);
        assert.equal(res.text, '{"fill":false}');
        assert.equal(names().includes("record_ad_serve"), false, "nothing is recorded or charged");
        assert.equal(res.text.includes("Headline 1"), false);
      });
    }

    it("a mix of every ineligible row plus ONE good row serves exactly the good one", async () => {
      const bad = INELIGIBLE.map(([, over], i) => row(i + 2, over));
      setDb([...bad, row(1)]);
      const res = await go({ topic: "gaming" });
      assert.equal(res.status, 200);
      const json = JSON.parse(res.text) as { fill: boolean; ad: { id: string } };
      assert.equal(json.fill, true);
      assert.equal(json.ad.id, ID(1));
      assert.equal(calls.find((c) => c.name === "record_ad_serve")?.args.p_creative_id, ID(1));
      for (let n = 2; n < bad.length + 2; n++) assert.equal(res.text.includes(ID(n)), false, `ineligible ${n} leaked`);
    });

    it("boundaries still serve: ends today, starts today, exactly enough budget for one more serve", async () => {
      for (const over of [
        { end_date: TODAY },
        { start_date: TODAY },
        { total_budget: 10, spent_total: 9.998 },
        { daily_budget: 5, spent_today: 4.998 },
      ]) {
        calls = [];
        setDb([row(1, over)]);
        const res = await go({ topic: "gaming" });
        assert.equal(JSON.parse(res.text).fill, true, JSON.stringify(over));
      }
    });

    it("an exhausted campaign does not block a healthy one (serves the healthy one)", async () => {
      setDb([row(1, { total_budget: 10, spent_total: 10 }), row(2)]);
      const res = await go({ topic: "gaming" });
      assert.equal((JSON.parse(res.text) as { ad: { id: string } }).ad.id, ID(2));
    });

    it("the database re-check wins: if record_ad_serve says rejected (paused/budget race), the publisher gets no ad", async () => {
      setDb([row(1)], { record_ad_serve: { data: { outcome: "rejected" }, error: null } });
      const res = await go({ topic: "gaming" });
      assert.equal(res.status, 200);
      assert.equal(res.text, '{"fill":false}');
    });

    it("a retry of an already-charged request whose campaign is no longer eligible gets no-fill and no new selection", async () => {
      setDb([row(1)], { find_idempotent_serve: { data: { outcome: "rejected" }, error: null } });
      const res = await go({ topic: "gaming" }, { "Idempotency-Key": "retry-key-0001" });
      assert.equal(res.status, 200);
      assert.equal(res.text, '{"fill":false}');
      assert.equal(names().includes("load_ad_candidates"), false);
      assert.equal(names().includes("record_ad_serve"), false);
    });

    it("responses never reveal why there was no ad (no status/budget/campaign words)", async () => {
      for (const [, over] of INELIGIBLE) {
        setDb([row(1, over)]);
        const res = await go({ topic: "gaming" });
        assert.equal(res.text, '{"fill":false}');
      }
      assert.deepEqual(names().filter((n) => n === "authorize_publisher_key").length, INELIGIBLE.length);
    });

    it("the key hash (never the plain key) is what the database sees", async () => {
      setDb([row(1)]);
      await go({ topic: "gaming" });
      assert.deepEqual(calls[0].args, { p_key_hash: KEY_HASH });
      assert.equal(JSON.stringify(calls).includes(KEY), false);
    });
  });
}
