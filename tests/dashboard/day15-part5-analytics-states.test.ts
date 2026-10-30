import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { AnalyticsRpcClient } from "@/lib/ads/analytics";
import { loadAdvertiserOverview } from "@/lib/ads/analytics-overview";
import { loadPublisherOverview } from "@/lib/ads/publisher-overview";
import { loadCampaignPerformance } from "@/lib/ads/campaign-performance";

// Day 15 Part 5: analytics page ke loading / error / retry / empty states. Database NAKLI hai; asli Supabase kabhi nahi chhuta.
// loading.tsx / error.tsx source se check hote hain (repo ka test setup .tsx compile nahi karta); empty / error logic asli loaders se.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const code = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

type Reply = { data: unknown; error: { code?: string; message?: string } | null } | Error;
function stub(reply: Reply) {
  const client: AnalyticsRpcClient = {
    rpc() {
      return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
    },
  };
  return async () => client;
}

const LOADING = "app/dashboard/analytics/loading.tsx";
const ERROR = "app/dashboard/analytics/error.tsx";

describe("loading state", () => {
  it("loading.tsx exists next to the analytics page", () => {
    assert.ok(existsSync(path.join(ROOT, LOADING)));
    assert.ok(existsSync(path.join(ROOT, "app/dashboard/analytics/page.tsx")));
  });
  const src = read(LOADING);
  it("is announced to assistive tech (role=status, aria-busy, sr-only text)", () => {
    assert.match(src, /role="status"/);
    assert.match(src, /aria-busy="true"/);
    assert.match(src, /aria-label="Loading analytics"/);
    assert.match(src, /sr-only/);
  });
  it("matches the dashboard design: pulse skeleton, 3 stat-card placeholders, responsive grid, same tokens", () => {
    assert.match(src, /animate-pulse/);
    assert.match(src, /grid gap-4 sm:grid-cols-3/);
    assert.equal((src.match(/h-28 rounded-xl border border-line bg-surface/g) ?? []).length, 3);
  });
  it("shows no numbers or data, and is a server component with no data access", () => {
    const c = code(src);
    assert.doesNotMatch(c, /"use client"|supabase|createClient|requireAccount|fetch\(|use(State|Effect)/);
    assert.doesNotMatch(c, />\s*\d[\d,.]*\s*</);
  });
});

describe("error state", () => {
  it("error.tsx exists and is a client component (Next requires it)", () => {
    assert.ok(existsSync(path.join(ROOT, ERROR)));
    assert.match(read(ERROR), /^"use client";/);
  });
  const src = read(ERROR);
  const c = code(src);
  it("shows a safe, generic message in an alert", () => {
    assert.match(c, /<Notice tone="error">/);
    assert.match(c, /could not be loaded/);
    assert.match(c, /made-up zeros/);
  });
  it("never renders the error object, message, digest, stack or any database / SQL wording", () => {
    assert.doesNotMatch(c, /error\.(message|digest|stack|name|cause)|\{\s*error\s*\}|JSON\.stringify|String\(error\)|console\./);
    assert.match(c, /\{ reset \}: \{ error:/); // error prop sirf type me hai, destructure nahi hota
    assert.doesNotMatch(c, /sql|postgres|supabase|rpc|relation|column|constraint|PGRST|stack trace/i);
  });
  it("is safe against leaky errors: the file has no way to print them", () => {
    const leaky = new Error('relation "ad_events" does not exist; select * from ledger where key=sk_live_123');
    for (const secret of [leaky.message, "ad_events", "sk_live_123", "select *"]) assert.ok(!c.includes(secret), secret);
  });
  it("has no data access or secrets", () => {
    assert.doesNotMatch(c, /createClient|supabase|service_role|SERVICE_ROLE|process\.env|requireAccount/);
  });
});

describe("retry action", () => {
  const c = code(read(ERROR));
  it("Try again is a real button wired to reset()", () => {
    assert.match(c, /onClick=\{\(\) => reset\(\)\}[^>]*>\s*Try again/);
  });
  it("reset is accepted from props and called exactly once per click", () => {
    assert.match(c, /\(\{ reset \}/);
    assert.equal((c.match(/reset\(\)/g) ?? []).length, 1);
  });
  it("Button renders a <button type=button> with a 44px touch target; there is also a safe way back", () => {
    const btn = read("components/ui/Button.tsx");
    assert.match(btn, /<button type="button"/);
    assert.match(btn, /min-h-11/);
    assert.match(c, /href="\/dashboard"/);
  });
  it("after a failed load, a retry (re-run) can succeed: loaders keep no stale state", async () => {
    let fail = true;
    const client: AnalyticsRpcClient = {
      rpc() {
        return fail
          ? Promise.resolve({ data: null, error: { code: "XX000", message: "relation \"secret_table\" does not exist" } })
          : Promise.resolve({ data: [{ impressions: 10, clicks: 1, ctr: 10 }], error: null });
      },
    };
    const getClient = async () => client;
    const first = await loadPublisherOverview("publisher", getClient);
    assert.deepEqual(first, { status: "error" });
    assert.ok(!JSON.stringify(first).includes("secret_table"));
    fail = false;
    const second = await loadPublisherOverview("publisher", getClient);
    assert.deepEqual(second, { status: "ok", impressions: 10, clicks: 1, ctr: 10, hasEvents: true });
  });
});

describe("failure handling in the live loaders", () => {
  it("advertiser: database error and thrown error => error status, no raw message", async () => {
    for (const reply of [
      { data: null, error: { code: "42P01", message: 'relation "ad_events" does not exist' } },
      new Error("connection to 10.0.0.5:5432 refused"),
    ] as Reply[]) {
      const r = await loadAdvertiserOverview("advertiser", stub(reply));
      assert.deepEqual(r, { status: "error" });
      assert.ok(!/ad_events|10\.0\.0\.5|relation|refused/.test(JSON.stringify(r)));
    }
  });
  it("publisher: database error and thrown error => error status, no raw message", async () => {
    for (const reply of [
      { data: null, error: { code: "42501", message: "permission denied for table publishers" } },
      new Error("timeout while reading ledger"),
    ] as Reply[]) {
      const r = await loadPublisherOverview("publisher", stub(reply));
      assert.deepEqual(r, { status: "error" });
      assert.ok(!/publishers|ledger|permission|timeout/.test(JSON.stringify(r)));
    }
  });
  it("client creation failure => error status, not a crash and not zeros", async () => {
    const r = await loadAdvertiserOverview("advertiser", async () => {
      throw new Error("missing SUPABASE_URL");
    });
    assert.deepEqual(r, { status: "error" });
  });
  it("wrong role never reaches the database (auth boundary)", async () => {
    let made = 0;
    const getClient = async () => {
      made += 1;
      return stub({ data: [], error: null }) as unknown as AnalyticsRpcClient;
    };
    assert.deepEqual(await loadAdvertiserOverview("publisher", getClient), { status: "unavailable" });
    assert.deepEqual(await loadPublisherOverview("advertiser", getClient), { status: "unavailable" });
    assert.equal(made, 0);
  });
});

describe("empty states", () => {
  it("advertiser with no campaigns => empty, not ok and not error", async () => {
    assert.deepEqual(await loadAdvertiserOverview("advertiser", stub({ data: [], error: null })), { status: "empty" });
  });
  it("advertiser with campaigns but no events => ok with real zeros and campaignsWithEvents 0", async () => {
    const r = await loadAdvertiserOverview(
      "advertiser",
      stub({ data: [{ campaign_id: "00000000-0000-4000-8000-0000000000c1", impressions: 0, clicks: 0, ctr: 0 }], error: null }),
    );
    assert.equal(r.status, "ok");
    if (r.status === "ok") assert.deepEqual(r.totals, { campaigns: 1, campaignsWithEvents: 0, impressions: 0, clicks: 0, ctr: 0 });
  });
  it("publisher with zero events => ok with hasEvents false; no publisher row => not_found", async () => {
    assert.deepEqual(await loadPublisherOverview("publisher", stub({ data: [{ impressions: 0, clicks: 0, ctr: 0 }], error: null })), {
      status: "ok",
      impressions: 0,
      clicks: 0,
      ctr: 0,
      hasEvents: false,
    });
    assert.deepEqual(await loadPublisherOverview("publisher", stub({ data: [], error: null })), { status: "not_found" });
  });
  it("page and view have distinct empty / zero-event / error messages, and the CTR shows a dash when there are no impressions", () => {
    const page = read("app/dashboard/analytics/page.tsx");
    const view = read("components/dashboard/PublisherAnalyticsView.tsx");
    assert.match(page, /No campaigns yet/);
    assert.match(page, /The zeros below are real counts/);
    assert.match(view, /The zeros below are real counts/);
    assert.match(view, /Set up your platform first/);
    for (const src of [page, view]) assert.match(src, /impressions > 0 \? formatCtr/);
    for (const src of [page, view]) assert.match(src, /made-up zeros/);
  });
});

describe("live analytics stays honest and protected", () => {
  const page = read("app/dashboard/analytics/page.tsx");
  const view = read("components/dashboard/PublisherAnalyticsView.tsx");
  it("no demo-data messaging or demo component in anything the live page uses", () => {
    for (const src of [page, view, read(LOADING), read(ERROR)]) {
      assert.doesNotMatch(code(src), /demo-data|(?<!Publisher)AnalyticsView|demo=\{true\}|Demo data|demo data/);
    }
  });
  it("authentication boundary unchanged: requireAccount first, loaders get the caller's session client, no admin client", () => {
    assert.ok(page.indexOf("await requireAccount()") > 0);
    assert.match(page, /createClient\(\)/);
    assert.doesNotMatch(page, /supabase\/admin|service_role|SERVICE_ROLE/);
    assert.ok(existsSync(path.join(ROOT, "middleware.ts")));
  });
  it("no new charting dependency", () => {
    const pkg = JSON.parse(read("package.json")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    assert.deepEqual(deps.filter((d) => /chart|d3|recharts|victory|nivo|plotly|echarts|apexcharts|visx/i.test(d)), []);
    for (const f of [LOADING, ERROR]) assert.doesNotMatch(read(f), /from "(chart|recharts|d3|victory|@nivo|plotly|echarts|apexcharts)/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Day 15 Part 6: regression across all live analytics screens (advertiser, campaign, publisher).
// ---------------------------------------------------------------------------------------------------------------------

describe("Day 15 part 6: live analytics never uses demo data and never leaks other accounts", () => {
  const LIVE_FILES = [
    "app/dashboard/analytics/page.tsx",
    "app/dashboard/analytics/loading.tsx",
    "app/dashboard/analytics/error.tsx",
    "components/dashboard/PublisherAnalyticsView.tsx",
    "components/dashboard/CampaignPerformancePanel.tsx",
    "components/dashboard/StatCard.tsx",
    "components/dashboard/Panel.tsx",
    "lib/ads/analytics.ts",
    "lib/ads/analytics-overview.ts",
    "lib/ads/publisher-overview.ts",
    "lib/ads/campaign-performance.ts",
  ];
  it("no live analytics file imports demo data, the demo AnalyticsView or a demo badge", () => {
    for (const f of LIVE_FILES) {
      const c = code(read(f));
      assert.doesNotMatch(c, /demo-data|(?<!Publisher)AnalyticsView|demo=\{true\}|Demo data|"Demo |Demo impressions|Demo clicks/, f);
    }
  });
  it("the demo AnalyticsView component is imported by no page or component (so it can never show as real metrics)", () => {
    const pages = [
      "app/dashboard/analytics/page.tsx",
      "app/dashboard/page.tsx",
      "app/dashboard/publisher/page.tsx",
      "app/dashboard/advertiser/page.tsx",
      "app/dashboard/advertiser/campaigns/[id]/page.tsx",
      "components/dashboard/PublisherAnalyticsView.tsx",
      "components/dashboard/CampaignPerformancePanel.tsx",
    ];
    for (const f of pages) assert.doesNotMatch(code(read(f)), /components\/dashboard\/AnalyticsView"|from "\.\/AnalyticsView"/, f);
  });
  it("live files never use the service-role / admin client or raw table queries (ownership stays in the database)", () => {
    for (const f of LIVE_FILES) assert.doesNotMatch(code(read(f)), /supabase\/admin|service_role|SERVICE_ROLE|\.from\(|\.insert\(|\.update\(|\.delete\(/, f);
  });
  it("all three live screens render nothing numeric in their failure branches", () => {
    const panel = read("components/dashboard/CampaignPerformancePanel.tsx");
    const view = read("components/dashboard/PublisherAnalyticsView.tsx");
    const page = read("app/dashboard/analytics/page.tsx");
    const cut = (src: string, from: string, to: string) => src.slice(src.indexOf(from), src.indexOf(to));
    for (const branch of [
      cut(panel, 'status === "error"', 'status === "unavailable"'),
      cut(view, 'status === "error"', 'status === "unavailable"'),
      cut(page, 'overview.status === "error"', 'overview.status === "empty"'),
    ]) {
      assert.ok(branch.length > 0);
      assert.doesNotMatch(branch, /StatCard|formatNumber|formatCtr|impressions|clicks|totals/);
    }
  });
  it("all three loaders turn the same database failure into 'error' and none reports ok", async () => {
    const failing = stub({ data: null, error: { code: "XX000", message: "boom" } });
    assert.deepEqual(await loadAdvertiserOverview("advertiser", failing), { status: "error" });
    assert.deepEqual(await loadPublisherOverview("publisher", failing), { status: "error" });
    assert.deepEqual(await loadCampaignPerformance(failing, "00000000-0000-4000-8000-0000000000a1"), { status: "error" });
  });
});
