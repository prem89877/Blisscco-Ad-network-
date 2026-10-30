import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as legacyRoute from "@/app/api/ads/match/route";
import * as v1Route from "@/app/api/v1/ads/match/route";
import { PUBLIC_AD_FIELDS, PUBLIC_TRACKING_FIELDS, PUBLIC_TRACKING_OPTIONAL_FIELDS, buildAdResponse } from "@/lib/ads/contract";
import { CLICK_REF_PREFIX, creativeTag, verifyClickRef, verifyClickRefForServe } from "@/lib/ads/click-ref";
import { publisherTag, readTrackingConfig, verifyTrackingToken } from "@/lib/ads/tracking-token";
import { FakeAdDb, makeKey, sha256 } from "./fake-ad-db";

// Day 17 Part 2: optional `tracking.click_ref` ka contract. Database NAKLI (FakeAdDb), clock FIXED, secrets sirf test ke.
// SQL / asli Supabase / asli credentials kabhi nahi chhute. bt1 (tracking token) aur bc1 (click ref) kabhi ek doosre ki jagah nahi.

const SECRET = "k7f2-0123456789-abcdefghijklmnopqrstuvwxyz-primary";
const OTHER_SECRET = "m4q9-0123456789-abcdefghijklmnopqrstuvwxyz-rotated";
const SERVED_AT = Date.UTC(2026, 9, 27, 10, 0, 30); // FakeAdDb.nowMs ke barabar; serve ka samay (fixed)
const NOW = SERVED_AT + 5_000; // "abhi" (fixed)
const TTL_MS = 3600_000;
const CLICK_REF_RE = /^bc1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const TRACK = { "x-blisscco-tracking": "1" };
const IDEM = "0b7e3c1a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
const realError = console.error;
const realNow = Date.now;
const KEY_A = makeKey("a");
let db: FakeAdDb;
let savedEnv: Record<string, string | undefined>;
const ENV_NAMES = ["AD_TRACKING_SECRET", "AD_TRACKING_SECRET_PREVIOUS", "AD_TRACKING_TTL_SECONDS"] as const;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_NAMES.map((n) => [n, process.env[n]]));
  process.env.AD_TRACKING_SECRET = SECRET;
  delete process.env.AD_TRACKING_SECRET_PREVIOUS;
  delete process.env.AD_TRACKING_TTL_SECONDS;
  Date.now = () => NOW; // deterministic clock (service.ts, serve time aur verify sab isi se)
  console.error = () => {};
  db = new FakeAdDb();
  db.serveTimeMs = SERVED_AT;
  globals.__TEST_SUPABASE__ = db.client();
});
afterEach(() => {
  Date.now = realNow;
  console.error = realError;
  for (const n of ENV_NAMES) {
    if (savedEnv[n] === undefined) delete process.env[n];
    else process.env[n] = savedEnv[n];
  }
});

function world(topic = "gaming") {
  const pub = db.addPublisher("active");
  db.addKey(pub.id, KEY_A);
  const adv = db.addAdvertiser("active");
  const ad = db.addAd(adv.id, { category: topic });
  return { pub, adv, ad };
}

type Body = Record<string, unknown> & { ad?: Record<string, unknown>; tracking?: Record<string, unknown> };
type Sent = { res: Response; body: Body; text: string };
async function send(
  body: unknown,
  opts: { key?: string | null; headers?: Record<string, string>; post?: (r: Request) => Promise<Response> } = {},
): Promise<Sent> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(opts.headers ?? {}) };
  const key = opts.key === undefined ? KEY_A : opts.key;
  if (key) headers.authorization = `Bearer ${key}`;
  const req = new Request("https://example.test/api/v1/ads/match", { method: "POST", headers, body: JSON.stringify(body) });
  const res = await (opts.post ?? v1Route.POST)(req);
  const text = await res.text();
  return { res, body: JSON.parse(text) as Body, text };
}
const clickRefOf = (s: Sent) => s.body.tracking?.click_ref as string | undefined;
const tokenOf = (s: Sent) => s.body.tracking?.token as string;
const cfg = () => readTrackingConfig(process.env)!;
const payloadOf = (ref: string) => Buffer.from(ref.split(".")[1], "base64url").toString("utf8");

// ===========================================================================================================================
describe("day 17 part 2 | tracking-enabled success carries a valid click_ref", () => {
  for (const [name, post] of [["/api/v1/ads/match", v1Route.POST], ["/api/ads/match (legacy)", legacyRoute.POST]] as const) {
    it(`${name}: exact keys; click_ref is bc1, token is bt1, and they are different strings`, async () => {
      const { ad } = world();
      const s = await send({ topic: "gaming" }, { headers: TRACK, post });
      assert.equal(s.res.status, 200);
      assert.deepEqual(Object.keys(s.body).sort(), ["ad", "fill", "sponsored", "tracking"]);
      assert.deepEqual(Object.keys(s.body.ad!).sort(), [...PUBLIC_AD_FIELDS].sort());
      assert.equal(s.body.ad!.id, ad.creativeId);
      assert.deepEqual(Object.keys(s.body.tracking!).sort(), [...PUBLIC_TRACKING_FIELDS, ...PUBLIC_TRACKING_OPTIONAL_FIELDS].sort());
      assert.deepEqual(s.body.tracking!.events, ["impression", "click"]);

      const ref = clickRefOf(s)!;
      assert.equal(typeof ref, "string");
      assert.match(ref, CLICK_REF_RE);
      assert.ok(ref.startsWith(`${CLICK_REF_PREFIX}.`));
      assert.match(tokenOf(s), /^bt1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      assert.notEqual(ref, tokenOf(s));
      assert.equal(s.text.split("bc1.").length - 1, 1, "exactly one click ref in the whole response");
    });
  }

  it("the optional-field list is exactly [click_ref] and the three legacy tracking keys are unchanged", () => {
    assert.deepEqual([...PUBLIC_TRACKING_FIELDS], ["token", "expires_at", "events"]);
    assert.deepEqual([...PUBLIC_TRACKING_OPTIONAL_FIELDS], ["click_ref"]);
  });

  it("click_ref passes verifyClickRef() with the existing config and is bound to the original publisher, creative and serve", async () => {
    const { pub, ad } = world();
    const s = await send({ topic: "gaming" }, { headers: TRACK });
    const ref = clickRefOf(s)!;
    const serve = db.serveLog[0];
    assert.equal(db.serveLog.length, 1);

    const v = verifyClickRef(ref, cfg(), NOW);
    assert.ok(v.ok);
    if (!v.ok) return;
    assert.equal(v.claims.serveRef, serve.serveRef);
    assert.equal(v.claims.publisherTag, publisherTag(SECRET, pub.id));
    assert.equal(v.claims.creativeTag, creativeTag(SECRET, ad.creativeId));
    assert.equal(v.claims.issuedAtMs, Math.floor(SERVED_AT / 1000) * 1000);
    assert.equal(v.claims.expiresAtMs, Math.floor(SERVED_AT / 1000) * 1000 + TTL_MS);
    assert.equal(v.claims.secretIndex, 0);
    // tracking.expires_at aur click ref ki expiry ek hi serve se bandhi hain
    assert.equal(s.body.tracking!.expires_at, new Date(v.claims.expiresAtMs).toISOString());

    const lookupServe = async () => ({ publisherId: serve.publisherId, creativeId: serve.creativeId, servedAtMs: serve.servedAtMs });
    const good = await verifyClickRefForServe(ref, { config: cfg(), nowMs: NOW, lookupServe, claimedCreativeId: ad.creativeId });
    assert.deepEqual(good, { ok: true, serveRef: serve.serveRef, publisherId: pub.id, creativeId: ad.creativeId });

    const other = (over: Partial<{ publisherId: string; creativeId: string; servedAtMs: number }>) => async () => ({
      publisherId: serve.publisherId, creativeId: serve.creativeId, servedAtMs: serve.servedAtMs, ...over,
    });
    const OTHER_ID = "44444444-4444-4444-8444-444444444444";
    assert.deepEqual(await verifyClickRefForServe(ref, { config: cfg(), nowMs: NOW, lookupServe: other({ publisherId: OTHER_ID }) }), { ok: false, reason: "publisher_mismatch" });
    assert.deepEqual(await verifyClickRefForServe(ref, { config: cfg(), nowMs: NOW, lookupServe: other({ creativeId: OTHER_ID }) }), { ok: false, reason: "creative_mismatch" });
    assert.deepEqual(await verifyClickRefForServe(ref, { config: cfg(), nowMs: NOW, lookupServe: other({ servedAtMs: SERVED_AT + 5_000 }) }), { ok: false, reason: "serve_mismatch" });
    assert.deepEqual(await verifyClickRefForServe(ref, { config: cfg(), nowMs: NOW, lookupServe, claimedCreativeId: OTHER_ID }), { ok: false, reason: "creative_mismatch" });
    assert.deepEqual(await verifyClickRefForServe(ref, { config: cfg(), nowMs: NOW, lookupServe: async () => null }), { ok: false, reason: "unknown_serve" });
  });

  it("the token and the click ref come from the same serve and publisher, but neither is accepted in the other's place", async () => {
    const { pub } = world();
    const s = await send({ topic: "gaming" }, { headers: TRACK });
    const ref = clickRefOf(s)!;
    const token = tokenOf(s);
    const t = verifyTrackingToken(token, "click", cfg(), NOW);
    const c = verifyClickRef(ref, cfg(), NOW);
    assert.ok(t.ok && c.ok);
    if (!t.ok || !c.ok) return;
    assert.equal(t.claims.serveRef, c.claims.serveRef);
    assert.equal(t.claims.publisherTag, c.claims.publisherTag);
    assert.equal(t.claims.publisherTag, publisherTag(SECRET, pub.id));
    // bt1 ko click ref ki jagah / bc1 ko token ki jagah dene par hamesha reject
    assert.deepEqual(verifyClickRef(token, cfg(), NOW), { ok: false, reason: "malformed" });
    assert.equal(verifyTrackingToken(ref, "click", cfg(), NOW).ok, false);
    assert.equal(verifyTrackingToken(ref, "impression", cfg(), NOW).ok, false);
    // prefix badal kar bhi nahi (alag signing label)
    const swapped = `${CLICK_REF_PREFIX}.${token.split(".").slice(1).join(".")}`;
    assert.equal(verifyClickRef(swapped, cfg(), NOW).ok, false);
  });

  it("the click ref payload and the whole response expose no internal id, destination, serve id or secret", async () => {
    const { pub, ad } = world();
    const s = await send({ topic: "gaming" }, { headers: TRACK });
    const ref = clickRefOf(s)!;
    const payload = payloadOf(ref);
    for (const bad of [SECRET, pub.id, ad.campaignId, ad.creativeId, KEY_A, sha256(KEY_A), "destination", "http"]) {
      assert.equal(payload.includes(bad), false, `payload leak: ${bad.slice(0, 12)}`);
    }
    assert.deepEqual(Object.keys(JSON.parse(payload) as object).sort(), ["c", "exp", "iat", "p", "r", "v"]);
    for (const bad of [SECRET, KEY_A, sha256(KEY_A), pub.id, ad.campaignId, "service_role", "serve_ref", "serve_id", "publisher_id", "creative_id"]) {
      assert.equal(s.text.includes(bad), false, `response leak: ${bad.slice(0, 12)}`);
    }
    // ad.id publisher ko dikhta hi hai (public id); click_ref us se sirf one-way tag ke roop me juda hai
    assert.equal(s.body.ad!.id, ad.creativeId);
    assert.equal(ref.includes(ad.creativeId), false);
  });

  it("a destination or click parameter sent by the publisher changes nothing (unknown fields are 400, nothing is served)", async () => {
    world();
    for (const extra of [{ destination_url: "https://evil.example" }, { click_ref: "bc1.a.b" }, { click_url: "https://evil.example" }]) {
      const s = await send({ topic: "gaming", ...extra }, { headers: TRACK });
      assert.equal(s.res.status, 400);
      assert.equal(s.body.error, "invalid_request");
      assert.equal(s.text.includes("bc1."), false);
    }
    assert.equal(db.serveLog.length, 0);
  });

  it("TTL from the existing env applies to the click ref and the token alike", async () => {
    world();
    process.env.AD_TRACKING_TTL_SECONDS = "600";
    const s = await send({ topic: "gaming" }, { headers: TRACK });
    const c = verifyClickRef(clickRefOf(s)!, cfg(), NOW);
    assert.ok(c.ok);
    assert.equal(c.ok && c.claims.expiresAtMs, Math.floor(SERVED_AT / 1000) * 1000 + 600_000);
    assert.equal(s.body.tracking!.expires_at, new Date(Math.floor(SERVED_AT / 1000) * 1000 + 600_000).toISOString());
  });

  it("a ref minted before a secret rotation still verifies afterwards (as the previous secret); new serves use the new secret", async () => {
    world();
    const before = await send({ topic: "gaming" }, { headers: { ...TRACK, "idempotency-key": IDEM } });
    process.env.AD_TRACKING_SECRET_PREVIOUS = SECRET;
    process.env.AD_TRACKING_SECRET = OTHER_SECRET;
    const old = verifyClickRef(clickRefOf(before)!, cfg(), NOW);
    assert.ok(old.ok);
    assert.equal(old.ok && old.claims.secretIndex, 1);
    db.addKey(db.addPublisher("active").id, makeKey("b"));
    const fresh = await send({ topic: "gaming" }, { key: makeKey("b"), headers: TRACK });
    const nu = verifyClickRef(clickRefOf(fresh)!, cfg(), NOW);
    assert.ok(nu.ok);
    assert.equal(nu.ok && nu.claims.secretIndex, 0);
  });
});

// ===========================================================================================================================
describe("day 17 part 2 | Idempotency-Key retries return the same click_ref for the original serve", () => {
  const idem = (k = IDEM) => ({ ...TRACK, "idempotency-key": k });

  it("same key twice: same click_ref and expiry, one serve row, one charge, retry never reaches record_ad_serve", async () => {
    const { ad } = world();
    const first = await send({ topic: "gaming" }, { headers: idem() });
    Date.now = () => NOW + 600_000; // retry 10 minute baad (expiry serve ke samay se bandhi hai, retry se badhti nahi)
    const second = await send({ topic: "gaming" }, { headers: idem() });
    assert.equal(first.res.status, 200);
    assert.equal(second.res.status, 200);
    assert.ok(clickRefOf(first));
    assert.equal(clickRefOf(second), clickRefOf(first));
    assert.equal(tokenOf(second), tokenOf(first));
    assert.equal(second.body.tracking!.expires_at, first.body.tracking!.expires_at);
    assert.deepEqual(second.body, first.body);
    assert.equal(db.serveLog.length, 1, "no second serve");
    assert.equal(db.spendOf(ad.campaignId), db.unitCostUsd, "charged once");
    assert.equal(db.calls.filter((c) => c.name === "record_ad_serve").length, 1);
    const v = verifyClickRef(clickRefOf(second)!, cfg(), NOW + 600_000);
    assert.ok(v.ok);
    assert.equal(v.ok && v.claims.serveRef, db.serveLog[0].serveRef);
    assert.equal(v.ok && v.claims.expiresAtMs, Math.floor(SERVED_AT / 1000) * 1000 + TTL_MS);
  });

  it("a retry stays bound to the ORIGINAL creative even if a different ad was added meanwhile", async () => {
    const { adv, ad } = world();
    const first = await send({ topic: "gaming" }, { headers: idem() });
    db.addAd(adv.id, { category: "gaming", headline: "Added later" });
    const second = await send({ topic: "gaming" }, { headers: idem() });
    assert.equal(second.body.ad!.id, ad.creativeId);
    assert.equal(clickRefOf(second), clickRefOf(first));
    const v = verifyClickRef(clickRefOf(second)!, cfg(), NOW);
    assert.equal(v.ok && v.claims.creativeTag, creativeTag(SECRET, ad.creativeId));
    assert.equal(db.serveLog.length, 1);
  });

  it("different keys are different serves with different click refs", async () => {
    const { adv } = world();
    db.addAd(adv.id, { category: "gaming" });
    const a = await send({ topic: "gaming" }, { headers: idem("0b7e3c1a-1c2d-4e5f-8a9b-0c1d2e3f4a01") });
    const b = await send({ topic: "gaming" }, { headers: idem("0b7e3c1a-1c2d-4e5f-8a9b-0c1d2e3f4a02") });
    assert.equal(db.serveLog.length, 2);
    assert.notEqual(clickRefOf(a), clickRefOf(b));
  });

  it("five concurrent requests with one key: one serve, one identical click_ref", async () => {
    world();
    const all = await Promise.all(Array.from({ length: 5 }, () => send({ topic: "gaming" }, { headers: idem() })));
    assert.equal(db.serveLog.length, 1);
    assert.equal(new Set(all.map(clickRefOf)).size, 1);
    assert.ok(clickRefOf(all[0]));
  });

  it("first request without opt-in, retry with opt-in: the retry's click_ref belongs to the SAME single serve", async () => {
    const { pub, ad } = world();
    const first = await send({ topic: "gaming" }, { headers: { "idempotency-key": IDEM } });
    assert.equal("tracking" in first.body, false);
    const retry = await send({ topic: "gaming" }, { headers: idem() });
    assert.equal(db.serveLog.length, 1);
    const v = verifyClickRef(clickRefOf(retry)!, cfg(), NOW);
    assert.ok(v.ok);
    assert.equal(v.ok && v.claims.serveRef, db.serveLog[0].serveRef);
    assert.equal(v.ok && v.claims.publisherTag, publisherTag(SECRET, pub.id));
    assert.equal(v.ok && v.claims.creativeTag, creativeTag(SECRET, ad.creativeId));
  });

  it("an old serve without a receipt (legacy, no serve_ref) replays the ad with NO click_ref", async () => {
    world();
    db.legacyNoServeRef = true;
    const first = await send({ topic: "gaming" }, { headers: idem() });
    const retry = await send({ topic: "gaming" }, { headers: idem() });
    for (const s of [first, retry]) {
      assert.equal(s.body.fill, true);
      assert.equal("tracking" in s.body, false);
      assert.equal(s.text.includes("bc1."), false);
    }
  });
});

// ===========================================================================================================================
describe("day 17 part 2 | no opt-in keeps the exact old contract; failures never expose a click reference", () => {
  const noRef = (s: Sent) => {
    assert.equal(s.text.includes("bc1."), false);
    assert.equal(s.text.includes("click_ref"), false);
    assert.equal("tracking" in s.body, false);
  };

  it("without X-Blisscco-Tracking: exactly {fill, sponsored, ad} with the five public ad fields; nothing about tracking", async () => {
    const { ad } = world();
    for (const post of [v1Route.POST, legacyRoute.POST]) {
      const s = await send({ topic: "gaming" }, { post });
      assert.equal(s.res.status, 200);
      assert.deepEqual(Object.keys(s.body).sort(), ["ad", "fill", "sponsored"]);
      assert.strictEqual(s.body.fill, true);
      assert.strictEqual(s.body.sponsored, true);
      assert.deepEqual(Object.keys(s.body.ad!).sort(), [...PUBLIC_AD_FIELDS].sort());
      assert.equal(s.body.ad!.id, ad.creativeId);
      noRef(s);
      assert.equal(s.text.includes("bt1."), false);
      assert.equal(s.text.includes("expires_at"), false);
    }
  });

  it("the ad fields are identical with and without opt-in (opt-in only adds `tracking`)", async () => {
    world();
    const plain = await send({ topic: "gaming" }, { headers: { "idempotency-key": IDEM } });
    const tracked = await send({ topic: "gaming" }, { headers: { ...TRACK, "idempotency-key": IDEM } });
    assert.deepEqual(tracked.body.ad, plain.body.ad);
    assert.equal(tracked.body.fill, plain.body.fill);
    assert.equal(tracked.body.sponsored, plain.body.sponsored);
    assert.deepEqual(Object.keys(tracked.body).sort(), ["ad", "fill", "sponsored", "tracking"]);
  });

  it("no-fill (sensitive / unsupported topic, no candidates) => exactly {fill:false}", async () => {
    world();
    for (const topic of ["health", "unknown_topic_xyz", "travel"]) {
      const s = await send({ topic }, { headers: TRACK });
      assert.deepEqual(s.body, { fill: false }, topic);
      noRef(s);
    }
    assert.equal(db.serveLog.length, 0);
  });

  it("the database rejects the chosen creative => {fill:false}, no click ref, nothing served", async () => {
    world();
    const real = db.client();
    globals.__TEST_SUPABASE__ = {
      rpc: async (name: string, args: Record<string, unknown>) =>
        name === "record_ad_serve" ? { data: { outcome: "rejected" }, error: null } : real.rpc(name, args),
    };
    const s = await send({ topic: "gaming" }, { headers: TRACK });
    assert.deepEqual(s.body, { fill: false });
    noRef(s);
    assert.equal(db.serveLog.length, 0);
  });

  it("unauthorized (missing, unknown and malformed key) => 401 {error:unauthorized}, no click ref", async () => {
    world();
    for (const key of [null, makeKey("zzz"), "not-a-key"]) {
      const s = await send({ topic: "gaming" }, { key, headers: TRACK });
      assert.equal(s.res.status, 401);
      assert.deepEqual(s.body, { error: "unauthorized" });
      noRef(s);
    }
    assert.equal(db.serveLog.length, 0);
  });

  it("unavailable (authorize / candidates / record outage, or a crash) => 503 {fill:false,error:unavailable}, no click ref", async () => {
    const { ad } = world();
    const boom = { data: null, error: { code: "XX000", message: "boom" } };
    for (const name of ["authorize_publisher_key", "load_ad_candidates", "record_ad_serve"]) {
      db.failRpc = { [name]: boom };
      const s = await send({ topic: "gaming" }, { headers: TRACK });
      assert.equal(s.res.status, 503, name);
      assert.deepEqual(s.body, { fill: false, error: "unavailable" }, name);
      noRef(s);
    }
    db.failRpc = {};
    globals.__TEST_SUPABASE__ = undefined;
    const crash = await send({ topic: "gaming" }, { headers: TRACK });
    assert.equal(crash.res.status, 503);
    noRef(crash);
    assert.equal(db.serveLog.length, 0);
    assert.equal(db.spendOf(ad.campaignId), 0);
  });

  it("missing, weak or empty tracking secret: the ad is still served and recorded, with no tracking and no click_ref", async () => {
    const { pub } = world();
    const served = [];
    for (const secret of [undefined, "", "short", "x".repeat(10)]) {
      if (secret === undefined) delete process.env.AD_TRACKING_SECRET;
      else process.env.AD_TRACKING_SECRET = secret;
      const s = await send({ topic: "gaming" }, { headers: TRACK });
      assert.equal(s.res.status, 200, String(secret));
      assert.equal(s.body.fill, true);
      assert.deepEqual(Object.keys(s.body).sort(), ["ad", "fill", "sponsored"]);
      noRef(s);
      served.push(s);
    }
    assert.equal(db.servesFor(pub.id).length, served.length, "each request still recorded its serve");
  });

  it("a malformed serve_ref from the database => the ad is served, but neither a token nor a click_ref", async () => {
    world();
    const real = db.client();
    globals.__TEST_SUPABASE__ = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        const r = await real.rpc(name, args);
        if (name === "record_ad_serve" && r.data && typeof r.data === "object") {
          return { ...r, data: { ...(r.data as object), serve_ref: "bsr_not-hex" } };
        }
        return r;
      },
    };
    const s = await send({ topic: "gaming" }, { headers: TRACK });
    assert.equal(s.body.fill, true);
    noRef(s);
  });

  it("an invalid opt-in header is 400 and serves nothing (no click ref)", async () => {
    world();
    for (const bad of ["0", "true", "", "1, 1", "yes", "2"]) {
      const s = await send({ topic: "gaming" }, { headers: { "x-blisscco-tracking": bad } });
      assert.equal(s.res.status, 400, bad);
      assert.deepEqual(s.body, { error: "invalid_request", reason: "invalid_tracking_header" }, bad);
      assert.equal(s.text.includes("bc1."), false);
    }
    assert.equal(db.serveLog.length, 0);
  });
});

// ===========================================================================================================================
describe("day 17 part 2 | contract mapper never turns a tracking token (bt1) or junk into click_ref", () => {
  const ad = { id: "11111111-1111-4111-8111-111111111111", headline: "h", body: "b", ctaText: null, destinationUrl: "https://example.com" };
  const grant = { token: "bt1.a.b", expiresAtMs: NOW + TTL_MS, events: ["impression", "click"] as const };

  it("only a bc1.<b64>.<b64> string is exposed; bt1, wrong case, extra parts, empty and oversized values are dropped", () => {
    const rejected = ["", "bt1.a.b", "BC1.a.b", "bc1.a", "bc1.a.b.c", "bc1..b", "bc1.a b.c", "bc1.a=.b", `bc1.${"x".repeat(600)}.y`, grant.token];
    for (const clickRef of rejected) {
      const t = buildAdResponse(ad, { ...grant, clickRef }).tracking!;
      assert.equal("click_ref" in t, false, clickRef.slice(0, 20));
      assert.deepEqual(Object.keys(t).sort(), [...PUBLIC_TRACKING_FIELDS].sort());
    }
    for (const bad of [null, 42, {}, []]) {
      const t = buildAdResponse(ad, { ...grant, clickRef: bad as never }).tracking!;
      assert.equal("click_ref" in t, false);
    }
    const ok = buildAdResponse(ad, { ...grant, clickRef: "bc1.abc_-.def_-" }).tracking!;
    assert.deepEqual(Object.keys(ok).sort(), ["click_ref", "events", "expires_at", "token"]);
    assert.equal(ok.token, "bt1.a.b");
    assert.equal(ok.click_ref, "bc1.abc_-.def_-");
  });

  it("extra grant fields never leak; without tracking the response is exactly the old one", () => {
    const t = buildAdResponse(ad, { ...grant, clickRef: "bc1.a.b", publisherId: "LEAK", creativeId: "LEAK", serveRef: "LEAK" } as never).tracking!;
    assert.equal(JSON.stringify(t).includes("LEAK"), false);
    assert.deepEqual(buildAdResponse(ad), { fill: true, sponsored: true, ad: { id: ad.id, headline: "h", body: "b", cta_text: null, destination_url: "https://example.com" } });
  });
});
