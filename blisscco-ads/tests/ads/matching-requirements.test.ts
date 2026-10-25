import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { hashApiKey } from "@/lib/ads/api-key";
import { matchCategorySignal, type AdCandidate } from "@/lib/ads/category-matching";
import { selectAd } from "@/lib/ads/selection";
import { serveAd, type ServeDeps } from "@/lib/ads/serve";
import * as routeModule from "@/app/api/ads/match/route";

// Day 5 Part 5: matching engine ka requirement-wise test suite (13 requirements, har ek apna describe).
//
// - Sab data NAKLI hai. Asli ad request, asli database, production records kuch nahi chhuta.
// - Route tests poora pipeline chalate hain (route -> serve -> selection -> category matching) nakli database ke saath.
//   Database ke rows jaan-boojh kar "ganda" bhi bheje jaate hain (paused, expired, ...): SQL ke coarse filter par
//   bharosa na karke TypeScript layer ka apna filter test hota hai (defense in depth).
// - Schema se milan: supabase/sql files padhkar (statuses, serve log ke columns, grants).

const ROOT = path.join(__dirname, "..", "..", "..");
const KEY = `blc_live_${"a".repeat(64)}`;
const PUBLISHER_ID = "99999999-9999-4999-8999-999999999999";
const CAMP_TECH = "10000000-0000-4000-8000-000000000001";
const CAMP_DEV = "10000000-0000-4000-8000-000000000002";
const CAMP_GAME = "10000000-0000-4000-8000-000000000003";
const CR_TECH = "a0000000-0000-4000-8000-000000000001";
const CR_DEV = "a0000000-0000-4000-8000-000000000002";
const CR_GAME = "a0000000-0000-4000-8000-000000000003";

// ---------- din ki taareekhen (route asli clock use karta hai, isliye aaj ke hisaab se) ----------
function utcDay(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
const YESTERDAY = utcDay(-1);
const TOMORROW = utcDay(1);
const LONG_AGO = utcDay(-30);

// ---------- nakli database ----------
type Row = Record<string, unknown>;

function row(creativeId: string, campaignId: string, category: string, over: Row = {}): Row {
  return {
    creative_id: creativeId,
    headline: `Headline ${category}`,
    body: `Body ${category}`,
    cta_text: "Learn more",
    destination_url: `https://example.com/${category}`,
    creative_status: "approved",
    campaign_id: campaignId,
    campaign_status: "active",
    category,
    start_date: LONG_AGO,
    end_date: null,
    total_budget: 500,
    daily_budget: 50,
    spent_total: 12.5,
    spent_today: 1.25,
    advertiser_status: "active",
    advertiser_profile_status: "active",
    campaign_serves_today: 0,
    creative_serves_today: 0,
    ...over,
  };
}

const techRow = (over: Row = {}) => row(CR_TECH, CAMP_TECH, "technology", over);
const devRow = (over: Row = {}) => row(CR_DEV, CAMP_DEV, "developer_tools", over);
const gameRow = (over: Row = {}) => row(CR_GAME, CAMP_GAME, "gaming", over);

type RpcCall = { name: string; args: Record<string, unknown> };
type Reply = { data: unknown; error: { code?: string } | null };

const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
const realConsoleError = console.error;
let calls: RpcCall[] = [];
let logged: unknown[][] = [];

const AUTH_OK: Reply = {
  data: { outcome: "ok", publisher_id: PUBLISHER_ID, publisher_status: "active", unit_cost_usd: 0.002 },
  error: null,
};

/** Database: load_ad_candidates sirf wahi rows deta hai jinki category maangi gayi category ke barabar hai (SQL jaisa). */
function useDb(opts: { rows?: Row[]; auth?: Reply; record?: Reply; loadError?: boolean; noCategoryFilter?: boolean } = {}) {
  calls = [];
  globals.__TEST_SUPABASE__ = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "authorize_publisher_key") return opts.auth ?? AUTH_OK;
      if (name === "load_ad_candidates") {
        if (opts.loadError) return { data: null, error: { code: "XX000" } };
        const wanted = args.p_category;
        return { data: (opts.rows ?? []).filter((r) => opts.noCategoryFilter || r.category === wanted), error: null };
      }
      if (name === "record_ad_serve") return opts.record ?? { data: { outcome: "ok" }, error: null };
      throw new Error(`test: unexpected rpc ${name}`);
    },
  };
}

beforeEach(() => {
  logged = [];
  console.error = (...a: unknown[]) => {
    logged.push(a);
  };
  useDb();
});
afterEach(() => {
  console.error = realConsoleError;
  delete globals.__TEST_SUPABASE__;
});

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://blisscco.test/api/ads/match", {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function call(body: unknown, headers: Record<string, string> = {}) {
  const res = await routeModule.POST(post(body, headers));
  const json = (await res.json()) as Record<string, unknown>;
  return { res, json };
}

const names = () => calls.map((c) => c.name);
const adOf = (json: Record<string, unknown>) => json.ad as Record<string, unknown>;

// ===========================================================================
describe("R1: technology topic matches an eligible Technology campaign", () => {
  it("returns the technology creative", async () => {
    useDb({ rows: [techRow(), devRow(), gameRow()] });
    const { res, json } = await call({ topic: "technology" });
    assert.equal(res.status, 200);
    assert.equal(json.fill, true);
    assert.equal(json.sponsored, true);
    assert.equal(adOf(json).id, CR_TECH);
    assert.equal(calls.find((c) => c.name === "load_ad_candidates")?.args.p_category, "technology");
  });

  it("the alias 'tech' reaches the same creative", async () => {
    useDb({ rows: [techRow()] });
    const { json } = await call({ topic: "tech" });
    assert.equal(adOf(json).id, CR_TECH);
  });
});

// ===========================================================================
describe("R2: coding tools category matches an eligible Developer Tools campaign (taxonomy permits it)", () => {
  for (const topic of ["developer_tools", "dev_tools", "devtools", "coding_tools"]) {
    it(`'${topic}' -> Developer Tools creative`, async () => {
      useDb({ rows: [techRow(), devRow()] });
      const { json } = await call({ topic });
      assert.equal(json.fill, true, topic);
      assert.equal(adOf(json).id, CR_DEV, topic);
      assert.equal(calls.find((c) => c.name === "load_ad_candidates")?.args.p_category, "developer_tools");
    });
  }

  it("a Technology campaign is NOT returned for developer_tools (no fuzzy parent/child match)", async () => {
    useDb({ rows: [techRow()] });
    const { json } = await call({ topic: "developer_tools" });
    assert.deepEqual(json, { fill: false });
  });

  it("a phrase outside the taxonomy ('coding') is not guessed", async () => {
    useDb({ rows: [devRow()] });
    const { json } = await call({ topic: "coding" });
    assert.deepEqual(json, { fill: false });
    assert.ok(!names().includes("load_ad_candidates"));
  });
});

// ===========================================================================
describe("R3: gaming topic never returns an unrelated category (no fallback policy exists)", () => {
  it("only technology + developer tools campaigns exist -> no-fill for gaming", async () => {
    useDb({ rows: [techRow(), devRow()] });
    const { res, json } = await call({ topic: "gaming" });
    assert.equal(res.status, 200);
    assert.deepEqual(json, { fill: false });
    assert.ok(!names().includes("record_ad_serve"));
  });

  it("even if the database wrongly returned other categories, the TypeScript layer drops them", async () => {
    // SQL ka category filter toot gaya maan lo: gaming maangne par technology/developer_tools ki rows aa jaati hain
    useDb({ rows: [techRow(), devRow()], noCategoryFilter: true });
    const { json } = await call({ topic: "gaming" });
    assert.deepEqual(json, { fill: false });
  });

  it("when a gaming campaign exists, only the gaming creative is returned", async () => {
    useDb({ rows: [techRow(), devRow(), gameRow()] });
    const { json } = await call({ topic: "gaming" });
    assert.equal(adOf(json).id, CR_GAME);
  });

  it("no fallback policy is present in the matching sources", () => {
    for (const f of ["lib/ads/category-matching.ts", "lib/ads/selection.ts", "lib/ads/serve.ts"]) {
      const src = readFileSync(path.join(ROOT, f), "utf8").replace(/\/\/.*$/gm, "");
      assert.equal(/fallback|default_?category|any_?category/i.test(src), false, f);
    }
  });
});

// ===========================================================================
describe("R4: invalid or missing category returns a safe validation or no-fill response", () => {
  it("missing / wrong-type / malformed topic -> 400 invalid_topic, nothing queried", async () => {
    const bodies: unknown[] = [{}, { topic: null }, { topic: 5 }, { topic: ["gaming"] }, { topic: "" }, { topic: "Gaming" },
      { topic: "gam ing" }, { topic: "x".repeat(51) }, { topic: "gaming;drop" }, { topic: "../etc" }];
    for (const body of bodies) {
      useDb({ rows: [gameRow()] });
      const { res, json } = await call(body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.deepEqual(json, { error: "invalid_request", reason: "invalid_topic" }, JSON.stringify(body));
      assert.equal(calls.length, 0, JSON.stringify(body));
    }
  });

  it("well-formed but unsupported / sensitive / legacy topics -> 200 no-fill, no campaign query", async () => {
    for (const topic of ["unknown_topic", "health", "religion", "politics", "sexuality", "beauty", "a_b_c_d"]) {
      useDb({ rows: [gameRow(), techRow(), devRow()] });
      const { res, json } = await call({ topic });
      assert.equal(res.status, 200, topic);
      assert.deepEqual(json, { fill: false }, topic);
      assert.deepEqual(names(), ["authorize_publisher_key"], topic);
    }
  });

  it("the no-fill body never says WHY (no category / reason / candidate info)", async () => {
    const { json } = await call({ topic: "health" });
    assert.deepEqual(Object.keys(json), ["fill"]);
  });
});

// ===========================================================================
describe("R5: paused campaigns are excluded", () => {
  for (const status of ["paused", "draft", "pending_review", "completed", "rejected", "archived"]) {
    it(`campaign status '${status}' -> no-fill`, async () => {
      useDb({ rows: [techRow({ campaign_status: status })] });
      const { json } = await call({ topic: "technology" });
      assert.deepEqual(json, { fill: false });
      assert.ok(!names().includes("record_ad_serve"));
    });
  }

  it("a paused campaign does not block a different active campaign in the same category", async () => {
    const other = row("a0000000-0000-4000-8000-0000000000aa", "10000000-0000-4000-8000-0000000000aa", "technology");
    useDb({ rows: [techRow({ campaign_status: "paused" }), other] });
    const { json } = await call({ topic: "technology" });
    assert.equal(adOf(json).id, "a0000000-0000-4000-8000-0000000000aa");
  });
});

// ===========================================================================
describe("R6: future-dated and expired campaigns are excluded", () => {
  it("starts tomorrow -> no-fill", async () => {
    useDb({ rows: [techRow({ start_date: TOMORROW })] });
    assert.deepEqual((await call({ topic: "technology" })).json, { fill: false });
  });

  it("ended yesterday -> no-fill", async () => {
    useDb({ rows: [techRow({ end_date: YESTERDAY })] });
    assert.deepEqual((await call({ topic: "technology" })).json, { fill: false });
  });

  it("boundaries are inclusive: starts today / ends today -> served", async () => {
    const today = utcDay(0);
    useDb({ rows: [techRow({ start_date: today, end_date: today })] });
    const { json } = await call({ topic: "technology" });
    assert.equal(json.fill, true);
  });

  it("unit level: UTC day boundary does not depend on the server timezone", async () => {
    const now = () => new Date("2026-10-24T23:59:59Z");
    const mk = (over: Partial<AdCandidate>): AdCandidate => ({
      ad: { id: CR_TECH, headline: "H", body: "B", ctaText: null, destinationUrl: "https://example.com/x" },
      creativeStatus: "approved", campaignId: CAMP_TECH, campaignStatus: "active", category: "technology",
      startDate: "2026-10-01", endDate: null, totalBudget: 100, dailyBudget: null, spentTotal: 0, spentToday: 0,
      advertiserStatus: "active", advertiserProfileStatus: "active", campaignServesToday: 0, creativeServesToday: 0, ...over,
    });
    for (const [over, expectFill] of [
      [{ startDate: "2026-10-25" }, false],
      [{ endDate: "2026-10-23" }, false],
      [{ startDate: "2026-10-24", endDate: "2026-10-24" }, true],
    ] as const) {
      const out = await selectAd(
        { publisher: { id: PUBLISHER_ID, status: "active" }, category: "technology" },
        { loadCandidates: async () => [mk(over)], now, unitCostUsd: 0.002, spendTracking: "unavailable" },
      );
      assert.equal(out.fill, expectFill, JSON.stringify(over));
    }
  });
});

// ===========================================================================
describe("R7: inactive or unapproved creatives are excluded", () => {
  for (const status of ["draft", "pending_review", "rejected", "paused", "archived"]) {
    it(`creative status '${status}' -> no-fill`, async () => {
      useDb({ rows: [techRow({ creative_status: status })] });
      assert.deepEqual((await call({ topic: "technology" })).json, { fill: false });
      assert.ok(!names().includes("record_ad_serve"));
    });
  }

  it("inactive / suspended advertiser or advertiser profile -> no-fill", async () => {
    for (const over of [{ advertiser_status: "suspended" }, { advertiser_status: "pending" }, { advertiser_profile_status: "suspended" }]) {
      useDb({ rows: [techRow(over)] });
      assert.deepEqual((await call({ topic: "technology" })).json, { fill: false }, JSON.stringify(over));
    }
  });

  it("an incomplete creative (empty headline, http URL) is never served", async () => {
    for (const over of [{ headline: "   " }, { destination_url: "http://example.com" }, { destination_url: "javascript:alert(1)" }]) {
      useDb({ rows: [techRow(over)] });
      assert.deepEqual((await call({ topic: "technology" })).json, { fill: false }, JSON.stringify(over));
    }
  });

  it("schema: the test statuses are exactly the database CHECK values", () => {
    const creatives = readFileSync(path.join(ROOT, "supabase/sql/day-3-4-ad-creative.sql"), "utf8");
    const campaigns = readFileSync(path.join(ROOT, "supabase/sql/day-3-3-campaign.sql"), "utf8");
    for (const s of ["draft", "pending_review", "approved", "rejected", "paused", "archived"]) assert.ok(creatives.includes(`'${s}'`), s);
    for (const s of ["draft", "pending_review", "active", "paused", "completed", "rejected", "archived"]) assert.ok(campaigns.includes(`'${s}'`), s);
  });
});

// ===========================================================================
describe("R8: no eligible campaign returns no-fill, never an error that leaks internals", () => {
  it("empty database result -> 200 {fill:false}", async () => {
    useDb({ rows: [] });
    const { res, json } = await call({ topic: "technology" });
    assert.equal(res.status, 200);
    assert.deepEqual(json, { fill: false });
  });

  it("candidate load failure -> 503 (outage, not 'no ad'); error code / table names never reach the response", async () => {
    useDb({ loadError: true });
    const { res, json } = await call({ topic: "technology" });
    assert.equal(res.status, 503);
    assert.deepEqual(json, { fill: false, error: "unavailable" });
    assert.ok(!/XX000|rpc|supabase|postgres|select|stack/i.test(JSON.stringify(json)));
  });

  it("authorize / record database failures -> 503 with a fixed body, no details", async () => {
    useDb({ auth: { data: null, error: { code: "XX000" } } });
    let r = await call({ topic: "technology" });
    assert.equal(r.res.status, 503);
    assert.deepEqual(r.json, { fill: false, error: "unavailable" });

    useDb({ rows: [techRow()], record: { data: null, error: { code: "XX000" } } });
    r = await call({ topic: "technology" });
    assert.equal(r.res.status, 503);
    assert.deepEqual(r.json, { fill: false, error: "unavailable" });
  });

  it("only the error CODE is logged (never message, key, topic, ad text)", async () => {
    useDb({ rows: [techRow()], record: { data: null, error: { code: "XX000" } } });
    await call({ topic: "technology" });
    const text = JSON.stringify(logged);
    assert.ok(text.includes("XX000"));
    for (const secret of [KEY, hashApiKey(KEY), "technology", "Headline", "example.com"]) {
      assert.ok(!text.includes(secret), secret);
    }
  });

  it("a thrown exception from the database client becomes 503, not a stack trace", async () => {
    globals.__TEST_SUPABASE__ = {
      rpc: async () => {
        throw new Error("password=hunter2 at /var/task/secret.js:1");
      },
    };
    const { res, json } = await call({ topic: "technology" });
    assert.equal(res.status, 503);
    assert.ok(!/hunter2|secret\.js|at \//.test(JSON.stringify(json)));
  });
});

// ===========================================================================
describe("R9: publisher authorization failures never return ads", () => {
  const bad: Array<[string, Reply, number]> = [
    ["unauthorized (unknown/revoked key, suspended publisher or profile)", { data: { outcome: "unauthorized" }, error: null }, 401],
    ["rate limited", { data: { outcome: "rate_limited" }, error: null }, 429],
    ["database error", { data: null, error: { code: "42501" } }, 503],
    ["garbage outcome", { data: { outcome: "ok", publisher_id: "nope" }, error: null }, 503],
    ["unknown outcome", { data: { outcome: "maybe" }, error: null }, 503],
  ];
  for (const [name, auth, status] of bad) {
    it(`${name} -> ${status}, no campaign query, no ad`, async () => {
      useDb({ rows: [techRow()], auth });
      const { res, json } = await call({ topic: "technology" });
      assert.equal(res.status, status);
      assert.notEqual(json.fill, true);
      assert.equal(json.ad, undefined);
      assert.deepEqual(names(), ["authorize_publisher_key"]);
    });
  }

  it("a publisher whose status is not 'active' is rejected by the matching layer even if authorize said ok", () => {
    for (const status of ["suspended", "pending", "ACTIVE", "", "deleted"]) {
      const r = matchCategorySignal({ publisher: { id: PUBLISHER_ID, status }, category: "technology" }, [], { today: "2026-10-24", unitCostUsd: 0.002 });
      assert.deepEqual(r, { status: "rejected", reason: "publisher_not_authorized" }, status);
    }
  });

  it("a publisher id sent in the body is rejected, never trusted", async () => {
    useDb({ rows: [techRow()] });
    for (const extra of [{ publisher_id: PUBLISHER_ID }, { publisher: { id: PUBLISHER_ID } }, { publisherId: PUBLISHER_ID }]) {
      const { res, json } = await call({ topic: "technology", ...extra });
      assert.equal(res.status, 400);
      assert.deepEqual(json, { error: "invalid_request", reason: "unknown_field" });
    }
    assert.equal(calls.length, 0);
  });

  it("publisher identity used for selection comes from authorize, not from the request", async () => {
    const seen: string[] = [];
    const deps: ServeDeps = {
      authorize: async () => ({ outcome: "ok", publisher: { id: PUBLISHER_ID, status: "active" }, unitCostUsd: 0.002 }),
      select: async (req, unit) => {
        seen.push(req.publisher.id);
        return selectAd(req, { loadCandidates: async () => [], now: () => new Date(), unitCostUsd: unit, spendTracking: "unavailable" });
      },
      record: async () => ({ outcome: "recorded" }),
    };
    await serveAd("h".repeat(64), { topic: "technology", excludeAdIds: [] }, deps);
    assert.deepEqual(seen, [PUBLISHER_ID]);
  });
});

// ===========================================================================
describe("R10: missing or invalid publisher credentials are rejected", () => {
  const cases: Array<[string, Record<string, string> | null]> = [
    ["no Authorization header", null],
    ["empty header", { authorization: "" }],
    ["wrong scheme (Basic)", { authorization: `Basic ${KEY}` }],
    ["bare key without Bearer", { authorization: KEY }],
    ["too short", { authorization: "Bearer blc_live_abc" }],
    ["wrong prefix", { authorization: `Bearer blc_test_${"a".repeat(64)}` }],
    ["uppercase hex", { authorization: `Bearer blc_live_${"A".repeat(64)}` }],
    ["non-hex", { authorization: `Bearer blc_live_${"z".repeat(64)}` }],
    ["extra token", { authorization: `Bearer ${KEY} extra` }],
    ["key in query string only", null],
  ];
  for (const [name, headers] of cases) {
    it(`${name} -> 401, database never called`, async () => {
      useDb({ rows: [techRow()] });
      const req = new Request(`https://blisscco.test/api/ads/match${name.includes("query") ? `?key=${KEY}` : ""}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(headers ?? {}) },
        body: '{"topic":"technology"}',
      });
      const res = await routeModule.POST(req);
      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { error: "unauthorized" });
      assert.match(res.headers.get("www-authenticate") ?? "", /^Bearer/);
      assert.equal(calls.length, 0);
    });
  }

  it("401 body is identical for missing and for unknown keys (no key-existence oracle)", async () => {
    const missing = await routeModule.POST(new Request("https://blisscco.test/api/ads/match", { method: "POST", headers: { "content-type": "application/json" }, body: '{"topic":"technology"}' }));
    useDb({ rows: [techRow()], auth: { data: { outcome: "unauthorized" }, error: null } });
    const unknown = await call({ topic: "technology" });
    assert.deepEqual(await missing.json(), unknown.json);
    assert.equal(missing.status, unknown.res.status);
  });

  it("the database only ever receives the SHA-256 hash, never the key", async () => {
    useDb({ rows: [techRow()] });
    await call({ topic: "technology" });
    const text = JSON.stringify(calls);
    assert.ok(!text.includes(KEY));
    assert.ok(text.includes(hashApiKey(KEY)));
  });

  it("wrong content-type / oversized body are rejected before any database call", async () => {
    useDb({ rows: [techRow()] });
    assert.equal((await call({ topic: "technology" }, { "content-type": "text/plain" })).res.status, 415);
    assert.equal((await call({ topic: "technology", pad: "x".repeat(3000) })).res.status, 413);
    assert.equal(calls.length, 0);
  });
});

// ===========================================================================
describe("R11: selection is deterministic", () => {
  const mk = (n: number, over: Partial<AdCandidate> = {}): AdCandidate => ({
    ad: { id: `a0000000-0000-4000-8000-00000000000${n}`, headline: `H${n}`, body: "B", ctaText: null, destinationUrl: "https://example.com/x" },
    creativeStatus: "approved", campaignId: `10000000-0000-4000-8000-00000000000${n}`, campaignStatus: "active",
    category: "technology", startDate: "2026-10-01", endDate: null, totalBudget: 100, dailyBudget: null, spentTotal: 0, spentToday: 0,
    advertiserStatus: "active", advertiserProfileStatus: "active", campaignServesToday: 0, creativeServesToday: 0, ...over,
  });
  const deps = (c: AdCandidate[]) => ({ loadCandidates: async () => c, now: () => new Date("2026-10-24T12:00:00Z"), unitCostUsd: 0.002, spendTracking: "unavailable" as const });
  const req = { publisher: { id: PUBLISHER_ID, status: "active" }, category: "technology" };

  function permutations<T>(a: T[]): T[][] {
    if (a.length <= 1) return [a];
    return a.flatMap((x, i) => permutations([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]));
  }

  it("every input order gives the same ad", async () => {
    const all = [mk(1), mk(2), mk(3), mk(4)];
    const results = new Set<string>();
    for (const p of permutations(all)) {
      const out = await selectAd(req, deps(p));
      assert.ok(out.fill);
      if (out.fill) results.add(out.ad.id);
    }
    assert.equal(results.size, 1);
  });

  it("100 repeated runs give identical output", async () => {
    const all = [mk(3), mk(1), mk(2)];
    const first = JSON.stringify(await selectAd(req, deps(all)));
    for (let i = 0; i < 100; i++) assert.equal(JSON.stringify(await selectAd(req, deps(all))), first);
  });

  it("Math.random is never consulted", async () => {
    const real = Math.random;
    Math.random = () => {
      throw new Error("random used");
    };
    try {
      const out = await selectAd(req, deps([mk(1), mk(2)]));
      assert.ok(out.fill);
    } finally {
      Math.random = real;
    }
  });

  it("order: fewer campaign serves -> fewer creative serves -> lower ids", async () => {
    let out = await selectAd(req, deps([mk(1, { campaignServesToday: 5 }), mk(2, { campaignServesToday: 1 })]));
    assert.equal(out.fill && out.ad.headline, "H2");
    out = await selectAd(req, deps([mk(1, { creativeServesToday: 3 }), mk(2, { creativeServesToday: 0 })]));
    assert.equal(out.fill && out.ad.headline, "H2");
    out = await selectAd(req, deps([mk(2), mk(1)]));
    assert.equal(out.fill && out.ad.headline, "H1");
  });

  it("the route gives the same response for the same database state", async () => {
    useDb({ rows: [techRow(), row("a0000000-0000-4000-8000-0000000000bb", "10000000-0000-4000-8000-0000000000bb", "technology")] });
    const a = JSON.stringify((await call({ topic: "technology" })).json);
    const b = JSON.stringify((await call({ topic: "technology" })).json);
    assert.equal(a, b);
  });
});

// ===========================================================================
describe("R12: private advertiser fields and internal budget data never reach the public response", () => {
  const SECRETS = ["Secret Advertiser Ltd", "advertiser@example.com", "hush-profile-id", "total_budget", "daily_budget", "spent_total", "spent_today",
    "campaign_id", "campaign_status", CAMP_TECH, "creative_status", "advertiser", "rejection_reason", "reviewed_by"];

  it("200 ad body has exactly {fill, sponsored, ad:{id, headline, body, cta_text, destination_url}}", async () => {
    useDb({
      rows: [techRow({ advertiser_name: "Secret Advertiser Ltd", advertiser_email: "advertiser@example.com", profile_id: "hush-profile-id",
        rejection_reason: "x", reviewed_by: "hush-profile-id" })],
    });
    const { res, json } = await call({ topic: "technology" });
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(json).sort(), ["ad", "fill", "sponsored"]);
    assert.deepEqual(Object.keys(adOf(json)).sort(), ["body", "cta_text", "destination_url", "headline", "id"]);
    const text = JSON.stringify(json);
    for (const s of SECRETS) assert.ok(!text.includes(s), s);
    assert.ok(!text.includes("12.5") && !text.includes("500"));
  });

  it("response headers carry no private data and are not cacheable", async () => {
    useDb({ rows: [techRow()] });
    const { res } = await call({ topic: "technology" });
    assert.equal(res.headers.get("cache-control"), "no-store");
    const all = JSON.stringify([...res.headers.entries()]);
    for (const s of [CAMP_TECH, "advertiser", "budget", PUBLISHER_ID]) assert.ok(!all.includes(s), s);
  });

  it("the publisher's own id is not echoed back either", async () => {
    useDb({ rows: [techRow()] });
    const { json } = await call({ topic: "technology" });
    assert.ok(!JSON.stringify(json).includes(PUBLISHER_ID));
  });

  it("the destination URL is https and has no embedded credentials", async () => {
    useDb({ rows: [techRow()] });
    const { json } = await call({ topic: "technology" });
    const url = new URL(adOf(json).destination_url as string);
    assert.equal(url.protocol, "https:");
    assert.equal(url.username + url.password, "");
  });

  it("the load_ad_candidates SQL does not select advertiser name, email or profile id", () => {
    const sql = readFileSync(path.join(ROOT, "supabase/sql/day-5-6-load-candidates.sql"), "utf8").replace(/--.*$/gm, "");
    // Sirf SELECT list dekhte hain (join conditions me a.id / ap.id aana theek hai)
    const selectList = /select([\s\S]*?)from public\.ad_creatives/.exec(sql)?.[1] ?? "";
    assert.ok(selectList.length > 100);
    for (const col of ["company_name", "website_url", "display_name", "email", "ap.id", "a.id", "profile_id", "advertiser_id"]) {
      assert.ok(!selectList.includes(col), col);
    }
  });
});

// ===========================================================================
describe("R13: raw chatbot prompts are not persisted by default", () => {
  const PROMPT = "My secret chatbot prompt: how do I fix my laptop?";

  it("prompt-like fields are rejected before anything runs (400, zero database calls)", async () => {
    for (const field of ["prompt", "messages", "conversation", "text", "query", "context", "user", "user_id", "ip", "input"]) {
      useDb({ rows: [techRow()] });
      const { res, json } = await call({ topic: "technology", [field]: PROMPT });
      assert.equal(res.status, 400, field);
      assert.deepEqual(json, { error: "invalid_request", reason: "unknown_field" }, field);
      assert.equal(calls.length, 0, field);
    }
  });

  it("a whole conversation passed as the topic is rejected / no-fill, and never reaches the database", async () => {
    useDb({ rows: [techRow()] });
    const { res } = await call({ topic: PROMPT });
    assert.equal(res.status, 400);
    assert.equal(calls.length, 0);
    const underscored = PROMPT.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 50);
    const r2 = await call({ topic: underscored });
    assert.equal(r2.res.status, 200);
    assert.deepEqual(r2.json, { fill: false });
    assert.ok(!names().includes("load_ad_candidates"));
  });

  it("a normal request sends only {key hash, canonical category, creative id, UTC date} to the database", async () => {
    useDb({ rows: [techRow()] });
    await call({ topic: "tech", exclude_ad_ids: [CR_GAME] });
    const sent = JSON.stringify(calls.map((c) => c.args));
    assert.ok(!sent.includes("tech\"") || sent.includes("technology"));
    for (const c of calls) {
      for (const k of Object.keys(c.args)) assert.ok(["p_key_hash", "p_category", "p_today", "p_creative_id", "p_topic"].includes(k), k);
    }
    assert.ok(!logged.length);
  });

  it("nothing is logged for a rejected prompt request", async () => {
    useDb({ rows: [techRow()] });
    await call({ topic: "technology", prompt: PROMPT });
    assert.equal(JSON.stringify(logged).includes("secret chatbot"), false);
    assert.equal(logged.length, 0);
  });

  it("schema: no table stores prompts, messages, IPs or user agents", () => {
    const dir = path.join(ROOT, "supabase", "sql");
    const forbidden = /^\s*(prompt|prompts|message|messages|conversation|chat|chat_text|user_prompt|ip|ip_address|user_agent|raw_[a-z_]+)\s+(text|jsonb?|varchar|inet)/im;
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql") && !n.includes("test"))) {
      const sql = readFileSync(path.join(dir, f), "utf8").replace(/--.*$/gm, "");
      assert.equal(forbidden.test(sql), false, f);
    }
  });

  it("schema: ad_serve_log columns are exactly publisher, creative, campaign, topic, time", () => {
    const sql = readFileSync(path.join(ROOT, "supabase/sql/day-5-3-delivery-tables.sql"), "utf8").replace(/--.*$/gm, "");
    const block = /create table if not exists public\.ad_serve_log \(([\s\S]*?)\n\);/.exec(sql)?.[1] ?? "";
    const cols = block.split("\n").map((l) => /^\s*([a-z_]+)\s+(bigint|uuid|text|timestamptz)\b/.exec(l)?.[1]).filter(Boolean);
    assert.deepEqual(cols, ["id", "publisher_id", "creative_id", "campaign_id", "topic", "served_at"]);
  });

  it("schema: record_ad_serve writes only ids + topic (no free text parameter exists)", () => {
    const sql = readFileSync(path.join(ROOT, "supabase/sql/day-5-8-serve-functions.sql"), "utf8").replace(/--.*$/gm, "");
    const sig = /function public\.record_ad_serve\(([\s\S]*?)\)\s*returns/.exec(sql)?.[1] ?? "";
    assert.deepEqual(sig.split(",").map((p) => p.trim().split(/\s+/)[0]), ["p_key_hash", "p_creative_id", "p_topic"]);
  });

  it("source: no code path logs or stores the request body", () => {
    for (const f of ["app/api/ads/match/route.ts", "lib/ads/serve.ts", "lib/ads/serve-db.ts", "lib/ads/service.ts", "lib/ads/validation.ts"]) {
      const src = readFileSync(path.join(ROOT, f), "utf8").replace(/\/\/.*$/gm, "");
      assert.equal(/console\.(log|info|debug|warn)/.test(src), false, f);
      assert.equal(/\bcookies\(|localStorage|writeFile|appendFile/.test(src), false, f);
    }
  });
});
