import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as clickRoute from "@/app/api/v1/ads/click/route";
import { acceptClick, type ClickDeps } from "@/lib/ads/click";
import { lookupServeForClick, recordClickEvent } from "@/lib/ads/click-db";
import { FAILURES_PER_MINUTE_PER_IP, REQUESTS_PER_MINUTE_PER_IP, handleClickGet } from "@/lib/ads/click-handler";
import { creativeTag, mintClickRef, verifyClickRef } from "@/lib/ads/click-ref";
import { createIpGuard } from "@/lib/ads/ip-guard";
import { handleMatchPost } from "@/lib/ads/match-handler";
import type { AdProviderAdapter, AdProviderClickEvent } from "@/lib/ads/provider-adapter";
import { SERVE_REF_RE, publisherTag, readTrackingConfig } from "@/lib/ads/tracking-token";
import { FakeAdDb, makeKey, type ServeLogRow, type ServeRecordedEvent } from "./fake-ad-db";

// Day 17 Part 4: publisher click-tracking ka END-TO-END regression:
//   POST match (tracking opt-in) -> response se tracking.click_ref -> GET click (ASLI handleClickGet) -> redirect / 404 / 204 / 400 / 503.
// Database NAKLI hai: FakeAdDb (serve/spend, day-9-5 + day-12-5 ka model) + ClickStore (lookup_serve_for_click / record_ad_click ka model, day-12-10 padhkar).
// Production wiring bhi asli chalti hai: handleClickGet -> service.acceptClickForRef -> click-db.ts (parse) -> nakli rpc. Koi SQL execute nahi hoti.
// Koi asli Supabase / advertiser website / network call nahi. Secrets sirf test ke. Clock FIXED (Date.now stub).
//
// LIMIT (saaf): ye MOCKED / MODEL tests hain. Ye DATABASE INTEGRATION TEST NAHI hai: day-12-10 SQL (unique constraint, eligibility join, D4, 24h cap)
// kisi asli database par yahan sabit NAHI hota. Sabit ye hota hai: asli TypeScript code (match handler, serve, click handler, click.ts, click-ref.ts,
// click-db.ts, provider-adapter.ts) SQL-niyam ke model ke saath sahi baat karta hai.
// "Publisher earnings" yahan serve-ledger event (record_ad_serve ke andar ka hook) se naapi jaati hai: click rasta us hook ko kabhi nahi chhuta.

const SECRET = "k7f2-0123456789-abcdefghijklmnopqrstuvwxyz-primary";
const OTHER_SECRET = "m4q9-0123456789-abcdefghijklmnopqrstuvwxyz-rotated";
const SERVED_AT = Date.UTC(2026, 9, 27, 10, 0, 30); // FakeAdDb.nowMs ke barabar; serve ka samay
const NOW = SERVED_AT + 5_000;
const TTL_MS = 3_600_000;
const HOUR = 3_600_000;
const KEY_A = makeKey("a");
const TRACK = { "x-blisscco-tracking": "1" };
const BASE = "https://blisscco.test/api/v1/ads/click";
const DB_DESTINATION = "https://advertiser.example.com/db-landing?utm_source=blisscco";
const CLICK_RPCS = ["lookup_serve_for_click", "record_ad_click"];
const CLICK_REF_RE = /^bc1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
const realNow = Date.now;
const realError = console.error;
const ENV_NAMES = ["AD_TRACKING_SECRET", "AD_TRACKING_SECRET_PREVIOUS", "AD_TRACKING_TTL_SECONDS"] as const;
let savedEnv: Record<string, string | undefined> = {};
const clock = { now: NOW };

// ===========================================================================================================================
// Nakli click store: day-12-10 SQL ka MODEL (SQL khud nahi).
type Reply = { data: unknown; error: { code?: string; message?: string } | null };
type Internals = {
  creatives: Map<string, { status: string; destinationUrl: string; campaignId: string; advertiserId: string }>;
  campaigns: Map<string, { status: string; startDate: string; endDate: string | null }>;
  advertisers: Map<string, { status: string; profileStatus: string }>;
};
const internals = (db: FakeAdDb): Internals => db as unknown as Internals;

class ClickStore {
  /** serve_ref (ek serve = ek impression, ek click: unique constraint ka model). */
  impressions = new Set<string>();
  clicks = new Map<string, number>();
  calls: { name: string; args: Record<string, unknown> }[] = [];
  fail: Record<string, Reply | undefined> = {};
  throwOn = new Set<string>();
  /** Knob: record_ad_click ka destination_url (lookup se alag) = "record ke waqt DB ne kya diya". */
  recordDestination: string | null = null;
  constructor(private readonly db: FakeAdDb) {}

  count(name: string): number {
    return this.calls.filter((c) => c.name === name).length;
  }
  addImpression(serveRef: string): void {
    this.impressions.add(serveRef);
  }
  private serve(ref: unknown): ServeLogRow | undefined {
    return typeof ref === "string" && SERVE_REF_RE.test(ref) ? this.db.serveLog.find((s) => s.serveRef === ref) : undefined;
  }
  /** private.click_target: creative approved + campaign active + schedule + advertiser/profile active => destination, warna null. */
  private target(creativeId: string): string | null {
    const i = internals(this.db);
    const cr = i.creatives.get(creativeId);
    const camp = cr ? i.campaigns.get(cr.campaignId) : undefined;
    const adv = cr ? i.advertisers.get(cr.advertiserId) : undefined;
    if (!cr || !camp || !adv) return null;
    const today = new Date(clock.now).toISOString().slice(0, 10);
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
    if (name === "lookup_serve_for_click") {
      if (!s) return ok({ outcome: "not_found" });
      const dest = this.target(s.creativeId);
      return ok({
        outcome: "found",
        publisher_id: s.publisherId,
        creative_id: s.creativeId,
        served_at: new Date(s.servedAtMs).toISOString(),
        destination_url: dest,
        eligible: dest !== null,
      });
    }
    if (name === "record_ad_click") {
      if (!s || s.publisherId !== args.p_publisher_id || s.creativeId !== args.p_creative_id || clock.now > s.servedAtMs + 24 * HOUR) {
        return ok({ outcome: "rejected" });
      }
      const dest = this.target(s.creativeId);
      if (dest === null) return ok({ outcome: "ineligible" });
      const out = this.recordDestination ?? dest;
      if (!this.impressions.has(s.serveRef)) return ok({ outcome: "not_counted", destination_url: out }); // D4: pehle impression
      if (this.clicks.has(s.serveRef)) return ok({ outcome: "duplicate", destination_url: out });
      this.clicks.set(s.serveRef, clock.now);
      return ok({ outcome: "recorded", destination_url: out });
    }
    throw new Error(`test: unexpected click rpc ${name}`);
  }
}

// ===========================================================================================================================
let db: FakeAdDb;
let store: ClickStore;
let serveEvents: ServeRecordedEvent[];
let logged: string[];

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_NAMES.map((n) => [n, process.env[n]]));
  process.env.AD_TRACKING_SECRET = SECRET;
  delete process.env.AD_TRACKING_SECRET_PREVIOUS;
  delete process.env.AD_TRACKING_TTL_SECONDS;
  clock.now = NOW;
  Date.now = () => clock.now;
  logged = [];
  console.error = (...a: unknown[]) => {
    logged.push(a.map(String).join(" "));
  };
  db = new FakeAdDb();
  db.serveTimeMs = SERVED_AT;
  serveEvents = [];
  db.onServeRecorded = (e) => {
    serveEvents.push(e); // serve-ledger hook: advertiser charge / publisher earning ka ek-matra source
  };
  store = new ClickStore(db);
  globals.__TEST_SUPABASE__ = {
    rpc: async (name: string, args: Record<string, unknown> = {}) => (CLICK_RPCS.includes(name) ? store.rpc(name, args) : db.client().rpc(name, args)),
  };
});
afterEach(() => {
  Date.now = realNow;
  console.error = realError;
  for (const n of ENV_NAMES) {
    if (savedEnv[n] === undefined) delete process.env[n];
    else process.env[n] = savedEnv[n];
  }
  delete globals.__TEST_SUPABASE__;
});

// ----- helpers ------------------------------------------------------------------------------------------------------------
const cfg = () => {
  const c = readTrackingConfig({ AD_TRACKING_SECRET: SECRET });
  assert.ok(c);
  return c;
};

function world() {
  const pub = db.addPublisher("active");
  db.addKey(pub.id, KEY_A);
  const adv = db.addAdvertiser("active");
  const ad = db.addAd(adv.id, { category: "gaming", totalBudget: 10, dailyBudget: 5 });
  return { pub, adv, ad };
}
const setDbDestination = (creativeId: string, url: string): void => {
  const cr = internals(db).creatives.get(creativeId);
  assert.ok(cr);
  cr.destinationUrl = url;
};

type Body = Record<string, unknown> & { ad?: Record<string, unknown>; tracking?: Record<string, unknown> };
async function match(headers: Record<string, string> = TRACK): Promise<{ status: number; body: Body; text: string }> {
  const res = await handleMatchPost(
    new Request("https://blisscco.test/api/v1/ads/match", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY_A}`, ...headers },
      body: JSON.stringify({ topic: "gaming" }),
    }),
    { ipGuard: createIpGuard() },
  );
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text) as Body, text };
}

/** Pura flow ka pehla hissa: tracking-enabled match -> click_ref nikalo. Ye ref asli response se aata hai, mint se nahi. */
async function serveWithClickRef() {
  const w = world();
  const m = await match();
  assert.equal(m.status, 200, m.text);
  const clickRef = m.body.tracking?.click_ref;
  assert.equal(typeof clickRef, "string");
  const serve = db.serveLog[db.serveLog.length - 1];
  assert.ok(serve);
  return { ...w, m, ref: clickRef as string, serve };
}

type Http = { status: number; headers: Headers; location: string | null; text: string };
type ClickOpts = {
  headers?: Record<string, string>;
  accept?: (ref: unknown) => ReturnType<typeof acceptClick>;
  requestGuard?: ReturnType<typeof createIpGuard>;
  failureGuard?: ReturnType<typeof createIpGuard>;
};
async function clickQuery(query: string, opts: ClickOpts = {}): Promise<Http> {
  const res = await handleClickGet(new Request(`${BASE}${query}`, { method: "GET", headers: opts.headers ?? {} }), {
    ...(opts.accept ? { accept: opts.accept } : {}),
    requestGuard: opts.requestGuard ?? createIpGuard(REQUESTS_PER_MINUTE_PER_IP),
    failureGuard: opts.failureGuard ?? createIpGuard(FAILURES_PER_MINUTE_PER_IP),
  });
  return { status: res.status, headers: res.headers, location: res.headers.get("location"), text: await res.text() };
}
const click = (ref: string, opts: ClickOpts = {}) => clickQuery(`?ref=${encodeURIComponent(ref)}`, opts);
/** Injectable raasta: asli acceptClick + asli click-db bridge, par deps (adapter, config) test ke haath me. */
const acceptWith = (over: Partial<ClickDeps> = {}) => (ref: unknown) =>
  acceptClick(ref, { config: cfg(), nowMs: () => clock.now, lookupServe: lookupServeForClick, record: recordClickEvent, ...over });

const mintFor = (serve: ServeLogRow, over: Partial<{ publisherId: string; creativeId: string; secret: string }> = {}): string => {
  const config = over.secret ? { secrets: [over.secret], ttlSeconds: 3600 } : cfg();
  const grant = mintClickRef(config, {
    serveRef: serve.serveRef,
    publisherId: over.publisherId ?? serve.publisherId,
    creativeId: over.creativeId ?? serve.creativeId,
    servedAtMs: serve.servedAtMs,
    nowMs: clock.now,
  });
  assert.ok(grant, "click ref expected");
  return grant.ref;
};
const financialSnapshot = () =>
  JSON.stringify({
    spend: [...db.spend.entries()],
    serveLog: db.serveLog,
    serveEvents,
    nonClickRpcs: db.calls.map((c) => c.name),
  });

// ===========================================================================================================================
describe("day 17 part 4 | match -> click_ref -> handleClickGet: the first click", () => {
  it("a tracking-enabled match response carries a valid click_ref; without opt-in there is nothing to click", async () => {
    const { m, ref, serve, pub, ad } = await serveWithClickRef();
    assert.match(ref, CLICK_REF_RE);
    assert.equal(m.text.split("bc1.").length - 1, 1);
    const v = verifyClickRef(ref, cfg(), clock.now);
    assert.ok(v.ok);
    assert.equal(v.ok && v.claims.serveRef, serve.serveRef);
    assert.equal(v.ok && v.claims.publisherTag, publisherTag(SECRET, pub.id));
    assert.equal(v.ok && v.claims.creativeTag, creativeTag(SECRET, ad.creativeId));

    const plain = await match({});
    assert.equal(plain.status, 200);
    assert.equal("tracking" in plain.body, false);
    assert.equal(plain.text.includes("bc1."), false);
  });

  it("valid ref + impression: 302 to the DATABASE destination (not the match response's), first click recorded once, safe headers", async () => {
    const { ref, serve, pub, ad, m } = await serveWithClickRef();
    store.addImpression(serve.serveRef);
    setDbDestination(ad.creativeId, DB_DESTINATION); // advertiser ne serve ke baad destination badli: redirect DB row ka follow karta hai
    assert.notEqual(m.body.ad?.destination_url, DB_DESTINATION);

    const callsBefore = db.calls.length;
    const res = await click(ref);
    assert.equal(res.status, 302);
    assert.equal(res.location, new URL(DB_DESTINATION).href);
    assert.notEqual(res.location, m.body.ad?.destination_url);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("access-control-allow-origin"), null);
    assert.equal(res.text.includes(ref), false, "ref is never echoed back");

    // sahi click-processing path: lookup, phir EK record. Publisher + creative DATABASE ke serve row se, ref/caller se nahi.
    assert.deepEqual(store.calls.map((c) => c.name), ["lookup_serve_for_click", "record_ad_click"]);
    assert.deepEqual(store.calls[0].args, { p_serve_ref: serve.serveRef });
    assert.deepEqual(store.calls[1].args, { p_serve_ref: serve.serveRef, p_publisher_id: pub.id, p_creative_id: ad.creativeId });
    assert.equal(store.clicks.size, 1);
    assert.ok(store.clicks.has(serve.serveRef));
    assert.equal(db.calls.length, callsBefore, "click path never touches serve/authorize/candidate rpcs");
  });

  it("the real route file (GET) reaches the same path", async () => {
    const { ref, serve } = await serveWithClickRef();
    store.addImpression(serve.serveRef);
    const res = await clickRoute.GET(new Request(`${BASE}?ref=${encodeURIComponent(ref)}`, { headers: { "x-forwarded-for": "203.0.113.77" } }));
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), new URL("https://example.com/landing").href);
    assert.equal(store.clicks.size, 1);
  });

  it("a click before any impression still redirects but is not counted (D4); it counts once the impression exists", async () => {
    const { ref, serve } = await serveWithClickRef();
    const early = await click(ref);
    assert.equal(early.status, 302);
    assert.equal(store.clicks.size, 0);
    store.addImpression(serve.serveRef);
    assert.equal((await click(ref)).status, 302);
    assert.equal(store.clicks.size, 1);
  });
});

// ===========================================================================================================================
describe("day 17 part 4 | duplicates redirect, they never record twice", () => {
  it("repeat and concurrent clicks: every one redirects to the same URL, exactly one click exists", async () => {
    const { ref, serve } = await serveWithClickRef();
    store.addImpression(serve.serveRef);
    const first = await click(ref);
    assert.equal(first.status, 302);
    for (let i = 0; i < 3; i += 1) {
      const again = await click(ref);
      assert.equal(again.status, 302);
      assert.equal(again.location, first.location);
    }
    const burst = await Promise.all(Array.from({ length: 6 }, () => click(ref)));
    assert.ok(burst.every((r) => r.status === 302 && r.location === first.location));
    assert.equal(store.clicks.size, 1);
    assert.equal(store.clicks.get(serve.serveRef), NOW, "the first click's time is never overwritten");
  });
});

// ===========================================================================================================================
describe("day 17 part 4 | unauthorized references never redirect", () => {
  async function assertDenied(ref: string, expectLookup: boolean) {
    const res = await click(ref);
    assert.equal(res.status, 404);
    assert.equal(res.location, null);
    assert.equal(store.count("record_ad_click"), 0, "no write attempt");
    assert.equal(store.clicks.size, 0);
    assert.equal(store.count("lookup_serve_for_click") > 0, expectLookup);
    return res.text;
  }

  it("expired ref (exactly at exp), invalid signatures, tampered payload and other-secret refs: same 404 body, no database call", async () => {
    const { ref, serve } = await serveWithClickRef();
    store.addImpression(serve.serveRef);
    const [prefix, payload, sig] = ref.split(".");
    const original = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    const forgedPayload = Buffer.from(JSON.stringify({ ...original, exp: (original.exp as number) + 5_000 })).toString("base64url");
    const zeroSig = Buffer.alloc(32).toString("base64url");

    const bodies = new Set<string>();
    bodies.add(await assertDenied(`${prefix}.${payload}.${zeroSig}`, false)); // galat signature
    bodies.add(await assertDenied(`${prefix}.${forgedPayload}.${sig}`, false)); // payload badla, signature purani
    bodies.add(await assertDenied(mintFor(serve, { secret: OTHER_SECRET }), false)); // anjaane secret ka ref
    clock.now = SERVED_AT + TTL_MS; // exp ke barabar = expired
    bodies.add(await assertDenied(ref, false));
    clock.now = SERVED_AT + TTL_MS + 7 * HOUR;
    bodies.add(await assertDenied(ref, false));
    assert.equal(bodies.size, 1, "one generic body: no oracle for the reason");
    assert.equal(store.calls.length, 0);

    clock.now = SERVED_AT + TTL_MS - 1; // aakhri millisecond tak valid
    assert.equal((await click(ref)).status, 302);
  });

  it("publisher mismatch and creative mismatch: 404, lookup happens, but no record and no redirect", async () => {
    const { ref, serve } = await serveWithClickRef();
    store.addImpression(serve.serveRef);
    const otherPub = db.addPublisher("active");
    const otherAd = db.addAd(db.addAdvertiser("active").id, { category: "gaming" });

    const bodies = new Set<string>();
    bodies.add(await assertDenied(mintFor(serve, { publisherId: otherPub.id }), true));
    bodies.add(await assertDenied(mintFor(serve, { creativeId: otherAd.creativeId }), true));
    // anjaani serve (ref valid, serve DB me nahi)
    const ghost = { ...serve, serveRef: `bsr_${"cd".repeat(20)}` };
    bodies.add(await assertDenied(mintFor(ghost), true));
    assert.equal(bodies.size, 1);
    assert.equal((await click(ref)).status, 302, "the genuine ref is unaffected");
    assert.equal(store.clicks.size, 1);
  });

  it("a bt1 tracking token or any garbage is never accepted as a click ref", async () => {
    const { m, serve } = await serveWithClickRef();
    store.addImpression(serve.serveRef);
    await assertDenied(String(m.body.tracking?.token), false);
    for (const junk of ["bc1", "bc1.a.b", "https://evil.example", `bc1.${"a".repeat(600)}.b`]) {
      const res = await click(junk);
      assert.ok(res.status === 404 || res.status === 400, junk.slice(0, 20));
      assert.equal(res.location, null);
    }
    assert.equal(store.clicks.size, 0);
  });
});

// ===========================================================================================================================
describe("day 17 part 4 | existing safe behaviour is retained", () => {
  it("prefetch / prerender: 204, no redirect, no database call, no click", async () => {
    const { ref, serve } = await serveWithClickRef();
    store.addImpression(serve.serveRef);
    for (const h of [{ "sec-purpose": "prefetch" }, { purpose: "prefetch" }, { "sec-purpose": "prefetch;prerender" }, { "x-moz": "prefetch" }, { "next-router-prefetch": "1" }]) {
      const res = await click(ref, { headers: h });
      assert.equal(res.status, 204, JSON.stringify(h));
      assert.equal(res.location, null);
    }
    assert.equal(store.calls.length, 0);
    assert.equal(store.clicks.size, 0);
  });

  it("malformed query parameters: 400, nothing is looked up or recorded, no redirect", async () => {
    const { ref, serve } = await serveWithClickRef();
    store.addImpression(serve.serveRef);
    const q = encodeURIComponent(ref);
    for (const qs of [
      "",
      "?ref=",
      `?ref=${q}&url=https%3A%2F%2Fevil.example`,
      `?ref=${q}&redirect=//evil.example`,
      `?ref=${q}&destination_url=https://evil.example`,
      "?url=https%3A%2F%2Fevil.example",
      `?ref=${q}&ref=${q}`,
      `?REF=${q}`,
      `?ref=${"a".repeat(513)}`,
    ]) {
      const res = await clickQuery(qs);
      assert.equal(res.status, 400, qs.slice(0, 40));
      assert.equal(res.location, null);
    }
    assert.equal(store.calls.length, 0);
    assert.equal(store.clicks.size, 0);
  });

  it("unavailable database or config: 503, never a redirect, never a click; retry afterwards works", async () => {
    const { ref, serve } = await serveWithClickRef();
    store.addImpression(serve.serveRef);
    const down = async () => {
      const res = await click(ref);
      assert.equal(res.status, 503);
      assert.equal(res.location, null);
      assert.equal(store.clicks.size, 0);
      assert.equal(res.text.includes("secret internal detail"), false, "no database detail leaks");
    };
    store.fail.lookup_serve_for_click = { data: null, error: { code: "XX000", message: "secret internal detail" } };
    await down();
    store.fail.lookup_serve_for_click = { data: { outcome: "found", publisher_id: "nope" }, error: null }; // bigda hua shape
    await down();
    delete store.fail.lookup_serve_for_click;
    store.throwOn.add("lookup_serve_for_click");
    await down();
    store.throwOn.delete("lookup_serve_for_click");
    store.fail.record_ad_click = { data: null, error: { code: "40001", message: "secret internal detail" } };
    await down();
    store.fail.record_ad_click = { data: { outcome: "recorded" }, error: null }; // destination_url missing => recorded nahi maana jaata
    await down();
    store.throwOn.add("record_ad_click");
    await down();
    store.throwOn.delete("record_ad_click");
    delete store.fail.record_ad_click;

    delete process.env.AD_TRACKING_SECRET; // secret nahi => koi ref verify nahi ho sakta
    const before = store.calls.length;
    await down();
    assert.equal(store.calls.length, before, "no database call without a signing secret");
    process.env.AD_TRACKING_SECRET = SECRET;

    const ok = await click(ref);
    assert.equal(ok.status, 302);
    assert.equal(store.clicks.size, 1);
    assert.ok(logged.every((l) => !l.includes(ref) && !l.includes(SECRET) && !l.includes(serve.serveRef)), "logs carry no ref, secret or serve ref");
  });

  it("unsafe or unusable destinations: 404, no redirect, no click, no write attempt", async () => {
    const { ref, serve, ad } = await serveWithClickRef();
    store.addImpression(serve.serveRef);
    for (const bad of [
      "http://advertiser.example.com/",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "//evil.example.com/",
      "https://user:pass@advertiser.example.com/",
      "https://127.0.0.1/",
      "https://localhost/",
      "https://example.com/has space",
      `https://example.com/${"a".repeat(2100)}`,
    ]) {
      setDbDestination(ad.creativeId, bad);
      const res = await click(ref);
      assert.equal(res.status, 404, bad.slice(0, 40));
      assert.equal(res.location, null);
    }
    assert.equal(store.count("record_ad_click"), 0);
    assert.equal(store.clicks.size, 0);

    // theek destination par seedha lauto; phir creative pause => ab bhi koi redirect nahi
    setDbDestination(ad.creativeId, DB_DESTINATION);
    db.setCreativeStatus(ad.creativeId, "paused");
    const paused = await click(ref);
    assert.equal(paused.status, 404);
    assert.equal(paused.location, null);
    assert.equal(store.clicks.size, 0);
    db.setCreativeStatus(ad.creativeId, "approved");

    // record ke waqt DB ne unsafe URL diya => ab bhi follow nahi
    store.recordDestination = "https://127.0.0.1/";
    const late = await click(ref);
    assert.equal(late.status, 404);
    assert.equal(late.location, null);
  });

  it("rate limits are not weakened: documented limits, 429 before any lookup, repeated bad refs are counted", async () => {
    assert.equal(REQUESTS_PER_MINUTE_PER_IP, 300);
    assert.equal(FAILURES_PER_MINUTE_PER_IP, 30);
    const { ref, serve } = await serveWithClickRef();
    store.addImpression(serve.serveRef);
    const ip = { "x-forwarded-for": "203.0.113.9" };
    const tiny = { requestGuard: createIpGuard(2), failureGuard: createIpGuard(30) };
    const statuses = [] as number[];
    for (let i = 0; i < 3; i += 1) statuses.push((await click(ref, { headers: ip, ...tiny })).status);
    assert.deepEqual(statuses, [302, 302, 429]);
    assert.equal(store.count("lookup_serve_for_click"), 2, "the 429 request never reached the database");

    const failTiny = { requestGuard: createIpGuard(300), failureGuard: createIpGuard(2) };
    const bad: number[] = [];
    for (let i = 0; i < 4; i += 1) bad.push((await click("bc1.x.y", { headers: ip, ...failTiny })).status);
    assert.deepEqual(bad, [404, 404, 429, 429]);
  });
});

// ===========================================================================================================================
describe("day 17 part 4 | click tracking never moves money", () => {
  it("recorded, duplicate, not-counted, denied and prefetch clicks leave serve charge, campaign budget and publisher earnings untouched", async () => {
    const { ref, serve, ad, pub } = await serveWithClickRef();
    assert.equal(serveEvents.length, 1);
    assert.deepEqual(serveEvents[0], { serveRef: serve.serveRef, campaignId: ad.campaignId, publisherId: pub.id, unitUsd: db.unitCostUsd });
    const before = financialSnapshot();
    const spentBefore = db.spendOf(ad.campaignId);
    assert.equal(spentBefore, db.unitCostUsd);

    await click(ref); // not_counted (impression abhi nahi)
    store.addImpression(serve.serveRef);
    await click(ref); // recorded
    await click(ref); // duplicate
    await click(ref, { headers: { "sec-purpose": "prefetch" } }); // 204
    await click(mintFor(serve, { secret: OTHER_SECRET })); // denied
    await clickQuery("?ref=x&url=https%3A%2F%2Fevil.example"); // 400
    store.throwOn.add("record_ad_click");
    await click(ref); // 503
    store.throwOn.delete("record_ad_click");
    assert.equal(store.clicks.size, 1);

    assert.equal(financialSnapshot(), before, "serve log, spend, ledger events and non-click rpcs are byte-for-byte unchanged");
    assert.equal(db.spendOf(ad.campaignId), spentBefore);
    assert.equal(db.rpcCount("record_ad_serve"), 1);
    assert.equal(serveEvents.length, 1);
    assert.ok(store.calls.every((c) => CLICK_RPCS.includes(c.name)), "click path only ever calls the two click rpcs");
  });

  it("the budget is still consumed by serves only: another match after many clicks charges exactly one more unit", async () => {
    const { ref, serve, ad } = await serveWithClickRef();
    store.addImpression(serve.serveRef);
    for (let i = 0; i < 5; i += 1) await click(ref);
    assert.equal(db.spendOf(ad.campaignId), db.unitCostUsd);
    const second = await match();
    assert.equal(second.status, 200);
    assert.equal(db.spendOf(ad.campaignId), Math.round(db.unitCostUsd * 2 * 1e6) / 1e6);
    assert.equal(serveEvents.length, 2);
    assert.equal(db.rpcCount("record_ad_serve"), 2);
  });
});

// ===========================================================================================================================
describe("day 17 part 4 | the provider adapter is optional and never controls the redirect", () => {
  const events: AdProviderClickEvent[] = [];
  const spy = (extra: Partial<AdProviderAdapter> = {}): AdProviderAdapter => ({
    name: "test-adapter",
    onClickRecorded: async (e) => {
      events.push(e);
    },
    ...extra,
  });
  beforeEach(() => {
    events.length = 0;
  });

  it("no adapter (default) and a spy adapter give the same redirect; the adapter hears only the FIRST recorded click, with internal ids only", async () => {
    const { ref, serve, pub, ad } = await serveWithClickRef();
    store.addImpression(serve.serveRef);
    const plain = await click(ref, { accept: acceptWith() });
    assert.equal(plain.status, 302);

    // dusra serve (naya click) adapter ke saath
    const second = await match();
    const ref2 = second.body.tracking?.click_ref as string;
    const serve2 = db.serveLog[db.serveLog.length - 1];
    store.addImpression(serve2.serveRef);
    const outcomes: string[] = [];
    const withAdapter = acceptWith({ adapter: spy(), onAdapterOutcome: (d) => outcomes.push(d) });
    const r1 = await click(ref2, { accept: withAdapter });
    const r2 = await click(ref2, { accept: withAdapter }); // duplicate
    assert.equal(r1.status, 302);
    assert.equal(r2.location, r1.location);
    assert.equal(r1.location, plain.location, "adapter presence does not change the destination");
    assert.equal(events.length, 1, "duplicate is not forwarded");
    assert.deepEqual(outcomes, ["delivered"]);
    assert.deepEqual(Object.keys(events[0]).sort(), ["creativeId", "occurredAtMs", "publisherId", "serveRef"]);
    assert.equal(events[0].serveRef, serve2.serveRef);
    assert.equal(events[0].publisherId, pub.id);
    assert.equal(events[0].creativeId, ad.creativeId);
    assert.equal(Object.isFrozen(events[0]), true);
    const serialized = JSON.stringify(events[0]);
    assert.ok(!serialized.includes("https") && !serialized.includes("bc1.") && !serialized.includes(SECRET));
    assert.equal(serve.serveRef === serve2.serveRef, false);
  });

  it("a failing, throwing or hanging adapter changes nothing: still 302 to the same URL, click still recorded", async () => {
    await serveWithClickRef(); // world + pehla serve; har broken adapter ko apna NAYA serve (pehla click) milta hai
    const expected = new URL("https://example.com/landing").href;
    const outcomes: string[] = [];
    const broken: AdProviderAdapter[] = [
      { name: "rejects", onClickRecorded: async () => Promise.reject(new Error("adapter down")) },
      { name: "throws", onClickRecorded: () => { throw new Error("sync boom"); } },
      { name: "hangs", onClickRecorded: () => new Promise<void>(() => {}) },
    ];
    for (const [i, adapter] of broken.entries()) {
      const m = await match();
      const ref = m.body.tracking?.click_ref as string;
      const serve = db.serveLog[db.serveLog.length - 1];
      store.addImpression(serve.serveRef);
      const res = await click(ref, { accept: acceptWith({ adapter, adapterTimeoutMs: 25, onAdapterOutcome: (d) => outcomes.push(d) }) });
      assert.equal(res.status, 302, adapter.name);
      assert.equal(res.location, expected, adapter.name);
      assert.ok(store.clicks.has(serve.serveRef), `recorded by Blisscco itself (round ${i})`);
    }
    assert.deepEqual(outcomes, ["failed", "failed", "timeout"]);
  });

  it("an adapter cannot supply or override the destination (return value is ignored)", async () => {
    const { ref, serve, ad } = await serveWithClickRef();
    store.addImpression(serve.serveRef);
    setDbDestination(ad.creativeId, DB_DESTINATION);
    const hostile: AdProviderAdapter = {
      name: "hostile",
      onClickRecorded: (async () => ({ destination: "https://evil.example/", location: "https://evil.example/" })) as unknown as AdProviderAdapter["onClickRecorded"],
    };
    const res = await click(ref, { accept: acceptWith({ adapter: hostile }) });
    assert.equal(res.status, 302);
    assert.equal(res.location, new URL(DB_DESTINATION).href);
  });

  it("the adapter is never called for denied, prefetch, malformed, unavailable or ineligible clicks, and never touches money", async () => {
    const { ref, serve, ad } = await serveWithClickRef();
    store.addImpression(serve.serveRef);
    const accept = acceptWith({ adapter: spy() });
    const before = financialSnapshot();

    await click(mintFor(serve, { secret: OTHER_SECRET }), { accept });
    await click(ref, { accept, headers: { "sec-purpose": "prefetch" } });
    await clickQuery("?ref=x&url=https%3A%2F%2Fevil.example", { accept });
    store.fail.record_ad_click = { data: null, error: { code: "40001" } };
    assert.equal((await click(ref, { accept })).status, 503);
    delete store.fail.record_ad_click;
    db.setCreativeStatus(ad.creativeId, "paused");
    assert.equal((await click(ref, { accept })).status, 404);
    db.setCreativeStatus(ad.creativeId, "approved");

    assert.equal(events.length, 0);
    assert.equal(store.clicks.size, 0);
    assert.equal(financialSnapshot(), before);
  });
});
