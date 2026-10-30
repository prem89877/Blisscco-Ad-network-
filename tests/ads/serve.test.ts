import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { serveAd, type AuthorizeResult, type RecordResult, type ServeDeps } from "../../lib/ads/serve";
import { parseAuthorizeResult, parseRecordResult } from "../../lib/ads/serve-db";
import { selectAd, type SelectionOutcome } from "../../lib/ads/selection";
import type { AdCandidate } from "../../lib/ads/category-matching";

// serve orchestrator ke tests: fake dependencies, asli database/clock nahi.

const ROOT = path.join(__dirname, "..", "..", "..");
const HASH = "a".repeat(64);
const PUBLISHER_ID = "99999999-9999-4999-8999-999999999999";
const CAMPAIGN_1 = "11111111-1111-4111-8111-111111111111";
const CREATIVE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const CREATIVE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const NOW = new Date("2026-10-24T12:00:00Z");

function candidate(id: string, over: Partial<AdCandidate> = {}): AdCandidate {
  return {
    ad: { id, headline: "H", body: "B", ctaText: null, destinationUrl: "https://example.com/x" },
    creativeStatus: "approved",
    campaignId: CAMPAIGN_1,
    campaignStatus: "active",
    category: "gaming",
    startDate: "2026-10-01",
    endDate: null,
    totalBudget: 100,
    dailyBudget: null,
    spentTotal: 0,
    spentToday: 0,
    advertiserStatus: "active",
    advertiserProfileStatus: "active",
    campaignServesToday: 0,
    creativeServesToday: 0,
    ...over,
  };
}

type Trace = { authorize: string[]; select: unknown[]; record: unknown[]; loadedCategories: string[] };

function makeDeps(
  opts: {
    auth?: AuthorizeResult;
    candidates?: AdCandidate[];
    record?: RecordResult;
    loadThrows?: boolean;
  } = {},
): { deps: ServeDeps; trace: Trace } {
  const trace: Trace = { authorize: [], select: [], record: [], loadedCategories: [] };
  const deps: ServeDeps = {
    authorize: async (hash) => {
      trace.authorize.push(hash);
      return opts.auth ?? { outcome: "ok", publisher: { id: PUBLISHER_ID, status: "active" }, unitCostUsd: 0.002 };
    },
    // asli selectAd (TypeScript selection layer), sirf loader aur clock nakli
    select: async (request, unitCostUsd): Promise<SelectionOutcome> => {
      trace.select.push(request);
      return selectAd(request, {
        loadCandidates: async (category) => {
          trace.loadedCategories.push(category);
          if (opts.loadThrows) throw new Error("db down");
          return opts.candidates ?? [candidate(CREATIVE_A)];
        },
        now: () => NOW,
        unitCostUsd,
        spendTracking: "unavailable",
      });
    },
    record: async (hash, creativeId, category) => {
      trace.record.push({ hash, creativeId, category });
      return opts.record ?? { outcome: "recorded" };
    },
  };
  return { deps, trace };
}

const req = (topic: string, excludeAdIds: string[] = []) => ({ topic, excludeAdIds });

describe("serveAd", () => {
  it("authorized + eligible => ad, recorded exactly once, only 5 public fields", async () => {
    const { deps, trace } = makeDeps({ candidates: [candidate(CREATIVE_A)] });
    const r = await serveAd(HASH, req("gaming"), deps);
    assert.deepEqual(r, {
      kind: "ad",
      ad: { id: CREATIVE_A, headline: "H", body: "B", ctaText: null, destinationUrl: "https://example.com/x" },
    });
    assert.deepEqual(trace.record, [{ hash: HASH, creativeId: CREATIVE_A, category: "gaming" }]);
  });

  it("publisher identity comes from authorize, never from the request", async () => {
    const { deps, trace } = makeDeps();
    await serveAd(HASH, req("gaming"), deps);
    const sel = trace.select[0] as { publisher: { id: string; status: string } };
    assert.deepEqual(sel.publisher, { id: PUBLISHER_ID, status: "active" });
  });

  it("unauthorized / rate_limited stop everything: no candidate load, no record", async () => {
    for (const outcome of ["unauthorized", "rate_limited"] as const) {
      const { deps, trace } = makeDeps({ auth: { outcome } });
      const r = await serveAd(HASH, req("gaming"), deps);
      assert.deepEqual(r, { kind: outcome });
      assert.equal(trace.loadedCategories.length, 0);
      assert.equal(trace.record.length, 0);
    }
  });

  it("authorize error => unavailable, nothing else runs", async () => {
    const { deps, trace } = makeDeps({ auth: { outcome: "error" } });
    assert.deepEqual(await serveAd(HASH, req("gaming"), deps), { kind: "unavailable" });
    assert.equal(trace.select.length, 0);
  });

  it("a publisher that is not active is rejected by the matching layer (no-fill, no record)", async () => {
    const { deps, trace } = makeDeps({
      auth: { outcome: "ok", publisher: { id: PUBLISHER_ID, status: "suspended" }, unitCostUsd: 0.002 },
    });
    assert.deepEqual(await serveAd(HASH, req("gaming"), deps), { kind: "no_fill" });
    assert.equal(trace.loadedCategories.length, 0);
    assert.equal(trace.record.length, 0);
  });

  it("aliases resolve to the canonical category before loading and recording", async () => {
    const { deps, trace } = makeDeps();
    const r = await serveAd(HASH, req("video_games"), deps);
    assert.equal(r.kind, "ad");
    assert.deepEqual(trace.loadedCategories, ["gaming"]);
    assert.equal((trace.record[0] as { category: string }).category, "gaming");
  });

  it("sensitive / unsupported / legacy categories => no-fill without loading candidates", async () => {
    for (const topic of ["health", "religion", "politics", "beauty", "unknown_thing", "a_b_c_d"]) {
      const { deps, trace } = makeDeps();
      assert.deepEqual(await serveAd(HASH, req(topic), deps), { kind: "no_fill" }, topic);
      assert.equal(trace.loadedCategories.length, 0, topic);
      assert.equal(trace.record.length, 0, topic);
    }
  });

  it("ineligible candidates never reach the publisher or the serve log", async () => {
    const bad: Array<Partial<AdCandidate>> = [
      { creativeStatus: "pending_review" },
      { campaignStatus: "paused" },
      { advertiserStatus: "suspended" },
      { advertiserProfileStatus: "suspended" },
      { startDate: "2026-10-25" },
      { endDate: "2026-10-23" },
      { category: "travel" },
      { ad: { id: CREATIVE_A, headline: "H", body: "B", ctaText: null, destinationUrl: "http://example.com" } },
    ];
    for (const over of bad) {
      const { deps, trace } = makeDeps({ candidates: [candidate(CREATIVE_A, over)] });
      assert.deepEqual(await serveAd(HASH, req("gaming"), deps), { kind: "no_fill" }, JSON.stringify(over));
      assert.equal(trace.record.length, 0, JSON.stringify(over));
    }
  });

  it("exclude list picks the alternative; repeats only when there is none", async () => {
    const two = [candidate(CREATIVE_A), candidate(CREATIVE_B)];
    let r = await serveAd(HASH, req("gaming", [CREATIVE_A]), makeDeps({ candidates: two }).deps);
    assert.equal(r.kind === "ad" && r.ad.id, CREATIVE_B);
    r = await serveAd(HASH, req("gaming", [CREATIVE_A]), makeDeps({ candidates: [candidate(CREATIVE_A)] }).deps);
    assert.equal(r.kind === "ad" && r.ad.id, CREATIVE_A);
  });

  it("rotation: the less-served creative is chosen", async () => {
    const r = await serveAd(
      HASH,
      req("gaming"),
      makeDeps({
        candidates: [candidate(CREATIVE_A, { creativeServesToday: 5 }), candidate(CREATIVE_B, { creativeServesToday: 1 })],
      }).deps,
    );
    assert.equal(r.kind === "ad" && r.ad.id, CREATIVE_B);
  });

  it("record rejected (creative went ineligible) => no-fill, the ad is NOT returned", async () => {
    const { deps } = makeDeps({ record: { outcome: "rejected" } });
    assert.deepEqual(await serveAd(HASH, req("gaming"), deps), { kind: "no_fill" });
  });

  it("record error => unavailable, the ad is NOT returned", async () => {
    const { deps } = makeDeps({ record: { outcome: "error" } });
    assert.deepEqual(await serveAd(HASH, req("gaming"), deps), { kind: "unavailable" });
  });

  it("candidate load failure => unavailable (503), nothing recorded, ad never returned", async () => {
    const { deps, trace } = makeDeps({ loadThrows: true });
    assert.deepEqual(await serveAd(HASH, req("gaming"), deps), { kind: "unavailable" });
    assert.equal(trace.record.length, 0);
  });

  it("an exception inside any dependency => unavailable (never throws)", async () => {
    const { deps } = makeDeps();
    const boom: ServeDeps = {
      ...deps,
      authorize: async () => {
        throw new Error("secret detail");
      },
    };
    assert.deepEqual(await serveAd(HASH, req("gaming"), boom), { kind: "unavailable" });
    const boom2: ServeDeps = {
      ...deps,
      record: async () => {
        throw new Error("secret detail");
      },
    };
    assert.deepEqual(await serveAd(HASH, req("gaming"), boom2), { kind: "unavailable" });
  });

  it("an unexpected authorize outcome is treated as unavailable (fail closed)", async () => {
    const { deps } = makeDeps();
    const weird: ServeDeps = { ...deps, authorize: async () => ({ outcome: "maybe" }) as unknown as AuthorizeResult };
    assert.deepEqual(await serveAd(HASH, req("gaming"), weird), { kind: "unavailable" });
  });
});

describe("parseAuthorizeResult", () => {
  const ok = { outcome: "ok", publisher_id: PUBLISHER_ID, publisher_status: "active", unit_cost_usd: 0.002 };

  it("parses ok (number or numeric string cost)", () => {
    const expected = { outcome: "ok", publisher: { id: PUBLISHER_ID, status: "active" }, unitCostUsd: 0.002 };
    assert.deepEqual(parseAuthorizeResult(ok), expected);
    assert.deepEqual(parseAuthorizeResult({ ...ok, unit_cost_usd: "0.002" }), expected);
  });

  it("parses the simple outcomes", () => {
    for (const o of ["unauthorized", "rate_limited"] as const) assert.deepEqual(parseAuthorizeResult({ outcome: o }), { outcome: o });
  });

  it("anything malformed => error", () => {
    const bad: unknown[] = [
      null, undefined, "ok", 1, [], {}, { outcome: 1 }, { outcome: "surprise" }, { outcome: "ok" },
      { ...ok, publisher_id: "not-a-uuid" }, { ...ok, publisher_id: 5 }, { ...ok, publisher_status: "suspended" },
      { ...ok, unit_cost_usd: 0 }, { ...ok, unit_cost_usd: -1 }, { ...ok, unit_cost_usd: "abc" }, { ...ok, unit_cost_usd: null },
    ];
    for (const v of bad) assert.deepEqual(parseAuthorizeResult(v), { outcome: "error" }, JSON.stringify(v));
  });
});

describe("parseRecordResult", () => {
  it("maps outcomes", () => {
    assert.deepEqual(parseRecordResult({ outcome: "ok" }), { outcome: "recorded" });
    assert.deepEqual(parseRecordResult({ outcome: "rejected" }), { outcome: "rejected" });
    assert.deepEqual(parseRecordResult({ outcome: "unauthorized" }), { outcome: "rejected" });
  });
  it("anything else => error", () => {
    for (const v of [null, undefined, [], {}, { outcome: 1 }, { outcome: "surprise" }, "ok"]) {
      assert.deepEqual(parseRecordResult(v), { outcome: "error" }, JSON.stringify(v));
    }
  });
});

describe("source safety (new serve files)", () => {
  const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

  it("DB-touching files are server-only; the pure orchestrator imports no server code", () => {
    assert.match(read("lib/ads/serve-db.ts"), /^import "server-only";/);
    assert.match(read("lib/ads/service.ts"), /^import "server-only";/);
    // Comments chhodkar: sirf import lines aur code dekhte hain
    const pure = read("lib/ads/serve.ts")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    assert.equal(/server-only|supabase|process\.env|console\./.test(pure), false);
  });

  it("logging only ever passes a static label and an error code (never key, hash, topic, body or ad text)", () => {
    for (const f of ["lib/ads/serve-db.ts", "lib/ads/service.ts", "lib/ads/serve.ts", "app/api/ads/match/route.ts"]) {
      const src = read(f);
      const calls = src.match(/console\.\w+\([^)]*\)/g) ?? [];
      for (const c of calls) {
        assert.match(c, /^console\.error\("\[ads\/serve\] [a-z ]+"(, error\.code \?\? "unknown")?\)$/, `${f}: ${c}`);
      }
    }
  });

  it("route never reads or logs the request body beyond validation", () => {
    const src = read("app/api/ads/match/route.ts");
    assert.equal(/console\./.test(src), false);
    assert.equal(/lib\/supabase\/admin|SECRET_KEY/.test(src), false);
  });
});
