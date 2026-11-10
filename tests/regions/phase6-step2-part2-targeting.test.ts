import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REGION_IDS, regionForCountry, type RegionId } from "../../lib/regions/country-region";
import { effectiveCampaignRegions, isPublisherEligibleForCampaignRegions } from "../../lib/regions/publisher-country";
import {
  filterCandidatesByRegion,
  isTargetEligibleForRegion,
  parseCampaignRegionRows,
  type CampaignTarget,
  type CampaignTargetMap,
} from "../../lib/ads/campaign-targeting";
import { publisherRegionOutcome } from "../../lib/ads/regional-eligibility";
import { resolvePublisherRegionFromDb } from "../../lib/ads/publisher-country-db";
import { loadCampaignTargetRegions } from "../../lib/ads/campaign-regions-db";
import { selectAd, type SelectionRequest } from "../../lib/ads/selection";
import { serveAd, type ServeDeps } from "../../lib/ads/serve";
import type { AdCandidate } from "../../lib/ads/category-matching";
import type { SelectionOutcome } from "../../lib/ads/selection";

// Phase 6 Step 2 Part 2: campaign targeting + regional eligibility. Sab nakli (fake) dependencies: asli database / network / Production nahi.
const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

const NOW = new Date("2026-11-10T12:00:00Z");
const PUBLISHER = { id: "99999999-9999-4999-8999-999999999999", status: "active" };
const CAMPAIGN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const CAMPAIGN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

const creativeOf = (campaignId: string) => `c${campaignId.slice(1)}`; // valid uuid: har campaign ka apna creative id

function candidate(campaignId: string, over: Partial<AdCandidate> = {}): AdCandidate {
  return {
    ad: { id: creativeOf(campaignId), headline: "Headline", body: "Body", ctaText: null, destinationUrl: "https://example.com/x" },
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

const targets = (entries: Record<string, CampaignTarget>): CampaignTargetMap => new Map(Object.entries(entries));

describe("Part 2: region eligibility matrix (pure)", () => {
  it("matching region => eligible; non-matching => not eligible", () => {
    assert.equal(isTargetEligibleForRegion(["north_america"], "north_america"), true);
    assert.equal(isTargetEligibleForRegion(["north_america"], "uk"), false);
    assert.equal(isTargetEligibleForRegion(["uk", "australia"], "australia"), true);
    assert.equal(isTargetEligibleForRegion(["uk", "australia"], "south_asia"), false);
  });

  it("every one of the 8 regions matches only itself when targeted alone", () => {
    for (const target of REGION_IDS) {
      for (const publisher of REGION_IDS) {
        assert.equal(isTargetEligibleForRegion([target], publisher), target === publisher, `${target} vs ${publisher}`);
      }
    }
  });

  it("no region selected (null or empty) => Rest of World ONLY, never all-region", () => {
    for (const empty of [null, [] as string[]]) {
      for (const region of REGION_IDS) {
        assert.equal(isTargetEligibleForRegion(empty, region), region === "rest_of_world", `${JSON.stringify(empty)} vs ${region}`);
      }
    }
  });

  it("explicit Rest of World targeting => eligible only for Rest of World publishers (same rule as no selection)", () => {
    for (const region of REGION_IDS) {
      assert.equal(isTargetEligibleForRegion(["rest_of_world"], region), region === "rest_of_world");
    }
    assert.equal(isTargetEligibleForRegion(["north_america", "rest_of_world"], "rest_of_world"), true);
    assert.equal(isTargetEligibleForRegion(["north_america", "rest_of_world"], "north_america"), true);
    assert.equal(isTargetEligibleForRegion(["north_america", "rest_of_world"], "uk"), false);
  });

  it("a list with no recognised region id => nobody (fail closed, not Rest of World, not all-region)", () => {
    for (const bad of [["mars"], ["North America"], [""], ["all"], ["*"], ["all_regions"], [1, null, {}]]) {
      for (const region of REGION_IDS) {
        assert.equal(isTargetEligibleForRegion(bad as unknown[], region), false, `${JSON.stringify(bad)} vs ${region}`);
      }
    }
    // ek pehchana + ek anjaana: sirf pehchana gina jaata hai (anjaana "sab" nahi banta)
    assert.equal(isTargetEligibleForRegion(["mars", "uk"], "uk"), true);
    assert.equal(isTargetEligibleForRegion(["mars", "uk"], "north_america"), false);
  });

  it("campaign row missing (undefined) or invalid publisher region => not eligible", () => {
    assert.equal(isTargetEligibleForRegion(undefined, "rest_of_world"), false);
    for (const bad of [null, undefined, "", "US", "Rest of World", 5, {}]) {
      assert.equal(isTargetEligibleForRegion(["rest_of_world"], bad), false);
      assert.equal(isTargetEligibleForRegion(null, bad), false);
    }
  });

  it("uses the Part 1 helper (no second rule): same answers as effectiveCampaignRegions / isPublisherEligibleForCampaignRegions", () => {
    for (const target of [null, [], ["uk"], ["rest_of_world"], ["mars"], ["uk", "rest_of_world"]] as CampaignTarget[]) {
      for (const region of REGION_IDS) {
        assert.equal(isTargetEligibleForRegion(target, region), effectiveCampaignRegions(target).includes(region));
        assert.equal(
          isTargetEligibleForRegion(target, region),
          isPublisherEligibleForCampaignRegions({ countryCode: sampleCountry(region), status: "verified" }, target),
        );
      }
    }
  });
});

function sampleCountry(region: RegionId): string {
  const sample: Record<RegionId, string> = {
    north_america: "US",
    uk: "GB",
    western_europe: "DE",
    australia: "AU",
    middle_east: "AE",
    south_asia: "IN",
    southeast_asia: "SG",
    rest_of_world: "BR",
  };
  return sample[region];
}

describe("Part 2: publisher country -> region (admin-verified only)", () => {
  it("verified ISO country => its region from the central mapping", () => {
    for (const region of REGION_IDS) {
      const code = sampleCountry(region);
      assert.equal(regionForCountry(code), region, code);
      assert.deepEqual(publisherRegionOutcome({ countryCode: code, status: "verified", submittedAt: null, reviewedAt: null }), { outcome: "ok", region });
    }
  });

  it("missing / invalid / pending / rejected => ineligible (no region, never Rest of World)", () => {
    const base = { submittedAt: null, reviewedAt: null };
    for (const state of [
      { countryCode: null, status: null, ...base },
      { countryCode: "IN", status: "pending" as const, ...base },
      { countryCode: "IN", status: "rejected" as const, ...base },
      { countryCode: "XX", status: "verified" as const, ...base },
      { countryCode: "UK", status: "verified" as const, ...base },
      { countryCode: "india", status: "verified" as const, ...base },
      { countryCode: null, status: "verified" as const, ...base },
    ]) {
      assert.deepEqual(publisherRegionOutcome(state), { outcome: "ineligible" }, JSON.stringify(state));
    }
  });

  it("state that could not be read => error (fail closed)", () => {
    assert.deepEqual(publisherRegionOutcome(null), { outcome: "error" });
  });
});

describe("Part 2: parsing the campaign regions rpc answer", () => {
  it("maps rows; null target stays null; lower-cases ids; ignores rows nobody asked for", () => {
    const map = parseCampaignRegionRows(
      [
        { campaign_id: CAMPAIGN_A.toUpperCase(), target_regions: ["uk"] },
        { campaign_id: CAMPAIGN_B, target_regions: null },
        { campaign_id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1", target_regions: ["uk"] },
      ],
      [CAMPAIGN_A, CAMPAIGN_B],
    );
    assert.ok(map);
    assert.deepEqual(map.get(CAMPAIGN_A), ["uk"]);
    assert.equal(map.get(CAMPAIGN_B), null);
    assert.equal(map.has("cccccccc-cccc-4ccc-8ccc-ccccccccccc1"), false);
  });

  it("malformed rows are dropped (campaign then has no entry => not eligible); non-array answer => null", () => {
    const map = parseCampaignRegionRows(
      [
        { campaign_id: CAMPAIGN_A, target_regions: "uk" },
        { campaign_id: CAMPAIGN_B, target_regions: [1, 2] },
        { target_regions: ["uk"] },
        null,
        "junk",
        [],
      ],
      [CAMPAIGN_A, CAMPAIGN_B],
    );
    assert.ok(map);
    assert.equal(map.size, 0);
    for (const bad of [null, undefined, {}, "x", 5]) assert.equal(parseCampaignRegionRows(bad, [CAMPAIGN_A]), null);
  });

  it("filterCandidatesByRegion drops campaigns with no entry and never mutates its input", () => {
    const input = [candidate(CAMPAIGN_A), candidate(CAMPAIGN_B)];
    const copy = JSON.stringify(input);
    const out = filterCandidatesByRegion(input, targets({ [CAMPAIGN_A]: ["uk"] }), "uk");
    assert.deepEqual(out.map((c) => c.campaignId), [CAMPAIGN_A]); // B ki entry nahi => hata
    assert.equal(JSON.stringify(input), copy);
    assert.deepEqual(filterCandidatesByRegion(input, targets({ [CAMPAIGN_A]: ["uk"] }), "bogus" as RegionId), []);
  });
});

function deps(map: CampaignTargetMap | "throw" | "not-a-map", log: { loads: string[][] } = { loads: [] }) {
  return {
    log,
    deps: {
      loadCandidates: async () => [candidate(CAMPAIGN_A), candidate(CAMPAIGN_B)],
      loadCampaignRegions: async (ids: readonly string[]) => {
        log.loads.push([...ids]);
        if (map === "throw") throw new Error("db down");
        return map as CampaignTargetMap;
      },
      now: () => NOW,
      unitCostUsd: 0.002,
      spendTracking: "reliable" as const,
    },
  };
}
const req = (publisherRegion?: RegionId): SelectionRequest => ({ publisher: PUBLISHER, category: "gaming", ...(publisherRegion ? { publisherRegion } : {}) });

describe("Part 2: selectAd regional filtering", () => {
  it("only campaigns targeting the publisher's region are chosen", async () => {
    const { deps: d } = deps(targets({ [CAMPAIGN_A]: ["north_america"], [CAMPAIGN_B]: ["uk"] }));
    const us = await selectAd(req("north_america"), d);
    assert.ok(us.fill);
    assert.equal(us.ad.id, creativeOf(CAMPAIGN_A));
    assert.equal(us.nextAds, undefined); // dusra campaign (uk) next-ad me bhi nahi aata
    const gb = await selectAd(req("uk"), d);
    assert.ok(gb.fill);
    assert.equal(gb.ad.id, creativeOf(CAMPAIGN_B));
  });

  it("no matching campaign => no-fill", async () => {
    const { deps: d } = deps(targets({ [CAMPAIGN_A]: ["north_america"], [CAMPAIGN_B]: ["uk"] }));
    assert.deepEqual(await selectAd(req("south_asia"), d), { fill: false, reason: "no_eligible_candidates" });
  });

  it("campaign with null or empty regions is served to Rest of World publishers only", async () => {
    for (const empty of [null, [] as string[]]) {
      const { deps: d } = deps(targets({ [CAMPAIGN_A]: empty, [CAMPAIGN_B]: empty }));
      for (const region of REGION_IDS) {
        const out = await selectAd(req(region), d);
        assert.equal(out.fill, region === "rest_of_world", `${JSON.stringify(empty)} vs ${region}`);
      }
    }
  });

  it("an all-regions-looking value is NOT all-region targeting (fail closed)", async () => {
    const { deps: d } = deps(targets({ [CAMPAIGN_A]: ["all"], [CAMPAIGN_B]: [] }));
    assert.equal((await selectAd(req("north_america"), d)).fill, false);
    assert.equal((await selectAd(req("uk"), d)).fill, false);
  });

  it("campaign with no targeting row is never served, even to Rest of World", async () => {
    const { deps: d } = deps(targets({}));
    assert.equal((await selectAd(req("rest_of_world"), d)).fill, false);
  });

  it("existing checks still apply inside a matching region (status, creative, dates, budget, advertiser)", async () => {
    const cases: Partial<AdCandidate>[] = [
      { campaignStatus: "paused" },
      { campaignStatus: "pending_review" },
      { creativeStatus: "pending_review" },
      { creativeStatus: "rejected" },
      { startDate: "2026-12-01" },
      { endDate: "2026-11-01" },
      { spentTotal: 100 },
      { dailyBudget: 1, spentToday: 1 },
      { advertiserStatus: "suspended" },
      { advertiserProfileStatus: "suspended" },
      { category: "finance" },
    ];
    for (const over of cases) {
      const { deps: d } = deps(targets({ [CAMPAIGN_A]: ["north_america"] }));
      d.loadCandidates = async () => [candidate(CAMPAIGN_A, over)];
      assert.equal((await selectAd(req("north_america"), d)).fill, false, JSON.stringify(over));
    }
    const { deps: ok } = deps(targets({ [CAMPAIGN_A]: ["north_america"] }));
    ok.loadCandidates = async () => [candidate(CAMPAIGN_A)];
    assert.equal((await selectAd(req("north_america"), ok)).fill, true);
  });

  it("region loader failure / bad answer / missing loader / invalid region => safe failure, never 'everything eligible'", async () => {
    const thrown = await selectAd(req("north_america"), deps("throw").deps);
    assert.deepEqual(thrown, { fill: false, reason: "candidate_load_failed" });
    const odd = await selectAd(req("north_america"), deps("not-a-map").deps);
    assert.deepEqual(odd, { fill: false, reason: "candidate_load_failed" });
    const { deps: noLoader } = deps(targets({}));
    delete (noLoader as { loadCampaignRegions?: unknown }).loadCampaignRegions;
    assert.deepEqual(await selectAd(req("north_america"), noLoader), { fill: false, reason: "candidate_load_failed" });
    const { deps: d } = deps(targets({ [CAMPAIGN_A]: ["north_america"] }));
    assert.deepEqual(await selectAd({ ...req(), publisherRegion: "US" as RegionId }, d), { fill: false, reason: "invalid_context" });
  });

  it("the region loader only receives campaign ids (no publisher id, no country, no key)", async () => {
    const { deps: d, log } = deps(targets({ [CAMPAIGN_A]: ["uk"], [CAMPAIGN_B]: ["uk"] }));
    await selectAd(req("uk"), d);
    assert.deepEqual(log.loads, [[CAMPAIGN_A, CAMPAIGN_B]]);
  });

  it("no publisherRegion (regional gate off) => old behaviour: region loader not called, all eligible campaigns stay", async () => {
    const { deps: d, log } = deps(targets({}));
    const out = await selectAd(req(), d);
    assert.ok(out.fill);
    assert.deepEqual(log.loads, []);
  });
});

const HASH = "a".repeat(64);
type Resolve = NonNullable<ServeDeps["resolvePublisherRegion"]>;
function serveDeps(resolve?: Resolve) {
  const trace = { resolved: [] as string[], selectRequests: [] as SelectionRequest[], record: 0, replay: 0 };
  const d: ServeDeps = {
    authorize: async () => ({ outcome: "ok", publisher: { id: PUBLISHER.id, status: "active" }, unitCostUsd: 0.002 }),
    select: async (request): Promise<SelectionOutcome> => {
      trace.selectRequests.push(request);
      return { fill: true, ad: { id: "cr1", headline: "H", body: "B", ctaText: null, destinationUrl: "https://example.com/x" }, repeat: false, budgetEnforced: true };
    },
    record: async () => {
      trace.record += 1;
      return { outcome: "recorded" };
    },
    lookupReplay: async () => {
      trace.replay += 1;
      return { outcome: "none" };
    },
  };
  if (resolve) {
    d.resolvePublisherRegion = async (id) => {
      trace.resolved.push(id);
      return resolve(id);
    };
  }
  return { d, trace };
}
const request = { topic: "gaming", excludeAdIds: [] as string[] };

describe("Part 2: serveAd passes only the server-verified region", () => {
  it("ok => selection gets publisherRegion from the dependency; ad served", async () => {
    const { d, trace } = serveDeps(async () => ({ outcome: "ok", region: "uk" }));
    assert.equal((await serveAd(HASH, request, d)).kind, "ad");
    assert.deepEqual(trace.resolved, [PUBLISHER.id]);
    assert.equal(trace.selectRequests[0].publisherRegion, "uk");
  });

  it("client-supplied country / region / publisher id in the request are ignored", async () => {
    const { d, trace } = serveDeps(async () => ({ outcome: "ok", region: "uk" }));
    const evil = { ...request, country: "US", region: "north_america", publisherRegion: "north_america", publisherId: "evil", countryCode: "US" };
    await serveAd(HASH, evil as typeof request, d);
    assert.deepEqual(trace.resolved, [PUBLISHER.id]);
    assert.equal(trace.selectRequests[0].publisherRegion, "uk");
    assert.ok(!JSON.stringify(trace.selectRequests[0]).includes("north_america"));
  });

  it("ineligible (missing / invalid / pending / rejected country) => no-fill; nothing replayed, selected or charged", async () => {
    const { d, trace } = serveDeps(async () => ({ outcome: "ineligible" }));
    assert.deepEqual(await serveAd(HASH, { ...request, idempotencyKey: "abc-123-xyz" }, d), { kind: "no_fill" });
    assert.equal(trace.selectRequests.length + trace.record + trace.replay, 0);
  });

  it("error / throw / invalid region from the dependency => unavailable (fail closed)", async () => {
    const bad: Resolve[] = [
      async () => ({ outcome: "error" }),
      async () => {
        throw new Error("db");
      },
      async () => ({ outcome: "ok", region: "US" as RegionId }),
      async () => ({ outcome: "weird" }) as unknown as ReturnType<Resolve> extends Promise<infer R> ? R : never,
    ];
    for (const resolve of bad) {
      const { d, trace } = serveDeps(resolve);
      assert.deepEqual(await serveAd(HASH, request, d), { kind: "unavailable" });
      assert.equal(trace.selectRequests.length + trace.record, 0);
    }
  });

  it("not_enforced (flag off) => no region filter, old behaviour; no dependency => same", async () => {
    for (const resolve of [async () => ({ outcome: "not_enforced" as const }), undefined]) {
      const { d, trace } = serveDeps(resolve);
      assert.equal((await serveAd(HASH, request, d)).kind, "ad");
      assert.equal("publisherRegion" in trace.selectRequests[0], false);
    }
  });

  it("unauthorized key never reaches the region lookup; region is looked up once per request even with several categories", async () => {
    const { d, trace } = serveDeps(async () => ({ outcome: "ok", region: "uk" }));
    d.authorize = async () => ({ outcome: "unauthorized" });
    assert.deepEqual(await serveAd(HASH, request, d), { kind: "unauthorized" });
    assert.equal(trace.resolved.length, 0);

    const multi = serveDeps(async () => ({ outcome: "ok", region: "uk" }));
    multi.d.select = async (r) => {
      multi.trace.selectRequests.push(r);
      return { fill: false, reason: "no_eligible_candidates" };
    };
    await serveAd(HASH, { ...request, fallbackTopics: ["travel", "food"] }, multi.d);
    assert.equal(multi.trace.resolved.length, 1);
    assert.equal(multi.trace.selectRequests.length, 3);
    assert.ok(multi.trace.selectRequests.every((r) => r.publisherRegion === "uk"));
  });
});

describe("Part 2: production readers (nakli Supabase)", () => {
  type Rpc = { data: unknown; error: { code?: string } | null };
  const setClient = (result: Rpc | "throw", calls: { name: string; args: unknown }[] = []) => {
    (globalThis as { __TEST_SUPABASE__?: unknown }).__TEST_SUPABASE__ = {
      async rpc(name: string, args: unknown) {
        calls.push({ name, args });
        if (result === "throw") throw new Error("network");
        return result;
      },
    };
  };
  const quiet = async (fn: () => Promise<void>) => {
    const original = console.error;
    console.error = () => {};
    try {
      await fn();
    } finally {
      console.error = original;
    }
  };

  it("publisher region: one read-only rpc with only the publisher id; verified country => region", async () => {
    const calls: { name: string; args: unknown }[] = [];
    setClient({ data: { country_status: "verified", country_code: "in" }, error: null }, calls);
    assert.deepEqual(await resolvePublisherRegionFromDb(PUBLISHER.id), { outcome: "ok", region: "south_asia" });
    assert.deepEqual(calls, [{ name: "get_publisher_country_state", args: { p_publisher_id: PUBLISHER.id } }]);
  });

  it("publisher region: pending / rejected / missing / non-ISO => ineligible; error / throw / odd shape => error", async () => {
    await quiet(async () => {
      for (const data of [
        { country_status: "pending", country_code: null },
        { country_status: "rejected", country_code: null },
        { country_status: null, country_code: null },
        { country_status: "verified", country_code: "XX" },
        { country_status: "verified", country_code: "UK" },
      ]) {
        setClient({ data, error: null });
        assert.deepEqual(await resolvePublisherRegionFromDb(PUBLISHER.id), { outcome: "ineligible" }, JSON.stringify(data));
      }
      setClient({ data: null, error: { code: "42883" } });
      assert.deepEqual(await resolvePublisherRegionFromDb(PUBLISHER.id), { outcome: "error" });
      setClient("throw");
      assert.deepEqual(await resolvePublisherRegionFromDb(PUBLISHER.id), { outcome: "error" });
      setClient({ data: null, error: null });
      assert.deepEqual(await resolvePublisherRegionFromDb(PUBLISHER.id), { outcome: "error" });
    });
  });

  it("campaign regions: asks only get_campaign_target_regions with de-duplicated lower-case campaign ids", async () => {
    const calls: { name: string; args: unknown }[] = [];
    setClient({ data: [{ campaign_id: CAMPAIGN_A, target_regions: ["uk"] }, { campaign_id: CAMPAIGN_B, target_regions: null }], error: null }, calls);
    const map = await loadCampaignTargetRegions([CAMPAIGN_A.toUpperCase(), CAMPAIGN_A, CAMPAIGN_B]);
    assert.deepEqual(calls, [{ name: "get_campaign_target_regions", args: { p_campaign_ids: [CAMPAIGN_A, CAMPAIGN_B] } }]);
    assert.deepEqual(map.get(CAMPAIGN_A), ["uk"]);
    assert.equal(map.get(CAMPAIGN_B), null);
  });

  it("campaign regions: no ids => no database call; rpc error / throw / non-array => throws (never an empty 'allow all' map)", async () => {
    const calls: { name: string; args: unknown }[] = [];
    setClient({ data: [], error: null }, calls);
    assert.equal((await loadCampaignTargetRegions([])).size, 0);
    assert.equal(calls.length, 0);
    await quiet(async () => {
      for (const r of [{ data: null, error: { code: "42883" } }, "throw", { data: { not: "array" }, error: null }] as const) {
        setClient(r as Rpc | "throw");
        await assert.rejects(loadCampaignTargetRegions([CAMPAIGN_A]));
      }
    });
  });
});

describe("Part 2: SQL migration (static checks; never run anywhere)", () => {
  const FILE = "supabase/sql/phase6-step2-2-campaign-target-regions.sql";
  const sql = read(FILE);
  const code = sql.replace(/^\s*--.*$/gm, "");

  it("adds exactly one nullable column, additive only, no destructive statements", () => {
    assert.equal((code.match(/add column if not exists/g) ?? []).length, 1);
    assert.match(code, /alter table public\.campaigns add column if not exists target_regions text\[\];/);
    assert.ok(!/not null\s*;/.test(code.split("target_regions text[]")[1].split(";")[0]));
    assert.ok(!/drop table|drop column|truncate|delete from|update public\.campaigns/i.test(code));
  });

  it("no region id list or country mapping in SQL (single source is lib/regions/country-region.ts)", () => {
    assert.ok(!/north_america|western_europe|southeast_asia|rest_of_world|south_asia|middle_east/.test(code));
    assert.ok(!/'(US|GB|IN|DE|FR|AU)'/.test(code));
  });

  it("read function: security definer, empty search_path, service_role only, writes nothing", () => {
    const start = code.indexOf("create or replace function public.get_campaign_target_regions");
    assert.ok(start >= 0);
    const body = code.slice(start, code.indexOf("$$;", code.indexOf("as $$", start)));
    assert.match(body, /security definer/);
    assert.match(body, /set search_path = ''/);
    assert.match(body, /stable/);
    assert.ok(!/insert|update|delete/i.test(body));
    assert.match(code, /revoke all on function public\.get_campaign_target_regions\(uuid\[\]\) from public, anon, authenticated;/);
    assert.match(code, /grant execute on function public\.get_campaign_target_regions\(uuid\[\]\) to service_role;/);
    assert.ok(!/grant[^;]*to (anon|authenticated|public)/i.test(code));
  });

  it("no column GRANT on the new column, and the serving / budget functions are not redefined", () => {
    assert.ok(!/grant\s+(insert|update|select)/i.test(code));
    assert.ok(!/load_ad_candidates|record_ad_serve|authorize_publisher_key|ledger|payout|cpm/i.test(code));
  });

  it("MIGRATION-ORDER lists it as TEST-first and not applied on Production", () => {
    const order = read("supabase/MIGRATION-ORDER.md");
    assert.match(order, /\| 43 \| phase6-step2-2 .*TEST first/);
    assert.match(order, /\| 43 \| phase6-step2-2 .*NOT applied on Production/);
  });
});

describe("Part 2: security and scope", () => {
  const files = ["lib/ads/campaign-targeting.ts", "lib/ads/campaign-regions-db.ts"];

  it("new modules define no country or region list of their own (central mapping only)", () => {
    for (const f of files) {
      const src = read(f);
      assert.ok(!/NAMED_REGION_COUNTRIES|COUNTRY_TO_REGION|ISO_COUNTRY_CODES\s*[:=]/.test(src), f);
      assert.ok(!/\[(\s*"[A-Z]{2}"\s*,){3,}/.test(src), f);
      assert.ok(!/"(north_america|western_europe|southeast_asia|south_asia|middle_east|australia)"/.test(src.replace(/^\s*\/\/.*$/gm, "")), f);
    }
  });

  it("only the server-only reader touches the admin client; the pure module has no database, env or network", () => {
    assert.match(read("lib/ads/campaign-regions-db.ts"), /^import "server-only";/);
    const pure = read("lib/ads/campaign-targeting.ts");
    assert.ok(!/server-only|createAdminClient|process\.env|fetch\(|supabase/i.test(pure.replace(/^\s*\/\/.*$/gm, "")));
  });

  it("the region comes from serve.ts's dependency only: neither the request type nor the validators know country / region", () => {
    for (const f of ["lib/ads/types.ts", "lib/ads/validation.ts", "lib/ads/contract.ts", "lib/ads/match-handler.ts"]) {
      assert.ok(!/country|region/i.test(read(f)), f);
    }
    const serveSrc = read("lib/ads/serve.ts");
    assert.ok(!/request\.(country|region|publisherRegion)/.test(serveSrc));
  });

  it("logs carry no country, region, campaign or publisher id", () => {
    for (const f of ["lib/ads/campaign-regions-db.ts", "lib/ads/publisher-country-db.ts"]) {
      for (const line of read(f).split("\n").filter((l) => l.includes("console."))) {
        assert.ok(!/campaign|publisher|country|region|ids|data/i.test(line.replace(/\[ads\/regional\]/, "").replace(/(country state|campaign regions) (rpc|unexpected)[a-z ]*/i, "")), line);
      }
    }
  });

  it("pricing, payments, ledger, payouts and the Part 1 files stay untouched by name", () => {
    assert.ok(!/ledger|payout|payment|cpm/i.test(read("lib/ads/campaign-targeting.ts")));
    assert.ok(!/ledger|payout|payment|cpm/i.test(read("lib/ads/campaign-regions-db.ts")));
    assert.equal(read("lib/regions/country-region.ts").includes("campaign"), false);
  });

  it("service.ts wires region resolution and loader; flag exact '1' still decides", () => {
    const svc = read("lib/ads/service.ts");
    assert.match(svc, /resolvePublisherRegion:/);
    assert.match(svc, /isRegionalEligibilityEnforced\(process\.env\)/);
    assert.match(svc, /loadCampaignRegions: loadCampaignTargetRegions/);
    assert.match(svc, /not_enforced/);
  });
});
