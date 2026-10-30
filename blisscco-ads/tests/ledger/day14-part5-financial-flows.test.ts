import { FinancialModel, resetSession, session } from "./financial-model"; // SABSE PEHLE: nakli session / next/cache / supabase server modules lagte hain
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as matchRoute from "@/app/api/v1/ads/match/route";
import * as impressionRoute from "@/app/api/v1/ads/impression/route";
import * as clickRoute from "@/app/api/v1/ads/click/route";
import { requestPayout } from "@/app/dashboard/publisher/payout-actions";
import { adminPayoutAction } from "@/app/dashboard/admin/payout-actions";
import { addLedgerAdjustment, reverseLedgerEntry } from "@/lib/ledger/ledger-db";
import { fetchAdminPayoutRequests, fetchMyPayoutRequests, fetchMyPayoutSummary } from "@/lib/payouts/data";
import { mintClickRef } from "@/lib/ads/click-ref";
import { SERVE_REF_RE, readTrackingConfig } from "@/lib/ads/tracking-token";
import { utcToday } from "@/lib/campaigns/validation";
import { FakeAdDb, FakeSqlError, makeKey, type ServeLogRow } from "../ads/fake-ad-db";

// Day 14 Part 5: Day 13 ke paise ke flows (ledger, publisher earnings, payout) + "kuch bhi fail / retry / duplicate ho toh paisa DOBARA nahi banta".
//
// Rasta: asli TypeScript (match / impression / click routes, ledger service, payout server actions, payout data helpers) -> nakla database.
// Nakla database = FakeAdDb (serve / budget) + FinancialModel (ledger + payout SQL ka model, tests/ledger/financial-model.ts).
//
// LIMIT (saaf): ye SQL ka MODEL hai, SQL khud nahi. Postgres ka asli lock / race / trigger behaviour yahan SAABIT NAHI hota; wo SQL tests
// (supabase/sql/day-13-*-tests.sql, denim TEST project) me hai. "Parallel" tests yahan ek hi Node process me chalte hain (serial execution),
// isliye wo TypeScript + niyamon ka sahi hona dikhate hain, database lock ka nahi.
// Asli Supabase / production kabhi nahi chhuta. Koi SQL nahi chali. Saari keys / ids nakli.

const SECRET = "k7f2-0123456789-abcdefghijklmnopqrstuvwxyz-primary";
const BASE = "https://blisscco.test";
const UNIT_USD = 0.002;
const UNIT_U = 20n; // 0.0020 USD = 20 units (1 unit = 0.0001)
const PUB_U = 14n; // 70% of 20, truncated
const PLAT_U = 6n; // remainder
const HOUR = 3_600_000;

const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
const realConsoleError = console.error;
const ENV_NAMES = ["AD_TRACKING_SECRET", "AD_TRACKING_SECRET_PREVIOUS", "AD_TRACKING_TTL_SECONDS"] as const;
const savedEnv: Record<string, string | undefined> = {};
let logged: string[] = [];

type Reply = { data: unknown; error: { code?: string; message?: string } | null };

// ===========================================================================================================================
// Nakla event store: impression / click (day-12-7, day-12-10). Charge se koi lena-dena nahi; yahan sirf wahi 4 rpc.
type Internals = {
  creatives: Map<string, { status: string; destinationUrl: string; campaignId: string; advertiserId: string }>;
  campaigns: Map<string, { status: string; startDate: string; endDate: string | null }>;
  advertisers: Map<string, { status: string; profileStatus: string }>;
};
const TRACKING_RPCS = ["lookup_serve_for_event", "record_ad_impression", "lookup_serve_for_click", "record_ad_click"];

class EventStore {
  impressions = new Map<string, number>();
  clicks = new Map<string, number>();
  fail: Record<string, Reply | undefined> = {};
  constructor(private readonly db: FakeAdDb) {}

  private serve(ref: unknown): ServeLogRow | undefined {
    return typeof ref === "string" && SERVE_REF_RE.test(ref) ? this.db.serveLog.find((s) => s.serveRef === ref) : undefined;
  }
  private clickTarget(creativeId: string): string | null {
    const i = this.db as unknown as Internals;
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
        return ok({ outcome: "found", publisher_id: s.publisherId, creative_id: s.creativeId, served_at: new Date(s.servedAtMs).toISOString(), destination_url: dest, eligible: dest !== null });
      }
      case "record_ad_impression": {
        if (!s || s.publisherId !== args.p_publisher_id || Date.now() > s.servedAtMs + 24 * HOUR) return ok({ outcome: "rejected" });
        if (this.impressions.has(s.serveRef)) return ok({ outcome: "duplicate" });
        this.impressions.set(s.serveRef, Date.now());
        return ok({ outcome: "recorded" });
      }
      case "record_ad_click": {
        if (!s || s.publisherId !== args.p_publisher_id || s.creativeId !== args.p_creative_id || Date.now() > s.servedAtMs + 24 * HOUR) return ok({ outcome: "rejected" });
        const dest = this.clickTarget(s.creativeId);
        if (dest === null) return ok({ outcome: "ineligible" });
        if (!this.impressions.has(s.serveRef)) return ok({ outcome: "not_counted", destination_url: dest });
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
type World = {
  db: FakeAdDb;
  m: FinancialModel;
  events: EventStore;
  a: { publisherId: string; profileId: string; key: string };
  b: { publisherId: string; profileId: string; key: string };
  adminId: string;
  advertiserId: string;
};

function world(opts: { bps?: number | null; enabled?: boolean } = {}): World {
  const db = new FakeAdDb();
  db.nowMs = Date.now();
  const m = new FinancialModel(db);
  m.shareBps = opts.bps === undefined ? 7000 : opts.bps;
  m.ledgerEnabled = opts.enabled ?? true;
  const events = new EventStore(db);
  const a = m.addPublisher("a");
  const b = m.addPublisher("b");
  const adminId = m.addAdmin();
  const advertiser = db.addAdvertiser();
  const service = m.serviceClient();
  globals.__TEST_SUPABASE__ = {
    rpc: async (name: string, args: Record<string, unknown> = {}) => (TRACKING_RPCS.includes(name) ? events.rpc(name, args) : service.rpc(name, args)),
  };
  return { db, m, events, a, b, adminId, advertiserId: advertiser.id };
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
  resetSession();
});
afterEach(() => {
  for (const n of ENV_NAMES) {
    if (savedEnv[n] === undefined) delete process.env[n];
    else process.env[n] = savedEnv[n];
  }
  console.error = realConsoleError;
  delete globals.__TEST_SUPABASE__;
  resetSession();
});

// ----- HTTP helpers ---------------------------------------------------------------------------------------------------------
type Http = { status: number; text: string; json: Record<string, unknown> };
async function toHttp(res: Response): Promise<Http> {
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = {};
  }
  return { status: res.status, text, json };
}
async function match(body: unknown, key: string | null, headers: Record<string, string> = {}): Promise<Http> {
  const h: Record<string, string> = { "content-type": "application/json", ...headers };
  if (key !== null) h.authorization = `Bearer ${key}`;
  return toHttp(await matchRoute.POST(new Request(`${BASE}/api/v1/ads/match`, { method: "POST", headers: h, body: typeof body === "string" ? body : JSON.stringify(body) })));
}
const serve = (w: World, who: { key: string } = w.a, headers: Record<string, string> = {}): Promise<Http> => match({ topic: "gaming" }, who.key, headers);
const impression = async (token: string): Promise<Http> =>
  toHttp(await impressionRoute.POST(new Request(`${BASE}/api/v1/ads/impression`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, event: "impression" }) })));
const click = async (ref: string): Promise<Http> =>
  toHttp(await clickRoute.GET(new Request(`${BASE}/api/v1/ads/click?ref=${encodeURIComponent(ref)}`, { method: "GET" })));

const config = readTrackingConfig({ AD_TRACKING_SECRET: SECRET });
if (!config) throw new Error("test: tracking config must be valid");
function refFor(s: ServeLogRow): string {
  const grant = mintClickRef(config!, { serveRef: s.serveRef, publisherId: s.publisherId, creativeId: s.creativeId, servedAtMs: s.servedAtMs, nowMs: Date.now() });
  assert.ok(grant, "click ref expected");
  return grant.ref;
}
async function serveWithTracking(w: World, who: { key: string } = w.a): Promise<{ token: string; serve: ServeLogRow }> {
  const res = await serve(w, who, { "x-blisscco-tracking": "1" });
  assert.equal(res.status, 200, res.text);
  const token = (res.json.tracking as { token?: string } | undefined)?.token;
  assert.ok(token, "tracking token expected");
  const row = w.db.serveLog[w.db.serveLog.length - 1];
  assert.ok(row);
  return { token, serve: row };
}

// ----- money snapshots ---------------------------------------------------------------------------------------------------------
const spendU = (w: World, campaignId: string): bigint => BigInt(Math.round(w.db.spendOf(campaignId) * 10_000));
type Snap = { serves: number; entries: number; charge: bigint; earning: bigint; platform: bigint; spend: bigint; payouts: number };
const snap = (w: World, campaignId: string): Snap => ({
  serves: w.db.serveLog.length,
  entries: w.m.entries.length,
  charge: w.m.sum((e) => e.type === "advertiser_charge"),
  earning: w.m.sum((e) => e.type === "publisher_earning"),
  platform: w.m.sum((e) => e.type === "platform_revenue"),
  spend: spendU(w, campaignId),
  payouts: w.m.payouts.length,
});
/** Sab paise ke figures bilkul pehle jaise? (serves bhi, kyunki serve = charge.) */
function assertUnchanged(before: Snap, after: Snap, why: string): void {
  assert.deepEqual(after, before, why);
}

/**
 * Poore khate ka hisab: har serve par EK charge (amount = budget unit), usi ka batwara (earning + platform = charge),
 * koi key do baar nahi, aur advertiser_charge ka jod = campaign ka kul kharch.
 */
function assertReconciles(w: World, campaignId: string, shareBps: number | null = 7000): void {
  const keys = w.m.entries.map((e) => e.key);
  assert.equal(new Set(keys).size, keys.length, "no ledger key is used twice");
  const campaignServes = w.db.serveLog.filter((s) => s.campaignId === campaignId);
  for (const s of campaignServes) {
    const rows = w.m.serveEntries(s.serveRef);
    const charges = rows.filter((e) => e.type === "advertiser_charge");
    assert.equal(charges.length, 1, `exactly one charge for ${s.serveRef}`);
    assert.equal(charges[0].amount, UNIT_U);
    assert.equal(rows.filter((e) => e.type === "publisher_earning").length, shareBps === null ? 0 : 1);
    assert.equal(rows.filter((e) => e.type === "platform_revenue").length, shareBps === null ? 0 : 1);
    const split = rows.filter((e) => e.type !== "advertiser_charge").reduce((x, e) => x + e.amount, 0n);
    assert.equal(split, shareBps === null ? 0n : UNIT_U, "earning + platform == charge");
  }
  const orphan = w.m.serveEntries().filter((e) => !w.db.serveLog.some((s) => s.serveRef === e.sourceRef));
  assert.equal(orphan.length, 0, "no ledger entry without a recorded serve");
  assert.equal(w.m.sum((e) => e.type === "advertiser_charge" && e.campaignId === campaignId), spendU(w, campaignId), "charges == campaign spend");
}

const reqKey = (n: number): string => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
function payForm(amount: string, key: string, extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("amount", amount);
  fd.set("requestKey", key);
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}
const askPayout = (amount: string, key: string, extra: Record<string, string> = {}) => requestPayout({ status: "idle" }, payForm(amount, key, extra));
function adminForm(id: string, action: string, reason?: string): FormData {
  const fd = new FormData();
  fd.set("id", id);
  fd.set("action", action);
  if (reason !== undefined) fd.set("reason", reason);
  return fd;
}
const adminAct = (id: string, action: string, reason?: string) => adminPayoutAction({ status: "idle" }, adminForm(id, action, reason));
const reversal = (w: World, entryId: number, key = "reverse-key-0001", actor = w.adminId) => reverseLedgerEntry({ actorProfileId: actor, entryId, idempotencyKey: key, reason: "Operator mistake" });
const adjust = (w: World, amount: string, key: string, publisherId: string, actor = w.adminId) =>
  addLedgerAdjustment({ actorProfileId: actor, account: "publisher", amount, idempotencyKey: key, reason: "Manual correction", publisherId });

/** N serves publisher `who` ke naam par (ledger ON ho toh kamai banti hai). */
async function serveN(w: World, n: number, who: { key: string } = w.a): Promise<void> {
  for (let i = 0; i < n; i += 1) assert.equal((await serve(w, who)).status, 200);
}

// ===========================================================================================================================
describe("day 14 part 5 / 1: serve writes the ledger once, and duplicates of any financial write are harmless", () => {
  it("one serve = ONE charge (0.0020) + ONE publisher earning (0.0014) + ONE platform revenue (0.0006); the split adds up to the charge exactly", async () => {
    const w = world();
    const { campaignId } = w.db.addAd(w.advertiserId, { totalBudget: 10 });
    assert.equal((await serve(w)).status, 200);
    assert.equal(w.m.entries.length, 3);
    assert.deepEqual(w.m.entriesOf().map((e) => [e.type, e.account, e.amount]), [
      ["advertiser_charge", "advertiser", UNIT_U],
      ["publisher_earning", "publisher", PUB_U],
      ["platform_revenue", "platform", PLAT_U],
    ]);
    assertReconciles(w, campaignId);
  });

  it("the earning goes to the publisher whose key served the ad (never to another publisher), and the charge uses the same unit the budget lost", async () => {
    const w = world();
    const { campaignId } = w.db.addAd(w.advertiserId, { totalBudget: 10 });
    await serveN(w, 2, w.a);
    await serveN(w, 1, w.b);
    assert.equal(w.m.publisherBalance(w.a.publisherId), PUB_U * 2n);
    assert.equal(w.m.publisherBalance(w.b.publisherId), PUB_U);
    assert.equal(spendU(w, campaignId), UNIT_U * 3n);
    assertReconciles(w, campaignId);
  });

  it("ledger OFF (default) writes no entry at all, but the budget is still charged; share NOT set writes only the advertiser charge", async () => {
    const off = world({ enabled: false });
    const o = off.db.addAd(off.advertiserId, { totalBudget: 10 });
    await serveN(off, 2);
    assert.equal(off.m.entries.length, 0);
    assert.equal(spendU(off, o.campaignId), UNIT_U * 2n);

    const noShare = world({ bps: null });
    const n = noShare.db.addAd(noShare.advertiserId, { totalBudget: 10 });
    await serveN(noShare, 2);
    assert.deepEqual(noShare.m.entriesOf().map((e) => e.type), ["advertiser_charge", "advertiser_charge"]);
    assert.equal(noShare.m.publisherBalance(noShare.a.publisherId), 0n, "no share defined => no publisher earning invented");
    assertReconciles(noShare, n.campaignId, null);
  });

  it("re-running the serve writer for an already-recorded serve changes nothing (model of private.ledger_record_serve: same key / same serve + type = duplicate)", async () => {
    const w = world();
    const { campaignId } = w.db.addAd(w.advertiserId, { totalBudget: 10 });
    await serve(w);
    const s = w.db.serveLog[0];
    const before = snap(w, campaignId);
    w.m.ledgerRecordServe({ serveRef: s.serveRef, campaignId, publisherId: s.publisherId, unitUsd: UNIT_USD });
    w.m.ledgerRecordServe({ serveRef: s.serveRef, campaignId, publisherId: s.publisherId, unitUsd: UNIT_USD });
    assertUnchanged(before, snap(w, campaignId), "duplicate writer run");
    // Wahi serve, KUCH ALAG amount => chupchap doosri entry nahi: conflict error.
    assert.throws(() => w.m.ledgerRecordServe({ serveRef: s.serveRef, campaignId, publisherId: s.publisherId, unitUsd: 0.003 }), (e: unknown) => e instanceof FakeSqlError && e.code === "23505");
    assertUnchanged(before, snap(w, campaignId), "conflicting writer run");
  });

  it("reversal: first write records ONE opposite row; the same key again is a duplicate (same id, no new row); the original is never touched", async () => {
    const w = world();
    w.db.addAd(w.advertiserId, { totalBudget: 10 });
    await serve(w);
    w.m.signIn(w.adminId);
    const earning = w.m.entriesOf("publisher_earning")[0];
    const first = await reversal(w, earning.id);
    assert.equal(first.outcome, "recorded");
    const again = await reversal(w, earning.id);
    assert.equal(again.outcome, "duplicate");
    assert.ok(first.outcome === "recorded" && again.outcome === "duplicate" && first.id === again.id);
    assert.equal(w.m.entriesOf("reversal").length, 1);
    assert.equal(w.m.entries.find((e) => e.id === earning.id)?.amount, PUB_U, "original untouched");
    assert.equal(w.m.publisherBalance(w.a.publisherId), 0n, "net zero after one reversal, not -0.0014");
  });

  it("an entry can be reversed only once: another key => conflict; a reversal cannot be reversed; unknown entry => not_found", async () => {
    const w = world();
    w.db.addAd(w.advertiserId, { totalBudget: 10 });
    await serve(w);
    w.m.signIn(w.adminId);
    const earning = w.m.entriesOf("publisher_earning")[0];
    const first = await reversal(w, earning.id, "reverse-key-0001");
    assert.equal(first.outcome, "recorded");
    assert.equal((await reversal(w, earning.id, "reverse-key-0002")).outcome, "conflict");
    assert.equal(w.m.entriesOf("reversal").length, 1);
    const reversalId = first.outcome === "recorded" ? first.id : -1;
    assert.equal((await reversal(w, reversalId, "reverse-key-0003")).outcome, "rejected");
    assert.equal((await reversal(w, 9999, "reverse-key-0004")).outcome, "not_found");
    assert.equal(w.m.entriesOf("reversal").length, 1);
  });

  it("adjustment: the same key + same amount is a duplicate (balance moves once); the same key with another amount is a conflict (nothing moves)", async () => {
    const w = world();
    w.m.signIn(w.adminId);
    assert.equal((await adjust(w, "0.5000", "adjust-key-0001", w.a.publisherId)).outcome, "recorded");
    assert.equal((await adjust(w, "0.5000", "adjust-key-0001", w.a.publisherId)).outcome, "duplicate");
    assert.equal((await adjust(w, "0.7000", "adjust-key-0001", w.a.publisherId)).outcome, "conflict");
    assert.equal(w.m.entriesOf("adjustment").length, 1);
    assert.equal(w.m.publisherBalance(w.a.publisherId), 5000n);
  });

  it("parallel retries of the same reversal / adjustment give exactly one row (one 'recorded', the rest 'duplicate')", async () => {
    const w = world();
    w.db.addAd(w.advertiserId, { totalBudget: 10 });
    await serve(w);
    w.m.signIn(w.adminId);
    const earning = w.m.entriesOf("publisher_earning")[0];
    const reversals = await Promise.all(Array.from({ length: 6 }, () => reversal(w, earning.id)));
    assert.equal(reversals.filter((r) => r.outcome === "recorded").length, 1);
    assert.equal(reversals.filter((r) => r.outcome === "duplicate").length, 5);
    assert.equal(w.m.entriesOf("reversal").length, 1);
    const adjustments = await Promise.all(Array.from({ length: 5 }, () => adjust(w, "1.0000", "adjust-parallel-1", w.a.publisherId)));
    assert.equal(adjustments.filter((r) => r.outcome === "recorded").length, 1);
    assert.equal(w.m.entriesOf("adjustment").length, 1);
  });

  it("reversal and adjustment never refund or change the campaign budget (the spend stays; the next serve still counts against it)", async () => {
    const w = world();
    const { campaignId } = w.db.addAd(w.advertiserId, { totalBudget: 10 });
    await serveN(w, 2);
    w.m.signIn(w.adminId);
    const charge = w.m.entriesOf("advertiser_charge")[0];
    assert.equal((await reversal(w, charge.id)).outcome, "recorded");
    assert.equal((await adjust(w, "-1.0000", "adjust-key-0002", w.a.publisherId)).outcome, "recorded");
    assert.equal(spendU(w, campaignId), UNIT_U * 2n, "budget not refunded");
    await serve(w);
    assert.equal(spendU(w, campaignId), UNIT_U * 3n);
  });

  it("hostile admin input never reaches the database: 5 decimals, float text, zero, number type, short key, short reason", async () => {
    const w = world();
    w.m.signIn(w.adminId);
    const before = w.m.calls.length;
    const bad: unknown[] = ["0.00001", "1e3", "0", "0.0000", 5, "", " 1", "1,5"];
    for (const amount of bad) {
      const r = await addLedgerAdjustment({ actorProfileId: w.adminId, account: "publisher", amount: amount as string, idempotencyKey: "adjust-key-0009", reason: "Manual correction", publisherId: w.a.publisherId });
      assert.equal(r.outcome, "invalid", String(amount));
    }
    assert.equal((await addLedgerAdjustment({ actorProfileId: w.adminId, account: "publisher", amount: "1.0000", idempotencyKey: "short", reason: "Manual correction", publisherId: w.a.publisherId })).outcome, "invalid");
    assert.equal((await addLedgerAdjustment({ actorProfileId: w.adminId, account: "publisher", amount: "1.0000", idempotencyKey: "adjust-key-0009", reason: "no", publisherId: w.a.publisherId })).outcome, "invalid");
    assert.equal(w.m.calls.length, before, "nothing was sent to the database");
    assert.equal(w.m.entries.length, 0);
  });
});

// ===========================================================================================================================
describe("day 14 part 5 / 2: publisher ownership", () => {
  async function earned(w: World): Promise<string> {
    const { campaignId } = w.db.addAd(w.advertiserId, { totalBudget: 10 });
    await serveN(w, 3, w.a); // A: 3 x 0.0014 = 0.0042
    await serveN(w, 1, w.b); // B: 0.0014
    return campaignId;
  }

  it("each publisher's summary shows only their own ledger balance; the other's amount never appears", async () => {
    const w = world();
    await earned(w);
    w.m.signIn(w.a.profileId);
    const a = await fetchMyPayoutSummary(w.m.sessionClient());
    assert.ok(a.status === "ok");
    assert.equal(a.data.ledgerBalance, PUB_U * 3n);
    assert.equal(a.data.available, PUB_U * 3n);
    w.m.signIn(w.b.profileId);
    const b = await fetchMyPayoutSummary(w.m.sessionClient());
    assert.ok(b.status === "ok");
    assert.equal(b.data.ledgerBalance, PUB_U);
  });

  it("a payout request is created for the LOGGED-IN publisher; a forged publisherId / status / amount-owner field in the form changes nothing", async () => {
    const w = world();
    await earned(w);
    w.m.signIn(w.a.profileId);
    const r = await askPayout("0.0020", reqKey(1), { publisherId: w.b.publisherId, publisher_id: w.b.publisherId, status: "paid", requested_by: w.b.profileId });
    assert.equal(r.status, "success", r.message);
    assert.equal(w.m.payouts.length, 1);
    assert.equal(w.m.payouts[0].publisherId, w.a.publisherId);
    assert.equal(w.m.payouts[0].requestedBy, w.a.profileId);
    assert.equal(w.m.payouts[0].status, "requested");
    const sent = w.m.calls.filter((c) => c.name === "request_my_payout");
    assert.deepEqual(Object.keys(sent[0].args).sort(), ["p_amount", "p_request_key"]);
  });

  it("the database function itself ignores a smuggled publisher id argument (it uses auth.uid())", async () => {
    const w = world();
    await earned(w);
    w.m.signIn(w.b.profileId);
    const res = await w.m.sessionClient().rpc("request_my_payout", { p_amount: "0.0010", p_request_key: reqKey(2), p_publisher_id: w.a.publisherId });
    assert.equal((res.data as { outcome: string }).outcome, "requested");
    assert.equal(w.m.payouts[0].publisherId, w.b.publisherId);
  });

  it("another publisher cannot see my payout requests; admin sees all; a request key is unique per publisher (B can reuse A's key)", async () => {
    const w = world();
    await earned(w);
    w.m.signIn(w.a.profileId);
    await askPayout("0.0020", reqKey(7));
    w.m.signIn(w.b.profileId);
    const bList = await fetchMyPayoutRequests(w.m.sessionClient());
    assert.deepEqual(bList, { status: "ok", data: [] });
    assert.equal((await askPayout("0.0010", reqKey(7))).status, "success", "same key, other publisher: separate request");
    assert.equal(w.m.payouts.length, 2);
    w.m.signIn(w.a.profileId);
    const aList = await fetchMyPayoutRequests(w.m.sessionClient());
    assert.ok(aList.status === "ok" && aList.data.length === 1 && aList.data[0].amount === 20n);
    w.m.signIn(w.adminId);
    const all = await fetchAdminPayoutRequests(w.m.sessionClient());
    assert.ok(all.status === "ok" && all.data.length === 2);
  });

  it("non-publishers cannot request a payout: admin / advertiser / logged-out are stopped by the role gate (database never called); the function itself says forbidden", async () => {
    const w = world();
    await earned(w);
    const advertiserProfile = w.m.addAdvertiserProfile();
    for (const who of [w.adminId, advertiserProfile, null]) {
      w.m.signIn(who);
      const before = w.m.calls.length;
      await assert.rejects(askPayout("0.0010", reqKey(3)), /REDIRECT:\/dashboard/);
      assert.equal(w.m.calls.length, before);
      const direct = await w.m.sessionClient(who).rpc("request_my_payout", { p_amount: "0.0010", p_request_key: reqKey(3) });
      assert.equal((direct.data as { outcome: string }).outcome, "forbidden");
    }
    assert.equal(w.m.payouts.length, 0);
  });

  it("a suspended publisher (profile or publisher) or a pending publisher cannot request; the summary of a suspended profile is 'not found', never somebody else's data", async () => {
    const w = world();
    await earned(w);
    w.m.signIn(w.a.profileId);
    w.m.setPublisherStatus(w.a.publisherId, "suspended");
    assert.match((await askPayout("0.0010", reqKey(4))).message ?? "", /not active/);
    w.m.setPublisherStatus(w.a.publisherId, "pending");
    assert.match((await askPayout("0.0010", reqKey(4))).message ?? "", /not active/);
    w.m.setPublisherStatus(w.a.publisherId, "active");
    w.m.setProfileStatus(w.a.profileId, "suspended");
    await assert.rejects(askPayout("0.0010", reqKey(4)), /REDIRECT/); // requireRole: suspended profile
    const summary = await fetchMyPayoutSummary(w.m.sessionClient());
    assert.deepEqual(summary, { status: "not_found" });
    assert.equal(w.m.payouts.length, 0);
  });

  it("grants: a publisher session cannot call the ledger admin functions; the service-role client cannot call the payout functions", async () => {
    const w = world();
    await earned(w);
    w.m.signIn(w.a.profileId);
    const rev = await w.m.sessionClient().rpc("ledger_reverse_entry", { p_actor: w.a.profileId, p_entry_id: 1, p_idempotency_key: "reverse-key-0001", p_reason: "Try to cheat" });
    assert.equal(rev.error?.code, "42501");
    const adj = await w.m.sessionClient().rpc("ledger_add_adjustment", { p_actor: w.a.profileId, p_account: "publisher", p_amount: "100.0000", p_idempotency_key: "adjust-key-0001", p_reason: "Try to cheat", p_publisher_id: w.a.publisherId });
    assert.equal(adj.error?.code, "42501");
    assert.equal(w.m.entriesOf("reversal").length + w.m.entriesOf("adjustment").length, 0);
    for (const fn of ["request_my_payout", "admin_review_payout_request", "admin_mark_payout_paid", "get_my_payout_summary"]) {
      const res = await w.m.serviceClient().rpc(fn, {});
      assert.equal(res.error?.code, "42501", fn);
    }
  });

  it("admin ledger writes need the SIGNED-IN active admin: publisher, advertiser, suspended admin, logged-out and 'another admin's id' are all forbidden, database not called", async () => {
    const w = world();
    w.db.addAd(w.advertiserId, { totalBudget: 10 });
    await serve(w);
    const other = w.m.addAdmin();
    const suspended = w.m.addAdmin("suspended");
    const entry = w.m.entriesOf("publisher_earning")[0];
    const cases: [string | null, string][] = [
      [w.a.profileId, w.a.profileId],
      [w.m.addAdvertiserProfile(), w.adminId],
      [suspended, suspended],
      [null, w.adminId],
      [w.adminId, other], // admin apne session se kisi aur admin ke naam par likhna chahta hai
    ];
    for (const [signedIn, actor] of cases) {
      w.m.signIn(signedIn);
      const before = w.m.calls.length;
      assert.equal((await reversal(w, entry.id, "reverse-key-0001", actor)).outcome, "forbidden", String(signedIn));
      assert.equal((await adjust(w, "1.0000", "adjust-key-0001", w.a.publisherId, actor)).outcome, "forbidden", String(signedIn));
      assert.equal(w.m.calls.length, before, "database was not called");
    }
    assert.equal(w.m.entriesOf("reversal").length + w.m.entriesOf("adjustment").length, 0);
  });
});

// ===========================================================================================================================
describe("day 14 part 5 / 3: payout transitions are admin-only and one-way", () => {
  /** A ke 3 serves (0.0042) + ek payout request (0.0020). */
  async function pending(): Promise<{ w: World; id: string; campaignId: string }> {
    const w = world();
    const { campaignId } = w.db.addAd(w.advertiserId, { totalBudget: 10 });
    await serveN(w, 3, w.a);
    w.m.signIn(w.a.profileId);
    assert.equal((await askPayout("0.0020", reqKey(1))).status, "success");
    return { w, id: w.m.payouts[0].id, campaignId };
  }
  const status = (w: World): string => w.m.payouts[0].status;

  it("only an admin can approve / reject / mark paid: publisher, advertiser, logged-out and suspended admin are stopped; a direct database call from a non-admin is 42501; status never moves", async () => {
    const { w, id } = await pending();
    const advertiserProfile = w.m.addAdvertiserProfile();
    const suspended = w.m.addAdmin("suspended");
    for (const who of [w.a.profileId, w.b.profileId, advertiserProfile, null, suspended]) {
      w.m.signIn(who);
      for (const action of ["approve", "reject", "paid"]) await assert.rejects(adminAct(id, action, "Not allowed here"), /REDIRECT:\/dashboard/);
      const direct = w.m.sessionClient(who);
      assert.equal((await direct.rpc("admin_review_payout_request", { p_request_id: id, p_decision: "approve", p_reason: null })).error?.code, "42501");
      assert.equal((await direct.rpc("admin_mark_payout_paid", { p_request_id: id })).error?.code, "42501");
      assert.equal(status(w), "requested");
    }
    assert.equal(w.m.events.length, 1, "no audit event was added by a refused attempt");
  });

  it("a demoted / suspended admin who slips past the page gate is still refused by the database (42501 shown as 'Only an admin can do this')", async () => {
    const { w, id } = await pending();
    w.m.signIn(w.adminId);
    const gate = w.m.sessionClient(w.adminId);
    w.m.setProfileStatus(w.adminId, "suspended");
    const res = await gate.rpc("admin_review_payout_request", { p_request_id: id, p_decision: "approve", p_reason: null });
    assert.equal(res.error?.code, "42501");
    assert.equal(status(w), "requested");
  });

  it("happy path requested -> approved -> paid by an admin: each step has the right actor in the audit trail; 'paid' only records, it writes no ledger entry and changes no budget", async () => {
    const { w, id, campaignId } = await pending();
    const before = snap(w, campaignId);
    w.m.signIn(w.adminId);
    assert.equal((await adminAct(id, "approve")).status, "success");
    assert.equal(status(w), "approved");
    assert.equal((await adminAct(id, "paid")).status, "success");
    assert.equal(status(w), "paid");
    assert.deepEqual(w.m.events.map((e) => [e.from, e.to, e.actorRole, e.actor]), [
      [null, "requested", "publisher", w.a.profileId],
      ["requested", "approved", "admin", w.adminId],
      ["approved", "paid", "admin", w.adminId],
    ]);
    assert.equal(w.m.payouts[0].reviewedBy, w.adminId);
    assert.equal(w.m.payouts[0].paidBy, w.adminId);
    assertUnchanged(before, snap(w, campaignId), "payout steps do not touch ledger, spend or serves");
    assert.deepEqual(session.revalidated.includes("/dashboard/admin"), true);
  });

  it("states cannot be skipped or repeated: paid from 'requested', approve twice, approve after paid, reject after paid: all errors, state and audit unchanged", async () => {
    const { w, id } = await pending();
    w.m.signIn(w.adminId);
    assert.equal((await adminAct(id, "paid")).status, "error"); // requested -> paid: skip
    assert.equal(status(w), "requested");
    assert.equal((await adminAct(id, "approve")).status, "success");
    assert.equal((await adminAct(id, "approve")).status, "error");
    assert.equal((await adminAct(id, "paid")).status, "success");
    const eventsAfterPaid = w.m.events.length;
    for (const action of ["approve", "paid"]) assert.equal((await adminAct(id, action)).status, "error", action);
    assert.equal((await adminAct(id, "reject", "Changed my mind")).status, "error");
    assert.equal(status(w), "paid", "paid is final");
    assert.equal(w.m.events.length, eventsAfterPaid);
  });

  it("rejected is final too; reject needs a reason (blank / 2 characters never reach the database); an approved request can still be rejected", async () => {
    const { w, id } = await pending();
    w.m.signIn(w.adminId);
    const calls = w.m.calls.length;
    for (const reason of [undefined, "", "   ", "no"]) assert.equal((await adminAct(id, "reject", reason)).status, "error");
    assert.equal(w.m.calls.length, calls);
    assert.equal((await adminAct(id, "approve")).status, "success");
    assert.equal((await adminAct(id, "reject", "Details do not match")).status, "success");
    assert.equal(status(w), "rejected");
    assert.equal(w.m.payouts[0].rejectionReason, "Details do not match");
    for (const action of ["approve", "paid"]) assert.equal((await adminAct(id, action)).status, "error");
    assert.equal((await adminAct(id, "reject", "Again please")).status, "error");
    assert.equal(status(w), "rejected");
  });

  it("an admin cannot review a payout they requested themselves (database guard, 23514): shown as an error, never as success", async () => {
    const { w, id } = await pending();
    w.m.setRole(w.a.profileId, "admin"); // publisher ko admin bana diya gaya
    w.m.signIn(w.a.profileId);
    const approve = await adminAct(id, "approve");
    assert.equal(approve.status, "error");
    assert.equal(status(w), "requested");
    assert.equal(w.m.payouts[0].reviewedBy, null);
  });

  it("approve / paid need an active publisher (not_eligible); reject still works so the reserved money can be released", async () => {
    const { w, id } = await pending();
    w.m.signIn(w.adminId);
    w.m.setPublisherStatus(w.a.publisherId, "suspended");
    const approve = await adminAct(id, "approve");
    assert.equal(approve.status, "error");
    assert.match(approve.message ?? "", /not active/);
    assert.equal(status(w), "requested");
    w.m.setPublisherStatus(w.a.publisherId, "active");
    assert.equal((await adminAct(id, "approve")).status, "success");
    w.m.setPublisherStatus(w.a.publisherId, "suspended");
    assert.match((await adminAct(id, "paid")).message ?? "", /not active/);
    assert.equal(status(w), "approved");
    assert.equal((await adminAct(id, "reject", "Account suspended")).status, "success");
    assert.equal(status(w), "rejected");
  });

  it("the admin list is for admins only: a publisher gets an empty list (nobody else's request leaks), an admin sees everything", async () => {
    const { w } = await pending();
    w.m.signIn(w.b.profileId);
    assert.deepEqual(await fetchAdminPayoutRequests(w.m.sessionClient()), { status: "ok", data: [] });
    w.m.signIn(w.adminId);
    const list = await fetchAdminPayoutRequests(w.m.sessionClient());
    assert.ok(list.status === "ok" && list.data.length === 1 && list.data[0].publisherId === w.a.publisherId && list.data[0].ledgerCovers === true);
  });

  it("malformed or unknown ids / actions never change anything", async () => {
    const { w } = await pending();
    w.m.signIn(w.adminId);
    const calls = w.m.calls.length;
    for (const id of ["", "not-a-uuid", "../../etc", "00000000-0000-4000-9000-000000000001' or '1'='1"]) assert.equal((await adminAct(id, "approve")).status, "error");
    assert.equal((await adminAct(w.m.payouts[0].id, "refund")).status, "error");
    assert.equal(w.m.calls.length, calls);
    assert.equal((await adminAct("00000000-0000-4000-9000-0000000000ff", "approve")).status, "error"); // not_found
    assert.equal(status(w), "requested");
  });
});

// ===========================================================================================================================
describe("day 14 part 5 / 4: available balance protection", () => {
  /** A ke 5 serves = 0.0070 kamai. */
  async function funded(): Promise<{ w: World; campaignId: string }> {
    const w = world();
    const { campaignId } = w.db.addAd(w.advertiserId, { totalBudget: 10 });
    await serveN(w, 5, w.a);
    w.m.signIn(w.a.profileId);
    return { w, campaignId };
  }
  const summary = async (w: World) => {
    const r = await fetchMyPayoutSummary(w.m.sessionClient());
    assert.ok(r.status === "ok");
    return r.data;
  };

  it("more than available is refused with the real available amount; exactly available works; one unit more does not", async () => {
    const { w } = await funded(); // 0.0070 available
    const over = await askPayout("0.0071", reqKey(1));
    assert.equal(over.status, "error");
    assert.match(over.message ?? "", /0\.0070 USD/);
    assert.equal(w.m.payouts.length, 0);
    assert.equal((await askPayout("0.0070", reqKey(2))).status, "success");
    assert.equal(w.m.payouts[0].amount, 70n);
  });

  it("no earnings => nothing can be requested (available 0.0000), whether the ledger is on without serves or switched off entirely", async () => {
    for (const enabled of [true, false]) {
      const w = world({ enabled });
      const { campaignId } = w.db.addAd(w.advertiserId, { totalBudget: 10 });
      if (!enabled) await serveN(w, 2); // serves happen, but the ledger is off: no earnings exist
      w.m.signIn(w.a.profileId);
      const r = await askPayout("0.0001", reqKey(1));
      assert.equal(r.status, "error");
      assert.match(r.message ?? "", /0\.0000 USD/);
      assert.equal(w.m.payouts.length, 0);
      assert.equal(spendU(w, campaignId), enabled ? 0n : UNIT_U * 2n);
    }
  });

  it("only ONE open request per publisher: a second request (new key) while one is open is refused and reserves nothing extra", async () => {
    const { w } = await funded();
    assert.equal((await askPayout("0.0030", reqKey(1))).status, "success");
    const second = await askPayout("0.0010", reqKey(2));
    assert.equal(second.status, "error");
    assert.match(second.message ?? "", /already have a payout request/);
    assert.equal(w.m.payouts.length, 1);
    const s = await summary(w);
    assert.equal(s.reserved, 30n);
    assert.equal(s.available, 40n);
  });

  it("two requests sent at the same time reserve the same earnings only once (exactly one is created)", async () => {
    const { w } = await funded();
    const results = await Promise.all([askPayout("0.0070", reqKey(1)), askPayout("0.0070", reqKey(2)), askPayout("0.0070", reqKey(3))]);
    assert.equal(results.filter((r) => r.status === "success").length, 1);
    assert.equal(w.m.payouts.length, 1);
    assert.equal((await summary(w)).reserved, 70n);
    assert.equal((await summary(w)).available, 0n);
  });

  it("retrying the same request (same key, same amount) is a harmless duplicate; the same key with another amount is refused", async () => {
    const { w } = await funded();
    assert.equal((await askPayout("0.0030", reqKey(1))).status, "success");
    const again = await askPayout("0.0030", reqKey(1));
    assert.equal(again.status, "success");
    assert.match(again.message ?? "", /already received/);
    const clash = await askPayout("0.0040", reqKey(1));
    assert.equal(clash.status, "error");
    assert.equal(w.m.payouts.length, 1);
    assert.equal(w.m.payouts[0].amount, 30n);
    assert.equal(w.m.events.filter((e) => e.to === "requested").length, 1, "one audit event for one request");
  });

  it("reject releases the reserved amount (it can be requested again); paid deducts it for good", async () => {
    const { w } = await funded(); // 0.0070
    assert.equal((await askPayout("0.0070", reqKey(1))).status, "success");
    assert.equal((await summary(w)).available, 0n);
    w.m.signIn(w.adminId);
    await adminAct(w.m.payouts[0].id, "reject", "Please resubmit");
    w.m.signIn(w.a.profileId);
    assert.equal((await summary(w)).available, 70n, "released");
    assert.equal((await askPayout("0.0050", reqKey(2))).status, "success");
    w.m.signIn(w.adminId);
    await adminAct(w.m.payouts[1].id, "approve");
    await adminAct(w.m.payouts[1].id, "paid");
    w.m.signIn(w.a.profileId);
    const s = await summary(w);
    assert.deepEqual([s.ledgerBalance, s.reserved, s.paidOut, s.available, s.hasOpenRequest], [70n, 0n, 50n, 20n, false]);
    assert.equal((await askPayout("0.0030", reqKey(3))).status, "error", "the paid 0.0050 cannot be requested again");
    assert.equal((await askPayout("0.0020", reqKey(4))).status, "success");
  });

  it("new serves after a request add earnings on top: available = new earnings only, reserved stays reserved", async () => {
    const { w } = await funded();
    await askPayout("0.0070", reqKey(1));
    await serveN(w, 2, w.a); // +0.0028
    const s = await summary(w);
    assert.deepEqual([s.ledgerBalance, s.reserved, s.available], [98n, 70n, 28n]);
  });

  it("a reversal / negative adjustment after a request can push the ledger below the reserved amount: available is 0 (never negative), approve and paid are refused ('insufficient'), reject still works", async () => {
    const { w } = await funded(); // 0.0070
    assert.equal((await askPayout("0.0070", reqKey(1))).status, "success");
    w.m.signIn(w.adminId);
    assert.equal((await adjust(w, "-0.0030", "adjust-neg-0001", w.a.publisherId)).outcome, "recorded"); // ledger 0.0040 < reserved 0.0070
    w.m.signIn(w.a.profileId);
    const s = await summary(w);
    assert.deepEqual([s.ledgerBalance, s.reserved, s.available], [40n, 70n, 0n]);
    assert.ok(s.available >= 0n);
    w.m.signIn(w.adminId);
    const approve = await adminAct(w.m.payouts[0].id, "approve");
    assert.equal(approve.status, "error");
    assert.match(approve.message ?? "", /no longer covers/);
    assert.equal(w.m.payouts[0].status, "requested");
    assert.equal((await adminAct(w.m.payouts[0].id, "reject", "Balance changed")).status, "success");
    w.m.signIn(w.a.profileId);
    assert.equal((await summary(w)).available, 40n);
  });

  it("the same protection at 'paid': approved first, then the ledger shrinks, then 'mark paid' is refused and nothing is recorded as paid", async () => {
    const { w } = await funded();
    await askPayout("0.0070", reqKey(1));
    w.m.signIn(w.adminId);
    assert.equal((await adminAct(w.m.payouts[0].id, "approve")).status, "success");
    const earning = w.m.entriesOf("publisher_earning")[0];
    assert.equal((await reversal(w, earning.id)).outcome, "recorded"); // ledger 0.0056 < reserved 0.0070
    const paid = await adminAct(w.m.payouts[0].id, "paid");
    assert.equal(paid.status, "error");
    assert.equal(w.m.payouts[0].status, "approved");
    assert.equal(w.m.payouts[0].paidBy, null);
    assert.equal(w.m.payouts.filter((p) => p.status === "paid").length, 0);
  });

  it("the summary always reconciles (available = ledger - reserved - paid, floored at 0) across a long history", async () => {
    const { w } = await funded();
    let step = 1;
    const check = async () => {
      w.m.signIn(w.a.profileId);
      const s = await summary(w);
      const expected = s.ledgerBalance - s.reserved - s.paidOut;
      assert.equal(s.available, expected > 0n ? expected : 0n);
      assert.ok(s.available >= 0n);
    };
    for (const amount of ["0.0010", "0.0020", "0.0005"]) {
      w.m.signIn(w.a.profileId);
      await askPayout(amount, reqKey(step));
      step += 1;
      await check();
      w.m.signIn(w.adminId);
      const row = w.m.payouts[w.m.payouts.length - 1];
      await adminAct(row.id, "approve");
      await adminAct(row.id, "paid");
      await check();
      await serveN(w, 1, w.a);
      await check();
    }
    assert.equal(w.m.payouts.filter((p) => p.status === "paid").length, 3);
  });
});

// ===========================================================================================================================
describe("day 14 part 5 / 5: failed requests, no-fill and retries never create money", () => {
  it("no candidate at all => no-fill; the serve writer is never called; no charge, no ledger row", async () => {
    const w = world();
    const { campaignId } = w.db.addAd(w.advertiserId, { category: "travel", totalBudget: 10 }); // topic gaming ke liye kuch nahi
    const before = snap(w, campaignId);
    const res = await serve(w);
    assert.equal(res.text, '{"fill":false}');
    assert.equal(w.db.rpcCount("record_ad_serve"), 0);
    assertUnchanged(before, snap(w, campaignId), "no-fill");
  });

  it("the database says 'rejected' at record time (ad turned ineligible in the race) => no-fill, no spend, no ledger row", async () => {
    const w = world();
    const { campaignId } = w.db.addAd(w.advertiserId, { totalBudget: 10 });
    w.db.failRpc.record_ad_serve = { data: { outcome: "rejected" }, error: null };
    const before = snap(w, campaignId);
    const res = await serve(w, w.a, { "x-blisscco-tracking": "1" });
    assert.equal(res.text, '{"fill":false}');
    assertUnchanged(before, snap(w, campaignId), "rejected serve");
  });

  it("a database outage while recording the serve => 503 with no ad; nothing charged; the SAME Idempotency-Key retried later is charged exactly once", async () => {
    const w = world();
    const { campaignId } = w.db.addAd(w.advertiserId, { totalBudget: 10 });
    const headers = { "idempotency-key": "retry-key-1000" };
    w.db.failRpc.record_ad_serve = { data: null, error: { code: "XX000", message: "secret internal detail" } };
    const before = snap(w, campaignId);
    const down = await serve(w, w.a, headers);
    assert.equal(down.status, 503);
    assert.equal(down.text.includes("secret"), false);
    assertUnchanged(before, snap(w, campaignId), "outage");
    delete w.db.failRpc.record_ad_serve;
    assert.equal((await serve(w, w.a, headers)).status, 200);
    assert.equal((await serve(w, w.a, headers)).status, 200); // aur ek retry
    assert.equal(w.db.serveLog.length, 1);
    assert.equal(w.m.entries.length, 3);
    assertReconciles(w, campaignId);
  });

  it("a ledger write that FAILS inside the serve rolls the whole serve back (spend, serve log, ledger, token); after the fault is fixed the retry is charged once", async () => {
    const w = world();
    const { campaignId } = w.db.addAd(w.advertiserId, { totalBudget: 10 });
    const headers = { "idempotency-key": "retry-key-2000", "x-blisscco-tracking": "1" };
    w.m.failLedgerWrites = true;
    const before = snap(w, campaignId);
    const res = await serve(w, w.a, headers);
    assert.equal(res.status, 503);
    assert.equal(res.text, '{"fill":false,"error":"unavailable"}');
    assert.equal(res.text.includes("bt1."), false, "no tracking token for an unrecorded serve");
    assertUnchanged(before, snap(w, campaignId), "half-written serve");
    // Bina key ka retry bhi sirf EK baar charge karta hai (pichla kuch likha hi nahi gaya).
    w.m.failLedgerWrites = false;
    assert.equal((await serve(w, w.a, headers)).status, 200);
    assert.equal((await serve(w, w.a, headers)).status, 200);
    assert.equal(w.db.serveLog.length, 1);
    assertReconciles(w, campaignId);
  });

  it("bad requests never reach billing: unknown / revoked key, no key, malformed body, unknown or sensitive topic, free text, rate limit", async () => {
    const w = world();
    const { campaignId } = w.db.addAd(w.advertiserId, { totalBudget: 10 });
    w.db.addKey(w.a.publisherId, makeKey("r"), { status: "revoked" });
    const before = snap(w, campaignId);
    const calls = [
      match({ topic: "gaming" }, makeKey("z")),
      match({ topic: "gaming" }, makeKey("r")),
      match({ topic: "gaming" }, null),
      match("{not json", w.a.key),
      match({ topic: "no-such-topic" }, w.a.key),
      match({ topic: "health_conditions" }, w.a.key),
      match({ topic: "gaming", question: "my private chat text" }, w.a.key),
      match({}, w.a.key),
    ];
    for (const res of await Promise.all(calls)) assert.ok(res.json.fill !== true, res.text);
    assertUnchanged(before, snap(w, campaignId), "bad requests");
    w.db.advanceMinutes(1); // naya rate-limit window (upar ki bad requests ne purani window me hits gine)
    w.db.rateLimitPerMinute = 1;
    const ok = await serve(w);
    assert.equal(ok.status, 200);
    const limited = await serve(w);
    assert.equal(limited.status, 429);
    assert.equal(w.db.serveLog.length, 1);
    assert.equal(w.m.entries.length, 3);
  });

  it("first candidate rejected at record time, next one recorded: exactly ONE charge (for the recorded ad); the rejected try writes nothing", async () => {
    const w = world();
    const first = w.db.addAd(w.advertiserId, { totalBudget: 10, headline: "Ad one" });
    const second = w.db.addAd(w.advertiserId, { totalBudget: 10, headline: "Ad two" });
    const service = w.m.serviceClient();
    let recordCalls = 0;
    globals.__TEST_SUPABASE__ = {
      rpc: async (name: string, args: Record<string, unknown> = {}) => {
        if (name === "record_ad_serve") {
          recordCalls += 1;
          if (recordCalls === 1) return { data: { outcome: "rejected" }, error: null }; // pehla try race me reject
        }
        return TRACKING_RPCS.includes(name) ? w.events.rpc(name, args) : service.rpc(name, args);
      },
    };
    const res = await serve(w);
    assert.equal(res.status, 200);
    assert.equal(res.json.fill, true);
    assert.equal(recordCalls, 2, "second candidate was tried");
    assert.equal(w.db.serveLog.length, 1);
    assert.equal(w.m.serveEntries().length, 3);
    assert.equal(spendU(w, first.campaignId) + spendU(w, second.campaignId), UNIT_U, "one unit in total, across both campaigns");
    assert.equal(w.m.sum((e) => e.type === "advertiser_charge"), UNIT_U);
    assertReconciles(w, w.db.serveLog[0].campaignId);
  });

  it("budget exhausted: serves stop at the total budget; further requests are no-fill and add NO entries; charges == spend == budget", async () => {
    const w = world();
    const { campaignId } = w.db.addAd(w.advertiserId, { totalBudget: 0.006 }); // 3 serves
    for (let i = 0; i < 3; i += 1) assert.equal((await serve(w)).json.fill, true);
    const before = snap(w, campaignId);
    for (let i = 0; i < 4; i += 1) assert.equal((await serve(w)).text, '{"fill":false}');
    assertUnchanged(before, snap(w, campaignId), "exhausted budget");
    assert.equal(before.charge, UNIT_U * 3n);
    assert.equal(before.spend, 60n);
    assert.equal(before.entries, 9);
    assertReconciles(w, campaignId);
  });

  it("daily cap reached: the same, even though total budget is left", async () => {
    const w = world();
    const { campaignId } = w.db.addAd(w.advertiserId, { totalBudget: 10, dailyBudget: 0.004 }); // 2 serves per day
    await serveN(w, 2);
    const before = snap(w, campaignId);
    for (let i = 0; i < 3; i += 1) assert.equal((await serve(w)).text, '{"fill":false}');
    assertUnchanged(before, snap(w, campaignId), "daily cap");
    assertReconciles(w, campaignId);
  });

  it("retries with an Idempotency-Key (one after another AND at the same time) are charged once: one serve, one budget unit, 3 ledger rows", async () => {
    const w = world();
    const { campaignId } = w.db.addAd(w.advertiserId, { totalBudget: 10 });
    const headers = { "idempotency-key": "retry-key-3000" };
    for (let i = 0; i < 4; i += 1) assert.equal((await serve(w, w.a, headers)).status, 200);
    await Promise.all(Array.from({ length: 5 }, () => serve(w, w.a, headers)));
    assert.equal(w.db.serveLog.length, 1);
    assert.equal(spendU(w, campaignId), UNIT_U);
    assert.equal(w.m.entries.length, 3);
    assert.equal(w.db.rpcCount("record_ad_serve") >= 1, true);
    assertReconciles(w, campaignId);
  });

  it("a retry after the ad was paused returns no-fill: NO new entry, and the earlier charge is NOT refunded or reversed", async () => {
    const w = world();
    const { campaignId, creativeId } = w.db.addAd(w.advertiserId, { totalBudget: 10 });
    const headers = { "idempotency-key": "retry-key-4000" };
    assert.equal((await serve(w, w.a, headers)).status, 200);
    w.db.setCreativeStatus(creativeId, "paused");
    const before = snap(w, campaignId);
    const retry = await serve(w, w.a, headers);
    assert.equal(retry.text, '{"fill":false}');
    assertUnchanged(before, snap(w, campaignId), "retry after pause");
    assert.equal(w.m.entriesOf("reversal").length, 0);
    assert.equal(before.charge, UNIT_U);
  });

  it("the same Idempotency-Key text used by two publishers is two separate serves, each charged once and each earning for its own publisher", async () => {
    const w = world();
    const { campaignId } = w.db.addAd(w.advertiserId, { totalBudget: 10 });
    const headers = { "idempotency-key": "shared-key-5000" };
    await serve(w, w.a, headers);
    await serve(w, w.b, headers);
    await serve(w, w.a, headers); // retry of A
    assert.equal(w.db.serveLog.length, 2);
    assert.equal(w.m.publisherBalance(w.a.publisherId), PUB_U);
    assert.equal(w.m.publisherBalance(w.b.publisherId), PUB_U);
    assertReconciles(w, campaignId);
  });

  it("without an Idempotency-Key every request is its own billable serve (documented): the safe way to retry is to send a key", async () => {
    const w = world();
    const { campaignId } = w.db.addAd(w.advertiserId, { totalBudget: 10 });
    await serve(w);
    await serve(w);
    assert.equal(w.db.serveLog.length, 2);
    assert.equal(w.m.entries.length, 6);
    assertReconciles(w, campaignId);
  });

  it("duplicate impressions (one after another and at the same time) count once and change no money", async () => {
    const w = world();
    const { campaignId } = w.db.addAd(w.advertiserId, { totalBudget: 10 });
    const { token } = await serveWithTracking(w);
    const before = snap(w, campaignId);
    const results = [await impression(token), await impression(token), ...(await Promise.all([impression(token), impression(token), impression(token)]))];
    assert.equal(results.filter((r) => r.status === 200).length, results.length);
    assert.equal(w.events.impressions.size, 1);
    assertUnchanged(before, snap(w, campaignId), "impressions");
  });

  it("duplicate clicks, a click before any impression and forged / unknown click references change no money", async () => {
    const w = world();
    const { campaignId } = w.db.addAd(w.advertiserId, { totalBudget: 10 });
    const { token, serve: s } = await serveWithTracking(w);
    const before = snap(w, campaignId);
    const ref = refFor(s);
    assert.equal((await click(ref)).status, 302); // click before impression: redirect only
    assert.equal(w.events.clicks.size, 0);
    await impression(token);
    for (let i = 0; i < 3; i += 1) assert.equal((await click(ref)).status, 302);
    await Promise.all([click(ref), click(ref)]);
    assert.equal(w.events.clicks.size, 1);
    for (const bad of ["bc1.forged.value", "", "x".repeat(300)]) assert.notEqual((await click(bad)).status, 302, bad);
    assertUnchanged(before, snap(w, campaignId), "clicks");
  });

  it("a failed impression / click write (database down) answers 503 and creates no money; the retry is recorded once and still creates no money", async () => {
    const w = world();
    const { campaignId } = w.db.addAd(w.advertiserId, { totalBudget: 10 });
    const { token, serve: s } = await serveWithTracking(w);
    const before = snap(w, campaignId);
    w.events.fail.record_ad_impression = { data: null, error: { code: "XX000", message: "db down" } };
    assert.equal((await impression(token)).status, 503);
    assert.equal(w.events.impressions.size, 0);
    delete w.events.fail.record_ad_impression;
    assert.equal((await impression(token)).status, 200);
    assert.equal((await impression(token)).status, 200);
    assert.equal(w.events.impressions.size, 1);
    w.events.fail.record_ad_click = { data: null, error: { code: "XX000", message: "db down" } };
    const down = await click(refFor(s));
    assert.notEqual(down.status, 302, "no redirect that pretends a click was counted... or a safe failure");
    delete w.events.fail.record_ad_click;
    await click(refFor(s));
    await click(refFor(s));
    assert.equal(w.events.clicks.size, 1);
    assertUnchanged(before, snap(w, campaignId), "tracking failures + retries");
  });

  it("serve -> impression -> click on one ad is billed once, at serve time only: ledger rows are the same before and after the tracking events", async () => {
    const w = world();
    const { campaignId } = w.db.addAd(w.advertiserId, { totalBudget: 10 });
    const { token, serve: s } = await serveWithTracking(w);
    assert.equal(w.m.entries.length, 3);
    await impression(token);
    await click(refFor(s));
    assert.equal(w.m.entries.length, 3);
    assertReconciles(w, campaignId);
  });

  it("a mixed run (serves with and without keys, retries, faults, rejected serves, tracking duplicates, budget end) always reconciles", async () => {
    const w = world();
    const { campaignId } = w.db.addAd(w.advertiserId, { totalBudget: 0.05 }); // 25 serves at most
    let seed = 20261030;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const tokens: string[] = [];
    for (let i = 0; i < 80; i += 1) {
      const who = rnd(2) === 0 ? w.a : w.b;
      switch (rnd(8)) {
        case 0: // fault, then the retry
          w.m.failLedgerWrites = true;
          await serve(w, who, { "idempotency-key": `mixed-key-${i}-aaaa` });
          w.m.failLedgerWrites = false;
          await serve(w, who, { "idempotency-key": `mixed-key-${i}-aaaa` });
          break;
        case 1: // rejected in the race
          w.db.failRpc.record_ad_serve = { data: { outcome: "rejected" }, error: null };
          await serve(w, who);
          delete w.db.failRpc.record_ad_serve;
          break;
        case 2: // outage
          w.db.failRpc.record_ad_serve = { data: null, error: { code: "XX000" } };
          await serve(w, who, { "idempotency-key": `mixed-out-${i}-bbbb` });
          delete w.db.failRpc.record_ad_serve;
          await serve(w, who, { "idempotency-key": `mixed-out-${i}-bbbb` });
          break;
        case 3: {
          const res = await serve(w, who, { "x-blisscco-tracking": "1" });
          const t = (res.json.tracking as { token?: string } | undefined)?.token;
          if (t) tokens.push(t);
          break;
        }
        case 4:
          for (let k = 0; k < 3; k += 1) await serve(w, who, { "idempotency-key": `mixed-same-${i}-cccc` });
          break;
        case 5:
          if (tokens.length > 0) await impression(tokens[rnd(tokens.length)]);
          break;
        case 6:
          await Promise.all([serve(w, who), serve(w, who, { "idempotency-key": `mixed-par-${i}-dddd` }), serve(w, who, { "idempotency-key": `mixed-par-${i}-dddd` })]);
          break;
        default:
          await serve(w, who);
      }
    }
    assert.ok(w.db.serveLog.length > 5, "the run really served ads");
    assert.ok(spendU(w, campaignId) <= 500n, "never beyond the total budget");
    assertReconciles(w, campaignId);
    const sumPublishers = w.m.publisherBalance(w.a.publisherId) + w.m.publisherBalance(w.b.publisherId);
    assert.equal(sumPublishers + w.m.sum((e) => e.type === "platform_revenue"), w.m.sum((e) => e.type === "advertiser_charge"));
  });

  it("no log line from any of these flows carries a key, token, amount or id", async () => {
    const w = world();
    w.db.addAd(w.advertiserId, { totalBudget: 10 });
    w.m.failLedgerWrites = true;
    await serve(w, w.a, { "x-blisscco-tracking": "1" });
    w.m.failLedgerWrites = false;
    const { token } = await serveWithTracking(w);
    w.events.fail.record_ad_impression = { data: null, error: { code: "XX000", message: "db down 0.0020" } };
    await impression(token);
    w.m.signIn(w.a.profileId);
    await askPayout("9.0000", reqKey(1));
    const text = logged.join("\n");
    for (const secret of [w.a.key, token, w.a.publisherId, "0.0020", "9.0000", reqKey(1)]) assert.equal(text.includes(secret), false, secret);
  });
});
