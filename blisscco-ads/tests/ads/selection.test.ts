import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  candidateIneligibility,
  type AdCandidate,
  type CreativeDbStatus,
} from "../../lib/ads/category-matching";
import {
  selectAd,
  toPublicResponse,
  utcDateString,
  type CandidateLoader,
  type SelectionDeps,
  type SelectionRequest,
} from "../../lib/ads/selection";

// ---------- helpers ----------
const PUBLISHER_ID = "99999999-9999-4999-8999-999999999999";
const CAMPAIGN_1 = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_2 = "22222222-2222-4222-8222-222222222222";
const CREATIVE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const CREATIVE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const CREATIVE_C = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";

const NOW = new Date("2026-10-24T12:00:00Z"); // aaj (UTC) = 2026-10-24
const UNIT = 0.002; // 2.00 USD CPM

function cand(creativeId: string, campaignId: string, over: Partial<AdCandidate> = {}): AdCandidate {
  return {
    ad: {
      id: creativeId,
      headline: "Level up your game",
      body: "Try the new controller today.",
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

type Spy = { calls: Array<{ category: string; today: string }>; loader: CandidateLoader };

function spyLoader(rows: readonly AdCandidate[] | (() => Promise<readonly AdCandidate[]>)): Spy {
  const calls: Spy["calls"] = [];
  const loader: CandidateLoader = async (category, today) => {
    calls.push({ category, today });
    return typeof rows === "function" ? rows() : rows;
  };
  return { calls, loader };
}

function deps(loader: CandidateLoader, over: Partial<SelectionDeps> = {}): SelectionDeps {
  return { loadCandidates: loader, now: () => NOW, unitCostUsd: UNIT, spendTracking: "reliable", ...over };
}

function req(category: unknown = "gaming", over: Partial<SelectionRequest> = {}): SelectionRequest {
  return { publisher: { id: PUBLISHER_ID, status: "active" }, category, ...over };
}

async function run(rows: readonly AdCandidate[], over: Partial<SelectionDeps> = {}, r: SelectionRequest = req()) {
  return selectAd(r, deps(spyLoader(rows).loader, over));
}

// ---------- 1. the five required cases ----------
describe("required cases: active / paused / expired / future-dated / no eligible creative", () => {
  it("ACTIVE campaign with an approved creative is selected", async () => {
    const out = await run([cand(CREATIVE_A, CAMPAIGN_1)]);
    assert.equal(out.fill, true);
    if (out.fill) assert.equal(out.ad.id, CREATIVE_A);
  });

  it("PAUSED campaign is excluded (no-fill)", async () => {
    const out = await run([cand(CREATIVE_A, CAMPAIGN_1, { campaignStatus: "paused" })]);
    assert.deepEqual(out, { fill: false, reason: "no_eligible_candidates" });
  });

  it("EXPIRED campaign (end_date yesterday) is excluded; end_date today is still eligible", async () => {
    const expired = await run([cand(CREATIVE_A, CAMPAIGN_1, { endDate: "2026-10-23" })]);
    assert.deepEqual(expired, { fill: false, reason: "no_eligible_candidates" });
    const lastDay = await run([cand(CREATIVE_A, CAMPAIGN_1, { endDate: "2026-10-24" })]);
    assert.equal(lastDay.fill, true);
  });

  it("FUTURE-dated campaign (start_date tomorrow) is excluded; start_date today is eligible", async () => {
    const future = await run([cand(CREATIVE_A, CAMPAIGN_1, { startDate: "2026-10-25" })]);
    assert.deepEqual(future, { fill: false, reason: "no_eligible_candidates" });
    const startsToday = await run([cand(CREATIVE_A, CAMPAIGN_1, { startDate: "2026-10-24" })]);
    assert.equal(startsToday.fill, true);
  });

  it("NO ELIGIBLE CREATIVE: empty list and all-ineligible list both give a safe no-fill", async () => {
    assert.deepEqual(await run([]), { fill: false, reason: "no_eligible_candidates" });
    const allBad = await run([
      cand(CREATIVE_A, CAMPAIGN_1, { creativeStatus: "pending_review" }),
      cand(CREATIVE_B, CAMPAIGN_1, { campaignStatus: "paused" }),
      cand(CREATIVE_C, CAMPAIGN_2, { endDate: "2026-01-01" }),
    ]);
    assert.deepEqual(allBad, { fill: false, reason: "no_eligible_candidates" });
    assert.deepEqual(toPublicResponse(allBad), { fill: false });
  });

  it("campaign statuses other than active are all excluded", async () => {
    for (const status of ["draft", "pending_review", "paused", "completed", "rejected", "archived"] as const) {
      const out = await run([cand(CREATIVE_A, CAMPAIGN_1, { campaignStatus: status })]);
      assert.equal(out.fill, false, status);
    }
  });
});

// ---------- 2. timezone-safe dates ----------
describe("timezone-safe day logic (UTC)", () => {
  it("utcDateString uses the UTC day, not the server's local day", () => {
    assert.equal(utcDateString(new Date("2026-10-24T23:30:00-05:00")), "2026-10-25"); // = 04:30Z next day
    assert.equal(utcDateString(new Date("2026-10-24T00:30:00+05:30")), "2026-10-23"); // = 19:00Z previous day
    assert.equal(utcDateString(new Date("2026-10-24T00:00:00Z")), "2026-10-24");
    assert.equal(utcDateString(new Date("2026-10-24T23:59:59.999Z")), "2026-10-24");
    assert.equal(utcDateString(new Date("2028-02-29T10:00:00Z")), "2028-02-29");
  });

  it("utcDateString rejects invalid input instead of guessing", () => {
    assert.equal(utcDateString(new Date("not a date")), null);
    assert.equal(utcDateString("2026-10-24" as unknown as Date), null);
    assert.equal(utcDateString(null as unknown as Date), null);
  });

  it("11:30pm in New York (still Oct 24 locally) is already Oct 25 UTC: a campaign ending Oct 24 is expired", async () => {
    const now = () => new Date("2026-10-24T23:30:00-05:00");
    const out = await run([cand(CREATIVE_A, CAMPAIGN_1, { endDate: "2026-10-24" })], { now });
    assert.equal(out.fill, false);
  });

  it("12:30am in Mumbai on Oct 24 is still Oct 23 UTC: a campaign starting Oct 24 has not started", async () => {
    const now = () => new Date("2026-10-24T00:30:00+05:30");
    const out = await run([cand(CREATIVE_A, CAMPAIGN_1, { startDate: "2026-10-24" })], { now });
    assert.equal(out.fill, false);
  });

  it("the loader receives the UTC date computed from the injected clock", async () => {
    const spy = spyLoader([]);
    await selectAd(req(), deps(spy.loader, { now: () => new Date("2026-10-24T23:30:00-05:00") }));
    assert.deepEqual(spy.calls, [{ category: "gaming", today: "2026-10-25" }]);
  });

  it("an invalid clock gives no-fill and never calls the loader", async () => {
    const spy = spyLoader([cand(CREATIVE_A, CAMPAIGN_1)]);
    const out = await selectAd(req(), deps(spy.loader, { now: () => new Date("garbage") }));
    assert.deepEqual(out, { fill: false, reason: "invalid_context" });
    assert.equal(spy.calls.length, 0);
  });

  it("a throwing clock gives no-fill, not a crash", async () => {
    const out = await selectAd(
      req(),
      deps(spyLoader([]).loader, {
        now: () => {
          throw new Error("clock broke");
        },
      }),
    );
    assert.equal(out.fill, false);
  });
});

// ---------- 3. creative approval / status / completeness ----------
describe("creative approval, status and completeness", () => {
  const notApproved: CreativeDbStatus[] = ["draft", "pending_review", "rejected", "paused", "archived"];
  for (const status of notApproved) {
    it(`creative status '${status}' is excluded`, async () => {
      assert.equal((await run([cand(CREATIVE_A, CAMPAIGN_1, { creativeStatus: status })])).fill, false);
    });
  }

  const incomplete: Array<[string, Partial<AdCandidate["ad"]>]> = [
    ["empty headline", { headline: "" }],
    ["blank headline", { headline: "   " }],
    ["headline over 90 chars", { headline: "x".repeat(91) }],
    ["empty body", { body: "" }],
    ["body over 300 chars", { body: "x".repeat(301) }],
    ["blank cta text", { ctaText: "  " }],
    ["cta over 30 chars", { ctaText: "x".repeat(31) }],
    ["http destination", { destinationUrl: "http://example.com" }],
    ["javascript destination", { destinationUrl: "javascript:alert(1)" }],
    ["destination with space", { destinationUrl: "https://exa mple.com" }],
    ["empty destination", { destinationUrl: "" }],
    ["destination over 2048 chars", { destinationUrl: "https://example.com/" + "a".repeat(2040) }],
  ];
  for (const [name, adOver] of incomplete) {
    it(`incomplete creative (${name}) is excluded`, async () => {
      const c = cand(CREATIVE_A, CAMPAIGN_1);
      c.ad = { ...c.ad, ...adOver };
      assert.equal(candidateIneligibility(c, "gaming", { today: "2026-10-24", unitCostUsd: UNIT }), "creative_incomplete");
      assert.equal((await run([c])).fill, false);
    });
  }

  it("cta_text null is allowed (optional column)", async () => {
    const c = cand(CREATIVE_A, CAMPAIGN_1);
    c.ad = { ...c.ad, ctaText: null };
    assert.equal((await run([c])).fill, true);
  });

  it("an incomplete creative never blocks a good one from the same campaign", async () => {
    const bad = cand(CREATIVE_A, CAMPAIGN_1);
    bad.ad = { ...bad.ad, headline: "" };
    const out = await run([bad, cand(CREATIVE_B, CAMPAIGN_1)]);
    assert.equal(out.fill && out.ad.id, CREATIVE_B);
  });

  it("suspended / pending advertiser and suspended advertiser profile are excluded", async () => {
    assert.equal((await run([cand(CREATIVE_A, CAMPAIGN_1, { advertiserStatus: "suspended" })])).fill, false);
    assert.equal((await run([cand(CREATIVE_A, CAMPAIGN_1, { advertiserStatus: "pending" })])).fill, false);
    assert.equal((await run([cand(CREATIVE_A, CAMPAIGN_1, { advertiserProfileStatus: "suspended" })])).fill, false);
  });
});

// ---------- 4. category matching ----------
describe("category matching in the selection layer", () => {
  it("only candidates of the requested category are selected", async () => {
    const out = await run([cand(CREATIVE_A, CAMPAIGN_1, { category: "travel" }), cand(CREATIVE_B, CAMPAIGN_2)]);
    assert.equal(out.fill && out.ad.id, CREATIVE_B);
  });

  it("an alias resolves to the canonical category before loading", async () => {
    const spy = spyLoader([cand(CREATIVE_A, CAMPAIGN_1)]);
    const out = await selectAd(req("Games"), deps(spy.loader));
    assert.equal(out.fill, true);
    assert.equal(spy.calls[0].category, "gaming");
  });

  it("sensitive / unsupported / free-text categories give no-fill WITHOUT loading anything", async () => {
    for (const category of ["health", "religion", "beauty", "totally unknown", "tell me about my medical condition", 42, null]) {
      const spy = spyLoader([cand(CREATIVE_A, CAMPAIGN_1)]);
      const out = await selectAd(req(category), deps(spy.loader));
      assert.equal(out.fill, false, String(category));
      assert.equal(spy.calls.length, 0, String(category));
    }
  });

  it("an inactive or malformed publisher gets no-fill and no loader call", async () => {
    for (const publisher of [{ id: PUBLISHER_ID, status: "suspended" }, { id: "nope", status: "active" }]) {
      const spy = spyLoader([cand(CREATIVE_A, CAMPAIGN_1)]);
      const out = await selectAd({ publisher, category: "gaming" }, deps(spy.loader));
      assert.deepEqual(out, { fill: false, reason: "publisher_not_authorized" });
      assert.equal(spy.calls.length, 0);
    }
  });
});

// ---------- 5. budget: reliable vs unavailable spend data ----------
describe("budget handling", () => {
  it("total_budget is NOT remaining budget: a campaign with total 100 and 100 spent is excluded", async () => {
    const out = await run([cand(CREATIVE_A, CAMPAIGN_1, { totalBudget: 100, spentTotal: 100 })]);
    assert.equal(out.fill, false);
  });

  it("less than one impression of total budget left is excluded; exactly one impression left is eligible", async () => {
    assert.equal((await run([cand(CREATIVE_A, CAMPAIGN_1, { totalBudget: 100, spentTotal: 99.999 })])).fill, false);
    assert.equal((await run([cand(CREATIVE_A, CAMPAIGN_1, { totalBudget: 100, spentTotal: 99.998 })])).fill, true);
  });

  it("daily budget reached today is excluded; null daily budget means no daily cap", async () => {
    assert.equal((await run([cand(CREATIVE_A, CAMPAIGN_1, { dailyBudget: 10, spentToday: 10 })])).fill, false);
    assert.equal((await run([cand(CREATIVE_A, CAMPAIGN_1, { dailyBudget: 10, spentToday: 5 })])).fill, true);
    assert.equal((await run([cand(CREATIVE_A, CAMPAIGN_1, { dailyBudget: null, spentToday: 9999 })])).fill, true);
  });

  it("reliable spend data: outcome says budgetEnforced = true", async () => {
    const out = await run([cand(CREATIVE_A, CAMPAIGN_1)]);
    assert.equal(out.fill && out.budgetEnforced, true);
  });

  it("spend data UNAVAILABLE: budget is not checked, and the outcome admits it (budgetEnforced = false)", async () => {
    const exhausted = cand(CREATIVE_A, CAMPAIGN_1, { totalBudget: 100, spentTotal: 100, dailyBudget: 10, spentToday: 10 });
    const out = await run([exhausted], { spendTracking: "unavailable" });
    assert.equal(out.fill, true);
    if (out.fill) assert.equal(out.budgetEnforced, false);
  });

  it("spend data unavailable does not relax any non-budget rule", async () => {
    const rows = [
      cand(CREATIVE_A, CAMPAIGN_1, { campaignStatus: "paused" }),
      cand(CREATIVE_B, CAMPAIGN_1, { endDate: "2026-10-01" }),
      cand(CREATIVE_C, CAMPAIGN_2, { creativeStatus: "draft" }),
    ];
    assert.equal((await run(rows, { spendTracking: "unavailable" })).fill, false);
  });

  it("an invalid unit cost is rejected as no-fill (never silently treated as free)", async () => {
    for (const unitCostUsd of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const out = await run([cand(CREATIVE_A, CAMPAIGN_1)], { unitCostUsd });
      assert.deepEqual(out, { fill: false, reason: "invalid_context" });
    }
  });
});

// ---------- 6. selection strategy ----------
describe("selection strategy (deterministic, no random)", () => {
  it("the campaign served least today wins over a lower id", async () => {
    const out = await run([
      cand(CREATIVE_A, CAMPAIGN_1, { campaignServesToday: 5 }),
      cand(CREATIVE_B, CAMPAIGN_2, { campaignServesToday: 1 }),
    ]);
    assert.equal(out.fill && out.ad.id, CREATIVE_B);
  });

  it("inside one campaign the creative served least wins; ties go to the lowest ids", async () => {
    const a = await run([
      cand(CREATIVE_A, CAMPAIGN_1, { creativeServesToday: 3 }),
      cand(CREATIVE_B, CAMPAIGN_1, { creativeServesToday: 1 }),
    ]);
    assert.equal(a.fill && a.ad.id, CREATIVE_B);
    const b = await run([cand(CREATIVE_C, CAMPAIGN_2), cand(CREATIVE_B, CAMPAIGN_1), cand(CREATIVE_A, CAMPAIGN_1)]);
    assert.equal(b.fill && b.ad.id, CREATIVE_A);
  });

  it("same result for every input order and across repeated runs", async () => {
    const rows = [cand(CREATIVE_A, CAMPAIGN_1), cand(CREATIVE_B, CAMPAIGN_2), cand(CREATIVE_C, CAMPAIGN_2)];
    const ids = new Set<string>();
    for (const order of [[0, 1, 2], [2, 1, 0], [1, 0, 2], [1, 2, 0]]) {
      for (let i = 0; i < 3; i++) {
        const out = await run(order.map((n) => rows[n]));
        ids.add(out.fill ? out.ad.id : "none");
      }
    }
    assert.deepEqual([...ids], [CREATIVE_A]);
  });

  it("excluded creatives are skipped when an alternative exists", async () => {
    const out = await run([cand(CREATIVE_A, CAMPAIGN_1), cand(CREATIVE_B, CAMPAIGN_2)], {}, req("gaming", { excludeCreativeIds: [CREATIVE_A] }));
    assert.equal(out.fill && out.ad.id, CREATIVE_B);
    assert.equal(out.fill && out.repeat, false);
  });

  it("repeat happens only when every eligible creative was excluded", async () => {
    const out = await run([cand(CREATIVE_A, CAMPAIGN_1)], {}, req("gaming", { excludeCreativeIds: [CREATIVE_A] }));
    assert.equal(out.fill && out.ad.id, CREATIVE_A);
    assert.equal(out.fill && out.repeat, true);
  });

  it("an ineligible creative is never chosen just because it is the least served", async () => {
    const out = await run([
      cand(CREATIVE_A, CAMPAIGN_1, { campaignStatus: "paused", campaignServesToday: 0 }),
      cand(CREATIVE_B, CAMPAIGN_2, { campaignServesToday: 50 }),
    ]);
    assert.equal(out.fill && out.ad.id, CREATIVE_B);
  });
});

// ---------- 7. safe failure ----------
describe("safe no-fill on failures", () => {
  it("a loader that throws gives no-fill, not an exception", async () => {
    const out = await selectAd(
      req(),
      deps(
        spyLoader(async () => {
          throw new Error("db down: secret detail");
        }).loader,
      ),
    );
    assert.deepEqual(out, { fill: false, reason: "candidate_load_failed" });
    assert.equal(JSON.stringify(toPublicResponse(out)).includes("secret"), false);
  });

  it("a loader that returns junk gives no-fill", async () => {
    for (const junk of [null, undefined, "rows", 7, {}]) {
      const out = await selectAd(req(), deps((async () => junk) as unknown as CandidateLoader));
      assert.deepEqual(out, { fill: false, reason: "candidate_load_failed" });
    }
  });

  it("malformed rows are skipped, good rows still win", async () => {
    const broken = { ...cand(CREATIVE_A, CAMPAIGN_1), startDate: "2026-13-45" } as AdCandidate;
    const out = await run([null as unknown as AdCandidate, broken, cand(CREATIVE_B, CAMPAIGN_2)]);
    assert.equal(out.fill && out.ad.id, CREATIVE_B);
  });

  it("does not mutate the candidate list or its rows", async () => {
    const rows = [cand(CREATIVE_B, CAMPAIGN_2), cand(CREATIVE_A, CAMPAIGN_1)];
    const before = JSON.stringify(rows);
    await run(rows);
    assert.equal(JSON.stringify(rows), before);
  });
});

// ---------- 8. privacy ----------
describe("what the publisher can see", () => {
  it("a fill response has exactly sponsored + the 5 public ad fields", async () => {
    const out = await run([cand(CREATIVE_A, CAMPAIGN_1, { totalBudget: 777.77, dailyBudget: 55.55 })]);
    const res = toPublicResponse(out);
    assert.deepEqual(Object.keys(res).sort(), ["ad", "fill", "sponsored"]);
    if (res.fill) {
      assert.deepEqual(Object.keys(res.ad).sort(), ["body", "ctaText", "destinationUrl", "headline", "id"]);
    }
  });

  it("no campaign id, budget, spend, advertiser or status ever appears in the public response", async () => {
    const out = await run([cand(CREATIVE_A, CAMPAIGN_1, { totalBudget: 777.77, dailyBudget: 55.55, spentTotal: 12.34 })]);
    const json = JSON.stringify(toPublicResponse(out));
    for (const secret of [CAMPAIGN_1, "777.77", "55.55", "12.34", "advertiser", "budget", "campaign", "spent", "active"]) {
      assert.equal(json.includes(secret), false, secret);
    }
  });

  it("every kind of no-fill collapses to exactly {fill:false}", async () => {
    const outcomes = [
      await run([]),
      await run([cand(CREATIVE_A, CAMPAIGN_1, { campaignStatus: "paused" })]),
      await selectAd(req("health"), deps(spyLoader([]).loader)),
      await selectAd({ publisher: { id: PUBLISHER_ID, status: "suspended" }, category: "gaming" }, deps(spyLoader([]).loader)),
      await selectAd(req(), deps(spyLoader(async () => { throw new Error("x"); }).loader)),
    ];
    for (const o of outcomes) assert.equal(JSON.stringify(toPublicResponse(o)), '{"fill":false}');
  });

  it("extra fields smuggled onto the selected ad are dropped", async () => {
    const c = cand(CREATIVE_A, CAMPAIGN_1);
    (c.ad as Record<string, unknown>).advertiserEmail = "x@y.z";
    const res = toPublicResponse(await run([c]));
    assert.equal(JSON.stringify(res).includes("x@y.z"), false);
  });

  it("the loader is given only the category and the date (no publisher, key or exclude list)", async () => {
    const spy = spyLoader([]);
    await selectAd(req("gaming", { excludeCreativeIds: [CREATIVE_A] }), deps(spy.loader));
    assert.deepEqual(spy.calls, [{ category: "gaming", today: "2026-10-24" }]);
  });
});

// ---------- 9. no counters, no billing, no secrets ----------
describe("selection module is read-only and secret-free", () => {
  const source = readFileSync(path.join(__dirname, "..", "..", "..", "lib", "ads", "selection.ts"), "utf8");
  const code = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*") && !line.trim().startsWith("/*"))
    .join("\n");

  it("selectAd calls only loadCandidates (nothing else on deps)", async () => {
    const touched: string[] = [];
    const base = deps(spyLoader([cand(CREATIVE_A, CAMPAIGN_1)]).loader);
    const proxy = new Proxy(base, {
      get(target, prop, receiver) {
        touched.push(String(prop));
        return Reflect.get(target, prop, receiver);
      },
    });
    await selectAd(req(), proxy);
    assert.deepEqual([...new Set(touched)].sort(), ["loadCandidates", "now", "spendTracking", "unitCostUsd"]);
  });

  const forbidden: Array<[string, RegExp]> = [
    ["database / supabase", /supabase|createClient|\.from\(|\.rpc\(/i],
    ["writes (insert/update/upsert/delete)", /\.(insert|update|upsert|delete)\(/],
    ["service-role / secret key", /service_role|SECRET_KEY|process\.env/i],
    ["network", /\bfetch\(|XMLHttpRequest|WebSocket/],
    ["clock or random inside the module", /Date\.now|new Date\(|Math\.random|crypto/],
    ["impression / click / billing words", /impression|click|charge|invoice|billing/i],
    ["browser / DOM", /\bwindow\b|\bdocument\b|localStorage/],
  ];
  for (const [name, re] of forbidden) {
    it(`source has no ${name}`, () => assert.equal(re.test(code), false));
  }

  it("only imports local relative modules", () => {
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    assert.ok(imports.length > 0);
    for (const spec of imports) assert.ok(spec.startsWith("./"), spec);
  });
});
