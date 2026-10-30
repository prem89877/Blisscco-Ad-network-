import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AnalyticsRpcClient } from "@/lib/ads/analytics";
import { loadCampaignPerformance, toCampaignPerformance } from "@/lib/ads/campaign-performance";

// Day 15 Part 2: ek campaign ki performance. Database NAKLI hai; asli Supabase kabhi nahi chhuta.
// Asli ownership SQL me hai (day-12-12 / day-12-13); yahan: ownership ka app-side contract, metrics, zero events, missing, failures.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

const MINE = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";

type Reply = { data: unknown; error: { code?: string } | null } | Error;
function stub(reply: Reply) {
  const calls: { fn: string; args?: Record<string, unknown> }[] = [];
  const client: AnalyticsRpcClient = {
    rpc(fn, args) {
      calls.push({ fn, args });
      return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
    },
  };
  return { calls, getClient: async () => client };
}
/** Database jaisa: sirf apne campaign ka row, doosre ke liye 0 rows. */
function ownershipDb(owned: string, row: Record<string, unknown>) {
  const calls: Record<string, unknown>[] = [];
  const client: AnalyticsRpcClient = {
    rpc(_fn, args) {
      calls.push(args ?? {});
      return Promise.resolve({ data: args?.p_campaign_id === owned ? [row] : [], error: null });
    },
  };
  return { calls, getClient: async () => client };
}
const row = (id: string, impressions: number, clicks: number, ctr: number) => ({ campaign_id: id, impressions, clicks, ctr });

describe("valid metrics", () => {
  it("returns this campaign's impressions, clicks and CTR", async () => {
    const s = stub({ data: [row(MINE, 400, 10, 2.5)], error: null });
    const r = await loadCampaignPerformance(s.getClient, MINE);
    assert.deepEqual(r, { status: "ok", impressions: 400, clicks: 10, ctr: 2.5, hasEvents: true });
    assert.deepEqual(s.calls, [{ fn: "get_my_campaign_analytics", args: { p_campaign_id: MINE } }]);
  });
  it("accepts bigint counts as strings", async () => {
    const r = await loadCampaignPerformance(stub({ data: [row(MINE, "1000" as unknown as number, "1" as unknown as number, 0.1)], error: null }).getClient, MINE);
    assert.deepEqual(r, { status: "ok", impressions: 1000, clicks: 1, ctr: 0.1, hasEvents: true });
  });
  it("impressions without clicks still counts as having events", async () => {
    const r = await loadCampaignPerformance(stub({ data: [row(MINE, 50, 0, 0)], error: null }).getClient, MINE);
    assert.deepEqual(r, { status: "ok", impressions: 50, clicks: 0, ctr: 0, hasEvents: true });
  });
});

describe("zero events is not a failure", () => {
  it("0 impressions and 0 clicks => ok with hasEvents false", async () => {
    const r = await loadCampaignPerformance(stub({ data: [row(MINE, 0, 0, 0)], error: null }).getClient, MINE);
    assert.deepEqual(r, { status: "ok", impressions: 0, clicks: 0, ctr: 0, hasEvents: false });
  });
  it("zero events and failed query give different states", async () => {
    const zero = await loadCampaignPerformance(stub({ data: [row(MINE, 0, 0, 0)], error: null }).getClient, MINE);
    const failed = await loadCampaignPerformance(stub({ data: null, error: { code: "XX000" } }).getClient, MINE);
    assert.equal(zero.status, "ok");
    assert.equal(failed.status, "error");
    assert.ok(!("impressions" in failed));
  });
});

describe("ownership and missing campaigns", () => {
  it("own campaign returns metrics", async () => {
    const db = ownershipDb(MINE, row(MINE, 20, 2, 10));
    const r = await loadCampaignPerformance(db.getClient, MINE);
    assert.equal(r.status, "ok");
  });
  it("another advertiser's / unknown campaign: 0 rows => unavailable, no numbers", async () => {
    const db = ownershipDb(MINE, row(MINE, 20, 2, 10));
    const r = await loadCampaignPerformance(db.getClient, OTHER);
    assert.deepEqual(r, { status: "unavailable" });
  });
  it("only the requested campaign id is sent (never null = 'all campaigns')", async () => {
    const db = ownershipDb(MINE, row(MINE, 20, 2, 10));
    await loadCampaignPerformance(db.getClient, MINE);
    assert.deepEqual(db.calls, [{ p_campaign_id: MINE }]);
  });
  it("a row for a DIFFERENT campaign than requested is rejected, never shown", async () => {
    const r = await loadCampaignPerformance(stub({ data: [row(OTHER, 999, 99, 9.9099)], error: null }).getClient, MINE);
    assert.deepEqual(r, { status: "error" });
  });
  it("more than one row is rejected", async () => {
    const r = await loadCampaignPerformance(stub({ data: [row(MINE, 1, 0, 0), row(OTHER, 5, 0, 0)], error: null }).getClient, MINE);
    assert.deepEqual(r, { status: "error" });
  });
  it("malformed id never reaches the database", async () => {
    const s = stub({ data: [], error: null });
    const r = await loadCampaignPerformance(s.getClient, "not-a-uuid");
    assert.deepEqual(r, { status: "unavailable" });
    assert.deepEqual(s.calls, []);
  });
});

describe("failed queries never become zeros", () => {
  it("rpc error", async () => {
    assert.deepEqual(await loadCampaignPerformance(stub({ data: null, error: { code: "42501" } }).getClient, MINE), { status: "error" });
  });
  it("rpc throws", async () => {
    assert.deepEqual(await loadCampaignPerformance(stub(new Error("network")).getClient, MINE), { status: "error" });
  });
  it("client creation throws", async () => {
    const r = await loadCampaignPerformance(async () => {
      throw new Error("no env");
    }, MINE);
    assert.deepEqual(r, { status: "error" });
  });
  it("bad shape / mismatching CTR", async () => {
    assert.deepEqual(await loadCampaignPerformance(stub({ data: { impressions: 1 }, error: null }).getClient, MINE), { status: "error" });
    assert.deepEqual(await loadCampaignPerformance(stub({ data: [row(MINE, 100, 10, 50)], error: null }).getClient, MINE), { status: "error" });
    assert.deepEqual(await loadCampaignPerformance(stub({ data: [row(MINE, -1, 0, 0)], error: null }).getClient, MINE), { status: "error" });
  });
  it("toCampaignPerformance maps each data-layer status", () => {
    assert.equal(toCampaignPerformance({ status: "not_found" }).status, "unavailable");
    assert.equal(toCampaignPerformance({ status: "error" }).status, "error");
  });
});

describe("page and panel source contract", () => {
  const page = read("app/dashboard/advertiser/campaigns/[id]/page.tsx");
  const panel = read("components/dashboard/CampaignPerformancePanel.tsx");

  it("ownership check (loadMyCampaign + notFound) comes before the analytics call", () => {
    const own = page.indexOf("loadMyCampaign(adv.id, id)");
    const notFoundAt = page.indexOf("if (!campaign) notFound()");
    const perf = page.indexOf("loadCampaignPerformance(");
    assert.ok(own > 0 && notFoundAt > own && perf > notFoundAt);
    assert.match(page, /loadCampaignPerformance\(\(\) => createClient\(\), campaign\.id\)/);
  });
  it("still requires the advertiser role and uses no admin / service-role client", () => {
    assert.match(page, /requireRole\(\["advertiser"\]\)/);
    assert.doesNotMatch(page, /supabase\/admin|service_role|SERVICE_ROLE/);
  });
  it("existing edit, pause, resume, review and creative controls are still on the page", () => {
    for (const s of [/RunStateButton[^>]*mode="pause"/, /RunStateButton[^>]*mode="resume"/, /campaigns\/\$\{campaign\.id\}\/edit/, /CreativeForm/, /CreativeActionButton/, /CampaignReviewButton/]) {
      assert.match(page, s);
    }
  });
  it("renders the panel and the old 'not tracked yet' row is gone", () => {
    assert.match(page, /<CampaignPerformancePanel performance=\{performance\} \/>/);
    assert.doesNotMatch(page, /Not tracked yet/);
  });
  it("panel uses the dashboard design system and has distinct error / unavailable / zero-event states", () => {
    assert.match(panel, /from "@\/components\/dashboard\/Panel"/);
    assert.match(panel, /from "@\/components\/dashboard\/StatCard"/);
    assert.match(panel, /status === "error"/);
    assert.match(panel, /status === "unavailable"/);
    assert.match(panel, /hasEvents/);
    assert.match(panel, /could not be loaded/);
    assert.match(panel, /real counts/);
    assert.doesNotMatch(panel, /demo-data|formatMoney|formatCurrency/);
  });
  it("error branch renders no numbers", () => {
    const errBranch = panel.slice(panel.indexOf('status === "error"'), panel.indexOf('status === "unavailable"'));
    assert.doesNotMatch(errBranch, /formatNumber|StatCard|impressions|clicks/);
  });
});
