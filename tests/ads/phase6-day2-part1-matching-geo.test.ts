import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AdCandidate } from "../../lib/ads/category-matching";
import { selectAd, type CandidateLoader, type SelectionDeps } from "../../lib/ads/selection";
import { serveAd, type ServeDeps } from "../../lib/ads/serve";
import { parseCountryStateResult, publisherRegionOutcome } from "../../lib/ads/regional-eligibility";
import { filterCandidatesByRegion, isTargetEligibleForRegion, type CampaignTargetMap } from "../../lib/ads/campaign-targeting";

// Phase 6 Day 2 Part 1: focused regression tests (sab nakli dependencies; asli database / network / Production kabhi nahi).
// Sections: A = matching matrix end to end, B = region bypass attempts, C = fully reserved budget (reproduction).

const NOW = new Date("2026-11-12T12:00:00Z");
const UNIT = 0.002;
const PUBLISHER = { id: "99999999-9999-4999-8999-999999999999", status: "active" };
const HASH = "a".repeat(64);
const campaignId = (n: number) => `${n}aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1`;
const creativeId = (n: number) => `${n}bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1`;

function cand(n: number, over: Partial<AdCandidate> = {}): AdCandidate {
  return {
    ad: { id: creativeId(n), headline: "Headline", body: "Body", ctaText: null, destinationUrl: "https://example.com/x" },
    creativeStatus: "approved",
    campaignId: campaignId(n),
    campaignStatus: "active",
    category: "gaming",
    startDate: "2026-11-01",
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

function wire(rows: readonly AdCandidate[], rejectCampaigns: ReadonlySet<string> = new Set()) {
  const trace = { loads: 0, records: [] as string[] };
  const loader: CandidateLoader = async () => {
    trace.loads += 1;
    return rows;
  };
  const selDeps: SelectionDeps = { loadCandidates: loader, now: () => NOW, unitCostUsd: UNIT, spendTracking: "reliable" };
  const byCreative = new Map(rows.map((r) => [r.ad.id, r.campaignId]));
  const deps: ServeDeps = {
    authorize: async () => ({ outcome: "ok", publisher: PUBLISHER, unitCostUsd: UNIT }),
    select: (request) => selectAd(request, selDeps),
    // DB jaisa: reject sirf tab jab campaign "held" set me ho (record_ad_serve ka budget guard).
    record: async (_hash, creative) => {
      trace.records.push(creative);
      const camp = byCreative.get(creative);
      return camp !== undefined && rejectCampaigns.has(camp) ? { outcome: "rejected" } : { outcome: "recorded" };
    },
  };
  return { deps, trace };
}

const ask = (topic: unknown) => ({ topic: topic as string, excludeAdIds: [] as string[] });

describe("A. category matching and no-fill matrix (serveAd + real selectAd)", () => {
  it("correct category => ad", async () => {
    const { deps } = wire([cand(1)]);
    const r = await serveAd(HASH, ask("gaming"), deps);
    assert.equal(r.kind, "ad");
  });

  it("unrelated category => no-fill and nothing recorded", async () => {
    const { deps, trace } = wire([cand(1, { category: "travel" })]);
    assert.equal((await serveAd(HASH, ask("gaming"), deps)).kind, "no_fill");
    assert.deepEqual(trace.records, []);
  });

  it("missing / empty / non-string category => no-fill without loading candidates", async () => {
    for (const topic of [undefined, null, "", "   ", 42, {}, []]) {
      const { deps, trace } = wire([cand(1)]);
      assert.equal((await serveAd(HASH, ask(topic), deps)).kind, "no_fill", JSON.stringify(topic));
      assert.equal(trace.loads, 0);
      assert.deepEqual(trace.records, []);
    }
  });

  it("inactive campaigns (paused / draft / completed / pending_review) => no-fill", async () => {
    for (const status of ["paused", "draft", "completed", "pending_review", "rejected"] as const) {
      const { deps, trace } = wire([cand(1, { campaignStatus: status as AdCandidate["campaignStatus"] })]);
      assert.equal((await serveAd(HASH, ask("gaming"), deps)).kind, "no_fill", status);
      assert.deepEqual(trace.records, []);
    }
  });

  it("exhausted campaigns (total or daily budget) => no-fill, nothing recorded", async () => {
    for (const over of [{ spentTotal: 100 }, { spentTotal: 99.999 }, { dailyBudget: 5, spentToday: 5 }]) {
      const { deps, trace } = wire([cand(1, over)]);
      assert.equal((await serveAd(HASH, ask("gaming"), deps)).kind, "no_fill", JSON.stringify(over));
      assert.deepEqual(trace.records, []);
    }
  });

  it("no candidates at all => no-fill", async () => {
    const { deps } = wire([]);
    assert.equal((await serveAd(HASH, ask("gaming"), deps)).kind, "no_fill");
  });

  it("an exhausted campaign loses to one with budget left", async () => {
    const { deps } = wire([cand(1, { spentTotal: 100 }), cand(2)]);
    const r = await serveAd(HASH, ask("gaming"), deps);
    assert.equal(r.kind, "ad");
    if (r.kind === "ad") assert.equal(r.ad.id, creativeId(2));
  });
});

describe("B. regional restrictions cannot be bypassed", () => {
  const A = campaignId(1);
  const regionLoader = (map: CampaignTargetMap) => async () => map;

  it("lookalike region ids never match (case, whitespace, prototype keys, wildcard)", () => {
    const lookalikes = ["UK", " uk", "uk ", "Uk", "all", "*", "global", "__proto__", "constructor", "toString", "hasOwnProperty", ""];
    for (const v of lookalikes) {
      assert.equal(isTargetEligibleForRegion(["uk", "north_america"], v), false, `publisher region ${JSON.stringify(v)}`);
      assert.equal(isTargetEligibleForRegion([v], "uk"), false, `campaign region ${JSON.stringify(v)}`);
    }
  });

  it("a list with junk plus one real region serves only that real region", () => {
    for (const region of ["north_america", "uk", "south_asia"] as const) {
      assert.equal(isTargetEligibleForRegion(["all", "*", "uk"], region), region === "uk");
    }
  });

  it("selectAd: lookalike publisherRegion => no-fill, region loader never called", async () => {
    let calls = 0;
    const deps: SelectionDeps = {
      loadCandidates: async () => [cand(1)],
      now: () => NOW,
      unitCostUsd: UNIT,
      spendTracking: "reliable",
      loadCampaignRegions: async () => {
        calls += 1;
        return new Map([[A, null]]);
      },
    };
    for (const region of ["UK", "all", "__proto__", "", "rest of world"]) {
      const out = await selectAd({ publisher: PUBLISHER, category: "gaming", publisherRegion: region as never }, deps);
      assert.equal(out.fill, false, region);
    }
    assert.equal(calls, 0);
  });

  it("selectAd: campaign targeting row keyed with different id case still maps; other ids never leak in", async () => {
    const deps: SelectionDeps = {
      loadCandidates: async () => [cand(1), cand(2)],
      now: () => NOW,
      unitCostUsd: UNIT,
      spendTracking: "reliable",
      loadCampaignRegions: regionLoader(new Map([[A.toLowerCase(), ["uk"]], ["ffffffff-ffff-4fff-8fff-ffffffffffff", ["uk"]]])),
    };
    const out = await selectAd({ publisher: PUBLISHER, category: "gaming", publisherRegion: "uk" }, deps);
    assert.ok(out.fill);
    assert.equal(out.ad.id, creativeId(1));
    assert.equal(out.nextAds, undefined); // campaign 2 ki targeting row nahi => eligible nahi
  });

  it("filterCandidatesByRegion: missing row never means 'all regions'", () => {
    assert.deepEqual(filterCandidatesByRegion([cand(1)], new Map(), "rest_of_world"), []);
  });

  it("country state: unverified / missing / invalid never yield a region (no Rest of World fallback)", () => {
    const rows: unknown[] = [
      { country_status: null, country_code: null },
      { country_status: "pending", country_code: null },
      { country_status: "rejected", country_code: null },
      { country_status: "verified", country_code: null },
      { country_status: "verified", country_code: "UK" }, // ISO me GB hai
      { country_status: "verified", country_code: "XX" },
      { country_status: "verified", country_code: "" },
      { country_status: "verified", country_code: "ZZZ" },
    ];
    for (const row of rows) {
      assert.deepEqual(publisherRegionOutcome(parseCountryStateResult(row)), { outcome: "ineligible" }, JSON.stringify(row));
    }
  });

  it("country state: unreadable / odd shapes => error (fail closed), never ok", () => {
    for (const data of [undefined, "verified", 7, [], [{}, {}], { country_status: "VERIFIED", country_code: "GB" }, { country_status: "verified", country_code: 5 }]) {
      const out = publisherRegionOutcome(parseCountryStateResult(data));
      assert.notEqual(out.outcome, "ok", JSON.stringify(data));
    }
  });

  it("verified valid country => ok with the central region", () => {
    assert.deepEqual(publisherRegionOutcome(parseCountryStateResult({ country_status: "verified", country_code: "gb" })), { outcome: "ok", region: "uk" });
  });

  it("serveAd: client-supplied country / region fields never reach selection", async () => {
    const seen: unknown[] = [];
    const deps: ServeDeps = {
      authorize: async () => ({ outcome: "ok", publisher: PUBLISHER, unitCostUsd: UNIT }),
      resolvePublisherRegion: async () => ({ outcome: "ok", region: "uk" }),
      select: async (request) => {
        seen.push(request);
        return { fill: false, reason: "no_eligible_candidates" };
      },
      record: async () => ({ outcome: "recorded" }),
    };
    await serveAd(HASH, { ...ask("gaming"), country: "US", region: "north_america", publisherRegion: "north_america" } as never, deps);
    assert.equal((seen[0] as { publisherRegion?: string }).publisherRegion, "uk");
    assert.equal(JSON.stringify(seen[0]).includes("north_america"), false);
  });
});

describe("C. fully reserved budget (load_ad_candidates only sees settled spend)", () => {
  // load_ad_candidates sirf SETTLED spend (campaign_spend_daily) dekhta hai; zinda holds (ad_budget_reservations) nahi.
  // Poori tarah reserved campaign isliye candidate list me aata hai aur record_ad_serve use reject karta hai.
  // Serve ka order "aaj sabse kam serve hua campaign" hai: pichhle UTC din ki holds wale campaigns ke serves aaj 0 hote hain => sabse upar.
  const held = (...ns: number[]) => new Set(ns.map(campaignId));

  it("1 or 2 fully reserved campaigns ahead: still fills (next-ads fall through to the good campaign)", async () => {
    for (const heldCount of [1, 2]) {
      const rows = [1, 2, 3].map((n) => cand(n, n <= heldCount ? { campaignServesToday: 0 } : { campaignServesToday: 5, creativeServesToday: 5 }));
      const { deps, trace } = wire(rows, held(...[1, 2].slice(0, heldCount)));
      const r = await serveAd(HASH, ask("gaming"), deps);
      assert.equal(r.kind, "ad", `held=${heldCount}`);
      assert.ok(trace.records.length <= 3);
    }
  });

  it("REPRODUCED: 3 fully reserved campaigns ranked first use up all 3 record attempts => no-fill although campaign 4 has budget", async () => {
    const rows = [
      cand(1, { campaignServesToday: 0 }),
      cand(2, { campaignServesToday: 0 }),
      cand(3, { campaignServesToday: 0 }),
      cand(4, { campaignServesToday: 7, creativeServesToday: 7 }),
    ];
    const { deps, trace } = wire(rows, held(1, 2, 3));
    const r = await serveAd(HASH, ask("gaming"), deps);
    assert.equal(r.kind, "no_fill"); // current behaviour (defect): campaign 4 tried hi nahi hota
    assert.deepEqual(trace.records, [creativeId(1), creativeId(2), creativeId(3)]);
  });

  it("with a held-aware pre-filter the same request fills, and the database guard is still what rejects", async () => {
    const all = [
      cand(1, { campaignServesToday: 0 }),
      cand(2, { campaignServesToday: 0 }),
      cand(3, { campaignServesToday: 0 }),
      cand(4, { campaignServesToday: 7, creativeServesToday: 7 }),
    ];
    const heldSet = held(1, 2, 3);
    const prefiltered = all.filter((c) => !heldSet.has(c.campaignId)); // load_ad_candidates ka proposed read-only filter
    const { deps, trace } = wire(prefiltered, heldSet);
    const r = await serveAd(HASH, ask("gaming"), deps);
    assert.equal(r.kind, "ad");
    assert.deepEqual(trace.records, [creativeId(4)]);
    // Guard weak nahi hua: agar pre-filter chook jaye (stale), DB reject karta hai aur koi charge nahi hota.
    const stale = wire(all.slice(0, 1), heldSet);
    assert.equal((await serveAd(HASH, ask("gaming"), stale.deps)).kind, "no_fill");
  });
});
