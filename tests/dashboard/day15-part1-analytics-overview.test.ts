import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AnalyticsRpcClient } from "@/lib/ads/analytics";
import { aggregateCampaignAnalytics, canViewAdvertiserOverview, loadAdvertiserOverview } from "@/lib/ads/analytics-overview";

// Day 15 Part 1: advertiser analytics overview. Database NAKLI hai (rpc inject hota hai); asli Supabase kabhi nahi chhuta.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

const C1 = "00000000-0000-4000-8000-0000000000c1";
const C2 = "00000000-0000-4000-8000-0000000000c2";
const C3 = "00000000-0000-4000-8000-0000000000c3";

type Reply = { data: unknown; error: { code?: string } | null } | Error;
function stub(reply: Reply): { getClient: () => Promise<AnalyticsRpcClient>; calls: string[]; clientsMade: () => number } {
  const calls: string[] = [];
  let made = 0;
  const client: AnalyticsRpcClient = {
    rpc(fn) {
      calls.push(fn);
      return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
    },
  };
  return {
    calls,
    clientsMade: () => made,
    getClient: async () => {
      made += 1;
      return client;
    },
  };
}
const row = (id: string, impressions: number, clicks: number, ctr: number) => ({ campaign_id: id, impressions, clicks, ctr });

describe("aggregation", () => {
  it("sums impressions and clicks; CTR comes from the totals, not an average of CTRs", () => {
    const t = aggregateCampaignAnalytics([
      { campaignId: C1, impressions: 100, clicks: 10, ctr: 10 },
      { campaignId: C2, impressions: 900, clicks: 0, ctr: 0 },
    ]);
    assert.deepEqual(t, { campaigns: 2, campaignsWithEvents: 2, impressions: 1000, clicks: 10, ctr: 1 });
  });
  it("zero-event campaigns count as campaigns but not as 'with events'", () => {
    const t = aggregateCampaignAnalytics([
      { campaignId: C1, impressions: 0, clicks: 0, ctr: 0 },
      { campaignId: C2, impressions: 50, clicks: 1, ctr: 2 },
    ]);
    assert.equal(t?.campaigns, 2);
    assert.equal(t?.campaignsWithEvents, 1);
  });
  it("all zero events: totals 0 and CTR 0 (no NaN)", () => {
    const t = aggregateCampaignAnalytics([{ campaignId: C1, impressions: 0, clicks: 0, ctr: 0 }]);
    assert.deepEqual(t, { campaigns: 1, campaignsWithEvents: 0, impressions: 0, clicks: 0, ctr: 0 });
  });
  it("total beyond a safe integer returns null instead of a wrong number", () => {
    const big = Number.MAX_SAFE_INTEGER;
    assert.equal(aggregateCampaignAnalytics([{ campaignId: C1, impressions: big, clicks: 0, ctr: 0 }, { campaignId: C2, impressions: 1, clicks: 0, ctr: 0 }]), null);
  });
});

describe("loadAdvertiserOverview: real data", () => {
  it("returns real totals from the rpc rows and calls only get_my_campaign_analytics", async () => {
    const s = stub({ data: [row(C1, 200, 5, 2.5), row(C2, 800, 15, 1.875), row(C3, 0, 0, 0)], error: null });
    const r = await loadAdvertiserOverview("advertiser", s.getClient);
    assert.deepEqual(r, { status: "ok", totals: { campaigns: 3, campaignsWithEvents: 2, impressions: 1000, clicks: 20, ctr: 2 } });
    assert.deepEqual(s.calls, ["get_my_campaign_analytics"]);
  });
  it("campaigns exist but have zero events: ok with real zeros", async () => {
    const s = stub({ data: [row(C1, 0, 0, 0)], error: null });
    const r = await loadAdvertiserOverview("advertiser", s.getClient);
    assert.deepEqual(r, { status: "ok", totals: { campaigns: 1, campaignsWithEvents: 0, impressions: 0, clicks: 0, ctr: 0 } });
  });
});

describe("loadAdvertiserOverview: empty results", () => {
  it("no campaigns => empty (not ok, not error)", async () => {
    const r = await loadAdvertiserOverview("advertiser", stub({ data: [], error: null }).getClient);
    assert.deepEqual(r, { status: "empty" });
  });
});

describe("loadAdvertiserOverview: database errors never become zeros", () => {
  it("rpc error", async () => {
    const r = await loadAdvertiserOverview("advertiser", stub({ data: null, error: { code: "42501" } }).getClient);
    assert.deepEqual(r, { status: "error" });
  });
  it("rpc throws", async () => {
    const r = await loadAdvertiserOverview("advertiser", stub(new Error("network")).getClient);
    assert.deepEqual(r, { status: "error" });
  });
  it("non-array reply", async () => {
    const r = await loadAdvertiserOverview("advertiser", stub({ data: { impressions: 1 }, error: null }).getClient);
    assert.deepEqual(r, { status: "error" });
  });
  it("one bad row spoils the whole result (no partial totals)", async () => {
    const r = await loadAdvertiserOverview("advertiser", stub({ data: [row(C1, 10, 1, 10), row(C2, -5, 0, 0)], error: null }).getClient);
    assert.deepEqual(r, { status: "error" });
  });
  it("CTR that does not match the counts is rejected", async () => {
    const r = await loadAdvertiserOverview("advertiser", stub({ data: [row(C1, 100, 10, 50)], error: null }).getClient);
    assert.deepEqual(r, { status: "error" });
  });
  it("client creation failure", async () => {
    const r = await loadAdvertiserOverview("advertiser", async () => {
      throw new Error("no env");
    });
    assert.deepEqual(r, { status: "error" });
  });
});

describe("role-specific access", () => {
  it("only advertiser may view", () => {
    assert.equal(canViewAdvertiserOverview("advertiser"), true);
    for (const r of ["publisher", "admin", null] as const) assert.equal(canViewAdvertiserOverview(r), false);
  });
  it("publisher / admin / unknown role: unavailable, no client created, no rpc called", async () => {
    for (const role of ["publisher", "admin", null] as const) {
      const s = stub({ data: [row(C1, 5, 1, 20)], error: null });
      const r = await loadAdvertiserOverview(role, s.getClient);
      assert.deepEqual(r, { status: "unavailable" });
      assert.equal(s.clientsMade(), 0);
      assert.deepEqual(s.calls, []);
    }
  });
});

describe("page source contract", () => {
  const page = read("app/dashboard/analytics/page.tsx");
  it("keeps authentication and uses the real data layer", () => {
    assert.match(page, /await requireAccount\(\)/);
    assert.match(page, /loadAdvertiserOverview\(/);
    assert.match(page, /createClient/);
  });
  it("no demo data, no service-role client, no demo badge", () => {
    assert.doesNotMatch(page, /demo-data|(?<!Publisher)AnalyticsView|supabase\/admin|service_role|SERVICE_ROLE/);
    assert.match(page, /demo=\{false\}/);
  });
  it("shows no spend or revenue figures", () => {
    assert.doesNotMatch(page, /formatMoney|formatCurrency|formatUsdUnits/);
  });
  it("overview helper only reads the existing rpc and never touches SQL / admin client", () => {
    const src = read("lib/ads/analytics-overview.ts");
    assert.match(src, /fetchMyCampaignsAnalytics/);
    assert.doesNotMatch(src, /supabase\/admin|service_role|\.from\(|\.insert\(|\.update\(/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Day 15 Part 6: regression. Advertiser overview: duplicate rows, missing data, failures aur doosre account ka data.
// ---------------------------------------------------------------------------------------------------------------------

describe("Day 15 part 6: advertiser overview regression", () => {
  it("the same campaign twice is an error, never double-counted totals", async () => {
    const r = await loadAdvertiserOverview("advertiser", stub({ data: [row(C1, 100, 5, 5), row(C1, 100, 5, 5)], error: null }).getClient);
    assert.deepEqual(r, { status: "error" });
    const r2 = await loadAdvertiserOverview("advertiser", stub({ data: [row(C1, 100, 5, 5), row(C1.toUpperCase(), 100, 5, 5)], error: null }).getClient);
    assert.deepEqual(r2, { status: "error" });
  });
  it("different campaigns with the same numbers are summed once each", async () => {
    const r = await loadAdvertiserOverview("advertiser", stub({ data: [row(C1, 100, 5, 5), row(C2, 100, 5, 5)], error: null }).getClient);
    assert.equal(r.status, "ok");
    if (r.status === "ok") assert.deepEqual(r.totals, { campaigns: 2, campaignsWithEvents: 2, impressions: 200, clicks: 10, ctr: 5 });
  });
  it("every failure kind is an error with no numbers at all (never ok with zeros)", async () => {
    const failures: Reply[] = [
      { data: null, error: { code: "42501" } },
      { data: undefined, error: null },
      { data: {}, error: null },
      { data: "[]", error: null },
      { data: [null], error: null },
      { data: [{ campaign_id: C1 }], error: null }, // counts missing
      { data: [{ impressions: 1, clicks: 0, ctr: 0 }], error: null }, // campaign_id missing
      { data: [row(C1, 10, 1, 10), { ...row(C2, 10, 1, 10), ctr: null }], error: null },
      new Error("socket hang up"),
    ];
    for (const f of failures) {
      const r = await loadAdvertiserOverview("advertiser", stub(f).getClient);
      assert.deepEqual(r, { status: "error" });
      assert.ok(!("totals" in r));
    }
  });
  it("an error is not the empty state and an empty state is not an error", async () => {
    const failed = await loadAdvertiserOverview("advertiser", stub({ data: null, error: { code: "XX000" } }).getClient);
    const empty = await loadAdvertiserOverview("advertiser", stub({ data: [], error: null }).getClient);
    assert.notDeepEqual(failed, empty);
    assert.equal(failed.status, "error");
    assert.equal(empty.status, "empty");
  });
  it("account scoping: the loader sends no ids, so the database (auth.uid()) alone decides whose campaigns come back", async () => {
    const s = stub({ data: [row(C1, 10, 1, 10)], error: null });
    await loadAdvertiserOverview("advertiser", s.getClient);
    assert.deepEqual(s.calls, ["get_my_campaign_analytics"]);
    const lib = read("lib/ads/analytics-overview.ts");
    assert.doesNotMatch(lib, /advertiser_id|advertiserId|user\.id|account\.id|p_advertiser/);
  });
  it("result carries only totals: no campaign ids, no per-campaign rows", async () => {
    const r = await loadAdvertiserOverview("advertiser", stub({ data: [row(C1, 10, 1, 10), row(C2, 20, 2, 10)], error: null }).getClient);
    const json = JSON.stringify(r);
    assert.ok(!json.includes(C1) && !json.includes(C2) && !json.includes("campaign_id"));
  });
  it("page: error and empty branches show no StatCard or figures, and the zeros note is only for real zero counts", () => {
    const page = read("app/dashboard/analytics/page.tsx");
    const start = page.indexOf('overview.status === "error"');
    const end = page.indexOf("const t = overview.totals");
    assert.ok(start > 0 && end > start);
    assert.doesNotMatch(page.slice(start, end), /StatCard|formatNumber|formatCtr|overview\.totals/);
    assert.match(page, /noEvents = t\.campaignsWithEvents === 0/);
    assert.match(page, /\{noEvents && \(/);
  });
  it("page never passes an id, email or account object to the loader and never imports demo data", () => {
    const page = read("app/dashboard/analytics/page.tsx");
    assert.match(page, /loadAdvertiserOverview\(account\.role, \(\) => createClient\(\)\)/);
    assert.doesNotMatch(page, /lib\/demo-data|demo-data/);
  });
});
