import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { serveAd, type AuthorizeResult, type RecordResult, type ServeDeps } from "../../lib/ads/serve";
import { parseAuthorizeResult } from "../../lib/ads/serve-db";
import { MAX_NEXT_ADS, selectAd, type SelectionOutcome } from "../../lib/ads/selection";
import { chargedUnitCostUsd, type AdCandidate } from "../../lib/ads/category-matching";

// Day 11 Part 1: contextual matching ke do confirmed gaps ke tests (fake dependencies, asli database nahi).
//   1. record_ad_serve ne chuna hua creative reject kiya => agla eligible creative try hota hai (max 3 record calls)
//   2. TypeScript ka unit cost ab DB ke charge (greatest(round(cpm/1000, 4), 0.0001)) jaisa hai

const HASH = "a".repeat(64);
const PUBLISHER_ID = "99999999-9999-4999-8999-999999999999";
const CAMP_1 = "11111111-1111-4111-8111-111111111111";
const CAMP_2 = "22222222-2222-4222-8222-222222222222";
const CAMP_3 = "33333333-3333-4333-8333-333333333333";
const CR_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const CR_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const CR_C = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const CR_D = "dddddddd-dddd-4ddd-8ddd-ddddddddddd4";
const CR_E = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5";
const NOW = new Date("2026-10-28T12:00:00Z");

function candidate(id: string, campaignId: string, serves: number, over: Partial<AdCandidate> = {}): AdCandidate {
  return {
    ad: { id, headline: `H-${id.slice(0, 1)}`, body: "B", ctaText: null, destinationUrl: "https://example.com/x" },
    creativeStatus: "approved",
    campaignId,
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
    campaignServesToday: serves,
    creativeServesToday: serves,
    ...over,
  };
}

// Order (kam serve pehle): A(0) -> B(1) -> C(2) -> D(3) -> E(4)
const FIVE = [
  candidate(CR_A, CAMP_1, 0),
  candidate(CR_B, CAMP_2, 1),
  candidate(CR_C, CAMP_3, 2),
  candidate(CR_D, CAMP_1.replace("1", "4"), 3),
  candidate(CR_E, CAMP_1.replace("1", "5"), 4),
];

type RecordCall = { creativeId: string; category: string; idempotencyKey?: string };

function makeDeps(candidates: AdCandidate[], recordFor: (call: RecordCall, n: number) => RecordResult) {
  const calls: RecordCall[] = [];
  const deps: ServeDeps = {
    authorize: async (): Promise<AuthorizeResult> => ({
      outcome: "ok",
      publisher: { id: PUBLISHER_ID, status: "active" },
      unitCostUsd: 0.002,
    }),
    select: async (request, unitCostUsd): Promise<SelectionOutcome> =>
      selectAd(request, {
        loadCandidates: async () => candidates,
        now: () => NOW,
        unitCostUsd,
        spendTracking: "reliable",
      }),
    record: async (_hash, creativeId, category, idempotencyKey) => {
      const call: RecordCall = idempotencyKey === undefined ? { creativeId, category } : { creativeId, category, idempotencyKey };
      calls.push(call);
      return recordFor(call, calls.length);
    },
  };
  return { deps, calls };
}

const req = (topic = "gaming", excludeAdIds: string[] = [], idempotencyKey?: string) =>
  idempotencyKey === undefined ? { topic, excludeAdIds } : { topic, excludeAdIds, idempotencyKey };

const ids = (calls: RecordCall[]) => calls.map((c) => c.creativeId);

describe("selection: nextAds for a rejected record", () => {
  const run = (cands: AdCandidate[], exclude: string[] = []) =>
    selectAd(
      { publisher: { id: PUBLISHER_ID, status: "active" }, category: "gaming", excludeCreativeIds: exclude },
      { loadCandidates: async () => cands, now: () => NOW, unitCostUsd: 0.002, spendTracking: "reliable" },
    );

  it("returns at most MAX_NEXT_ADS next-best ads, in the same deterministic order", async () => {
    assert.equal(MAX_NEXT_ADS, 2);
    const out = await run(FIVE);
    assert.ok(out.fill);
    assert.equal(out.ad.id, CR_A);
    assert.deepEqual(out.nextAds?.map((a) => a.id), [CR_B, CR_C]);
  });

  it("a single eligible ad has NO nextAds key (old outcome shape unchanged)", async () => {
    const out = await run([candidate(CR_A, CAMP_1, 0)]);
    assert.ok(out.fill);
    assert.equal("nextAds" in out, false);
  });

  it("nextAds are public ads only (5 fields) and never include ineligible or excluded creatives", async () => {
    const mixed = [
      candidate(CR_A, CAMP_1, 0),
      candidate(CR_B, CAMP_2, 1, { campaignStatus: "paused" }),
      candidate(CR_C, CAMP_3, 2),
      candidate(CR_D, CAMP_1.replace("1", "4"), 3),
    ];
    const out = await run(mixed, [CR_D]);
    assert.ok(out.fill);
    assert.equal(out.ad.id, CR_A);
    assert.deepEqual(out.nextAds?.map((a) => a.id), [CR_C]); // B ineligible, D excluded (fresh alternative hai)
    assert.deepEqual(Object.keys(out.nextAds?.[0] ?? {}).sort(), ["body", "ctaText", "destinationUrl", "headline", "id"]);
  });
});

describe("serveAd: record rejected => next eligible creative", () => {
  it("first rejected, second recorded => the second ad is returned (1 reject + 1 record)", async () => {
    const { deps, calls } = makeDeps(FIVE, (c) => (c.creativeId === CR_A ? { outcome: "rejected" } : { outcome: "recorded" }));
    const r = await serveAd(HASH, req(), deps);
    assert.equal(r.kind === "ad" && r.ad.id, CR_B);
    assert.deepEqual(ids(calls), [CR_A, CR_B]);
  });

  it("all attempts rejected => no-fill, and never more than 3 record calls", async () => {
    const { deps, calls } = makeDeps(FIVE, () => ({ outcome: "rejected" }));
    assert.deepEqual(await serveAd(HASH, req(), deps), { kind: "no_fill" });
    assert.deepEqual(ids(calls), [CR_A, CR_B, CR_C]);
  });

  it("a record ERROR stops immediately (503), no guessing with the next creative", async () => {
    const first = makeDeps(FIVE, () => ({ outcome: "error" }));
    assert.deepEqual(await serveAd(HASH, req(), first.deps), { kind: "unavailable" });
    assert.equal(first.calls.length, 1);

    const second = makeDeps(FIVE, (_c, n) => (n === 1 ? { outcome: "rejected" } : { outcome: "error" }));
    assert.deepEqual(await serveAd(HASH, req(), second.deps), { kind: "unavailable" });
    assert.equal(second.calls.length, 2);
  });

  it("only ONE ad is ever recorded as served (stops at the first success)", async () => {
    const { deps, calls } = makeDeps(FIVE, (_c, n) => (n < 3 ? { outcome: "rejected" } : { outcome: "recorded" }));
    const r = await serveAd(HASH, req(), deps);
    assert.equal(r.kind === "ad" && r.ad.id, CR_C);
    assert.equal(calls.length, 3);
  });

  it("the Idempotency-Key and canonical category go with EVERY attempt", async () => {
    const { deps, calls } = makeDeps(FIVE, (_c, n) => (n === 1 ? { outcome: "rejected" } : { outcome: "recorded" }));
    await serveAd(HASH, req("video_games", [], "retry-key-12345"), deps);
    assert.deepEqual(calls, [
      { creativeId: CR_A, category: "gaming", idempotencyKey: "retry-key-12345" },
      { creativeId: CR_B, category: "gaming", idempotencyKey: "retry-key-12345" },
    ]);
  });

  it("without a key, record is called with the old 3 arguments only", async () => {
    const { deps, calls } = makeDeps(FIVE, () => ({ outcome: "recorded" }));
    await serveAd(HASH, req(), deps);
    assert.equal("idempotencyKey" in calls[0], false);
  });

  it("a replayed ad from the database wins over the attempted creative (same-key race), still 5 public fields", async () => {
    const replayed = { id: CR_E, headline: "old", body: "old", ctaText: null, destinationUrl: "https://example.com/old" };
    const { deps } = makeDeps(FIVE, (_c, n) => (n === 1 ? { outcome: "rejected" } : { outcome: "recorded", replayedAd: replayed }));
    const r = await serveAd(HASH, req("gaming", [], "retry-key-12345"), deps);
    assert.deepEqual(r, { kind: "ad", ad: replayed });
  });

  it("exclude list still decides the first choice; nextAds follow the same rule", async () => {
    const { deps, calls } = makeDeps(FIVE, () => ({ outcome: "rejected" }));
    await serveAd(HASH, req("gaming", [CR_A]), deps);
    assert.deepEqual(ids(calls), [CR_B, CR_C, CR_D]); // A excluded (fresh alternatives hain)
  });

  it("a single candidate that is rejected is still a plain no-fill (old behaviour)", async () => {
    const { deps, calls } = makeDeps([FIVE[0]], () => ({ outcome: "rejected" }));
    assert.deepEqual(await serveAd(HASH, req(), deps), { kind: "no_fill" });
    assert.equal(calls.length, 1);
  });

  it("ineligible candidates are never offered as nextAds (never reach record)", async () => {
    const cands = [
      candidate(CR_A, CAMP_1, 0),
      candidate(CR_B, CAMP_2, 1, { advertiserStatus: "suspended" }),
      candidate(CR_C, CAMP_3, 2, { category: "travel" }),
      candidate(CR_D, CAMP_1.replace("1", "4"), 3, { endDate: "2026-10-27" }),
    ];
    const { deps, calls } = makeDeps(cands, () => ({ outcome: "rejected" }));
    assert.deepEqual(await serveAd(HASH, req(), deps), { kind: "no_fill" });
    assert.deepEqual(ids(calls), [CR_A]);
  });
});

describe("unit cost now matches what the database charges", () => {
  it("chargedUnitCostUsd == greatest(round(cpm/1000, 4), 0.0001)", () => {
    const cases: Array<[number, number]> = [
      [0.002, 0.002], // CPM 2.0000 (default): koi fark nahi
      [0.0025555, 0.0026], // CPM 2.5555 -> upar round
      [0.0025444, 0.0025], // CPM 2.5444 -> neeche round
      [0.00255, 0.0026], // theek aadha: numeric round half-away-from-zero
      [0.00005, 0.0001], // CPM 0.05 -> floor 0.0001
      [0.0000001, 0.0001],
      [1, 1], // CPM 1000 (max)
    ];
    for (const [raw, expected] of cases) assert.equal(chargedUnitCostUsd(raw), expected, String(raw));
  });

  it("authorize parsing applies it (number and numeric string)", () => {
    const ok = { outcome: "ok", publisher_id: PUBLISHER_ID, publisher_status: "active" };
    assert.deepEqual(parseAuthorizeResult({ ...ok, unit_cost_usd: "0.0025444" }), {
      outcome: "ok",
      publisher: { id: PUBLISHER_ID, status: "active" },
      unitCostUsd: 0.0025,
    });
    assert.equal(parseAuthorizeResult({ ...ok, unit_cost_usd: 0.00005 }).outcome, "ok");
    // purane tests: 0.002 jas ka tas
    const r = parseAuthorizeResult({ ...ok, unit_cost_usd: 0.002 });
    assert.equal(r.outcome === "ok" && r.unitCostUsd, 0.002);
  });

  it("last affordable serve: remaining 0.0025 and DB charge 0.0025 (CPM 2.5444) => still eligible", async () => {
    // total 100, kharch 99.9975 => bacha 0.0025. DB 0.0025 charge karta hai (round), isliye ye serve ho sakta hai.
    const last = [candidate(CR_A, CAMP_1, 0, { totalBudget: 100, spentTotal: 99.9975 })];
    const dbUnit = parseAuthorizeResult({
      outcome: "ok", publisher_id: PUBLISHER_ID, publisher_status: "active", unit_cost_usd: 0.0025444,
    });
    assert.ok(dbUnit.outcome === "ok");
    const sel = (unitCostUsd: number) =>
      selectAd(
        { publisher: { id: PUBLISHER_ID, status: "active" }, category: "gaming" },
        { loadCandidates: async () => last, now: () => NOW, unitCostUsd, spendTracking: "reliable" },
      );
    assert.equal((await sel(dbUnit.unitCostUsd)).fill, true); // ab
    assert.equal((await sel(0.0025444)).fill, false); // pehle (bina round) bekaar no-fill
  });

  it("budget safety unchanged: one unit more than remaining is still ineligible", async () => {
    const over = [candidate(CR_A, CAMP_1, 0, { totalBudget: 100, spentTotal: 99.9976 })]; // bacha 0.0024 < 0.0025
    const out = await selectAd(
      { publisher: { id: PUBLISHER_ID, status: "active" }, category: "gaming" },
      { loadCandidates: async () => over, now: () => NOW, unitCostUsd: 0.0025, spendTracking: "reliable" },
    );
    assert.equal(out.fill, false);
  });
});
