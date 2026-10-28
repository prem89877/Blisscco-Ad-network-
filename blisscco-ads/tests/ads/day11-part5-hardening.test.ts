import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import * as legacyRoute from "@/app/api/ads/match/route";
import * as v1Route from "@/app/api/v1/ads/match/route";
import { handleMatchPost } from "@/lib/ads/match-handler";
import { createIpGuard } from "@/lib/ads/ip-guard";
import { candidateIneligibility, resolveCategory, type AdCandidate } from "@/lib/ads/category-matching";
import { CATEGORY_ALIASES } from "@/lib/ads/taxonomy";
import { selectAd } from "@/lib/ads/selection";
import { serveAd, type ServeDeps } from "@/lib/ads/serve";
import { parseMatchRequest, MAX_BODY_BYTES } from "@/lib/ads/validation";
import { FakeAdDb, makeKey } from "./fake-ad-db";

// Day 11 Part 5: matching tests ko majboot karna + bugs pakadna.
// Sab kuch nakli data se: FakeAdDb (SQL ka model) ya seedhe fake deps. Asli Supabase / production KABHI nahi chhuta.
// Is file ka kaam sirf SELECT + serve RECORD hai. Impression/click ginti aur Revive Adserver yahan nahi hain.

const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
const realError = console.error;
const ROOT = path.resolve(__dirname, "../../..");

const PUB = "99999999-9999-4999-8999-999999999999";
const NOW = new Date("2026-10-28T12:00:00Z");
const CAMP_A = "11111111-1111-4111-8111-111111111111";
const CAMP_B = "22222222-2222-4222-8222-222222222222";
const cid = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;

function cand(creative: string, campaign: string, over: Partial<AdCandidate> = {}): AdCandidate {
  return {
    ad: { id: creative, headline: "Headline", body: "Body", ctaText: null, destinationUrl: "https://example.com/x" },
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
const ctx = { today: "2026-10-28", unitCostUsd: 0.002 };
const select = (cands: AdCandidate[], category: unknown = "gaming", exclude: string[] = []) =>
  selectAd(
    { publisher: { id: PUB, status: "active" }, category, excludeCreativeIds: exclude },
    { loadCandidates: async (c) => cands.filter((x) => x.category === c), now: () => NOW, unitCostUsd: 0.002, spendTracking: "reliable" },
  );

// ---------------------------------------------------------------------------------------------------------------------
describe("day 11 part 5 | category matching: exact, alias, casing, whitespace, unknown, ambiguous", () => {
  it("every declared alias resolves to exactly its own canonical slug", () => {
    for (const [slug, aliases] of Object.entries(CATEGORY_ALIASES)) {
      assert.deepEqual(resolveCategory(slug), { ok: true, category: slug });
      for (const alias of aliases) assert.deepEqual(resolveCategory(alias), { ok: true, category: slug }, `alias ${alias}`);
    }
  });

  it("no alias is shared by two categories (ambiguous alias would be a wrong-ad risk)", () => {
    const owner = new Map<string, string>();
    for (const [slug, aliases] of Object.entries(CATEGORY_ALIASES)) {
      for (const name of [slug, ...aliases]) {
        assert.equal(owner.has(name), false, `${name} belongs to both ${owner.get(name)} and ${slug}`);
        owner.set(name, slug);
      }
    }
  });

  it("casing, surrounding whitespace, hyphen and space separators are cleaned by the resolver", () => {
    for (const raw of ["GAMING", "Gaming", "  gaming  ", "gaming\t", "Video Games", "video-games", "VIDEO_GAMES"]) {
      assert.deepEqual(resolveCategory(raw), { ok: true, category: "gaming" }, JSON.stringify(raw));
    }
  });

  it("unknown, partial, longer and look-alike values never resolve (no substring/fuzzy matching)", () => {
    for (const raw of ["game", "gamin", "gamings", "gaming_pro", "pc_gaming", "tech_news", "technolog", "ai", "e-sports", "gaming gaming gaming gaming", "gaming.", "gаming" /* cyrillic a */]) {
      const r = resolveCategory(raw);
      assert.equal(r.ok, false, JSON.stringify(raw));
    }
  });

  it("missing / wrong-typed context never resolves", () => {
    for (const raw of [undefined, null, 0, 1, true, false, {}, [], ["gaming"], { topic: "gaming" }, () => "gaming", Symbol("x"), 10n, NaN]) {
      assert.deepEqual(resolveCategory(raw), { ok: false, reason: "not_a_string" });
    }
    assert.deepEqual(resolveCategory(""), { ok: false, reason: "empty" });
    assert.deepEqual(resolveCategory("   "), { ok: false, reason: "empty" });
  });

  it("object-prototype names are plain unsupported values, never a crash or a match", () => {
    for (const raw of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
      assert.deepEqual(resolveCategory(raw), { ok: false, reason: "unsupported_category" });
    }
  });

  it("sensitive and legacy-inactive categories are refused with their own reasons", () => {
    assert.deepEqual(resolveCategory("health"), { ok: false, reason: "sensitive_category" });
    assert.deepEqual(resolveCategory("Mental Health"), { ok: false, reason: "sensitive_category" });
    assert.deepEqual(resolveCategory("beauty"), { ok: false, reason: "unsupported_category" });
  });

  it("selection: only the matching category's campaigns can ever be picked (irrelevant categories are a hard gate)", async () => {
    const list = [
      cand(cid(1), CAMP_A, { category: "travel", campaignServesToday: 0 }),
      cand(cid(2), CAMP_B, { category: "gaming", campaignServesToday: 99 }),
    ];
    const o = await select(list, "gaming");
    assert.equal(o.fill && o.ad.id, cid(2)); // heavily served but relevant beats a fresh irrelevant one
    // the loader is asked only for the resolved canonical category (alias -> slug)
    const asked: string[] = [];
    await selectAd(
      { publisher: { id: PUB, status: "active" }, category: "Video Games" },
      { loadCandidates: async (c) => { asked.push(c); return []; }, now: () => NOW, unitCostUsd: 0.002, spendTracking: "reliable" },
    );
    assert.deepEqual(asked, ["gaming"]);
  });

  it("selection: a candidate whose stored category differs only by case is NOT matched (strict database slug)", async () => {
    const o = await select([cand(cid(1), CAMP_A, { category: "Gaming" })], "gaming");
    // loader (fake) filters by ===, so use matcher directly too
    assert.equal(o.fill, false);
    assert.equal(candidateIneligibility(cand(cid(1), CAMP_A, { category: "Gaming" }), "gaming", ctx), "category_mismatch");
  });

  it("selection: unknown / sensitive / missing category never reaches the database loader", async () => {
    let loads = 0;
    const deps = { loadCandidates: async () => { loads += 1; return []; }, now: () => NOW, unitCostUsd: 0.002, spendTracking: "reliable" as const };
    for (const category of ["nope", "health", "", undefined, null, 5, {}, []]) {
      const o = await selectAd({ publisher: { id: PUB, status: "active" }, category }, deps);
      assert.equal(o.fill, false);
    }
    assert.equal(loads, 0);
  });

  it("API layer is stricter than the resolver (documented contract): casing/whitespace in `topic` => 400 invalid_topic", () => {
    for (const raw of ["Gaming", " gaming", "gaming ", "video-games", "gaming\n", "x".repeat(51)]) {
      assert.deepEqual(parseMatchRequest(JSON.stringify({ topic: raw })), { ok: false, reason: "invalid_topic" }, JSON.stringify(raw));
    }
    assert.equal(parseMatchRequest(JSON.stringify({ topic: "video_games" })).ok, true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("day 11 part 5 | campaign eligibility matrix (paused, unapproved, scheduled, expired, budget)", () => {
  const cases: Array<[string, Partial<AdCandidate>, string | null]> = [
    ["eligible", {}, null],
    ["campaign paused", { campaignStatus: "paused" }, "campaign_not_active"],
    ["campaign draft", { campaignStatus: "draft" }, "campaign_not_active"],
    ["campaign completed", { campaignStatus: "completed" }, "campaign_not_active"],
    ["creative pending_review", { creativeStatus: "pending_review" }, "creative_not_approved"],
    ["creative rejected", { creativeStatus: "rejected" }, "creative_not_approved"],
    ["creative paused", { creativeStatus: "paused" }, "creative_not_approved"],
    ["creative archived", { creativeStatus: "archived" }, "creative_not_approved"],
    ["advertiser pending", { advertiserStatus: "pending" }, "advertiser_not_active"],
    ["advertiser suspended", { advertiserStatus: "suspended" }, "advertiser_not_active"],
    ["advertiser profile suspended", { advertiserProfileStatus: "suspended" }, "advertiser_profile_not_active"],
    ["scheduled (starts tomorrow)", { startDate: "2026-10-29" }, "not_started"],
    ["starts today (inclusive)", { startDate: "2026-10-28" }, null],
    ["ended yesterday", { endDate: "2026-10-27" }, "ended"],
    ["ends today (inclusive)", { endDate: "2026-10-28" }, null],
    ["end before start", { startDate: "2026-10-20", endDate: "2026-10-10" }, "ended"],
    ["total budget fully spent", { totalBudget: 1, spentTotal: 1 }, "total_budget_exhausted"],
    ["total budget one unit short", { totalBudget: 1, spentTotal: 0.999 }, "total_budget_exhausted"],
    ["total budget exactly one unit left", { totalBudget: 1, spentTotal: 0.998 }, null],
    ["overspent (spent > budget)", { totalBudget: 1, spentTotal: 5 }, "total_budget_exhausted"],
    ["zero total budget", { totalBudget: 0 }, "total_budget_exhausted"],
    ["daily budget spent", { dailyBudget: 0.01, spentToday: 0.01 }, "daily_budget_exhausted"],
    ["daily budget zero", { dailyBudget: 0 }, "daily_budget_exhausted"],
    ["daily budget exactly one unit left", { dailyBudget: 0.01, spentToday: 0.008 }, null],
    ["daily budget null = no daily cap", { dailyBudget: null, spentToday: 9999 }, null],
  ];
  for (const [name, over, expected] of cases) {
    it(`${name} => ${expected ?? "eligible"}`, async () => {
      assert.equal(candidateIneligibility(cand(cid(1), CAMP_A, over), "gaming", ctx), expected);
      const o = await select([cand(cid(1), CAMP_A, over)]);
      assert.equal(o.fill, expected === null, "selection must agree with the eligibility rule");
    });
  }

  it("malformed candidates (NaN, negative, string numbers, bad dates, bad ids, null ad) are skipped, never served", async () => {
    const bad: Array<Partial<AdCandidate>> = [
      { totalBudget: Number.NaN },
      { totalBudget: -1 },
      { spentTotal: Number.POSITIVE_INFINITY },
      { spentToday: "1" as unknown as number },
      { dailyBudget: "5" as unknown as number },
      { startDate: "2026-02-30" },
      { startDate: "28/10/2026" },
      { endDate: "not-a-date" },
      { campaignId: "nope" },
      { ad: null as unknown as AdCandidate["ad"] },
      { ad: { id: "nope", headline: "H", body: "B", ctaText: null, destinationUrl: "https://e.com" } },
      { campaignServesToday: -1 },
      { campaignServesToday: 1.5 },
    ];
    for (const over of bad) {
      const o = await select([cand(cid(1), CAMP_A, over)]);
      assert.equal(o.fill, false, JSON.stringify(over));
    }
    // and one bad row never blocks a good one
    const mixed = await select([cand(cid(1), CAMP_A, { totalBudget: Number.NaN }), cand(cid(2), CAMP_B)]);
    assert.equal(mixed.fill && mixed.ad.id, cid(2));
  });

  it("incomplete or unsafe creatives are never served (empty text, too long, http, userinfo URL, whitespace URL)", () => {
    const base = cand(cid(1), CAMP_A).ad;
    const bad = [
      { headline: "" }, { headline: "   " }, { headline: "x".repeat(91) }, { body: "" }, { body: "x".repeat(301) },
      { ctaText: "" }, { ctaText: "x".repeat(31) },
      { destinationUrl: "http://example.com/x" }, { destinationUrl: "javascript:alert(1)" }, { destinationUrl: "https://trusted.com@evil.com/x" },
      { destinationUrl: "https://example.com/a b" }, { destinationUrl: "https://" }, { destinationUrl: `https://example.com/${"a".repeat(2100)}` },
    ];
    for (const over of bad) {
      assert.equal(candidateIneligibility(cand(cid(1), CAMP_A, { ad: { ...base, ...over } }), "gaming", ctx), "creative_incomplete", JSON.stringify(over).slice(0, 80));
    }
    // "@" later in the path is fine
    assert.equal(candidateIneligibility(cand(cid(1), CAMP_A, { ad: { ...base, destinationUrl: "https://example.com/a@b" } }), "gaming", ctx), null);
  });

  it("control characters / invisible characters in creative text or URL are rejected (found by this test: they were accepted before)", () => {
    const base = cand(cid(1), CAMP_A).ad;
    const bad = [
      { destinationUrl: "https://example.com/\u0000x" },
      { destinationUrl: "https://example.com/\u0001x" },
      { destinationUrl: "https://example.com/\u007fx" },
      { destinationUrl: "https://exa\u200bmple.com/x" },
      { destinationUrl: "https://example.com/\u202ex" },
      { headline: "ab\u0000cd" },
      { headline: "ab\u202ecd" },
      { body: "ab\u0007cd" },
      { ctaText: "Buy\u0000" },
    ];
    for (const over of bad) {
      assert.equal(candidateIneligibility(cand(cid(1), CAMP_A, { ad: { ...base, ...over } }), "gaming", ctx), "creative_incomplete", JSON.stringify(over));
    }
    // legitimate text is untouched: newline/tab in body, emoji with ZWJ, accents
    for (const over of [{ body: "Line one\nLine two\tend" }, { headline: "Café ☕ 👨‍👩‍👧 deal" }]) {
      assert.equal(candidateIneligibility(cand(cid(1), CAMP_A, { ad: { ...base, ...over } }), "gaming", ctx), null, JSON.stringify(over));
    }
  });

  it("HTML in a headline is returned as inert text (escaping is the publisher's job) and extra candidate fields never leak", async () => {
    const c = cand(cid(1), CAMP_A, { ad: { id: cid(1), headline: "<b>x</b>", body: "B", ctaText: null, destinationUrl: "https://example.com/x" } });
    (c as unknown as Record<string, unknown>).advertiserId = "secret-advertiser";
    (c.ad as unknown as Record<string, unknown>).internalNote = "secret";
    const o = await select([c]);
    assert.equal(o.fill, true);
    if (o.fill) {
      assert.deepEqual(Object.keys(o.ad).sort(), ["body", "ctaText", "destinationUrl", "headline", "id"]);
      assert.equal(JSON.stringify(o).includes("secret"), false);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("day 11 part 5 | selection never counts anything (no impression/click/spend inside matching)", () => {
  it("selectAd only calls the injected read-only loader: nothing else is touched", async () => {
    let loaderCalls = 0;
    const o = await selectAd(
      { publisher: { id: PUB, status: "active" }, category: "gaming" },
      { loadCandidates: async () => { loaderCalls += 1; return [cand(cid(1), CAMP_A)]; }, now: () => NOW, unitCostUsd: 0.002, spendTracking: "reliable" },
    );
    assert.equal(o.fill, true);
    assert.equal(loaderCalls, 1);
  });

  it("running selection 50 times over the same candidates changes no counters and returns the same ad", async () => {
    const list = [cand(cid(1), CAMP_A), cand(cid(2), CAMP_B)];
    const snapshot = JSON.stringify(list);
    const first = await select(list);
    for (let i = 0; i < 50; i++) assert.deepEqual(await select(list), first);
    assert.equal(JSON.stringify(list), snapshot, "candidate objects must not be mutated by selection");
  });

  it("matching code contains no impression / click / revive accounting (source scan)", () => {
    const dir = path.join(ROOT, "lib/ads");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
      const code = readFileSync(path.join(dir, f), "utf8")
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join("\n");
      assert.equal(/revive|impression_count|click_count|record_impression|record_click|track_click/i.test(code), false, f);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("day 11 part 5 | selection bugs found by tests (excluded-but-eligible ad after DB reject)", () => {
  // POLICY DECISION PENDING (owner): today an excluded (recently shown) creative is never tried as a fallback, so when the only fresh ad is
  // rejected by the DB (budget/pause race) the result is {fill:false} even though an excluded creative is still eligible. Part 1 test
  // "nextAds ... never include ... excluded creatives" pins the current behaviour, so this is NOT changed without approval.
  it("fresh ad rejected by the DB at record time => the still-eligible excluded ad is served (not a no-fill)", { todo: "owner decision: exclude list soft vs hard" }, async () => {
    const FRESH = cid(1);
    const SEEN = cid(2);
    const recorded: string[] = [];
    const deps: ServeDeps = {
      authorize: async () => ({ outcome: "ok", publisher: { id: PUB, status: "active" }, unitCostUsd: 0.002 }),
      select: (request, unit) =>
        selectAd(request, {
          loadCandidates: async () => [cand(FRESH, CAMP_A), cand(SEEN, CAMP_B)],
          now: () => NOW,
          unitCostUsd: unit,
          spendTracking: "reliable",
        }),
      record: async (_k, creative) => {
        recorded.push(creative);
        return creative === FRESH ? { outcome: "rejected" } : { outcome: "recorded" };
      },
    };
    const r = await serveAd("h".repeat(64), { topic: "gaming", excludeAdIds: [SEEN] }, deps);
    assert.deepEqual(r.kind === "ad" ? r.ad.id : r.kind, SEEN);
    assert.deepEqual(recorded, [FRESH, SEEN]); // fresh first (publisher preference), repeat only after it was rejected
  });

  it("with no DB reject the fresh ad still wins over the excluded one, and only ONE record call is made", async () => {
    const recorded: string[] = [];
    const deps: ServeDeps = {
      authorize: async () => ({ outcome: "ok", publisher: { id: PUB, status: "active" }, unitCostUsd: 0.002 }),
      select: (request, unit) =>
        selectAd(request, {
          loadCandidates: async () => [cand(cid(2), CAMP_A), cand(cid(1), CAMP_B)],
          now: () => NOW, unitCostUsd: unit, spendTracking: "reliable",
        }),
      record: async (_k, creative) => { recorded.push(creative); return { outcome: "recorded" }; },
    };
    const r = await serveAd("h".repeat(64), { topic: "gaming", excludeAdIds: [cid(2)] }, deps);
    assert.equal(r.kind === "ad" && r.ad.id, cid(1));
    assert.deepEqual(recorded, [cid(1)]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Route level (FakeAdDb): auth, malformed input, outages, concurrency, response format.
type RouteDef = { name: string; post: (r: Request) => Promise<Response>; versioned: boolean };
const ROUTES: RouteDef[] = [
  { name: "legacy /api/ads/match", post: legacyRoute.POST, versioned: false },
  { name: "v1 /api/v1/ads/match", post: v1Route.POST, versioned: true },
];
const KEY_A = makeKey("a");
const KEY_B = makeKey("b");
let db: FakeAdDb;
let logged: unknown[][];

beforeEach(() => {
  logged = [];
  console.error = (...a: unknown[]) => { logged.push(a); };
  db = new FakeAdDb();
  globals.__TEST_SUPABASE__ = db.client();
});
afterEach(() => { console.error = realError; });

function world(adOpts: Parameters<FakeAdDb["addAd"]>[1] = {}) {
  const pub = db.addPublisher("active");
  db.addKey(pub.id, KEY_A);
  const adv = db.addAdvertiser("active");
  const ad = db.addAd(adv.id, { category: "gaming", ...adOpts });
  return { pub, adv, ad };
}

function req(body: BodyInit | null, headers: Record<string, string> = {}, key: string | null = KEY_A): Request {
  const h: Record<string, string> = { "content-type": "application/json", ...headers };
  if (key) h.authorization = `Bearer ${key}`;
  return new Request("https://example.test/api/ads/match", { method: "POST", headers: h, body });
}
async function call(route: RouteDef, body: unknown, headers: Record<string, string> = {}, key: string | null = KEY_A) {
  const res = await route.post(req(JSON.stringify(body), headers, key));
  const text = await res.text();
  return { res, text, json: JSON.parse(text) as Record<string, unknown> };
}

for (const route of ROUTES) {
  describe(`day 11 part 5 | ${route.name} | publisher key problems`, () => {
    it("missing / malformed / wrong-case / wrong-length keys => 401, and the database is never asked", async () => {
      world();
      const bad: Array<string | null> = [null, "blc_live_", "blc_live_" + "a".repeat(63), "blc_live_" + "a".repeat(65), "blc_live_" + "A".repeat(64), "blc_test_" + "a".repeat(64), "a".repeat(64), "blc_live_" + "g".repeat(64)];
      for (const key of bad) {
        const r = await call(route, { topic: "gaming" }, {}, key);
        assert.equal(r.res.status, 401, String(key));
        assert.deepEqual(r.json, { error: "unauthorized" });
      }
      assert.equal(db.calls.length, 0);
    });

    it("Authorization with a different scheme, extra tokens or key only in the body => 401", async () => {
      world();
      for (const header of [`Basic ${KEY_A}`, `Bearer ${KEY_A} extra`, KEY_A, `Token ${KEY_A}`]) {
        const res = await route.post(req(JSON.stringify({ topic: "gaming" }), { authorization: header }, null));
        assert.equal(res.status, 401, header);
      }
      const inBody = await route.post(req(JSON.stringify({ topic: "gaming", api_key: KEY_A }), {}, null));
      assert.equal(inBody.status, 401);
      assert.equal(db.calls.length, 0);
    });

    it("unknown key, revoked key and expired key all get the SAME 401 body (no way to tell them apart)", async () => {
      const { pub } = world();
      db.addKey(pub.id, makeKey("c"), { status: "revoked" });
      db.addKey(pub.id, makeKey("d"), { expiresInMs: -1000 });
      const results = [];
      for (const key of [makeKey("9"), makeKey("c"), makeKey("d")]) {
        const r = await call(route, { topic: "gaming" }, {}, key);
        assert.equal(r.res.status, 401);
        results.push(r.text);
      }
      assert.equal(new Set(results).size, 1);
    });

    it("a key revoked in the middle stops serving at once, and the spend stops with it", async () => {
      const { pub } = world();
      assert.equal((await call(route, { topic: "gaming" })).res.status, 200);
      const before = db.servesFor(pub.id).length;
      db.revokeKey(KEY_A);
      const r = await call(route, { topic: "gaming" });
      assert.equal(r.res.status, 401);
      assert.equal(db.servesFor(pub.id).length, before);
    });

    it("suspended publisher, or publisher whose profile is suspended => 401, nothing recorded", async () => {
      const { pub } = world();
      db.setPublisherStatus(pub.id, "suspended");
      assert.equal((await call(route, { topic: "gaming" })).res.status, 401);
      db.setPublisherStatus(pub.id, "active");
      db.setProfileStatus(pub.id, "suspended");
      assert.equal((await call(route, { topic: "gaming" })).res.status, 401);
      assert.equal(db.serveLog.length, 0);
    });

    it("publisher A can never write to publisher B: serves are logged against the key's own publisher, even with B's Idempotency-Key", async () => {
      const a = db.addPublisher("active");
      db.addKey(a.id, KEY_A);
      const b = db.addPublisher("active");
      db.addKey(b.id, KEY_B);
      const adv = db.addAdvertiser("active");
      db.addAd(adv.id, { category: "gaming", totalBudget: 10 });
      const first = await call(route, { topic: "gaming" }, { "idempotency-key": "shared-key-1" }, KEY_A);
      const second = await call(route, { topic: "gaming" }, { "idempotency-key": "shared-key-1" }, KEY_B);
      assert.equal(first.res.status, 200);
      assert.equal(second.res.status, 200);
      assert.equal(db.servesFor(a.id).length, 1);
      assert.equal(db.servesFor(b.id).length, 1, "B's retry key space is separate: it is a new serve, not A's replay");
    });
  });

  describe(`day 11 part 5 | ${route.name} | malformed, oversized and wrong-typed requests`, () => {
    it("bad JSON shapes => 400 invalid_request with a fixed reason; the database is never asked", async () => {
      world();
      const cases: Array<[string, string]> = [
        ["", "invalid_json"], ["{", "invalid_json"], ["not json", "invalid_json"],
        ["null", "invalid_body"], ["[]", "invalid_body"], ["\"gaming\"", "invalid_body"], ["42", "invalid_body"], ["true", "invalid_body"],
        ["{}", "invalid_topic"], ['{"topic":null}', "invalid_topic"], ['{"topic":123}', "invalid_topic"], ['{"topic":["gaming"]}', "invalid_topic"],
        ['{"topic":{"a":1}}', "invalid_topic"], ['{"topic":""}', "invalid_topic"], ['{"topic":"gaming","fallback_topics":"tech"}', "invalid_topic"],
        ['{"topic":"gaming","fallback_topics":[1]}', "invalid_topic"], ['{"topic":"gaming","fallback_topics":["a","b","c"]}', "invalid_topic"],
        ['{"topic":"gaming","exclude_ad_ids":"x"}', "invalid_exclude_ad_ids"], ['{"topic":"gaming","exclude_ad_ids":[1]}', "invalid_exclude_ad_ids"],
        ['{"topic":"gaming","exclude_ad_ids":["not-a-uuid"]}', "invalid_exclude_ad_ids"], ['{"topic":"gaming","exclude_ad_ids":null}', "invalid_exclude_ad_ids"],
        ['{"topic":"gaming","prompt":"hello"}', "unknown_field"], ['{"topic":"gaming","__proto__":{"x":1}}', "unknown_field"], ['{"topic":"gaming","constructor":1}', "unknown_field"],
      ];
      for (const [body, reason] of cases) {
        const res = await route.post(req(body));
        const json = (await res.json()) as Record<string, unknown>;
        assert.equal(res.status, 400, body);
        assert.deepEqual(json, { error: "invalid_request", reason }, body);
      }
      assert.equal(db.calls.length, 0);
    });

    it("a UTF-8 BOM at the start of the body is stripped by the HTTP decoder (standard) and the request works; the pure parser stays strict", async () => {
      world();
      assert.equal((await route.post(req("\ufeff{\"topic\":\"gaming\"}"))).status, 200);
      assert.deepEqual(parseMatchRequest("\ufeff{\"topic\":\"gaming\"}"), { ok: false, reason: "invalid_json" });
    });

    it("more than 20 exclude ids => 400; exactly 20 is fine", async () => {
      world();
      const ids = (n: number) => Array.from({ length: n }, (_, i) => cid(i + 1));
      assert.equal((await call(route, { topic: "gaming", exclude_ad_ids: ids(21) })).res.status, 400);
      assert.equal((await call(route, { topic: "gaming", exclude_ad_ids: ids(20) })).res.status, 200);
    });

    it("oversized body: declared length, streamed length and multi-byte characters are all counted in BYTES => 413", async () => {
      world();
      const big = JSON.stringify({ topic: "gaming", exclude_ad_ids: [], pad: "x".repeat(MAX_BODY_BYTES) });
      const declared = await route.post(req(big, { "content-length": String(big.length) }));
      assert.equal(declared.status, 413);
      // no content-length at all (chunked)
      const enc = new TextEncoder().encode(big);
      const stream = new ReadableStream<Uint8Array>({
        start(c) { for (let i = 0; i < enc.length; i += 500) c.enqueue(enc.slice(i, i + 500)); c.close(); },
      });
      const chunked = await route.post(new Request("https://example.test/x", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${KEY_A}` }, body: stream, duplex: "half" } as RequestInit));
      assert.equal(chunked.status, 413);
      // 1100 two-byte characters = 2200 bytes (> 2048) although only 1100 characters
      const multi = JSON.stringify({ topic: "gaming", note: "é".repeat(1100) });
      assert.equal((await route.post(req(multi))).status, 413);
      assert.equal(db.calls.length, 0);
    });

    it("a body just under the limit is read normally (no off-by-one)", async () => {
      world();
      const pad = JSON.stringify({ topic: "gaming" });
      const body = pad + " ".repeat(MAX_BODY_BYTES - pad.length);
      assert.equal(new TextEncoder().encode(body).length, MAX_BODY_BYTES);
      assert.equal((await route.post(req(body))).status, 200);
    });

    it("wrong / missing content-type => 415; garbage content-length does not break reading", async () => {
      world();
      for (const ct of ["text/plain", "application/jsonp", "application/json-patch+json", "multipart/form-data", "application/json; charset=latin1"]) {
        const res = await route.post(req(JSON.stringify({ topic: "gaming" }), { "content-type": ct }));
        assert.equal(res.status, 415, ct);
      }
      const noCt = new Request("https://example.test/x", { method: "POST", headers: { authorization: `Bearer ${KEY_A}` }, body: "{}" });
      noCt.headers.delete("content-type");
      assert.equal((await route.post(noCt)).status, 415);
      assert.equal((await route.post(req(JSON.stringify({ topic: "gaming" }), { "content-length": "abc" }))).status, 200);
    });

    it("an unreadable (erroring) body stream => clean 400, never a 500 or a hang", async () => {
      world();
      const stream = new ReadableStream<Uint8Array>({ start(c) { c.error(new Error("socket reset")); } });
      const res = await route.post(new Request("https://example.test/x", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${KEY_A}` }, body: stream, duplex: "half" } as RequestInit));
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { error: "invalid_request", reason: "unreadable_body" });
    });

    it("bad Idempotency-Key (too short / bad chars / too long) => 400, nothing charged; valid shapes pass", async () => {
      world();
      for (const k of ["short", "has space here", "bad/char/key", "x".repeat(65), "key;drop"]) {
        const r = await call(route, { topic: "gaming" }, { "idempotency-key": k });
        assert.equal(r.res.status, 400, k);
        assert.deepEqual(r.json, { error: "invalid_request", reason: "invalid_idempotency_key" });
      }
      assert.equal(db.serveLog.length, 0);
      assert.equal((await call(route, { topic: "gaming" }, { "idempotency-key": "x".repeat(64) })).res.status, 200);
    });

    it("duplicate JSON keys: last value wins like standard JSON, and the parsed result has only known fields", () => {
      const r = parseMatchRequest('{"topic":"travel","topic":"gaming"}');
      assert.deepEqual(r, { ok: true, value: { topic: "gaming", excludeAdIds: [] } });
    });
  });

  describe(`day 11 part 5 | ${route.name} | no-fill, empty candidate lists and database errors`, () => {
    it("empty candidate list, unsupported topic and sensitive topic => 200 {fill:false} with no extra keys", async () => {
      const pub = db.addPublisher("active");
      db.addKey(pub.id, KEY_A);
      for (const topic of ["gaming", "travel", "nonexistent", "health", "beauty"]) {
        const r = await call(route, { topic });
        assert.equal(r.res.status, 200, topic);
        assert.deepEqual(r.json, { fill: false }, topic);
      }
      assert.equal(db.serveLog.length, 0);
      assert.equal(db.spend.size, 0);
    });

    it("every ineligible state (paused, unapproved, scheduled, expired, exhausted) => {fill:false} and NOTHING is charged", async () => {
      const pub = db.addPublisher("active");
      db.addKey(pub.id, KEY_A);
      const adv = db.addAdvertiser("active");
      db.addAd(adv.id, { campaignStatus: "paused" });
      db.addAd(adv.id, { campaignStatus: "draft" });
      db.addAd(adv.id, { creativeStatus: "pending_review" });
      db.addAd(adv.id, { creativeStatus: "rejected" });
      db.addAd(adv.id, { startDate: "2099-01-01" });
      db.addAd(adv.id, { endDate: "2020-01-02" });
      db.addAd(adv.id, { totalBudget: 0 });
      db.addAd(adv.id, { dailyBudget: 0 });
      db.addAd(adv.id, { category: "travel" });
      const r = await call(route, { topic: "gaming" });
      assert.deepEqual(r.json, { fill: false });
      assert.equal(r.res.status, 200);
      assert.equal(db.serveLog.length, 0);
      assert.equal(db.rpcCount("record_ad_serve"), 0, "no candidate was eligible so no record call may happen");
    });

    it("suspended advertiser / suspended advertiser profile => no fill", async () => {
      const pub = db.addPublisher("active");
      db.addKey(pub.id, KEY_A);
      db.addAd(db.addAdvertiser("suspended").id);
      db.addAd(db.addAdvertiser("active", "suspended").id);
      db.addAd(db.addAdvertiser("pending").id);
      assert.deepEqual((await call(route, { topic: "gaming" })).json, { fill: false });
    });

    for (const rpc of ["authorize_publisher_key", "load_ad_candidates", "record_ad_serve"] as const) {
      for (const [label, reply] of [
        ["error object", { data: null, error: { code: "XX000", message: "password=hunter2 host=db.internal" } }],
        ["null data", { data: null, error: null }],
        ["garbage data", { data: "oops", error: null }],
      ] as const) {
        it(`${rpc} returns ${label} => 503 {fill:false,error:"unavailable"}, no ad, no charge, no leak`, async () => {
          world();
          db.failRpc[rpc] = reply as never;
          const r = await call(route, { topic: "gaming" });
          assert.equal(r.res.status, 503);
          assert.deepEqual(r.json, { fill: false, error: "unavailable" });
          assert.equal(db.serveLog.length, 0);
          assert.equal(r.text.includes("hunter2"), false);
          assert.equal(JSON.stringify(logged).includes("hunter2"), false, "DB error text must never reach logs");
          assert.equal(r.res.headers.get("cache-control"), "no-store");
        });
      }
    }

    it("the database throwing (not returning an error) => 503 JSON, never a 500 HTML page", async () => {
      world();
      globals.__TEST_SUPABASE__ = { rpc: async () => { throw new Error("connection refused"); } };
      const res = await route.post(req(JSON.stringify({ topic: "gaming" })));
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), { fill: false, error: "unavailable" });
    });

    it("a DB error for the primary topic never jumps to a fallback topic (outage != no-fill)", async () => {
      const { ad } = world({ category: "travel" });
      db.failRpc.load_ad_candidates = { data: null, error: { code: "57014" } };
      const r = await call(route, { topic: "gaming", fallback_topics: ["travel"] });
      assert.equal(r.res.status, 503);
      assert.equal(db.serveLog.filter((s) => s.creativeId === ad.creativeId).length, 0);
    });
  });

  describe(`day 11 part 5 | ${route.name} | concurrent requests and spend accounting`, () => {
    it("40 parallel requests against a budget of 5 serves => exactly 5 ads, spend never above budget, the rest no-fill", async () => {
      const { pub, ad } = world({ totalBudget: 0.01 }); // 0.01 / 0.002 = 5 serves
      const results = await Promise.all(Array.from({ length: 40 }, () => call(route, { topic: "gaming" })));
      const filled = results.filter((r) => r.json.fill === true);
      const empty = results.filter((r) => r.json.fill === false);
      assert.equal(filled.length, 5);
      assert.equal(empty.length, 35);
      assert.ok(results.every((r) => r.res.status === 200));
      assert.equal(db.servesFor(pub.id).length, 5);
      assert.equal(db.spendOf(ad.campaignId), 0.01);
      assert.ok(db.spendOf(ad.campaignId) <= 0.01 + 1e-9);
    });

    it("daily cap holds under parallel load", async () => {
      const { ad } = world({ totalBudget: 10, dailyBudget: 0.006 }); // 3 serves per day
      const results = await Promise.all(Array.from({ length: 25 }, () => call(route, { topic: "gaming" })));
      assert.equal(results.filter((r) => r.json.fill === true).length, 3);
      assert.equal(db.spendOf(ad.campaignId), 0.006);
    });

    it("two campaigns with small budgets: parallel load fills BOTH to their limit and never overspends either", async () => {
      const pub = db.addPublisher("active");
      db.addKey(pub.id, KEY_A);
      const adv = db.addAdvertiser("active");
      const a = db.addAd(adv.id, { totalBudget: 0.006 }); // 3 serves
      const b = db.addAd(adv.id, { totalBudget: 0.008 }); // 4 serves
      const results = await Promise.all(Array.from({ length: 30 }, () => call(route, { topic: "gaming" })));
      assert.equal(results.filter((r) => r.json.fill === true).length, 7);
      assert.equal(db.spendOf(a.campaignId), 0.006);
      assert.equal(db.spendOf(b.campaignId), 0.008);
    });

    it("parallel requests from many publishers share one budget correctly (spend = serves x unit cost)", async () => {
      const keys = ["1", "2", "3", "4"].map((c) => makeKey(c));
      const pubs = keys.map((k) => { const p = db.addPublisher("active"); db.addKey(p.id, k); return p; });
      const adv = db.addAdvertiser("active");
      const ad = db.addAd(adv.id, { totalBudget: 0.02 }); // 10 serves
      const results = await Promise.all(Array.from({ length: 40 }, (_, i) => call(route, { topic: "gaming" }, {}, keys[i % 4])));
      const served = results.filter((r) => r.json.fill === true).length;
      assert.equal(served, 10);
      assert.equal(pubs.reduce((n, p) => n + db.servesFor(p.id).length, 0), served);
      assert.equal(db.spendOf(ad.campaignId), Math.round(served * 0.002 * 1e6) / 1e6);
    });

    it("10 parallel retries with the SAME Idempotency-Key => one charge, the same ad for all", async () => {
      const { pub, ad } = world({ totalBudget: 10 });
      const results = await Promise.all(Array.from({ length: 10 }, () => call(route, { topic: "gaming" }, { "idempotency-key": "retry-key-0001" })));
      assert.ok(results.every((r) => r.json.fill === true));
      assert.equal(new Set(results.map((r) => (r.json.ad as { id: string }).id)).size, 1);
      assert.equal(db.servesFor(pub.id).length, 1);
      assert.equal(db.spendOf(ad.campaignId), 0.002);
    });

    it("failed / rejected / no-fill / 4xx requests never move spend", async () => {
      const { ad } = world({ totalBudget: 10 });
      await call(route, { topic: "nope" });
      await call(route, { topic: "gaming", prompt: "x" });
      await call(route, { topic: "gaming" }, {}, makeKey("9"));
      db.failRpc.record_ad_serve = { data: null, error: { code: "40001" } };
      await call(route, { topic: "gaming" });
      assert.equal(db.spendOf(ad.campaignId), 0);
      assert.equal(db.serveLog.length, 0);
    });

    it("a normal serve touches only authorize, load and record RPCs (no impression/click function exists in this path)", async () => {
      world();
      await call(route, { topic: "gaming" });
      const names = new Set(db.calls.map((c) => c.name));
      for (const n of names) assert.ok(["authorize_publisher_key", "load_ad_candidates", "record_ad_serve"].includes(n), n);
      assert.equal(db.rpcCount("record_ad_serve"), 1);
    });
  });

  describe(`day 11 part 5 | ${route.name} | stable ranking and backward-compatible response format`, () => {
    it("same state => same ad on repeated reads; ids break exact ties (a-z)", async () => {
      const pub = db.addPublisher("active");
      db.addKey(pub.id, KEY_A);
      const adv = db.addAdvertiser("active");
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) ids.push(db.addAd(adv.id, { totalBudget: 10 }).creativeId);
      const first = (await call(route, { topic: "gaming" })).json.ad as { id: string };
      assert.ok(ids.includes(first.id));
      // after serving, that creative has more serves today, so the next call rotates to a different creative
      const second = (await call(route, { topic: "gaming" })).json.ad as { id: string };
      assert.notEqual(second.id, first.id);
      const third = (await call(route, { topic: "gaming" })).json.ad as { id: string };
      assert.equal(new Set([first.id, second.id, third.id]).size, 3, "all three get a turn before any repeats");
    });

    it("success body is EXACTLY {fill, sponsored, ad:{id,headline,body,cta_text,destination_url}}", async () => {
      world();
      const r = await call(route, { topic: "gaming" });
      assert.equal(r.res.status, 200);
      assert.deepEqual(Object.keys(r.json).sort(), ["ad", "fill", "sponsored"]);
      assert.equal(r.json.fill, true);
      assert.equal(r.json.sponsored, true);
      assert.deepEqual(Object.keys(r.json.ad as object).sort(), ["body", "cta_text", "destination_url", "headline", "id"]);
      assert.equal(r.res.headers.get("content-type")?.startsWith("application/json"), true);
      assert.equal(r.res.headers.get("cache-control"), "no-store");
      assert.equal(r.res.headers.get("vary"), "Authorization");
      assert.equal(r.res.headers.get("x-blisscco-api-version"), route.versioned ? "1" : null);
    });

    it("error bodies keep their original shapes: 400, 401 (+WWW-Authenticate), 413, 415, 429, 503", async () => {
      world();
      const bad = await call(route, { topic: 1 });
      assert.deepEqual(bad.json, { error: "invalid_request", reason: "invalid_topic" });
      const unauth = await call(route, { topic: "gaming" }, {}, null);
      assert.deepEqual(unauth.json, { error: "unauthorized" });
      assert.equal(unauth.res.headers.get("www-authenticate"), 'Bearer realm="blisscco-ads"');
      assert.equal(unauth.res.headers.get("x-blisscco-api-version"), route.versioned ? "1" : null);
      db.failRpc.authorize_publisher_key = { data: { outcome: "rate_limited" }, error: null };
      const rl = await call(route, { topic: "gaming" });
      assert.equal(rl.res.status, 429);
      assert.deepEqual(rl.json, { error: "rate_limited" });
      assert.equal(rl.res.headers.get("retry-after"), "60");
    });

    it("both routes return the same body for the same request (v1 only adds a header)", async () => {
      world({ totalBudget: 10 });
      const a = await call(ROUTES[0], { topic: "gaming" }, { "idempotency-key": "compat-key-001" });
      const b = await call(ROUTES[1], { topic: "gaming" }, { "idempotency-key": "compat-key-001" });
      assert.deepEqual(a.json, b.json);
    });

    it("old-style requests (topic only, or topic + exclude_ad_ids) parse exactly as before", () => {
      assert.deepEqual(parseMatchRequest('{"topic":"gaming"}'), { ok: true, value: { topic: "gaming", excludeAdIds: [] } });
      const id = cid(7);
      assert.deepEqual(parseMatchRequest(JSON.stringify({ topic: "gaming", exclude_ad_ids: [id.toUpperCase(), id] })), { ok: true, value: { topic: "gaming", excludeAdIds: [id] } });
    });
  });
}

// ---------------------------------------------------------------------------------------------------------------------
describe("day 11 part 5 | rate limiting and IP guard do not interfere with ad selection", () => {
  it("many wrong keys from one IP => 429 before the database; a valid key from another IP is unaffected", async () => {
    world();
    const guard = createIpGuard(3, 60_000);
    const send = (key: string, ip: string) =>
      handleMatchPost(req(JSON.stringify({ topic: "gaming" }), { "x-forwarded-for": ip }, key), { ipGuard: guard });
    for (let i = 0; i < 3; i++) assert.equal((await send(makeKey("9"), "203.0.113.9")).status, 401);
    const callsBefore = db.calls.length;
    assert.equal((await send(makeKey("9"), "203.0.113.9")).status, 429);
    assert.equal(db.calls.length, callsBefore, "blocked IP must not reach the database");
    assert.equal((await send(KEY_A, "198.51.100.7")).status, 200);
  });

  it("a spoofed / malformed X-Forwarded-For value cannot crash the handler or block anyone", async () => {
    world();
    for (const xff of ["", "not an ip", "1.2.3.4, 5.6.7.8", "x".repeat(300), "::1"]) {
      const res = await handleMatchPost(req(JSON.stringify({ topic: "gaming" }), { "x-forwarded-for": xff }), { ipGuard: createIpGuard() });
      assert.equal(res.status, 200, xff);
    }
  });
});
