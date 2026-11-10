import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { REGION_IDS, regionForCountry, type RegionId } from "../../lib/regions/country-region";
import { serveAd, type ServeDeps } from "../../lib/ads/serve";
import { selectAd } from "../../lib/ads/selection";
import { chargedUnitCostUsd, type AdCandidate } from "../../lib/ads/category-matching";
import { resolvePublisherRegionFromDb } from "../../lib/ads/publisher-country-db";
import { loadCampaignTargetRegions } from "../../lib/ads/campaign-regions-db";

// Phase 6 Step 2 Part 3: focused end-to-end tests (serveAd + asli selectAd + asli region readers; sirf nakli Supabase rpc) aur
// pricing compatibility. Koi asli database / network / Production nahi. Asli SQL yahan nahi chalti.
const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const HASH = "a".repeat(64);
const PUBLISHER = "99999999-9999-4999-8999-999999999999";
const NOW = new Date("2026-11-10T12:00:00Z");
const UNIT = 0.002; // authorize se aata hai (cpm_usd / 1000); region se kabhi nahi

const CAMP = {
  us: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  uk: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
  row: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
  none: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
  empty: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
} as const;
const creativeOf = (campaignId: string) => `1${campaignId.slice(1)}`;

function cand(campaignId: string, over: Partial<AdCandidate> = {}): AdCandidate {
  return {
    ad: { id: creativeOf(campaignId), headline: "H", body: "B", ctaText: null, destinationUrl: "https://example.com/x" },
    creativeStatus: "approved",
    campaignId,
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

type Rows = Record<string, string[] | null>;
type Harness = {
  rpcLog: { name: string; args: unknown }[];
  recorded: { creativeId: string; category: string }[];
  selectUnitCosts: number[];
  deps: ServeDeps;
};

/** Poora asli region chain: serveAd -> resolvePublisherRegionFromDb -> selectAd -> loadCampaignTargetRegions. Sirf rpc nakli. */
function harness(country: { status: string | null; code: string | null } | "rpc_error", campaigns: AdCandidate[], targets: Rows): Harness {
  const rpcLog: Harness["rpcLog"] = [];
  const recorded: Harness["recorded"] = [];
  const selectUnitCosts: number[] = [];
  (globalThis as { __TEST_SUPABASE__?: unknown }).__TEST_SUPABASE__ = {
    async rpc(name: string, args: Record<string, unknown>) {
      rpcLog.push({ name, args });
      if (name === "get_publisher_country_state") {
        if (country === "rpc_error") return { data: null, error: { code: "XX000" } };
        return { data: { country_status: country.status, country_code: country.status === "verified" ? country.code : null }, error: null };
      }
      if (name === "get_campaign_target_regions") {
        const ids = args.p_campaign_ids as string[];
        return { data: ids.filter((id) => id in targets).map((id) => ({ campaign_id: id, target_regions: targets[id] })), error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  };
  const deps: ServeDeps = {
    authorize: async () => ({ outcome: "ok", publisher: { id: PUBLISHER, status: "active" }, unitCostUsd: UNIT }),
    select: async (request, unitCostUsd) => {
      selectUnitCosts.push(unitCostUsd);
      return selectAd(request, {
        loadCandidates: async () => campaigns,
        loadCampaignRegions: loadCampaignTargetRegions,
        now: () => NOW,
        unitCostUsd,
        spendTracking: "reliable",
      });
    },
    record: async (_hash, creativeId, category) => {
      recorded.push({ creativeId, category });
      return { outcome: "recorded" };
    },
    resolvePublisherRegion: resolvePublisherRegionFromDb,
  };
  return { rpcLog, recorded, selectUnitCosts, deps };
}

const ALL = [cand(CAMP.us), cand(CAMP.uk), cand(CAMP.row), cand(CAMP.none), cand(CAMP.empty)];
const TARGETS: Rows = {
  [CAMP.us]: ["north_america"],
  [CAMP.uk]: ["uk"],
  [CAMP.row]: ["rest_of_world"],
  [CAMP.none]: null,
  [CAMP.empty]: [],
};
const request = { topic: "gaming", excludeAdIds: [] as string[] };
const quiet = async (fn: () => Promise<void>) => {
  const original = console.error;
  console.error = () => {};
  try {
    await fn();
  } finally {
    console.error = original;
  }
};

/** Kaun se campaigns kisi publisher country ko milte hain: har baar ek ek campaign akela rakh kar. */
async function servedCampaigns(country: { status: string | null; code: string | null }): Promise<string[]> {
  const out: string[] = [];
  for (const [name, id] of Object.entries(CAMP)) {
    const h = harness(country, [cand(id)], TARGETS);
    const r = await serveAd(HASH, request, h.deps);
    if (r.kind === "ad") out.push(name);
  }
  return out;
}

describe("Part 3: verified publisher country -> region -> campaign", () => {
  it("each verified country reaches exactly the campaigns of its region; null / empty / explicit Rest of World go only to Rest of World", async () => {
    const cases: Array<[string, RegionId, string[]]> = [
      ["US", "north_america", ["us"]],
      ["GB", "uk", ["uk"]],
      ["BR", "rest_of_world", ["row", "none", "empty"]], // Rest of World: explicit + null + khali
      ["IN", "south_asia", []], // is region ka koi campaign nahi
      ["DE", "western_europe", []],
    ];
    for (const [code, region, expected] of cases) {
      assert.equal(regionForCountry(code), region);
      assert.deepEqual(await servedCampaigns({ status: "verified", code }), expected, code);
    }
  });

  it("lower-case / spaced verified code from the database is normalised by the central module", async () => {
    assert.deepEqual(await servedCampaigns({ status: "verified", code: " us " }), ["us"]);
  });

  it("Rest of World publisher never gets a region-specific campaign; region publishers never get a null / empty campaign", async () => {
    const row = await servedCampaigns({ status: "verified", code: "BR" });
    assert.ok(!row.includes("us") && !row.includes("uk"));
    for (const code of ["US", "GB", "IN", "AU", "AE", "SG", "FR"]) {
      const got = await servedCampaigns({ status: "verified", code });
      assert.ok(!got.includes("none") && !got.includes("empty"), code);
    }
  });
});

describe("Part 3: pending, rejected, missing and invalid publisher country => no fill", () => {
  const states = [
    { name: "pending", state: { status: "pending", code: "US" } },
    { name: "rejected", state: { status: "rejected", code: "US" } },
    { name: "missing", state: { status: null, code: null } },
    { name: "verified but non-ISO XX", state: { status: "verified", code: "XX" } },
    { name: "verified but UK (not an ISO code)", state: { status: "verified", code: "UK" } },
    { name: "verified but malformed", state: { status: "verified", code: "USA" } },
    { name: "verified without a code", state: { status: "verified", code: null } },
  ];
  for (const { name, state } of states) {
    it(`${name}: no-fill even though every kind of campaign exists (null / empty / Rest of World included)`, async () => {
      const h = harness(state, ALL, TARGETS);
      assert.deepEqual(await serveAd(HASH, request, h.deps), { kind: "no_fill" });
      assert.equal(h.recorded.length, 0);
      assert.equal(h.selectUnitCosts.length, 0); // selection tak pahunchta hi nahi
      assert.ok(!h.rpcLog.some((c) => c.name === "get_campaign_target_regions")); // campaign data bhi nahi padha
    });
  }

  it("country state unreadable (rpc error) => unavailable, never a fallback to all-region", async () => {
    await quiet(async () => {
      const h = harness("rpc_error", ALL, TARGETS);
      assert.deepEqual(await serveAd(HASH, request, h.deps), { kind: "unavailable" });
      assert.equal(h.recorded.length, 0);
    });
  });

  it("unknown country status value from the database => unavailable (fail closed), never eligible", async () => {
    const h = harness({ status: "approved", code: "US" }, ALL, TARGETS);
    assert.deepEqual(await serveAd(HASH, request, h.deps), { kind: "unavailable" });
    assert.equal(h.recorded.length, 0);
  });

  it("campaign targeting unreadable => unavailable, nothing recorded", async () => {
    await quiet(async () => {
      const h = harness({ status: "verified", code: "US" }, ALL, TARGETS);
      const original = (globalThis as { __TEST_SUPABASE__?: { rpc: (n: string, a: unknown) => Promise<unknown> } }).__TEST_SUPABASE__!;
      (globalThis as { __TEST_SUPABASE__?: unknown }).__TEST_SUPABASE__ = {
        rpc: async (n: string, a: unknown) => (n === "get_campaign_target_regions" ? { data: null, error: { code: "42883" } } : original.rpc(n, a)),
      };
      assert.deepEqual(await serveAd(HASH, request, h.deps), { kind: "unavailable" });
      assert.equal(h.recorded.length, 0);
    });
  });

  it("client-supplied country or region cannot change the outcome", async () => {
    const h = harness({ status: "pending", code: "US" }, ALL, TARGETS);
    const evil = { ...request, country: "US", region: "north_america", publisherRegion: "north_america", countryCode: "US", "x-country": "US" };
    assert.deepEqual(await serveAd(HASH, evil as typeof request, h.deps), { kind: "no_fill" });
    const ok = harness({ status: "verified", code: "GB" }, ALL, TARGETS);
    const r = await serveAd(HASH, { ...evil } as typeof request, ok.deps);
    assert.equal(r.kind, "ad");
    assert.equal(ok.recorded[0].creativeId, creativeOf(CAMP.uk)); // GB ka campaign, "US" bhejne se US wala nahi
  });
});

describe("Part 3: existing eligibility checks still apply inside a matching region", () => {
  const blocked: Array<[string, Partial<AdCandidate>]> = [
    ["campaign paused", { campaignStatus: "paused" }],
    ["campaign pending review", { campaignStatus: "pending_review" }],
    ["campaign rejected", { campaignStatus: "rejected" }],
    ["campaign draft", { campaignStatus: "draft" }],
    ["creative not approved", { creativeStatus: "pending_review" }],
    ["creative rejected", { creativeStatus: "rejected" }],
    ["not started yet", { startDate: "2026-12-01" }],
    ["already ended", { endDate: "2026-11-01" }],
    ["total budget spent", { spentTotal: 100 }],
    ["less than one serve of total budget left", { spentTotal: 99.999 }],
    ["daily budget spent", { dailyBudget: 1, spentToday: 1 }],
    ["advertiser suspended", { advertiserStatus: "suspended" }],
    ["advertiser profile suspended", { advertiserProfileStatus: "suspended" }],
    ["other category", { category: "finance" }],
  ];
  for (const [name, over] of blocked) {
    it(`${name} => no-fill for a matching verified US publisher`, async () => {
      const h = harness({ status: "verified", code: "US" }, [cand(CAMP.us, over)], TARGETS);
      assert.deepEqual(await serveAd(HASH, request, h.deps), { kind: "no_fill" });
      assert.equal(h.recorded.length, 0);
    });
  }

  it("a blocked matching campaign does not let a non-matching campaign through; the healthy matching one is chosen", async () => {
    const h = harness(
      { status: "verified", code: "US" },
      [cand(CAMP.us, { campaignStatus: "paused" }), cand(CAMP.uk), cand(CAMP.row)],
      TARGETS,
    );
    assert.deepEqual(await serveAd(HASH, request, h.deps), { kind: "no_fill" });
    const h2 = harness({ status: "verified", code: "US" }, [cand(CAMP.us, { campaignStatus: "paused" }), cand(CAMP.us.replace("a", "9"), {}), cand(CAMP.uk)], {
      ...TARGETS,
      [CAMP.us.replace("a", "9")]: ["north_america"],
    });
    const r = await serveAd(HASH, request, h2.deps);
    assert.equal(r.kind, "ad");
    assert.equal(h2.recorded[0].creativeId, creativeOf(CAMP.us.replace("a", "9")));
  });

  it("a campaign with no targeting row (deleted, malformed) is never served to anyone", async () => {
    const h = harness({ status: "verified", code: "BR" }, [cand(CAMP.row)], {});
    assert.deepEqual(await serveAd(HASH, request, h.deps), { kind: "no_fill" });
  });
});

describe("Part 3: pricing compatibility (CPM / CPC and billing are not touched by regional eligibility)", () => {
  it("the unit price comes from authorize and reaches selection unchanged for every region", async () => {
    for (const code of ["US", "GB", "DE", "AU", "AE", "IN", "SG", "BR"]) {
      const h = harness({ status: "verified", code }, ALL, TARGETS);
      await serveAd(HASH, request, h.deps);
      for (const u of h.selectUnitCosts) assert.equal(u, UNIT, code);
    }
  });

  it("the record (charge) call gets exactly the same arguments as before: key hash, creative id, category; no region, no price", async () => {
    const seen: unknown[][] = [];
    const h = harness({ status: "verified", code: "US" }, [cand(CAMP.us)], TARGETS);
    h.deps.record = async (...args) => {
      seen.push(args);
      return { outcome: "recorded" };
    };
    assert.equal((await serveAd(HASH, request, h.deps)).kind, "ad");
    assert.deepEqual(seen, [[HASH, creativeOf(CAMP.us), "gaming"]]);
  });

  it("the same single campaign is chosen, priced and ranked identically whatever region matched it", async () => {
    const results: string[] = [];
    for (const [code, region] of [["US", "north_america"], ["GB", "uk"], ["IN", "south_asia"], ["BR", "rest_of_world"]] as const) {
      const id = "f0000000-0000-4000-8000-000000000001";
      const h = harness({ status: "verified", code }, [cand(id, { spentTotal: 1.5, creativeServesToday: 3 })], { [id]: [region] });
      const r = await serveAd(HASH, request, h.deps);
      assert.equal(r.kind, "ad", code);
      results.push(`${h.recorded[0].creativeId}|${h.selectUnitCosts[0]}`);
    }
    assert.equal(new Set(results).size, 1);
  });

  it("budget pre-filter uses the same per-serve unit cost in every region (a campaign with exactly one serve left is still eligible)", async () => {
    const unit = chargedUnitCostUsd(UNIT);
    for (const [code, region] of [["US", "north_america"], ["BR", "rest_of_world"]] as const) {
      const id = "f0000000-0000-4000-8000-000000000002";
      const exact = harness({ status: "verified", code }, [cand(id, { totalBudget: 10, spentTotal: 10 - unit })], { [id]: [region] });
      assert.equal((await serveAd(HASH, request, exact.deps)).kind, "ad", code);
      const short = harness({ status: "verified", code }, [cand(id, { totalBudget: 10, spentTotal: 10 - unit + 0.0001 })], { [id]: [region] });
      assert.equal((await serveAd(HASH, request, short.deps)).kind, "no_fill", code);
    }
  });

  it("chargedUnitCostUsd is unchanged (cpm / 1000, 4 decimals, minimum 0.0001)", () => {
    assert.equal(chargedUnitCostUsd(0.002), 0.002);
    assert.equal(chargedUnitCostUsd(0.0000001), 0.0001);
    assert.equal(chargedUnitCostUsd(0.0025555), 0.0026);
  });

  function walk(dir: string): string[] {
    return readdirSync(path.join(ROOT, dir)).flatMap((n) => {
      const rel = `${dir}/${n}`;
      return statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : [rel];
    });
  }

  it("pricing, billing, ledger, payout and payment code does not know about regions (no second price calculation)", () => {
    const files = [
      "lib/ads/serve-db.ts",
      "lib/ads/category-matching.ts",
      "lib/campaigns/budget.ts",
      "lib/campaigns/budget-rules.ts",
      "lib/campaigns/money.ts",
      "lib/campaigns/delivery.ts",
      ...walk("lib/ledger"),
      ...walk("lib/payouts"),
      ...walk("lib/payments"),
    ];
    for (const f of files) {
      const src = read(f).replace(/^\s*\/\/.*$/gm, "");
      assert.ok(!/lib\/regions|country-region|publisher-country|campaign-targeting|publisherRegion|rest_of_world|target_regions/.test(src), f);
    }
  });

  it("regional eligibility code contains no price, rate, CPM, CPC or bid logic", () => {
    for (const f of ["lib/ads/campaign-targeting.ts", "lib/ads/campaign-regions-db.ts", "lib/ads/regional-eligibility.ts", "lib/ads/publisher-country-db.ts", "lib/regions/country-region.ts", "lib/regions/publisher-country.ts"]) {
      const src = read(f).replace(/^\s*\/\/.*$/gm, "");
      assert.ok(!/\b(cpm|cpc|bid|rate|price|pricing|unitCost|chargedUnitCostUsd|spend|budget)\b/i.test(src), f);
    }
  });

  it("selection.ts: region filter is the only addition; unit cost is still only passed to the existing matcher", () => {
    const src = read("lib/ads/selection.ts").replace(/^\s*\/\/.*$/gm, "");
    assert.equal((src.match(/unitCostUsd: deps\.unitCostUsd/g) ?? []).length, 2); // probe + asli match, jaise pehle
    assert.ok(!/publisherRegion[^;]*unitCost|unitCost[^;]*publisherRegion/.test(src));
  });

  it("the Phase 6 SQL files do not touch pricing, spend, ledger, payouts or the serve functions", () => {
    for (const f of ["supabase/sql/phase6-step2-1-publisher-country-verification.sql", "supabase/sql/phase6-step2-2-campaign-target-regions.sql"]) {
      const code = read(f).replace(/^\s*--.*$/gm, "");
      assert.ok(!/ad_platform_settings|cpm_usd|campaign_spend_daily|financial_ledger|ledger_settings|payout|record_ad_serve|load_ad_candidates|authorize_publisher_key/i.test(code), f);
    }
  });

  it("the repository has no regional CPM / CPC rate table or function of its own to be duplicated (single global cpm_usd only)", () => {
    const sqlFiles = walk("supabase/sql");
    for (const f of sqlFiles) {
      const code = read(f).replace(/^\s*--.*$/gm, "");
      assert.ok(!/(regional|region)[a-z_]*\s*(rate|price|cpm|cpc)|cpm[a-z_]*region|cpc[a-z_]*region/i.test(code), f);
    }
    for (const f of [...walk("lib"), ...walk("app")].filter((x) => /\.(ts|tsx)$/.test(x))) {
      const code = read(f).replace(/^\s*\/\/.*$/gm, "");
      assert.ok(!/regionalRate|regionRate|regionalCpm|regionCpm|regionalCpc|regionCpc|rateByRegion|cpmByRegion/i.test(code), f);
    }
  });
});

describe("Part 3: the 8 regions all behave the same way end to end", () => {
  it("for every region, a campaign targeting only that region is served to a verified publisher of that region and to no other region", async () => {
    const sample: Record<RegionId, string> = { north_america: "US", uk: "GB", western_europe: "DE", australia: "AU", middle_east: "AE", south_asia: "IN", southeast_asia: "SG", rest_of_world: "BR" };
    const id = "f0000000-0000-4000-8000-000000000003";
    for (const target of REGION_IDS) {
      for (const publisher of REGION_IDS) {
        const h = harness({ status: "verified", code: sample[publisher] }, [cand(id)], { [id]: [target] });
        const r = await serveAd(HASH, request, h.deps);
        assert.equal(r.kind === "ad", target === publisher, `${target} vs ${publisher}`);
      }
    }
  });
});
