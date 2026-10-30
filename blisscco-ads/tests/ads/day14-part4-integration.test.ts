import { fake } from "../campaigns/action-stubs"; // SABSE PEHLE: campaign actions ke nakli modules lagte hain
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as matchRoute from "@/app/api/v1/ads/match/route";
import * as impressionRoute from "@/app/api/v1/ads/impression/route";
import * as clickRoute from "@/app/api/v1/ads/click/route";
import { createCampaign } from "@/app/dashboard/advertiser/campaigns/actions";
import { PUBLIC_AD_FIELDS, PUBLIC_TRACKING_FIELDS } from "@/lib/ads/contract";
import { mintClickRef } from "@/lib/ads/click-ref";
import { handleClickGet } from "@/lib/ads/click-handler";
import { handleImpressionPost } from "@/lib/ads/impression-handler";
import { createIpGuard } from "@/lib/ads/ip-guard";
import { SERVE_REF_RE, mintTrackingToken, readTrackingConfig } from "@/lib/ads/tracking-token";
import { deliveryState, type DeliveryInput } from "@/lib/campaigns/delivery";
import { utcToday } from "@/lib/campaigns/validation";
import { FakeAdDb, makeKey, sha256, type ServeLogRow } from "./fake-ad-db";

// Day 14 Part 4: INTEGRATION tests (route -> handler -> service -> nakli database). Asli Supabase / production kabhi nahi chhuta.
// Ye ek hi flow ko end-to-end chalate hain:
//   advertiser campaign banata hai -> campaign eligible hota hai -> publisher authenticate hota hai -> contextual match -> serve (ya no-fill)
//   -> Day 12 ke SIRF wo routes jo repo me hain: POST /api/v1/ads/impression aur GET /api/v1/ads/click.
// LIMIT: FakeAdDb + EventStore SQL ka MODEL hain (day-5-6, day-9-5, day-12-5, day-12-7, day-12-10 padhkar), SQL khud nahi.
//   SQL ke asli test tests/integration/*.test.ts (TEST database) me hain; ye file unhe nahi badalti.
// NOTE (jo abhi implement NAHI hai, isliye assume nahi kiya):
//   * Match response me click ref (bc1...) nahi aata (DAY12-PROMPT5-PART3-CLICK.md "Blocker"). Isliye click route ke tests ref ko
//     mintClickRef() se banate hain (wahi helper, wahi signing secret), jaisa Part 2/3 ke tests karte hain. Match se ref milne ka koi test nahi.
//   * Impression/click par charge nahi hota (sirf serve par). Test yahi saabit karta hai: spend impression/click se nahi badalta.

const SECRET = "k7f2-0123456789-abcdefghijklmnopqrstuvwxyz-primary";
const OTHER_SECRET = "m4q9-0123456789-abcdefghijklmnopqrstuvwxyz-rotated";
const BASE = "https://blisscco.test";
const HOUR = 3_600_000;
const UNIT = 0.002;
const KEY = makeKey("a");
const KEY_B = makeKey("b");

const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
const realConsoleError = console.error;
const ENV_NAMES = ["AD_TRACKING_SECRET", "AD_TRACKING_SECRET_PREVIOUS", "AD_TRACKING_TTL_SECONDS"] as const;
const savedEnv: Record<string, string | undefined> = {};
let logged: string[] = [];

// ===========================================================================================================================
// Nakli event store: lookup_serve_for_event, record_ad_impression, lookup_serve_for_click, record_ad_click (day-12-7, day-12-10).
type Reply = { data: unknown; error: { code?: string; message?: string } | null };
type Internals = {
  creatives: Map<string, { status: string; destinationUrl: string; campaignId: string; advertiserId: string }>;
  campaigns: Map<string, { status: string; startDate: string; endDate: string | null }>;
  advertisers: Map<string, { status: string; profileStatus: string }>;
};
const internals = (db: FakeAdDb): Internals => db as unknown as Internals;
const TRACKING_RPCS = ["lookup_serve_for_event", "record_ad_impression", "lookup_serve_for_click", "record_ad_click"];

class EventStore {
  /** serve_ref -> occurred_at. Unique (serve_id, event_type): ek serve = ek impression, ek click. */
  impressions = new Map<string, number>();
  clicks = new Map<string, number>();
  calls: { name: string; args: Record<string, unknown> }[] = [];
  fail: Record<string, Reply | undefined> = {};
  throwOn = new Set<string>();
  constructor(private readonly db: FakeAdDb) {}

  count(name: string): number {
    return this.calls.filter((c) => c.name === name).length;
  }
  private serve(ref: unknown): ServeLogRow | undefined {
    return typeof ref === "string" && SERVE_REF_RE.test(ref) ? this.db.serveLog.find((s) => s.serveRef === ref) : undefined;
  }
  /** private.click_target (day-12-10): creative approved + campaign active + schedule + advertiser/profile active => destination, warna null. */
  private clickTarget(creativeId: string): string | null {
    const i = internals(this.db);
    const cr = i.creatives.get(creativeId);
    const camp = cr ? i.campaigns.get(cr.campaignId) : undefined;
    const adv = cr ? i.advertisers.get(cr.advertiserId) : undefined;
    if (!cr || !camp || !adv) return null;
    const today = utcToday();
    if (cr.status !== "approved" || camp.status !== "active") return null;
    if (camp.startDate > today || (camp.endDate !== null && camp.endDate < today)) return null;
    if (adv.status !== "active" || adv.profileStatus !== "active") return null;
    return cr.destinationUrl;
  }

  async rpc(name: string, args: Record<string, unknown>): Promise<Reply> {
    this.calls.push({ name, args });
    if (this.throwOn.has(name)) throw new Error("test: database unreachable");
    const forced = this.fail[name];
    if (forced) return forced;
    const ok = (data: unknown): Reply => ({ data, error: null });
    const s = this.serve(args.p_serve_ref);
    switch (name) {
      case "lookup_serve_for_event":
        return ok(s ? { outcome: "found", publisher_id: s.publisherId, served_at: new Date(s.servedAtMs).toISOString() } : { outcome: "not_found" });
      case "lookup_serve_for_click": {
        if (!s) return ok({ outcome: "not_found" });
        const dest = this.clickTarget(s.creativeId);
        return ok({
          outcome: "found",
          publisher_id: s.publisherId,
          creative_id: s.creativeId,
          served_at: new Date(s.servedAtMs).toISOString(),
          destination_url: dest,
          eligible: dest !== null,
        });
      }
      case "record_ad_impression": {
        if (!s || s.publisherId !== args.p_publisher_id || Date.now() > s.servedAtMs + 24 * HOUR) return ok({ outcome: "rejected" });
        if (this.impressions.has(s.serveRef)) return ok({ outcome: "duplicate" });
        this.impressions.set(s.serveRef, Date.now());
        return ok({ outcome: "recorded" });
      }
      case "record_ad_click": {
        if (!s || s.publisherId !== args.p_publisher_id || s.creativeId !== args.p_creative_id || Date.now() > s.servedAtMs + 24 * HOUR) {
          return ok({ outcome: "rejected" });
        }
        const dest = this.clickTarget(s.creativeId);
        if (dest === null) return ok({ outcome: "ineligible" });
        if (!this.impressions.has(s.serveRef)) return ok({ outcome: "not_counted", destination_url: dest }); // D4: pehle impression
        if (this.clicks.has(s.serveRef)) return ok({ outcome: "duplicate", destination_url: dest });
        this.clicks.set(s.serveRef, Date.now());
        return ok({ outcome: "recorded", destination_url: dest });
      }
      default:
        throw new Error(`test: unexpected tracking rpc ${name}`);
    }
  }
}

// ===========================================================================================================================
// World: ek nakli database + ek active publisher + ek active advertiser.
type World = { db: FakeAdDb; events: EventStore; publisherId: string; advertiserId: string };

function world(): World {
  const db = new FakeAdDb();
  db.nowMs = Date.now(); // db ki "aaj" ki date asli date se mile (campaign ki start date aaj ho toh bhi serve ho)
  const events = new EventStore(db);
  const publisher = db.addPublisher();
  db.addKey(publisher.id, KEY);
  const advertiser = db.addAdvertiser();
  globals.__TEST_SUPABASE__ = {
    rpc: async (name: string, args: Record<string, unknown> = {}) =>
      TRACKING_RPCS.includes(name) ? events.rpc(name, args) : db.client().rpc(name, args),
  };
  return { db, events, publisherId: publisher.id, advertiserId: advertiser.id };
}

beforeEach(() => {
  for (const n of ENV_NAMES) savedEnv[n] = process.env[n];
  process.env.AD_TRACKING_SECRET = SECRET;
  delete process.env.AD_TRACKING_SECRET_PREVIOUS;
  delete process.env.AD_TRACKING_TTL_SECONDS;
  logged = [];
  console.error = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  };
  fake.reset();
});
afterEach(() => {
  for (const n of ENV_NAMES) {
    if (savedEnv[n] === undefined) delete process.env[n];
    else process.env[n] = savedEnv[n];
  }
  console.error = realConsoleError;
  delete globals.__TEST_SUPABASE__;
});

// ----- HTTP helpers ---------------------------------------------------------------------------------------------------------
type Http = { status: number; headers: Headers; text: string; json: Record<string, unknown> };
async function toHttp(res: Response): Promise<Http> {
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = {};
  }
  return { status: res.status, headers: res.headers, text, json };
}

async function match(body: unknown, key: string | null = KEY, headers: Record<string, string> = {}): Promise<Http> {
  const h: Record<string, string> = { "content-type": "application/json", ...headers };
  if (key !== null) h.authorization = `Bearer ${key}`;
  return toHttp(await matchRoute.POST(new Request(`${BASE}/api/v1/ads/match`, { method: "POST", headers: h, body: typeof body === "string" ? body : JSON.stringify(body) })));
}

function impressionRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${BASE}/api/v1/ads/impression`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const impression = async (token: unknown, headers: Record<string, string> = {}): Promise<Http> =>
  toHttp(await impressionRoute.POST(impressionRequest({ token, event: "impression" }, headers)));

const clickRequest = (query: string, headers: Record<string, string> = {}): Request =>
  new Request(`${BASE}/api/v1/ads/click${query}`, { method: "GET", headers });
const click = async (ref: string, headers: Record<string, string> = {}): Promise<Http> =>
  toHttp(await clickRoute.GET(clickRequest(`?ref=${encodeURIComponent(ref)}`, headers)));

// ----- tracking helpers ---------------------------------------------------------------------------------------------------
const config = readTrackingConfig({ AD_TRACKING_SECRET: SECRET });
if (!config) throw new Error("test: tracking config must be valid");
const otherConfig = readTrackingConfig({ AD_TRACKING_SECRET: OTHER_SECRET });
if (!otherConfig) throw new Error("test: other tracking config must be valid");

/** Ek kamyab serve + tracking opt-in. Token response se aata hai (asli rasta); serve row nakli database se. */
async function serveWithTracking(w: World, topic = "gaming"): Promise<{ token: string; serve: ServeLogRow; res: Http }> {
  const res = await match({ topic }, KEY, { "x-blisscco-tracking": "1" });
  assert.equal(res.status, 200, res.text);
  const tracking = res.json.tracking as { token: string } | undefined;
  assert.ok(tracking?.token, "tracking token expected");
  const serve = w.db.serveLog[w.db.serveLog.length - 1];
  assert.ok(serve, "serve row expected");
  return { token: tracking.token, serve, res };
}

function refFor(serve: ServeLogRow, over: Partial<{ publisherId: string; creativeId: string; servedAtMs: number; nowMs: number; useOtherSecret: boolean }> = {}): string {
  const grant = mintClickRef(over.useOtherSecret ? otherConfig! : config!, {
    serveRef: serve.serveRef,
    publisherId: over.publisherId ?? serve.publisherId,
    creativeId: over.creativeId ?? serve.creativeId,
    servedAtMs: over.servedAtMs ?? serve.servedAtMs,
    nowMs: over.nowMs ?? Date.now(),
  });
  assert.ok(grant, "click ref expected");
  return grant.ref;
}

const adText = (n: string) => `Headline ${n}`;
const UNAUTHORIZED = '{"error":"unauthorized"}';

// ===========================================================================================================================
describe("day 14 part 4 / 1: advertiser campaign creation (server action)", () => {
  function form(over: Record<string, string> = {}): FormData {
    const fd = new FormData();
    const values: Record<string, string> = {
      name: "Winter launch",
      description: "Gaming gear",
      category: "gaming",
      totalBudget: "500",
      dailyBudget: "50",
      startDate: utcToday(),
      endDate: "",
      ...over,
    };
    for (const [k, v] of Object.entries(values)) fd.set(k, v);
    return fd;
  }
  const run = (fd: FormData) => createCampaign({ status: "idle" }, fd);

  it("a valid form inserts ONE campaign owned by the logged-in advertiser (taken from the database, never from the form) and redirects to it", async () => {
    const fd = form();
    fd.set("advertiser_id", "adv-EVIL"); // spoof
    fd.set("status", "active"); // spoof
    await assert.rejects(run(fd), /REDIRECT:\/dashboard\/advertiser\/campaigns\/00000000-0000-4000-8000-000000000001\?created=1/);
    assert.equal(fake.calls.length, 1);
    const call = fake.calls[0];
    assert.equal(call.table, "campaigns");
    assert.equal(call.op, "insert");
    assert.equal(call.payload.advertiser_id, "adv-A");
    assert.equal(call.payload.name, "Winter launch");
    assert.equal(call.payload.category, "gaming");
    assert.equal("status" in call.payload, false, "a new campaign never chooses its own status (database default = not serving)");
    assert.equal(JSON.stringify(call.payload).includes("adv-EVIL"), false);
  });

  it("invalid input (zero budget, unknown category, daily above total, past start) is rejected with field errors and nothing is written", async () => {
    for (const bad of <Record<string, string>[]>[{ totalBudget: "0" }, { category: "not-a-category" }, { totalBudget: "10", dailyBudget: "50" }, { startDate: "2000-01-01" }, { name: "" }]) {
      const out = await run(form(bad));
      assert.equal(out.status, "error", JSON.stringify(bad));
      assert.ok(out.fieldErrors && Object.keys(out.fieldErrors).length > 0, JSON.stringify(bad));
    }
    assert.equal(fake.calls.length, 0);
  });

  it("a missing, suspended or pending advertiser account, or a wrong role, cannot create a campaign", async () => {
    fake.me = null;
    assert.equal((await run(form())).status, "error");
    fake.me = { id: "adv-A", status: "suspended" };
    assert.equal((await run(form())).status, "error");
    fake.me = { id: "adv-A", status: "pending" };
    assert.equal((await run(form())).status, "error");
    fake.me = { id: "adv-A", status: "active" };
    fake.roleFails = true;
    await assert.rejects(run(form()), /REDIRECT:\/login/);
    assert.equal(fake.calls.length, 0);
  });

  it("a database error gives a safe error message (no redirect, no raw database detail)", async () => {
    fake.dbError = { code: "23514", hint: "secret internal hint" };
    const out = await run(form());
    assert.equal(out.status, "error");
    assert.equal(JSON.stringify(out).includes("secret internal hint"), false);
  });
});

// ===========================================================================================================================
describe("day 14 part 4 / 2: a created campaign becomes eligible only after review (creation -> eligibility -> serve)", () => {
  it("campaign payload from createCampaign: draft + unapproved creative = no-fill; approvals make it serve the right ad", async () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ name: "Pipeline", description: "", category: "gaming", totalBudget: "5", dailyBudget: "", startDate: utcToday(), endDate: "" })) fd.set(k, v);
    await assert.rejects(createCampaign({ status: "idle" }, fd), /REDIRECT:/);
    const payload = fake.calls[0].payload;

    const w = world();
    const { campaignId, creativeId } = w.db.addAd(w.advertiserId, {
      category: String(payload.category),
      totalBudget: Number(payload.total_budget),
      dailyBudget: payload.daily_budget === null || payload.daily_budget === undefined ? null : Number(payload.daily_budget),
      startDate: String(payload.start_date),
      endDate: payload.end_date === null || payload.end_date === undefined ? null : String(payload.end_date),
      campaignStatus: "draft",
      creativeStatus: "pending_review",
      headline: "Pipeline ad",
    });

    assert.equal((await match({ topic: "gaming" })).text, '{"fill":false}', "draft campaign + pending creative");
    w.db.setCreativeStatus(creativeId, "approved");
    assert.equal((await match({ topic: "gaming" })).text, '{"fill":false}', "approved creative but campaign still draft");
    w.db.setCampaignStatus(campaignId, "pending_review");
    assert.equal((await match({ topic: "gaming" })).text, '{"fill":false}', "campaign waiting for review");
    assert.equal(w.db.serveLog.length, 0);
    assert.equal(w.db.spendOf(campaignId), 0);

    w.db.setCampaignStatus(campaignId, "active");
    const res = await match({ topic: "gaming" });
    assert.equal(res.status, 200);
    assert.equal((res.json.ad as { id: string; headline: string }).id, creativeId);
    assert.equal((res.json.ad as { headline: string }).headline, "Pipeline ad");
    assert.equal(w.db.serveLog.length, 1);
  });

  type Case = {
    name: string;
    ad: NonNullable<Parameters<FakeAdDb["addAd"]>[1]>;
    advertiser?: { status?: "pending" | "active" | "suspended"; profile?: "active" | "suspended" };
    fill: boolean;
    reason: string | null; // deliveryState reason (campaigns dashboard ka "Not showing ads" karan)
  };
  const CASES: Case[] = [
    { name: "eligible", ad: {}, fill: true, reason: null },
    { name: "campaign draft", ad: { campaignStatus: "draft" }, fill: false, reason: "campaign_not_active" },
    { name: "campaign pending_review", ad: { campaignStatus: "pending_review" }, fill: false, reason: "campaign_not_active" },
    { name: "campaign paused", ad: { campaignStatus: "paused" }, fill: false, reason: "campaign_not_active" },
    { name: "campaign rejected", ad: { campaignStatus: "rejected" }, fill: false, reason: "campaign_not_active" },
    { name: "campaign completed", ad: { campaignStatus: "completed" }, fill: false, reason: "campaign_not_active" },
    { name: "campaign archived", ad: { campaignStatus: "archived" }, fill: false, reason: "campaign_not_active" },
    { name: "creative pending_review", ad: { creativeStatus: "pending_review" }, fill: false, reason: "no_approved_creative" },
    { name: "creative rejected", ad: { creativeStatus: "rejected" }, fill: false, reason: "no_approved_creative" },
    { name: "creative paused", ad: { creativeStatus: "paused" }, fill: false, reason: "no_approved_creative" },
    { name: "creative archived", ad: { creativeStatus: "archived" }, fill: false, reason: "no_approved_creative" },
    { name: "campaign ended", ad: { endDate: "2020-12-31" }, fill: false, reason: "ended" },
    { name: "campaign not started", ad: { startDate: "2999-01-01" }, fill: false, reason: "not_started" },
    { name: "total budget below one serve", ad: { totalBudget: 0.001 }, fill: false, reason: "total_budget_used" },
    { name: "daily budget below one serve", ad: { dailyBudget: 0.001 }, fill: false, reason: "daily_budget_used" },
    { name: "advertiser suspended", ad: {}, advertiser: { status: "suspended" }, fill: false, reason: "advertiser_not_active" },
    { name: "advertiser pending", ad: {}, advertiser: { status: "pending" }, fill: false, reason: "advertiser_not_active" },
    { name: "advertiser profile suspended", ad: {}, advertiser: { profile: "suspended" }, fill: false, reason: "advertiser_not_active" },
  ];
  for (const c of CASES) {
    it(`${c.name} => ${c.fill ? "serves" : "no-fill"} (and the dashboard delivery state agrees)`, async () => {
      const w = world();
      const adv = w.db.addAdvertiser(c.advertiser?.status ?? "active", c.advertiser?.profile ?? "active");
      const added = w.db.addAd(adv.id, { headline: "Case ad", ...c.ad });
      const res = await match({ topic: "gaming" });
      assert.equal(res.status, 200);
      assert.equal(res.json.fill, c.fill, c.name);
      assert.equal(w.db.serveLog.length, c.fill ? 1 : 0);
      assert.equal(w.db.spendOf(added.campaignId), c.fill ? UNIT : 0, "spend only when served");
      if (!c.fill) assert.equal(res.text.includes("Case ad"), false);

      const state = deliveryState({
        status: (c.ad.campaignStatus ?? "active") as DeliveryInput["status"],
        startDate: c.ad.startDate ?? "2020-01-01",
        endDate: c.ad.endDate ?? null,
        totalBudget: c.ad.totalBudget ?? 10,
        dailyBudget: c.ad.dailyBudget ?? null,
        approvedCreatives: (c.ad.creativeStatus ?? "approved") === "approved" ? 1 : 0,
        spentTotal: 0,
        spentToday: 0,
        todayUtc: utcToday(),
        unitCostUsd: UNIT,
        advertiserActive: (c.advertiser?.status ?? "active") === "active" && (c.advertiser?.profile ?? "active") === "active",
      });
      assert.equal(state.serving, c.fill, `deliveryState: ${state.message}`);
      assert.equal(state.reason, c.reason);
    });
  }

  it("a campaign stops serving once its total budget is spent, and later requests are no-fill with no new charge", async () => {
    const w = world();
    const { campaignId } = w.db.addAd(w.advertiserId, { totalBudget: 0.004 });
    assert.equal((await match({ topic: "gaming" })).json.fill, true);
    assert.equal((await match({ topic: "gaming" })).json.fill, true);
    const third = await match({ topic: "gaming" });
    assert.equal(third.text, '{"fill":false}');
    assert.equal(w.db.spendOf(campaignId), 0.004);
    assert.equal(w.db.serveLog.length, 2);
  });
});

// ===========================================================================================================================
describe("day 14 part 4 / 3: publisher authentication", () => {
  it("missing, empty, wrong-scheme and malformed keys are 401 with one identical body, and never reach the database", async () => {
    const w = world();
    w.db.addAd(w.advertiserId, {});
    for (const headers of <Record<string, string>[]>[{}, { authorization: "" }, { authorization: "Bearer " }, { authorization: `Basic ${KEY}` }, { authorization: "Bearer short" }, { authorization: `Bearer ${"x".repeat(300)}` }]) {
      const res = await toHttp(
        await matchRoute.POST(new Request(`${BASE}/api/v1/ads/match`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: '{"topic":"gaming"}' })),
      );
      assert.equal(res.status, 401, JSON.stringify(headers));
      assert.equal(res.text, UNAUTHORIZED);
    }
    assert.equal(w.db.calls.length, 0);
  });

  it("unknown, revoked, expired keys and pending/suspended publishers or profiles all get the SAME 401 as an unknown key, and no candidates are loaded", async () => {
    const w = world();
    w.db.addAd(w.advertiserId, {});
    const unknown = await match({ topic: "gaming" }, makeKey("f"));
    assert.equal(unknown.status, 401);
    assert.equal(unknown.text, UNAUTHORIZED);

    const revoked = makeKey("1");
    w.db.addKey(w.db.addPublisher().id, revoked, { status: "revoked" });
    const expired = makeKey("2");
    w.db.addKey(w.db.addPublisher().id, expired, { expiresInMs: -1000 });
    const pending = makeKey("3");
    w.db.addKey(w.db.addPublisher("pending").id, pending);
    const suspended = makeKey("4");
    w.db.addKey(w.db.addPublisher("suspended").id, suspended);
    const profileSuspended = makeKey("5");
    w.db.addKey(w.db.addPublisher("active", "suspended").id, profileSuspended);

    for (const key of [revoked, expired, pending, suspended, profileSuspended]) {
      const res = await match({ topic: "gaming" }, key);
      assert.equal(res.status, 401, key);
      assert.equal(res.text, unknown.text, "no hint about WHY the key failed");
    }
    assert.equal(w.db.rpcCount("load_ad_candidates"), 0);
    assert.equal(w.db.rpcCount("record_ad_serve"), 0);
    assert.equal(w.db.serveLog.length, 0);
  });

  it("revoking or suspending applies at once, and re-activating restores access", async () => {
    const w = world();
    w.db.addAd(w.advertiserId, { totalBudget: 100 });
    assert.equal((await match({ topic: "gaming" })).status, 200);
    w.db.setPublisherStatus(w.publisherId, "suspended");
    assert.equal((await match({ topic: "gaming" })).status, 401);
    w.db.setPublisherStatus(w.publisherId, "active");
    assert.equal((await match({ topic: "gaming" })).json.fill, true);
    w.db.revokeKey(KEY);
    assert.equal((await match({ topic: "gaming" })).status, 401);
  });

  it("the serve is credited to the key's own publisher; a publisher id sent by the caller is rejected, not trusted", async () => {
    const w = world();
    const other = w.db.addPublisher();
    w.db.addKey(other.id, KEY_B);
    w.db.addAd(w.advertiserId, { totalBudget: 100 });
    const spoof = await match({ topic: "gaming", publisher_id: other.id });
    assert.equal(spoof.status, 400);
    assert.equal(spoof.json.reason, "unknown_field");
    assert.equal(w.db.serveLog.length, 0);

    assert.equal((await match({ topic: "gaming" }, KEY_B)).json.fill, true);
    assert.equal((await match({ topic: "gaming" }, KEY)).json.fill, true);
    assert.equal(w.db.servesFor(other.id).length, 1);
    assert.equal(w.db.servesFor(w.publisherId).length, 1);
  });

  it("rate limit is per key: the next call after the limit is 429 (no candidate load), another publisher is unaffected, and the window resets", async () => {
    const w = world();
    w.db.rateLimitPerMinute = 3;
    const other = w.db.addPublisher();
    w.db.addKey(other.id, KEY_B);
    w.db.addAd(w.advertiserId, { totalBudget: 100 });
    for (let i = 0; i < 3; i++) assert.equal((await match({ topic: "gaming" })).status, 200);
    const loadsBefore = w.db.rpcCount("load_ad_candidates");
    const limited = await match({ topic: "gaming" });
    assert.equal(limited.status, 429);
    assert.equal(limited.json.error, "rate_limited");
    assert.equal(limited.headers.get("retry-after"), "60");
    assert.equal(w.db.rpcCount("load_ad_candidates"), loadsBefore);
    assert.equal((await match({ topic: "gaming" }, KEY_B)).status, 200);
    w.db.advanceMinutes(1);
    assert.equal((await match({ topic: "gaming" })).status, 200);
  });
});

// ===========================================================================================================================
describe("day 14 part 4 / 4: contextual ad matching", () => {
  it("the ad whose campaign category matches the page topic is served, per topic", async () => {
    const w = world();
    const gaming = w.db.addAd(w.advertiserId, { category: "gaming", headline: adText("gaming"), totalBudget: 100 });
    const travel = w.db.addAd(w.advertiserId, { category: "travel", headline: adText("travel"), totalBudget: 100 });
    assert.equal(((await match({ topic: "gaming" })).json.ad as { id: string }).id, gaming.creativeId);
    assert.equal(((await match({ topic: "travel" })).json.ad as { id: string }).id, travel.creativeId);
    assert.deepEqual(w.db.serveLog.map((x) => x.topic), ["gaming", "travel"]);
  });

  it("an alias topic (games) is matched and recorded as the canonical category (gaming)", async () => {
    const w = world();
    const gaming = w.db.addAd(w.advertiserId, { category: "gaming" });
    const res = await match({ topic: "games" });
    assert.equal((res.json.ad as { id: string }).id, gaming.creativeId);
    assert.equal(w.db.serveLog[0].topic, "gaming");
  });

  it("no ad in the topic => no-fill, even though other categories have eligible ads (no off-topic ad is shown)", async () => {
    const w = world();
    w.db.addAd(w.advertiserId, { category: "travel", headline: adText("travel") });
    const res = await match({ topic: "gaming" });
    assert.equal(res.text, '{"fill":false}');
    assert.equal(res.text.includes("travel"), false);
    assert.equal(w.db.serveLog.length, 0);
  });

  it("fallback_topics are tried only when the main topic has no ad", async () => {
    const w = world();
    const travel = w.db.addAd(w.advertiserId, { category: "travel", totalBudget: 100 });
    const viaFallback = await match({ topic: "gaming", fallback_topics: ["travel"] });
    assert.equal((viaFallback.json.ad as { id: string }).id, travel.creativeId);
    assert.equal(w.db.serveLog[0].topic, "travel");

    const gaming = w.db.addAd(w.advertiserId, { category: "gaming", totalBudget: 100 });
    const primary = await match({ topic: "gaming", fallback_topics: ["travel"] });
    assert.equal((primary.json.ad as { id: string }).id, gaming.creativeId, "main topic wins over fallback");
  });

  it("exclude_ad_ids prefers a different ad (soft exclude: when there is no alternative the same eligible ad may repeat, not no-fill)", async () => {
    const w = world();
    const a = w.db.addAd(w.advertiserId, { headline: adText("A"), totalBudget: 100 });
    const b = w.db.addAd(w.advertiserId, { headline: adText("B"), totalBudget: 100 });
    assert.equal(((await match({ topic: "gaming", exclude_ad_ids: [a.creativeId] })).json.ad as { id: string }).id, b.creativeId);
    assert.equal(((await match({ topic: "gaming", exclude_ad_ids: [b.creativeId] })).json.ad as { id: string }).id, a.creativeId);
    const allExcluded = await match({ topic: "gaming", exclude_ad_ids: [a.creativeId, b.creativeId] });
    assert.equal(allExcluded.json.fill, true, "selection.ts: repeat only when no fresh alternative exists");
    const onlyOther = world();
    const lone = onlyOther.db.addAd(onlyOther.advertiserId, { category: "travel", totalBudget: 100 });
    assert.equal((await match({ topic: "gaming", exclude_ad_ids: [lone.creativeId] })).text, '{"fill":false}', "an excluded ad of another category is still never shown");
  });

  it("a sensitive topic is no-fill and never reaches the candidate query; a free-text prompt is rejected, not read", async () => {
    const w = world();
    w.db.addAd(w.advertiserId, { category: "gaming" });
    const sensitive = await match({ topic: "health" });
    assert.equal(sensitive.text, '{"fill":false}');
    assert.equal(w.db.rpcCount("load_ad_candidates"), 0);
    for (const body of [{ topic: "gaming", prompt: "my private question" }, { topic: "Not A Slug!" }, { topic: 5 }, {}, "not json"]) {
      const res = await match(body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    assert.equal(w.db.serveLog.length, 0);
  });
});

// ===========================================================================================================================
describe("day 14 part 4 / 5: successful serve", () => {
  it("returns exactly fill/sponsored/ad with the 5 public ad fields, no-store, and leaks no internal id", async () => {
    const w = world();
    const { campaignId } = w.db.addAd(w.advertiserId, { headline: adText("ok") });
    const res = await match({ topic: "gaming" });
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.json).sort(), ["ad", "fill", "sponsored"]);
    assert.equal(res.json.fill, true);
    assert.equal(res.json.sponsored, true);
    assert.deepEqual(Object.keys(res.json.ad as object).sort(), [...PUBLIC_AD_FIELDS].sort());
    assert.equal(res.headers.get("x-blisscco-api-version"), "1");
    assert.equal(res.headers.get("cache-control"), "no-store");
    for (const secret of [campaignId, w.publisherId, w.advertiserId, "bsr_", KEY, "bt1.", "bc1."]) assert.equal(res.text.includes(secret), false, secret);
  });

  it("charges exactly one unit on the campaign and writes one serve row for the authenticated publisher", async () => {
    const w = world();
    const { campaignId, creativeId } = w.db.addAd(w.advertiserId, {});
    await match({ topic: "gaming" });
    assert.equal(w.db.spendOf(campaignId), UNIT);
    assert.equal(w.db.serveLog.length, 1);
    assert.equal(w.db.serveLog[0].creativeId, creativeId);
    assert.equal(w.db.serveLog[0].publisherId, w.publisherId);
    assert.match(w.db.serveLog[0].serveRef, SERVE_REF_RE);
    assert.equal(JSON.stringify(w.db.calls).includes(KEY), false, "plain key never goes to the database");
    assert.ok(JSON.stringify(w.db.calls).includes(sha256(KEY)), "only the key hash does");
  });

  it("without opt-in there is no `tracking`; with opt-in a signed token (impression + click) is added; the ad itself is unchanged", async () => {
    const w = world();
    w.db.addAd(w.advertiserId, { totalBudget: 100 });
    const plain = await match({ topic: "gaming" });
    assert.equal("tracking" in plain.json, false);
    const tracked = await match({ topic: "gaming" }, KEY, { "x-blisscco-tracking": "1" });
    assert.deepEqual(tracked.json.ad, plain.json.ad);
    const tracking = tracked.json.tracking as { token: string; expires_at: string; events: string[] };
    assert.deepEqual(Object.keys(tracking).sort(), [...PUBLIC_TRACKING_FIELDS].sort());
    assert.match(tracking.token, /^bt1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.deepEqual(tracking.events, ["impression", "click"]);
    assert.ok(Date.parse(tracking.expires_at) > Date.now());
    // Abhi ka sach: click ref match response me nahi aata (DAY12-PROMPT5-PART3-CLICK.md). Jab ye feature aaye, ye line jaan-boojh kar update karni hai.
    assert.equal(tracked.text.includes("bc1."), false);
  });

  it("tracking opt-in with no server secret still serves the ad (just without `tracking`); a bad opt-in header is 400 and serves nothing", async () => {
    const w = world();
    w.db.addAd(w.advertiserId, { totalBudget: 100 });
    delete process.env.AD_TRACKING_SECRET;
    const noSecret = await match({ topic: "gaming" }, KEY, { "x-blisscco-tracking": "1" });
    assert.equal(noSecret.status, 200);
    assert.equal(noSecret.json.fill, true);
    assert.equal("tracking" in noSecret.json, false);
    const before = w.db.serveLog.length;
    const bad = await match({ topic: "gaming" }, KEY, { "x-blisscco-tracking": "2" });
    assert.equal(bad.status, 400);
    assert.equal(w.db.serveLog.length, before);
  });

  it("the same Idempotency-Key is charged once and returns the same ad", async () => {
    const w = world();
    const { campaignId } = w.db.addAd(w.advertiserId, { totalBudget: 100 });
    const headers = { "idempotency-key": "retry-key-0001" };
    const first = await match({ topic: "gaming" }, KEY, headers);
    const second = await match({ topic: "gaming" }, KEY, headers);
    assert.deepEqual(second.json.ad, first.json.ad);
    assert.equal(w.db.serveLog.length, 1);
    assert.equal(w.db.spendOf(campaignId), UNIT);
    assert.equal((await match({ topic: "gaming" }, KEY, { "idempotency-key": "bad key!" })).status, 400);
  });
});

// ===========================================================================================================================
describe("day 14 part 4 / 6: no-fill and safe failure on the serve path", () => {
  it("no candidates at all => 200 {fill:false}, nothing recorded, nothing charged, no tracking token even with opt-in", async () => {
    const w = world();
    const res = await match({ topic: "gaming" }, KEY, { "x-blisscco-tracking": "1" });
    assert.equal(res.status, 200);
    assert.equal(res.text, '{"fill":false}');
    assert.equal(w.db.rpcCount("record_ad_serve"), 0);
    assert.equal(w.db.serveLog.length, 0);
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  it("the ad turns ineligible between load and record (database says rejected) => safe no-fill, ad and token NOT shown", async () => {
    const w = world();
    const { campaignId } = w.db.addAd(w.advertiserId, { headline: adText("race") });
    w.db.failRpc.record_ad_serve = { data: { outcome: "rejected" }, error: null };
    const res = await match({ topic: "gaming" }, KEY, { "x-blisscco-tracking": "1" });
    assert.equal(res.status, 200);
    assert.equal(res.text, '{"fill":false}');
    assert.equal(w.db.spendOf(campaignId), 0);
  });

  it("database outage on candidate load or serve record => 503 {fill:false,error:unavailable}; no ad, no token, no database detail in the body", async () => {
    for (const rpc of ["load_ad_candidates", "record_ad_serve", "authorize_publisher_key"]) {
      const w = world();
      w.db.addAd(w.advertiserId, { headline: adText("outage") });
      w.db.failRpc[rpc] = { data: null, error: { code: "XX000", message: "secret internal detail" } };
      const res = await match({ topic: "gaming" }, KEY, { "x-blisscco-tracking": "1" });
      assert.equal(res.status, 503, rpc);
      assert.equal(res.text, '{"fill":false,"error":"unavailable"}', rpc);
      assert.equal(res.text.includes("outage"), false);
      assert.equal(res.text.includes("secret"), false);
      assert.equal(w.db.serveLog.length, 0, rpc);
    }
  });
});

// ===========================================================================================================================
describe("day 14 part 4 / 7: Day 12 impression route (POST /api/v1/ads/impression)", () => {
  async function served(topic = "gaming"): Promise<{ w: World; token: string; serve: ServeLogRow; campaignId: string; creativeId: string }> {
    const w = world();
    const ad = w.db.addAd(w.advertiserId, { category: topic, totalBudget: 100 });
    const { token, serve } = await serveWithTracking(w, topic);
    return { w, token, serve, ...ad };
  }

  it("a valid token records the FIRST impression of that serve (200 recorded) and sends no-store, no campaign/publisher data", async () => {
    const { w, token, serve, campaignId } = await served();
    const res = await impression(token);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { ok: true, status: "recorded" });
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(w.events.impressions.size, 1);
    assert.ok(w.events.impressions.has(serve.serveRef));
    for (const secret of [campaignId, w.publisherId, serve.serveRef]) assert.equal(res.text.includes(secret), false);
  });

  it("duplicates (retry, replay, double callback) are 200 duplicate and write nothing new; five parallel calls make exactly one impression", async () => {
    const { w, token } = await served();
    assert.equal((await impression(token)).json.status, "recorded");
    for (let i = 0; i < 3; i++) {
      const dup = await impression(token);
      assert.equal(dup.status, 200);
      assert.deepEqual(dup.json, { ok: true, status: "duplicate" });
    }
    assert.equal(w.events.impressions.size, 1);

    const fresh = await served();
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => impression(fresh.token)));
    const statuses = results.map((r) => String(r.json.status)).sort();
    assert.deepEqual(statuses, ["duplicate", "duplicate", "duplicate", "duplicate", "recorded"]);
    assert.equal(fresh.w.events.impressions.size, 1);
  });

  it("an Idempotency-Key retry of the serve gives the same token, so its impression is a duplicate (not a second impression)", async () => {
    const w = world();
    w.db.addAd(w.advertiserId, { totalBudget: 100 });
    const headers = { "idempotency-key": "retry-key-0002", "x-blisscco-tracking": "1" };
    const a = await match({ topic: "gaming" }, KEY, headers);
    const b = await match({ topic: "gaming" }, KEY, headers);
    const tokenA = (a.json.tracking as { token: string }).token;
    assert.equal((b.json.tracking as { token: string }).token, tokenA);
    assert.equal((await impression(tokenA)).json.status, "recorded");
    assert.equal((await impression(tokenA)).json.status, "duplicate");
    assert.equal(w.events.impressions.size, 1);
  });

  it("an impression (or any number of them) never changes campaign spend: charge stays on the serve", async () => {
    const { w, token, campaignId } = await served();
    const before = w.db.spendOf(campaignId);
    assert.equal(before, UNIT);
    await impression(token);
    await impression(token);
    assert.equal(w.db.spendOf(campaignId), before);
    assert.equal(w.db.serveLog.length, 1);
    assert.equal(w.db.rpcCount("record_ad_serve"), 1);
  });

  it("invalid tokens (garbage, wrong prefix, tampered, expired, other secret, unknown serve, other publisher) are ALL the same 401 and record nothing", async () => {
    const { w, token, serve } = await served();
    const [head, payload, sig] = token.split(".");
    const flip = (s: string) => s.slice(0, -2) + (s.endsWith("A") ? "B" : "A") + s.slice(-1);
    const twoHoursAgo = Date.now() - 2 * HOUR;
    const bad: Record<string, string> = {
      garbage: "not-a-token",
      wrongPrefix: `bt2.${payload}.${sig}`,
      missingPart: `${head}.${payload}`,
      tamperedSignature: `${head}.${payload}.${flip(sig)}`,
      tamperedPayload: `${head}.${flip(payload)}.${sig}`,
      expired: mintTrackingToken(config!, { serveRef: serve.serveRef, publisherId: serve.publisherId, servedAtMs: twoHoursAgo, nowMs: twoHoursAgo + 1000 })!.token,
      otherSecret: mintTrackingToken(otherConfig!, { serveRef: serve.serveRef, publisherId: serve.publisherId, servedAtMs: Date.now(), nowMs: Date.now() })!.token,
      unknownServe: mintTrackingToken(config!, { serveRef: `bsr_${"0".repeat(40)}`, publisherId: serve.publisherId, servedAtMs: Date.now(), nowMs: Date.now() })!.token,
      otherPublisher: mintTrackingToken(config!, { serveRef: serve.serveRef, publisherId: w.db.addPublisher().id, servedAtMs: serve.servedAtMs, nowMs: Date.now() })!.token,
      clickRefAsToken: refFor(serve),
    };
    for (const [name, value] of Object.entries(bad)) {
      const res = await impression(value);
      assert.equal(res.status, 401, name);
      assert.equal(res.text, UNAUTHORIZED, `${name}: same body, no reason leaked`);
    }
    assert.equal(w.events.impressions.size, 0);
    assert.equal(w.events.count("record_ad_impression"), 0, "bad tokens are stopped before the atomic writer");
    assert.equal((await impression(token)).json.status, "recorded", "the real token still works afterwards");
  });

  it("request-shape errors: click/serve event, extra fields, bad JSON, wrong content type, oversize body, missing token; nothing is looked up", async () => {
    const { w, token } = await served();
    const post = async (body: unknown, headers: Record<string, string> = {}) => toHttp(await impressionRoute.POST(impressionRequest(body, headers)));
    assert.equal((await post({ token, event: "click" })).json.reason, "invalid_event");
    assert.equal((await post({ token, event: "serve" })).json.reason, "invalid_event");
    assert.equal((await post({ token, event: "impression", campaign_id: "x" })).json.reason, "unknown_field");
    assert.equal((await post({ token, event: "impression", publisher_id: "x" })).json.reason, "unknown_field");
    assert.equal((await post({ event: "impression" })).json.reason, "invalid_token");
    assert.equal((await post({ token: "", event: "impression" })).json.reason, "invalid_token");
    assert.equal((await post("{not json")).json.reason, "invalid_json");
    assert.equal((await post("[]")).json.reason, "invalid_body");
    for (const r of [await post({ token, event: "click" }), await post("{not json")]) assert.equal(r.status, 400);
    assert.equal((await post({ token, event: "impression" }, { "content-type": "text/plain" })).status, 415);
    assert.equal((await post({ token, event: "impression" }, { "content-length": "99999" })).status, 413);
    assert.equal((await post({ token: "a".repeat(2000), event: "impression" })).status, 413);
    assert.equal(w.events.calls.length, 0, "shape errors never reach the database");
    assert.equal((impressionRoute as Record<string, unknown>).GET, undefined, "impression route is POST only");
  });

  it("an impression from an IP that is over the rate limit is 429 before any database call; repeated bad tokens trip the failure guard", async () => {
    const { w, token } = await served();
    const requestGuard = createIpGuard(100);
    const failureGuard = createIpGuard(2);
    const ip = { "x-forwarded-for": "203.0.113.50" };
    const send = async (t: string) => toHttp(await handleImpressionPost(impressionRequest({ token: t, event: "impression" }, ip), { requestGuard, failureGuard }));
    assert.equal((await send("bad-token-1")).status, 401);
    assert.equal((await send("bad-token-2")).status, 401);
    const callsBefore = w.events.calls.length;
    const blocked = await send(token);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get("retry-after"), "60");
    assert.equal(w.events.calls.length, callsBefore);
    assert.equal(w.events.impressions.size, 0);
  });

  it("safe failure: missing secret, lookup error, record error, thrown errors and garbage database replies are 503 (never recorded); retry afterwards works", async () => {
    const { w, token } = await served();
    const noTrace = (res: Http) => {
      assert.equal(res.status, 503);
      assert.equal(res.text, '{"error":"unavailable"}');
      assert.equal(res.text.includes("secret"), false);
    };

    delete process.env.AD_TRACKING_SECRET;
    noTrace(await impression(token));
    process.env.AD_TRACKING_SECRET = SECRET;

    w.events.fail.lookup_serve_for_event = { data: null, error: { code: "XX000", message: "secret internal detail" } };
    noTrace(await impression(token));
    w.events.fail.lookup_serve_for_event = { data: { outcome: "weird" }, error: null };
    noTrace(await impression(token));
    delete w.events.fail.lookup_serve_for_event;

    w.events.throwOn.add("lookup_serve_for_event");
    noTrace(await impression(token));
    w.events.throwOn.delete("lookup_serve_for_event");

    w.events.fail.record_ad_impression = { data: null, error: { code: "40001", message: "secret internal detail" } };
    noTrace(await impression(token));
    w.events.fail.record_ad_impression = { data: { outcome: "recorded-ish" }, error: null };
    noTrace(await impression(token));
    w.events.throwOn.add("record_ad_impression");
    noTrace(await impression(token));
    w.events.throwOn.delete("record_ad_impression");
    delete w.events.fail.record_ad_impression;

    assert.equal(w.events.impressions.size, 0, "no failure path ever counts an impression");
    assert.equal((await impression(token)).json.status, "recorded", "retry after the outage is safe");
    assert.equal((await impression(token)).json.status, "duplicate");

    const logText = logged.join("\n");
    assert.equal(logText.includes(token), false, "token never logged");
    assert.equal(logText.includes("bsr_"), false, "serve ref never logged");
    assert.equal(logText.includes("secret internal detail"), false, "database message never logged");
  });

  it("a database 'rejected' (serve older than 24h, or not this publisher's) is the same 401 as a bad token", async () => {
    const { w, token } = await served();
    w.events.fail.record_ad_impression = { data: { outcome: "rejected" }, error: null };
    const res = await impression(token);
    assert.equal(res.status, 401);
    assert.equal(res.text, UNAUTHORIZED);
    assert.equal(w.events.impressions.size, 0);
  });
});

// ===========================================================================================================================
describe("day 14 part 4 / 8: Day 12 click route (GET /api/v1/ads/click?ref=...)", () => {
  const DEST = "https://example.com/landing"; // FakeAdDb ka default destination

  async function served(): Promise<{ w: World; serve: ServeLogRow; token: string; campaignId: string; creativeId: string }> {
    const w = world();
    const ad = w.db.addAd(w.advertiserId, { totalBudget: 100 });
    const { token, serve } = await serveWithTracking(w);
    return { w, serve, token, ...ad };
  }

  it("a valid ref after an impression redirects (302) to the database destination and counts the FIRST click, with safe headers", async () => {
    const { w, serve, token } = await served();
    await impression(token);
    const res = await click(refFor(serve));
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), DEST);
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.equal(w.events.clicks.size, 1);
  });

  it("a duplicate click still redirects but writes nothing new; clicks never change spend", async () => {
    const { w, serve, token, campaignId } = await served();
    await impression(token);
    const ref = refFor(serve);
    const spend = w.db.spendOf(campaignId);
    for (let i = 0; i < 3; i++) {
      const res = await click(ref);
      assert.equal(res.status, 302);
      assert.equal(res.headers.get("location"), DEST);
    }
    assert.equal(w.events.clicks.size, 1);
    assert.equal(w.db.spendOf(campaignId), spend);
    assert.equal(w.db.serveLog.length, 1);
  });

  it("a click BEFORE any impression redirects the user but is not counted (D4); it counts once the impression exists", async () => {
    const { w, serve, token } = await served();
    const ref = refFor(serve);
    const early = await click(ref);
    assert.equal(early.status, 302);
    assert.equal(w.events.clicks.size, 0);
    await impression(token);
    assert.equal((await click(ref)).status, 302);
    assert.equal(w.events.clicks.size, 1);
  });

  it("invalid refs (garbage, tracking token, tampered, expired, other secret, unknown serve, other publisher, other creative) are the SAME 404 with no redirect and no click", async () => {
    const { w, serve, token } = await served();
    await impression(token);
    const good = refFor(serve);
    const [head, payload, sig] = good.split(".");
    const flip = (s: string) => s.slice(0, -2) + (s.endsWith("A") ? "B" : "A") + s.slice(-1);
    const twoHoursAgo = Date.now() - 2 * HOUR;
    const other = w.db.addAd(w.advertiserId, {});
    const bad: Record<string, string> = {
      garbage: "not-a-ref",
      trackingTokenAsRef: token,
      tamperedSignature: `${head}.${payload}.${flip(sig)}`,
      tamperedPayload: `${head}.${flip(payload)}.${sig}`,
      expired: refFor(serve, { servedAtMs: twoHoursAgo, nowMs: twoHoursAgo + 1000 }),
      otherSecret: refFor(serve, { useOtherSecret: true }),
      unknownServe: refFor({ ...serve, serveRef: `bsr_${"0".repeat(40)}` }),
      otherPublisher: refFor(serve, { publisherId: w.db.addPublisher().id }),
      otherCreative: refFor(serve, { creativeId: other.creativeId }),
    };
    let first: string | null = null;
    for (const [name, value] of Object.entries(bad)) {
      const res = await click(value);
      assert.equal(res.status, 404, name);
      assert.equal(res.headers.get("location"), null, `${name}: never a redirect`);
      assert.equal(res.text, '{"error":"not_found"}', name);
      first ??= res.text;
      assert.equal(res.text, first, `${name}: same body, no reason leaked`);
    }
    assert.equal(w.events.clicks.size, 0);
  });

  it("query strictness: only `ref`; a destination-like parameter, a second ref, an empty or missing ref are 400 and never reach the database", async () => {
    const { w, serve } = await served();
    const ref = encodeURIComponent(refFor(serve));
    const get = async (query: string) => toHttp(await clickRoute.GET(clickRequest(query)));
    const cases: Record<string, [string, string]> = {
      extraUrl: [`?ref=${ref}&url=https://evil.example/`, "unexpected_parameter"],
      extraRedirect: [`?ref=${ref}&redirect=https://evil.example/`, "unexpected_parameter"],
      onlyUrl: ["?url=https://evil.example/", "unexpected_parameter"],
      twoRefs: [`?ref=${ref}&ref=${ref}`, "unexpected_parameter"],
      emptyRef: ["?ref=", "invalid_ref"],
      noQuery: ["", "missing_ref"],
    };
    for (const [name, [query, reason]] of Object.entries(cases)) {
      const res = await get(query);
      assert.equal(res.status, 400, name);
      assert.equal(res.json.reason, reason, name);
      assert.equal(res.headers.get("location"), null, name);
    }
    assert.equal(w.events.calls.length, 0);
  });

  it("only GET counts: HEAD, POST, PUT, PATCH, DELETE are 405 with Allow: GET and touch nothing", async () => {
    const { w, serve } = await served();
    const before = w.events.calls.length;
    const handlers = { HEAD: clickRoute.HEAD, POST: clickRoute.POST, PUT: clickRoute.PUT, PATCH: clickRoute.PATCH, DELETE: clickRoute.DELETE };
    for (const [method, handler] of Object.entries(handlers)) {
      const res = await toHttp(await handler());
      assert.equal(res.status, 405, method);
      assert.equal(res.headers.get("allow"), "GET", method);
    }
    assert.equal(w.events.calls.length, before);
    assert.equal(w.events.clicks.size, 0);
    void serve;
  });

  it("a browser prefetch/prerender is 204: no click, no redirect, no database call", async () => {
    const { w, serve } = await served();
    const ref = refFor(serve);
    for (const headers of <Record<string, string>[]>[{ "sec-purpose": "prefetch" }, { purpose: "prefetch" }, { "next-router-prefetch": "1" }]) {
      const res = await click(ref, headers);
      assert.equal(res.status, 204, JSON.stringify(headers));
      assert.equal(res.headers.get("location"), null);
    }
    assert.equal(w.events.calls.length, 0);
    assert.equal(w.events.clicks.size, 0);
  });

  it("if the creative/campaign/advertiser is no longer eligible after the serve, there is NO redirect and NO click (404)", async () => {
    const mutations: Record<string, (w: World, ids: { creativeId: string; campaignId: string }) => void> = {
      creativePaused: (w, ids) => w.db.setCreativeStatus(ids.creativeId, "paused"),
      creativeRejected: (w, ids) => w.db.setCreativeStatus(ids.creativeId, "rejected"),
      campaignPaused: (w, ids) => w.db.setCampaignStatus(ids.campaignId, "paused"),
      advertiserSuspended: (w) => {
        for (const a of internals(w.db).advertisers.values()) a.status = "suspended";
      },
    };
    for (const [name, mutate] of Object.entries(mutations)) {
      const { w, serve, token, creativeId, campaignId } = await served();
      await impression(token);
      mutate(w, { creativeId, campaignId });
      const res = await click(refFor(serve));
      assert.equal(res.status, 404, name);
      assert.equal(res.headers.get("location"), null, name);
      assert.equal(w.events.clicks.size, 0, name);
    }
  });

  it("the destination always comes from the database row and is re-checked: an unsafe stored URL is never redirected to and never counted", async () => {
    const unsafe = ["http://example.com/plain", "javascript:alert(1)", "https://localhost/x", "https://127.0.0.1/x", "https://user:pw@example.com/", "https://example.com/has space", `https://example.com/${"a".repeat(2100)}`, ""];
    for (const url of unsafe) {
      const { w, serve, token, creativeId } = await served();
      await impression(token);
      internals(w.db).creatives.get(creativeId)!.destinationUrl = url;
      const res = await click(refFor(serve));
      assert.equal(res.status, 404, url.slice(0, 40));
      assert.equal(res.headers.get("location"), null, url.slice(0, 40));
      assert.equal(w.events.clicks.size, 0, url.slice(0, 40));
    }
    const { w, serve, token, creativeId } = await served();
    await impression(token);
    internals(w.db).creatives.get(creativeId)!.destinationUrl = "https://example.org/new-page";
    assert.equal((await click(refFor(serve))).headers.get("location"), "https://example.org/new-page", "redirect follows the current database row");
    assert.equal(w.events.clicks.size, 1);
  });

  it("a click from an IP over the rate limit is 429 before any database call; bad refs trip the failure guard", async () => {
    const { w, serve, token } = await served();
    await impression(token);
    const requestGuard = createIpGuard(100);
    const failureGuard = createIpGuard(2);
    const ip = { "x-forwarded-for": "203.0.113.77" };
    const send = async (ref: string) => toHttp(await handleClickGet(clickRequest(`?ref=${encodeURIComponent(ref)}`, ip), { requestGuard, failureGuard }));
    assert.equal((await send("bad-ref-1")).status, 404);
    assert.equal((await send("bad-ref-2")).status, 404);
    const callsBefore = w.events.calls.length;
    const blocked = await send(refFor(serve));
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get("retry-after"), "60");
    assert.equal(blocked.headers.get("location"), null);
    assert.equal(w.events.calls.length, callsBefore);
    assert.equal(w.events.clicks.size, 0);
  });

  it("safe failure: missing secret, lookup error, record error, thrown errors and garbage replies are 503 with NO redirect and NO click; retry afterwards works", async () => {
    const { w, serve, token } = await served();
    await impression(token);
    const ref = refFor(serve);
    const down = (res: Http) => {
      assert.equal(res.status, 503);
      assert.equal(res.text, '{"error":"unavailable"}');
      assert.equal(res.headers.get("location"), null);
      assert.equal(res.text.includes("secret"), false);
    };

    delete process.env.AD_TRACKING_SECRET;
    down(await click(ref));
    process.env.AD_TRACKING_SECRET = SECRET;

    w.events.fail.lookup_serve_for_click = { data: null, error: { code: "XX000", message: "secret internal detail" } };
    down(await click(ref));
    w.events.fail.lookup_serve_for_click = { data: { outcome: "found", publisher_id: "nope" }, error: null };
    down(await click(ref));
    delete w.events.fail.lookup_serve_for_click;
    w.events.throwOn.add("lookup_serve_for_click");
    down(await click(ref));
    w.events.throwOn.delete("lookup_serve_for_click");

    w.events.fail.record_ad_click = { data: null, error: { code: "40001", message: "secret internal detail" } };
    down(await click(ref));
    w.events.fail.record_ad_click = { data: { outcome: "recorded" }, error: null }; // destination_url missing => sahi nahi maana jaata
    down(await click(ref));
    w.events.throwOn.add("record_ad_click");
    down(await click(ref));
    w.events.throwOn.delete("record_ad_click");
    delete w.events.fail.record_ad_click;

    assert.equal(w.events.clicks.size, 0, "no failure path ever counts a click");
    const retry = await click(ref);
    assert.equal(retry.status, 302, "retry after the outage works");
    assert.equal(w.events.clicks.size, 1);

    const logText = logged.join("\n");
    assert.equal(logText.includes(ref), false, "ref never logged");
    assert.equal(logText.includes("bsr_"), false, "serve ref never logged");
    assert.equal(logText.includes("secret internal detail"), false, "database message never logged");
    assert.equal(logText.includes(DEST), false, "destination URL never logged");
  });

  it("database 'rejected' (serve too old / mismatch) is a 404, 'ineligible' is a 404, 'not_counted' still redirects", async () => {
    const { w, serve } = await served();
    const ref = refFor(serve);
    w.events.fail.record_ad_click = { data: { outcome: "rejected" }, error: null };
    assert.equal((await click(ref)).status, 404);
    w.events.fail.record_ad_click = { data: { outcome: "ineligible" }, error: null };
    assert.equal((await click(ref)).status, 404);
    w.events.fail.record_ad_click = { data: { outcome: "not_counted", destination_url: DEST }, error: null };
    const notCounted = await click(ref);
    assert.equal(notCounted.status, 302);
    assert.equal(notCounted.headers.get("location"), DEST);
    assert.equal(w.events.clicks.size, 0);
  });
});
