import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AnalyticsRpcClient } from "@/lib/ads/analytics";
import { canViewPublisherOverview, loadPublisherOverview } from "@/lib/ads/publisher-overview";

// Day 15 Part 3: publisher analytics. Database NAKLI hai; asli Supabase kabhi nahi chhuta.
// Asli ownership SQL me hai (get_my_publisher_analytics, auth.uid()); yahan: app-side contract, metrics, empty, failures, privacy.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

type Reply = { data: unknown; error: { code?: string } | null } | Error;
function stub(reply: Reply) {
  const calls: { fn: string; args?: Record<string, unknown> }[] = [];
  let made = 0;
  const client: AnalyticsRpcClient = {
    rpc(fn, args) {
      calls.push({ fn, args });
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
const row = (impressions: unknown, clicks: unknown, ctr: unknown, extra: Record<string, unknown> = {}) => ({ impressions, clicks, ctr, ...extra });

describe("valid metric calculations", () => {
  it("returns this publisher's impressions, clicks and CTR from the database row", async () => {
    const s = stub({ data: [row(400, 10, 2.5)], error: null });
    const r = await loadPublisherOverview("publisher", s.getClient);
    assert.deepEqual(r, { status: "ok", impressions: 400, clicks: 10, ctr: 2.5, hasEvents: true });
  });
  it("bigint counts as strings and 4-decimal CTR", async () => {
    const r = await loadPublisherOverview("publisher", stub({ data: [row("3", "1", "33.3333")], error: null }).getClient);
    assert.deepEqual(r, { status: "ok", impressions: 3, clicks: 1, ctr: 33.3333, hasEvents: true });
  });
  it("impressions without clicks: CTR 0 and still has events", async () => {
    const r = await loadPublisherOverview("publisher", stub({ data: [row(50, 0, 0)], error: null }).getClient);
    assert.deepEqual(r, { status: "ok", impressions: 50, clicks: 0, ctr: 0, hasEvents: true });
  });
  it("a CTR that does not match the counts is rejected, never shown", async () => {
    const r = await loadPublisherOverview("publisher", stub({ data: [row(100, 10, 50)], error: null }).getClient);
    assert.deepEqual(r, { status: "error" });
  });
});

describe("empty results", () => {
  it("zero events (the database still returns one row of 0s) => ok with hasEvents false", async () => {
    const r = await loadPublisherOverview("publisher", stub({ data: [row(0, 0, 0)], error: null }).getClient);
    assert.deepEqual(r, { status: "ok", impressions: 0, clicks: 0, ctr: 0, hasEvents: false });
  });
  it("no publisher row for this login (0 rows) => not_found, not zeros", async () => {
    const r = await loadPublisherOverview("publisher", stub({ data: [], error: null }).getClient);
    assert.deepEqual(r, { status: "not_found" });
  });
  it("zero events and not_found are different states", async () => {
    const zero = await loadPublisherOverview("publisher", stub({ data: [row(0, 0, 0)], error: null }).getClient);
    const none = await loadPublisherOverview("publisher", stub({ data: [], error: null }).getClient);
    assert.notEqual(zero.status, none.status);
  });
});

describe("database failures never become zeros", () => {
  it("rpc error", async () => {
    assert.deepEqual(await loadPublisherOverview("publisher", stub({ data: null, error: { code: "42501" } }).getClient), { status: "error" });
  });
  it("rpc throws", async () => {
    assert.deepEqual(await loadPublisherOverview("publisher", stub(new Error("network")).getClient), { status: "error" });
  });
  it("client creation throws", async () => {
    const r = await loadPublisherOverview("publisher", async () => {
      throw new Error("no env");
    });
    assert.deepEqual(r, { status: "error" });
  });
  it("non-array reply, negative count, more than one row", async () => {
    assert.deepEqual(await loadPublisherOverview("publisher", stub({ data: { impressions: 1 }, error: null }).getClient), { status: "error" });
    assert.deepEqual(await loadPublisherOverview("publisher", stub({ data: [row(-1, 0, 0)], error: null }).getClient), { status: "error" });
    assert.deepEqual(await loadPublisherOverview("publisher", stub({ data: [row(1, 0, 0), row(2, 0, 0)], error: null }).getClient), { status: "error" });
  });
});

describe("publisher ownership and role separation", () => {
  it("calls only get_my_publisher_analytics with NO arguments (no publisher id, no campaign id)", async () => {
    const s = stub({ data: [row(5, 1, 20)], error: null });
    await loadPublisherOverview("publisher", s.getClient);
    assert.deepEqual(s.calls, [{ fn: "get_my_publisher_analytics", args: {} }]);
  });
  it("each login gets only its own totals (database decides by session)", async () => {
    const sessions: Record<string, unknown[]> = { pubA: [row(100, 4, 4)], pubB: [row(900, 90, 10)] };
    const clientFor = (who: string) => async (): Promise<AnalyticsRpcClient> => ({ rpc: () => Promise.resolve({ data: sessions[who], error: null }) });
    const a = await loadPublisherOverview("publisher", clientFor("pubA"));
    const b = await loadPublisherOverview("publisher", clientFor("pubB"));
    assert.deepEqual(a, { status: "ok", impressions: 100, clicks: 4, ctr: 4, hasEvents: true });
    assert.deepEqual(b, { status: "ok", impressions: 900, clicks: 90, ctr: 10, hasEvents: true });
  });
  it("only publisher may view; advertiser / admin / unknown role: unavailable, no client, no rpc", async () => {
    assert.equal(canViewPublisherOverview("publisher"), true);
    for (const role of ["advertiser", "admin", null] as const) {
      assert.equal(canViewPublisherOverview(role), false);
      const s = stub({ data: [row(5, 1, 20)], error: null });
      assert.deepEqual(await loadPublisherOverview(role, s.getClient), { status: "unavailable" });
      assert.equal(s.clientsMade(), 0);
      assert.deepEqual(s.calls, []);
    }
  });
});

describe("privacy: no campaign, advertiser, budget or other publisher data", () => {
  it("extra fields in the database row are never copied into the result", async () => {
    const leaky = row(10, 1, 10, {
      campaign_id: "00000000-0000-4000-8000-0000000000c1",
      advertiser_id: "00000000-0000-4000-8000-0000000000a1",
      company_name: "Acme Ads",
      total_budget: 5000,
      publisher_id: "00000000-0000-4000-8000-0000000000b1",
    });
    const r = await loadPublisherOverview("publisher", stub({ data: [leaky], error: null }).getClient);
    assert.deepEqual(Object.keys(r).sort(), ["clicks", "ctr", "hasEvents", "impressions", "status"]);
    const json = JSON.stringify(r);
    for (const bad of ["campaign", "advertiser", "Acme", "budget", "00000000-0000-4000"]) assert.ok(!json.includes(bad), bad);
  });

  const page = read("app/dashboard/analytics/page.tsx");
  const view = read("components/dashboard/PublisherAnalyticsView.tsx");
  const lib = read("lib/ads/publisher-overview.ts");

  it("publisher path never uses campaign analytics, admin client or campaign / advertiser queries", () => {
    for (const [name, src] of [["view", view], ["lib", lib]] as const) {
      assert.doesNotMatch(src, /fetchMyCampaignsAnalytics|fetchCampaignAnalytics|loadAdvertiserOverview|loadCampaignPerformance/, name);
      assert.doesNotMatch(src, /supabase\/admin|service_role|SERVICE_ROLE|\.from\(/, name);
    }
    assert.match(lib, /fetchPublisherAnalytics/);
  });
  it("view and lib code never mention campaigns, advertisers or budgets", () => {
    const code = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    for (const src of [code(view), code(lib)]) assert.doesNotMatch(src, /campaign|advertiser|budget|company/i);
  });
  it("page: publisher branch comes first, after requireAccount, and returns before the advertiser loader runs", () => {
    const auth = page.indexOf("await requireAccount()");
    const branch = page.indexOf('account.role === "publisher"');
    const pubLoad = page.indexOf("loadPublisherOverview(");
    const advLoad = page.indexOf("loadAdvertiserOverview(");
    assert.ok(auth > 0 && branch > auth && pubLoad > branch && advLoad > pubLoad);
    assert.match(page, /<PublisherAnalyticsView overview=\{publisherOverview\} \/>/);
  });
  it("no demo data and no spend / revenue figures", () => {
    for (const src of [page, view]) {
      assert.doesNotMatch(src, /demo-data|(?<!Publisher)AnalyticsView|formatMoney|formatCurrency|formatUsdUnits/);
      assert.doesNotMatch(src, /demo=\{true\}/);
    }
  });
  it("view has distinct error / not-found / zero-event states and the error state renders no numbers", () => {
    assert.match(view, /status === "error"/);
    assert.match(view, /status === "not_found"/);
    assert.match(view, /hasEvents/);
    assert.match(view, /real counts/);
    const errBranch = view.slice(view.indexOf('status === "error"'), view.indexOf('status === "unavailable"'));
    assert.doesNotMatch(errBranch, /formatNumber|StatCard|impressions|clicks/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Day 15 Part 6: regression. Publisher analytics: malformed / duplicate / missing / failed jawab aur doosre publisher ka data.
// ---------------------------------------------------------------------------------------------------------------------

describe("Day 15 part 6: publisher analytics regression", () => {
  it("two total rows (duplicate or from another publisher) are an error, never summed and never first-row-wins", async () => {
    const mine = row(100, 5, 5);
    const r1 = await loadPublisherOverview("publisher", stub({ data: [mine, mine], error: null }).getClient);
    const r2 = await loadPublisherOverview("publisher", stub({ data: [mine, row(9000, 900, 10)], error: null }).getClient);
    assert.deepEqual(r1, { status: "error" });
    assert.deepEqual(r2, { status: "error" });
    assert.ok(!JSON.stringify(r2).includes("9000"));
  });
  it("missing or malformed fields are an error with no numbers", async () => {
    const bad: unknown[] = [
      [{}],
      [{ impressions: 10, clicks: 1 }], // ctr missing
      [{ impressions: 10, ctr: 0 }], // clicks missing
      [{ clicks: 1, ctr: 0 }], // impressions missing
      [{ impressions: null, clicks: null, ctr: null }],
      [row("1e2", 1, 1)],
      [row(10, -1, 0)],
      [row(10, 1.5, 15)],
      [row(10, 1, "NaN")],
      [null],
      "totals",
      {},
      undefined,
    ];
    for (const data of bad) {
      const r = await loadPublisherOverview("publisher", stub({ data, error: null }).getClient);
      assert.deepEqual(r, { status: "error" }, JSON.stringify(data));
    }
  });
  it("every failed query is an error with no numbers (never ok zeros, never not_found)", async () => {
    const failures: Reply[] = [{ data: null, error: { code: "42501" } }, { data: [row(10, 1, 10)], error: { code: "XX000" } }, new Error("ECONNRESET")];
    for (const f of failures) {
      const r = await loadPublisherOverview("publisher", stub(f).getClient);
      assert.deepEqual(r, { status: "error" });
    }
    const failedClient = await loadPublisherOverview("publisher", async () => {
      throw new Error("no session");
    });
    assert.deepEqual(failedClient, { status: "error" });
  });
  it("zero traffic, no publisher row and failure are three different results", async () => {
    const zero = await loadPublisherOverview("publisher", stub({ data: [row(0, 0, 0)], error: null }).getClient);
    const none = await loadPublisherOverview("publisher", stub({ data: [], error: null }).getClient);
    const failed = await loadPublisherOverview("publisher", stub({ data: null, error: { code: "XX000" } }).getClient);
    assert.deepEqual([zero.status, none.status, failed.status], ["ok", "not_found", "error"]);
  });
  it("account scoping: no id is sent, and advertiser / admin / unknown roles never reach the database", async () => {
    const s = stub({ data: [row(10, 1, 10)], error: null });
    await loadPublisherOverview("publisher", s.getClient);
    assert.deepEqual(s.calls, [{ fn: "get_my_publisher_analytics", args: {} }]);
    for (const role of ["advertiser", "admin", null] as const) {
      const t = stub({ data: [row(10, 1, 10)], error: null });
      assert.deepEqual(await loadPublisherOverview(role, t.getClient), { status: "unavailable" });
      assert.equal(t.clientsMade(), 0);
      assert.equal(t.calls.length, 0);
    }
  });
  it("page: publisher branch passes only the role and a session client, never an id, and imports no demo data", () => {
    const pageSrc = read("app/dashboard/analytics/page.tsx");
    assert.match(pageSrc, /loadPublisherOverview\(account\.role, \(\) => createClient\(\)\)/);
    assert.doesNotMatch(pageSrc, /lib\/demo-data|demo-data/);
    assert.doesNotMatch(read("components/dashboard/PublisherAnalyticsView.tsx"), /lib\/demo-data|demo-data/);
  });
});
