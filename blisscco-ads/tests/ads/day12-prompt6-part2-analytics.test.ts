import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  computeCtr,
  fetchCampaignAnalytics,
  fetchMyCampaignsAnalytics,
  fetchPublisherAnalytics,
  parseCampaignAnalyticsRow,
  type AnalyticsRpcClient,
} from "@/lib/ads/analytics";

// Day 12 Prompt 6 Part 2: analytics data layer. Database NAKLI hai (rpc inject hota hai); asli Supabase kabhi nahi chhuta.
// Ownership ka asli test SQL me hai (supabase/sql/day-12-13-campaign-analytics-tests.sql, test project par). Yahan: ganit, shape ki jaanch, error handling, source ki zaroori shartein.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

const CAMP = "00000000-0000-4000-8000-0000000000c1";
const CAMP_2 = "00000000-0000-4000-8000-0000000000c2";

type Call = { fn: string; args?: Record<string, unknown> };
function stub(reply: { data: unknown; error: { code?: string } | null } | Error): { client: AnalyticsRpcClient; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      rpc(fn, args) {
        calls.push({ fn, args });
        if (reply instanceof Error) return Promise.reject(reply);
        return Promise.resolve(reply);
      },
    },
  };
}
const row = (over: Record<string, unknown> = {}) => ({ campaign_id: CAMP, impressions: 200, clicks: 5, ctr: 2.5, ...over });

describe("CTR = clicks / impressions * 100", () => {
  it("normal cases", () => {
    assert.equal(computeCtr(200, 5), 2.5);
    assert.equal(computeCtr(100, 100), 100);
    assert.equal(computeCtr(3, 1), 33.3333);
    assert.equal(computeCtr(1000, 1), 0.1);
  });
  it("zero impressions returns 0 (no division error, no NaN / Infinity)", () => {
    assert.equal(computeCtr(0, 0), 0);
    assert.equal(computeCtr(0, 7), 0);
    assert.ok(Object.is(computeCtr(0, 0), 0));
  });
  it("zero clicks is 0 and bad input never produces NaN / Infinity / negative", () => {
    assert.equal(computeCtr(50, 0), 0);
    for (const [i, c] of [[NaN, 1], [1, NaN], [Infinity, 1], [1, Infinity], [-5, 1], [5, -1]] as const) {
      const v = computeCtr(i, c);
      assert.ok(Number.isFinite(v) && v >= 0, `${i},${c} -> ${v}`);
    }
  });
});

describe("row parsing is strict", () => {
  it("accepts number and string bigints (Postgres can return either)", () => {
    assert.deepEqual(parseCampaignAnalyticsRow(row()), { campaignId: CAMP, impressions: 200, clicks: 5, ctr: 2.5 });
    assert.deepEqual(parseCampaignAnalyticsRow(row({ impressions: "200", clicks: "5", ctr: "2.5000" })), {
      campaignId: CAMP, impressions: 200, clicks: 5, ctr: 2.5,
    });
  });
  it("zero impressions row is valid with ctr 0", () => {
    assert.deepEqual(parseCampaignAnalyticsRow(row({ impressions: 0, clicks: 0, ctr: 0 })), { campaignId: CAMP, impressions: 0, clicks: 0, ctr: 0 });
  });
  it("rejects wrong shapes, negative / fractional / non-numeric counts, bad ids and a CTR that does not match the counts", () => {
    for (const bad of [
      null, "x", [], {},
      row({ campaign_id: "not-a-uuid" }), row({ campaign_id: 5 }),
      row({ impressions: -1 }), row({ clicks: 1.5 }), row({ impressions: "abc" }), row({ clicks: null }), row({ impressions: undefined }),
      row({ ctr: 99 }), row({ ctr: "x" }), row({ ctr: null }),
    ]) {
      assert.equal(parseCampaignAnalyticsRow(bad), null, JSON.stringify(bad));
    }
  });
});

describe("fetchCampaignAnalytics", () => {
  it("returns data and calls only the read function with just the campaign id", async () => {
    const { client, calls } = stub({ data: [row()], error: null });
    const r = await fetchCampaignAnalytics(client, CAMP);
    assert.deepEqual(r, { status: "ok", data: { campaignId: CAMP, impressions: 200, clicks: 5, ctr: 2.5 } });
    assert.deepEqual(calls, [{ fn: "get_my_campaign_analytics", args: { p_campaign_id: CAMP } }]);
  });
  it("no rows (someone else's or unknown campaign) => not_found, same as unknown", async () => {
    assert.deepEqual(await fetchCampaignAnalytics(stub({ data: [], error: null }).client, CAMP), { status: "not_found" });
  });
  it("invalid id => not_found without touching the database", async () => {
    const { client, calls } = stub({ data: [row()], error: null });
    assert.deepEqual(await fetchCampaignAnalytics(client, "nope"), { status: "not_found" });
    assert.equal(calls.length, 0);
  });
  it("database error, thrown error, non-array or malformed data => error (never a fake zero)", async () => {
    for (const reply of [
      { data: null, error: { code: "42501" } },
      new Error("network"),
      { data: { not: "array" }, error: null },
      { data: null, error: null },
      { data: [row({ impressions: "x" })], error: null },
      { data: [row(), row()], error: null },
    ]) {
      assert.deepEqual(await fetchCampaignAnalytics(stub(reply).client, CAMP), { status: "error" });
    }
  });
  it("a row for a DIFFERENT campaign than asked => error (never shown)", async () => {
    assert.deepEqual(await fetchCampaignAnalytics(stub({ data: [row({ campaign_id: CAMP_2 })], error: null }).client, CAMP), { status: "error" });
  });
  it("error log has only function name + code, no ids or row data", async () => {
    const logged: unknown[][] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void logged.push(a);
    try {
      await fetchCampaignAnalytics(stub({ data: null, error: { code: "XX000" } }).client, CAMP);
    } finally {
      console.error = orig;
    }
    assert.equal(logged.length, 1);
    assert.ok(!JSON.stringify(logged).includes(CAMP));
  });
});

describe("fetchMyCampaignsAnalytics", () => {
  it("lists campaigns incl. zero-event ones", async () => {
    const { client, calls } = stub({ data: [row(), row({ campaign_id: CAMP_2, impressions: 0, clicks: 0, ctr: 0 })], error: null });
    const r = await fetchMyCampaignsAnalytics(client);
    assert.equal(r.status, "ok");
    if (r.status === "ok") {
      assert.equal(r.data.length, 2);
      assert.deepEqual(r.data[1], { campaignId: CAMP_2, impressions: 0, clicks: 0, ctr: 0 });
    }
    assert.deepEqual(calls, [{ fn: "get_my_campaign_analytics", args: { p_campaign_id: null } }]);
  });
  it("one bad row => whole result is error (no partial numbers)", async () => {
    assert.deepEqual(await fetchMyCampaignsAnalytics(stub({ data: [row(), row({ clicks: -2 })], error: null }).client), { status: "error" });
  });
  it("empty list is ok (advertiser with no campaigns)", async () => {
    assert.deepEqual(await fetchMyCampaignsAnalytics(stub({ data: [], error: null }).client), { status: "ok", data: [] });
  });
});

describe("fetchPublisherAnalytics: totals only, no campaign identity", () => {
  it("returns totals and drops any extra column (e.g. a campaign_id) from the result", async () => {
    const { client, calls } = stub({ data: [{ impressions: 10, clicks: 1, ctr: 10, campaign_id: CAMP }], error: null });
    const r = await fetchPublisherAnalytics(client);
    assert.deepEqual(r, { status: "ok", data: { impressions: 10, clicks: 1, ctr: 10 } });
    assert.deepEqual(calls, [{ fn: "get_my_publisher_analytics", args: {} }]);
  });
  it("not a publisher (no rows) => not_found; zero traffic => zeros; errors => error", async () => {
    assert.deepEqual(await fetchPublisherAnalytics(stub({ data: [], error: null }).client), { status: "not_found" });
    assert.deepEqual(await fetchPublisherAnalytics(stub({ data: [{ impressions: 0, clicks: 0, ctr: 0 }], error: null }).client), {
      status: "ok", data: { impressions: 0, clicks: 0, ctr: 0 },
    });
    assert.deepEqual(await fetchPublisherAnalytics(stub({ data: null, error: { code: "42501" } }).client), { status: "error" });
  });
});

describe("source guarantees (secrets, scope, SQL shape)", () => {
  const files = ["lib/ads/analytics.ts", "lib/campaigns/analytics-queries.ts"];
  it("analytics code never touches the service-role / admin client or env secrets", () => {
    for (const f of files) {
      const src = read(f);
      assert.ok(!/supabase\/admin|createAdminClient|SERVICE_ROLE|service_role|process\.env/.test(src), f);
    }
  });
  it("server wrapper is server-only, uses the user's session client and role-gates before any query", () => {
    const src = read("lib/campaigns/analytics-queries.ts");
    assert.ok(src.includes('import "server-only"'));
    assert.ok(src.includes("@/lib/supabase/server") && src.includes("getCurrentAccount"));
    assert.ok(!/user_metadata|app_metadata/.test(src));
  });
  it("SQL: read-only, authenticated-only, ownership checked in the database, no new tables / writes / service_role", () => {
    const sql = read("supabase/sql/day-12-12-campaign-analytics.sql").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    assert.ok(!/create\s+table|alter\s+table|create\s+index|create\s+trigger|insert\s+into|update\s+public|delete\s+from|drop\s+/i.test(sql));
    // Day 14 part 2: service_role ko ab revoke list me naam se hata diya jata hai (default privileges se milne wala EXECUTE). Grant kabhi nahi.
    assert.ok(!/grant[^;]*service_role/i.test(sql));
    assert.ok(/revoke all on function public\.get_my_campaign_analytics\(uuid\) from public, anon, service_role;/.test(sql));
    assert.ok(/revoke all on function public\.get_my_publisher_analytics\(\) from public, anon, service_role;/.test(sql));
    assert.equal((sql.match(/security definer/g) ?? []).length, 2);
    assert.equal((sql.match(/set search_path = ''/g) ?? []).length, 2);
    assert.ok(sql.includes("grant execute on function public.get_my_campaign_analytics(uuid) to authenticated"));
    assert.ok(sql.includes("grant execute on function public.get_my_publisher_analytics() to authenticated"));
    assert.ok(/revoke all on function public\.get_my_campaign_analytics\(uuid\) from public, anon/.test(sql));
    assert.ok(/revoke all on function public\.get_my_publisher_analytics\(\) from public, anon/.test(sql));
    assert.ok(sql.includes("private.my_advertiser_id()") && sql.includes("private.is_admin()") && sql.includes("auth.uid()"));
  });
  it("SQL: zero impressions never divides; publisher function returns no campaign column", () => {
    const sql = read("supabase/sql/day-12-12-campaign-analytics.sql");
    assert.equal((sql.match(/case when t\.impressions = 0 then 0::numeric/g) ?? []).length, 2);
    const pub = sql.slice(sql.indexOf("get_my_publisher_analytics()\nreturns table"), sql.indexOf("revoke all on function public.get_my_publisher_analytics"));
    assert.ok(/returns table \(impressions bigint, clicks bigint, ctr numeric\)/.test(pub));
    assert.ok(!/campaign_id uuid/.test(pub));
  });
});
