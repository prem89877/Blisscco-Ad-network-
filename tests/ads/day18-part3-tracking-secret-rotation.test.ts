import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { verifyClickRef } from "@/lib/ads/click-ref";
import { handleClickGet } from "@/lib/ads/click-handler";
import { handleImpressionPost } from "@/lib/ads/impression-handler";
import { createIpGuard } from "@/lib/ads/ip-guard";
import { handleMatchPost } from "@/lib/ads/match-handler";
import { SERVE_REF_RE, readTrackingConfig, verifyTrackingToken } from "@/lib/ads/tracking-token";
import { FakeAdDb, makeKey, type ServeLogRow } from "./fake-ad-db";

// Day 18 Part 3: AD_TRACKING_SECRET / AD_TRACKING_SECRET_PREVIOUS rotation, bt1 token (impression) aur bc1 click_ref (click) DONO ke liye.
// MOCKED: FakeAdDb + chhota event-store MODEL (day-12-7 / day-12-10 SQL ka model). Koi SQL / asli database / network nahi. Ye DATABASE INTEGRATION TEST NAHI hai.
// Clock FIXED (Date.now stub). Secrets sirf test ke (asli nahi); koi naya env variable nahi (neeche static check).

const S1 = "k7f2-0123456789-abcdefghijklmnopqrstuvwxyz-primary";
const S2 = "m4q9-0123456789-abcdefghijklmnopqrstuvwxyz-rotated";
const S3 = "p8w3-0123456789-abcdefghijklmnopqrstuvwxyz-third00";
const SERVED_AT = Date.UTC(2026, 9, 27, 10, 0, 30);
const TTL_MS = 3_600_000;
const EXP = SERVED_AT + TTL_MS;
const KEY = makeKey("a");
const IDEM = "0b7e3c1a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const ROOT = path.join(__dirname, "..", "..", "..");
const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
const realNow = Date.now;
const realError = console.error;
const ENV_NAMES = ["AD_TRACKING_SECRET", "AD_TRACKING_SECRET_PREVIOUS", "AD_TRACKING_TTL_SECONDS"] as const;
let savedEnv: Record<string, string | undefined> = {};
const clock = { now: SERVED_AT + 5_000 };
let db: FakeAdDb;
let logged: string[] = [];
const impressions = new Set<string>();
const clicks = new Set<string>();
let eventCalls: string[] = [];

type Internals = { creatives: Map<string, { destinationUrl: string }> };
const EVENT_RPCS = ["lookup_serve_for_event", "record_ad_impression", "lookup_serve_for_click", "record_ad_click"];
function rpc(name: string, a: Record<string, unknown>) {
  eventCalls.push(name);
  const ok = (data: unknown) => ({ data, error: null });
  const s: ServeLogRow | undefined = typeof a.p_serve_ref === "string" && SERVE_REF_RE.test(a.p_serve_ref) ? db.serveLog.find((x) => x.serveRef === a.p_serve_ref) : undefined;
  const dest = s ? (db as unknown as Internals).creatives.get(s.creativeId)?.destinationUrl ?? null : null;
  switch (name) {
    case "lookup_serve_for_event":
      return ok(s ? { outcome: "found", publisher_id: s.publisherId, served_at: new Date(s.servedAtMs).toISOString() } : { outcome: "not_found" });
    case "record_ad_impression":
      if (!s || s.publisherId !== a.p_publisher_id) return ok({ outcome: "rejected" });
      if (impressions.has(s.serveRef)) return ok({ outcome: "duplicate" });
      impressions.add(s.serveRef);
      return ok({ outcome: "recorded" });
    case "lookup_serve_for_click":
      return ok(s ? { outcome: "found", publisher_id: s.publisherId, creative_id: s.creativeId, served_at: new Date(s.servedAtMs).toISOString(), destination_url: dest, eligible: dest !== null } : { outcome: "not_found" });
    case "record_ad_click":
      if (!s || dest === null || s.publisherId !== a.p_publisher_id || s.creativeId !== a.p_creative_id) return ok({ outcome: "rejected" });
      if (!impressions.has(s.serveRef)) return ok({ outcome: "not_counted", destination_url: dest });
      if (clicks.has(s.serveRef)) return ok({ outcome: "duplicate", destination_url: dest });
      clicks.add(s.serveRef);
      return ok({ outcome: "recorded", destination_url: dest });
    default:
      throw new Error(`test: unexpected rpc ${name}`);
  }
}

function useSecrets(current: string | undefined, previous?: string): void {
  if (current === undefined) delete process.env.AD_TRACKING_SECRET;
  else process.env.AD_TRACKING_SECRET = current;
  if (previous === undefined) delete process.env.AD_TRACKING_SECRET_PREVIOUS;
  else process.env.AD_TRACKING_SECRET_PREVIOUS = previous;
}

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_NAMES.map((n) => [n, process.env[n]]));
  useSecrets(S1);
  delete process.env.AD_TRACKING_TTL_SECONDS;
  clock.now = SERVED_AT + 5_000;
  Date.now = () => clock.now;
  logged = [];
  console.error = (...a: unknown[]) => {
    logged.push(a.map(String).join(" "));
  };
  impressions.clear();
  clicks.clear();
  eventCalls = [];
  db = new FakeAdDb();
  db.serveTimeMs = SERVED_AT;
  const pub = db.addPublisher("active");
  db.addKey(pub.id, KEY);
  const adv = db.addAdvertiser("active");
  db.addAd(adv.id, { category: "gaming" });
  db.addAd(adv.id, { category: "gaming" });
  globals.__TEST_SUPABASE__ = { rpc: async (n: string, a: Record<string, unknown> = {}) => (EVENT_RPCS.includes(n) ? rpc(n, a) : db.client().rpc(n, a)) };
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

// ----- helpers -------------------------------------------------------------------------------------------------------------
type Tracking = { token: string; click_ref: string; expires_at: string; events: string[] };
type Served = { tracking: Tracking; text: string; adId: string; serve: ServeLogRow };
async function match(idem: string | null = null): Promise<Served> {
  const res = await handleMatchPost(
    new Request("https://blisscco.test/api/v1/ads/match", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, "x-blisscco-tracking": "1", ...(idem ? { "idempotency-key": idem } : {}) },
      body: JSON.stringify({ topic: "gaming" }),
    }),
    { ipGuard: createIpGuard() },
  );
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as { ad: { id: string }; tracking: Tracking };
  return { tracking: body.tracking, text, adId: body.ad.id, serve: db.serveLog[db.serveLog.length - 1] };
}
const impression = async (token: string) => {
  const res = await handleImpressionPost(
    new Request("https://blisscco.test/api/v1/ads/impression", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, event: "impression" }) }),
    { requestGuard: createIpGuard(300), failureGuard: createIpGuard(30) },
  );
  return { status: res.status, text: await res.text() };
};
const click = async (ref: string) => {
  const res = await handleClickGet(new Request(`https://blisscco.test/api/v1/ads/click?ref=${encodeURIComponent(ref)}`), { requestGuard: createIpGuard(300), failureGuard: createIpGuard(30) });
  return { status: res.status, location: res.headers.get("location"), text: await res.text() };
};
const cfgOf = (current: string, previous?: string) => {
  const c = readTrackingConfig({ AD_TRACKING_SECRET: current, ...(previous ? { AD_TRACKING_SECRET_PREVIOUS: previous } : {}) });
  assert.ok(c);
  return c;
};
const secretIndexOf = (t: Tracking, cfg: ReturnType<typeof cfgOf>) => {
  const a = verifyTrackingToken(t.token, "impression", cfg, clock.now);
  const b = verifyClickRef(t.click_ref, cfg, clock.now);
  assert.ok(a.ok && b.ok);
  return [a.ok ? a.claims.secretIndex : -1, b.ok ? b.claims.secretIndex : -1];
};
const noWrites = () => {
  assert.equal(eventCalls.some((n) => n.startsWith("record_")), false, "no record rpc was reached");
};

describe("day 18 part 3 | after rotation, credentials from the PREVIOUS secret still work", () => {
  it("token and click_ref signed with S1 are accepted after S2 becomes current and S1 is the previous secret", async () => {
    const old = await match(IDEM);
    assert.deepEqual(secretIndexOf(old.tracking, cfgOf(S1)), [0, 0]);

    useSecrets(S2, S1); // rotation
    assert.deepEqual(secretIndexOf(old.tracking, cfgOf(S2, S1)), [1, 1], "verified as the PREVIOUS secret");
    assert.equal(verifyTrackingToken(old.tracking.token, "impression", cfgOf(S2), clock.now).ok, false, "S2 alone would not accept it");

    const imp = await impression(old.tracking.token);
    assert.equal(imp.status, 200);
    assert.deepEqual(JSON.parse(imp.text), { ok: true, status: "recorded" });
    assert.equal(impressions.has(old.serve.serveRef), true);
    const c = await click(old.tracking.click_ref);
    assert.equal(c.status, 302);
    assert.equal(c.location, new URL("https://example.com/landing").href);
    assert.equal(clicks.has(old.serve.serveRef), true);
    assert.equal((await click(old.tracking.click_ref)).status, 302, "duplicate still redirects");
    assert.equal(clicks.size, 1);
    assert.equal(db.serveLog.length, 1);
  });

  it("previous-secret credentials keep their ORIGINAL expiry: valid 1 ms before exp, refused at exp", async () => {
    const old = await match();
    useSecrets(S2, S1);
    clock.now = EXP - 1;
    assert.equal((await impression(old.tracking.token)).status, 200);
    clock.now = EXP;
    assert.equal((await impression(old.tracking.token)).status, 401);
    assert.equal((await click(old.tracking.click_ref)).status, 404);
    assert.equal(clicks.size, 0);
  });
});

describe("day 18 part 3 | new serves after rotation use the CURRENT secret", () => {
  it("a new serve is signed with S2 (index 0), differs from S1-signed ones, and works with S2 alone", async () => {
    const old = await match();
    useSecrets(S2, S1);
    const fresh = await match();
    assert.notEqual(fresh.serve.serveRef, old.serve.serveRef);
    assert.deepEqual(secretIndexOf(fresh.tracking, cfgOf(S2, S1)), [0, 0]);
    assert.deepEqual(secretIndexOf(fresh.tracking, cfgOf(S2)), [0, 0], "S2 alone is enough");
    assert.equal(verifyTrackingToken(fresh.tracking.token, "impression", cfgOf(S1), clock.now).ok, false, "S1 can no longer vouch for new credentials");
    assert.equal(verifyClickRef(fresh.tracking.click_ref, cfgOf(S1), clock.now).ok, false);
    assert.equal((await impression(fresh.tracking.token)).status, 200);
    assert.equal((await click(fresh.tracking.click_ref)).status, 302);
    assert.equal(clicks.has(fresh.serve.serveRef), true);
  });

  it("an Idempotency-Key retry after rotation: same serve, same ad, same expiry, re-signed with S2; one serve, one impression, one click", async () => {
    const old = await match(IDEM);
    useSecrets(S2, S1);
    const retry = await match(IDEM);
    assert.equal(db.serveLog.length, 1, "no second serve");
    assert.equal(db.rpcCount("record_ad_serve"), 1);
    assert.equal(retry.adId, old.adId);
    assert.equal(retry.tracking.expires_at, old.tracking.expires_at, "original expiry");
    assert.equal(retry.tracking.expires_at, new Date(EXP).toISOString());
    assert.deepEqual(secretIndexOf(retry.tracking, cfgOf(S2)), [0, 0]);

    // dono tarah ke credentials ek hi ORIGINAL serve se bandhe hain
    const t0 = verifyTrackingToken(old.tracking.token, "impression", cfgOf(S2, S1), clock.now);
    const t1 = verifyTrackingToken(retry.tracking.token, "impression", cfgOf(S2, S1), clock.now);
    const c0 = verifyClickRef(old.tracking.click_ref, cfgOf(S2, S1), clock.now);
    const c1 = verifyClickRef(retry.tracking.click_ref, cfgOf(S2, S1), clock.now);
    assert.ok(t0.ok && t1.ok && c0.ok && c1.ok);
    if (!(t0.ok && t1.ok && c0.ok && c1.ok)) return;
    for (const claims of [t0.claims, t1.claims, c0.claims, c1.claims]) {
      assert.equal(claims.serveRef, old.serve.serveRef);
      assert.equal(claims.issuedAtMs, SERVED_AT);
      assert.equal(claims.expiresAtMs, EXP);
    }
    assert.equal(t0.claims.serveRef, c1.claims.serveRef, "bt1 and bc1 share the one serve");

    assert.equal((await impression(old.tracking.token)).status, 200);
    assert.deepEqual(JSON.parse((await impression(retry.tracking.token)).text), { ok: true, status: "duplicate" });
    assert.equal(impressions.size, 1);
    for (const ref of [old.tracking.click_ref, retry.tracking.click_ref, old.tracking.click_ref]) assert.equal((await click(ref)).status, 302);
    assert.equal(clicks.size, 1);
    assert.equal(db.spendOf(db.serveLog[0].campaignId), db.unitCostUsd, "charged once");
  });

  it("a retry after expiry still gets no credentials, even after rotation (rotation never revives tracking)", async () => {
    await match(IDEM);
    useSecrets(S2, S1);
    clock.now = EXP;
    const res = await handleMatchPost(
      new Request("https://blisscco.test/api/v1/ads/match", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, "x-blisscco-tracking": "1", "idempotency-key": IDEM },
        body: JSON.stringify({ topic: "gaming" }),
      }),
      { ipGuard: createIpGuard() },
    );
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(res.status, 200);
    assert.equal("tracking" in body, false);
    assert.equal(db.serveLog.length, 1);
  });
});

describe("day 18 part 3 | removing the previous secret rejects old references safely", () => {
  it("old token and click_ref: 401 / 404, no lookup, no impression, no click; new references keep working", async () => {
    const old = await match(); // S1 se
    useSecrets(S2, S1);
    const fresh = await match(); // S2 se
    useSecrets(S2); // purana secret hata diya
    eventCalls = [];

    const imp = await impression(old.tracking.token);
    assert.equal(imp.status, 401);
    assert.equal(imp.text.includes(old.tracking.token), false);
    const c = await click(old.tracking.click_ref);
    assert.equal(c.status, 404);
    assert.equal(c.location, null);
    assert.deepEqual(eventCalls, [], "signature fails before any database call");
    assert.equal(impressions.size, 0);
    assert.equal(clicks.size, 0);
    noWrites();
    // wahi generic body: kaaran nahi batata
    assert.equal(c.text, (await click("bc1.AAAA.BBBB")).text);

    assert.equal((await impression(fresh.tracking.token)).status, 200);
    assert.equal((await click(fresh.tracking.click_ref)).status, 302);
    assert.equal(impressions.has(fresh.serve.serveRef), true);
    assert.equal(clicks.has(fresh.serve.serveRef), true);
    assert.equal(impressions.has(old.serve.serveRef), false);
    assert.equal(clicks.has(old.serve.serveRef), false);
  });

  it("the old serve gets working credentials again through an in-lifetime Idempotency-Key retry (signed with the current secret)", async () => {
    const old = await match(IDEM);
    useSecrets(S2, S1);
    useSecrets(S2); // previous hata diya
    assert.equal((await impression(old.tracking.token)).status, 401);
    const retry = await match(IDEM);
    assert.equal(db.serveLog.length, 1);
    assert.equal((await impression(retry.tracking.token)).status, 200);
    assert.equal((await click(retry.tracking.click_ref)).status, 302);
    assert.equal(clicks.size, 1);
    assert.equal(impressions.size, 1);
  });

  it("only ONE previous generation is honoured: after S2 -> S3 (previous = S2), S1 credentials are rejected", async () => {
    const s1Served = await match();
    useSecrets(S2, S1);
    const s2Served = await match();
    useSecrets(S3, S2);
    eventCalls = [];
    assert.equal((await impression(s1Served.tracking.token)).status, 401);
    assert.equal((await click(s1Served.tracking.click_ref)).status, 404);
    assert.deepEqual(eventCalls, []);
    assert.equal((await impression(s2Served.tracking.token)).status, 200);
    assert.equal((await click(s2Served.tracking.click_ref)).status, 302);
    assert.equal(clicks.size, 1);
  });

  it("an unacceptable previous secret (weak / same as current) is ignored: old references are rejected, nothing is recorded", async () => {
    const old = await match();
    for (const previous of ["short", S2, undefined]) {
      useSecrets(S2, previous);
      eventCalls = [];
      assert.equal((await impression(old.tracking.token)).status, 401, String(previous).slice(0, 5));
      assert.equal((await click(old.tracking.click_ref)).status, 404);
      assert.deepEqual(eventCalls, []);
    }
    assert.equal(impressions.size, 0);
    assert.equal(clicks.size, 0);
  });

  it("a reference signed with a secret that was never configured is rejected like any other bad reference", async () => {
    const old = await match();
    useSecrets(S3, S2);
    assert.equal((await impression(old.tracking.token)).status, 401);
    assert.equal((await click(old.tracking.click_ref)).status, 404);
    assert.equal(impressions.size + clicks.size, 0);
  });

  it("no tracking secret configured at all (previous alone is not enough): old references are never accepted (503, nothing recorded)", async () => {
    const old = await match();
    useSecrets(undefined, S1);
    eventCalls = [];
    assert.equal((await impression(old.tracking.token)).status, 503);
    const c = await click(old.tracking.click_ref);
    assert.equal(c.status, 503);
    assert.equal(c.location, null);
    assert.deepEqual(eventCalls, []);
    assert.equal(impressions.size + clicks.size, 0);
  });
});

describe("day 18 part 3 | no secret leaks and no new environment variable", () => {
  it("no response, rejection body or log line contains a secret or a credential", async () => {
    const old = await match(IDEM);
    useSecrets(S2, S1);
    const fresh = await match();
    useSecrets(S2);
    const seen = [
      old.text,
      fresh.text,
      (await impression(old.tracking.token)).text,
      (await click(old.tracking.click_ref)).text,
      (await impression(fresh.tracking.token)).text,
      (await click(fresh.tracking.click_ref)).text,
      ...logged,
    ].join("\n");
    for (const s of [S1, S2, S3]) {
      assert.equal(seen.includes(s), false, "secret leaked");
      assert.equal(seen.includes(s.slice(0, 12)), false);
    }
    assert.equal(seen.includes("AD_TRACKING_SECRET"), false);
    assert.equal(logged.some((l) => l.includes(old.tracking.token) || l.includes(old.tracking.click_ref) || l.includes(fresh.serve.serveRef)), false);
  });

  it("rotation uses only the three existing variables (static check of app/ and lib/)", () => {
    const walk = (dir: string): string[] =>
      readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${dir}/${e.name}`] : []));
    const names = new Set<string>();
    for (const f of [...walk("app"), ...walk("lib")]) {
      for (const m of readFileSync(path.join(ROOT, f), "utf8").matchAll(/\bAD_TRACKING_[A-Z_]+\b/g)) names.add(m[0]);
    }
    assert.deepEqual([...names].sort(), ["AD_TRACKING_SECRET", "AD_TRACKING_SECRET_PREVIOUS", "AD_TRACKING_TTL_SECONDS"]);
    assert.equal(/NEXT_PUBLIC_AD_TRACKING/.test(walk("app").concat(walk("lib")).map((f) => readFileSync(path.join(ROOT, f), "utf8")).join("\n")), false);
  });
});
