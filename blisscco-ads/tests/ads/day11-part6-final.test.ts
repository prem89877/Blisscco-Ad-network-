import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as legacyRoute from "@/app/api/ads/match/route";
import * as v1Route from "@/app/api/v1/ads/match/route";
import { loadAdCandidates } from "@/lib/ads/candidate-loader";
import { selectAd } from "@/lib/ads/selection";
import { FakeAdDb, makeKey } from "./fake-ad-db";

// Day 11 Part 6: poori chain ek saath (route -> auth -> category -> selection -> ranking -> record/budget). Nakli DB; asli Supabase kabhi nahi.
// Scope: sirf SELECT + serve RECORD. Impression/click ginti aur Revive Adserver abhi implement nahi hain (Day 12).

const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
const realError = console.error;
const KEY = makeKey("a");
let db: FakeAdDb;

beforeEach(() => {
  console.error = () => undefined;
  db = new FakeAdDb();
  globals.__TEST_SUPABASE__ = db.client();
});
afterEach(() => {
  console.error = realError;
});

const ROUTES = [
  { name: "legacy", post: legacyRoute.POST },
  { name: "v1", post: v1Route.POST },
];

async function call(post: (r: Request) => Promise<Response>, body: unknown, headers: Record<string, string> = {}) {
  const res = await post(
    new Request("https://example.test/api/ads/match", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, ...headers },
      body: JSON.stringify(body),
    }),
  );
  return { res, json: (await res.json()) as Record<string, unknown> };
}

function setup() {
  const pub = db.addPublisher("active");
  db.addKey(pub.id, KEY);
  return { pub, adv: db.addAdvertiser("active") };
}

/** Chuna hua creative `rejectIds` me ho toh record_ad_serve usi pal "rejected" de (budget/pause race ka nakal); baaki sab asli model par. */
function rejectOnRecord(rejectIds: string[]) {
  const inner = db.client();
  globals.__TEST_SUPABASE__ = {
    rpc: async (name: string, args: Record<string, unknown> = {}) =>
      name === "record_ad_serve" && rejectIds.includes(String(args.p_creative_id))
        ? (db.calls.push({ name, args }), { data: { outcome: "rejected" }, error: null })
        : inner.rpc(name, args),
  };
}

for (const route of ROUTES) {
  describe(`day 11 part 6 | ${route.name} | whole chain works together`, () => {
    it("alias topic + eligible campaign + budget => 1 ad, 1 serve row (canonical category), spend = exactly one unit", async () => {
      const { pub, adv } = setup();
      const ad = db.addAd(adv.id, { category: "gaming", totalBudget: 10 });
      const r = await call(route.post, { topic: "Video_Games".toLowerCase() });
      assert.equal(r.res.status, 200);
      assert.equal(r.json.fill, true);
      assert.equal(db.servesFor(pub.id).length, 1);
      assert.equal(db.serveLog[0].topic, "gaming");
      assert.equal(db.spendOf(ad.campaignId), 0.002);
    });

    it("every 200 ad = exactly one serve row and one unit of spend; every no-fill/error = zero (no duplicate deduction)", async () => {
      const { adv } = setup();
      const ad = db.addAd(adv.id, { category: "gaming", totalBudget: 0.01 }); // 5 serves
      let ads = 0;
      for (let i = 0; i < 12; i++) {
        const r = await call(route.post, { topic: "gaming" });
        if (r.json.fill === true) ads += 1;
      }
      await call(route.post, { topic: "health" });
      await call(route.post, { topic: "gaming", bogus: 1 });
      assert.equal(ads, 5);
      assert.equal(db.serveLog.length, ads);
      assert.equal(db.spendOf(ad.campaignId), Math.round(ads * 0.002 * 1e6) / 1e6);
    });

    it("soft exclude: fresh ad rejected by the DB (race) => the excluded but eligible ad is served, charged ONCE", async () => {
      const { adv } = setup();
      const fresh = db.addAd(adv.id, { category: "gaming", totalBudget: 10 });
      const seen = db.addAd(adv.id, { category: "gaming", totalBudget: 10 });
      rejectOnRecord([fresh.creativeId]);
      const r = await call(route.post, { topic: "gaming", exclude_ad_ids: [seen.creativeId] });
      assert.equal(r.res.status, 200);
      assert.equal((r.json.ad as { id: string }).id, seen.creativeId);
      assert.equal(db.serveLog.length, 1);
      assert.equal(db.spendOf(fresh.campaignId), 0);
      assert.equal(db.spendOf(seen.campaignId), 0.002);
    });

    it("soft exclude keeps preference: with no race the FRESH ad wins and only one record call happens", async () => {
      const { adv } = setup();
      const a = db.addAd(adv.id, { category: "gaming", totalBudget: 10 });
      const b = db.addAd(adv.id, { category: "gaming", totalBudget: 10 });
      const r = await call(route.post, { topic: "gaming", exclude_ad_ids: [a.creativeId] });
      assert.equal((r.json.ad as { id: string }).id, b.creativeId);
      assert.equal(db.rpcCount("record_ad_serve"), 1);
    });

    it("soft exclude never revives an INELIGIBLE ad: excluded + paused => still no-fill when fresh is rejected", async () => {
      const { adv } = setup();
      const fresh = db.addAd(adv.id, { category: "gaming" });
      const seen = db.addAd(adv.id, { category: "gaming", campaignStatus: "paused" });
      rejectOnRecord([fresh.creativeId]);
      const r = await call(route.post, { topic: "gaming", exclude_ad_ids: [seen.creativeId] });
      assert.deepEqual(r.json, { fill: false });
      assert.equal(db.serveLog.length, 0);
    });

    it("soft exclude never charges two ads, and record calls stay capped at 3 even when everything is rejected", async () => {
      const { adv } = setup();
      const ids = [1, 2, 3, 4, 5].map(() => db.addAd(adv.id, { category: "gaming" }).creativeId);
      rejectOnRecord(ids);
      const r = await call(route.post, { topic: "gaming", exclude_ad_ids: [ids[0], ids[1]] });
      assert.deepEqual(r.json, { fill: false });
      assert.equal(db.rpcCount("record_ad_serve"), 3);
      assert.equal(db.serveLog.length, 0);
    });

    it("fallback topic + Day 9 budget: primary exhausted => fallback campaign serves, only the fallback spends", async () => {
      const { adv } = setup();
      const primary = db.addAd(adv.id, { category: "gaming", totalBudget: 0 });
      const backup = db.addAd(adv.id, { category: "travel", totalBudget: 10 });
      const r = await call(route.post, { topic: "gaming", fallback_topics: ["travel"] });
      assert.equal(r.json.fill, true);
      assert.equal(db.spendOf(primary.campaignId), 0);
      assert.equal(db.spendOf(backup.campaignId), 0.002);
      assert.equal(db.serveLog[0].topic, "travel");
    });

    it("unsafe creative (control character) is never served even though the DB model would accept it", async () => {
      const { adv } = setup();
      db.addAd(adv.id, { category: "gaming", headline: "Bad\u0000headline" });
      const r = await call(route.post, { topic: "gaming" });
      assert.deepEqual(r.json, { fill: false });
      assert.equal(db.rpcCount("record_ad_serve"), 0);
    });

    it("contract: success keys, no-fill body and 401 body are unchanged", async () => {
      const { adv } = setup();
      db.addAd(adv.id, { category: "gaming", totalBudget: 10 });
      const ok = await call(route.post, { topic: "gaming" });
      assert.deepEqual(Object.keys(ok.json).sort(), ["ad", "fill", "sponsored"]);
      assert.deepEqual(Object.keys(ok.json.ad as object).sort(), ["body", "cta_text", "destination_url", "headline", "id"]);
      assert.deepEqual((await call(route.post, { topic: "nope" })).json, { fill: false });
      db.revokeKey(KEY);
      const denied = await call(route.post, { topic: "gaming" });
      assert.equal(denied.res.status, 401);
      assert.deepEqual(denied.json, { error: "unauthorized" });
    });
  });
}

describe("day 11 part 6 | selection alone never creates a serve, impression, click or spend", () => {
  it("selecting 100 times through the real loader RPC only reads: no record_ad_serve, no spend, no serve log", async () => {
    const { adv } = setup();
    const ad = db.addAd(adv.id, { category: "gaming", totalBudget: 10 });
    for (let i = 0; i < 100; i++) {
      const o = await selectAd(
        { publisher: { id: db.allPublisherIds()[0], status: "active" }, category: "gaming" },
        { loadCandidates: loadAdCandidates, now: () => new Date("2026-10-27T10:00:00Z"), unitCostUsd: 0.002, spendTracking: "reliable" },
      );
      assert.equal(o.fill, true);
    }
    assert.equal(db.rpcCount("record_ad_serve"), 0);
    assert.equal(db.serveLog.length, 0);
    assert.equal(db.spendOf(ad.campaignId), 0);
    for (const c of db.calls) assert.equal(c.name, "load_ad_candidates");
  });
});
