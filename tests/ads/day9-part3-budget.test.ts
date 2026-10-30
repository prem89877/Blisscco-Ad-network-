import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { hashApiKey } from "@/lib/ads/api-key";
import { selectAd, type SelectionOutcome } from "@/lib/ads/selection";
import { serveAd, type AuthorizeResult, type RecordResult, type ReplayResult, type ServeDeps } from "@/lib/ads/serve";
import { parseRecordResult, parseReplayResult } from "@/lib/ads/serve-db";
import { parseIdempotencyKey } from "@/lib/ads/validation";
import type { AdCandidate } from "@/lib/ads/category-matching";
import type { MatchedAd } from "@/lib/ads/types";
import * as routeModule from "@/app/api/ads/match/route";
import * as v1RouteModule from "@/app/api/v1/ads/match/route";

// Day 9 Part 3: spend limits + retry-safe (idempotent) charging.
//
// Kya yahan test hota hai (nakli database, asli database kabhi nahi chhuta):
//   - Idempotency-Key header ki jaanch, aur header na ho toh purana behaviour (exact same rpc args)
//   - serve flow: retry => wahi ad, DOBARA record nahi; record fail => ad nahi; lookup fail => ad nahi
//   - SQL file ki STATIC jaanch (text padhkar). Ye SQL ko CHALATA nahi: asli SQL test day-9-6 file se Supabase me hota hai.

const ROOT = path.join(__dirname, "..", "..", "..");
const KEY = `blc_live_${"b".repeat(64)}`;
const HASH = hashApiKey(KEY);
const PUBLISHER_ID = "99999999-9999-4999-8999-999999999999";
const CAMPAIGN_1 = "11111111-1111-4111-8111-111111111111";
const CREATIVE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const CREATIVE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const NOW = new Date("2026-10-24T12:00:00Z");
const IDEM = "retry-key-0001";

function ad(id: string, headline = "H"): MatchedAd {
  return { id, headline, body: "B", ctaText: null, destinationUrl: "https://example.com/x" };
}

function candidate(id: string, over: Partial<AdCandidate> = {}): AdCandidate {
  return {
    ad: ad(id),
    creativeStatus: "approved",
    campaignId: CAMPAIGN_1,
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

// ---------------------------------------------------------------------------
// 1. Idempotency-Key header ki jaanch
// ---------------------------------------------------------------------------
describe("parseIdempotencyKey", () => {
  it("no header => ok, value undefined", () => {
    assert.deepEqual(parseIdempotencyKey(null), { ok: true, value: undefined });
  });

  it("accepts 8-64 chars of letters, digits, underscore, hyphen (UUID too)", () => {
    for (const v of ["abcdefgh", "a".repeat(64), "7b0e3c1a-1c2d-4e5f-8a9b-0c1d2e3f4a5b", "Retry_Key-123"]) {
      assert.deepEqual(parseIdempotencyKey(v), { ok: true, value: v });
    }
  });

  it("trims surrounding spaces", () => {
    assert.deepEqual(parseIdempotencyKey("  abcdefgh  "), { ok: true, value: "abcdefgh" });
  });

  it("rejects too short, too long, empty, spaces inside, symbols, unicode", () => {
    for (const v of ["", "abcdefg", "a".repeat(65), "abcd efgh", "abcdefgh!", "abcdefgh;drop", "kunji-ग़लत-12", "a\nbcdefgh"]) {
      assert.deepEqual(parseIdempotencyKey(v), { ok: false }, JSON.stringify(v));
    }
  });
});

// ---------------------------------------------------------------------------
// 2. serve flow (nakli deps)
// ---------------------------------------------------------------------------
type Trace = { lookup: unknown[][]; select: number; record: unknown[][] };

function makeDeps(
  opts: {
    replay?: ReplayResult;
    record?: RecordResult;
    candidates?: AdCandidate[];
    withLookup?: boolean;
  } = {},
): { deps: ServeDeps; trace: Trace } {
  const trace: Trace = { lookup: [], select: 0, record: [] };
  const auth: AuthorizeResult = { outcome: "ok", publisher: { id: PUBLISHER_ID, status: "active" }, unitCostUsd: 0.002 };
  const deps: ServeDeps = {
    authorize: async () => auth,
    select: async (request, unitCostUsd): Promise<SelectionOutcome> => {
      trace.select += 1;
      return selectAd(request, {
        loadCandidates: async () => opts.candidates ?? [candidate(CREATIVE_A)],
        now: () => NOW,
        unitCostUsd,
        spendTracking: "reliable",
      });
    },
    record: async (...args) => {
      trace.record.push(args);
      return opts.record ?? { outcome: "recorded" };
    },
  };
  if (opts.withLookup !== false) {
    deps.lookupReplay = async (...args) => {
      trace.lookup.push(args);
      return opts.replay ?? { outcome: "none" };
    };
  }
  return { deps, trace };
}

const req = (idempotencyKey?: string) => ({
  topic: "gaming",
  excludeAdIds: [] as string[],
  ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
});

describe("serveAd: retry with Idempotency-Key", () => {
  it("key already charged => same ad returned, NO selection and NO second record (no double deduction)", async () => {
    const first = ad(CREATIVE_B, "First ad");
    const { deps, trace } = makeDeps({ replay: { outcome: "found", ad: first } });
    const r = await serveAd(HASH, req(IDEM), deps);
    assert.deepEqual(r, { kind: "ad", ad: first });
    assert.deepEqual(trace.lookup, [[HASH, IDEM]]);
    assert.equal(trace.select, 0);
    assert.equal(trace.record.length, 0);
  });

  it("replayed ad is returned even when the budget is now exhausted (retry is not turned into no-fill)", async () => {
    const first = ad(CREATIVE_A, "Charged earlier");
    // is campaign ka budget khatam hai: normal selection no-fill deta
    const exhausted = [candidate(CREATIVE_A, { totalBudget: 5, spentTotal: 5 })];
    const normal = await serveAd(HASH, req(), makeDeps({ candidates: exhausted }).deps);
    assert.deepEqual(normal, { kind: "no_fill" });
    const retry = await serveAd(HASH, req(IDEM), makeDeps({ candidates: exhausted, replay: { outcome: "found", ad: first } }).deps);
    assert.deepEqual(retry, { kind: "ad", ad: first });
  });

  it("new key => normal flow, key is passed to record", async () => {
    const { deps, trace } = makeDeps({ replay: { outcome: "none" } });
    const r = await serveAd(HASH, req(IDEM), deps);
    assert.equal(r.kind, "ad");
    assert.equal(trace.select, 1);
    assert.deepEqual(trace.record, [[HASH, CREATIVE_A, "gaming", IDEM]]);
  });

  it("race: database says key was charged a moment ago for another creative => that earlier ad is returned", async () => {
    const earlier = ad(CREATIVE_B, "Earlier ad");
    const { deps } = makeDeps({ record: { outcome: "recorded", replayedAd: earlier } });
    const r = await serveAd(HASH, req(IDEM), deps);
    assert.deepEqual(r, { kind: "ad", ad: earlier });
  });

  it("no header => lookup is never called and record gets exactly 3 args (old behaviour)", async () => {
    const { deps, trace } = makeDeps();
    const r = await serveAd(HASH, req(), deps);
    assert.equal(r.kind, "ad");
    assert.equal(trace.lookup.length, 0);
    assert.deepEqual(trace.record, [[HASH, CREATIVE_A, "gaming"]]);
  });

  it("charged earlier but creative is not eligible now => no-fill (not charged again)", async () => {
    const { deps, trace } = makeDeps({ replay: { outcome: "rejected" } });
    assert.deepEqual(await serveAd(HASH, req(IDEM), deps), { kind: "no_fill" });
    assert.equal(trace.record.length, 0);
  });

  it("lookup fails => 503 (unavailable), nothing recorded: we never guess and risk a second charge", async () => {
    const { deps, trace } = makeDeps({ replay: { outcome: "error" } });
    assert.deepEqual(await serveAd(HASH, req(IDEM), deps), { kind: "unavailable" });
    assert.equal(trace.record.length, 0);
    assert.equal(trace.select, 0);
  });

  it("lookup says unauthorized => 401 path", async () => {
    const { deps } = makeDeps({ replay: { outcome: "unauthorized" } });
    assert.deepEqual(await serveAd(HASH, req(IDEM), deps), { kind: "unauthorized" });
  });

  it("lookup throws => unavailable (never throws)", async () => {
    const { deps } = makeDeps();
    deps.lookupReplay = async () => {
      throw new Error("secret");
    };
    assert.deepEqual(await serveAd(HASH, req(IDEM), deps), { kind: "unavailable" });
  });

  it("unexpected lookup outcome => unavailable (fail closed)", async () => {
    const { deps } = makeDeps();
    deps.lookupReplay = async () => ({ outcome: "maybe" }) as unknown as ReplayResult;
    assert.deepEqual(await serveAd(HASH, req(IDEM), deps), { kind: "unavailable" });
  });

  it("deps without lookupReplay still work with a key (old wiring)", async () => {
    const { deps, trace } = makeDeps({ withLookup: false });
    const r = await serveAd(HASH, req(IDEM), deps);
    assert.equal(r.kind, "ad");
    assert.deepEqual(trace.record, [[HASH, CREATIVE_A, "gaming", IDEM]]);
  });

  it("replayed ad exposes only the 5 public fields", async () => {
    const dirty = { ...ad(CREATIVE_B), campaignId: "secret", spent: 9 } as unknown as MatchedAd;
    const { deps } = makeDeps({ replay: { outcome: "found", ad: dirty } });
    const r = await serveAd(HASH, req(IDEM), deps);
    assert.deepEqual(Object.keys(r.kind === "ad" ? r.ad : {}).sort(), ["body", "ctaText", "destinationUrl", "headline", "id"]);
  });
});

describe("serveAd: failed requests are not charged / exhausted budgets", () => {
  it("record error => no ad, 503 (database transaction rolled back, nothing deducted)", async () => {
    const { deps } = makeDeps({ record: { outcome: "error" } });
    assert.deepEqual(await serveAd(HASH, req(IDEM), deps), { kind: "unavailable" });
  });

  it("record rejected (budget ran out between selection and record) => no-fill, ad is NOT returned", async () => {
    const { deps } = makeDeps({ record: { outcome: "rejected" } });
    assert.deepEqual(await serveAd(HASH, req(), deps), { kind: "no_fill" });
  });

  it("total budget exhausted => no-fill and record is never called", async () => {
    const { deps, trace } = makeDeps({ candidates: [candidate(CREATIVE_A, { totalBudget: 1, spentTotal: 0.999 })] });
    assert.deepEqual(await serveAd(HASH, req(), deps), { kind: "no_fill" });
    assert.equal(trace.record.length, 0);
  });

  it("daily budget exhausted => no-fill and record is never called", async () => {
    const { deps, trace } = makeDeps({ candidates: [candidate(CREATIVE_A, { dailyBudget: 2, spentToday: 1.999 })] });
    assert.deepEqual(await serveAd(HASH, req(), deps), { kind: "no_fill" });
    assert.equal(trace.record.length, 0);
  });

  it("exact fit is allowed: spent + unit == total", async () => {
    const { deps } = makeDeps({ candidates: [candidate(CREATIVE_A, { totalBudget: 1, spentTotal: 0.998 })] });
    assert.equal((await serveAd(HASH, req(), deps)).kind, "ad");
  });

  it("an exhausted campaign is skipped and another eligible campaign is served", async () => {
    const other = "22222222-2222-4222-8222-222222222222";
    const { deps } = makeDeps({
      candidates: [
        candidate(CREATIVE_A, { totalBudget: 1, spentTotal: 1 }),
        candidate(CREATIVE_B, { campaignId: other }),
      ],
    });
    const r = await serveAd(HASH, req(), deps);
    assert.equal(r.kind === "ad" && r.ad.id, CREATIVE_B);
  });
});

// ---------------------------------------------------------------------------
// 3. Database jawab ki parsing
// ---------------------------------------------------------------------------
describe("parseRecordResult / parseReplayResult", () => {
  it("plain ok => recorded (no replayedAd)", () => {
    assert.deepEqual(parseRecordResult({ outcome: "ok" }), { outcome: "recorded" });
  });

  it("ok + replayed + valid ad => recorded with replayedAd", () => {
    const r = parseRecordResult({
      outcome: "ok",
      replayed: true,
      ad: { id: CREATIVE_B, headline: "H", body: "B", cta_text: null, destination_url: "https://example.com" },
    });
    assert.deepEqual(r, { outcome: "recorded", replayedAd: { id: CREATIVE_B, headline: "H", body: "B", ctaText: null, destinationUrl: "https://example.com" } });
  });

  it("ok + replayed but broken ad => error (a wrong ad is never returned)", () => {
    assert.deepEqual(parseRecordResult({ outcome: "ok", replayed: true }), { outcome: "error" });
    assert.deepEqual(parseRecordResult({ outcome: "ok", replayed: true, ad: { id: "nope" } }), { outcome: "error" });
  });

  it("rejected / unauthorized => rejected; junk => error", () => {
    assert.deepEqual(parseRecordResult({ outcome: "rejected" }), { outcome: "rejected" });
    assert.deepEqual(parseRecordResult({ outcome: "unauthorized" }), { outcome: "rejected" });
    assert.deepEqual(parseRecordResult(null), { outcome: "error" });
    assert.deepEqual(parseRecordResult({ outcome: "weird" }), { outcome: "error" });
  });

  it("replay lookup: none / rejected / unauthorized / found / junk", () => {
    assert.deepEqual(parseReplayResult({ outcome: "none" }), { outcome: "none" });
    assert.deepEqual(parseReplayResult({ outcome: "rejected" }), { outcome: "rejected" });
    assert.deepEqual(parseReplayResult({ outcome: "unauthorized" }), { outcome: "unauthorized" });
    assert.deepEqual(
      parseReplayResult({ outcome: "found", ad: { id: CREATIVE_A, headline: "H", body: "B", cta_text: "Go", destination_url: "https://example.com" } }),
      { outcome: "found", ad: { id: CREATIVE_A, headline: "H", body: "B", ctaText: "Go", destinationUrl: "https://example.com" } },
    );
    assert.deepEqual(parseReplayResult({ outcome: "found" }), { outcome: "error" });
    assert.deepEqual(parseReplayResult("x"), { outcome: "error" });
  });
});

// ---------------------------------------------------------------------------
// 4. Route level (nakli supabase): header -> rpc args, API contract same
// ---------------------------------------------------------------------------
type RpcCall = { name: string; args: Record<string, unknown> };
type Reply = { data: unknown; error: { code?: string } | null };
const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
const realConsoleError = console.error;
let calls: RpcCall[] = [];

const AUTH_OK: Reply = {
  data: { outcome: "ok", publisher_id: PUBLISHER_ID, publisher_status: "active", unit_cost_usd: 0.002 },
  error: null,
};

function todayMinus(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function gameRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    creative_id: CREATIVE_A,
    headline: "Headline gaming",
    body: "Body gaming",
    cta_text: "Learn more",
    destination_url: "https://example.com/gaming",
    creative_status: "approved",
    campaign_id: CAMPAIGN_1,
    campaign_status: "active",
    category: "gaming",
    start_date: todayMinus(30),
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

function useDb(opts: { record?: Reply; find?: Reply; rows?: Record<string, unknown>[] } = {}) {
  calls = [];
  globals.__TEST_SUPABASE__ = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "authorize_publisher_key") return AUTH_OK;
      if (name === "load_ad_candidates") return { data: opts.rows ?? [gameRow()], error: null };
      if (name === "find_idempotent_serve") return opts.find ?? { data: { outcome: "none" }, error: null };
      if (name === "record_ad_serve") return opts.record ?? { data: { outcome: "ok" }, error: null };
      throw new Error(`test: unexpected rpc ${name}`);
    },
  };
}

function post(headers: Record<string, string> = {}, url = "https://blisscco.test/api/ads/match"): Request {
  return new Request(url, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", ...headers },
    body: JSON.stringify({ topic: "gaming" }),
  });
}

describe("route: Idempotency-Key header", () => {
  beforeEach(() => {
    console.error = () => {};
    useDb();
  });
  afterEach(() => {
    console.error = realConsoleError;
    delete globals.__TEST_SUPABASE__;
  });

  it("no header => old 3-arg record_ad_serve call, no replay lookup, same 200 body shape", async () => {
    const res = await routeModule.POST(post());
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["ad", "fill", "sponsored"]);
    assert.equal(calls.some((c) => c.name === "find_idempotent_serve"), false);
    const rec = calls.find((c) => c.name === "record_ad_serve");
    assert.deepEqual(rec?.args, { p_key_hash: HASH, p_creative_id: CREATIVE_A, p_topic: "gaming" });
  });

  it("valid header => replay lookup first, then record with p_idempotency_key", async () => {
    const res = await routeModule.POST(post({ "Idempotency-Key": IDEM }));
    assert.equal(res.status, 200);
    const names = calls.map((c) => c.name);
    assert.ok(names.indexOf("find_idempotent_serve") < names.indexOf("load_ad_candidates"));
    assert.deepEqual(calls.find((c) => c.name === "find_idempotent_serve")?.args, { p_key_hash: HASH, p_idempotency_key: IDEM });
    assert.deepEqual(calls.find((c) => c.name === "record_ad_serve")?.args, {
      p_key_hash: HASH,
      p_creative_id: CREATIVE_A,
      p_topic: "gaming",
      p_idempotency_key: IDEM,
    });
  });

  it("retry of a charged key => 200 with the earlier ad, record_ad_serve is NOT called", async () => {
    useDb({
      find: {
        data: { outcome: "found", ad: { id: CREATIVE_B, headline: "Earlier", body: "B", cta_text: null, destination_url: "https://example.com/e" } },
        error: null,
      },
    });
    const res = await routeModule.POST(post({ "Idempotency-Key": IDEM }));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { fill: boolean; sponsored: boolean; ad: Record<string, unknown> };
    assert.equal(body.fill, true);
    assert.equal(body.sponsored, true);
    assert.equal(body.ad.id, CREATIVE_B);
    assert.deepEqual(Object.keys(body.ad).sort(), ["body", "cta_text", "destination_url", "headline", "id"]);
    assert.equal(calls.some((c) => c.name === "record_ad_serve"), false);
  });

  it("malformed header => 400 invalid_idempotency_key, database is never called", async () => {
    for (const bad of ["short", "has space in it", "x".repeat(65)]) {
      useDb();
      const res = await routeModule.POST(post({ "Idempotency-Key": bad }));
      assert.equal(res.status, 400, bad);
      assert.deepEqual(await res.json(), { error: "invalid_request", reason: "invalid_idempotency_key" });
      assert.equal(calls.length, 0);
    }
  });

  it("record rpc failure (with key) => 503 and no ad (nothing is delivered for a failed charge)", async () => {
    useDb({ record: { data: null, error: { code: "XX000" } } });
    const res = await routeModule.POST(post({ "Idempotency-Key": IDEM }));
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { fill: false, error: "unavailable" });
  });

  it("replay lookup rpc failure => 503 and record is not attempted", async () => {
    useDb({ find: { data: null, error: { code: "42883" } } });
    const res = await routeModule.POST(post({ "Idempotency-Key": IDEM }));
    assert.equal(res.status, 503);
    assert.equal(calls.some((c) => c.name === "record_ad_serve"), false);
  });

  it("v1 endpoint behaves the same and keeps its version header", async () => {
    const res = await v1RouteModule.POST(post({ "Idempotency-Key": IDEM }, "https://blisscco.test/api/v1/ads/match"));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("X-Blisscco-Api-Version"), "1");
    assert.ok(calls.some((c) => c.name === "find_idempotent_serve"));
  });

  it("the key never appears in logs or in the response body", async () => {
    const logged: unknown[][] = [];
    console.error = (...a: unknown[]) => {
      logged.push(a);
    };
    useDb({ record: { data: null, error: { code: "XX000" } } });
    const res = await routeModule.POST(post({ "Idempotency-Key": "very-secret-retry-key" }));
    assert.equal(JSON.stringify(logged).includes("very-secret-retry-key"), false);
    assert.equal(JSON.stringify(await res.json()).includes("very-secret-retry-key"), false);
  });
});

// ---------------------------------------------------------------------------
// 5. SQL ki STATIC jaanch (text padhkar; SQL chalti NAHI)
// ---------------------------------------------------------------------------
function readSql(name: string): string {
  return readFileSync(path.join(ROOT, "supabase/sql", name), "utf8").replace(/--.*$/gm, "");
}

describe("SQL (static text checks, not executed)", () => {
  const day7 = readSql("day-7-1-budget-keys-retention.sql");
  const day95 = readSql("day-9-5-atomic-spend-idempotency.sql");

  it("record_ad_serve (3 args) locks the campaign row and checks total + daily before writing spend", () => {
    const fn = /create or replace function public\.record_ad_serve\([\s\S]*?\n\$\$;/.exec(day7)?.[0] ?? "";
    assert.match(fn, /for update of c/);
    const lock = fn.indexOf("for update of c");
    const totalCheck = fn.indexOf("v_spent_total + v_unit > v_total");
    const dailyCheck = fn.indexOf("v_spent_today + v_unit > v_daily");
    const spendWrite = fn.indexOf("insert into public.campaign_spend_daily");
    assert.ok(lock > -1 && totalCheck > lock && dailyCheck > lock, "checks must come after the lock");
    assert.ok(spendWrite > totalCheck && spendWrite > dailyCheck, "spend is written only after both checks");
    // spend + serve log + daily counter ek hi function (= ek transaction) me
    assert.match(fn, /insert into public\.ad_serve_log/);
    assert.match(fn, /insert into public\.creative_serve_daily/);
  });

  it("4-arg record_ad_serve: advisory lock, replay check, then the audited 3-arg function in the same transaction", () => {
    const fn = /create or replace function public\.record_ad_serve\(\s*p_key_hash\s+text,\s*p_creative_id\s+uuid,\s*p_topic\s+text,\s*p_idempotency_key\s+text\s*\)[\s\S]*?\n\$\$;/.exec(day95)?.[0] ?? "";
    assert.ok(fn.length > 0, "4-arg function must exist");
    const lock = fn.indexOf("pg_advisory_xact_lock");
    const replay = fn.indexOf("private.replay_serve");
    const inner = fn.indexOf("public.record_ad_serve(p_key_hash, p_creative_id, p_topic)");
    const claim = fn.indexOf("insert into public.ad_serve_requests");
    assert.ok(lock > -1 && replay > lock && inner > replay && claim > inner, "order: lock -> replay -> charge -> claim");
    assert.match(fn, /security definer/);
    assert.match(fn, /set search_path = ''/);
    // key tabhi save hoti hai jab charge 'ok' ho (rejected par key save nahi)
    assert.match(fn, /is distinct from 'ok'[\s\S]*?return v_result/);
  });

  it("new functions are service_role only (no anon/authenticated/public)", () => {
    for (const sig of ["public.record_ad_serve(text, uuid, text, text)", "public.find_idempotent_serve(text, text)"]) {
      assert.ok(day95.includes(`revoke all on function ${sig} from public, anon, authenticated;`), `revoke ${sig}`);
      assert.ok(day95.includes(`grant execute on function ${sig} to service_role;`), `grant ${sig}`);
    }
    assert.match(day95, /revoke all on function private\.replay_serve\(uuid, text\) from public, anon, authenticated, service_role;/);
    assert.equal(/grant\b[^;]*\bto\s+(anon|authenticated|public)\b/i.test(day95.replace(/revoke[^;]*;/gi, "")), false);
  });

  it("ad_serve_requests: RLS on, all grants revoked, no free-text/IP/user columns", () => {
    assert.match(day95, /alter table public\.ad_serve_requests enable row level security;/);
    assert.match(day95, /revoke all on table public\.ad_serve_requests from public, anon, authenticated, service_role;/);
    const block = /create table if not exists public\.ad_serve_requests \(([\s\S]*?)\n\);/.exec(day95)?.[1] ?? "";
    const cols = block.split("\n").map((l) => /^\s*([a-z_]+)\s+(uuid|text|timestamptz)\b/.exec(l)?.[1]).filter(Boolean);
    assert.deepEqual(cols, ["publisher_id", "idempotency_key", "creative_id", "campaign_id", "created_at"]);
  });

  it("spend wall trigger exists, locks the campaign row and checks total + daily", () => {
    const fn = /function private\.guard_campaign_spend\(\)[\s\S]*?\n\$\$;/.exec(day95)?.[0] ?? "";
    assert.match(fn, /for update/);
    assert.match(fn, /total_budget_exceeded/);
    assert.match(fn, /daily_budget_exceeded/);
    assert.match(day95, /create trigger campaign_spend_guard_limits\s+before insert or update of spent on public\.campaign_spend_daily/);
  });

  it("migration is additive: nothing is dropped except the trigger it recreates; no data is deleted/updated; RLS not disabled", () => {
    const drops = day95.match(/\bdrop\s+\w+(\s+if\s+exists)?\s+[\w.]+/gi) ?? [];
    assert.deepEqual(drops.map((d) => d.toLowerCase().replace(/\s+/g, " ")), ["drop trigger if exists campaign_spend_guard_limits"]);
    assert.equal(/\btruncate\b/i.test(day95), false);
    assert.equal(/disable row level security/i.test(day95), false);
    assert.equal(/^\s*update\s+public\./im.test(day95), false);
    // delete sirf purge function (purani retry-keys + purane logs) me; spend table ko kabhi nahi
    const deletes = day95.match(/delete from public\.\w+/gi) ?? [];
    assert.equal(deletes.some((d) => /campaign_spend_daily/.test(d)), false);
    assert.match(day95, /^begin;/m);
    assert.match(day95, /^commit;/m);
  });

  it("purge removes retry keys older than 48 hours and still never touches campaign_spend_daily", () => {
    const purge = /function private\.purge_old_ad_logs[\s\S]*?\n\$\$;/.exec(day95)?.[0] ?? "";
    assert.match(purge, /delete from public\.ad_serve_requests where created_at < now\(\) - interval '48 hours'/);
    assert.equal(/campaign_spend_daily/.test(purge), false);
  });

  it("service wiring: replay lookup is plugged in; no console.log in the changed files", () => {
    const svc = readFileSync(path.join(ROOT, "lib/ads/service.ts"), "utf8");
    assert.match(svc, /lookupReplay:\s*findIdempotentServe/);
    for (const f of ["lib/ads/serve.ts", "lib/ads/serve-db.ts", "lib/ads/service.ts", "lib/ads/match-handler.ts", "lib/ads/validation.ts"]) {
      const src = readFileSync(path.join(ROOT, f), "utf8").replace(/\/\/.*$/gm, "");
      assert.equal(/console\.(log|info|debug|warn)/.test(src), false, f);
    }
  });
});
