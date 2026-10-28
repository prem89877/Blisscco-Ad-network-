import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as legacyRoute from "@/app/api/ads/match/route";
import * as v1Route from "@/app/api/v1/ads/match/route";
import { MAX_BODY_BYTES, MAX_FALLBACK_TOPICS, parseMatchRequest } from "@/lib/ads/validation";
import { serveAd, type AuthorizeResult, type RecordResult, type ServeDeps } from "@/lib/ads/serve";
import { selectAd, type SelectionOutcome } from "@/lib/ads/selection";
import type { AdCandidate } from "@/lib/ads/category-matching";
import { FakeAdDb, makeKey } from "./fake-ad-db";

// Day 11 Part 3: publisher ka contextual input contract + fallback_topics.
//   Sach (code padh kar): API sirf `topic` (strict slug) + `exclude_ad_ids` leti thi. Raw question/prompt/page text accept NAHI hota
//   aur kahin store/log nahi hota. Isliye naya "free text" field nahi bana. Ek chhota, compatible, optional field jodi:
//   `fallback_topics` (max 2 explicit slugs). Matching exact-slug/alias hai: koi semantic/embedding/AI/keyword matching nahi.
// Asli Supabase kabhi nahi chhuta: unit tests fake deps se, route tests FakeAdDb (tests/ads/fake-ad-db.ts) se.

const PUB = "99999999-9999-4999-8999-999999999999";
const NOW = new Date("2026-10-28T12:00:00Z");
const hex = (n: number, ch: string) => ch.repeat(n);
const cid = (c: string, n: number) => `${hex(8, c)}-${hex(4, c)}-4${hex(3, c)}-8${hex(3, c)}-${hex(11, c)}${n}`;

function cand(id: string, campaign: string, category: string, over: Partial<AdCandidate> = {}): AdCandidate {
  return {
    ad: { id, headline: `H ${category}`, body: "B", ctaText: null, destinationUrl: "https://example.com/x" },
    creativeStatus: "approved",
    campaignId: campaign,
    campaignStatus: "active",
    category,
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

type Call = { creativeId: string; category: string; idempotencyKey?: string };

/** `byCategory`: loader sirf wahi candidates deta hai jo uski category ke hain (asli load_ad_candidates jaisa). */
function makeDeps(
  all: AdCandidate[],
  recordFor: (call: Call, n: number) => RecordResult = () => ({ outcome: "recorded" }),
  loadFails: string[] = [],
) {
  const calls: Call[] = [];
  const loads: string[] = [];
  const selects: string[] = [];
  const deps: ServeDeps = {
    authorize: async (): Promise<AuthorizeResult> => ({
      outcome: "ok",
      publisher: { id: PUB, status: "active" },
      unitCostUsd: 0.002,
    }),
    select: async (request, unitCostUsd): Promise<SelectionOutcome> => {
      selects.push(String(request.category));
      return selectAd(request, {
        loadCandidates: async (category) => {
          loads.push(category);
          if (loadFails.includes(category)) throw new Error("db down");
          return all.filter((c) => c.category === category);
        },
        now: () => NOW,
        unitCostUsd,
        spendTracking: "reliable",
      });
    },
    record: async (_h, creativeId, category, idempotencyKey) => {
      const call: Call = idempotencyKey === undefined ? { creativeId, category } : { creativeId, category, idempotencyKey };
      calls.push(call);
      return recordFor(call, calls.length);
    },
  };
  return { deps, calls, loads, selects };
}

const G1 = cid("a", 1);
const T1 = cid("b", 2);
const F1 = cid("c", 3);
const CG = cid("1", 1);
const CT = cid("2", 2);
const CF = cid("3", 3);
const gaming = () => cand(G1, CG, "gaming");
const tech = () => cand(T1, CT, "technology");
const fitness = () => cand(F1, CF, "fitness");

const req = (topic: string, fallbackTopics?: string[], extra: Record<string, unknown> = {}) => ({
  topic,
  excludeAdIds: [] as string[],
  ...(fallbackTopics ? { fallbackTopics } : {}),
  ...extra,
});

// ---------------------------------------------------------------------------------------------------------------------
describe("day 11 part 3 | request contract (validation.ts)", () => {
  it("old requests parse EXACTLY as before: no fallbackTopics key appears", () => {
    assert.deepEqual(parseMatchRequest('{"topic":"gaming"}'), { ok: true, value: { topic: "gaming", excludeAdIds: [] } });
    assert.deepEqual(parseMatchRequest('{"topic":"gaming","fallback_topics":[]}'), { ok: true, value: { topic: "gaming", excludeAdIds: [] } });
    const r = parseMatchRequest('{"topic":"gaming","fallback_topics":["gaming"]}');
    assert.deepEqual(r, { ok: true, value: { topic: "gaming", excludeAdIds: [] } }, "same as topic => dropped");
  });

  it("accepts up to 2 explicit slugs in order, removes duplicates", () => {
    assert.equal(MAX_FALLBACK_TOPICS, 2);
    assert.deepEqual(parseMatchRequest('{"topic":"gaming","fallback_topics":["technology","fitness"]}'), {
      ok: true,
      value: { topic: "gaming", excludeAdIds: [], fallbackTopics: ["technology", "fitness"] },
    });
    assert.deepEqual(parseMatchRequest('{"topic":"gaming","fallback_topics":["technology","technology"]}'), {
      ok: true,
      value: { topic: "gaming", excludeAdIds: [], fallbackTopics: ["technology"] },
    });
  });

  it("the other fields still work together with fallback_topics", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    const r = parseMatchRequest(`{"topic":"gaming","fallback_topics":["tech"],"exclude_ad_ids":["${id}"]}`);
    assert.deepEqual(r, { ok: true, value: { topic: "gaming", excludeAdIds: [id], fallbackTopics: ["tech"] } });
  });

  it("wrong types, shapes and strings => 400 invalid_topic (no new error reason)", () => {
    const bad: unknown[] = [
      null, "technology", 5, true, {}, { 0: "technology" }, [["technology"]], [null], [1], [{}], [true],
      ["technology", "fitness", "food"], // 3 > max 2
      ["Technology"], ["video games"], ["tech\n"], [" tech"], [""], ["x".repeat(51)], ["x".repeat(5000)],
      ["tech-nology"], ["tech;drop table"], ["' OR 1=1 --"], ["<script>alert(1)</script>"], ["../etc/passwd"],
      ["\u0000"], ["tech\u200b"], ["téch"], ["😀"], ["__proto__"].concat([5 as unknown as string]),
    ];
    for (const value of bad) {
      const raw = JSON.stringify({ topic: "gaming", fallback_topics: value });
      assert.deepEqual(parseMatchRequest(raw), { ok: false, reason: "invalid_topic" }, raw.slice(0, 80));
    }
  });

  it("slug-shaped odd values are accepted by the contract (they just never match anything later)", () => {
    for (const v of ["__proto__", "constructor", "health", "beauty", "unknown_topic"]) {
      const r = parseMatchRequest(JSON.stringify({ topic: "gaming", fallback_topics: [v] }));
      assert.equal(r.ok, true, v);
    }
  });

  it("raw question / prompt / page text / personal fields are still refused (unknown_field), also next to fallback_topics", () => {
    for (const field of [
      "question", "prompt", "query", "context", "messages", "conversation", "text", "page_content", "keywords", "user_query",
      "user_id", "email", "ip", "location", "age", "gender", "interests", "topics", "fallbackTopics", "fallback_topic",
    ]) {
      const raw = JSON.stringify({ topic: "gaming", fallback_topics: ["technology"], [field]: "how do I treat my back pain?" });
      assert.deepEqual(parseMatchRequest(raw), { ok: false, reason: "unknown_field" }, field);
    }
  });

  it("topic itself stays strict: free text, long strings, wrong types are refused", () => {
    for (const topic of ["how do I fix my laptop", "Gaming", "video games", "x".repeat(51), "", "gaming\n", 5, null, ["gaming"], {}, true]) {
      const raw = JSON.stringify({ topic, fallback_topics: ["technology"] });
      assert.deepEqual(parseMatchRequest(raw), { ok: false, reason: "invalid_topic" }, raw.slice(0, 60));
    }
  });

  it("garbage bodies are refused safely", () => {
    for (const raw of ["", "not json", "[]", "null", "5", '"gaming"', "{", '{"topic":"gaming","fallback_topics":', "{}"]) {
      const r = parseMatchRequest(raw);
      assert.equal(r.ok, false, raw);
    }
  });

  it("'__proto__' as a JSON KEY is refused and cannot pollute anything", () => {
    const r = parseMatchRequest('{"topic":"gaming","__proto__":{"fallbackTopics":["technology"]}}');
    assert.deepEqual(r, { ok: false, reason: "unknown_field" });
    assert.equal(({} as Record<string, unknown>).fallbackTopics, undefined);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("day 11 part 3 | serve.ts: deterministic, explainable fallback order", () => {
  it("no fallback_topics => exactly the old behaviour (one selection, one record)", async () => {
    const { deps, calls, selects } = makeDeps([gaming(), tech()]);
    const r = await serveAd("h", req("gaming"), deps);
    assert.equal(r.kind, "ad");
    assert.deepEqual(selects, ["gaming"]);
    assert.deepEqual(calls, [{ creativeId: G1, category: "gaming" }]);
  });

  it("topic wins when it has an eligible ad: fallbacks are not even loaded", async () => {
    const { deps, calls, loads } = makeDeps([gaming(), tech(), fitness()]);
    const r = await serveAd("h", req("gaming", ["technology", "fitness"]), deps);
    assert.equal(r.kind, "ad");
    assert.deepEqual(loads, ["gaming"]);
    assert.deepEqual(calls.map((c) => c.category), ["gaming"]);
  });

  it("topic has no eligible ad => first fallback that has one; recorded under the category actually served", async () => {
    const { deps, calls, loads } = makeDeps([tech(), fitness()]);
    const r = await serveAd("h", req("gaming", ["technology", "fitness"]), deps);
    assert.deepEqual(r, { kind: "ad", ad: { id: T1, headline: "H technology", body: "B", ctaText: null, destinationUrl: "https://example.com/x" } });
    assert.deepEqual(loads, ["gaming", "technology"]);
    assert.deepEqual(calls, [{ creativeId: T1, category: "technology" }]);
  });

  it("fallback ORDER is the publisher's order (not alphabetical, not by serve count)", async () => {
    const a = fitness();
    const b = tech();
    b.campaignServesToday = 0;
    a.campaignServesToday = 50;
    const { deps, calls } = makeDeps([a, b]);
    await serveAd("h", req("gaming", ["fitness", "technology"]), deps);
    assert.deepEqual(calls.map((c) => c.category), ["fitness"]);
  });

  it("aliases and messy casing work for fallbacks too (exact alias, not substring)", async () => {
    const { deps, calls } = makeDeps([tech()]);
    await serveAd("h", req("gaming", ["Tech"]), deps);
    assert.deepEqual(calls.map((c) => c.category), ["technology"]);
    const none = makeDeps([tech()]);
    assert.deepEqual(await serveAd("h", req("gaming", ["technolog", "tech_stuff"]), none.deps), { kind: "no_fill" });
    assert.deepEqual(none.calls, []);
  });

  it("an unsupported/legacy topic can still use the publisher's fallback; an empty plan is a safe no-fill", async () => {
    const a = makeDeps([tech()]);
    assert.equal((await serveAd("h", req("beauty", ["technology"]), a.deps)).kind, "ad");
    assert.deepEqual(a.loads, ["technology"], "unsupported topic is never loaded");
    const b = makeDeps([tech()]);
    assert.deepEqual(await serveAd("h", req("beauty", ["nothing_here"]), b.deps), { kind: "no_fill" });
    assert.deepEqual(b.loads, []);
  });

  it("SENSITIVE topic => no-fill and the fallback is NOT tried (no ad next to a sensitive context)", async () => {
    for (const topic of ["health", "religion", "politics", "mental_health", "Mental Health", "sexuality"]) {
      const { deps, loads, calls } = makeDeps([gaming(), tech()]);
      assert.deepEqual(await serveAd("h", req(topic, ["technology", "gaming"]), deps), { kind: "no_fill" }, topic);
      assert.deepEqual(loads, [], topic);
      assert.deepEqual(calls, [], topic);
    }
  });

  it("a SENSITIVE fallback entry is skipped, never served", async () => {
    const { deps, loads } = makeDeps([tech()]);
    const r = await serveAd("h", req("gaming", ["health", "technology"]), deps);
    assert.equal(r.kind, "ad");
    assert.deepEqual(loads, ["gaming", "technology"]);
    const only = makeDeps([tech()]);
    assert.deepEqual(await serveAd("h", req("gaming", ["religion"]), only.deps), { kind: "no_fill" });
    assert.deepEqual(only.loads, ["gaming"]);
  });

  it("fallback to the SAME category (alias of topic) is not loaded twice", async () => {
    const { deps, loads } = makeDeps([]);
    assert.deepEqual(await serveAd("h", req("gaming", ["games", "video_games"]), deps), { kind: "no_fill" });
    assert.deepEqual(loads, ["gaming"]);
  });

  it("everything empty => no-fill (200 {fill:false} at the route), never an error", async () => {
    const { deps, calls } = makeDeps([]);
    assert.deepEqual(await serveAd("h", req("gaming", ["technology", "fitness"]), deps), { kind: "no_fill" });
    assert.deepEqual(calls, []);
  });

  it("publisher's exclude list applies in every category; repeat only if no other eligible ad", async () => {
    const { deps, calls } = makeDeps([tech()]);
    await serveAd("h", req("gaming", ["technology"], { excludeAdIds: [T1] }), deps);
    assert.deepEqual(calls.map((c) => c.creativeId), [T1], "only ad in the category may repeat");
    const two = makeDeps([tech(), cand(cid("d", 4), cid("4", 4), "technology")]);
    await serveAd("h", req("gaming", ["technology"], { excludeAdIds: [T1] }), two.deps);
    assert.deepEqual(two.calls.map((c) => c.creativeId), [cid("d", 4)]);
  });

  it("Idempotency-Key is passed with the fallback category's record", async () => {
    const { deps, calls } = makeDeps([tech()]);
    await serveAd("h", req("gaming", ["technology"], { idempotencyKey: "retry-key-0001" }), deps);
    assert.deepEqual(calls, [{ creativeId: T1, category: "technology", idempotencyKey: "retry-key-0001" }]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("day 11 part 3 | eligibility checks stay intact in a fallback category", () => {
  const cases: Array<[string, Partial<AdCandidate>]> = [
    ["creative not approved", { creativeStatus: "pending_review" }],
    ["creative paused", { creativeStatus: "paused" }],
    ["campaign paused", { campaignStatus: "paused" }],
    ["campaign completed", { campaignStatus: "completed" }],
    ["campaign not started yet (schedule)", { startDate: "2026-10-29" }],
    ["campaign ended yesterday (schedule)", { endDate: "2026-10-27" }],
    ["total budget exhausted", { totalBudget: 5, spentTotal: 5 }],
    ["daily budget exhausted", { dailyBudget: 1, spentToday: 1 }],
    ["advertiser suspended", { advertiserStatus: "suspended" }],
    ["advertiser profile suspended", { advertiserProfileStatus: "suspended" }],
    ["campaign is in another category (mismatch)", { category: "fitness" }],
  ];
  for (const [name, over] of cases) {
    it(`${name} => never served via fallback`, async () => {
      const { deps, calls } = makeDeps([cand(T1, CT, "technology", over)]);
      assert.deepEqual(await serveAd("h", req("gaming", ["technology"]), deps), { kind: "no_fill" });
      assert.deepEqual(calls, []);
    });
  }

  it("ineligible first fallback is skipped; the next fallback is used", async () => {
    const { deps, calls } = makeDeps([cand(T1, CT, "technology", { campaignStatus: "paused" }), fitness()]);
    await serveAd("h", req("gaming", ["technology", "fitness"]), deps);
    assert.deepEqual(calls.map((c) => c.category), ["fitness"]);
  });

  it("publisher must be active: unauthorized/rate-limited/inactive never reach selection or fallbacks", async () => {
    for (const outcome of ["unauthorized", "rate_limited", "error"] as const) {
      const base = makeDeps([tech()]);
      const deps: ServeDeps = { ...base.deps, authorize: async () => ({ outcome }) as AuthorizeResult };
      const r = await serveAd("h", req("gaming", ["technology"]), deps);
      assert.equal(r.kind, outcome === "error" ? "unavailable" : outcome);
      assert.deepEqual(base.selects, []);
    }
    const base = makeDeps([tech()]);
    const deps: ServeDeps = {
      ...base.deps,
      authorize: async () => ({ outcome: "ok", publisher: { id: PUB, status: "suspended" }, unitCostUsd: 0.002 }),
    };
    assert.deepEqual(await serveAd("h", req("gaming", ["technology"]), deps), { kind: "no_fill" });
    assert.deepEqual(base.calls, []);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("day 11 part 3 | budget safety: one charge, bounded work", () => {
  it("DB rejects the topic's ad (budget race) => fallback's ad is tried; only ONE record succeeds", async () => {
    const { deps, calls } = makeDeps([gaming(), tech()], (c) => (c.category === "gaming" ? { outcome: "rejected" } : { outcome: "recorded" }));
    const r = await serveAd("h", req("gaming", ["technology"]), deps);
    assert.equal(r.kind, "ad");
    assert.deepEqual(calls.map((c) => c.category), ["gaming", "technology"]);
  });

  it("record calls are capped at 3 for the WHOLE request, across categories", async () => {
    const many = [
      cand(cid("a", 1), cid("1", 1), "gaming"),
      cand(cid("a", 2), cid("1", 2), "gaming"),
      cand(cid("b", 1), cid("2", 1), "technology"),
      cand(cid("b", 2), cid("2", 2), "technology"),
      cand(cid("c", 1), cid("3", 1), "fitness"),
    ];
    const { deps, calls, selects } = makeDeps(many, () => ({ outcome: "rejected" }));
    assert.deepEqual(await serveAd("h", req("gaming", ["technology", "fitness"]), deps), { kind: "no_fill" });
    assert.equal(calls.length, 3);
    assert.ok(selects.length <= 3);
  });

  it("record error stops everything (503), no guessing and no further tries", async () => {
    const { deps, calls } = makeDeps([gaming(), tech()], () => ({ outcome: "error" }));
    assert.deepEqual(await serveAd("h", req("gaming", ["technology"]), deps), { kind: "unavailable" });
    assert.equal(calls.length, 1);
  });

  it("DB read failure while loading a category = outage (503), not a silent no-fill", async () => {
    const a = makeDeps([tech()], undefined, ["gaming"]);
    assert.deepEqual(await serveAd("h", req("gaming", ["technology"]), a.deps), { kind: "unavailable" });
    const b = makeDeps([tech()], undefined, ["technology"]);
    assert.deepEqual(await serveAd("h", req("gaming", ["technology"]), b.deps), { kind: "unavailable" });
  });

  it("an unexpected throw anywhere becomes 'unavailable' (never throws)", async () => {
    const base = makeDeps([tech()]);
    const deps: ServeDeps = { ...base.deps, select: async () => { throw new Error("boom"); } };
    assert.deepEqual(await serveAd("h", req("gaming", ["technology"]), deps), { kind: "unavailable" });
  });

  it("garbage in the (internal) request does not crash: wrong types become no-fill/unavailable", async () => {
    const { deps } = makeDeps([tech()]);
    const weird = [
      { topic: "gaming", excludeAdIds: [], fallbackTopics: [5, null, {}, "technology"] },
      { topic: "gaming", excludeAdIds: [], fallbackTopics: "technology" },
      { topic: 7, excludeAdIds: [], fallbackTopics: ["technology"] },
    ] as unknown as Parameters<typeof serveAd>[1][];
    for (const w of weird) {
      const r = await serveAd("h", w, deps);
      assert.ok(["ad", "no_fill", "unavailable"].includes(r.kind));
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

for (const route of ROUTES) {
  describe(`day 11 part 3 | ${route.name}: end to end (fake DB)`, () => {
    function world() {
      const pub = db.addPublisher("active");
      db.addKey(pub.id, KEY);
      const adv = db.addAdvertiser("active");
      return { pub, adv };
    }

    it("old request shape: same response, same single charge", async () => {
      const { pub, adv } = world();
      const ad = db.addAd(adv.id, { category: "gaming" });
      const res = await post(route, '{"topic":"gaming"}');
      const body = (await res.json()) as { fill: boolean; sponsored: boolean; ad: { id: string } };
      assert.equal(res.status, 200);
      assert.deepEqual(Object.keys(body).sort(), ["ad", "fill", "sponsored"]);
      assert.equal(body.ad.id, ad.creativeId);
      assert.equal(db.servesFor(pub.id).length, 1);
    });

    it("fallback_topics serves a technology ad when gaming has none; log stores the served canonical category; one charge", async () => {
      const { pub, adv } = world();
      const t = db.addAd(adv.id, { category: "technology" });
      const res = await post(route, '{"topic":"gaming","fallback_topics":["technology"]}');
      const body = (await res.json()) as { fill: boolean; ad: { id: string } };
      assert.equal(res.status, 200);
      assert.equal(body.fill, true);
      assert.equal(body.ad.id, t.creativeId);
      assert.deepEqual(db.servesFor(pub.id).map((s) => s.topic), ["technology"]);
      assert.equal(db.spendOf(t.campaignId), db.unitCostUsd);
    });

    it("response shape is unchanged: no category, no fallback info, no extra keys", async () => {
      const { adv } = world();
      db.addAd(adv.id, { category: "technology" });
      const res = await post(route, '{"topic":"gaming","fallback_topics":["technology"]}');
      const text = await res.text();
      const body = JSON.parse(text) as Record<string, unknown>;
      assert.deepEqual(Object.keys(body).sort(), ["ad", "fill", "sponsored"]);
      assert.deepEqual(Object.keys(body.ad as object).sort(), ["body", "cta_text", "destination_url", "headline", "id"]);
      assert.equal(/fallback|technology|category/i.test(text), false);
    });

    it("topic is preferred: gaming ad served, technology campaign is not charged", async () => {
      const { adv } = world();
      const g = db.addAd(adv.id, { category: "gaming" });
      const t = db.addAd(adv.id, { category: "technology" });
      const res = await post(route, '{"topic":"gaming","fallback_topics":["technology"]}');
      assert.equal(((await res.json()) as { ad: { id: string } }).ad.id, g.creativeId);
      assert.equal(db.spendOf(t.campaignId), 0);
    });

    it("no ad anywhere => 200 {fill:false}; nothing charged", async () => {
      world();
      const res = await post(route, '{"topic":"gaming","fallback_topics":["technology","fitness"]}');
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { fill: false });
      assert.equal(db.serveLog.length, 0);
    });

    it("sensitive topic => {fill:false} even if the fallback has an ad", async () => {
      const { adv } = world();
      const t = db.addAd(adv.id, { category: "technology" });
      const res = await post(route, '{"topic":"health","fallback_topics":["technology"]}');
      assert.deepEqual(await res.json(), { fill: false });
      assert.equal(db.spendOf(t.campaignId), 0);
      assert.equal(db.rpcCount("load_ad_candidates"), 0);
    });

    for (const [name, opts] of [
      ["paused campaign", { campaignStatus: "paused" }],
      ["unapproved creative", { creativeStatus: "pending_review" as const }],
      ["not started", { startDate: "2999-01-01" }],
      ["ended", { endDate: "2020-01-02" }],
      ["budget exhausted", { totalBudget: 0.001 }],
    ] as const) {
      it(`fallback category with ${name} is not served and not charged`, async () => {
        const { adv } = world();
        const t = db.addAd(adv.id, { category: "technology", ...opts });
        const res = await post(route, '{"topic":"gaming","fallback_topics":["technology"]}');
        assert.deepEqual(await res.json(), { fill: false }, name);
        assert.equal(db.spendOf(t.campaignId), 0);
      });
    }

    it("bad fallback_topics => 400 invalid_topic before any database call", async () => {
      world();
      const before = db.calls.length;
      const res = await post(route, '{"topic":"gaming","fallback_topics":["how do I fix my back pain"]}');
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { error: "invalid_request", reason: "invalid_topic" });
      assert.equal(db.calls.length, before);
    });

    it("raw question text is refused (400 unknown_field), never reaches the database, never logged", async () => {
      world();
      const secret = "my-secret-question-about-my-diabetes";
      const res = await post(route, JSON.stringify({ topic: "gaming", question: secret }));
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { error: "invalid_request", reason: "unknown_field" });
      assert.equal(JSON.stringify(db.calls).includes(secret), false);
      assert.equal(logged.join("\n").includes(secret), false);
    });

    it("very long input => 413 (declared or streamed), nothing logged or stored", async () => {
      world();
      const long = "x".repeat(MAX_BODY_BYTES + 10);
      const res = await post(route, JSON.stringify({ topic: "gaming", fallback_topics: [long] }));
      assert.equal(res.status, 413);
      assert.deepEqual(await res.json(), { error: "payload_too_large" });
      assert.equal(logged.join("\n").includes(long.slice(0, 50)), false);
      assert.equal(db.rpcCount("load_ad_candidates"), 0);
    });

    it("topic and fallback strings are never logged, even for unsupported/sensitive values", async () => {
      const { adv } = world();
      db.addAd(adv.id, { category: "technology" });
      await post(route, '{"topic":"zzz_unique_topic_marker","fallback_topics":["yyy_unique_fb_marker","technology"]}');
      await post(route, '{"topic":"health","fallback_topics":["technology"]}');
      const all = logged.join("\n");
      assert.equal(all.includes("zzz_unique_topic_marker"), false);
      assert.equal(all.includes("yyy_unique_fb_marker"), false);
    });

    it("retry with the same Idempotency-Key does not charge twice", async () => {
      const { adv } = world();
      const t = db.addAd(adv.id, { category: "technology" });
      const send = () =>
        route.post(
          new Request("https://example.test/x", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, "idempotency-key": "retry-key-0001" },
            body: '{"topic":"gaming","fallback_topics":["technology"]}',
          }),
        );
      const a = (await (await send()).json()) as { ad: { id: string } };
      const b = (await (await send()).json()) as { ad: { id: string } };
      assert.equal(a.ad.id, t.creativeId);
      assert.equal(b.ad.id, t.creativeId);
      assert.equal(db.spendOf(t.campaignId), db.unitCostUsd);
      assert.equal(db.serveLog.length, 1);
    });
  });
}
