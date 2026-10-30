import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { parseCandidateRow, parseCandidateRows } from "../../lib/ads/candidate-rows";
import { loadAdCandidates } from "../../lib/ads/candidate-loader";
import { selectAd, toPublicResponse } from "../../lib/ads/selection";

// ---------- helpers ----------
const ROOT = path.join(__dirname, "..", "..", "..");
const PUBLISHER_ID = "99999999-9999-4999-8999-999999999999";
const CAMPAIGN_1 = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_2 = "22222222-2222-4222-8222-222222222222";
const CREATIVE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const CREATIVE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const CREATIVE_C = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const NOW = new Date("2026-10-24T12:00:00Z");

// load_ad_candidates ki ek row (database ke column naam)
function row(creativeId: string, campaignId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    creative_id: creativeId,
    headline: "Level up your game",
    body: "Try the new controller today.",
    cta_text: "Learn more",
    destination_url: "https://example.com/offer",
    creative_status: "approved",
    campaign_id: campaignId,
    campaign_status: "active",
    category: "gaming",
    start_date: "2026-10-01",
    end_date: null,
    total_budget: 100,
    daily_budget: null,
    spent_total: 0,
    spent_today: 0,
    advertiser_status: "active",
    advertiser_profile_status: "active",
    campaign_serves_today: 0,
    creative_serves_today: 0,
    ...over,
  };
}

type RpcCall = { name: string; args: unknown };

function fakeSupabase(result: { data?: unknown; error?: { code?: string; message?: string } | null } | (() => never)) {
  const calls: RpcCall[] = [];
  const client = {
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      if (typeof result === "function") return result();
      return { data: result.data ?? null, error: result.error ?? null };
    },
  };
  (globalThis as Record<string, unknown>).__TEST_SUPABASE__ = client;
  return calls;
}

function clearFake() {
  delete (globalThis as Record<string, unknown>).__TEST_SUPABASE__;
}

// ---------- 1. row parser ----------
describe("parseCandidateRow", () => {
  it("maps a database row to an AdCandidate", () => {
    const c = parseCandidateRow(row(CREATIVE_A, CAMPAIGN_1, { total_budget: 100.5, daily_budget: 10, end_date: "2026-12-31" }));
    assert.ok(c);
    assert.equal(c.ad.id, CREATIVE_A);
    assert.equal(c.ad.headline, "Level up your game");
    assert.equal(c.ad.ctaText, "Learn more");
    assert.equal(c.campaignId, CAMPAIGN_1);
    assert.equal(c.campaignStatus, "active");
    assert.equal(c.creativeStatus, "approved");
    assert.equal(c.startDate, "2026-10-01");
    assert.equal(c.endDate, "2026-12-31");
    assert.equal(c.totalBudget, 100.5);
    assert.equal(c.dailyBudget, 10);
    assert.equal(c.advertiserStatus, "active");
    assert.equal(c.advertiserProfileStatus, "active");
  });

  it("null cta_text, end_date and daily_budget stay null (not 0, not empty)", () => {
    const c = parseCandidateRow(row(CREATIVE_A, CAMPAIGN_1, { cta_text: null, end_date: null, daily_budget: null }));
    assert.ok(c);
    assert.equal(c.ad.ctaText, null);
    assert.equal(c.endDate, null);
    assert.equal(c.dailyBudget, null);
  });

  it("numeric columns may arrive as strings", () => {
    const c = parseCandidateRow(row(CREATIVE_A, CAMPAIGN_1, { total_budget: "100.00", spent_total: "1.7500", spent_today: "0.2500" }));
    assert.ok(c);
    assert.equal(c.totalBudget, 100);
    assert.equal(c.spentTotal, 1.75);
    assert.equal(c.spentToday, 0.25);
  });

  const bad: Array<[string, Record<string, unknown>]> = [
    ["missing creative_id", { creative_id: undefined }],
    ["non-string headline", { headline: 5 }],
    ["missing end_date key", { end_date: undefined }],
    ["unknown creative status", { creative_status: "live" }],
    ["unknown campaign status", { campaign_status: "running" }],
    ["unknown advertiser status", { advertiser_status: "vip" }],
    ["unknown profile status", { advertiser_profile_status: "admin" }],
    ["negative budget", { total_budget: -1 }],
    ["NaN spend", { spent_total: Number.NaN }],
    ["non-numeric spend string", { spent_today: "abc" }],
    ["empty-string budget", { total_budget: "" }],
    ["fractional serve count", { creative_serves_today: 1.5 }],
    ["negative serve count", { campaign_serves_today: -2 }],
    ["non-string category", { category: 7 }],
  ];
  for (const [name, over] of bad) {
    it(`bad row dropped: ${name}`, () => assert.equal(parseCandidateRow(row(CREATIVE_A, CAMPAIGN_1, over)), null));
  }

  it("non-object rows are dropped", () => {
    for (const v of [null, undefined, "x", 3, [], true]) assert.equal(parseCandidateRow(v), null);
  });

  it("extra columns (even private-looking ones) never reach the candidate", () => {
    const c = parseCandidateRow(row(CREATIVE_A, CAMPAIGN_1, { company_name: "Acme", email: "a@b.c", profile_id: "p1" }));
    assert.ok(c);
    assert.equal(JSON.stringify(c).includes("Acme"), false);
    assert.equal(JSON.stringify(c).includes("a@b.c"), false);
    assert.equal(JSON.stringify(c).includes("p1"), false);
  });
});

describe("parseCandidateRows", () => {
  it("non-array data is a failure (null), not an empty list", () => {
    for (const v of [null, undefined, {}, "rows", 4]) assert.equal(parseCandidateRows(v), null);
  });

  it("empty array is a valid empty list", () => assert.deepEqual(parseCandidateRows([]), []));

  it("bad rows are skipped, good rows kept in order", () => {
    const out = parseCandidateRows([row(CREATIVE_A, CAMPAIGN_1), { junk: true }, null, row(CREATIVE_B, CAMPAIGN_2)]);
    assert.ok(out);
    assert.deepEqual(out.map((c) => c.ad.id), [CREATIVE_A, CREATIVE_B]);
  });
});

// ---------- 2. loader (nakli supabase client; asli database nahi) ----------
describe("loadAdCandidates", () => {
  it("calls ONLY the read-only load_ad_candidates function, with exactly category and date", async () => {
    const calls = fakeSupabase({ data: [row(CREATIVE_A, CAMPAIGN_1)] });
    const out = await loadAdCandidates("gaming", "2026-10-24");
    assert.equal(out.length, 1);
    assert.deepEqual(calls, [{ name: "load_ad_candidates", args: { p_category: "gaming", p_today: "2026-10-24" } }]);
    clearFake();
  });

  it("an rpc error throws a generic error that leaks nothing", async () => {
    fakeSupabase({ error: { code: "XX000", message: "relation secret_table exploded" } });
    await assert.rejects(loadAdCandidates("gaming", "2026-10-24"), (e: Error) => {
      assert.equal(e.message, "candidate_load_failed");
      return true;
    });
    clearFake();
  });

  it("a malformed response shape throws", async () => {
    fakeSupabase({ data: { not: "an array" } });
    await assert.rejects(loadAdCandidates("gaming", "2026-10-24"), /candidate_load_failed/);
    clearFake();
  });

  it("an empty result is an empty list (not an error)", async () => {
    fakeSupabase({ data: [] });
    assert.deepEqual(await loadAdCandidates("gaming", "2026-10-24"), []);
    clearFake();
  });
});

// ---------- 3. loader + selectAd together (defense in depth) ----------
describe("loader + selection: the TypeScript layer re-checks everything the database filtered", () => {
  async function runWith(rows: unknown, spendTracking: "reliable" | "unavailable" = "unavailable") {
    fakeSupabase({ data: rows });
    const out = await selectAd(
      { publisher: { id: PUBLISHER_ID, status: "active" }, category: "gaming" },
      { loadCandidates: loadAdCandidates, now: () => NOW, unitCostUsd: 0.002, spendTracking },
    );
    clearFake();
    return out;
  }

  it("ACTIVE: an eligible row is selected and only the 5 public fields leave", async () => {
    const out = await runWith([row(CREATIVE_A, CAMPAIGN_1, { total_budget: 777.77 })]);
    assert.equal(out.fill, true);
    const json = JSON.stringify(toPublicResponse(out));
    assert.equal(json.includes(CAMPAIGN_1), false);
    assert.equal(json.includes("777.77"), false);
  });

  it("PAUSED: a paused row (even if the database filter failed) is excluded", async () => {
    assert.equal((await runWith([row(CREATIVE_A, CAMPAIGN_1, { campaign_status: "paused" })])).fill, false);
  });

  it("EXPIRED: end_date yesterday is excluded", async () => {
    assert.equal((await runWith([row(CREATIVE_A, CAMPAIGN_1, { end_date: "2026-10-23" })])).fill, false);
  });

  it("FUTURE-DATED: start_date tomorrow is excluded", async () => {
    assert.equal((await runWith([row(CREATIVE_A, CAMPAIGN_1, { start_date: "2026-10-25" })])).fill, false);
  });

  it("NO ELIGIBLE CREATIVE: unapproved / empty / bad-shape responses all give {fill:false}", async () => {
    for (const rows of [[row(CREATIVE_A, CAMPAIGN_1, { creative_status: "pending_review" })], [], { oops: 1 }, null]) {
      const out = await runWith(rows);
      assert.equal(JSON.stringify(toPublicResponse(out)), '{"fill":false}');
    }
  });

  it("a loader failure is a safe no-fill", async () => {
    fakeSupabase({ error: { code: "XX000" } });
    const out = await selectAd(
      { publisher: { id: PUBLISHER_ID, status: "active" }, category: "gaming" },
      { loadCandidates: loadAdCandidates, now: () => NOW, unitCostUsd: 0.002, spendTracking: "unavailable" },
    );
    clearFake();
    assert.deepEqual(out, { fill: false, reason: "candidate_load_failed" });
  });

  it("with reliable spend data, an exhausted campaign loses to one with budget left", async () => {
    const out = await runWith(
      [row(CREATIVE_A, CAMPAIGN_1, { total_budget: 100, spent_total: 100 }), row(CREATIVE_B, CAMPAIGN_2), row(CREATIVE_C, CAMPAIGN_2, { creative_status: "draft" })],
      "reliable",
    );
    assert.equal(out.fill && out.ad.id, CREATIVE_B);
  });
});

// ---------- 4. service-role key client-side nahi, loader read-only ----------
describe("secrets and read-only guarantees", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".next" || name === ".test-build" || name.startsWith(".")) continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(full);
    }
    return out;
  }

  it("no 'use client' file mentions the admin client or the secret key", () => {
    const files = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "components")), ...walk(path.join(ROOT, "lib"))];
    assert.ok(files.length > 20);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (!/^\s*["']use client["']/.test(src)) continue;
      assert.equal(/supabase\/admin|SECRET_KEY|service_role|candidate-loader/.test(src), false, f);
    }
  });

  it("the secret key is read in exactly one file (lib/supabase/admin.ts)", () => {
    const files = walk(ROOT);
    const users = files.filter((f) => /SUPABASE_SECRET_KEY/.test(readFileSync(f, "utf8")) && !f.includes(`${path.sep}tests${path.sep}`));
    assert.deepEqual(users.map((f) => path.relative(ROOT, f)), [path.join("lib", "supabase", "admin.ts")]);
  });

  const loaderSource = readFileSync(path.join(ROOT, "lib", "ads", "candidate-loader.ts"), "utf8");
  const loaderCode = loaderSource.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

  it("loader is server-only", () => assert.ok(/^import "server-only";/m.test(loaderCode)));

  it("loader never writes, bills, or reads env directly", () => {
    assert.equal(/\.(insert|update|upsert|delete)\(|\.from\(|process\.env|impression|click|charge|billing/i.test(loaderCode), false);
  });

  it("the only rpc the loader can call is load_ad_candidates", () => {
    const rpcs = [...loaderCode.matchAll(/\.rpc\(\s*"([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(rpcs, ["load_ad_candidates"]);
  });

  it("the migration is read-only and granted to service_role only", () => {
    const sql = readFileSync(path.join(ROOT, "supabase", "sql", "day-5-6-load-candidates.sql"), "utf8");
    const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    assert.ok(/language sql\s+stable\s+security definer\s+set search_path = ''/i.test(code));
    assert.equal(/\b(insert|update|delete|truncate|drop|alter)\b/i.test(code.replace(/revoke all on function[^;]*;/i, "")), false);
    assert.ok(/revoke all on function public\.load_ad_candidates\(text, date\) from public, anon, authenticated;/.test(code));
    assert.ok(/grant execute on function public\.load_ad_candidates\(text, date\) to service_role;/.test(code));
    const grantees = [...code.matchAll(/grant execute on function [^;]*? to ([^;]+);/gi)].map((m) => m[1].trim());
    assert.deepEqual(grantees, ["service_role"]);
  });

  it("the migration returns no advertiser name, email or profile id", () => {
    const sql = readFileSync(path.join(ROOT, "supabase", "sql", "day-5-6-load-candidates.sql"), "utf8");
    const returnsBlock = /returns table \(([\s\S]*?)\)\s*language sql/i.exec(sql);
    assert.ok(returnsBlock);
    assert.equal(/company_name|email|profile_id|display_name|website_url/i.test(returnsBlock[1]), false);
  });
});
