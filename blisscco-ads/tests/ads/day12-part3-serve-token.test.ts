import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import * as legacyRoute from "@/app/api/ads/match/route";
import * as v1Route from "@/app/api/v1/ads/match/route";
import { handleMatchPost } from "@/lib/ads/match-handler";
import { createIpGuard } from "@/lib/ads/ip-guard";
import { PUBLIC_AD_FIELDS, PUBLIC_TRACKING_FIELDS, buildAdResponse } from "@/lib/ads/contract";
import { parseTrackingOptIn } from "@/lib/ads/validation";
import { serveAd, type ServeDeps } from "@/lib/ads/serve";
import { parseRecordResult, parseReplayResult, parseServeReceipt } from "@/lib/ads/serve-db";
import {
  MAX_TTL_SECONDS,
  mintTrackingToken,
  publisherTag,
  readTrackingConfig,
  verifyTrackedEvent,
  verifyTrackingToken,
  type TrackingConfig,
} from "@/lib/ads/tracking-token";
import { FakeAdDb, makeKey, sha256 } from "./fake-ad-db";

// Day 12 Part 3: serve_ref + tracking token. Database NAKLI hai (FakeAdDb: SQL ka model); asli Supabase / production kabhi nahi chhuta.
// Ye tests SIRF token, response contract, retry-safety aur "failed serve = no token" jaanchte hain. Koi event nahi likha jaata,
// kyunki event writer is part me hai hi nahi: token milna impression ka saboot nahi hai.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

const SECRET = "k7f2-0123456789-abcdefghijklmnopqrstuvwxyz-primary";
const OTHER_SECRET = "m4q9-0123456789-abcdefghijklmnopqrstuvwxyz-rotated";
const REF = `bsr_${"ab".repeat(20)}`;
const REF_2 = `bsr_${"cd".repeat(20)}`;
const PUB = "00000000-0000-4000-8000-0000000000a1";
const PUB_2 = "00000000-0000-4000-8000-0000000000a2";
const NOW = Date.UTC(2026, 9, 28, 10, 0, 0);
const HOUR = 3_600_000;

const config = (over: Partial<TrackingConfig> = {}): TrackingConfig => ({ secrets: [SECRET], ttlSeconds: 3600, ...over });
const mint = (over: Partial<Parameters<typeof mintTrackingToken>[1]> = {}, cfg: TrackingConfig = config()) =>
  mintTrackingToken(cfg, { serveRef: REF, publisherId: PUB, servedAtMs: NOW, nowMs: NOW + 5_000, ...over });

const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const decodePayload = (token: string) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
/** Apna payload apne secret se sign karke (test me jaali token banane ke liye). */
function forge(payload: unknown, secret = SECRET): string {
  const p = b64u(typeof payload === "string" ? payload : JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(`blisscco:tracking:bt1:${p}`, "utf8").digest("base64url");
  return `bt1.${p}.${sig}`;
}
const goodClaims = (over: Record<string, unknown> = {}) => ({
  v: 1, r: REF, p: publisherTag(SECRET, PUB), e: ["impression", "click"], iat: NOW / 1000, exp: NOW / 1000 + 3600, ...over,
});

// ===========================================================================================================================
describe("day 12 part 3 | config", () => {
  it("missing, short, padded or credential-looking secrets switch tracking off (null)", () => {
    for (const bad of [undefined, "", "short", "x".repeat(31), ` ${"x".repeat(40)}`, `${"x".repeat(20)} ${"y".repeat(20)}`,
      `sb_secret_${"x".repeat(40)}`, `blc_live_${"a".repeat(64)}`, `eyJ${"x".repeat(60)}`, "x".repeat(513),
      `YOUR-RANDOM-SECRET-${"x".repeat(30)}`, `paste-your-secret-here-${"x".repeat(30)}`, `CHANGE_ME_${"x".repeat(40)}`, `example-${"x".repeat(40)}`]) {
      assert.equal(readTrackingConfig({ AD_TRACKING_SECRET: bad }), null, String(bad));
    }
    assert.equal(readTrackingConfig({}), null);
  });

  it("a good secret gives default ttl 3600; ttl env is honoured only inside 60..86400", () => {
    assert.deepEqual(readTrackingConfig({ AD_TRACKING_SECRET: SECRET }), { secrets: [SECRET], ttlSeconds: 3600 });
    assert.equal(readTrackingConfig({ AD_TRACKING_SECRET: SECRET, AD_TRACKING_TTL_SECONDS: "600" })?.ttlSeconds, 600);
    for (const bad of ["59", "86401", "-5", "abc", "1e3", "", "99999999"]) {
      assert.equal(readTrackingConfig({ AD_TRACKING_SECRET: SECRET, AD_TRACKING_TTL_SECONDS: bad })?.ttlSeconds, 3600, bad);
    }
  });

  it("a valid previous secret is added for verification; a weak or identical previous is ignored", () => {
    assert.deepEqual(readTrackingConfig({ AD_TRACKING_SECRET: SECRET, AD_TRACKING_SECRET_PREVIOUS: OTHER_SECRET })?.secrets, [SECRET, OTHER_SECRET]);
    assert.deepEqual(readTrackingConfig({ AD_TRACKING_SECRET: SECRET, AD_TRACKING_SECRET_PREVIOUS: "weak" })?.secrets, [SECRET]);
    assert.deepEqual(readTrackingConfig({ AD_TRACKING_SECRET: SECRET, AD_TRACKING_SECRET_PREVIOUS: SECRET })?.secrets, [SECRET]);
  });
});

// ===========================================================================================================================
describe("day 12 part 3 | minting", () => {
  it("token is bt1.<payload>.<signature>; payload holds only opaque ref, one-way publisher tag, permitted events and times", () => {
    const g = mint();
    assert.ok(g);
    assert.match(g.token, /^bt1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    const payload = decodePayload(g.token);
    assert.deepEqual(Object.keys(payload).sort(), ["e", "exp", "iat", "p", "r", "v"]);
    assert.equal(payload.r, REF);
    assert.deepEqual(payload.e, ["impression", "click"]);
    assert.equal(g.expiresAtMs, NOW + HOUR);
    const raw = Buffer.from(g.token.split(".")[1], "base64url").toString("utf8");
    assert.equal(raw.includes(PUB), false, "publisher id must not be in the token");
    assert.equal(raw.includes(SECRET), false);
    assert.equal(g.token.includes(SECRET), false);
  });

  it("'serve' is never a permitted event type; events are only impression and click", () => {
    const g = mint();
    assert.deepEqual([...g!.events], ["impression", "click"]);
    assert.equal(verifyTrackingToken(g!.token, "serve", config(), NOW + 1000).ok, false);
  });

  it("is deterministic: the same serve always gets the byte-identical token (a retry cannot make a 'second' token)", () => {
    assert.equal(mint()!.token, mint({ nowMs: NOW + 90_000 })!.token);
    assert.notEqual(mint()!.token, mint({ serveRef: REF_2 })!.token);
    assert.notEqual(mint()!.token, mint({ publisherId: PUB_2 })!.token);
  });

  it("expiry is anchored to the SERVE time: a late retry cannot get a fresh lifetime", () => {
    assert.ok(mint({ servedAtMs: NOW, nowMs: NOW + HOUR - 1000 }));
    assert.equal(mint({ servedAtMs: NOW, nowMs: NOW + HOUR }), null);
    assert.equal(mint({ servedAtMs: NOW, nowMs: NOW + 47 * HOUR }), null);
  });

  it("refuses a malformed ref, a malformed publisher id, non-finite times and a serve time far in the future", () => {
    assert.equal(mint({ serveRef: "bsr_123" }), null);
    assert.equal(mint({ serveRef: `BSR_${"ab".repeat(20)}` }), null);
    assert.equal(mint({ serveRef: `${REF}0` }), null);
    assert.equal(mint({ publisherId: "not-a-uuid" }), null);
    assert.equal(mint({ servedAtMs: Number.NaN }), null);
    assert.equal(mint({ nowMs: Number.POSITIVE_INFINITY }), null);
    assert.equal(mint({ servedAtMs: NOW + 10 * 60_000, nowMs: NOW }), null);
    assert.ok(mint({ servedAtMs: NOW + 30_000, nowMs: NOW }), "small clock skew is fine");
  });

  it("signs with the CURRENT secret only (previous secret is for verification)", () => {
    const cfg = config({ secrets: [SECRET, OTHER_SECRET] });
    const g = mint({}, cfg)!;
    assert.equal(verifyTrackingToken(g.token, "click", config({ secrets: [SECRET] }), NOW + 1000).ok, true);
    assert.equal(verifyTrackingToken(g.token, "click", config({ secrets: [OTHER_SECRET] }), NOW + 1000).ok, false);
  });
});

// ===========================================================================================================================
describe("day 12 part 3 | verification", () => {
  const good = () => mint()!.token;
  const verify = (t: unknown, e: unknown = "impression", at = NOW + 60_000, cfg = config()) => verifyTrackingToken(t, e, cfg, at);
  // NOTE: `e` ka default sirf jab argument diya hi na jaye; `undefined` ko alag se test karne ke liye arguments.length dekhte hain.
  const reason = (...args: [unknown, unknown?, number?]) => {
    const r = verifyTrackingToken(args[0], args.length >= 2 ? args[1] : "impression", config(), args[2] ?? NOW + 60_000);
    return r.ok ? "ok" : r.reason;
  };

  it("a valid token verifies for impression and for click and returns the bound serve ref", () => {
    for (const ev of ["impression", "click"]) {
      const r = verify(good(), ev);
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.equal(r.claims.serveRef, REF);
        assert.equal(r.claims.secretIndex, 0);
        assert.equal(r.claims.expiresAtMs, NOW + HOUR);
      }
    }
  });

  it("wrong event types are rejected: serve, case variants, unknown names, empty, non-strings", () => {
    for (const ev of ["serve", "Impression", "CLICK", "view", "conversion", "impression ", "", undefined, null, 1, {}, ["click"]]) {
      assert.equal(reason(good(), ev), "wrong_event_type", String(ev));
    }
  });

  it("a token that lists only one event cannot be used for the other (event scope is enforced)", () => {
    const onlyClick = forge(goodClaims({ e: ["click"] }));
    assert.equal(reason(onlyClick, "click"), "ok");
    assert.equal(reason(onlyClick, "impression"), "wrong_event_type");
  });

  it("expiry: valid just before exp, expired at exp and after; not valid before issue (beyond skew)", () => {
    assert.equal(reason(good(), "click", NOW + HOUR - 1), "ok");
    assert.equal(reason(good(), "click", NOW + HOUR), "expired");
    assert.equal(reason(good(), "click", NOW + 24 * HOUR), "expired");
    assert.equal(reason(good(), "click", NOW - 30_000), "ok", "small skew allowed");
    assert.equal(reason(good(), "click", NOW - 10 * 60_000), "not_yet_valid");
  });

  it("malformed tokens: wrong types, empty, wrong prefix, wrong part count, bad characters, padding, oversize", () => {
    const g = good();
    const [, p, s] = g.split(".");
    const cases: unknown[] = [
      undefined, null, 42, {}, [], "", " ", "bt1", "bt1.", "bt1..", `bt1.${p}`, `bt1.${p}.${s}.extra`, `bt2.${p}.${s}`, `BT1.${p}.${s}`,
      `${p}.${s}`, `bt1.${p}.`, `bt1..${s}`, `bt1.${p}!.${s}`, `bt1.${p}=.${s}`, `bt1.${p}.${s}=`, `bt1.${p} .${s}`, ` ${g}`, `${g} `, `${g}\n`,
      `bt1.${p}.${s.slice(0, -2)}`, `bt1.${p}.${s}AA`, `bt1.${"A".repeat(600)}.${s}`, "bt1.%%%.%%%", "null", "undefined",
    ];
    for (const c of cases) assert.equal(reason(c), "malformed", JSON.stringify(c)?.slice(0, 60));
  });

  it("non-canonical base64url (same bytes, different text) is rejected, so a token cannot be re-encoded", () => {
    const [, p, s] = good().split(".");
    // Aakhri character badalna: padding bits alag, par decode wahi bytes de sakta hai => canonical check use pakadta hai.
    const alt = s.slice(0, -1) + (s.endsWith("A") ? "B" : "A");
    assert.notEqual(alt, s);
    const r = verify(`bt1.${p}.${alt}`);
    assert.equal(r.ok, false);
  });

  it("invalid signatures: flipped signature, other secret, unrelated token, truncated, empty-secret style", () => {
    const [, p, s] = good().split(".");
    const flipped = (s[0] === "A" ? "B" : "A") + s.slice(1);
    assert.equal(reason(`bt1.${p}.${flipped}`), "invalid_signature");
    assert.equal(reason(forge(goodClaims(), OTHER_SECRET)), "invalid_signature");
    assert.equal(reason(`bt1.${p}.${"A".repeat(43)}`), "invalid_signature");
  });

  it("tampering with ANY payload field breaks the signature (ref, publisher tag, events, issue time, expiry)", () => {
    const g = good();
    const sig = g.split(".")[2];
    const claims = goodClaims();
    const tampered: Record<string, unknown>[] = [
      { ...claims, r: REF_2 },
      { ...claims, p: publisherTag(SECRET, PUB_2) },
      { ...claims, e: ["impression", "click", "serve"] },
      { ...claims, e: ["click"] },
      { ...claims, iat: (claims.iat as number) + 1 },
      { ...claims, exp: (claims.exp as number) + 86_400 },
    ];
    for (const t of tampered) assert.equal(reason(`bt1.${b64u(JSON.stringify(t))}.${sig}`), "invalid_signature", JSON.stringify(t));
  });

  it("payload is checked even with a valid signature: bad json, extra keys, missing keys, wrong types, bad ref, bad ttl, duplicate events", () => {
    const c = goodClaims();
    const { v: _v, ...noV } = c;
    const cases: unknown[] = [
      "not json", "[]", "null", "7", "\"s\"",
      { ...c, extra: 1 }, noV, { ...c, v: 2 }, { ...c, v: "1" },
      { ...c, r: "bsr_short" }, { ...c, r: 5 }, { ...c, p: "zz" }, { ...c, p: 5 },
      { ...c, e: [] }, { ...c, e: "click" }, { ...c, e: ["click", "click"] }, { ...c, e: ["serve"] }, { ...c, e: ["click", 5] },
      { ...c, e: ["impression", "click", "click"] },
      { ...c, iat: "1" }, { ...c, exp: 1.5 }, { ...c, exp: c.iat as number }, { ...c, exp: (c.iat as number) - 5 },
      { ...c, exp: (c.iat as number) + MAX_TTL_SECONDS + 1 },
    ];
    for (const x of cases) assert.equal(reason(forge(x as never)), "malformed", JSON.stringify(x));
  });

  it("rotation: a token signed with the previous secret still verifies and reports secretIndex 1; a removed secret does not", () => {
    const old = mint({}, config({ secrets: [OTHER_SECRET] }))!.token;
    const rotated = config({ secrets: [SECRET, OTHER_SECRET] });
    const r = verifyTrackingToken(old, "click", rotated, NOW + 1000);
    assert.equal(r.ok && r.claims.secretIndex, 1);
    assert.equal(verifyTrackingToken(old, "click", config({ secrets: [SECRET] }), NOW + 1000).ok, false);
  });

  it("never throws, whatever it is given", () => {
    for (const t of [Symbol.iterator, () => 1, 10n, new Date(), Object.create(null), "\u0000", "bt1.\uD800.\uD800"]) {
      assert.doesNotThrow(() => verifyTrackingToken(t, "click", config(), NOW));
    }
    assert.equal(verifyTrackingToken(good(), "click", config(), Number.NaN).ok, false);
  });
});

// ===========================================================================================================================
describe("day 12 part 3 | verifyTrackedEvent (token + the real serve row)", () => {
  const lookupOk = async (ref: string) => (ref === REF ? { publisherId: PUB, servedAtMs: NOW } : null);
  const deps = (lookupServe = lookupOk, nowMs = NOW + 10_000) => ({ config: config(), nowMs, lookupServe });
  const token = () => mint()!.token;

  it("accepts the right token for its own serve and returns the serve it belongs to (it does not write any event)", async () => {
    const r = await verifyTrackedEvent(token(), "click", deps());
    assert.deepEqual(r, { ok: true, serveRef: REF, publisherId: PUB, event: "click" });
  });

  it("unknown serve reference (validly signed, but no such serve) is rejected", async () => {
    const g = mint({ serveRef: REF_2 })!;
    assert.deepEqual(await verifyTrackedEvent(g.token, "impression", deps()), { ok: false, reason: "unknown_serve" });
  });

  it("a token cannot be used for another publisher's serve, or for a serve with a different time", async () => {
    const r1 = await verifyTrackedEvent(token(), "click", deps(async () => ({ publisherId: PUB_2, servedAtMs: NOW })));
    assert.deepEqual(r1, { ok: false, reason: "publisher_mismatch" });
    const r2 = await verifyTrackedEvent(token(), "click", deps(async () => ({ publisherId: PUB, servedAtMs: NOW + 5000 })));
    assert.deepEqual(r2, { ok: false, reason: "serve_mismatch" });
  });

  it("token checks run first: bad/expired/wrong-event tokens never reach the database", async () => {
    let calls = 0;
    const spy = async () => { calls += 1; return { publisherId: PUB, servedAtMs: NOW }; };
    assert.equal((await verifyTrackedEvent("garbage", "click", deps(spy))).ok, false);
    assert.equal((await verifyTrackedEvent(token(), "serve", deps(spy))).ok, false);
    assert.equal((await verifyTrackedEvent(token(), "click", deps(spy, NOW + 2 * HOUR))).ok, false);
    assert.equal(calls, 0);
  });

  it("a failing or nonsense lookup is 'unavailable', never a pass", async () => {
    const boom = async () => { throw new Error("db down"); };
    assert.deepEqual(await verifyTrackedEvent(token(), "click", deps(boom)), { ok: false, reason: "unavailable" });
    const junk = async () => ({ publisherId: "x", servedAtMs: NOW });
    assert.deepEqual(await verifyTrackedEvent(token(), "click", deps(junk)), { ok: false, reason: "unavailable" });
  });

  it("works with a token signed by the previous secret (publisher tag is re-derived with the matching secret)", async () => {
    const old = mint({}, config({ secrets: [OTHER_SECRET] }))!.token;
    const r = await verifyTrackedEvent(old, "click", { config: config({ secrets: [SECRET, OTHER_SECRET] }), nowMs: NOW + 1000, lookupServe: lookupOk });
    assert.equal(r.ok, true);
  });
});

// ===========================================================================================================================
describe("day 12 part 3 | request header and response contract", () => {
  it("parseTrackingOptIn: absent = off, exactly '1' = on, everything else is an error (never silently ignored)", () => {
    assert.deepEqual(parseTrackingOptIn(null), { ok: true, value: false });
    assert.deepEqual(parseTrackingOptIn("1"), { ok: true, value: true });
    assert.deepEqual(parseTrackingOptIn(" 1 "), { ok: true, value: true });
    for (const bad of ["0", "", "true", "yes", "1, 1", "01", "on", "2"]) assert.deepEqual(parseTrackingOptIn(bad), { ok: false }, bad);
  });

  it("buildAdResponse without a grant is byte-identical to the old contract (3 keys, 5 ad fields)", () => {
    const ad = { id: "11111111-1111-4111-8111-111111111111", headline: "h", body: "b", ctaText: null, destinationUrl: "https://example.com" };
    const res = buildAdResponse(ad);
    assert.deepEqual(Object.keys(res).sort(), ["ad", "fill", "sponsored"]);
    assert.deepEqual(Object.keys(res.ad).sort(), [...PUBLIC_AD_FIELDS].sort());
  });

  it("buildAdResponse with a grant adds exactly {token, expires_at, events}; extra grant properties never leak", () => {
    const ad = { id: "11111111-1111-4111-8111-111111111111", headline: "h", body: "b", ctaText: "go", destinationUrl: "https://example.com" };
    const grant = { ...mint()!, secret: "LEAK", serveId: 7 } as never;
    const res = buildAdResponse(ad, grant);
    assert.deepEqual(Object.keys(res).sort(), ["ad", "fill", "sponsored", "tracking"]);
    assert.deepEqual(Object.keys(res.tracking!).sort(), [...PUBLIC_TRACKING_FIELDS].sort());
    assert.equal(res.tracking!.expires_at, new Date(NOW + HOUR).toISOString());
    assert.deepEqual(res.tracking!.events, ["impression", "click"]);
    assert.equal(JSON.stringify(res).includes("LEAK"), false);
    assert.deepEqual(Object.keys(res.ad).sort(), [...PUBLIC_AD_FIELDS].sort(), "the five public ad fields are unchanged");
  });
});

// ===========================================================================================================================
describe("day 12 part 3 | serveAd orchestration (token only for a recorded serve)", () => {
  const ad = { id: "11111111-1111-4111-8111-111111111111", headline: "h", body: "b", ctaText: null, destinationUrl: "https://example.com" };
  const receipt = { serveRef: REF, servedAtMs: NOW };
  const request = { topic: "gaming", excludeAdIds: [] as string[], trackingRequested: true };
  const issued: Array<{ publisherId: string; serveRef: string; servedAtMs: number }> = [];

  function deps(over: Partial<ServeDeps> = {}): ServeDeps {
    issued.length = 0;
    return {
      authorize: async () => ({ outcome: "ok", publisher: { id: PUB, status: "active" }, unitCostUsd: 0.002 }),
      select: async () => ({ fill: true, ad }) as never,
      record: async () => ({ outcome: "recorded", serve: receipt }),
      issueTracking: (i) => { issued.push(i); return mint({ serveRef: i.serveRef, publisherId: i.publisherId, servedAtMs: i.servedAtMs }); },
      ...over,
    };
  }

  it("a recorded serve with opt-in gets exactly one token, bound to that serve and the authorized publisher", async () => {
    const r = await serveAd("h".repeat(64), request, deps());
    assert.equal(r.kind, "ad");
    assert.ok(r.kind === "ad" && r.tracking);
    assert.deepEqual(issued, [{ publisherId: PUB, serveRef: REF, servedAtMs: NOW }]);
  });

  it("no opt-in, no issuer, or no receipt => no tracking (the ad is still served)", async () => {
    for (const [req, d] of [
      [{ ...request, trackingRequested: undefined }, deps()],
      [{ ...request, trackingRequested: false }, deps()],
      [request, deps({ issueTracking: undefined })],
      [request, deps({ record: async () => ({ outcome: "recorded" }) })],
    ] as const) {
      const r = await serveAd("h".repeat(64), req, d);
      assert.equal(r.kind, "ad");
      assert.equal("tracking" in r, false);
    }
    assert.deepEqual(issued, [], "issuer must not even be called without opt-in/receipt");
  });

  it("an issuer that throws or returns null still serves the ad, without tracking", async () => {
    for (const issueTracking of [() => { throw new Error("x"); }, () => null] as ServeDeps["issueTracking"][]) {
      const r = await serveAd("h".repeat(64), request, deps({ issueTracking }));
      assert.equal(r.kind, "ad");
      assert.equal("tracking" in r, false);
    }
  });

  it("rejected, no-fill, unauthorized, rate-limited and failed paths NEVER call the issuer", async () => {
    const cases: Array<[string, Partial<ServeDeps>]> = [
      ["rejected", { record: async () => ({ outcome: "rejected" }) }],
      ["record error", { record: async () => ({ outcome: "error" }) }],
      ["no fill", { select: async () => ({ fill: false, reason: "no_eligible_ad" }) as never }],
      ["unauthorized", { authorize: async () => ({ outcome: "unauthorized" }) }],
      ["rate limited", { authorize: async () => ({ outcome: "rate_limited" }) }],
      ["authorize error", { authorize: async () => ({ outcome: "error" }) }],
      ["select throws", { select: async () => { throw new Error("x"); } }],
      ["replay rejected", { lookupReplay: async () => ({ outcome: "rejected" }) }],
      ["replay unauthorized", { lookupReplay: async () => ({ outcome: "unauthorized" }) }],
      ["replay error", { lookupReplay: async () => ({ outcome: "error" }) }],
    ];
    for (const [name, over] of cases) {
      const r = await serveAd("h".repeat(64), { ...request, idempotencyKey: "idem-key-0001" }, deps(over));
      assert.notEqual(r.kind, "ad", name);
      assert.equal("tracking" in r, false, name);
      assert.deepEqual(issued, [], `${name}: issuer called`);
    }
  });

  it("replay (found) uses the ORIGINAL serve's receipt; a replay without a receipt (older serve) has no token", async () => {
    const withReceipt = deps({ lookupReplay: async () => ({ outcome: "found", ad, serve: receipt }) });
    const r1 = await serveAd("h".repeat(64), { ...request, idempotencyKey: "idem-key-0001" }, withReceipt);
    assert.ok(r1.kind === "ad" && r1.tracking);
    assert.deepEqual(issued, [{ publisherId: PUB, serveRef: REF, servedAtMs: NOW }]);

    const legacy = deps({ lookupReplay: async () => ({ outcome: "found", ad }) });
    const r2 = await serveAd("h".repeat(64), { ...request, idempotencyKey: "idem-key-0001" }, legacy);
    assert.equal(r2.kind, "ad");
    assert.equal("tracking" in r2, false);
  });

  it("a concurrent-retry race (record returns replayedAd + receipt) gives the first serve's token, not a new one", async () => {
    const d = deps({ record: async () => ({ outcome: "recorded", replayedAd: ad, serve: { serveRef: REF_2, servedAtMs: NOW } }) });
    const r = await serveAd("h".repeat(64), { ...request, idempotencyKey: "idem-key-0001" }, d);
    assert.deepEqual(issued.map((i) => i.serveRef), [REF_2]);
    assert.equal(r.kind, "ad");
  });
});

// ===========================================================================================================================
describe("day 12 part 3 | database result parsing", () => {
  const at = new Date(NOW).toISOString();

  it("parseServeReceipt accepts only a well-formed ref and a real timestamp (postgres microsecond format included)", () => {
    assert.deepEqual(parseServeReceipt({ serve_ref: REF, served_at: at }), { serveRef: REF, servedAtMs: NOW });
    assert.deepEqual(parseServeReceipt({ serve_ref: REF, served_at: "2026-10-28T10:00:00.123456+00:00" })?.serveRef, REF);
    for (const bad of [
      {}, { serve_ref: REF }, { served_at: at }, { serve_ref: null, served_at: at }, { serve_ref: "bsr_x", served_at: at },
      { serve_ref: REF.toUpperCase(), served_at: at }, { serve_ref: REF, served_at: "yesterday" }, { serve_ref: REF, served_at: 5 }, { serve_ref: 5, served_at: at },
    ]) assert.equal(parseServeReceipt(bad), undefined, JSON.stringify(bad));
  });

  it("record result: ok keeps the receipt; ok without or with a bad receipt is still 'recorded' (just no token)", () => {
    assert.deepEqual(parseRecordResult({ outcome: "ok", serve_ref: REF, served_at: at }), { outcome: "recorded", serve: { serveRef: REF, servedAtMs: NOW } });
    assert.deepEqual(parseRecordResult({ outcome: "ok" }), { outcome: "recorded" });
    assert.deepEqual(parseRecordResult({ outcome: "ok", serve_ref: "bsr_bad", served_at: at }), { outcome: "recorded" });
    assert.deepEqual(parseRecordResult({ outcome: "rejected", serve_ref: REF, served_at: at }), { outcome: "rejected" });
    assert.deepEqual(parseRecordResult({ outcome: "unauthorized", serve_ref: REF, served_at: at }), { outcome: "rejected" });
    assert.deepEqual(parseRecordResult({ outcome: "nonsense", serve_ref: REF, served_at: at }), { outcome: "error" });
  });

  it("replay results carry the receipt for found/replayed, and never invent one for none/rejected", () => {
    const adRow = { id: "11111111-1111-4111-8111-111111111111", headline: "h", body: "b", cta_text: null, destination_url: "https://example.com" };
    const found = parseReplayResult({ outcome: "found", ad: adRow, serve_ref: REF, served_at: at });
    assert.ok(found.outcome === "found" && found.serve?.serveRef === REF);
    const old = parseReplayResult({ outcome: "found", ad: adRow, serve_ref: null, served_at: null });
    assert.ok(old.outcome === "found" && old.serve === undefined);
    assert.deepEqual(parseReplayResult({ outcome: "none", serve_ref: REF, served_at: at }), { outcome: "none" });
    assert.deepEqual(parseReplayResult({ outcome: "rejected", serve_ref: REF, served_at: at }), { outcome: "rejected" });
    const rec = parseRecordResult({ outcome: "ok", replayed: true, ad: adRow, serve_ref: REF, served_at: at });
    assert.ok(rec.outcome === "recorded" && rec.replayedAd && rec.serve?.serveRef === REF);
  });
});

// ===========================================================================================================================
// Handler integration (route -> handler -> serve -> fake DB). Har response ka leak-scan upar se.
const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
const realError = console.error;
const KEY_A = makeKey("a");
const KEY_B = makeKey("b");
let db: FakeAdDb;
let savedEnv: Record<string, string | undefined>;

const ENV_NAMES = ["AD_TRACKING_SECRET", "AD_TRACKING_SECRET_PREVIOUS", "AD_TRACKING_TTL_SECONDS"] as const;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_NAMES.map((n) => [n, process.env[n]]));
  process.env.AD_TRACKING_SECRET = SECRET;
  delete process.env.AD_TRACKING_SECRET_PREVIOUS;
  delete process.env.AD_TRACKING_TTL_SECONDS;
  console.error = () => {};
  db = new FakeAdDb();
  globals.__TEST_SUPABASE__ = db.client();
});
afterEach(() => {
  for (const n of ENV_NAMES) {
    if (savedEnv[n] === undefined) delete process.env[n];
    else process.env[n] = savedEnv[n];
  }
  console.error = realError;
});

function world(topic = "gaming") {
  const pub = db.addPublisher("active");
  db.addKey(pub.id, KEY_A);
  const adv = db.addAdvertiser("active");
  const ad = db.addAd(adv.id, { category: topic });
  return { pub, adv, ad };
}

type Sent = { res: Response; body: Record<string, unknown>; text: string };
async function send(
  body: unknown,
  opts: { key?: string | null; headers?: Record<string, string>; handler?: (r: Request) => Promise<Response> } = {},
): Promise<Sent> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(opts.headers ?? {}) };
  const key = opts.key === undefined ? KEY_A : opts.key;
  if (key) headers.authorization = `Bearer ${key}`;
  const req = new Request("https://example.test/api/v1/ads/match", { method: "POST", headers, body: JSON.stringify(body) });
  const handler = opts.handler ?? ((r: Request) => handleMatchPost(r, { ipGuard: createIpGuard() }));
  const res = await handler(req);
  const text = await res.text();
  return { res, body: JSON.parse(text) as Record<string, unknown>, text };
}
const TRACK = { "x-blisscco-tracking": "1" };
const tracking = (s: Sent) => s.body.tracking as { token: string; expires_at: string; events: string[] } | undefined;

describe("day 12 part 3 | success with opt-in", () => {
  for (const [name, post] of [["/api/v1/ads/match", v1Route.POST], ["/api/ads/match (legacy)", legacyRoute.POST]] as const) {
    it(`${name}: returns the five ad fields plus tracking; token is bound to the recorded serve`, async () => {
      const { pub, ad } = world();
      const s = await send({ topic: "gaming" }, { headers: TRACK, handler: post });
      assert.equal(s.res.status, 200);
      assert.equal(s.res.headers.get("cache-control"), "no-store");
      assert.equal(s.body.fill, true);
      assert.strictEqual(s.body.sponsored, true);
      assert.deepEqual(Object.keys(s.body).sort(), ["ad", "fill", "sponsored", "tracking"]);
      assert.deepEqual(Object.keys(s.body.ad as object).sort(), [...PUBLIC_AD_FIELDS].sort());
      assert.equal((s.body.ad as { id: string }).id, ad.creativeId);

      const t = tracking(s)!;
      assert.deepEqual(Object.keys(t).sort(), [...PUBLIC_TRACKING_FIELDS].sort());
      assert.deepEqual(t.events, ["impression", "click"]);
      assert.equal(db.servesFor(pub.id).length, 1, "exactly one serve row");
      const serve = db.serveLog[0];
      const v = verifyTrackingToken(t.token, "impression", readTrackingConfig(process.env)!, Date.now());
      assert.ok(v.ok);
      assert.equal(v.ok && v.claims.serveRef, serve.serveRef);
      assert.equal(v.ok && v.claims.publisherTag, publisherTag(SECRET, pub.id));
      assert.equal(t.expires_at, new Date(Math.floor(serve.servedAtMs / 1000) * 1000 + 3600_000).toISOString());
    });
  }

  it("the response (and token payload) never contains the API key, its hash, the secret, publisher/campaign ids or a sequential serve id", async () => {
    const { pub, ad } = world();
    const s = await send({ topic: "gaming" }, { headers: TRACK });
    const payloadText = Buffer.from(tracking(s)!.token.split(".")[1], "base64url").toString("utf8");
    for (const hay of [s.text, payloadText]) {
      for (const secretish of [KEY_A, sha256(KEY_A), SECRET, "blc_live_", pub.id, ad.campaignId, "service_role", "sb_secret_"]) {
        assert.equal(hay.includes(secretish), false, `leaked: ${secretish.slice(0, 20)}`);
      }
    }
    assert.equal(/"(serve_id|id)":\s*\d+/.test(s.text), false, "no sequential id");
    // serve ref sirf token ke ANDAR (base64) hai: na alag field, na plain text.
    assert.equal(Object.keys(s.body).includes("serve_ref"), false);
    assert.equal(s.text.includes(db.serveLog[0].serveRef), false, "serve ref must not appear in plain text");
    assert.equal(payloadText.includes(db.serveLog[0].serveRef), true, "serve ref is inside the signed token payload");
  });

  it("ttl env changes the token lifetime (anchored on the serve time)", async () => {
    world();
    process.env.AD_TRACKING_TTL_SECONDS = "600";
    const s = await send({ topic: "gaming" }, { headers: TRACK });
    const serve = db.serveLog[0];
    assert.equal(tracking(s)!.expires_at, new Date(Math.floor(serve.servedAtMs / 1000) * 1000 + 600_000).toISOString());
  });

  it("a token minted before a secret rotation still verifies after rotation; new tokens use the new secret", async () => {
    world();
    const before = tracking(await send({ topic: "gaming" }, { headers: TRACK }))!.token;
    process.env.AD_TRACKING_SECRET_PREVIOUS = SECRET;
    process.env.AD_TRACKING_SECRET = OTHER_SECRET;
    const cfg = readTrackingConfig(process.env)!;
    assert.equal(verifyTrackingToken(before, "click", cfg, Date.now()).ok, true);
    const after = tracking(await send({ topic: "gaming" }, { headers: TRACK }))!.token;
    const v = verifyTrackingToken(after, "click", cfg, Date.now());
    assert.equal(v.ok && v.claims.secretIndex, 0);
  });
});

describe("day 12 part 3 | opt-in off, tracking unavailable and bad header", () => {
  it("without the header the response is EXACTLY the old contract, even though a secret is configured", async () => {
    world();
    const s = await send({ topic: "gaming" });
    assert.equal(s.res.status, 200);
    assert.deepEqual(Object.keys(s.body).sort(), ["ad", "fill", "sponsored"]);
    assert.equal(s.text.includes("bt1."), false);
    assert.equal(db.serveLog.length, 1, "the serve itself is recorded as before");
  });

  it("opt-in but no/weak secret: ad is served exactly as before, without tracking, nothing breaks", async () => {
    for (const secret of [undefined, "", "short", `sb_secret_${"x".repeat(40)}`]) {
      db = new FakeAdDb();
      globals.__TEST_SUPABASE__ = db.client();
      world();
      if (secret === undefined) delete process.env.AD_TRACKING_SECRET;
      else process.env.AD_TRACKING_SECRET = secret;
      const s = await send({ topic: "gaming" }, { headers: TRACK });
      assert.equal(s.res.status, 200, String(secret));
      assert.deepEqual(Object.keys(s.body).sort(), ["ad", "fill", "sponsored"], String(secret));
      assert.equal(db.serveLog.length, 1);
    }
  });

  it("opt-in against a database that has not run day-12-5 yet (no serve_ref returned): ad served, no token, no error", async () => {
    world();
    db.legacyNoServeRef = true;
    const s = await send({ topic: "gaming" }, { headers: TRACK });
    assert.equal(s.res.status, 200);
    assert.equal(s.body.fill, true);
    assert.equal("tracking" in s.body, false);
  });

  it("a malformed or foreign serve_ref from the database yields no token", async () => {
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
    assert.equal("tracking" in s.body, false);
  });

  it("invalid opt-in header values => 400 invalid_tracking_header and NOTHING is served or charged", async () => {
    const { ad } = world();
    for (const bad of ["0", "true", "", "1, 1", "yes", "2"]) {
      const s = await send({ topic: "gaming" }, { headers: { "x-blisscco-tracking": bad } });
      assert.equal(s.res.status, 400, bad);
      assert.deepEqual(s.body, { error: "invalid_request", reason: "invalid_tracking_header" }, bad);
    }
    assert.equal(db.serveLog.length, 0);
    assert.equal(db.spendOf(ad.campaignId), 0);
    assert.equal(db.calls.some((c) => c.name === "record_ad_serve"), false);
  });
});

describe("day 12 part 3 | no-fill, unauthorized, rejected and failed requests never create a token", () => {
  const noToken = (s: Sent) => {
    assert.equal("tracking" in s.body, false);
    assert.equal(s.text.includes("bt1."), false);
  };

  it("no-fill (sensitive topic, unsupported topic, no candidates)", async () => {
    world();
    for (const topic of ["health", "unknown_topic_xyz"]) {
      const s = await send({ topic }, { headers: TRACK });
      assert.deepEqual(s.body, { fill: false }, topic);
    }
    db = new FakeAdDb();
    globals.__TEST_SUPABASE__ = db.client();
    const pub = db.addPublisher("active");
    db.addKey(pub.id, KEY_A);
    const s = await send({ topic: "gaming" }, { headers: TRACK });
    assert.deepEqual(s.body, { fill: false });
    assert.equal(db.serveLog.length, 0);
  });

  it("unauthorized (unknown, revoked key, suspended publisher) => 401, no serve, no token", async () => {
    const { pub } = world();
    noToken(await send({ topic: "gaming" }, { headers: TRACK, key: makeKey("9") }));
    noToken(await send({ topic: "gaming" }, { headers: TRACK, key: null }));
    db.revokeKey(KEY_A);
    const revoked = await send({ topic: "gaming" }, { headers: TRACK });
    assert.equal(revoked.res.status, 401);
    noToken(revoked);
    db.addKey(pub.id, KEY_B);
    db.setPublisherStatus(pub.id, "suspended");
    const suspended = await send({ topic: "gaming" }, { headers: TRACK, key: KEY_B });
    assert.equal(suspended.res.status, 401);
    noToken(suspended);
    assert.equal(db.serveLog.length, 0);
  });

  it("rate-limited => 429, no token, no serve", async () => {
    world();
    db.rateLimitPerMinute = 1;
    const ok = await send({ topic: "gaming" }, { headers: TRACK });
    assert.equal(ok.res.status, 200);
    const limited = await send({ topic: "gaming" }, { headers: TRACK });
    assert.equal(limited.res.status, 429);
    noToken(limited);
    assert.equal(db.serveLog.length, 1);
  });

  it("invalid body, wrong content-type => 4xx, no token, no serve", async () => {
    world();
    const bad = await send({ topic: "Gaming Laptops" }, { headers: TRACK });
    assert.equal(bad.res.status, 400);
    noToken(bad);
    const extra = await send({ topic: "gaming", prompt: "hi" }, { headers: TRACK });
    assert.equal(extra.res.status, 400);
    noToken(extra);
    assert.equal(db.serveLog.length, 0);
  });

  it("the database rejects the chosen creative (budget/paused race) => no-fill, no token, nothing charged", async () => {
    const { ad } = world();
    const real = db.client();
    globals.__TEST_SUPABASE__ = {
      rpc: async (name: string, args: Record<string, unknown>) =>
        name === "record_ad_serve" ? { data: { outcome: "rejected" }, error: null } : real.rpc(name, args),
    };
    const s = await send({ topic: "gaming" }, { headers: TRACK });
    assert.deepEqual(s.body, { fill: false });
    assert.equal(db.serveLog.length, 0);
    assert.equal(db.spendOf(ad.campaignId), 0);
  });

  it("first record attempt rejected, next eligible ad recorded: the token belongs ONLY to the recorded serve", async () => {
    const adv = db.addAdvertiser("active");
    const pub = db.addPublisher("active");
    db.addKey(pub.id, KEY_A);
    db.addAd(adv.id, { category: "gaming" });
    db.addAd(adv.id, { category: "gaming" });
    const real = db.client();
    let recordCalls = 0;
    globals.__TEST_SUPABASE__ = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === "record_ad_serve") {
          recordCalls += 1;
          if (recordCalls === 1) return { data: { outcome: "rejected" }, error: null };
        }
        return real.rpc(name, args);
      },
    };
    const s = await send({ topic: "gaming" }, { headers: TRACK });
    assert.equal(s.body.fill, true);
    assert.equal(recordCalls, 2);
    assert.equal(db.serveLog.length, 1);
    const v = verifyTrackingToken(tracking(s)!.token, "click", readTrackingConfig(process.env)!, Date.now());
    assert.equal(v.ok && v.claims.serveRef, db.serveLog[0].serveRef);
  });

  it("record rpc error / database outage => 503 fill:false, no token, nothing charged", async () => {
    const { ad } = world();
    db.failRpc.record_ad_serve = { data: null, error: { code: "XX000", message: "boom" } };
    const s = await send({ topic: "gaming" }, { headers: TRACK });
    assert.equal(s.res.status, 503);
    assert.deepEqual(s.body, { fill: false, error: "unavailable" });
    noToken(s);
    assert.equal(db.spendOf(ad.campaignId), 0);

    db.failRpc = { load_ad_candidates: { data: null, error: { code: "XX000", message: "boom" } } };
    const s2 = await send({ topic: "gaming" }, { headers: TRACK });
    assert.equal(s2.res.status, 503);
    noToken(s2);
    db.failRpc = { authorize_publisher_key: { data: null, error: { code: "XX000", message: "boom" } } };
    const s3 = await send({ topic: "gaming" }, { headers: TRACK });
    assert.equal(s3.res.status, 503);
    noToken(s3);
    assert.equal(db.serveLog.length, 0);
  });

  it("an unexpected crash inside the handler => 503 without a token", async () => {
    world();
    globals.__TEST_SUPABASE__ = undefined;
    const s = await send({ topic: "gaming" }, { headers: TRACK });
    assert.equal(s.res.status, 503);
    noToken(s);
  });
});

describe("day 12 part 3 | Idempotency-Key retries cannot create a second serve or a second token", () => {
  const IDEM = "0b7e3c1a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
  const idem = (k = IDEM) => ({ ...TRACK, "idempotency-key": k });

  it("the same key twice: one serve row, one charge, same ad, byte-identical tracking", async () => {
    const { ad } = world();
    const first = await send({ topic: "gaming" }, { headers: idem() });
    const second = await send({ topic: "gaming" }, { headers: idem() });
    assert.equal(first.res.status, 200);
    assert.equal(second.res.status, 200);
    assert.deepEqual(second.body, first.body, "identical response");
    assert.equal(db.serveLog.length, 1, "no second serve record");
    assert.equal(db.spendOf(ad.campaignId), db.unitCostUsd, "charged once");
    assert.equal(tracking(first)!.token, tracking(second)!.token);
    assert.equal(db.calls.filter((c) => c.name === "record_ad_serve").length, 1, "the retry never even reached record_ad_serve");
  });

  it("five concurrent requests with the same key: one serve, one charge, all get the same token", async () => {
    const { ad } = world();
    const all = await Promise.all(Array.from({ length: 5 }, () => send({ topic: "gaming" }, { headers: idem() })));
    assert.equal(db.serveLog.length, 1);
    assert.equal(db.spendOf(ad.campaignId), db.unitCostUsd);
    assert.equal(new Set(all.map((s) => tracking(s)!.token)).size, 1);
    assert.equal(new Set(all.map((s) => JSON.stringify(s.body))).size, 1);
  });

  it("the first request did not ask for tracking, the retry does: the retry gets the token of the SAME serve (still one serve)", async () => {
    world();
    const first = await send({ topic: "gaming" }, { headers: { "idempotency-key": IDEM } });
    assert.equal("tracking" in first.body, false);
    const retry = await send({ topic: "gaming" }, { headers: idem() });
    assert.equal(db.serveLog.length, 1);
    const v = verifyTrackingToken(tracking(retry)!.token, "click", readTrackingConfig(process.env)!, Date.now());
    assert.equal(v.ok && v.claims.serveRef, db.serveLog[0].serveRef);
  });

  it("the first request asked for tracking, the retry does not: retry response has no tracking, still one serve", async () => {
    world();
    await send({ topic: "gaming" }, { headers: idem() });
    const retry = await send({ topic: "gaming" }, { headers: { "idempotency-key": IDEM } });
    assert.equal("tracking" in retry.body, false);
    assert.equal(db.serveLog.length, 1);
  });

  it("different keys are different serves with different serve refs and different tokens", async () => {
    world();
    const a = await send({ topic: "gaming" }, { headers: idem("key-aaaaaaaa-1") });
    const b = await send({ topic: "gaming" }, { headers: idem("key-bbbbbbbb-2") });
    assert.equal(db.serveLog.length, 2);
    assert.notEqual(db.serveLog[0].serveRef, db.serveLog[1].serveRef);
    assert.notEqual(tracking(a)!.token, tracking(b)!.token);
  });

  it("the same key from a DIFFERENT publisher is an independent serve and never returns the first publisher's token", async () => {
    const { pub } = world();
    const pubB = db.addPublisher("active");
    db.addKey(pubB.id, KEY_B);
    const a = await send({ topic: "gaming" }, { headers: idem() });
    const b = await send({ topic: "gaming" }, { headers: idem(), key: KEY_B });
    assert.equal(db.serveLog.length, 2);
    assert.deepEqual(db.serveLog.map((s) => s.publisherId).sort(), [pub.id, pubB.id].sort());
    assert.notEqual(tracking(a)!.token, tracking(b)!.token);
    const cfg = readTrackingConfig(process.env)!;
    const va = verifyTrackingToken(tracking(a)!.token, "click", cfg, Date.now());
    const vb = verifyTrackingToken(tracking(b)!.token, "click", cfg, Date.now());
    assert.equal(va.ok && va.claims.publisherTag, publisherTag(SECRET, pub.id));
    assert.equal(vb.ok && vb.claims.publisherTag, publisherTag(SECRET, pubB.id));
  });

  it("a very late retry (token lifetime over) returns the ad without tracking; it does not mint a fresh token or a new serve", async () => {
    const { ad } = world();
    await send({ topic: "gaming" }, { headers: idem() });
    db.serveLog[0].servedAtMs -= 2 * HOUR; // serve ab 2 ghante purani
    const retry = await send({ topic: "gaming" }, { headers: idem() });
    assert.equal(retry.res.status, 200);
    assert.equal(retry.body.fill, true);
    assert.equal("tracking" in retry.body, false);
    assert.equal(db.serveLog.length, 1);
    assert.equal(db.spendOf(ad.campaignId), db.unitCostUsd);
  });

  it("a retry of a serve made before day-12-5 (no serve link) returns the ad with no token", async () => {
    world();
    db.legacyNoServeRef = true;
    await send({ topic: "gaming" }, { headers: idem() });
    const retry = await send({ topic: "gaming" }, { headers: idem() });
    assert.equal(retry.body.fill, true);
    assert.equal("tracking" in retry.body, false);
    assert.equal(db.serveLog.length, 1);
  });

  it("retry after the creative stopped being eligible: no-fill, no token, still one serve", async () => {
    const { ad } = world();
    await send({ topic: "gaming" }, { headers: idem() });
    db.setCreativeStatus(ad.creativeId, "paused");
    const retry = await send({ topic: "gaming" }, { headers: idem() });
    assert.deepEqual(retry.body, { fill: false });
    assert.equal(db.serveLog.length, 1);
  });

  it("a retry whose lookup fails (db outage) is 503 without a token and without a new serve", async () => {
    world();
    await send({ topic: "gaming" }, { headers: idem() });
    db.failRpc.find_idempotent_serve = { data: null, error: { code: "XX000", message: "boom" } };
    const retry = await send({ topic: "gaming" }, { headers: idem() });
    assert.equal(retry.res.status, 503);
    assert.equal("tracking" in retry.body, false);
    assert.equal(db.serveLog.length, 1);
  });
});

describe("day 12 part 3 | tokens stay tied to their own serve (no cross-use)", () => {
  it("serve A's token cannot report for serve B, and each unknown ref is rejected", async () => {
    world();
    const a = tracking(await send({ topic: "gaming" }, { headers: { ...TRACK, "idempotency-key": "key-aaaaaaaa-1" } }))!.token;
    const b = tracking(await send({ topic: "gaming" }, { headers: { ...TRACK, "idempotency-key": "key-bbbbbbbb-2" } }))!.token;
    const [sa, sb] = db.serveLog;
    const lookup = async (ref: string) => {
      const row = db.serveLog.find((s) => s.serveRef === ref);
      return row ? { publisherId: row.publisherId, servedAtMs: row.servedAtMs } : null;
    };
    const cfg = readTrackingConfig(process.env)!;
    const d = { config: cfg, nowMs: Date.now(), lookupServe: lookup };
    const ra = await verifyTrackedEvent(a, "impression", d);
    const rb = await verifyTrackedEvent(b, "click", d);
    assert.ok(ra.ok && ra.serveRef === sa.serveRef);
    assert.ok(rb.ok && rb.serveRef === sb.serveRef);
    // Payload badalkar A ko B bana do => signature toot-ti hai
    const forged = `bt1.${b.split(".")[1]}.${a.split(".")[2]}`;
    assert.equal(verifyTrackingToken(forged, "click", cfg, Date.now()).ok, false);
    // Us serve ka row purge ho gaya (ya kabhi tha hi nahi) => unknown_serve
    const gone = await verifyTrackedEvent(a, "click", { ...d, lookupServe: async () => null });
    assert.deepEqual(gone, { ok: false, reason: "unknown_serve" });
  });
});

// ===========================================================================================================================
describe("day 12 part 3 | source safety", () => {
  const walk = (dir: string): string[] =>
    readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${dir}/${e.name}`] : [],
    );

  it("the signing secret is read in exactly one place (service.ts) and never in browser-facing code or under a public prefix", () => {
    const users = ["app", "lib", "components"].flatMap(walk).filter((f) => /AD_TRACKING_SECRET/.test(read(f)));
    assert.deepEqual(users.sort(), ["lib/ads/service.ts", "lib/ads/tracking-token.ts"]);
    assert.equal(/process\.env/.test(read("lib/ads/tracking-token.ts")), false, "token module is pure: env comes in as an argument");
    for (const f of [...walk("app"), ...walk("lib"), ...walk("components"), ".env.example"]) {
      const src = f === ".env.example" ? read(f) : read(f);
      assert.equal(/NEXT_PUBLIC_[A-Z_]*TRACKING/.test(src), false, `${f}: public tracking variable`);
    }
    // Client components / pages kabhi token module nahi kheenchte
    for (const f of [...walk("app"), ...walk("components")]) {
      assert.equal(/tracking-token/.test(read(f)), false, `${f} imports the token module`);
    }
  });

  it(".env.example documents the secret with a placeholder that the code refuses (a copied placeholder can never become a live secret)", () => {
    const env = read(".env.example");
    const m = /^AD_TRACKING_SECRET=(.+)$/m.exec(env);
    assert.ok(m, "AD_TRACKING_SECRET placeholder missing");
    assert.match(m[1], /^YOUR-/);
    assert.ok(m[1].length >= 32, "placeholder is deliberately long enough that only the placeholder rule can reject it");
    assert.equal(readTrackingConfig({ AD_TRACKING_SECRET: m[1] }), null);
    assert.equal(/^AD_TRACKING_SECRET_PREVIOUS=./m.test(env), false);
  });

  it("the token module has no logging, network, database or event-writing code", () => {
    const src = read("lib/ads/tracking-token.ts");
    assert.equal(/console\.|fetch\(|supabase|\.rpc\(|ad_events|record_ad_event|sendBeacon/.test(src), false);
  });

  it("serve.ts stays pure (no env, database, logging) after the change", () => {
    const pure = read("lib/ads/serve.ts").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    assert.equal(/server-only|supabase|process\.env|console\./.test(pure), false);
  });

  it("no new route, table writer, beacon or pixel was added", () => {
    const routes = walk("app/api").map((f) => f.replace(/\\/g, "/")).sort();
    assert.deepEqual(routes, ["app/api/ads/match/route.ts", "app/api/supabase-health/route.ts", "app/api/v1/ads/match/route.ts"]);
    for (const f of ["app", "lib", "components"].flatMap(walk)) {
      assert.equal(/sendBeacon|tracking pixel|record_ad_event|\bad_events\b/.test(read(f)), false, f);
    }
  });
});

// ===========================================================================================================================
describe("day 12 part 3 | SQL (static check; the SQL was NOT run)", () => {
  const SQL = "supabase/sql";
  const M5 = `${SQL}/day-12-5-serve-ref-return.sql`;
  const code = (f: string) => read(f).split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  /** Ek function ka poora text (create or replace ... $$; tak), signature ki pehli line se dhoondh kar. */
  function fnText(sql: string, startsWith: RegExp): string[] {
    const m = startsWith.exec(sql);
    assert.ok(m, `function not found: ${startsWith}`);
    const rest = sql.slice(m.index);
    const end = rest.indexOf("\n$$;");
    assert.ok(end > 0);
    return rest.slice(0, end).split("\n");
  }
  const strip = (lines: string[]) => lines.map((l) => l.trimEnd()).filter((l) => l.trim() !== "" && !l.trim().startsWith("--"));
  /** Purane function ki har line naye me maujood honi chahiye; sirf jaan-boojh kar badli lines gayab ho sakti hain. */
  function missingFrom(oldLines: string[], newLines: string[]): string[] {
    const set = new Set(strip(newLines));
    return strip(oldLines).filter((l) => !set.has(l));
  }

  it("is additive: no drop, truncate, delete, rls disable or grant to app roles; ad_events is never written", () => {
    const sql = code(M5).toLowerCase();
    assert.doesNotMatch(sql, /\bdrop\s+(table|column|function|trigger|index|constraint)\b/);
    assert.doesNotMatch(sql, /\btruncate\b|\bdelete\s+from\b|\bdisable\s+row\s+level\b/);
    assert.doesNotMatch(sql, /grant\s+[^;]*\bto\s+(anon|authenticated|public)\b/);
    assert.doesNotMatch(sql, /ad_events/);
    assert.match(sql, /add column if not exists serve_id bigint;/);
    assert.match(sql, /on delete set null/);
    // sirf ek commit, ek begin
    assert.equal((sql.match(/^begin;/gm) ?? []).length, 1);
    assert.equal((sql.match(/^commit;/gm) ?? []).length, 1);
  });

  it("record_ad_serve (3 args): every original billing statement is still there; the ONLY lines that changed are the serve_ref capture and return", () => {
    const old = fnText(read(`${SQL}/day-7-1-budget-keys-retention.sql`), /create or replace function public\.record_ad_serve\(\n  p_key_hash    text,/);
    const now = fnText(read(M5), /create or replace function public\.record_ad_serve\(\n  p_key_hash    text,/);
    assert.deepEqual(missingFrom(old, now), [
      "  values (v_publisher_id, p_creative_id, v_campaign_id, p_topic);",
      "  return jsonb_build_object('outcome', 'ok');",
    ]);
    const added = strip(now).filter((l) => !new Set(strip(old)).has(l));
    assert.deepEqual(added, [
      "  v_serve_ref    text;",
      "  v_served_at    timestamptz;",
      "  values (v_publisher_id, p_creative_id, v_campaign_id, p_topic)",
      "  returning serve_ref, served_at into v_serve_ref, v_served_at;",
      "  return jsonb_build_object('outcome', 'ok', 'serve_ref', v_serve_ref, 'served_at', v_served_at);",
    ]);
  });

  it("record_ad_serve (4 args): lock, replay-before-charge and the call into the 3-arg function are unchanged; only the retry-key insert gained serve_id", () => {
    const old = fnText(read(`${SQL}/day-9-5-atomic-spend-idempotency.sql`), /create or replace function public\.record_ad_serve\(\n  p_key_hash        text,/);
    const now = fnText(read(M5), /create or replace function public\.record_ad_serve\(\n  p_key_hash        text,/);
    assert.deepEqual(missingFrom(old, now), [
      "  insert into public.ad_serve_requests (publisher_id, idempotency_key, creative_id, campaign_id)",
      "  values (v_publisher_id, p_idempotency_key, p_creative_id, v_campaign_id)",
    ]);
    const joined = strip(now).join("\n");
    assert.match(joined, /pg_advisory_xact_lock/);
    assert.match(joined, /v_replay := private\.replay_serve\(v_publisher_id, p_idempotency_key\);\n\s+if v_replay is not null then\n\s+return v_replay;/);
    assert.match(joined, /v_result := public\.record_ad_serve\(p_key_hash, p_creative_id, p_topic\);/);
    assert.match(joined, /where s\.serve_ref = v_result ->> 'serve_ref'/);
  });

  it("replay_serve keeps the day-9-7 eligibility rules (schedule, advertiser, profile) and only adds serve_ref/served_at", () => {
    const old = fnText(read(`${SQL}/day-9-7-lifecycle-guards.sql`), /create or replace function private\.replay_serve\(/);
    const now = fnText(read(M5), /create or replace function private\.replay_serve\(/);
    assert.deepEqual(missingFrom(old, now), ["  select q.creative_id into v_creative"]);
    for (const needle of ["c.start_date <= v_today", "a.status  = 'active'", "ap.status = 'active'", "x.status = 'approved'"]) {
      assert.ok(now.join("\n").includes(needle), needle);
    }
  });

  it("find_idempotent_serve keeps its auth/rate rules and only adds the receipt to 'found'", () => {
    const old = fnText(read(`${SQL}/day-9-5-atomic-spend-idempotency.sql`), /create or replace function public\.find_idempotent_serve\(/);
    const now = fnText(read(M5), /create or replace function public\.find_idempotent_serve\(/);
    assert.deepEqual(missingFrom(old, now), ["    return jsonb_build_object('outcome', 'found', 'ad', v_replay -> 'ad');"]);
  });

  it("security definer + empty search_path on every replaced function; grants are re-stated service_role only", () => {
    const sql = read(M5);
    assert.equal((sql.match(/security definer/g) ?? []).length, 4);
    assert.equal((sql.match(/set search_path = ''/g) ?? []).length, 4);
    assert.match(sql, /revoke all on function public\.record_ad_serve\(text, uuid, text\) from public, anon, authenticated;/);
    assert.match(sql, /grant execute on function public\.record_ad_serve\(text, uuid, text\) to service_role;/);
    assert.match(sql, /revoke all on function public\.record_ad_serve\(text, uuid, text, text\) from public, anon, authenticated;/);
    assert.match(sql, /grant execute on function public\.record_ad_serve\(text, uuid, text, text\) to service_role;/);
    assert.match(sql, /revoke all on function public\.find_idempotent_serve\(text, text\) from public, anon, authenticated;/);
    assert.match(sql, /revoke all on function private\.replay_serve\(uuid, text\) from public, anon, authenticated, service_role;/);
    assert.equal(/grant execute[^;]*private\.replay_serve/.test(sql), false);
  });

  it("the migration returns only serve_ref + served_at (never the sequential id) to the API layer", () => {
    const sql = code(M5);
    assert.doesNotMatch(sql, /'serve_id'/);
    assert.doesNotMatch(sql, /'id',\s*v_serve_id/);
  });

  it("the verify file (day-12-6) is read-only", () => {
    const sql = code(`${SQL}/day-12-6-serve-ref-return-verify.sql`).replace(/'(?:[^']|'')*'/g, "''").toLowerCase();
    assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/);
    assert.match(sql, /^\s*with checks\(check_name, passed, detail\)/m);
  });
});

// ===========================================================================================================================
describe("day 12 part 3 | publisher guide matches the real contract", () => {
  const GUIDE = "app/dashboard/publisher/guide/page.tsx";
  const flat = (f: string) => read(f).replace(/\s+/g, " ");
  function lines(name: string): string {
    const m = new RegExp(`const ${name} = (\\[[\\s\\S]*?\\])\\.join\\("\\\\n"\\);`).exec(read(GUIDE));
    assert.ok(m, `${name} not found in guide`);
    return (new Function(`return ${m[1]}`)() as string[]).join("\n");
  }

  it("the tracking success example has exactly the real shape: 5 ad fields + tracking{token, expires_at, events}", () => {
    const body = JSON.parse(lines("TRACKING_SUCCESS_EXAMPLE")) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["ad", "fill", "sponsored", "tracking"]);
    assert.strictEqual(body.sponsored, true);
    assert.deepEqual(Object.keys(body.ad as object).sort(), [...PUBLIC_AD_FIELDS].sort());
    const t = body.tracking as { token: string; expires_at: string; events: string[] };
    assert.deepEqual(Object.keys(t).sort(), [...PUBLIC_TRACKING_FIELDS].sort());
    assert.match(t.token, /^bt1\./);
    assert.equal(new Date(t.expires_at).toISOString(), t.expires_at);
    assert.deepEqual(t.events, ["impression", "click"]);
    assert.equal(/blc_live_[0-9a-f]{8,}/.test(JSON.stringify(body)), false);
  });

  it("the original success example is untouched (still the old three keys); the cURL tracking example uses the real header", () => {
    const old = JSON.parse(lines("SUCCESS_EXAMPLE")) as Record<string, unknown>;
    assert.deepEqual(Object.keys(old).sort(), ["ad", "fill", "sponsored"]);
    const curl = lines("TRACKING_CURL_EXAMPLE");
    assert.match(curl, /X-Blisscco-Tracking: 1/);
    assert.match(curl, /Authorization: Bearer \$BLISSCCO_PUBLISHER_API_KEY/);
    assert.match(curl, /\/api\/v1\/ads\/match/);
    // wahi header sach me handler me padha jaata hai
    assert.match(read("lib/ads/match-handler.ts"), /"x-blisscco-tracking"/);
  });

  it("documents opt-in, the 400 reason, absence cases, retries, and that a token is NOT an impression/click and nothing is reported yet", () => {
    const g = flat(GUIDE);
    for (const needle of [
      "4a. Optional tracking token", "X-Blisscco-Tracking: 1", "invalid_tracking_header", "tracking</code> object", "When <code>tracking</code> is absent",
      "does <strong>not</strong> mean the ad was shown, seen or clicked", "There is no endpoint to send tokens to yet",
      "Retrying with the same <code>Idempotency-Key</code> returns the same ad, the same delivery and the identical token",
    ]) assert.ok(g.includes(needle), needle);
    assert.match(g, /no impression or click reporting/, "the 'no reporting' honesty line is still there");
    assert.match(g, /does not prove that an ad was shown or clicked/);
  });

  it("the guide never tells anyone to put the API key or the signing secret in the browser, and never mentions the signing secret at all", () => {
    const g = read(GUIDE);
    assert.equal(/AD_TRACKING_SECRET|signing secret|service[_ -]role/i.test(g), false);
    assert.match(flat(GUIDE), /Your API key, <code>Idempotency-Key<\/code> and any other credential stay on your server/);
    assert.equal(/production[- ]ready/i.test(flat(GUIDE).replace(/Not ready for production use/gi, "")), false);
  });

  it("the error table mentions the new 400 reason", () => {
    assert.match(read(GUIDE), /invalid_tracking_header/);
  });
});
