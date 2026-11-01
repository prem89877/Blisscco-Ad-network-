// Day 26 Part 3: a Revive fallback ad can NEVER create Blisscco billing or tracking records.
// Real route -> match-handler -> service -> fallback-routing -> fallback-provider -> revive-adapter, plus the real impression and click routes.
// Fakes only: tests/ads/fake-ad-db.ts (serve + spend model), an event model (impression/click model, same SQL rules as the Day 19 Part 4 flow),
// an isolated fake ledger (via the FakeAdDb onServeRecorded hook), and the Day 26 provider harness. No SQL, no production/test database, no network,
// no real Revive. LIMIT: this proves the TypeScript never calls a write path for a provider ad; the SQL itself is covered by the TEST-database suites.
import { HARNESS_DELIVERY_URL, HARNESS_ERROR_MARKER, HARNESS_SCENARIOS, createProviderHarness, type HarnessScenario, type ProviderHarness } from "./helpers/day26-revive-provider-harness";
import { FakeAdDb, makeKey, type ServeLogRow } from "./fake-ad-db";
import * as matchRoute from "@/app/api/v1/ads/match/route";
import * as impressionRoute from "@/app/api/v1/ads/impression/route";
import * as clickRoute from "@/app/api/v1/ads/click/route";
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SECRET = "day26-p3-0123456789-abcdefghijklmnopqrstuvwxyz-test-only";
const BASE = "https://blisscco.test";
const DESTINATION = "https://example.com/landing";
const UNIT_USD = 0.002;
const HOUR = 3_600_000;
const PUBLIC_AD_FIELDS = ["id", "headline", "body", "cta_text", "destination_url"].sort();
const ROOT = join(__dirname, "..", "..", "..");
const code = (f: string) => readFileSync(join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
const ENV_KEYS = ["AD_TRACKING_SECRET", "AD_TRACKING_SECRET_PREVIOUS", "AD_TRACKING_TTL_SECONDS", "REVIVE_FALLBACK_ENABLED", "REVIVE_DELIVERY_URL", "REVIVE_TIMEOUT_MS", "REVIVE_RESPONSE_FORMAT"] as const;
const savedEnv: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
const realConsole = { error: console.error, log: console.log, warn: console.warn, info: console.info };
let logs: unknown[][] = [];
let realFetchCalls = 0;
let ipCounter = 0;
let restoreFetch: () => void = () => undefined;

/* ----------------------------- fake impression/click event store (SQL model) ----------------------------- */
type Reply = { data: unknown; error: { code?: string; message?: string } | null };
const ok = (data: unknown): Reply => ({ data, error: null });
type Internals = {
  creatives: Map<string, { status: string; destinationUrl: string; campaignId: string; advertiserId: string }>;
  campaigns: Map<string, { advertiserId: string; status: string; startDate: string; endDate: string | null }>;
  advertisers: Map<string, { status: string; profileStatus: string }>;
};
type EventRow = { serveRef: string; publisherId: string; campaignId: string; creativeId: string; type: "impression" | "click" };
const TRACKING_RPCS = ["lookup_serve_for_event", "record_ad_impression", "lookup_serve_for_click", "record_ad_click"];

class EventModel {
  events: EventRow[] = [];
  constructor(private readonly db: FakeAdDb) {}
  private get internals(): Internals { return this.db as unknown as Internals; }
  private serve(ref: unknown): ServeLogRow | undefined { return typeof ref === "string" ? this.db.serveLog.find((s) => s.serveRef === ref) : undefined; }
  private clickTarget(creativeId: string): string | null {
    const cr = this.internals.creatives.get(creativeId);
    const camp = cr ? this.internals.campaigns.get(cr.campaignId) : undefined;
    const adv = cr ? this.internals.advertisers.get(cr.advertiserId) : undefined;
    if (!cr || !camp || !adv) return null;
    if (cr.status !== "approved" || camp.status !== "active" || adv.status !== "active" || adv.profileStatus !== "active") return null;
    return cr.destinationUrl;
  }
  count(type: EventRow["type"]): number { return this.events.filter((e) => e.type === type).length; }
  private insert(s: ServeLogRow, type: EventRow["type"]): boolean {
    if (this.events.some((e) => e.serveRef === s.serveRef && e.type === type)) return false;
    this.events.push({ serveRef: s.serveRef, publisherId: s.publisherId, campaignId: s.campaignId, creativeId: s.creativeId, type });
    return true;
  }
  async rpc(name: string, args: Record<string, unknown>): Promise<Reply> {
    const s = this.serve(args.p_serve_ref);
    switch (name) {
      case "lookup_serve_for_event":
        return ok(s ? { outcome: "found", publisher_id: s.publisherId, served_at: new Date(s.servedAtMs).toISOString() } : { outcome: "not_found" });
      case "lookup_serve_for_click": {
        if (!s) return ok({ outcome: "not_found" });
        const dest = this.clickTarget(s.creativeId);
        return ok({ outcome: "found", publisher_id: s.publisherId, creative_id: s.creativeId, served_at: new Date(s.servedAtMs).toISOString(), destination_url: dest, eligible: dest !== null });
      }
      case "record_ad_impression":
        if (!s || s.publisherId !== args.p_publisher_id || Date.now() > s.servedAtMs + 24 * HOUR) return ok({ outcome: "rejected" });
        return ok({ outcome: this.insert(s, "impression") ? "recorded" : "duplicate" });
      case "record_ad_click": {
        if (!s || s.publisherId !== args.p_publisher_id || s.creativeId !== args.p_creative_id) return ok({ outcome: "rejected" });
        const dest = this.clickTarget(s.creativeId);
        if (dest === null) return ok({ outcome: "ineligible" });
        if (!this.events.some((e) => e.serveRef === s.serveRef && e.type === "impression")) return ok({ outcome: "not_counted", destination_url: dest });
        return ok({ outcome: this.insert(s, "click") ? "recorded" : "duplicate", destination_url: dest });
      }
      default:
        throw new Error(`test: unexpected tracking rpc ${name}`);
    }
  }
}

/* ----------------------------- world: fake db + ledger + event store + write-method spy ----------------------------- */
type LedgerEntry = { serveRef: string; campaignId: string; publisherId: string; unitUsd: number };
type World = { db: FakeAdDb; ev: EventModel; ledger: LedgerEntry[]; rpc: string[]; forbiddenMethods: string[]; pub: { id: string; key: string }; campaigns: string[] };

/** Every RPC name that WRITES (or could move money/tracking) is listed here; for a Revive response none of them may run. */
const WRITE_RPC = /^(record_ad_|.*(ledger|earning|payout|revenue|share|charge|credit|debit|balance|settle|spend|insert|update|delete|upsert))/i;
/** The only RPCs a Revive-fallback request may touch: key auth + rate limit, reading candidates, reading an idempotent replay. All read-only. */
const READ_ONLY_RPC = new Set(["authorize_publisher_key", "load_ad_candidates", "find_idempotent_serve"]);

function newWorld(): World {
  const db = new FakeAdDb();
  db.nowMs = Date.now();
  const ev = new EventModel(db);
  const ledger: LedgerEntry[] = [];
  db.onServeRecorded = (e) => void ledger.push({ serveRef: e.serveRef, campaignId: e.campaignId, publisherId: e.publisherId, unitUsd: e.unitUsd });
  const publisher = db.addPublisher();
  const key = makeKey("d");
  db.addKey(publisher.id, key);
  const w: World = { db, ev, ledger, rpc: [], forbiddenMethods: [], pub: { id: publisher.id, key }, campaigns: [] };
  const client = db.client();
  const target = {
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      w.rpc.push(name);
      return TRACKING_RPCS.includes(name) ? ev.rpc(name, args) : client.rpc(name, args);
    },
  };
  // Any other client method (from, insert, update, upsert, delete, storage, ...) is a forbidden write path: recorded AND throws.
  globals.__TEST_SUPABASE__ = new Proxy(target, {
    get(t, prop) {
      if (prop in t) return (t as Record<string | symbol, unknown>)[prop];
      if (typeof prop === "symbol" || prop === "then") return undefined;
      return () => { w.forbiddenMethods.push(String(prop)); throw new Error(`test: forbidden client method ${String(prop)}`); };
    },
  });
  return w;
}
function addAd(w: World, over: { category?: string; totalBudget?: number } = {}): { campaignId: string; creativeId: string } {
  const adv = w.db.addAdvertiser().id;
  const ad = w.db.addAd(adv, { category: over.category ?? "gaming", totalBudget: over.totalBudget });
  w.campaigns.push(ad.campaignId);
  return ad;
}
const spendOf = (w: World) => w.campaigns.map((c) => w.db.spendOf(c));
const snapshot = (w: World) => JSON.stringify({ serves: w.db.serveLog, spend: spendOf(w), events: w.ev.events, ledger: w.ledger, recordCalls: w.rpc.filter((n) => /^record_ad_/.test(n)).length });

/* ----------------------------- env / harness / http helpers ----------------------------- */
function setReviveEnv(): void {
  process.env.REVIVE_FALLBACK_ENABLED = "true";
  process.env.REVIVE_DELIVERY_URL = HARNESS_DELIVERY_URL;
  process.env.REVIVE_TIMEOUT_MS = "25";
}
function useHarness(scenario: HarnessScenario): ProviderHarness {
  restoreFetch();
  const h = createProviderHarness(scenario);
  restoreFetch = h.installAsGlobalFetch();
  return h;
}
beforeEach(() => {
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  process.env.AD_TRACKING_SECRET = SECRET;
  logs = [];
  realFetchCalls = 0;
  const sink = (...a: unknown[]) => void logs.push(a);
  console.error = sink; console.log = sink; console.warn = sink; console.info = sink;
  globalThis.fetch = (async () => { realFetchCalls += 1; throw new Error("test: real fetch must never be used"); }) as typeof fetch;
  restoreFetch = () => undefined;
});
afterEach(() => {
  restoreFetch();
  Object.assign(console, realConsole);
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  delete globals.__TEST_SUPABASE__;
  const text = JSON.stringify(logs);
  for (const s of ["day26-harness", HARNESS_ERROR_MARKER, SECRET]) assert.ok(!text.includes(s), `leaked into a log: ${s}`);
  assert.equal(realFetchCalls, 0, "real fetch was called");
});

type Http = { status: number; text: string; json: Record<string, unknown>; headers: Headers };
async function toHttp(res: Response): Promise<Http> {
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = text ? (JSON.parse(text) as Record<string, unknown>) : {}; } catch { json = {}; }
  return { status: res.status, text, json, headers: res.headers };
}
const nextIp = (): string => `10.55.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;
function match(w: World, over: { topic?: string; headers?: Record<string, string> } = {}): Promise<Http> {
  return matchRoute.POST(new Request(`${BASE}/api/v1/ads/match`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${w.pub.key}`, "x-forwarded-for": nextIp(), ...over.headers },
    body: JSON.stringify({ topic: over.topic ?? "gaming" }),
  })).then(toHttp);
}
function impression(token: string): Promise<Http> {
  return impressionRoute.POST(new Request(`${BASE}/api/v1/ads/impression`, {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": nextIp() }, body: JSON.stringify({ token, event: "impression" }),
  })).then(toHttp);
}
function clickRef(ref: string): Promise<Http> {
  return clickRoute.GET(new Request(`${BASE}/api/v1/ads/click?ref=${encodeURIComponent(ref)}`, { method: "GET", headers: { "x-forwarded-for": nextIp() } })).then(toHttp);
}
const count = (w: World, name: string) => w.rpc.filter((n) => n === name).length;

/** After a Revive-fallback request: only read-only RPCs ran, no forbidden client method was used, no write RPC name appears. */
function assertNoWritePath(w: World, from: number): void {
  const names = w.rpc.slice(from);
  for (const n of names) {
    assert.ok(READ_ONLY_RPC.has(n), `unexpected RPC during a Revive request: ${n}`);
    assert.ok(!WRITE_RPC.test(n), `write-looking RPC during a Revive request: ${n}`);
  }
  assert.deepEqual(w.forbiddenMethods, []);
}
function assertProviderAd(res: Http): void {
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.json).sort(), ["ad", "fill", "sponsored"]);
  assert.equal(res.json.sponsored, true);
  assert.deepEqual(Object.keys(res.json.ad as object).sort(), PUBLIC_AD_FIELDS);
  assert.match(String((res.json.ad as { id: string }).id), /^revive_[0-9a-f]{8}$/);
  assert.ok(!("tracking" in res.json));
}

describe("day 26 part 3 | a Revive fallback ad creates no Blisscco billing or tracking record", () => {
  it("Blisscco no-fill + provider fill: no charge, serve record, ledger entry, publisher earning, impression or click; only read-only RPCs ran", async () => {
    const w = newWorld(); // no Blisscco ad for 'gaming' at all
    setReviveEnv();
    const h = useHarness("valid-fill");
    const before = snapshot(w);
    const res = await match(w);
    assertProviderAd(res);
    assert.equal(h.calls.length, 1);
    assertNoWritePath(w, 0);
    assert.deepEqual(w.rpc.filter((n) => n === "authorize_publisher_key"), ["authorize_publisher_key"]);
    assert.equal(count(w, "record_ad_serve"), 0);
    assert.equal(snapshot(w), before);
    assert.deepEqual(w.db.serveLog, []);
    assert.deepEqual(w.ledger, []);
    assert.equal(w.ev.events.length, 0);
  });

  it("variants (tracking opt-in header, Idempotency-Key, both): same result, no tracking object, still zero writes", async () => {
    const w = newWorld();
    setReviveEnv();
    const h = useHarness("valid-fill");
    const before = snapshot(w);
    const variants: Array<Record<string, string>> = [
      { "x-blisscco-tracking": "1" },
      { "idempotency-key": "day26-part3-key-01" },
      { "x-blisscco-tracking": "1", "idempotency-key": "day26-part3-key-02" },
    ];
    for (const headers of variants) {
      const mark = w.rpc.length;
      assertProviderAd(await match(w, { headers }));
      assertNoWritePath(w, mark);
    }
    assert.equal(h.calls.length, 3);
    assert.equal(snapshot(w), before);
  });

  it("a Revive fill after a Blisscco campaign is exhausted: spend stays exactly at budget, no new serve, ledger entry or event", async () => {
    const w = newWorld();
    const ad = addAd(w, { totalBudget: UNIT_USD });
    setReviveEnv();
    const h = useHarness("valid-fill");
    const first = await match(w);
    assert.equal(first.json.fill, true);
    assert.ok(!String((first.json.ad as { id: string }).id).startsWith("revive_"));
    assert.equal(w.db.spendOf(ad.campaignId), UNIT_USD);
    assert.equal(h.calls.length, 0);

    const before = snapshot(w);
    const mark = w.rpc.length;
    const second = await match(w);
    assertProviderAd(second);
    assertNoWritePath(w, mark);
    assert.equal(h.calls.length, 1);
    assert.equal(w.db.spendOf(ad.campaignId), UNIT_USD);
    assert.equal(snapshot(w), before);
    assert.equal(w.db.serveLog.length, 1);
    assert.equal(w.ledger.length, 1);
  });

  for (const scenario of HARNESS_SCENARIOS.filter((s) => s !== "valid-fill")) {
    it(`provider '${scenario}' => {fill:false}; no Blisscco campaign balance, serve, ledger or event changes`, async () => {
      const w = newWorld();
      addAd(w, { category: "food" });                          // live campaign, other category
      const exhausted = addAd(w, { totalBudget: UNIT_USD });  // gaming, will be exhausted by one serve
      setReviveEnv();
      useHarness("valid-fill");
      assert.equal((await match(w)).json.fill, true);
      assert.equal(w.db.spendOf(exhausted.campaignId), UNIT_USD);

      const h = useHarness(scenario);
      const before = snapshot(w);
      const mark = w.rpc.length;
      const res = await match(w);
      assert.equal(res.text, '{"fill":false}');
      assert.equal(h.calls.length, 1);
      assertNoWritePath(w, mark);
      assert.equal(snapshot(w), before);
      assert.deepEqual(spendOf(w), [0, UNIT_USD]);
    });
  }

  it("provider network failure (URL the harness refuses) => {fill:false}, balances and records untouched", async () => {
    const w = newWorld();
    addAd(w, { category: "food" });
    process.env.REVIVE_FALLBACK_ENABLED = "true";
    process.env.REVIVE_DELIVERY_URL = "https://real-provider.example.net/serve?key=SECRETKEY99";
    process.env.REVIVE_TIMEOUT_MS = "25";
    const h = useHarness("valid-fill");
    const before = snapshot(w);
    const res = await match(w);
    assert.equal(res.text, '{"fill":false}');
    assert.equal(h.unexpectedCalls, 1);
    assertNoWritePath(w, 0);
    assert.equal(snapshot(w), before);
  });

  it("fallback flag OFF: no provider call and no writes either", async () => {
    const w = newWorld();
    addAd(w, { category: "food" });
    const h = useHarness("valid-fill");
    const before = snapshot(w);
    assert.equal((await match(w)).text, '{"fill":false}');
    assert.equal(h.calls.length, 0);
    assertNoWritePath(w, 0);
    assert.equal(snapshot(w), before);
  });

  it("a publisher cannot create impression or click events for a Revive ad: fabricated tokens/refs/ids are rejected and no record RPC runs", async () => {
    const w = newWorld();
    setReviveEnv();
    useHarness("valid-fill");
    const res = await match(w, { headers: { "x-blisscco-tracking": "1" } });
    assertProviderAd(res);
    const reviveId = String((res.json.ad as { id: string }).id);
    const fakeToken = `bt1.${"A".repeat(40)}.${"B".repeat(40)}`;
    const fakeRef = `bc1.${"A".repeat(40)}.${"B".repeat(40)}`;
    const mark = w.rpc.length;
    for (const t of [reviveId, fakeToken, "not-a-token"]) {
      const r = await impression(t);
      assert.equal(r.status, 401, t);
      assert.equal(r.text, JSON.stringify({ error: "unauthorized" }));
    }
    for (const ref of [reviveId, fakeRef, "not-a-ref"]) {
      const r = await clickRef(ref);
      assert.ok(r.status === 404 || r.status === 401 || r.status === 400, `${ref}: ${r.status}`);
      assert.notEqual(r.status, 302);
      assert.ok(!r.headers.get("location"));
    }
    assert.equal(w.rpc.slice(mark).filter((n) => /^record_ad_/.test(n)).length, 0);
    assert.equal(w.ev.events.length, 0);
    assert.deepEqual(w.forbiddenMethods, []);
  });
});

describe("day 26 part 3 | normal Blisscco ads keep their existing billing and tracking behaviour", () => {
  it("serve (charged once, ledger entry, tracking issued) -> impression -> click, with the Revive flag ON and the provider never called", async () => {
    const w = newWorld();
    const ad = addAd(w);
    setReviveEnv();
    const h = useHarness("valid-fill");

    const served = await match(w, { headers: { "x-blisscco-tracking": "1" } });
    assert.equal(served.status, 200);
    assert.deepEqual(Object.keys(served.json).sort(), ["ad", "fill", "sponsored", "tracking"]);
    assert.deepEqual(Object.keys(served.json.ad as object).sort(), PUBLIC_AD_FIELDS);
    assert.ok(!String((served.json.ad as { id: string }).id).startsWith("revive_"));
    const tracking = served.json.tracking as { token: string; click_ref: string };
    assert.match(tracking.token, /^bt1\./);
    assert.match(tracking.click_ref, /^bc1\./);
    assert.equal(h.calls.length, 0);
    assert.equal(count(w, "record_ad_serve"), 1);
    assert.equal(w.db.serveLog.length, 1);
    assert.equal(w.db.spendOf(ad.campaignId), UNIT_USD);
    assert.equal(w.ledger.length, 1);
    assert.deepEqual(w.ledger[0], { serveRef: w.db.serveLog[0].serveRef, campaignId: ad.campaignId, publisherId: w.pub.id, unitUsd: UNIT_USD });
    assert.equal(w.ev.events.length, 0, "serving alone is not an impression");

    const imp = await impression(tracking.token);
    assert.deepEqual(imp.json, { ok: true, status: "recorded" });
    const dup = await impression(tracking.token);
    assert.equal(dup.json.status, "duplicate");
    assert.equal(w.ev.count("impression"), 1);
    assert.equal(count(w, "record_ad_impression"), 2);

    const clk = await clickRef(tracking.click_ref);
    assert.equal(clk.status, 302);
    assert.equal(clk.headers.get("location"), DESTINATION);
    assert.equal(w.ev.count("click"), 1);

    // Impressions/clicks never move money: spend and ledger are exactly as after the serve.
    assert.equal(w.db.spendOf(ad.campaignId), UNIT_USD);
    assert.equal(w.ledger.length, 1);
    assert.equal(w.db.serveLog.length, 1);
  });

  it("a Revive fallback request in between changes none of the Blisscco counters", async () => {
    const w = newWorld();
    const ad = addAd(w);
    setReviveEnv();
    const h = useHarness("valid-fill");
    const served = await match(w, { headers: { "x-blisscco-tracking": "1" } });
    const tracking = served.json.tracking as { token: string; click_ref: string };
    assert.equal((await impression(tracking.token)).json.status, "recorded");
    assert.equal((await clickRef(tracking.click_ref)).status, 302);
    const before = snapshot(w);

    const mark = w.rpc.length;
    const revive = await match(w, { topic: "food" }); // no Blisscco ad for 'food' => Revive
    assertProviderAd(revive);
    assertNoWritePath(w, mark);
    assert.equal(h.calls.length, 1);
    assert.equal(snapshot(w), before);
    assert.equal(w.db.spendOf(ad.campaignId), UNIT_USD);
    assert.equal(w.ledger.length, 1);
    assert.equal(w.ev.count("impression"), 1);
    assert.equal(w.ev.count("click"), 1);

    // The earlier Blisscco token/ref still behave exactly as before (duplicates, no extra events or charges).
    assert.equal((await impression(tracking.token)).json.status, "duplicate");
    assert.equal((await clickRef(tracking.click_ref)).status, 302);
    assert.equal(w.ev.count("impression"), 1);
    assert.equal(w.ev.count("click"), 1);
    assert.equal(w.db.spendOf(ad.campaignId), UNIT_USD);
  });

  it("a keyed Blisscco serve and its retry: charged once, replay served by Blisscco, provider not called", async () => {
    const w = newWorld();
    const ad = addAd(w);
    setReviveEnv();
    const h = useHarness("valid-fill");
    const headers = { "idempotency-key": "day26-part3-replay" };
    const a = await match(w, { headers });
    const b = await match(w, { headers });
    assert.equal((a.json.ad as { id: string }).id, (b.json.ad as { id: string }).id);
    assert.equal(w.db.spendOf(ad.campaignId), UNIT_USD);
    assert.equal(w.ledger.length, 1);
    assert.equal(h.calls.length, 0);
  });
});

describe("day 26 part 3 | static isolation of the provider path", () => {
  const PROVIDER_FILES = ["lib/ads/fallback-provider.ts", "lib/ads/fallback-routing.ts", "lib/ads/revive-adapter.ts", "lib/ads/revive-json-endpoint-contract.ts"];

  it("provider-side modules do not import billing, serve/impression/click DB, tracking, ledger, payout or Supabase code", () => {
    const forbidden = /serve-db|click-db|impression-db|tracking-token|click-ref|supabase|ledger|payout|earning|revenue|budget|money|\/service|analytics/i;
    for (const f of PROVIDER_FILES) {
      const specs = [...code(f).matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      for (const s of specs) assert.ok(!forbidden.test(s), `${f} imports ${s}`);
    }
  });

  it("provider-side modules contain no write-path names (record_ad_*, ledger, earning, payout, revenue, rpc calls, tracking mint)", () => {
    for (const f of PROVIDER_FILES) {
      const src = code(f);
      assert.ok(!/record_ad_|\bledger|earning|payout|revenue|\.rpc\(|mintTrackingToken|mintClickRef|createAdminClient/i.test(src), `${f} references a write path`);
    }
  });

  it("match-handler returns the provider response as is: no tracking, serve or charge is attached to a provider_ad", () => {
    const src = code("lib/ads/match-handler.ts");
    const branch = /case "provider_ad":\s*return json\(result\.response, 200\);/;
    assert.ok(branch.test(src), "provider_ad branch changed");
    const service = code("lib/ads/service.ts");
    assert.ok(/if \(routed\.source === "blisscco"\) return routed\.result;\s*const response = publicAdFromFallbackFill\(routed\.fill\);\s*return response \? \{ kind: "provider_ad", response \} : \{ kind: "no_fill" \};/.test(service), "serveMatchForPublisher provider branch changed");
  });

  it("the harness and this test import no production money/tracking writer", () => {
    const importLines = (f: string) => (readFileSync(join(ROOT, f), "utf8").match(/^import .*$/gm) ?? []).join("\n");
    for (const f of ["tests/ads/day26-part3-billing-tracking-isolation.test.ts", "tests/ads/helpers/day26-revive-provider-harness.ts"]) {
      assert.ok(!/@\/lib\/(ledger|payouts)|serve-db|click-db|impression-db/.test(importLines(f)), `${f} imports a money/tracking writer`);
    }
  });
});
