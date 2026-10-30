import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as v1Route from "@/app/api/v1/ads/match/route";
import { buildAdResponse } from "@/lib/ads/contract";
import { verifyClickRef, verifyClickRefForServe } from "@/lib/ads/click-ref";
import { serveAd, type ServeDeps } from "@/lib/ads/serve";
import { readTrackingConfig } from "@/lib/ads/tracking-token";
import { FakeAdDb, makeKey } from "./fake-ad-db";

// Day 17 Part 1: signed click_ref ka issue (serve -> service -> contract). Database NAKLI (FakeAdDb); SQL/asli DB nahi chhuta.

const SECRET = "k7f2-0123456789-abcdefghijklmnopqrstuvwxyz-primary";
const PUB = "22222222-2222-4222-8222-222222222222";
const AD = { id: "11111111-1111-4111-8111-111111111111", headline: "h", body: "b", ctaText: null, destinationUrl: "https://example.com" };
const ORIG = { ...AD, id: "33333333-3333-4333-8333-333333333333" };
const REF = `bsr_${"a".repeat(40)}`;
const NOW = Date.now();
const receipt = { serveRef: REF, servedAtMs: NOW };
const request = { topic: "gaming", excludeAdIds: [] as string[], trackingRequested: true };

describe("day 17 part 1 | serve passes the matched creative id to issueTracking", () => {
  const issued: Array<{ creativeId: string; serveRef: string; publisherId: string }> = [];
  const deps = (over: Partial<ServeDeps> = {}): ServeDeps => {
    issued.length = 0;
    return {
      authorize: async () => ({ outcome: "ok", publisher: { id: PUB, status: "active" }, unitCostUsd: 0.002 }),
      select: async () => ({ fill: true, ad: AD }) as never,
      record: async () => ({ outcome: "recorded", serve: receipt }),
      issueTracking: (i) => { issued.push(i); return null; },
      ...over,
    };
  };

  it("new serve: creative id is the selected ad", async () => {
    await serveAd("h".repeat(64), request, deps());
    assert.deepEqual(issued.map((i) => i.creativeId), [AD.id]);
  });

  it("idempotent replay (lookupReplay): the ORIGINAL creative id is used", async () => {
    await serveAd("h".repeat(64), { ...request, idempotencyKey: "idem-key-0001" }, deps({ lookupReplay: async () => ({ outcome: "found", ad: ORIG, serve: receipt }) }));
    assert.deepEqual(issued.map((i) => i.creativeId), [ORIG.id]);
  });

  it("concurrent-retry race (record returns replayedAd): replayedAd creative id wins over the fresh selection", async () => {
    await serveAd("h".repeat(64), { ...request, idempotencyKey: "idem-key-0001" }, deps({ record: async () => ({ outcome: "recorded", replayedAd: ORIG, serve: receipt }) }));
    assert.deepEqual(issued.map((i) => i.creativeId), [ORIG.id]);
  });

  it("no opt-in => issuer not called", async () => {
    await serveAd("h".repeat(64), { ...request, trackingRequested: false }, deps());
    assert.deepEqual(issued, []);
  });
});

describe("day 17 part 1 | contract mapping", () => {
  const grant = { token: "bt1.a.b", expiresAtMs: NOW + 1000, events: ["impression", "click"] as const };
  it("click_ref only when a well-formed ref is present", () => {
    assert.equal("click_ref" in buildAdResponse(AD, grant).tracking!, false);
    for (const bad of ["", "garbage", "bt1.a.b", "bc1.a", "bc1.a.b.c", "bc1.a b.c", "bc1." + "x".repeat(600) + ".y"]) {
      assert.equal("click_ref" in buildAdResponse(AD, { ...grant, clickRef: bad }).tracking!, false, bad);
    }
    const ok = buildAdResponse(AD, { ...grant, clickRef: "bc1.abc_-.def_-" });
    assert.equal(ok.tracking!.click_ref, "bc1.abc_-.def_-");
    assert.deepEqual(Object.keys(ok.tracking!).sort(), ["click_ref", "events", "expires_at", "token"]);
  });
  it("no tracking => response unchanged", () => {
    assert.deepEqual(Object.keys(buildAdResponse(AD)).sort(), ["ad", "fill", "sponsored"]);
  });
});

describe("day 17 part 1 | end to end (route -> serve -> service -> fake DB)", () => {
  const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
  const KEY = makeKey("a");
  let db: FakeAdDb;
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.AD_TRACKING_SECRET;
    process.env.AD_TRACKING_SECRET = SECRET;
    db = new FakeAdDb();
    globals.__TEST_SUPABASE__ = db.client();
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.AD_TRACKING_SECRET;
    else process.env.AD_TRACKING_SECRET = saved;
  });

  async function post(headers: Record<string, string> = {}, extra: Record<string, unknown> = {}) {
    const req = new Request("https://example.test/api/v1/ads/match", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, ...headers },
      body: JSON.stringify({ topic: "gaming", ...extra }),
    });
    const res = await v1Route.POST(req);
    const text = await res.text();
    return { res, text, body: JSON.parse(text) as { tracking?: { click_ref?: string } } };
  }

  it("opt-in: click_ref is valid and bound to publisher, creative and serve; secret/ids not exposed", async () => {
    const pub = db.addPublisher("active");
    db.addKey(pub.id, KEY);
    const ad = db.addAd(db.addAdvertiser("active").id, { category: "gaming" });
    const s = await post({ "x-blisscco-tracking": "1" });
    const ref = s.body.tracking?.click_ref as string;
    assert.ok(ref && ref.startsWith("bc1."));
    const serve = db.serveLog[0];
    const config = readTrackingConfig(process.env)!;
    const ok = await verifyClickRefForServe(ref, {
      config,
      nowMs: Date.now(),
      lookupServe: async () => ({ publisherId: pub.id, creativeId: ad.creativeId, servedAtMs: serve.servedAtMs }),
      claimedCreativeId: ad.creativeId,
    });
    assert.ok(ok.ok);
    const other = await verifyClickRefForServe(ref, {
      config,
      nowMs: Date.now(),
      lookupServe: async () => ({ publisherId: pub.id, creativeId: "44444444-4444-4444-8444-444444444444", servedAtMs: serve.servedAtMs }),
    });
    assert.deepEqual(other, { ok: false, reason: "creative_mismatch" });
    const payload = Buffer.from(ref.split(".")[1], "base64url").toString("utf8");
    for (const bad of [SECRET, pub.id, ad.campaignId, REF]) assert.equal(payload.includes(bad), false, "payload leak");
    assert.equal(payload.includes(ad.creativeId), false, "payload must not hold the creative id (one-way tag only)");
    assert.equal(s.text.includes(SECRET), false);
    assert.equal(s.text.includes(pub.id), false);
    assert.equal(s.text.includes(ad.campaignId), false);
    assert.ok(verifyClickRef(ref, config, Date.now()).ok);
  });

  it("idempotent retry returns the same click_ref (original creative)", async () => {
    const pub = db.addPublisher("active");
    db.addKey(pub.id, KEY);
    db.addAd(db.addAdvertiser("active").id, { category: "gaming" });
    const h = { "x-blisscco-tracking": "1", "idempotency-key": "idem-key-0001" };
    const a = await post(h);
    const b = await post(h);
    assert.ok(a.body.tracking?.click_ref);
    assert.equal(b.body.tracking?.click_ref, a.body.tracking?.click_ref);
    assert.equal(db.servesFor(pub.id).length, 1);
  });

  it("no opt-in: response has no tracking at all", async () => {
    const pub = db.addPublisher("active");
    db.addKey(pub.id, KEY);
    db.addAd(db.addAdvertiser("active").id, { category: "gaming" });
    const s = await post();
    assert.equal("tracking" in s.body, false);
    assert.equal(s.text.includes("click_ref"), false);
  });

  it("no tracking secret: ad still served, no tracking/click_ref", async () => {
    delete process.env.AD_TRACKING_SECRET;
    const pub = db.addPublisher("active");
    db.addKey(pub.id, KEY);
    db.addAd(db.addAdvertiser("active").id, { category: "gaming" });
    const realError = console.error;
    console.error = () => {};
    const s = await post({ "x-blisscco-tracking": "1" });
    console.error = realError;
    assert.equal(s.res.status, 200);
    assert.equal("tracking" in s.body, false);
    assert.equal(db.servesFor(pub.id).length, 1);
  });
});
