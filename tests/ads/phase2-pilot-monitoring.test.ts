import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { handleMatchPost } from "@/lib/ads/match-handler";
import { createIpGuard } from "@/lib/ads/ip-guard";
import {
  MATCH_OUTCOMES,
  buildMonitoringView,
  canViewPilotMonitoring,
  isPilotMetricsEnabled,
  loadPilotMonitoring,
  normalizeLatencyMs,
  outcomeFromResponse,
  parseMonitoringSummaryRow,
  reportMatchMetric,
  type MatchOutcome,
  type MetricSink,
} from "@/lib/ads/pilot-monitoring";
import type { AnalyticsRpcClient } from "@/lib/ads/analytics";

// Phase 3 Step 4: pilot monitoring. Bina asli database / network ke: nakli sink, nakli supabase client (globalThis.__TEST_SUPABASE__), nakli rpc client.
// Billing / ledger code ko ye test chhuta nahi; sirf padhta hai (source text) ki wo nahi badla.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

const KEY = "blc_live_" + "0123456789abcdef".repeat(4);
const HASH_OF_NOTHING = "unused";
void HASH_OF_NOTHING;

type Recorded = { outcome: MatchOutcome; latencyMs: number };

/** Sink jo har call ko list me rakhta hai. */
function recordingSink(): { sink: MetricSink; calls: Recorded[] } {
  const calls: Recorded[] = [];
  return { calls, sink: (outcome, latencyMs) => void calls.push({ outcome, latencyMs }) };
}

/** Defer jo task turant chalata hai aur uska result wapas deta hai (tests me await kar sakein). */
function immediateDefer(): { defer: (task: () => Promise<void>) => void; done: () => Promise<void> } {
  const pending: Promise<void>[] = [];
  return { defer: (task) => void pending.push(task()), done: async () => void (await Promise.all(pending)) };
}

function matchRequest(headers: Record<string, string> = {}, body: unknown = { topic: "gaming" }): Request {
  return new Request("https://example.test/api/v1/ads/match", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, ...headers },
    body: JSON.stringify(body),
  });
}

/**
 * Nakli supabase: authorize + candidates + record ka jawab test se tay hota hai. Sirf wahi rpc jo match flow chalata hai.
 * mode: "fill" | "no_fill" | "db_down" | "unauthorized"
 */
function installFakeDb(mode: "fill" | "no_fill" | "db_down" | "unauthorized"): { rpcCalls: string[] } {
  const rpcCalls: string[] = [];
  const publisherId = "11111111-1111-4111-8111-111111111111";
  const creativeId = "22222222-2222-4222-8222-222222222222";
  const campaignId = "33333333-3333-4333-8333-333333333333";
  (globalThis as { __TEST_SUPABASE__?: unknown }).__TEST_SUPABASE__ = {
    async rpc(fn: string) {
      rpcCalls.push(fn);
      if (mode === "db_down") return { data: null, error: { code: "08006" } };
      if (fn === "authorize_publisher_key") {
        if (mode === "unauthorized") return { data: { outcome: "unauthorized" }, error: null };
        return { data: { outcome: "ok", publisher_id: publisherId, publisher_status: "active", unit_cost_usd: 0.002 }, error: null };
      }
      if (fn === "load_ad_candidates") {
        if (mode === "no_fill") return { data: [], error: null };
        return {
          data: [
            {
              creative_id: creativeId,
              campaign_id: campaignId,
              headline: "Level up",
              body: "A game ad",
              cta_text: "Play",
              destination_url: "https://example.com/play",
              category: "gaming",
              campaign_status: "active",
              advertiser_status: "active",
              advertiser_profile_status: "active",
              creative_status: "approved",
              start_date: "2000-01-01",
              end_date: null,
              total_budget: "100.0000",
              daily_budget: "10.0000",
              spent_total: "0",
              spent_today: "0",
              creative_serves_today: 0,
              campaign_serves_today: 0,
            },
          ],
          error: null,
        };
      }
      if (fn === "record_ad_serve") return { data: { outcome: "ok" }, error: null };
      return { data: null, error: { code: "42883" } };
    },
  };
  return { rpcCalls };
}

afterEach(() => {
  delete (globalThis as { __TEST_SUPABASE__?: unknown }).__TEST_SUPABASE__;
});

describe("phase 3 step 4: outcome classification", () => {
  it("maps every response the match endpoint can send to exactly one outcome", () => {
    assert.equal(outcomeFromResponse(200, { fill: true, ad: {} }), "fill");
    assert.equal(outcomeFromResponse(200, { fill: false }), "no_fill");
    assert.equal(outcomeFromResponse(401, { error: "unauthorized" }), "unauthorized");
    assert.equal(outcomeFromResponse(429, { error: "rate_limited" }), "rate_limited");
    for (const s of [400, 413, 415]) assert.equal(outcomeFromResponse(s, { error: "x" }), "invalid_request", String(s));
    assert.equal(outcomeFromResponse(503, { fill: false, error: "unavailable" }), "unavailable");
    assert.equal(outcomeFromResponse(500, null), "unavailable");
  });

  it("an unknown status records nothing instead of a wrong label", () => {
    assert.equal(outcomeFromResponse(302, {}), null);
    assert.equal(outcomeFromResponse(404, {}), null);
  });

  it("the outcome list matches the database CHECK list", () => {
    const sql = read("supabase/sql/phase3-step4-1-pilot-request-metrics.sql");
    const check = /outcome in \(([^)]+)\)/.exec(sql);
    assert.ok(check, "outcome CHECK missing");
    const listed = [...check[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual(listed, [...MATCH_OUTCOMES].sort());
  });

  it("latency is sanitised: negative, NaN and Infinity are dropped, huge values are capped", () => {
    assert.equal(normalizeLatencyMs(-1), null);
    assert.equal(normalizeLatencyMs(Number.NaN), null);
    assert.equal(normalizeLatencyMs(Number.POSITIVE_INFINITY), null);
    assert.equal(normalizeLatencyMs(12.6), 13);
    assert.equal(normalizeLatencyMs(9_999_999_999), 3_600_000);
  });

  it("recording is off unless the flag is exactly \"1\"", () => {
    assert.equal(isPilotMetricsEnabled({}), false);
    for (const v of ["", "0", "true", "yes", " 1", "1 ", "TRUE"]) assert.equal(isPilotMetricsEnabled({ PILOT_METRICS_ENABLED: v }), false, JSON.stringify(v));
    assert.equal(isPilotMetricsEnabled({ PILOT_METRICS_ENABLED: "1" }), true);
  });
});

describe("phase 3 step 4: monitoring records valid events correctly", () => {
  it("a fill is recorded once with a non-negative latency", async () => {
    installFakeDb("fill");
    const { sink, calls } = recordingSink();
    const d = immediateDefer();
    const res = await handleMatchPost(matchRequest(), { metricSink: sink, defer: d.defer, ipGuard: createIpGuard() });
    await d.done();
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json() as { fill: boolean }).fill, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].outcome, "fill");
    assert.ok(Number.isInteger(calls[0].latencyMs) && calls[0].latencyMs >= 0);
  });

  it("a no-fill (200, fill:false) is recorded as no_fill, not as an error", async () => {
    installFakeDb("no_fill");
    const { sink, calls } = recordingSink();
    const d = immediateDefer();
    const res = await handleMatchPost(matchRequest(), { metricSink: sink, defer: d.defer, ipGuard: createIpGuard() });
    await d.done();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { fill: false });
    assert.deepEqual(calls.map((c) => c.outcome), ["no_fill"]);
  });

  it("a database outage answers 503 and is recorded as unavailable (an API error), not as no_fill", async () => {
    installFakeDb("db_down");
    const { sink, calls } = recordingSink();
    const d = immediateDefer();
    const res = await handleMatchPost(matchRequest(), { metricSink: sink, defer: d.defer, ipGuard: createIpGuard() });
    await d.done();
    assert.equal(res.status, 503);
    assert.deepEqual(calls.map((c) => c.outcome), ["unavailable"]);
  });

  it("wrong key, missing key, bad content type and invalid body are each recorded once with the right outcome", async () => {
    installFakeDb("unauthorized");
    const cases: { name: string; req: Request; status: number; outcome: MatchOutcome }[] = [
      { name: "wrong key", req: matchRequest(), status: 401, outcome: "unauthorized" },
      { name: "missing key", req: new Request("https://example.test/x", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), status: 401, outcome: "unauthorized" },
      { name: "bad content type", req: matchRequest({ "content-type": "text/plain" }), status: 415, outcome: "invalid_request" },
      { name: "invalid body", req: new Request("https://example.test/x", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` }, body: "not json" }), status: 400, outcome: "invalid_request" },
    ];
    for (const c of cases) {
      const { sink, calls } = recordingSink();
      const d = immediateDefer();
      const res = await handleMatchPost(c.req, { metricSink: sink, defer: d.defer, ipGuard: createIpGuard() });
      await d.done();
      assert.equal(res.status, c.status, c.name);
      assert.deepEqual(calls.map((x) => x.outcome), [c.outcome], c.name);
    }
  });

  it("an IP that is already blocked is recorded as rate_limited", async () => {
    installFakeDb("fill");
    const guard = createIpGuard(1);
    const headers = { "x-forwarded-for": "203.0.113.9" };
    guard.recordFailure("203.0.113.9", Date.now());
    const { sink, calls } = recordingSink();
    const d = immediateDefer();
    const res = await handleMatchPost(matchRequest(headers), { metricSink: sink, defer: d.defer, ipGuard: guard });
    await d.done();
    assert.equal(res.status, 429);
    assert.deepEqual(calls.map((c) => c.outcome), ["rate_limited"]);
  });

  it("nothing the publisher sent (key, topic, body) reaches the sink: only an outcome and a number", async () => {
    installFakeDb("fill");
    const seen: unknown[][] = [];
    const d = immediateDefer();
    await handleMatchPost(matchRequest({}, { topic: "gaming", fallback_topics: ["travel"] }), {
      metricSink: (...args) => void seen.push(args),
      defer: d.defer,
      ipGuard: createIpGuard(),
    });
    await d.done();
    assert.equal(seen.length, 1);
    assert.equal(seen[0].length, 2);
    assert.equal(typeof seen[0][0], "string");
    assert.equal(typeof seen[0][1], "number");
    const text = JSON.stringify(seen);
    for (const secret of [KEY, "gaming", "travel", "blc_live_"]) assert.ok(!text.includes(secret), secret);
  });
});

describe("phase 3 step 4: duplicate events do not inflate counts", () => {
  it("one request is one metric, even when the response is built on the failure path", async () => {
    installFakeDb("db_down");
    const { sink, calls } = recordingSink();
    const d = immediateDefer();
    await handleMatchPost(matchRequest(), { metricSink: sink, defer: d.defer, ipGuard: createIpGuard() });
    await d.done();
    assert.equal(calls.length, 1);
  });

  it("the impression and click counts shown come from the database totals as given: the monitoring layer adds nothing", () => {
    const row = {
      req_fill: 5, req_provider_fill: 0, req_no_fill: 1, req_unauthorized: 0, req_rate_limited: 0, req_invalid: 0, req_unavailable: 0,
      latency_samples: 6, latency_total_ms: 600, latency_max_ms: 300,
      serves: 5, impressions: 4, clicks: 2, campaign_spend: "0.0100",
    };
    const summary = parseMonitoringSummaryRow(row);
    assert.ok(summary);
    const view = buildMonitoringView(summary);
    assert.equal(view.impressions, 4);
    assert.equal(view.clicks, 2);
    assert.equal(view.serves, 5);
    assert.deepEqual(view.flags, []);
  });

  it("the database keeps one impression and one click per serve, and a click needs an impression (so the dashboard notes mean a rule was bypassed)", () => {
    const events = read("supabase/sql/day-12-2-ad-events.sql");
    assert.match(events, /ad_events_one_per_type_key/);
    const click = read("supabase/sql/day-12-10-record-ad-click.sql");
    assert.match(click, /event_type = 'impression'/);
  });

  it("a serve counted as an impression more than once, or a click without an impression, raises a consistency note", () => {
    const base = {
      req_fill: 1, req_provider_fill: 0, req_no_fill: 0, req_unauthorized: 0, req_rate_limited: 0, req_invalid: 0, req_unavailable: 0,
      latency_samples: 1, latency_total_ms: 10, latency_max_ms: 10,
      serves: 1, impressions: 1, clicks: 0, campaign_spend: "0.0020",
    };
    const more = buildMonitoringView(parseMonitoringSummaryRow({ ...base, impressions: 2 })!);
    assert.ok(more.flags.includes("impressions_exceed_serves"));
    const clicks = buildMonitoringView(parseMonitoringSummaryRow({ ...base, clicks: 2 })!);
    assert.ok(clicks.flags.includes("clicks_exceed_impressions"));
  });
});

describe("phase 3 step 4: monitoring failure does not block ad serving", () => {
  it("a sink that throws does not change the ad answer", async () => {
    installFakeDb("fill");
    const d = immediateDefer();
    const res = await handleMatchPost(matchRequest(), {
      metricSink: () => {
        throw new Error("monitoring down");
      },
      defer: d.defer,
      ipGuard: createIpGuard(),
    });
    await d.done();
    assert.equal(res.status, 200);
    assert.equal((await res.json() as { fill: boolean }).fill, true);
  });

  it("a sink that rejects asynchronously does not change the ad answer and leaves no unhandled rejection", async () => {
    installFakeDb("fill");
    let unhandled = 0;
    const onUnhandled = () => void (unhandled += 1);
    process.on("unhandledRejection", onUnhandled);
    try {
      const d = immediateDefer();
      const res = await handleMatchPost(matchRequest(), { metricSink: () => Promise.reject(new Error("db down")), defer: d.defer, ipGuard: createIpGuard() });
      await d.done();
      await new Promise((r) => setImmediate(r));
      assert.equal(res.status, 200);
      assert.equal(unhandled, 0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("a defer function that throws does not change the ad answer", async () => {
    installFakeDb("fill");
    const res = await handleMatchPost(matchRequest(), {
      metricSink: () => undefined,
      defer: () => {
        throw new Error("no request scope");
      },
      ipGuard: createIpGuard(),
    });
    assert.equal(res.status, 200);
  });

  it("the response does not wait for a slow sink", async () => {
    installFakeDb("fill");
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let finished = false;
    const slow: MetricSink = async () => {
      await gate;
      finished = true;
    };
    const d = immediateDefer();
    const res = await handleMatchPost(matchRequest(), { metricSink: slow, defer: d.defer, ipGuard: createIpGuard() });
    assert.equal(res.status, 200);
    assert.equal(finished, false, "response returned before the sink finished");
    release();
    await d.done();
    assert.equal(finished, true);
  });

  it("default wiring: with the flag off, no metric rpc is called and the answer is unchanged", async () => {
    const before = process.env.PILOT_METRICS_ENABLED;
    delete process.env.PILOT_METRICS_ENABLED;
    try {
      const { rpcCalls } = installFakeDb("fill");
      const res = await handleMatchPost(matchRequest(), { ipGuard: createIpGuard() });
      await new Promise((r) => setImmediate(r));
      assert.equal(res.status, 200);
      assert.ok(!rpcCalls.includes("record_ad_request_metric"), rpcCalls.join(","));
    } finally {
      if (before !== undefined) process.env.PILOT_METRICS_ENABLED = before;
    }
  });

  it("default wiring: with the flag on, exactly one metric rpc carries only an outcome and a latency", async () => {
    const before = process.env.PILOT_METRICS_ENABLED;
    process.env.PILOT_METRICS_ENABLED = "1";
    try {
      const metricArgs: unknown[] = [];
      installFakeDb("fill");
      const fake = (globalThis as unknown as { __TEST_SUPABASE__: { rpc: (fn: string, args?: unknown) => Promise<unknown> } }).__TEST_SUPABASE__;
      const original = fake.rpc.bind(fake);
      fake.rpc = async (fn: string, args?: unknown) => {
        if (fn === "record_ad_request_metric") {
          metricArgs.push(args);
          return { data: null, error: null };
        }
        return original(fn, args);
      };
      const res = await handleMatchPost(matchRequest(), { ipGuard: createIpGuard() });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      assert.equal(res.status, 200);
      assert.equal(metricArgs.length, 1);
      const args = metricArgs[0] as Record<string, unknown>;
      assert.deepEqual(Object.keys(args).sort(), ["p_latency_ms", "p_outcome"]);
      assert.equal(args.p_outcome, "fill");
    } finally {
      if (before === undefined) delete process.env.PILOT_METRICS_ENABLED;
      else process.env.PILOT_METRICS_ENABLED = before;
    }
  });

  it("reportMatchMetric itself never throws, whatever the sink or defer does", () => {
    assert.doesNotThrow(() => reportMatchMetric(undefined, "fill", 5));
    assert.doesNotThrow(() => reportMatchMetric(null, "fill", 5));
    assert.doesNotThrow(() => reportMatchMetric(() => undefined, null, 5));
    assert.doesNotThrow(() => reportMatchMetric(() => undefined, "fill", Number.NaN));
    assert.doesNotThrow(() =>
      reportMatchMetric(
        () => {
          throw new Error("x");
        },
        "fill",
        5,
        () => {
          throw new Error("y");
        },
      ),
    );
  });
});

describe("phase 3 step 4: restricted metrics need the admin role", () => {
  const goodRow = {
    req_fill: 3, req_provider_fill: 0, req_no_fill: 1, req_unauthorized: 1, req_rate_limited: 0, req_invalid: 1, req_unavailable: 2,
    latency_samples: 7, latency_total_ms: 700, latency_max_ms: 250,
    serves: 3, impressions: 2, clicks: 1, campaign_spend: "0.0060",
  };

  function client(rows: unknown, error: { code?: string } | null = null): { client: AnalyticsRpcClient; calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      client: {
        rpc(fn: string) {
          calls.push(fn);
          return Promise.resolve({ data: rows, error });
        },
      },
    };
  }

  it("only the admin role may view; advertiser, publisher and no role may not", () => {
    assert.equal(canViewPilotMonitoring("admin"), true);
    for (const role of ["advertiser", "publisher", null] as const) assert.equal(canViewPilotMonitoring(role), false, String(role));
  });

  it("advertiser, publisher and unknown roles never reach the database", async () => {
    for (const role of ["advertiser", "publisher", null] as const) {
      const c = client([goodRow]);
      let built = 0;
      const res = await loadPilotMonitoring(role, () => {
        built += 1;
        return Promise.resolve(c.client);
      });
      assert.deepEqual(res, { status: "unavailable" }, String(role));
      assert.equal(built, 0, "client must not even be created");
      assert.deepEqual(c.calls, []);
    }
  });

  it("the admin gets a view built only from the one admin-only database function", async () => {
    const c = client([goodRow]);
    const res = await loadPilotMonitoring("admin", () => Promise.resolve(c.client));
    assert.deepEqual(c.calls, ["get_pilot_monitoring_summary"]);
    assert.equal(res.status, "ok");
    if (res.status !== "ok") return;
    assert.equal(res.view.totalRequests, 8);
    assert.equal(res.view.fills, 3);
    assert.equal(res.view.noFills, 1);
    assert.equal(res.view.apiErrors, 2);
    assert.equal(res.view.callerErrors, 2);
    assert.equal(res.view.fillRatePct, 75);
    assert.equal(res.view.avgLatencyMs, 100);
    assert.equal(res.view.maxLatencyMs, 250);
    assert.equal(res.view.campaignSpend, "0.0060");
  });

  it("a non-admin session gets zero rows from the database function: shown as an error, never as zeros", async () => {
    const res = await loadPilotMonitoring("admin", () => Promise.resolve(client([]).client));
    assert.deepEqual(res, { status: "error" });
  });

  it("rpc error, wrong shape, two rows, missing field and a client that throws are all errors, never fake zeros", async () => {
    for (const c of [client(null, { code: "42883" }), client("nope"), client([goodRow, goodRow]), client([{ ...goodRow, req_fill: undefined }]), client([{ ...goodRow, serves: -1 }]), client([{ ...goodRow, campaign_spend: "abc" }])]) {
      assert.deepEqual(await loadPilotMonitoring("admin", () => Promise.resolve(c.client)), { status: "error" });
    }
    assert.deepEqual(
      await loadPilotMonitoring("admin", () => Promise.reject(new Error("client failed"))),
      { status: "error" },
    );
  });

  it("the database function is admin-only and read-only, and the writer is service_role only", () => {
    const sql = read("supabase/sql/phase3-step4-1-pilot-request-metrics.sql");
    assert.match(sql, /where \(select private\.is_admin\(\)\)/);
    assert.match(sql, /grant execute on function public\.get_pilot_monitoring_summary\(integer\) to authenticated/);
    assert.match(sql, /revoke all on function public\.get_pilot_monitoring_summary\(integer\) from public, anon, service_role/);
    assert.match(sql, /grant execute on function public\.record_ad_request_metric\(text, integer\) to service_role/);
    assert.match(sql, /revoke all on function public\.record_ad_request_metric\(text, integer\) from public, anon, authenticated/);
    assert.match(sql, /enable row level security/);
    assert.match(sql, /revoke all on table public\.ad_request_metrics_hourly from public, anon, authenticated, service_role/);
    // sirf apni table likhta hai: billing / ledger / events par koi insert, update, delete nahi
    const body = sql.replace(/--.*$/gm, "");
    assert.doesNotMatch(body, /\b(insert into|update|delete from)\s+public\.(campaign_spend_daily|ad_events|ad_serve_log|creative_serve_daily|ledger_settings|campaigns)\b/i);
    assert.doesNotMatch(body, /\b(alter|drop)\s+(table|function)\s+public\.(financial_ledger|campaign_spend_daily|ad_events|ad_serve_log|record_ad_serve|record_ad_impression|record_ad_click)\b/i);
  });

  it("the table has no column that could hold a prompt, topic, key, address, user or campaign", () => {
    const sql = read("supabase/sql/phase3-step4-1-pilot-request-metrics.sql");
    const create = /create table if not exists public\.ad_request_metrics_hourly \(([\s\S]*?)\n\);/.exec(sql);
    assert.ok(create);
    const columns = [...create[1].matchAll(/^\s{2}([a-z_]+)\s+(?:timestamptz|text|bigint|integer)\b/gm)].map((m) => m[1]);
    assert.deepEqual(columns, ["bucket_start", "outcome", "request_count", "latency_samples", "latency_total_ms", "latency_max_ms"]);
  });

  it("the admin page is still admin-only and loads monitoring in the same round as the review lists", () => {
    const page = read("app/dashboard/admin/page.tsx");
    assert.match(page, /requireRole\(\["admin"\]\)/);
    assert.match(page, /Promise\.all\(\[loadAdminData\(\), loadPilotMonitoring\(account\.role/);
    const analytics = read("app/dashboard/analytics/page.tsx");
    assert.doesNotMatch(analytics, /pilot-monitoring|PilotMonitoringPanel/, "advertiser / publisher analytics page must stay untouched");
  });
});

describe("phase 3 step 4: empty data and missing metrics show correct states", () => {
  const emptyRow = {
    req_fill: 0, req_provider_fill: 0, req_no_fill: 0, req_unauthorized: 0, req_rate_limited: 0, req_invalid: 0, req_unavailable: 0,
    latency_samples: 0, latency_total_ms: 0, latency_max_ms: 0,
    serves: 0, impressions: 0, clicks: 0, campaign_spend: "0.0000",
  };

  it("with no requests there is no fill rate, no average and no slowest request (null, never 0%)", () => {
    const view = buildMonitoringView(parseMonitoringSummaryRow(emptyRow)!);
    assert.equal(view.totalRequests, 0);
    assert.equal(view.fillRatePct, null);
    assert.equal(view.avgLatencyMs, null);
    assert.equal(view.maxLatencyMs, null);
    assert.deepEqual(view.flags, []);
  });

  it("only caller errors (no fills, no no-fills) still gives no fill rate", () => {
    const view = buildMonitoringView(parseMonitoringSummaryRow({ ...emptyRow, req_unauthorized: 4 })!);
    assert.equal(view.fillRatePct, null);
    assert.equal(view.callerErrors, 4);
  });

  it("provider fills are not counted as Blisscco fills", () => {
    const view = buildMonitoringView(parseMonitoringSummaryRow({ ...emptyRow, req_provider_fill: 3, req_fill: 1, req_no_fill: 1 })!);
    assert.equal(view.fills, 1);
    assert.equal(view.fillRatePct, 50);
    assert.equal(view.totalRequests, 5);
  });

  it("spend is kept as exact text and a malformed amount is rejected, never turned into a number", () => {
    const ok = buildMonitoringView(parseMonitoringSummaryRow({ ...emptyRow, campaign_spend: "1.5000" })!);
    assert.equal(ok.campaignSpend, "1.5000");
    for (const bad of ["abc", "-1.0000", "1.23456", "", null, 1.5]) assert.equal(parseMonitoringSummaryRow({ ...emptyRow, campaign_spend: bad }), null, String(bad));
  });

  it("the panel has a separate state for recording off, error and no admin, and never prints a number for a missing metric", () => {
    const panel = read("components/dashboard/PilotMonitoringPanel.tsx");
    assert.match(panel, /result\.status === "unavailable"\) return null/);
    assert.match(panel, /result\.status === "error"/);
    assert.match(panel, /Request recording is off on this server/);
    assert.match(panel, /No ad requests have been recorded in this period/);
    assert.match(panel, /noRequests \? "—"/);
    assert.match(panel, /No figures are shown rather than made-up zeros/);
  });
});

describe("phase 3 step 4: existing spend, earnings and ledger code is not changed", () => {
  it("monitoring never calls a billing or ledger function, never imports ledger code and the SQL never reads the ledger", () => {
    const sqlText = read("supabase/sql/phase3-step4-1-pilot-request-metrics.sql").replace(/--.*$/gm, "");
    assert.doesNotMatch(sqlText, /financial_ledger|ledger_/i);
    for (const f of ["lib/ads/pilot-monitoring.ts", "lib/ads/pilot-metrics-db.ts", "components/dashboard/PilotMonitoringPanel.tsx"]) {
      const src = read(f);
      assert.doesNotMatch(src, /record_ad_serve|record_ad_impression|record_ad_click|lib\/ledger|ledger-db|payout|revenue-share|financial_ledger/i, f);
    }
    const handler = read("lib/ads/match-handler.ts");
    assert.doesNotMatch(handler, /console\./);
    assert.match(handler, /reportMatchMetric\(/);
    // serve.ts (budget + eligibility + record order) bilkul nahi badla: record sirf selection ke baad aur sirf DB verify ke saath
    const serve = read("lib/ads/serve.ts");
    assert.doesNotMatch(serve, /pilot|metric/i);
    assert.match(serve, /deps\.record\(keyHash, attempt\.id, category/);
  });

  it("the money shown is exact text from the database and is never turned into a float", () => {
    const src = read("lib/ads/pilot-monitoring.ts");
    assert.doesNotMatch(src, /parseFloat|Number\(row\.campaign_spend|toFixed/);
    assert.match(read("supabase/sql/phase3-step4-1-pilot-request-metrics.sql"), /::numeric\(20, 4\)::text/);
  });

  it("recording runs after the answer: the handler hands the metric to defer and does not await it", () => {
    const handler = read("lib/ads/match-handler.ts");
    assert.doesNotMatch(handler, /await\s+(reportMatchMetric|pilotMetricSink|options\.metricSink)/);
    assert.match(handler, /after\(task\)/);
  });
});

describe("phase 3 step 4: pilot safety checklist section 15", () => {
  const doc = read("MVP-PILOT-SAFETY-CHECKLIST.md");
  const start = doc.indexOf("## 15. Phase 3 Step 4: pilot monitoring thresholds and stop conditions");
  const s = start === -1 ? "" : doc.slice(start);

  it("exists and covers every required stop or action", () => {
    assert.ok(start > -1, "section 15 missing");
    for (const w of [
      /API errors \(503\) increase/,
      /Repeated publisher API timeouts/,
      /Pause the pilot/,
      /Incorrect ad matching/,
      /Pause the campaign that served the wrong ad/,
      /Budget overspend/,
      /Duplicate financial events/,
      /Stop the pilot at once/,
      /Tracking inconsistency/,
      /Pause the affected campaign/,
      /Publisher integration failure/,
      /the chat keeps working/,
    ]) assert.match(s, w, String(w));
  });

  it("invents no threshold: every rate, count, time and latency limit is a blank for the owner", () => {
    const rows = s.split("\n").filter((l) => /^\| (API errors|Repeated publisher|Latency)/.test(l));
    assert.equal(rows.length, 3);
    for (const r of rows) assert.match(r, /____ \(owner decision, blank until set\)/, r);
    assert.doesNotMatch(s, /\b\d+(\.\d+)?\s?(%|percent|ms|milliseconds|seconds)\b/i);
  });

  it("says nothing was run or measured and keeps both new sign-off rows NOT CONFIRMED", () => {
    assert.match(s, /No pilot traffic has been measured/);
    assert.match(s, /The monitoring SQL was not run on any database, and no pilot metric has been measured/);
    const rows = s.split("\n").filter((l) => /^\| (Monitoring thresholds written|Monitoring panel read)/.test(l));
    assert.equal(rows.length, 2);
    for (const r of rows) assert.match(r, /\| \| \| \| NOT CONFIRMED \|$/, r);
    assert.doesNotMatch(s, /^\s*- \[[xX]\]/m);
  });

  it("states that recording is off by default and what is recorded", () => {
    assert.match(s, /Recording is off by default/);
    assert.match(s, /`PILOT_METRICS_ENABLED`/);
    assert.match(s, /Only the outcome and the duration of a request are recorded/);
  });
});
