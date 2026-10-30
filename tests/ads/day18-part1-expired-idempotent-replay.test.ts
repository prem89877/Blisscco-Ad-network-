import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as legacyRoute from "@/app/api/ads/match/route";
import * as v1Route from "@/app/api/v1/ads/match/route";
import { verifyClickRef } from "@/lib/ads/click-ref";
import { createIpGuard } from "@/lib/ads/ip-guard";
import { handleMatchPost } from "@/lib/ads/match-handler";
import { readTrackingConfig, verifyTrackingToken } from "@/lib/ads/tracking-token";
import { FakeAdDb, makeKey } from "./fake-ad-db";

// Day 18 Part 1: Idempotency-Key retry jab ORIGINAL tracking TTL nikal chuki ho.
// MOCKED test: FakeAdDb (SQL ka model), deterministic clock (Date.now stub), secrets sirf test ke. Koi SQL / asli database / network nahi.
// Niyam: retry hamesha wahi (abhi bhi eligible) ad deti hai, kabhi dusri serve ya dusra charge nahi. Credentials (token + click_ref) sirf
// original expiry (serve ke poore second + TTL) se PEHLE; exp par ya uske baad kabhi nahi, aur ad bina `tracking` ke jaata hai.

const SECRET = "k7f2-0123456789-abcdefghijklmnopqrstuvwxyz-primary";
const SERVED_AT = Date.UTC(2026, 9, 27, 10, 0, 30);
const TTL_MS = 3_600_000;
const EXP = SERVED_AT + TTL_MS; // serve ke poore second + default TTL
const HOUR = 3_600_000;
const KEY_A = makeKey("a");
const KEY_B = makeKey("b");
const IDEM = "0b7e3c1a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const TRACK = { "x-blisscco-tracking": "1" };
const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
const realNow = Date.now;
const realError = console.error;
const ENV_NAMES = ["AD_TRACKING_SECRET", "AD_TRACKING_SECRET_PREVIOUS", "AD_TRACKING_TTL_SECONDS"] as const;
let savedEnv: Record<string, string | undefined> = {};
const clock = { now: SERVED_AT + 5_000 };
let db: FakeAdDb;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_NAMES.map((n) => [n, process.env[n]]));
  process.env.AD_TRACKING_SECRET = SECRET;
  delete process.env.AD_TRACKING_SECRET_PREVIOUS;
  delete process.env.AD_TRACKING_TTL_SECONDS;
  clock.now = SERVED_AT + 5_000;
  Date.now = () => clock.now;
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
  delete globals.__TEST_SUPABASE__;
});

function world() {
  const pub = db.addPublisher("active");
  db.addKey(pub.id, KEY_A);
  const adv = db.addAdvertiser("active");
  const ad = db.addAd(adv.id, { category: "gaming" });
  return { pub, adv, ad };
}
type Sent = { status: number; body: Record<string, unknown> & { ad?: Record<string, unknown>; tracking?: Record<string, unknown> }; text: string };
async function send(opts: { key?: string; idem?: string | null; track?: boolean; post?: (r: Request) => Promise<Response> } = {}): Promise<Sent> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${opts.key ?? KEY_A}`,
    ...(opts.track === false ? {} : TRACK),
    ...(opts.idem === null ? {} : { "idempotency-key": opts.idem ?? IDEM }),
  };
  const res = await (opts.post ?? v1Route.POST)(new Request("https://example.test/api/v1/ads/match", { method: "POST", headers, body: JSON.stringify({ topic: "gaming" }) }));
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text) as Sent["body"], text };
}
const at = (ms: number) => {
  clock.now = ms;
};
const cfg = () => readTrackingConfig(process.env)!;
const noCredentials = (s: Sent) => {
  assert.equal(s.status, 200);
  assert.equal(s.body.fill, true);
  assert.deepEqual(Object.keys(s.body).sort(), ["ad", "fill", "sponsored"], "exactly the old no-tracking contract");
  assert.equal(s.text.includes("bt1."), false);
  assert.equal(s.text.includes("bc1."), false);
  assert.equal(s.text.includes("click_ref"), false);
};
const oneServeOneCharge = (campaignId: string) => {
  assert.equal(db.serveLog.length, 1, "no second serve");
  assert.equal(db.rpcCount("record_ad_serve"), 1);
  assert.equal(db.spendOf(campaignId), db.unitCostUsd, "charged once");
};

describe("day 18 part 1 | retry BEFORE the original expiry: identical ad and credentials", () => {
  it("same ad, identical token, click_ref and expires_at, even one millisecond before exp; one serve, one charge", async () => {
    const { ad } = world();
    const first = await send();
    assert.equal(first.status, 200);
    assert.ok(first.body.tracking?.token && first.body.tracking?.click_ref);
    assert.equal(first.body.tracking!.expires_at, new Date(EXP).toISOString());

    for (const t of [SERVED_AT + 60_000, EXP - 60_000, EXP - 1]) {
      at(t);
      const retry = await send();
      assert.deepEqual(retry.body, first.body, `t=exp${t - EXP}`);
      assert.equal(retry.body.ad!.id, ad.creativeId);
      assert.equal(retry.body.tracking!.expires_at, first.body.tracking!.expires_at, "expiry never extends on retry");
    }
    oneServeOneCharge(ad.campaignId);
    assert.equal(db.rpcCount("load_ad_candidates"), 1, "retries skip selection");
  });
});

describe("day 18 part 1 | retry AT or AFTER the original expiry: same ad, NO credentials", () => {
  it("exactly at exp, 1 ms after, and hours later: original ad replayed, no token, no click_ref, no new serve or charge", async () => {
    const { ad } = world();
    const first = await send();
    for (const t of [EXP, EXP + 1, EXP + HOUR, SERVED_AT + 47 * HOUR]) {
      at(t);
      const retry = await send();
      noCredentials(retry);
      assert.deepEqual(retry.body.ad, first.body.ad, `same ad at exp+${t - EXP}ms`);
      assert.equal(retry.body.ad!.id, ad.creativeId);
    }
    oneServeOneCharge(ad.campaignId);
  });

  it("the credentials from the first response verify just before exp and are refused from exp on (token and click_ref agree)", async () => {
    world();
    const first = await send();
    const token = first.body.tracking!.token as string;
    const ref = first.body.tracking!.click_ref as string;
    assert.ok(verifyTrackingToken(token, "click", cfg(), EXP - 1).ok);
    assert.ok(verifyClickRef(ref, cfg(), EXP - 1).ok);
    assert.deepEqual(verifyClickRef(ref, cfg(), EXP), { ok: false, reason: "expired" });
    const t = verifyTrackingToken(token, "click", cfg(), EXP);
    assert.deepEqual(t, { ok: false, reason: "expired" });
  });

  it("sub-second serve time: exp is based on the whole serve second, boundary is exact", async () => {
    const { ad } = world();
    db.serveTimeMs = SERVED_AT + 999; // 10:00:30.999
    const first = await send();
    assert.equal(first.body.tracking!.expires_at, new Date(EXP).toISOString());
    at(EXP - 1);
    assert.deepEqual((await send()).body, first.body);
    at(EXP);
    noCredentials(await send());
    oneServeOneCharge(ad.campaignId);
  });

  it("custom TTL from the existing env moves the boundary (600 s); retries follow it exactly", async () => {
    process.env.AD_TRACKING_TTL_SECONDS = "600";
    const { ad } = world();
    const first = await send();
    const exp = SERVED_AT + 600_000;
    assert.equal(first.body.tracking!.expires_at, new Date(exp).toISOString());
    at(exp - 1);
    assert.deepEqual((await send()).body, first.body);
    at(exp);
    noCredentials(await send());
    oneServeOneCharge(ad.campaignId);
  });

  it("a rotated secret does not re-issue credentials for an expired serve either", async () => {
    const { ad } = world();
    await send();
    process.env.AD_TRACKING_SECRET = "m4q9-0123456789-abcdefghijklmnopqrstuvwxyz-rotated";
    process.env.AD_TRACKING_SECRET_PREVIOUS = SECRET;
    at(EXP);
    noCredentials(await send());
    oneServeOneCharge(ad.campaignId);
  });

  it("concurrent retries after expiry: one serve, no credentials in any response", async () => {
    const { ad } = world();
    await send();
    at(EXP + 10);
    const all = await Promise.all(Array.from({ length: 5 }, () => send()));
    all.forEach(noCredentials);
    oneServeOneCharge(ad.campaignId);
  });

  it("legacy route behaves the same after expiry", async () => {
    const { ad } = world();
    await send({ post: legacyRoute.POST });
    at(EXP);
    noCredentials(await send({ post: legacyRoute.POST }));
    oneServeOneCharge(ad.campaignId);
  });
});

describe("day 18 part 1 | other behaviour is preserved", () => {
  it("handler-level call (injected guard) gives the same result as the route", async () => {
    const { ad } = world();
    const call = async () => {
      const res = await handleMatchPost(
        new Request("https://example.test/api/v1/ads/match", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${KEY_A}`, "idempotency-key": IDEM, ...TRACK },
          body: JSON.stringify({ topic: "gaming" }),
        }),
        { ipGuard: createIpGuard() },
      );
      return JSON.parse(await res.text()) as Record<string, unknown>;
    };
    const first = await call();
    at(EXP);
    const retry = await call();
    assert.equal("tracking" in retry, false);
    assert.deepEqual(retry.ad, first.ad);
    oneServeOneCharge(ad.campaignId);
  });

  it("no opt-in: before and after expiry the response is the plain ad with no tracking", async () => {
    const { ad } = world();
    noCredentials(await send({ track: false }));
    at(EXP + 1);
    noCredentials(await send({ track: false }));
    oneServeOneCharge(ad.campaignId);
  });

  it("an expired retry never revives a creative that is no longer eligible (no-fill), and never serves a different ad", async () => {
    const { adv, ad } = world();
    await send();
    db.addAd(adv.id, { category: "gaming", headline: "Another ad" });
    db.setCreativeStatus(ad.creativeId, "paused");
    at(EXP + 1);
    const retry = await send();
    assert.equal(retry.status, 200);
    assert.deepEqual(retry.body, { fill: false });
    assert.equal(db.serveLog.length, 1);
    assert.equal(db.rpcCount("record_ad_serve"), 1);
  });

  it("publisher ownership: another publisher using the same key string gets its own serve, never the first publisher's ad or credentials", async () => {
    const { ad } = world();
    const pubB = db.addPublisher("active");
    db.addKey(pubB.id, KEY_B);
    const a = await send();
    at(EXP + 1);
    const retryA = await send();
    noCredentials(retryA);
    const b = await send({ key: KEY_B }); // naya serve, EXP ke baad ka samay: serve ka samay "abhi"
    assert.equal(db.serveLog.length, 2);
    assert.equal(db.serveLog[1].publisherId, pubB.id);
    assert.notEqual(b.body.tracking?.click_ref, a.body.tracking?.click_ref);
    assert.equal(db.spendOf(ad.campaignId), db.unitCostUsd * 2);
  });

  it("a brand-new serve whose recorded time is already past its TTL gets no credentials (never issued at or after exp)", async () => {
    const { ad } = world();
    db.serveTimeMs = clock.now - TTL_MS - 1_000; // serve ka samay purana
    const s = await send({ idem: null });
    noCredentials(s);
    assert.equal(db.serveLog.length, 1);
    assert.equal(db.spendOf(ad.campaignId), db.unitCostUsd);
  });

  it("missing tracking secret: ad still replays with no credentials before and after expiry", async () => {
    const { ad } = world();
    delete process.env.AD_TRACKING_SECRET;
    noCredentials(await send());
    at(EXP + 1);
    noCredentials(await send());
    oneServeOneCharge(ad.campaignId);
  });
});
