import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as matchRoute from "@/app/api/v1/ads/match/route";
import * as impressionRoute from "@/app/api/v1/ads/impression/route";
import * as clickRoute from "@/app/api/v1/ads/click/route";
import { mintClickRef } from "@/lib/ads/click-ref";
import { mintTrackingToken, readTrackingConfig } from "@/lib/ads/tracking-token";
import { fetchCampaignAnalytics, fetchPublisherAnalytics, type AnalyticsRpcClient } from "@/lib/ads/analytics";
import { loadCampaignPerformance } from "@/lib/ads/campaign-performance";
import { loadPublisherOverview } from "@/lib/ads/publisher-overview";
import { loadAdvertiserOverview } from "@/lib/ads/analytics-overview";
import { FakeAdDb, makeKey, type ServeLogRow } from "../ads/fake-ad-db";

// Day 19 Part 4: poora ad delivery + tracking + analytics workflow.
//   serve (POST /api/v1/ads/match, tracking opt-in) -> impression (POST /api/v1/ads/impression) -> click (GET /api/v1/ads/click)
//   -> publisher analytics + advertiser campaign performance.
// SIRF nakli (in-memory) database: koi SQL nahi chalti, koi production / test Supabase nahi chhuta. Asli route / handler / token / click-ref /
// analytics TypeScript chalta hai; sirf database ke SQL functions (day-12-7, day-12-10, day-12-12) ka MODEL is file me hai.
// LIMIT: ye SQL ka MODEL hai, SQL khud nahi. Asli unique constraint / auth.uid() ownership ka saboot tests/integration/*.test.ts (TEST database) me hai.
// Paise (ledger, earnings, revenue share, payout) yahan activate NAHI hote: impression / click spend ko nahi chhute (neeche ke tests isse bandhte hain).

const SECRET = "k7f2-0123456789-abcdefghijklmnopqrstuvwxyz-primary";
const OTHER_SECRET = "zz99-0123456789-abcdefghijklmnopqrstuvwxyz-other";
const BASE = "https://blisscco.test";
const HOUR = 3_600_000;
const DEFAULT_DESTINATION = "https://example.com/landing";
const UNAUTHORIZED = JSON.stringify({ error: "unauthorized" });
const NOT_FOUND = JSON.stringify({ error: "not_found" });

const ROOT = join(__dirname, "..", "..", "..");
const sourceOf = (f: string) => readFileSync(join(ROOT, f), "utf8");

const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
const realConsoleError = console.error;
const realNow = Date.now;
const ENV_NAMES = ["AD_TRACKING_SECRET", "AD_TRACKING_SECRET_PREVIOUS", "AD_TRACKING_TTL_SECONDS"] as const;
const savedEnv: Record<string, string | undefined> = {};
let logged: string[] = [];
let clockOffsetMs = 0;
let ipCounter = 0;
const issued = new Set<string>();

const config = readTrackingConfig({ AD_TRACKING_SECRET: SECRET });
const otherConfig = readTrackingConfig({ AD_TRACKING_SECRET: OTHER_SECRET });
if (!config || !otherConfig) throw new Error("test: tracking config must be valid");

type Reply = { data: unknown; error: { code?: string; message?: string } | null };
const ok = (data: unknown): Reply => ({ data, error: null });
const nextIp = (): string => `10.44.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;

/* ===========================================================================================
 * Nakla event store: ad_events + lookup_serve_for_event / record_ad_impression / lookup_serve_for_click / record_ad_click
 * (day-12-7, day-12-10 SQL ka model). Unique (serve, event_type); click ke liye pehle impression; destination creative row se.
 * ========================================================================================= */
type Internals = {
  creatives: Map<string, { status: string; destinationUrl: string; campaignId: string; advertiserId: string }>;
  campaigns: Map<string, { advertiserId: string; status: string; startDate: string; endDate: string | null }>;
  advertisers: Map<string, { status: string; profileStatus: string }>;
};
type EventRow = { id: number; serveRef: string; publisherId: string; campaignId: string; creativeId: string; type: "impression" | "click"; atMs: number };
const TRACKING_RPCS = ["lookup_serve_for_event", "record_ad_impression", "lookup_serve_for_click", "record_ad_click"];

class EventModel {
  events: EventRow[] = [];
  rpcNames: string[] = [];
  fail: Record<string, Reply | undefined> = {};
  constructor(private readonly db: FakeAdDb) {}
  private get internals(): Internals {
    return this.db as unknown as Internals;
  }
  private serve(ref: unknown): ServeLogRow | undefined {
    return typeof ref === "string" ? this.db.serveLog.find((s) => s.serveRef === ref) : undefined;
  }
  /** private.click_target: creative approved + campaign active + dates + advertiser active. Nahi toh null. */
  clickTarget(creativeId: string): string | null {
    const cr = this.internals.creatives.get(creativeId);
    const camp = cr ? this.internals.campaigns.get(cr.campaignId) : undefined;
    const adv = cr ? this.internals.advertisers.get(cr.advertiserId) : undefined;
    if (!cr || !camp || !adv) return null;
    const today = new Date(Date.now()).toISOString().slice(0, 10);
    if (cr.status !== "approved" || camp.status !== "active") return null;
    if (camp.startDate > today || (camp.endDate !== null && camp.endDate < today)) return null;
    if (adv.status !== "active" || adv.profileStatus !== "active") return null;
    return cr.destinationUrl;
  }
  count(type: EventRow["type"], where: Partial<Pick<EventRow, "serveRef" | "publisherId" | "campaignId">> = {}): number {
    return this.events.filter((e) => e.type === type && Object.entries(where).every(([k, v]) => e[k as keyof EventRow] === v)).length;
  }
  private insert(s: ServeLogRow, type: EventRow["type"]): boolean {
    if (this.events.some((e) => e.serveRef === s.serveRef && e.type === type)) return false; // ad_events_one_per_type_key
    this.events.push({ id: this.events.length + 1, serveRef: s.serveRef, publisherId: s.publisherId, campaignId: s.campaignId, creativeId: s.creativeId, type, atMs: Date.now() });
    return true;
  }
  async rpc(name: string, args: Record<string, unknown>): Promise<Reply> {
    this.rpcNames.push(name);
    const forced = this.fail[name];
    if (forced) return forced;
    const s = this.serve(args.p_serve_ref);
    switch (name) {
      case "lookup_serve_for_event":
        return ok(s ? { outcome: "found", publisher_id: s.publisherId, served_at: new Date(s.servedAtMs).toISOString() } : { outcome: "not_found" });
      case "lookup_serve_for_click": {
        if (!s) return ok({ outcome: "not_found" });
        const dest = this.clickTarget(s.creativeId);
        return ok({ outcome: "found", publisher_id: s.publisherId, creative_id: s.creativeId, served_at: new Date(s.servedAtMs).toISOString(), destination_url: dest, eligible: dest !== null });
      }
      case "record_ad_impression": {
        if (!s || s.publisherId !== args.p_publisher_id || Date.now() > s.servedAtMs + 24 * HOUR) return ok({ outcome: "rejected" });
        return ok({ outcome: this.insert(s, "impression") ? "recorded" : "duplicate" });
      }
      case "record_ad_click": {
        if (!s || s.publisherId !== args.p_publisher_id || s.creativeId !== args.p_creative_id || Date.now() > s.servedAtMs + 24 * HOUR) return ok({ outcome: "rejected" });
        const dest = this.clickTarget(s.creativeId);
        if (dest === null) return ok({ outcome: "ineligible" });
        if (!this.events.some((e) => e.serveRef === s.serveRef && e.type === "impression")) return ok({ outcome: "not_counted", destination_url: dest });
        return ok({ outcome: this.insert(s, "click") ? "recorded" : "duplicate", destination_url: dest });
      }
      default:
        throw new Error(`test: unexpected tracking rpc ${name}`);
    }
  }

  /** Login-session client (auth.uid() wala): get_my_publisher_analytics / get_my_campaign_analytics ka model (day-12-12). */
  session(who: { publisherId?: string; advertiserId?: string; publisherProfileActive?: boolean }): AnalyticsRpcClient & { calls: string[] } {
    const calls: string[] = [];
    const ctr = (i: number, c: number) => (i === 0 ? 0 : Math.round((c * 100 * 10_000) / i) / 10_000);
    return {
      calls,
      rpc: async (fn: string, args: Record<string, unknown> = {}) => {
        calls.push(fn);
        if (fn === "get_my_publisher_analytics") {
          if (!who.publisherId || who.publisherProfileActive === false) return ok([]);
          const impressions = this.count("impression", { publisherId: who.publisherId });
          const clicks = this.count("click", { publisherId: who.publisherId });
          return ok([{ impressions, clicks, ctr: ctr(impressions, clicks) }]);
        }
        if (fn === "get_my_campaign_analytics") {
          if (!who.advertiserId) return ok([]);
          const rows = [...this.internals.campaigns.entries()]
            .filter(([id, c]) => c.advertiserId === who.advertiserId && (args.p_campaign_id == null || args.p_campaign_id === id))
            .map(([id]) => {
              const impressions = this.count("impression", { campaignId: id });
              const clicks = this.count("click", { campaignId: id });
              return { campaign_id: id, impressions, clicks, ctr: ctr(impressions, clicks) };
            });
          return ok(rows);
        }
        throw new Error(`test: unexpected analytics rpc ${fn}`);
      },
    };
  }
}

/* ===========================================================================================
 * World + HTTP helpers
 * ========================================================================================= */
type Ad = { campaignId: string; creativeId: string };
type World = {
  db: FakeAdDb;
  ev: EventModel;
  internals: Internals;
  pubA: { id: string; key: string };
  pubB: { id: string; key: string };
  advX: string;
  advY: string;
  adX: Ad; // gaming, advertiser X
  adX2: Ad; // food, advertiser X (kabhi serve nahi hota)
  adY: Ad; // travel, advertiser Y
};

function world(): World {
  const db = new FakeAdDb();
  db.nowMs = Date.now();
  const ev = new EventModel(db);
  const a = db.addPublisher();
  const b = db.addPublisher();
  const keyA = makeKey("a");
  const keyB = makeKey("b");
  db.addKey(a.id, keyA);
  db.addKey(b.id, keyB);
  const advX = db.addAdvertiser().id;
  const advY = db.addAdvertiser().id;
  const adX = db.addAd(advX, { category: "gaming" });
  const adX2 = db.addAd(advX, { category: "food" });
  const adY = db.addAd(advY, { category: "travel" });
  const client = db.client();
  globals.__TEST_SUPABASE__ = { rpc: async (name: string, args: Record<string, unknown> = {}) => (TRACKING_RPCS.includes(name) ? ev.rpc(name, args) : client.rpc(name, args)) };
  return { db, ev, internals: db as unknown as Internals, pubA: { id: a.id, key: keyA }, pubB: { id: b.id, key: keyB }, advX, advY, adX, adX2, adY };
}

beforeEach(() => {
  for (const n of ENV_NAMES) savedEnv[n] = process.env[n];
  process.env.AD_TRACKING_SECRET = SECRET;
  delete process.env.AD_TRACKING_SECRET_PREVIOUS;
  delete process.env.AD_TRACKING_TTL_SECONDS;
  logged = [];
  clockOffsetMs = 0;
  Date.now = () => realNow() + clockOffsetMs;
  console.error = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  };
});
afterEach(() => {
  // Koi bhi token / click ref / IP / secret kisi log me nahi jaana chahiye.
  const text = logged.join("\n");
  for (const c of issued) assert.ok(!text.includes(c) && !text.includes(c.split(".")[1] ?? c), "a tracking credential leaked to a log");
  assert.ok(!text.includes(SECRET) && !text.includes(OTHER_SECRET), "a secret leaked to a log");
  assert.ok(!/10\.44\./.test(text), "a client IP leaked to a log");
  issued.clear();
  for (const n of ENV_NAMES) {
    if (savedEnv[n] === undefined) delete process.env[n];
    else process.env[n] = savedEnv[n];
  }
  Date.now = realNow;
  console.error = realConsoleError;
  delete globals.__TEST_SUPABASE__;
});

type Http = { status: number; text: string; json: Record<string, unknown>; headers: Headers };
async function toHttp(res: Response): Promise<Http> {
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = {};
  }
  return { status: res.status, text, json, headers: res.headers };
}
async function impression(token: unknown, over: { body?: string; contentType?: string } = {}): Promise<Http> {
  const body = over.body ?? JSON.stringify({ token, event: "impression" });
  return toHttp(
    await impressionRoute.POST(
      new Request(`${BASE}/api/v1/ads/impression`, { method: "POST", headers: { "content-type": over.contentType ?? "application/json", "x-forwarded-for": nextIp() }, body }),
    ),
  );
}
async function click(query: string, headers: Record<string, string> = {}): Promise<Http> {
  return toHttp(await clickRoute.GET(new Request(`${BASE}/api/v1/ads/click?${query}`, { method: "GET", headers: { "x-forwarded-for": nextIp(), ...headers } })));
}
const clickRef = (ref: string): Promise<Http> => click(`ref=${encodeURIComponent(ref)}`);

type Served = { token: string; ref: string; row: ServeLogRow; http: Http };
async function serve(w: World, who: "A" | "B" = "A", topic = "gaming", headers: Record<string, string> = {}): Promise<Served> {
  const pub = who === "A" ? w.pubA : w.pubB;
  const res = await toHttp(
    await matchRoute.POST(
      new Request(`${BASE}/api/v1/ads/match`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${pub.key}`, "x-blisscco-tracking": "1", "x-forwarded-for": nextIp(), ...headers },
        body: JSON.stringify({ topic }),
      }),
    ),
  );
  assert.equal(res.status, 200, res.text);
  const tracking = res.json.tracking as { token?: string; click_ref?: string } | undefined;
  const token = tracking?.token;
  const ref = tracking?.click_ref;
  if (!token || !ref) throw new Error("test: tracking token and click_ref expected");
  issued.add(token);
  issued.add(ref);
  const row = w.db.serveLog[w.db.serveLog.length - 1];
  if (!row) throw new Error("test: serve row expected");
  return { token, ref, row, http: res };
}
/** Is serve ka impression + click (dono sahi tareeke se). */
async function fullEngagement(s: Served): Promise<void> {
  assert.equal((await impression(s.token)).json.status, "recorded");
  assert.equal((await clickRef(s.ref)).status, 302);
}

const decode = (part: string): Record<string, unknown> => JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;

/* ===========================================================================================
 * 1. Successful flow
 * ========================================================================================= */
describe("day 19 part 4: serve -> impression -> click -> analytics", () => {
  it("a served ad is NOT an impression: serving alone leaves analytics at zero", async () => {
    const w = world();
    await serve(w);
    await serve(w);
    await serve(w, "B");
    assert.equal(w.db.serveLog.length, 3);
    assert.equal(w.ev.events.length, 0);
    const pub = await loadPublisherOverview("publisher", async () => w.ev.session({ publisherId: w.pubA.id }));
    assert.deepEqual(pub, { status: "ok", impressions: 0, clicks: 0, ctr: 0, hasEvents: false });
    const camp = await loadCampaignPerformance(async () => w.ev.session({ advertiserId: w.advX }), w.adX.campaignId);
    assert.deepEqual(camp, { status: "ok", impressions: 0, clicks: 0, ctr: 0, hasEvents: false });
  });

  it("successful serve, then ONE impression, then ONE click: events, redirect and analytics all agree", async () => {
    const w = world();
    const s = await serve(w);
    assert.match(s.token, /^bt1\./);
    assert.match(s.ref, /^bc1\./);
    assert.equal((s.http.json.ad as { destination_url: string }).destination_url, DEFAULT_DESTINATION);

    const imp = await impression(s.token);
    assert.equal(imp.status, 200);
    assert.deepEqual(imp.json, { ok: true, status: "recorded" });
    assert.equal(imp.headers.get("cache-control"), "no-store");

    const clk = await clickRef(s.ref);
    assert.equal(clk.status, 302);
    assert.equal(clk.headers.get("location"), DEFAULT_DESTINATION);
    assert.equal(clk.headers.get("referrer-policy"), "no-referrer");
    assert.equal(clk.headers.get("cache-control"), "no-store");

    assert.deepEqual(
      w.ev.events.map((e) => [e.type, e.serveRef, e.publisherId, e.campaignId, e.creativeId]),
      [
        ["impression", s.row.serveRef, w.pubA.id, w.adX.campaignId, w.adX.creativeId],
        ["click", s.row.serveRef, w.pubA.id, w.adX.campaignId, w.adX.creativeId],
      ],
    );

    const pubA = await fetchPublisherAnalytics(w.ev.session({ publisherId: w.pubA.id }));
    assert.deepEqual(pubA, { status: "ok", data: { impressions: 1, clicks: 1, ctr: 100 } });
    const camp = await loadCampaignPerformance(async () => w.ev.session({ advertiserId: w.advX }), w.adX.campaignId);
    assert.deepEqual(camp, { status: "ok", impressions: 1, clicks: 1, ctr: 100, hasEvents: true });
    const overview = await loadAdvertiserOverview("advertiser", async () => w.ev.session({ advertiserId: w.advX }));
    assert.deepEqual(overview, { status: "ok", totals: { campaigns: 2, campaignsWithEvents: 1, impressions: 1, clicks: 1, ctr: 100 } });
  });

  it("a click before any impression redirects but is NOT counted; after the impression the click counts once", async () => {
    const w = world();
    const s = await serve(w);
    const early = await clickRef(s.ref);
    assert.equal(early.status, 302);
    assert.equal(early.headers.get("location"), DEFAULT_DESTINATION);
    assert.equal(w.ev.count("click"), 0);
    assert.deepEqual(await fetchPublisherAnalytics(w.ev.session({ publisherId: w.pubA.id })), { status: "ok", data: { impressions: 0, clicks: 0, ctr: 0 } });

    assert.equal((await impression(s.token)).json.status, "recorded");
    assert.equal((await clickRef(s.ref)).status, 302);
    assert.equal(w.ev.count("click"), 1);
    assert.deepEqual(await fetchPublisherAnalytics(w.ev.session({ publisherId: w.pubA.id })), { status: "ok", data: { impressions: 1, clicks: 1, ctr: 100 } });
  });

  it("a prefetch / prerender click request does nothing (no click, no redirect)", async () => {
    const w = world();
    const s = await serve(w);
    await impression(s.token);
    const r = await click(`ref=${encodeURIComponent(s.ref)}`, { "sec-purpose": "prefetch" });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get("location"), null);
    assert.equal(w.ev.count("click"), 0);
  });
});

/* ===========================================================================================
 * 2. Duplicates
 * ========================================================================================= */
describe("day 19 part 4: duplicate impressions and clicks never create duplicate events", () => {
  it("repeated impression POSTs: first recorded, the rest duplicate, ONE event", async () => {
    const w = world();
    const s = await serve(w);
    const statuses: unknown[] = [];
    for (let i = 0; i < 4; i += 1) {
      const r = await impression(s.token);
      assert.equal(r.status, 200);
      statuses.push(r.json.status);
    }
    assert.deepEqual(statuses, ["recorded", "duplicate", "duplicate", "duplicate"]);
    assert.equal(w.ev.count("impression"), 1);
    assert.deepEqual(await fetchPublisherAnalytics(w.ev.session({ publisherId: w.pubA.id })), { status: "ok", data: { impressions: 1, clicks: 0, ctr: 0 } });
  });

  it("parallel impression POSTs for one serve: exactly one recorded", async () => {
    const w = world();
    const s = await serve(w);
    const results = await Promise.all(Array.from({ length: 8 }, () => impression(s.token)));
    const recorded = results.filter((r) => r.json.status === "recorded").length;
    const duplicate = results.filter((r) => r.json.status === "duplicate").length;
    assert.equal(recorded, 1);
    assert.equal(duplicate, 7);
    assert.equal(w.ev.count("impression"), 1);
  });

  it("repeated clicks: every click still redirects, but only ONE click event; CTR never exceeds 100", async () => {
    const w = world();
    const s = await serve(w);
    await impression(s.token);
    for (let i = 0; i < 4; i += 1) {
      const r = await clickRef(s.ref);
      assert.equal(r.status, 302);
      assert.equal(r.headers.get("location"), DEFAULT_DESTINATION);
    }
    const parallel = await Promise.all(Array.from({ length: 5 }, () => clickRef(s.ref)));
    assert.ok(parallel.every((r) => r.status === 302));
    assert.equal(w.ev.count("click"), 1);
    assert.deepEqual(await fetchPublisherAnalytics(w.ev.session({ publisherId: w.pubA.id })), { status: "ok", data: { impressions: 1, clicks: 1, ctr: 100 } });
  });

  it("a retried serve (same Idempotency-Key) gives the same serve, so two tokens still make ONE impression", async () => {
    const w = world();
    const first = await serve(w, "A", "gaming", { "idempotency-key": "retry-key-0001" });
    const retry = await serve(w, "A", "gaming", { "idempotency-key": "retry-key-0001" });
    assert.equal(w.db.serveLog.length, 1);
    assert.equal(first.token, retry.token);
    assert.equal((await impression(first.token)).json.status, "recorded");
    assert.equal((await impression(retry.token)).json.status, "duplicate");
    assert.equal(w.ev.count("impression"), 1);
  });

  it("two different serves are two different impressions (dedupe is per serve, not per publisher or creative)", async () => {
    const w = world();
    const s1 = await serve(w);
    const s2 = await serve(w);
    assert.equal((await impression(s1.token)).json.status, "recorded");
    assert.equal((await impression(s2.token)).json.status, "recorded");
    assert.equal(w.ev.count("impression", { publisherId: w.pubA.id }), 2);
  });
});

/* ===========================================================================================
 * 3. Invalid / expired credentials
 * ========================================================================================= */
describe("day 19 part 4: invalid or expired credentials are rejected without writing anything", () => {
  it("impression: every bad token gets the SAME 401 and nothing is written", async () => {
    const w = world();
    const s = await serve(w);
    const [prefix, payloadB64, sigB64] = s.token.split(".");
    const tamperedPayload = decode(payloadB64);
    tamperedPayload.exp = (tamperedPayload.exp as number) + 3600;
    const tamperedB64 = Buffer.from(JSON.stringify(tamperedPayload), "utf8").toString("base64url");
    const now = Date.now();
    const mint = (c: typeof config, over: Partial<{ serveRef: string; publisherId: string; servedAtMs: number }> = {}) => {
      const g = mintTrackingToken(c!, { serveRef: s.row.serveRef, publisherId: w.pubA.id, servedAtMs: s.row.servedAtMs, nowMs: now, ...over });
      if (!g) throw new Error("test: token mint failed");
      return g.token;
    };
    const bad: Record<string, string> = {
      "empty-ish": "x",
      garbage: "not-a-token",
      "wrong prefix": `bt2.${payloadB64}.${sigB64}`,
      "tampered payload (old signature)": `${prefix}.${tamperedB64}.${sigB64}`,
      "signed with another secret": mint(otherConfig),
      "click ref used as a token": s.ref,
      "unknown serve": mint(config, { serveRef: `bsr_${"a".repeat(40)}` }),
      "another publisher's identity": mint(config, { publisherId: w.pubB.id }),
      "serve time that does not match the database": mint(config, { servedAtMs: s.row.servedAtMs - 5000 }),
    };
    for (const [label, token] of Object.entries(bad)) {
      const r = await impression(token);
      assert.equal(r.status, 401, label);
      assert.equal(r.text, UNAUTHORIZED, `${label}: identical body (no reason leaked)`);
    }
    assert.equal(w.ev.events.length, 0);
    // asli token abhi bhi kaam karta hai (upar kuch bhi use kharab nahi kar gaya)
    assert.equal((await impression(s.token)).json.status, "recorded");
  });

  it("impression: an expired token is rejected (clock moved past the TTL)", async () => {
    const w = world();
    const s = await serve(w);
    clockOffsetMs = 2 * HOUR; // default TTL = 1 ghanta
    const r = await impression(s.token);
    assert.equal(r.status, 401);
    assert.equal(r.text, UNAUTHORIZED);
    assert.equal(w.ev.events.length, 0);
  });

  it("impression: bad request shapes (wrong event, extra fields, media type) never reach the database", async () => {
    const w = world();
    const s = await serve(w);
    const before = w.ev.rpcNames.length;
    assert.equal((await impression(s.token, { body: JSON.stringify({ token: s.token, event: "click" }) })).status, 400);
    assert.equal((await impression(s.token, { body: JSON.stringify({ token: s.token, event: "impression", publisher_id: w.pubB.id }) })).status, 400);
    assert.equal((await impression(s.token, { body: "{not json" })).status, 400);
    assert.equal((await impression(s.token, { contentType: "text/plain" })).status, 415);
    assert.equal(w.ev.rpcNames.length, before);
    assert.equal(w.ev.events.length, 0);
  });

  it("tracking secret missing => impression and click are unavailable (503), nothing written", async () => {
    const w = world();
    const s = await serve(w);
    delete process.env.AD_TRACKING_SECRET;
    assert.equal((await impression(s.token)).status, 503);
    assert.equal((await clickRef(s.ref)).status, 503);
    assert.equal(w.ev.events.length, 0);
  });

  it("database failure during record: 503 (not recorded), and a later retry records exactly once", async () => {
    const w = world();
    const s = await serve(w);
    w.ev.fail.record_ad_impression = { data: null, error: { code: "XX000", message: "db down" } };
    assert.equal((await impression(s.token)).status, 503);
    assert.equal(w.ev.events.length, 0);
    delete w.ev.fail.record_ad_impression;
    assert.equal((await impression(s.token)).json.status, "recorded");
    assert.equal(w.ev.count("impression"), 1);
  });

  it("click: every bad ref gets the SAME 404 with no redirect, and nothing is written", async () => {
    const w = world();
    const s = await serve(w);
    await impression(s.token); // impression ho chuka: koi galti se valid ref bana toh click REcord ho jaata
    const [, payloadB64, sigB64] = s.ref.split(".");
    const tampered = decode(payloadB64);
    tampered.exp = (tampered.exp as number) + 3600;
    const tamperedB64 = Buffer.from(JSON.stringify(tampered), "utf8").toString("base64url");
    const now = Date.now();
    const mint = (c: typeof config, over: Partial<{ serveRef: string; publisherId: string; creativeId: string; servedAtMs: number }> = {}) => {
      const g = mintClickRef(c!, { serveRef: s.row.serveRef, publisherId: w.pubA.id, creativeId: w.adX.creativeId, servedAtMs: s.row.servedAtMs, nowMs: now, ...over });
      if (!g) throw new Error("test: click ref mint failed");
      return g.ref;
    };
    const bad: Record<string, string> = {
      garbage: "not-a-ref",
      "wrong prefix": `bc2.${payloadB64}.${sigB64}`,
      "tampered payload (old signature)": `bc1.${tamperedB64}.${sigB64}`,
      "signed with another secret": mint(otherConfig),
      "impression token used as a ref": s.token,
      "unknown serve": mint(config, { serveRef: `bsr_${"b".repeat(40)}` }),
      "another publisher's identity": mint(config, { publisherId: w.pubB.id }),
      "another creative (advertiser Y's ad)": mint(config, { creativeId: w.adY.creativeId }),
      "serve time that does not match the database": mint(config, { servedAtMs: s.row.servedAtMs - 5000 }),
    };
    for (const [label, ref] of Object.entries(bad)) {
      const r = await clickRef(ref);
      assert.equal(r.status, 404, label);
      assert.equal(r.text, NOT_FOUND, `${label}: identical body (no reason leaked)`);
      assert.equal(r.headers.get("location"), null, `${label}: no redirect`);
    }
    assert.equal(w.ev.count("click"), 0);
    assert.equal((await clickRef(s.ref)).status, 302); // asli ref theek
    assert.equal(w.ev.count("click"), 1);
  });

  it("click: an expired ref is rejected with no redirect", async () => {
    const w = world();
    const s = await serve(w);
    await impression(s.token);
    clockOffsetMs = 2 * HOUR;
    const r = await clickRef(s.ref);
    assert.equal(r.status, 404);
    assert.equal(r.headers.get("location"), null);
    assert.equal(w.ev.count("click"), 0);
  });

  it("click: missing ref / extra parameters / repeated ref = 400, never a redirect", async () => {
    const w = world();
    const s = await serve(w);
    await impression(s.token);
    const enc = encodeURIComponent(s.ref);
    for (const q of ["", `ref=${enc}&url=https://evil.example.com`, `ref=${enc}&ref=${enc}`, `url=https://evil.example.com`, "ref="]) {
      const r = await click(q);
      assert.equal(r.status, 400, q);
      assert.equal(r.headers.get("location"), null, q);
    }
    assert.equal(w.ev.count("click"), 0);
  });

  it("click: non-GET methods are 405 and cannot count a click", async () => {
    const w = world();
    const s = await serve(w);
    await impression(s.token);
    for (const m of ["HEAD", "POST", "PUT", "PATCH", "DELETE"] as const) {
      const res = await toHttp(await clickRoute[m]());
      assert.equal(res.status, 405, m);
    }
    assert.equal(w.ev.count("click"), 0);
  });
});

/* ===========================================================================================
 * 4. Click destination ALWAYS comes from the verified database record
 * ========================================================================================= */
describe("day 19 part 4: click destinations come only from verified database records", () => {
  it("the redirect is the database destination at click time (not what the browser, the ad payload or the query says)", async () => {
    const w = world();
    const s = await serve(w);
    assert.equal((s.http.json.ad as { destination_url: string }).destination_url, DEFAULT_DESTINATION);
    await impression(s.token);
    w.internals.creatives.get(w.adX.creativeId)!.destinationUrl = "https://updated.example.com/new-page";
    const r = await clickRef(s.ref);
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("location"), "https://updated.example.com/new-page");
  });

  it("destination-like query parameters are rejected (400) and never followed", async () => {
    const w = world();
    const s = await serve(w);
    await impression(s.token);
    const enc = encodeURIComponent(s.ref);
    for (const p of ["url", "dest", "destination", "redirect", "next", "to", "return"]) {
      const r = await click(`ref=${enc}&${p}=${encodeURIComponent("https://evil.example.com")}`);
      assert.equal(r.status, 400, p);
      assert.equal(r.headers.get("location"), null, p);
    }
    assert.equal(w.ev.count("click"), 0);
  });

  it("an unsafe destination in the database is never redirected to and never counted as a click", async () => {
    const w = world();
    const s = await serve(w);
    await impression(s.token);
    const unsafe = [
      "http://insecure.example.com/x",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "//evil.example.com/x",
      "https://user:pw@evil.example.com/x",
      "https://127.0.0.1/x",
      "https://localhost/x",
      `https://example.com/${"a".repeat(2100)}`,
      "",
    ];
    for (const dest of unsafe) {
      w.internals.creatives.get(w.adX.creativeId)!.destinationUrl = dest;
      const r = await clickRef(s.ref);
      assert.equal(r.status, 404, dest.slice(0, 40));
      assert.equal(r.headers.get("location"), null, dest.slice(0, 40));
    }
    assert.equal(w.ev.count("click"), 0);
    assert.ok(!w.ev.rpcNames.includes("record_ad_click"), "an unsafe destination must be refused BEFORE the click is written");
  });

  it("creative paused, campaign paused or advertiser suspended after the serve: no redirect, no click; back to normal once eligible again", async () => {
    const w = world();
    const s = await serve(w);
    await impression(s.token);
    const creative = w.internals.creatives.get(w.adX.creativeId)!;
    const campaign = w.internals.campaigns.get(w.adX.campaignId)!;
    const advertiser = w.internals.advertisers.get(w.advX)!;

    creative.status = "paused";
    assert.equal((await clickRef(s.ref)).status, 404);
    creative.status = "approved";
    campaign.status = "paused";
    assert.equal((await clickRef(s.ref)).status, 404);
    campaign.status = "active";
    advertiser.status = "suspended";
    const blocked = await clickRef(s.ref);
    assert.equal(blocked.status, 404);
    assert.equal(blocked.headers.get("location"), null);
    assert.equal(w.ev.count("click"), 0);

    advertiser.status = "active";
    const back = await clickRef(s.ref);
    assert.equal(back.status, 302);
    assert.equal(w.ev.count("click"), 1);
  });

  it("another publisher's serve cannot be clicked with publisher A's ref (ref is bound to its own serve, publisher and creative)", async () => {
    const w = world();
    const a = await serve(w, "A");
    const b = await serve(w, "B");
    await impression(a.token);
    await impression(b.token);
    // A ke ref ko B ki serve par laagu karne ki koshish: ref me serve_ref A ki hai, isliye click A ki serve par hi ginti hai, B ki par nahi.
    assert.equal((await clickRef(a.ref)).status, 302);
    assert.equal(w.ev.count("click", { serveRef: a.row.serveRef }), 1);
    assert.equal(w.ev.count("click", { serveRef: b.row.serveRef }), 0);
    assert.equal(w.ev.count("click", { publisherId: w.pubB.id }), 0);
  });
});

/* ===========================================================================================
 * 5. Analytics: correct numbers, ownership, isolation
 * ========================================================================================= */
describe("day 19 part 4: analytics reflect recorded events, with publisher ownership and advertiser isolation", () => {
  async function traffic(w: World) {
    const a1 = await serve(w, "A", "gaming"); // X: impression + click
    const a2 = await serve(w, "A", "gaming"); // X: impression only
    const a3 = await serve(w, "A", "travel"); // Y: impression only
    const b1 = await serve(w, "B", "gaming"); // X: impression + click
    await serve(w, "B", "travel"); // Y: serve only, no impression
    await fullEngagement(a1);
    await impression(a2.token);
    await impression(a3.token);
    await fullEngagement(b1);
    return { a1, a2, a3, b1 };
  }

  it("publisher analytics count only that publisher's own impressions and clicks", async () => {
    const w = world();
    await traffic(w);
    const a = await loadPublisherOverview("publisher", async () => w.ev.session({ publisherId: w.pubA.id }));
    assert.deepEqual(a, { status: "ok", impressions: 3, clicks: 1, ctr: 33.3333, hasEvents: true });
    const b = await loadPublisherOverview("publisher", async () => w.ev.session({ publisherId: w.pubB.id }));
    assert.deepEqual(b, { status: "ok", impressions: 1, clicks: 1, ctr: 100, hasEvents: true });
  });

  it("advertiser campaign performance counts only that campaign's events (across publishers)", async () => {
    const w = world();
    await traffic(w);
    const x = await loadCampaignPerformance(async () => w.ev.session({ advertiserId: w.advX }), w.adX.campaignId);
    assert.deepEqual(x, { status: "ok", impressions: 3, clicks: 2, ctr: 66.6667, hasEvents: true });
    const x2 = await loadCampaignPerformance(async () => w.ev.session({ advertiserId: w.advX }), w.adX2.campaignId);
    assert.deepEqual(x2, { status: "ok", impressions: 0, clicks: 0, ctr: 0, hasEvents: false });
    const y = await loadCampaignPerformance(async () => w.ev.session({ advertiserId: w.advY }), w.adY.campaignId);
    assert.deepEqual(y, { status: "ok", impressions: 1, clicks: 0, ctr: 0, hasEvents: true });
  });

  it("advertiser overview totals = total clicks / total impressions (not an average of campaign CTRs) and include only own campaigns", async () => {
    const w = world();
    await traffic(w);
    const x = await loadAdvertiserOverview("advertiser", async () => w.ev.session({ advertiserId: w.advX }));
    assert.deepEqual(x, { status: "ok", totals: { campaigns: 2, campaignsWithEvents: 1, impressions: 3, clicks: 2, ctr: 66.6667 } });
    const y = await loadAdvertiserOverview("advertiser", async () => w.ev.session({ advertiserId: w.advY }));
    assert.deepEqual(y, { status: "ok", totals: { campaigns: 1, campaignsWithEvents: 1, impressions: 1, clicks: 0, ctr: 0 } });
  });

  it("an advertiser cannot read another advertiser's campaign (and a publisher cannot read any campaign): all look like 'unavailable'", async () => {
    const w = world();
    await traffic(w);
    const other = await loadCampaignPerformance(async () => w.ev.session({ advertiserId: w.advY }), w.adX.campaignId);
    assert.deepEqual(other, { status: "unavailable" });
    const asPublisher = await loadCampaignPerformance(async () => w.ev.session({ publisherId: w.pubA.id }), w.adX.campaignId);
    assert.deepEqual(asPublisher, { status: "unavailable" });
    const unknown = await loadCampaignPerformance(async () => w.ev.session({ advertiserId: w.advX }), "00000000-0000-4000-8000-00000000ffff");
    assert.deepEqual(unknown, { status: "unavailable" });
    assert.deepEqual(other, unknown, "foreign and non-existent campaigns are indistinguishable");
  });

  it("a database reply for the WRONG campaign is rejected as an error, never shown", async () => {
    const w = world();
    await traffic(w);
    const forged: AnalyticsRpcClient = { rpc: async () => ok([{ campaign_id: w.adY.campaignId, impressions: 1, clicks: 0, ctr: 0 }]) };
    assert.deepEqual(await fetchCampaignAnalytics(forged, w.adX.campaignId), { status: "error" });
  });

  it("role gates: a publisher never gets advertiser totals and an advertiser never gets publisher totals (no database call is made)", async () => {
    const w = world();
    await traffic(w);
    let made = 0;
    const getClient = async () => {
      made += 1;
      return w.ev.session({ publisherId: w.pubA.id, advertiserId: w.advX });
    };
    assert.deepEqual(await loadAdvertiserOverview("publisher", getClient), { status: "unavailable" });
    assert.deepEqual(await loadAdvertiserOverview("admin", getClient), { status: "unavailable" });
    assert.deepEqual(await loadPublisherOverview("advertiser", getClient), { status: "unavailable" });
    assert.deepEqual(await loadPublisherOverview(null, getClient), { status: "unavailable" });
    assert.equal(made, 0);
  });

  it("a publisher whose profile is not active, or who has no publisher row, gets not_found (never fake zeros)", async () => {
    const w = world();
    await traffic(w);
    assert.deepEqual(await loadPublisherOverview("publisher", async () => w.ev.session({ publisherId: w.pubA.id, publisherProfileActive: false })), { status: "not_found" });
    assert.deepEqual(await loadPublisherOverview("publisher", async () => w.ev.session({})), { status: "not_found" });
  });

  it("analytics output never leaks the other side: publishers see no campaign / advertiser ids, advertisers see no publisher ids", async () => {
    const w = world();
    await traffic(w);
    const pubView = await loadPublisherOverview("publisher", async () => w.ev.session({ publisherId: w.pubA.id }));
    assert.deepEqual(Object.keys(pubView).sort(), ["clicks", "ctr", "hasEvents", "impressions", "status"]);
    const pubText = JSON.stringify(pubView);
    for (const id of [w.adX.campaignId, w.adX.creativeId, w.adY.campaignId, w.advX, w.advY]) assert.ok(!pubText.includes(id));

    const advView = await loadCampaignPerformance(async () => w.ev.session({ advertiserId: w.advX }), w.adX.campaignId);
    assert.deepEqual(Object.keys(advView).sort(), ["clicks", "ctr", "hasEvents", "impressions", "status"]);
    const advText = JSON.stringify([advView, await loadAdvertiserOverview("advertiser", async () => w.ev.session({ advertiserId: w.advX }))]);
    for (const id of [w.pubA.id, w.pubB.id, w.pubA.key, w.pubB.key]) assert.ok(!advText.includes(id));
  });

  it("events that are rejected (bad token / bad ref) never show up in analytics", async () => {
    const w = world();
    const s = await serve(w);
    await impression("bt1.bad.token");
    await clickRef("bc1.bad.ref");
    await impression(s.ref);
    const pub = await fetchPublisherAnalytics(w.ev.session({ publisherId: w.pubA.id }));
    assert.deepEqual(pub, { status: "ok", data: { impressions: 0, clicks: 0, ctr: 0 } });
  });
});

/* ===========================================================================================
 * 6. Impressions and clicks stay separate from money
 * ========================================================================================= */
describe("day 19 part 4: impressions and clicks never touch spend, ledger, earnings, revenue share or payouts", () => {
  it("spend changes ONLY at serve time; impressions and clicks (including duplicates) leave it exactly as it was", async () => {
    const w = world();
    const s = await serve(w);
    const spendAfterServe = w.db.spendOf(w.adX.campaignId);
    assert.ok(spendAfterServe > 0);
    const serves = w.db.serveLog.length;
    for (let i = 0; i < 3; i += 1) await impression(s.token);
    for (let i = 0; i < 3; i += 1) await clickRef(s.ref);
    assert.equal(w.db.spendOf(w.adX.campaignId), spendAfterServe);
    assert.equal(w.db.serveLog.length, serves);
  });

  it("only tracking / read-only analytics database functions run for impression, click and analytics (no ledger / payout / earnings function)", async () => {
    const w = world();
    const s = await serve(w);
    await fullEngagement(s);
    const sessions = [w.ev.session({ publisherId: w.pubA.id }), w.ev.session({ advertiserId: w.advX })];
    await loadPublisherOverview("publisher", async () => sessions[0]);
    await loadCampaignPerformance(async () => sessions[1], w.adX.campaignId);
    await loadAdvertiserOverview("advertiser", async () => sessions[1]);

    const trackingAndAnalytics = [...w.ev.rpcNames, ...sessions[0].calls, ...sessions[1].calls];
    const allowed = new Set([...TRACKING_RPCS, "get_my_publisher_analytics", "get_my_campaign_analytics"]);
    for (const name of trackingAndAnalytics) assert.ok(allowed.has(name), `unexpected rpc ${name}`);
    const everything = [...w.db.calls.map((c) => c.name), ...trackingAndAnalytics];
    assert.ok(everything.every((n) => !/ledger|earning|payout|revenue|balance|payment|charge/i.test(n)), "a financial function was called");
    assert.deepEqual(sessions[0].calls, ["get_my_publisher_analytics"]);
  });

  it("event rows carry no money fields, and analytics results carry only counts and CTR", async () => {
    const w = world();
    const s = await serve(w);
    await fullEngagement(s);
    for (const e of w.ev.events) assert.deepEqual(Object.keys(e).sort(), ["atMs", "campaignId", "creativeId", "id", "publisherId", "serveRef", "type"]);
    const result = JSON.stringify([
      await fetchPublisherAnalytics(w.ev.session({ publisherId: w.pubA.id })),
      await fetchCampaignAnalytics(w.ev.session({ advertiserId: w.advX }), w.adX.campaignId),
    ]);
    assert.ok(!/spend|earning|revenue|payout|amount|cost|usd|balance/i.test(result));
  });

  it("the delivery / tracking / analytics modules have no code link to ledger, earnings, revenue-share or payout modules", () => {
    const files = [
      "lib/ads/impression-handler.ts",
      "lib/ads/click-handler.ts",
      "lib/ads/impression.ts",
      "lib/ads/click.ts",
      "lib/ads/impression-db.ts",
      "lib/ads/click-db.ts",
      "lib/ads/analytics.ts",
      "lib/ads/analytics-overview.ts",
      "lib/ads/campaign-performance.ts",
      "lib/ads/publisher-overview.ts",
    ];
    const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "");
    for (const f of files) {
      const code = stripComments(sourceOf(f));
      assert.ok(!/lib\/ledger|lib\/payouts|ledger|payout|earning|revenue|share_bps|platform_revenue/i.test(code), `${f} refers to a financial module`);
    }
  });
});
