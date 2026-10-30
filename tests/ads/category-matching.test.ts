import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  candidateIneligibility,
  matchCategorySignal,
  normalizeCategoryToken,
  resolveCategory,
  selectEligibleCandidates,
  toPublicAd,
  type AdCandidate,
  type CategorySignal,
  type MatchContext,
} from "../../lib/ads/category-matching";
import {
  ACTIVE_CATEGORIES,
  CATEGORY_ALIASES,
  LEGACY_INACTIVE_CATEGORIES,
  SENSITIVE_CATEGORY_TERMS,
} from "../../lib/ads/taxonomy";
import { CATEGORY_OPTIONS } from "../../lib/campaigns/constants";

// ---------- helpers ----------
const PUBLISHER_ID = "99999999-9999-4999-8999-999999999999";
const CAMPAIGN_1 = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_2 = "22222222-2222-4222-8222-222222222222";
const CAMPAIGN_3 = "33333333-3333-4333-8333-333333333333";
const CREATIVE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const CREATIVE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const CREATIVE_C = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";

const CTX: MatchContext = { today: "2026-10-24", unitCostUsd: 0.002 };

function cand(creativeId: string, campaignId: string, over: Partial<AdCandidate> = {}): AdCandidate {
  return {
    ad: {
      id: creativeId,
      headline: `Headline ${creativeId.slice(0, 2)}`,
      body: "Body text",
      ctaText: "Learn more",
      destinationUrl: "https://example.com/offer",
    },
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
    campaignServesToday: 0,
    creativeServesToday: 0,
    ...over,
  };
}

function signal(category: unknown, status = "active"): CategorySignal {
  return { publisher: { id: PUBLISHER_ID, status }, category };
}

// ---------- 1. Normalization: valid ----------
describe("category normalization - valid inputs", () => {
  const cases: Array<[string, string]> = [
    ["gaming", "gaming"],
    ["  Gaming  ", "gaming"],
    ["GAMING", "gaming"],
    ["Developer Tools", "developer_tools"],
    ["developer-tools", "developer_tools"],
    ["developer__tools", "developer_tools"],
    ["dev tools", "developer_tools"],
    ["devtools", "developer_tools"],
    ["Games", "gaming"],
    ["video games", "gaming"],
    ["Tech", "technology"],
    ["Fintech", "finance"],
    ["ｇａｍｉｎｇ", "gaming"], // full-width letters -> NFKC
    ["-travel-", "travel"],
    ["lifestyle", "lifestyle"],
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} -> ${expected}`, () => {
      const r = resolveCategory(input);
      assert.deepEqual(r, { ok: true, category: expected });
    });
  }

  it("every supported category resolves to itself", () => {
    for (const o of CATEGORY_OPTIONS) {
      assert.deepEqual(resolveCategory(o.value), { ok: true, category: o.value });
    }
  });
});

// ---------- 2. Normalization: invalid ----------
describe("category normalization - invalid inputs", () => {
  const notString: unknown[] = [null, undefined, 42, true, {}, [], ["gaming"], { toString: () => "gaming" }];
  for (const v of notString) {
    it(`non-string ${Object.prototype.toString.call(v)} rejected`, () => {
      assert.deepEqual(resolveCategory(v), { ok: false, reason: "not_a_string" });
    });
  }

  for (const v of ["", "   ", "---", "___", " - _ "]) {
    it(`empty-like ${JSON.stringify(v)} rejected`, () => {
      assert.deepEqual(resolveCategory(v), { ok: false, reason: "empty" });
    });
  }

  it("raw input longer than 100 chars is too_long", () => {
    assert.deepEqual(resolveCategory("a".repeat(101)), { ok: false, reason: "too_long" });
  });

  it("normalized token longer than 50 chars is too_long", () => {
    assert.deepEqual(resolveCategory("a".repeat(51)), { ok: false, reason: "too_long" });
  });

  const badChars = [
    "gaming\nfoo",
    "gaming\tfoo",
    "gam\u200bing", // zero-width space
    "gaming!",
    "gaming; drop table campaigns",
    "<script>",
    "gaming/travel",
    "gaming,travel",
    "ゲーム",
    "gaming 🎮",
    "gaming\u0000",
  ];
  for (const v of badChars) {
    it(`unsafe characters ${JSON.stringify(v)} rejected`, () => {
      const r = resolveCategory(v);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, "invalid_characters");
    });
  }

  it("sentence-like free text is rejected as too_many_words", () => {
    assert.deepEqual(resolveCategory("I want to play games and travel"), { ok: false, reason: "too_many_words" });
    assert.deepEqual(resolveCategory("a b c d"), { ok: false, reason: "too_many_words" });
  });

  it("3 words are allowed by the normalizer (then unsupported by taxonomy)", () => {
    assert.deepEqual(normalizeCategoryToken("a b c"), { ok: true, token: "a_b_c" });
    assert.deepEqual(resolveCategory("a b c"), { ok: false, reason: "unsupported_category" });
  });
});

// ---------- 3. Sensitive + unsupported ----------
describe("sensitive and unsupported categories", () => {
  for (const v of ["health", "Mental Health", "religion", "Politics", "sexual orientation", "sexuality", "caste"]) {
    it(`sensitive ${JSON.stringify(v)} rejected`, () => {
      assert.deepEqual(resolveCategory(v), { ok: false, reason: "sensitive_category" });
    });
  }

  for (const v of ["beauty", "unknown", "gamingx", "gam", "game", "gaming_and_travel", "technology_news"]) {
    it(`unsupported ${JSON.stringify(v)} rejected (exact match only, no prefix/substring)`, () => {
      assert.deepEqual(resolveCategory(v), { ok: false, reason: "unsupported_category" });
    });
  }

  for (const v of ["__proto__", "constructor", "toString", "hasOwnProperty", "prototype", "valueOf"]) {
    it(`object-prototype name ${JSON.stringify(v)} never matches`, () => {
      const r = resolveCategory(v);
      assert.equal(r.ok, false);
    });
  }
});

// ---------- 4. Taxonomy integrity ----------
describe("taxonomy integrity", () => {
  const slugs = CATEGORY_OPTIONS.map((o) => o.value as string);

  it("aliases are normalized, unique, and never collide with slugs, legacy or sensitive terms", () => {
    const seen = new Set<string>();
    for (const [slug, aliases] of Object.entries(CATEGORY_ALIASES)) {
      assert.ok(slugs.includes(slug), `alias entry for unknown slug ${slug}`);
      for (const alias of aliases) {
        assert.deepEqual(normalizeCategoryToken(alias), { ok: true, token: alias }, `alias not normalized: ${alias}`);
        assert.ok(!seen.has(alias), `duplicate alias ${alias}`);
        seen.add(alias);
        assert.ok(!slugs.includes(alias), `alias ${alias} equals a slug`);
        assert.ok(!LEGACY_INACTIVE_CATEGORIES.includes(alias), `alias ${alias} is legacy`);
        assert.ok(!SENSITIVE_CATEGORY_TERMS.includes(alias), `alias ${alias} is sensitive`);
      }
    }
    assert.deepEqual(Object.keys(CATEGORY_ALIASES).sort(), [...slugs].sort());
  });

  it("no supported slug is a sensitive term", () => {
    for (const s of slugs) assert.ok(!SENSITIVE_CATEGORY_TERMS.includes(s), s);
  });

  it("code taxonomy matches the day-5-1 SQL seed (active and legacy rows)", () => {
    const sql = readFileSync(path.resolve(process.cwd(), "supabase/sql/day-5-1-categories.sql"), "utf8");
    const rows = [...sql.matchAll(/\(\s*'([a-z0-9_]+)'\s*,\s*'[^']*'\s*,\s*(true|false)\s*,\s*\d+\s*\)/g)];
    const sqlActive = rows.filter((m) => m[2] === "true").map((m) => m[1]).sort();
    const sqlInactive = rows.filter((m) => m[2] === "false").map((m) => m[1]).sort();
    assert.deepEqual(sqlActive, [...slugs].sort());
    assert.deepEqual(sqlInactive, [...LEGACY_INACTIVE_CATEGORIES].sort());
    assert.deepEqual(ACTIVE_CATEGORIES.map((c) => c.slug).sort(), sqlActive);
  });
});

// ---------- 5. Signal / publisher authorization ----------
describe("publisher authorization of the signal", () => {
  const candidates = [cand(CREATIVE_A, CAMPAIGN_1)];

  for (const status of ["pending", "suspended", "ACTIVE", "", "unknown"]) {
    it(`publisher status ${JSON.stringify(status)} is not authorized`, () => {
      assert.deepEqual(matchCategorySignal(signal("gaming", status), candidates, CTX), {
        status: "rejected",
        reason: "publisher_not_authorized",
      });
    });
  }

  it("bad publisher id is not authorized", () => {
    const s: CategorySignal = { publisher: { id: "not-a-uuid", status: "active" }, category: "gaming" };
    assert.deepEqual(matchCategorySignal(s, candidates, CTX), { status: "rejected", reason: "publisher_not_authorized" });
  });

  it("null / malformed signal does not throw", () => {
    assert.deepEqual(matchCategorySignal(null as unknown as CategorySignal, candidates, CTX), {
      status: "rejected",
      reason: "publisher_not_authorized",
    });
    assert.deepEqual(matchCategorySignal({} as unknown as CategorySignal, candidates, CTX), {
      status: "rejected",
      reason: "publisher_not_authorized",
    });
  });

  it("authorization is checked before the category (nothing is revealed to an unauthorized publisher)", () => {
    assert.deepEqual(matchCategorySignal(signal("health", "suspended"), candidates, CTX), {
      status: "rejected",
      reason: "publisher_not_authorized",
    });
  });
});

// ---------- 6. Matching ----------
describe("matching categories", () => {
  it("matches an approved signal against eligible candidates", () => {
    const r = matchCategorySignal(signal("gaming"), [cand(CREATIVE_A, CAMPAIGN_1)], CTX);
    assert.equal(r.status, "matched");
    if (r.status === "matched") {
      assert.equal(r.category, "gaming");
      assert.equal(r.selected.ad.id, CREATIVE_A);
      assert.equal(r.candidates.length, 1);
      assert.equal(r.repeat, false);
    }
  });

  it("alias and messy formatting reach the same candidates as the canonical slug", () => {
    const list = [cand(CREATIVE_A, CAMPAIGN_1)];
    for (const v of ["Games", "  GAMING ", "video-games"]) {
      const r = matchCategorySignal(signal(v), list, CTX);
      assert.equal(r.status, "matched", v);
    }
  });

  it("only returns candidates of the requested category, never other campaigns", () => {
    const list = [
      cand(CREATIVE_A, CAMPAIGN_1, { category: "gaming" }),
      cand(CREATIVE_B, CAMPAIGN_2, { category: "travel" }),
      cand(CREATIVE_C, CAMPAIGN_3, { category: "finance" }),
    ];
    const r = matchCategorySignal(signal("travel"), list, CTX);
    assert.equal(r.status, "matched");
    if (r.status === "matched") {
      assert.deepEqual(r.candidates.map((c) => c.ad.id), [CREATIVE_B]);
    }
  });

  it("category comparison is exact: 'gaming_pro' / 'Gaming' on a candidate do not match", () => {
    const list = [
      cand(CREATIVE_A, CAMPAIGN_1, { category: "gaming_pro" }),
      cand(CREATIVE_B, CAMPAIGN_2, { category: "Gaming" }),
    ];
    assert.equal(matchCategorySignal(signal("gaming"), list, CTX).status, "no_match");
  });

  it("a long conversation is never substring-matched", () => {
    const convo = "User: I love gaming and want to travel to Paris next month. Bot: great, tell me more about gaming";
    const r = matchCategorySignal(signal(convo), [cand(CREATIVE_A, CAMPAIGN_1)], CTX);
    assert.deepEqual(r, { status: "rejected", reason: "too_long" });
    const short = matchCategorySignal(signal("I like gaming"), [cand(CREATIVE_A, CAMPAIGN_1)], CTX);
    assert.deepEqual(short, { status: "rejected", reason: "unsupported_category" });
  });

  it("makes no network call", () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("fetch must not be called");
    }) as typeof fetch;
    try {
      const r = matchCategorySignal(signal("gaming"), [cand(CREATIVE_A, CAMPAIGN_1)], CTX);
      assert.equal(r.status, "matched");
    } finally {
      globalThis.fetch = original;
    }
  });
});

// ---------- 7. Rejected signals ----------
describe("rejected signals return rejected, not a guess", () => {
  const list = [cand(CREATIVE_A, CAMPAIGN_1)];
  const table: Array<[unknown, string]> = [
    [undefined, "not_a_string"],
    ["", "empty"],
    ["health", "sensitive_category"],
    ["religion", "sensitive_category"],
    ["beauty", "unsupported_category"],
    ["cryptocurrency", "unsupported_category"],
    ["gaming\n", "ok"], // trailing newline is trimmed (formatting only)
    ["gam\u200bing", "invalid_characters"],
  ];
  for (const [input, expected] of table) {
    it(`${JSON.stringify(input)} -> ${expected}`, () => {
      const r = matchCategorySignal(signal(input), list, CTX);
      if (expected === "ok") assert.equal(r.status, "matched");
      else assert.deepEqual(r, { status: "rejected", reason: expected });
    });
  }
});

// ---------- 8. Safe no-match ----------
describe("safe no-match", () => {
  it("empty candidate list -> no_match", () => {
    assert.deepEqual(matchCategorySignal(signal("gaming"), [], CTX), {
      status: "no_match",
      category: "gaming",
      reason: "no_eligible_candidates",
    });
  });

  it("valid category but no candidate in that category -> no_match", () => {
    const r = matchCategorySignal(signal("food"), [cand(CREATIVE_A, CAMPAIGN_1, { category: "gaming" })], CTX);
    assert.equal(r.status, "no_match");
  });

  it("all candidates ineligible -> no_match", () => {
    const list = [
      cand(CREATIVE_A, CAMPAIGN_1, { creativeStatus: "pending_review" }),
      cand(CREATIVE_B, CAMPAIGN_2, { campaignStatus: "paused" }),
      cand(CREATIVE_C, CAMPAIGN_3, { endDate: "2026-10-23" }),
    ];
    assert.equal(matchCategorySignal(signal("gaming"), list, CTX).status, "no_match");
  });

  it("no_match result carries nothing about candidates", () => {
    const r = matchCategorySignal(signal("gaming"), [], CTX);
    assert.deepEqual(Object.keys(r).sort(), ["category", "reason", "status"]);
  });
});

// ---------- 9. Eligibility rules ----------
describe("eligibility rules", () => {
  const eligibility = (over: Partial<AdCandidate>) => candidateIneligibility(cand(CREATIVE_A, CAMPAIGN_1, over), "gaming", CTX);

  it("baseline candidate is eligible", () => assert.equal(eligibility({}), null));

  const cases: Array<[string, Partial<AdCandidate>, string]> = [
    ["wrong category", { category: "travel" }, "category_mismatch"],
    ["creative draft", { creativeStatus: "draft" }, "creative_not_approved"],
    ["creative pending_review", { creativeStatus: "pending_review" }, "creative_not_approved"],
    ["creative rejected", { creativeStatus: "rejected" }, "creative_not_approved"],
    ["creative paused", { creativeStatus: "paused" }, "creative_not_approved"],
    ["creative archived", { creativeStatus: "archived" }, "creative_not_approved"],
    ["campaign draft", { campaignStatus: "draft" }, "campaign_not_active"],
    ["campaign paused", { campaignStatus: "paused" }, "campaign_not_active"],
    ["campaign completed", { campaignStatus: "completed" }, "campaign_not_active"],
    ["advertiser pending", { advertiserStatus: "pending" }, "advertiser_not_active"],
    ["advertiser suspended", { advertiserStatus: "suspended" }, "advertiser_not_active"],
    ["advertiser profile suspended", { advertiserProfileStatus: "suspended" }, "advertiser_profile_not_active"],
    ["starts tomorrow", { startDate: "2026-10-25" }, "not_started"],
    ["ended yesterday", { endDate: "2026-10-23" }, "ended"],
    ["total budget exhausted", { totalBudget: 10, spentTotal: 10 }, "total_budget_exhausted"],
    ["daily budget exhausted", { dailyBudget: 5, spentToday: 5 }, "daily_budget_exhausted"],
  ];
  for (const [name, over, reason] of cases) {
    it(`${name} -> ${reason}`, () => assert.equal(eligibility(over), reason));
  }

  it("schedule boundaries are inclusive (start today, end today)", () => {
    assert.equal(eligibility({ startDate: "2026-10-24" }), null);
    assert.equal(eligibility({ endDate: "2026-10-24" }), null);
  });

  it("budget boundaries: exactly one impression left is eligible, one micro-dollar less is not", () => {
    assert.equal(eligibility({ totalBudget: 10, spentTotal: 9.998 }), null);
    assert.equal(eligibility({ totalBudget: 10, spentTotal: 9.999 }), "total_budget_exhausted");
    assert.equal(eligibility({ dailyBudget: 5, spentToday: 4.998 }), null);
    assert.equal(eligibility({ dailyBudget: 5, spentToday: 4.999 }), "daily_budget_exhausted");
  });

  it("dailyBudget null means no daily cap", () => {
    assert.equal(eligibility({ dailyBudget: null, spentToday: 1_000_000 }), null);
  });

  const malformed: Array<[string, Partial<AdCandidate>]> = [
    ["bad creative id", { ad: { ...cand(CREATIVE_A, CAMPAIGN_1).ad, id: "nope" } }],
    ["bad campaign id", { campaignId: "nope" }],
    ["bad start date", { startDate: "2026-02-30" }],
    ["bad end date", { endDate: "tomorrow" }],
    ["NaN budget", { totalBudget: Number.NaN }],
    ["negative spend", { spentTotal: -1 }],
    ["Infinity budget", { totalBudget: Number.POSITIVE_INFINITY }],
    ["negative serves", { campaignServesToday: -1 }],
    ["fractional serves", { creativeServesToday: 1.5 }],
  ];
  for (const [name, over] of malformed) {
    it(`malformed candidate (${name}) is skipped, not crashed on`, () => {
      assert.equal(eligibility(over), "malformed_candidate");
    });
  }

  it("null entries inside the candidate list are skipped", () => {
    const list = [null as unknown as AdCandidate, cand(CREATIVE_A, CAMPAIGN_1)];
    assert.equal(selectEligibleCandidates(list, "gaming", CTX).length, 1);
  });
});

// ---------- 10. Deterministic ordering ----------
describe("deterministic ordering", () => {
  const a = cand(CREATIVE_A, CAMPAIGN_1);
  const b = cand(CREATIVE_B, CAMPAIGN_2);
  const c = cand(CREATIVE_C, CAMPAIGN_3);
  const perms = [
    [a, b, c],
    [a, c, b],
    [b, a, c],
    [b, c, a],
    [c, a, b],
    [c, b, a],
  ];

  it("equal candidates: same result for every input order (lowest campaign id first)", () => {
    for (const p of perms) {
      const r = matchCategorySignal(signal("gaming"), p, CTX);
      assert.equal(r.status, "matched");
      if (r.status === "matched") {
        assert.deepEqual(r.candidates.map((x) => x.ad.id), [CREATIVE_A, CREATIVE_B, CREATIVE_C]);
        assert.equal(r.selected.ad.id, CREATIVE_A);
      }
    }
  });

  it("repeated runs give identical output", () => {
    const first = JSON.stringify(matchCategorySignal(signal("gaming"), perms[3], CTX));
    for (let i = 0; i < 50; i++) {
      assert.equal(JSON.stringify(matchCategorySignal(signal("gaming"), perms[3], CTX)), first);
    }
  });

  it("campaign with fewer serves today beats a lower id", () => {
    const busy = cand(CREATIVE_A, CAMPAIGN_1, { campaignServesToday: 5 });
    const calm = cand(CREATIVE_B, CAMPAIGN_2, { campaignServesToday: 1 });
    const r = matchCategorySignal(signal("gaming"), [busy, calm], CTX);
    assert.equal(r.status === "matched" && r.selected.ad.id, CREATIVE_B);
  });

  it("within one campaign, the creative with fewer serves wins; then lowest creative id", () => {
    const x = cand(CREATIVE_A, CAMPAIGN_1, { campaignServesToday: 3, creativeServesToday: 2 });
    const y = cand(CREATIVE_B, CAMPAIGN_1, { campaignServesToday: 3, creativeServesToday: 1 });
    const z = cand(CREATIVE_C, CAMPAIGN_1, { campaignServesToday: 3, creativeServesToday: 1 });
    const r = matchCategorySignal(signal("gaming"), [x, z, y], CTX);
    assert.deepEqual(r.status === "matched" && r.candidates.map((q) => q.ad.id), [CREATIVE_B, CREATIVE_C, CREATIVE_A]);
  });

  it("tie-break is campaign id first, then creative id (conflicting orders)", () => {
    // creative A (lowest creative id) lives in campaign 2; creative B lives in campaign 1 (lowest campaign id)
    const inCampaign2 = cand(CREATIVE_A, CAMPAIGN_2);
    const inCampaign1 = cand(CREATIVE_B, CAMPAIGN_1);
    for (const list of [[inCampaign2, inCampaign1], [inCampaign1, inCampaign2]]) {
      const r = matchCategorySignal(signal("gaming"), list, CTX);
      assert.deepEqual(r.status === "matched" && r.candidates.map((q) => q.ad.id), [CREATIVE_B, CREATIVE_A]);
    }
  });

  it("uppercase UUIDs order the same as lowercase", () => {
    const upper = cand(CREATIVE_B.toUpperCase(), CAMPAIGN_2.toUpperCase());
    const r = matchCategorySignal(signal("gaming"), [upper, a], CTX);
    assert.equal(r.status === "matched" && r.selected.ad.id, CREATIVE_A);
  });

  it("duplicate creative ids are collapsed", () => {
    const r = matchCategorySignal(signal("gaming"), [a, { ...a }, b], CTX);
    assert.equal(r.status === "matched" && r.candidates.length, 2);
  });

  it("does not mutate the input array or candidates", () => {
    const input = Object.freeze([Object.freeze(c), Object.freeze(a), Object.freeze(b)]);
    const before = JSON.stringify(input);
    const r = matchCategorySignal(signal("gaming"), input, CTX);
    assert.equal(r.status, "matched");
    assert.equal(JSON.stringify(input), before);
  });
});

// ---------- 11. Exclusion / repeat ----------
describe("exclude list and repeat", () => {
  const a = cand(CREATIVE_A, CAMPAIGN_1);
  const b = cand(CREATIVE_B, CAMPAIGN_2);

  it("skips excluded creatives when an alternative exists", () => {
    const r = matchCategorySignal(signal("gaming"), [a, b], { ...CTX, excludeCreativeIds: [CREATIVE_A] });
    assert.equal(r.status === "matched" && r.selected.ad.id, CREATIVE_B);
    assert.equal(r.status === "matched" && r.repeat, false);
  });

  it("exclude is case-insensitive", () => {
    const r = matchCategorySignal(signal("gaming"), [a, b], { ...CTX, excludeCreativeIds: [CREATIVE_A.toUpperCase()] });
    assert.equal(r.status === "matched" && r.selected.ad.id, CREATIVE_B);
  });

  it("repeats only when every eligible creative was excluded", () => {
    const r = matchCategorySignal(signal("gaming"), [a, b], { ...CTX, excludeCreativeIds: [CREATIVE_A, CREATIVE_B] });
    assert.equal(r.status === "matched" && r.selected.ad.id, CREATIVE_A);
    assert.equal(r.status === "matched" && r.repeat, true);
  });

  it("excluding an id that is not eligible does not cause a repeat flag", () => {
    const r = matchCategorySignal(signal("gaming"), [a], { ...CTX, excludeCreativeIds: [CREATIVE_C] });
    assert.equal(r.status === "matched" && r.repeat, false);
  });

  it("no_match stays no_match even with an exclude list", () => {
    const r = matchCategorySignal(signal("gaming"), [], { ...CTX, excludeCreativeIds: [CREATIVE_A] });
    assert.equal(r.status, "no_match");
  });
});

// ---------- 12. Invalid context ----------
describe("invalid context is rejected, never thrown", () => {
  const list = [cand(CREATIVE_A, CAMPAIGN_1)];
  const bad: Array<[string, unknown]> = [
    ["bad month", { today: "2026-13-01", unitCostUsd: 0.002 }],
    ["not a date", { today: "tomorrow", unitCostUsd: 0.002 }],
    ["zero unit cost", { today: "2026-10-24", unitCostUsd: 0 }],
    ["negative unit cost", { today: "2026-10-24", unitCostUsd: -1 }],
    ["NaN unit cost", { today: "2026-10-24", unitCostUsd: Number.NaN }],
    ["exclude not an array", { today: "2026-10-24", unitCostUsd: 0.002, excludeCreativeIds: "x" }],
    ["exclude has non-string", { today: "2026-10-24", unitCostUsd: 0.002, excludeCreativeIds: [1] }],
    ["null ctx", null],
  ];
  for (const [name, ctx] of bad) {
    it(name, () => {
      assert.deepEqual(matchCategorySignal(signal("gaming"), list, ctx as MatchContext), {
        status: "rejected",
        reason: "invalid_context",
      });
    });
  }

  it("candidates that is not an array is rejected", () => {
    assert.deepEqual(matchCategorySignal(signal("gaming"), "x" as unknown as AdCandidate[], CTX), {
      status: "rejected",
      reason: "invalid_context",
    });
  });
});

// ---------- 13. Public output ----------
describe("what a publisher may see", () => {
  it("toPublicAd returns exactly the 5 public ad fields", () => {
    const pub = toPublicAd(cand(CREATIVE_A, CAMPAIGN_1, { totalBudget: 12345, advertiserStatus: "active" }));
    assert.deepEqual(Object.keys(pub).sort(), ["body", "ctaText", "destinationUrl", "headline", "id"]);
    const text = JSON.stringify(pub);
    for (const secret of [CAMPAIGN_1, "12345", "totalBudget", "advertiser", "campaign"]) {
      assert.ok(!text.includes(secret), `leaked ${secret}`);
    }
  });

  it("toPublicAd ignores extra fields smuggled onto the candidate's ad", () => {
    const c = cand(CREATIVE_A, CAMPAIGN_1);
    (c.ad as unknown as Record<string, unknown>).advertiserEmail = "secret@example.com";
    assert.ok(!JSON.stringify(toPublicAd(c)).includes("secret@example.com"));
  });
});

// ---------- 14. Purity guard (module stays independent) ----------
describe("module independence", () => {
  const files = ["lib/ads/category-matching.ts", "lib/ads/taxonomy.ts"];
  const forbidden = [
    /\bfetch\s*\(/,
    /supabase/i,
    /process\.env/,
    /Math\.random/,
    /Date\.now/,
    /new Date\s*\(\s*\)/,
    /\brequire\s*\(/,
    /\bimport\s*\(/,
    /server-only/,
    /anthropic|openai|openrouter/i,
    /localStorage|sessionStorage|document\.|window\./,
  ];

  for (const file of files) {
    const source = readFileSync(path.resolve(process.cwd(), file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    it(`${file}: no I/O, clock, random, env or AI/browser access`, () => {
      for (const re of forbidden) assert.ok(!re.test(source), `${file} matches ${re}`);
    });

    it(`${file}: imports only local relative modules`, () => {
      const imports = [...source.matchAll(/\bfrom\s+"([^"]+)"/g)].map((m) => m[1]);
      assert.ok(imports.length > 0);
      for (const spec of imports) assert.ok(spec.startsWith("./") || spec.startsWith("../"), `${file} imports ${spec}`);
    });
  }
});
