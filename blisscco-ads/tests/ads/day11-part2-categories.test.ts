import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CATEGORY_OPTIONS } from "../../lib/campaigns/constants";
import { parseCampaignForm } from "../../lib/campaigns/validation";
import { parseFilters } from "../../lib/campaigns/filters";
import type { FormValues } from "../../lib/campaigns/types";
import { parsePublisherSetup } from "../../lib/accounts/validation";
import { CAMPAIGN_CATEGORIES } from "../../lib/types";
import { CAMPAIGNS, PUBLISHERS } from "../../lib/demo-data";
import { parseMatchRequest } from "../../lib/ads/validation";
import { candidateIneligibility, resolveCategory, selectEligibleCandidates, type AdCandidate } from "../../lib/ads/category-matching";
import { CATEGORY_ALIASES, LEGACY_INACTIVE_CATEGORIES, SENSITIVE_CATEGORY_TERMS } from "../../lib/ads/taxonomy";
import { selectAd, type SelectionOutcome } from "../../lib/ads/selection";
import { serveAd, type ServeDeps } from "../../lib/ads/serve";

// Day 11 Part 2: ek hi category taxonomy, teen jagah (campaign, publisher setup, publisher request) par ek jaisa behaviour.
// Policy (taxonomy.ts me likhi): alias = exact many-to-one naam; parent-child NAHI; substring/prefix match NAHI.

const SLUGS: string[] = CATEGORY_OPTIONS.map((o) => o.value);
const NOW = new Date("2026-10-28T12:00:00Z");
const TODAY = "2026-10-28";
const PUBLISHER_ID = "99999999-9999-4999-8999-999999999999";

const good: FormValues = {
  name: "Diwali sale", description: "", category: "lifestyle", totalBudget: "500", dailyBudget: "50",
  startDate: TODAY, endDate: "2026-12-31",
};
const campaignCategoryError = (category: string, existing?: { category: string; categoryLocked: boolean }) => {
  const r = parseCampaignForm(
    { ...good, category },
    { todayUtc: TODAY, ...(existing ? { existing: { startDate: TODAY, ...existing } } : {}) },
  );
  return r.ok ? undefined : r.errors.category;
};

describe("one taxonomy: every layer agrees on the supported slugs", () => {
  for (const { value, label } of CATEGORY_OPTIONS) {
    it(`${value}: campaign form, publisher setup, list filter, API body and matcher all accept it as the same slug`, () => {
      assert.equal(campaignCategoryError(value), undefined);
      const pub = parsePublisherSetup({ name: "Bot", websiteUrl: "", category: value });
      assert.ok(pub.ok && pub.value.category === value);
      assert.equal(parseFilters({ category: value }).category, value);
      const api = parseMatchRequest(JSON.stringify({ topic: value }));
      assert.ok(api.ok && api.value.topic === value);
      assert.deepEqual(resolveCategory(value), { ok: true, category: value });
      // dikhne wala naam ("Developer tools") bhi normalize hokar usi slug par aata hai: koi doosra naming convention nahi
      assert.deepEqual(resolveCategory(label), { ok: true, category: value });
    });
  }

  it("legacy beauty: not offered for new campaigns or publishers, never matched, but an existing campaign can still be edited", () => {
    for (const legacy of LEGACY_INACTIVE_CATEGORIES) {
      assert.ok(campaignCategoryError(legacy));
      assert.ok(!parsePublisherSetup({ name: "Bot", websiteUrl: "", category: legacy }).ok);
      assert.deepEqual(resolveCategory(legacy), { ok: false, reason: "unsupported_category" });
      assert.equal(campaignCategoryError(legacy, { category: legacy, categoryLocked: false }), undefined);
    }
  });

  it("sensitive terms are refused everywhere (never become a campaign/publisher category or a match)", () => {
    for (const term of SENSITIVE_CATEGORY_TERMS) {
      assert.ok(campaignCategoryError(term), term);
      assert.ok(!parsePublisherSetup({ name: "Bot", websiteUrl: "", category: term }).ok, term);
      assert.deepEqual(resolveCategory(term), { ok: false, reason: "sensitive_category" }, term);
    }
  });

  it("layering (documented): the public API stays strict about the wire format, the matcher is the lenient normalizer", () => {
    for (const messy of ["Gaming", "video games", "developer-tools", " gaming", "gaming\n"]) {
      assert.deepEqual(parseMatchRequest(JSON.stringify({ topic: messy })), { ok: false, reason: "invalid_topic" }, messy);
    }
    assert.deepEqual(resolveCategory("Gaming"), { ok: true, category: "gaming" });
    assert.deepEqual(resolveCategory(" developer-tools "), { ok: true, category: "developer_tools" });
  });

  it("the demo dashboard lists no category outside the real taxonomy (no second taxonomy)", () => {
    const demo = [
      ...CAMPAIGN_CATEGORIES,
      ...CAMPAIGNS.map((c) => c.topic),
      ...PUBLISHERS.map((p) => p.category),
    ];
    assert.ok(demo.length > 0);
    for (const name of demo) {
      const r = resolveCategory(name);
      assert.ok(r.ok && SLUGS.includes(r.category), `demo category ${JSON.stringify(name)} is not in the real taxonomy`);
    }
  });
});

describe("aliases, parent-child and substrings (defined behaviour)", () => {
  it("every alias resolves to exactly its own slug, in any casing / separator style", () => {
    for (const slug of SLUGS) {
      for (const alias of CATEGORY_ALIASES[slug as keyof typeof CATEGORY_ALIASES]) {
        for (const form of [alias, alias.toUpperCase(), ` ${alias} `, alias.replace(/_/g, " "), alias.replace(/_/g, "-")]) {
          assert.deepEqual(resolveCategory(form), { ok: true, category: slug }, JSON.stringify(form));
        }
      }
    }
  });

  it("no substring of a slug or alias matches unless it is itself a slug or alias", () => {
    const allowed = new Set<string>(SLUGS);
    for (const slug of SLUGS) for (const a of CATEGORY_ALIASES[slug as keyof typeof CATEGORY_ALIASES]) allowed.add(a);
    const tokens = [...allowed];
    let checked = 0;
    for (const token of tokens) {
      for (let i = 0; i < token.length; i++) {
        for (let j = i + 1; j <= token.length; j++) {
          const part = token.slice(i, j);
          // stray "_" aage/peeche normalization me hat jaata hai ("_games" == "games"): wo substring nahi, wahi naam hai
          if (allowed.has(part.replace(/^_+|_+$/g, ""))) continue;
          checked++;
          assert.equal(resolveCategory(part).ok, false, `substring ${JSON.stringify(part)} of ${token} must not match`);
        }
      }
    }
    assert.ok(checked > 100);
  });

  it("a longer word that merely contains a slug never matches", () => {
    for (const slug of SLUGS) {
      for (const longer of [`${slug}s`, `${slug}x`, `x${slug}`, `${slug}_pro`, `pro_${slug}`, `${slug}_news`, `my_${slug}_app`]) {
        assert.equal(resolveCategory(longer).ok, false, longer);
      }
    }
  });

  it("no parent-child: technology and developer_tools are independent (neither returns the other's campaigns)", () => {
    const cand = (category: string, id: string): AdCandidate => ({
      ad: { id, headline: "H", body: "B", ctaText: null, destinationUrl: "https://example.com/x" },
      creativeStatus: "approved", campaignId: id.replace(/a/g, "1"), campaignStatus: "active", category,
      startDate: "2026-10-01", endDate: null, totalBudget: 100, dailyBudget: null, spentTotal: 0, spentToday: 0,
      advertiserStatus: "active", advertiserProfileStatus: "active", campaignServesToday: 0, creativeServesToday: 0,
    });
    const tech = cand("technology", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1");
    const dev = cand("developer_tools", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2");
    const ctx = { today: TODAY, unitCostUsd: 0.002 };
    assert.deepEqual(selectEligibleCandidates([tech, dev], "developer_tools", ctx), [dev]);
    assert.deepEqual(selectEligibleCandidates([tech, dev], "technology", ctx), [tech]);
    assert.equal(candidateIneligibility(tech, "developer_tools", ctx), "category_mismatch");
  });
});

// ---------------------------------------------------------------------------
// End to end (fake dependencies): publisher request -> canonical category -> loader -> eligibility -> record
// ---------------------------------------------------------------------------
const ID = (n: number) => {
  const h = (n % 16).toString(16);
  return `${h.repeat(8)}-${h.repeat(4)}-4${h.repeat(3)}-8${h.repeat(3)}-${h.repeat(12)}`;
};
function cand(n: number, over: Partial<AdCandidate> = {}): AdCandidate {
  return {
    ad: { id: ID(n), headline: "H", body: "B", ctaText: null, destinationUrl: "https://example.com/x" },
    creativeStatus: "approved", campaignId: ID(n + 1 > 9 ? 1 : n + 1), campaignStatus: "active", category: "gaming",
    startDate: "2026-10-01", endDate: null, totalBudget: 100, dailyBudget: null, spentTotal: 0, spentToday: 0,
    advertiserStatus: "active", advertiserProfileStatus: "active", campaignServesToday: 0, creativeServesToday: n,
    ...over,
  };
}
function harness(candidates: AdCandidate[]) {
  const trace = { loaded: [] as string[], recorded: [] as Array<{ id: string; category: string }> };
  const deps: ServeDeps = {
    authorize: async () => ({ outcome: "ok", publisher: { id: PUBLISHER_ID, status: "active" }, unitCostUsd: 0.002 }),
    select: async (request, unitCostUsd): Promise<SelectionOutcome> =>
      selectAd(request, {
        loadCandidates: async (category) => {
          trace.loaded.push(category);
          return candidates;
        },
        now: () => NOW,
        unitCostUsd,
        spendTracking: "reliable",
      }),
    record: async (_h, creativeId, category) => {
      trace.recorded.push({ id: creativeId, category });
      return { outcome: "recorded" };
    },
  };
  return { deps, trace };
}
const request = (topic: string) => {
  const parsed = parseMatchRequest(JSON.stringify({ topic }));
  assert.ok(parsed.ok, topic);
  return parsed.value;
};

describe("publisher request -> canonical category end to end", () => {
  it("API-valid but untidy topics (double underscore, stray underscores, alias) reach the loader and record as the canonical slug", async () => {
    for (const topic of ["video__games", "_gaming", "gaming_", "games", "videogames"]) {
      const { deps, trace } = harness([cand(1)]);
      const r = await serveAd("a".repeat(64), request(topic), deps);
      assert.equal(r.kind, "ad", topic);
      assert.deepEqual(trace.loaded, ["gaming"], topic);
      assert.deepEqual(trace.recorded, [{ id: ID(1), category: "gaming" }], topic);
    }
  });

  it("unknown, legacy, sensitive, empty-after-cleaning and too-wordy topics are a safe no-fill: no load, no record", async () => {
    for (const topic of ["cars", "beauty", "health", "mental_health", "__", "a_b_c_d", "x".repeat(50), "123"]) {
      const { deps, trace } = harness([cand(1)]);
      assert.deepEqual(await serveAd("a".repeat(64), request(topic), deps), { kind: "no_fill" }, topic);
      assert.equal(trace.loaded.length + trace.recorded.length, 0, topic);
    }
  });

  it("missing / non-string / malformed topics never reach matching (400 at the API)", () => {
    for (const body of ["{}", '{"topic":null}', '{"topic":5}', '{"topic":["gaming"]}', '{"topic":""}', '{"topic":"gaming;drop"}', '{"topic":"../etc"}']) {
      assert.deepEqual(parseMatchRequest(body), { ok: false, reason: "invalid_topic" }, body);
    }
  });

  it("only the eligible campaign is served: status, approval, schedule, advertiser and Day 9 budget all enforced", async () => {
    const bad: AdCandidate[] = [
      cand(2, { campaignStatus: "paused" }),
      cand(3, { creativeStatus: "pending_review" }),
      cand(4, { startDate: "2026-10-29" }),
      cand(5, { endDate: "2026-10-27" }),
      cand(6, { advertiserStatus: "suspended" }),
      cand(7, { totalBudget: 10, spentTotal: 9.999 }), // 0.001 bacha < 0.002 ki ek serve
      cand(8, { dailyBudget: 5, spentToday: 4.999 }),
      // category ke ghalat roop: DB me aise rows ho hi nahi sakte, par matcher inhe kabhi match nahi karta
      cand(9, { category: "Gaming" }),
      cand(10, { category: "games" }),
    ];
    const winner = cand(1, { ad: { id: ID(1), headline: "OK", body: "B", ctaText: null, destinationUrl: "https://example.com/ok" }, creativeServesToday: 99 });
    const { deps, trace } = harness([...bad, winner]);
    const r = await serveAd("a".repeat(64), request("gaming"), deps);
    assert.equal(r.kind === "ad" && r.ad.headline, "OK");
    assert.deepEqual(trace.recorded.map((x) => x.id), [ID(1)]);
  });

  it("when nothing eligible exists the answer is a plain no-fill", async () => {
    const { deps, trace } = harness([cand(2, { campaignStatus: "paused" }), cand(3, { category: "technology" })]);
    assert.deepEqual(await serveAd("a".repeat(64), request("gaming"), deps), { kind: "no_fill" });
    assert.equal(trace.recorded.length, 0);
  });
});
