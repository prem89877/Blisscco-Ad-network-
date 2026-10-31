import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import * as legacyRoute from "@/app/api/ads/match/route";
import * as v1Route from "@/app/api/v1/ads/match/route";
import { serveAd, type AuthorizeResult, type RecordResult, type ServeDeps } from "@/lib/ads/serve";
import { MAX_NEXT_ADS, pickNextCandidates, selectAd, type SelectionOutcome } from "@/lib/ads/selection";
import type { AdCandidate } from "@/lib/ads/category-matching";
import { FakeAdDb, makeKey } from "./fake-ad-db";

// Day 11 Part 4: ranking + fallback + no-fill + failure behaviour ka audit (fake deps / FakeAdDb; asli Supabase kabhi nahi).
// Responsibility: ye layer sirf SELECT + serve RECORD karti hai. Impression/click tracking (aur Revive Adserver) yahan nahi hai.

const PUB = "99999999-9999-4999-8999-999999999999";
const NOW = new Date("2026-10-28T12:00:00Z");
const ROOT = path.resolve(__dirname, "../../..");

const id = (c: string, n: number) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(11)}${n}`;
const CAMP_A = "11111111-1111-4111-8111-111111111111";
const CAMP_B = "22222222-2222-4222-8222-222222222222";
const CAMP_C = "33333333-3333-4333-8333-333333333333";
const CAMP_D = "44444444-4444-4444-8444-444444444444";

function cand(creative: string, campaign: string, over: Partial<AdCandidate> = {}): AdCandidate {
  return {
    ad: { id: creative, headline: "H", body: "B", ctaText: null, destinationUrl: "https://example.com/x" },
    creativeStatus: "approved",
    campaignId: campaign,
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

const select = (cands: AdCandidate[], category = "gaming", exclude: string[] = []) =>
  selectAd(
    { publisher: { id: PUB, status: "active" }, category, excludeCreativeIds: exclude },
    { loadCandidates: async (c) => cands.filter((x) => x.category === c), now: () => NOW, unitCostUsd: 0.002, spendTracking: "reliable" },
  );

const order = async (cands: AdCandidate[]): Promise<string[]> => {
  const o = await select(cands);
  assert.equal(o.fill, true);
  if (!o.fill) return [];
  return [o.ad.id, ...(o.nextAds ?? []).map((a) => a.id)];
};

// ---------------------------------------------------------------------------------------------------------------------
describe("day 11 part 4 | ranking is predictable (rotation + stable tie-break, no randomness)", () => {
  it("ranking key: fewer campaign serves today, then fewer creative serves, then campaign id, then creative id", async () => {
    const list = [
      cand(id("a", 1), CAMP_C, { campaignServesToday: 5, creativeServesToday: 5 }),
      cand(id("b", 1), CAMP_B, { campaignServesToday: 2, creativeServesToday: 2 }),
      cand(id("c", 1), CAMP_A, { campaignServesToday: 2, creativeServesToday: 1 }),
    ];
    // campaign serves 2 < 5; within the 2s, creative serves 1 < 2. Then nextAds (max 2) follow the same order.
    assert.deepEqual(await order(list), [id("c", 1), id("b", 1), id("a", 1)]);
  });

  it("full tie => campaign id (a-z), then creative id (a-z)", async () => {
    const tied = [cand(id("f", 2), CAMP_B), cand(id("e", 1), CAMP_B), cand(id("d", 9), CAMP_A)];
    const o = await select(tied);
    assert.equal(o.fill && o.ad.id, id("d", 9)); // CAMP_A < CAMP_B
    const sameCamp = await select([cand(id("f", 2), CAMP_A), cand(id("e", 1), CAMP_A)]);
    assert.equal(sameCamp.fill && sameCamp.ad.id, id("e", 1));
  });

  it("input order never changes the result (every permutation)", async () => {
    const base = [
      cand(id("a", 1), CAMP_A, { campaignServesToday: 1, creativeServesToday: 1 }),
      cand(id("b", 1), CAMP_B),
      cand(id("c", 1), CAMP_C),
      cand(id("d", 1), CAMP_D, { campaignServesToday: 1 }),
    ];
    const perms = (xs: AdCandidate[]): AdCandidate[][] =>
      xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
    const want = JSON.stringify(await order(base));
    for (const p of perms(base)) assert.equal(JSON.stringify(await order(p)), want);
  });

  it("same input => same output, and Math.random is never consulted", async () => {
    const real = Math.random;
    Math.random = () => {
      throw new Error("random used");
    };
    try {
      const list = [cand(id("a", 1), CAMP_A), cand(id("b", 1), CAMP_B)];
      const a = await order(list);
      const b = await order(list);
      assert.deepEqual(a, b);
    } finally {
      Math.random = real;
    }
  });

  it("rotation: after a serve the other campaign ranks first (serve counts move the ranking)", async () => {
    const first = await order([cand(id("a", 1), CAMP_A), cand(id("b", 1), CAMP_B)]);
    assert.equal(first[0], id("a", 1));
    const after = await order([cand(id("a", 1), CAMP_A, { campaignServesToday: 1, creativeServesToday: 1 }), cand(id("b", 1), CAMP_B)]);
    assert.equal(after[0], id("b", 1));
  });

  it("relevance is a hard gate, not a score: a better-ranked ad of another category is never chosen", async () => {
    const o = await select([cand(id("a", 1), CAMP_A, { category: "technology" }), cand(id("b", 1), CAMP_B, { campaignServesToday: 99, creativeServesToday: 99 })]);
    assert.equal(o.fill && o.ad.id, id("b", 1));
    const none = await select([cand(id("a", 1), CAMP_A, { category: "technology" })]);
    assert.deepEqual(none, { fill: false, reason: "no_eligible_candidates" });
    // loader returns a wrong-category row by mistake: TypeScript still drops it
    const leaky = await selectAd(
      { publisher: { id: PUB, status: "active" }, category: "gaming" },
      { loadCandidates: async () => [cand(id("a", 1), CAMP_A, { category: "technology" })], now: () => NOW, unitCostUsd: 0.002, spendTracking: "reliable" },
    );
    assert.deepEqual(leaky, { fill: false, reason: "no_eligible_candidates" });
  });

  it("a best-ranked but ineligible ad never beats a worse-ranked eligible one", async () => {
    const bad: Array<[string, Partial<AdCandidate>]> = [
      ["unapproved", { creativeStatus: "pending_review" }],
      ["paused campaign", { campaignStatus: "paused" }],
      ["not started", { startDate: "2026-10-29" }],
      ["ended", { endDate: "2026-10-27" }],
      ["total budget exhausted", { totalBudget: 1, spentTotal: 1 }],
      ["daily budget exhausted", { dailyBudget: 1, spentToday: 1 }],
      ["advertiser suspended", { advertiserStatus: "suspended" }],
      ["profile suspended", { advertiserProfileStatus: "suspended" }],
    ];
    for (const [name, over] of bad) {
      const o = await select([cand(id("a", 1), CAMP_A, over), cand(id("b", 1), CAMP_B, { campaignServesToday: 50, creativeServesToday: 50 })]);
      assert.equal(o.fill && o.ad.id, id("b", 1), name);
      assert.equal(o.fill && o.nextAds, undefined, name);
    }
  });

  it("exclude list: fresh ads first; a repeat only when nothing else is eligible", async () => {
    const list = [cand(id("a", 1), CAMP_A), cand(id("b", 1), CAMP_B)];
    const fresh = await select(list, "gaming", [id("a", 1)]);
    assert.equal(fresh.fill && fresh.ad.id, id("b", 1));
    assert.equal(fresh.fill && fresh.repeat, false);
    const repeat = await select(list, "gaming", [id("a", 1), id("b", 1)]);
    assert.equal(repeat.fill && repeat.repeat, true);
    assert.equal(repeat.fill && repeat.ad.id, id("a", 1));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("day 11 part 4 | next attempts after a DB reject: other campaigns first, siblings after (bug fix)", () => {
  const ranked = [
    cand(id("a", 1), CAMP_A),
    cand(id("a", 2), CAMP_A),
    cand(id("a", 3), CAMP_A),
    cand(id("b", 1), CAMP_B, { campaignServesToday: 1 }),
    cand(id("c", 1), CAMP_C, { campaignServesToday: 2 }),
  ];

  it("pickNextCandidates: distinct campaigns in rank order, then siblings, capped", () => {
    assert.equal(MAX_NEXT_ADS, 2);
    assert.deepEqual(pickNextCandidates(ranked, 2).map((c) => c.ad.id), [id("b", 1), id("c", 1)]);
    assert.deepEqual(pickNextCandidates(ranked.slice(0, 4), 2).map((c) => c.ad.id), [id("b", 1), id("a", 2)]);
    assert.deepEqual(pickNextCandidates(ranked.slice(0, 3), 2).map((c) => c.ad.id), [id("a", 2), id("a", 3)]);
  });

  it("edge cases: empty, single, zero max; input is not mutated", () => {
    assert.deepEqual(pickNextCandidates([], 2), []);
    assert.deepEqual(pickNextCandidates([ranked[0]], 2), []);
    assert.deepEqual(pickNextCandidates(ranked, 0), []);
    const copy = JSON.stringify(ranked);
    pickNextCandidates(ranked, 2);
    assert.equal(JSON.stringify(ranked), copy);
  });

  it("BEFORE the fix this returned no-fill: campaign A (3 creatives) rejected by DB, campaign B eligible => B is served", async () => {
    const tried: string[] = [];
    const deps: ServeDeps = {
      authorize: async (): Promise<AuthorizeResult> => ({ outcome: "ok", publisher: { id: PUB, status: "active" }, unitCostUsd: 0.002 }),
      select: (r, u): Promise<SelectionOutcome> =>
        selectAd(r, { loadCandidates: async () => ranked, now: () => NOW, unitCostUsd: u, spendTracking: "reliable" }),
      record: async (_h, creative): Promise<RecordResult> => {
        tried.push(creative);
        return creative.startsWith("aaaa") ? { outcome: "rejected" } : { outcome: "recorded" };
      },
    };
    const r = await serveAd("h", { topic: "gaming", excludeAdIds: [] }, deps);
    assert.equal(r.kind, "ad");
    assert.deepEqual(tried, [id("a", 1), id("b", 1)]);
  });

  it("only one campaign exists and only ONE creative is rejected (creative-level reason): sibling is still served", async () => {
    const tried: string[] = [];
    const onlyA = ranked.slice(0, 3);
    const deps: ServeDeps = {
      authorize: async (): Promise<AuthorizeResult> => ({ outcome: "ok", publisher: { id: PUB, status: "active" }, unitCostUsd: 0.002 }),
      select: (r, u): Promise<SelectionOutcome> =>
        selectAd(r, { loadCandidates: async () => onlyA, now: () => NOW, unitCostUsd: u, spendTracking: "reliable" }),
      record: async (_h, creative): Promise<RecordResult> => {
        tried.push(creative);
        return creative === id("a", 1) ? { outcome: "rejected" } : { outcome: "recorded" };
      },
    };
    const r = await serveAd("h", { topic: "gaming", excludeAdIds: [] }, deps);
    assert.equal(r.kind, "ad");
    assert.deepEqual(tried, [id("a", 1), id("a", 2)]);
  });

  it("total record calls stay capped at 3 and the first success stops everything (one charge)", async () => {
    let n = 0;
    const deps: ServeDeps = {
      authorize: async (): Promise<AuthorizeResult> => ({ outcome: "ok", publisher: { id: PUB, status: "active" }, unitCostUsd: 0.002 }),
      select: (r, u): Promise<SelectionOutcome> =>
        selectAd(r, { loadCandidates: async () => ranked, now: () => NOW, unitCostUsd: u, spendTracking: "reliable" }),
      record: async (): Promise<RecordResult> => {
        n += 1;
        return { outcome: "rejected" };
      },
    };
    assert.deepEqual(await serveAd("h", { topic: "gaming", excludeAdIds: [] }, deps), { kind: "no_fill" });
    assert.equal(n, 3);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("day 11 part 4 | fallback tiers: relevance tier first, rotation only inside a tier", () => {
  const all = (): AdCandidate[] => [
    cand(id("a", 1), CAMP_A, { category: "gaming", campaignServesToday: 500, creativeServesToday: 500 }),
    cand(id("b", 1), CAMP_B, { category: "technology" }),
    cand(id("c", 1), CAMP_C, { category: "fitness" }),
  ];
  const run = async (cands: AdCandidate[], topic: string, fallbackTopics?: string[], record: (c: string) => RecordResult = () => ({ outcome: "recorded" })) => {
    const recorded: Array<[string, string]> = [];
    const deps: ServeDeps = {
      authorize: async (): Promise<AuthorizeResult> => ({ outcome: "ok", publisher: { id: PUB, status: "active" }, unitCostUsd: 0.002 }),
      select: (r, u): Promise<SelectionOutcome> =>
        selectAd(r, { loadCandidates: async (c) => cands.filter((x) => x.category === c), now: () => NOW, unitCostUsd: u, spendTracking: "reliable" }),
      record: async (_h, creative, category): Promise<RecordResult> => {
        recorded.push([creative, category]);
        return record(creative);
      },
    };
    const result = await serveAd("h", { topic, excludeAdIds: [], ...(fallbackTopics ? { fallbackTopics } : {}) }, deps);
    return { result, recorded };
  };

  it("a heavily served topic ad still beats a fresh fallback ad (relevance tier > rotation)", async () => {
    const { recorded } = await run(all(), "gaming", ["technology", "fitness"]);
    assert.deepEqual(recorded, [[id("a", 1), "gaming"]]);
  });

  it("no fallback_topics => unrelated categories are never served, however available they are", async () => {
    const { result, recorded } = await run(all().slice(1), "gaming");
    assert.deepEqual(result, { kind: "no_fill" });
    assert.deepEqual(recorded, []);
  });

  it("fallback order is the publisher's order; first fallback with an eligible ad wins", async () => {
    const { recorded } = await run(all().slice(1), "gaming", ["fitness", "technology"]);
    assert.deepEqual(recorded, [[id("c", 1), "fitness"]]);
  });

  it("fallback never serves an ineligible ad (paused / unapproved / out of schedule / no budget)", async () => {
    for (const over of [{ campaignStatus: "paused" as const }, { creativeStatus: "pending_review" as const }, { startDate: "2026-12-01" }, { endDate: "2026-01-01" }, { totalBudget: 1, spentTotal: 1 }]) {
      const { result, recorded } = await run([cand(id("b", 1), CAMP_B, { category: "technology", ...over })], "gaming", ["technology"]);
      assert.deepEqual(result, { kind: "no_fill" });
      assert.deepEqual(recorded, []);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
type RouteDef = { name: string; post: (r: Request) => Promise<Response> };
const ROUTES: RouteDef[] = [
  { name: "/api/ads/match (legacy)", post: legacyRoute.POST },
  { name: "/api/v1/ads/match", post: v1Route.POST },
];
const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
const realError = console.error;
const realLog = console.log;
const realWarn = console.warn;
let logged: string[] = [];
let db: FakeAdDb;
const KEY = makeKey("a");
const SECRET = "SECRET_DB_DETAIL password=hunter2 host=db.internal";

function post(route: RouteDef, body: string): Promise<Response> {
  return route.post(
    new Request("https://example.test/api/v1/ads/match", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
      body,
    }),
  );
}

beforeEach(() => {
  logged = [];
  const sink = (...a: unknown[]) => {
    logged.push(a.map(String).join(" "));
  };
  console.error = sink;
  console.log = sink;
  console.warn = sink;
  db = new FakeAdDb();
  globals.__TEST_SUPABASE__ = db.client();
});
afterEach(() => {
  console.error = realError;
  console.log = realLog;
  console.warn = realWarn;
});

const NO_FILL = { fill: false };
const UNAVAILABLE = { fill: false, error: "unavailable" };

for (const route of ROUTES) {
  describe(`day 11 part 4 | ${route.name}: safe behaviour per case (fake DB)`, () => {
    function world() {
      const pub = db.addPublisher("active");
      db.addKey(pub.id, KEY);
      const adv = db.addAdvertiser("active");
      return { pub, adv };
    }
    const expectNoFill = async (body: string, campaignId?: string) => {
      const res = await post(route, body);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), NO_FILL);
      assert.equal(db.serveLog.length, 0, "nothing recorded");
      if (campaignId) assert.equal(db.spendOf(campaignId), 0, "nothing charged");
      assert.equal(db.rpcCount("record_ad_serve"), 0, "record never called");
    };

    it("normal: the best eligible ad is served and charged once", async () => {
      const { pub, adv } = world();
      const ad = db.addAd(adv.id, { category: "gaming" });
      const res = await post(route, '{"topic":"gaming"}');
      assert.equal(res.status, 200);
      assert.equal(((await res.json()) as { ad: { id: string } }).ad.id, ad.creativeId);
      assert.equal(db.servesFor(pub.id).length, 1);
      assert.deepEqual(db.calls.map((c) => c.name), ["authorize_publisher_key", "load_ad_candidates", "record_ad_serve"]);
    });

    it("no matching category (unsupported / legacy / sensitive topic): 200 {fill:false}, candidates are not even loaded", async () => {
      const { adv } = world();
      const ad = db.addAd(adv.id, { category: "gaming" });
      for (const topic of ["unknown_topic", "beauty", "health", "religion", "politics"]) {
        await expectNoFill(JSON.stringify({ topic }), ad.campaignId);
      }
      assert.equal(db.rpcCount("load_ad_candidates"), 0);
    });

    it("category exists but only OTHER categories have campaigns: no-fill (no random/unrelated ad)", async () => {
      const { adv } = world();
      const t = db.addAd(adv.id, { category: "technology" });
      await expectNoFill('{"topic":"gaming"}', t.campaignId);
    });

    it("no campaigns at all: no-fill", async () => {
      world();
      await expectNoFill('{"topic":"gaming"}');
    });

    it("all campaigns paused / completed / draft: no-fill", async () => {
      const { adv } = world();
      const a = db.addAd(adv.id, { category: "gaming", campaignStatus: "paused" });
      db.addAd(adv.id, { category: "gaming", campaignStatus: "completed" });
      db.addAd(adv.id, { category: "gaming", campaignStatus: "draft" });
      await expectNoFill('{"topic":"gaming"}', a.campaignId);
    });

    it("creative not approved (pending / rejected / paused): no-fill", async () => {
      const { adv } = world();
      for (const creativeStatus of ["pending_review", "rejected", "paused", "draft", "archived"] as const) {
        db.addAd(adv.id, { category: "gaming", creativeStatus });
      }
      await expectNoFill('{"topic":"gaming"}');
    });

    it("exhausted budgets: total and daily: no-fill, nothing charged", async () => {
      const { adv } = world();
      const total = db.addAd(adv.id, { category: "gaming", totalBudget: 0.001 });
      const daily = db.addAd(adv.id, { category: "gaming", dailyBudget: 0.001 });
      await expectNoFill('{"topic":"gaming"}');
      assert.equal(db.spendOf(total.campaignId), 0);
      assert.equal(db.spendOf(daily.campaignId), 0);
    });

    it("a budget that runs out: last serve works, the next request is no-fill", async () => {
      const { adv } = world();
      const ad = db.addAd(adv.id, { category: "gaming", totalBudget: 0.002 }); // exactly one serve (unit 0.002)
      const first = await post(route, '{"topic":"gaming"}');
      assert.equal(((await first.json()) as { fill: boolean }).fill, true);
      const second = await post(route, '{"topic":"gaming"}');
      assert.deepEqual(await second.json(), NO_FILL);
      assert.equal(db.spendOf(ad.campaignId), 0.002);
    });

    it("outside schedule: not started yet / already ended: no-fill", async () => {
      const { adv } = world();
      db.addAd(adv.id, { category: "gaming", startDate: "2999-01-01" });
      db.addAd(adv.id, { category: "gaming", startDate: "2000-01-01", endDate: "2000-01-31" });
      await expectNoFill('{"topic":"gaming"}');
    });

    it("suspended advertiser: no-fill; suspended publisher: 401 (authorization comes first, fallback cannot bypass it)", async () => {
      const { pub, adv } = world();
      const sus = db.addAdvertiser("suspended");
      db.addAd(sus.id, { category: "gaming" });
      await expectNoFill('{"topic":"gaming"}');
      const ok = db.addAd(adv.id, { category: "technology" });
      const loadsBefore = db.rpcCount("load_ad_candidates");
      db.setPublisherStatus(pub.id, "suspended");
      const res = await post(route, '{"topic":"gaming","fallback_topics":["technology"]}');
      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { error: "unauthorized" });
      assert.equal(db.rpcCount("load_ad_candidates"), loadsBefore, "no candidates loaded for an unauthorized publisher");
      assert.equal(db.spendOf(ok.campaignId), 0);
    });

    it("missing / empty / malformed context: existing 400 format, no database work", async () => {
      world();
      const before = db.calls.length;
      for (const [body, reason] of [
        ["{}", "invalid_topic"],
        ['{"topic":""}', "invalid_topic"],
        ['{"topic":null}', "invalid_topic"],
        ['{"topic":["gaming"]}', "invalid_topic"],
        ['{"topic":"gaming","fallback_topics":"technology"}', "invalid_topic"],
        ["", "invalid_json"],
        ["null", "invalid_body"],
        ["[]", "invalid_body"],
        ['{"topic":"gaming","question":"hello"}', "unknown_field"],
      ] as const) {
        const res = await post(route, body);
        assert.equal(res.status, 400, body);
        assert.deepEqual(await res.json(), { error: "invalid_request", reason }, body);
      }
      assert.equal(db.calls.length, before);
    });

    it("fallback respects every check: ineligible fallback-category ads are never served", async () => {
      const { adv } = world();
      const paused = db.addAd(adv.id, { category: "technology", campaignStatus: "paused" });
      const exhausted = db.addAd(adv.id, { category: "technology", totalBudget: 0.001 });
      await expectNoFill('{"topic":"gaming","fallback_topics":["technology"]}');
      assert.equal(db.spendOf(paused.campaignId) + db.spendOf(exhausted.campaignId), 0);
    });

    // ------------------------------------------------------------------ failures
    const failures: Array<[string, string]> = [
      ["authorize_publisher_key", "authorize fails"],
      ["load_ad_candidates", "candidate load fails"],
      ["record_ad_serve", "record fails"],
    ];
    for (const [rpc, label] of failures) {
      it(`${label}: 503 {fill:false,error:"unavailable"}, no ad, no charge, no database detail in response or logs`, async () => {
        const { adv } = world();
        const ad = db.addAd(adv.id, { category: "gaming" });
        db.failRpc[rpc] = { data: null, error: { code: "XX000", message: SECRET } };
        const res = await post(route, '{"topic":"gaming"}');
        const text = await res.text();
        assert.equal(res.status, 503);
        assert.deepEqual(JSON.parse(text), UNAVAILABLE);
        assert.equal(text.includes("SECRET"), false);
        assert.equal(logged.join("\n").includes("hunter2"), false, "message/details never logged");
        assert.equal(logged.join("\n").includes(SECRET), false);
        assert.equal(db.serveLog.length, 0);
        assert.equal(db.spendOf(ad.campaignId), 0);
      });
    }

    it("a thrown exception from the database client: 503, no detail, no ad", async () => {
      const { adv } = world();
      db.addAd(adv.id, { category: "gaming" });
      globals.__TEST_SUPABASE__ = {
        rpc: async () => {
          throw new Error(SECRET);
        },
      };
      const res = await post(route, '{"topic":"gaming"}');
      const text = await res.text();
      assert.equal(res.status, 503);
      assert.deepEqual(JSON.parse(text), UNAVAILABLE);
      assert.equal(text.includes("hunter2"), false);
      assert.equal(logged.join("\n").includes("hunter2"), false);
    });

    it("garbage database answers never become an ad", async () => {
      const { adv } = world();
      db.addAd(adv.id, { category: "gaming" });
      // NOTE: record_ad_serve {outcome:"ok"} is a VALID answer (the database itself recorded + charged), so it is not "garbage".
      const shapes: unknown[] = [null, "ok", 5, [], {}, { outcome: "surprise" }, { outcome: 7 }, { outcome: "ok", replayed: true, ad: { id: "not-a-uuid" } }];
      for (const rpc of ["authorize_publisher_key", "record_ad_serve"]) {
        for (const data of rpc === "authorize_publisher_key" ? [...shapes, { outcome: "ok" }, { outcome: "ok", publisher_id: "x", publisher_status: "active", unit_cost_usd: 0.002 }] : shapes) {
          db.failRpc = { [rpc]: { data, error: null } };
          const res = await post(route, '{"topic":"gaming"}');
          const body = (await res.json()) as Record<string, unknown>;
          assert.notEqual(body.fill, true, `${rpc} ${JSON.stringify(data)}`);
        }
      }
      db.failRpc = { load_ad_candidates: { data: { not: "an array" }, error: null } };
      const res = await post(route, '{"topic":"gaming"}');
      assert.equal(res.status, 503);
      db.failRpc = { load_ad_candidates: { data: [null, 5, "x", { creative_id: 1 }], error: null } };
      const res2 = await post(route, '{"topic":"gaming"}');
      assert.deepEqual(await res2.json(), NO_FILL);
      assert.equal(db.serveLog.length, 0);
    });

    it("an outage in the topic's category does NOT silently jump to a fallback ad (503, nothing charged)", async () => {
      const { adv } = world();
      const t = db.addAd(adv.id, { category: "technology" });
      db.failRpc = { load_ad_candidates: { data: null, error: { code: "57014", message: SECRET } } };
      const res = await post(route, '{"topic":"gaming","fallback_topics":["technology"]}');
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), UNAVAILABLE);
      assert.equal(db.spendOf(t.campaignId), 0);
    });
  });
}

// ---------------------------------------------------------------------------------------------------------------------
describe("day 11 part 4 | responsibilities stay separated (serving here; tracking elsewhere)", () => {
  // Day 12 part 4: impression ingestion (alag layer, serve se alag) ke teen files yahan "serving code" nahi hain. Serving code ab bhi impression se bilkul alag hai
  // (tests/ads/day12-part4-impression.test.ts ye static check karta hai).
  const IMPRESSION_LAYER = ["impression.ts", "impression-db.ts", "impression-handler.ts"];
  const files = readdirSync(path.join(ROOT, "lib/ads")).filter((f) => f.endsWith(".ts") && !IMPRESSION_LAYER.includes(f));
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("no randomness anywhere in the serving code", () => {
    for (const f of files) {
      const src = strip(readFileSync(path.join(ROOT, "lib/ads", f), "utf8"));
      assert.equal(/Math\.random|crypto\.random|randomUUID|getRandomValues/.test(src), false, f);
    }
  });

  it("serving code has no impression/click tracking and no Revive Adserver integration", () => {
    for (const f of files) {
      if (f === "revive-adapter.ts" || f === "fallback-provider.ts") continue; // Day 22 Part 1: alag Revive boundary file (tests/ads/day22-part1 me jaanchi jaati hai)
      const src = strip(readFileSync(path.join(ROOT, "lib/ads", f), "utf8"));
      assert.equal(/revive|adserver|record_impression|record_click|track_impression|track_click|impressions?\b.*\brpc|\.from\(\s*["'](impressions|clicks)/i.test(src), false, f);
    }
  });

  it("the production serve flow does not import the old random matcher (lib/ads/match.ts / match_contextual_ad)", () => {
    for (const f of ["service.ts", "serve.ts", "selection.ts", "match-handler.ts", "candidate-loader.ts", "serve-db.ts"]) {
      const src = strip(readFileSync(path.join(ROOT, "lib/ads", f), "utf8"));
      assert.equal(/from\s+["']\.\/match["']|match_contextual_ad|matchAd\b/.test(src), false, f);
    }
  });

  it("a normal serve touches exactly three database functions (authorize, load candidates, record)", async () => {
    db = new FakeAdDb();
    globals.__TEST_SUPABASE__ = db.client();
    const pub = db.addPublisher("active");
    db.addKey(pub.id, KEY);
    db.addAd(db.addAdvertiser("active").id, { category: "gaming" });
    await post(ROUTES[1], '{"topic":"gaming"}');
    assert.deepEqual([...new Set(db.calls.map((c) => c.name))].sort(), ["authorize_publisher_key", "load_ad_candidates", "record_ad_serve"]);
  });
});
