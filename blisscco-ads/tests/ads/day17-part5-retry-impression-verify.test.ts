import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleClickGet } from "@/lib/ads/click-handler";
import { handleImpressionPost } from "@/lib/ads/impression-handler";
import { createIpGuard } from "@/lib/ads/ip-guard";
import { handleMatchPost } from "@/lib/ads/match-handler";
import { SERVE_REF_RE } from "@/lib/ads/tracking-token";
import { FakeAdDb, makeKey, type ServeLogRow } from "./fake-ad-db";

// Day 17 Part 5: Task 3 ka focused verification. MOCKED test: FakeAdDb + chhota event-store MODEL (day-12-7 / day-12-10 SQL ka model).
// Koi asli database, SQL, network ya credential nahi. Ye DATABASE INTEGRATION TEST NAHI hai.
//   (a) impression ab bhi ORIGINAL bt1 token se hota hai (click_ref se nahi); click_ref ke aane se impression ka contract nahi badla.
//   (b) Idempotency-Key retry: ek serve, ek charge, wahi click_ref; retry ke refs se kitne bhi click karo, ek hi click.
const SECRET = "k7f2-0123456789-abcdefghijklmnopqrstuvwxyz-primary";
const SERVED_AT = Date.UTC(2026, 9, 27, 10, 0, 30);
const NOW = SERVED_AT + 5_000;
const KEY = makeKey("a");
const IDEM = "0b7e3c1a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
const realNow = Date.now;
const realError = console.error;
const saved = process.env.AD_TRACKING_SECRET;
type Reply = { data: unknown; error: null };
let db: FakeAdDb;
const impressions = new Set<string>();
const clicks = new Set<string>();
const eventCalls: string[] = [];

type Internals = { creatives: Map<string, { status: string; destinationUrl: string }> };
function rpc(name: string, a: Record<string, unknown>): Reply {
  eventCalls.push(name);
  const ok = (data: unknown): Reply => ({ data, error: null });
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
      if (!s || dest === null) return ok({ outcome: "rejected" });
      if (!impressions.has(s.serveRef)) return ok({ outcome: "not_counted", destination_url: dest });
      if (clicks.has(s.serveRef)) return ok({ outcome: "duplicate", destination_url: dest });
      clicks.add(s.serveRef);
      return ok({ outcome: "recorded", destination_url: dest });
    default:
      throw new Error(`test: unexpected rpc ${name}`);
  }
}
const EVENT_RPCS = ["lookup_serve_for_event", "record_ad_impression", "lookup_serve_for_click", "record_ad_click"];

beforeEach(() => {
  process.env.AD_TRACKING_SECRET = SECRET;
  Date.now = () => NOW;
  console.error = () => {};
  impressions.clear();
  clicks.clear();
  eventCalls.length = 0;
  db = new FakeAdDb();
  db.serveTimeMs = SERVED_AT;
  const pub = db.addPublisher("active");
  db.addKey(pub.id, KEY);
  db.addAd(db.addAdvertiser("active").id, { category: "gaming" });
  globals.__TEST_SUPABASE__ = { rpc: async (n: string, a: Record<string, unknown> = {}) => (EVENT_RPCS.includes(n) ? rpc(n, a) : db.client().rpc(n, a)) };
});
afterEach(() => {
  Date.now = realNow;
  console.error = realError;
  if (saved === undefined) delete process.env.AD_TRACKING_SECRET;
  else process.env.AD_TRACKING_SECRET = saved;
  delete globals.__TEST_SUPABASE__;
});

type Tracking = { token: string; click_ref: string; events: string[] };
async function match(idem?: string): Promise<{ tracking: Tracking; text: string }> {
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
  return { tracking: (JSON.parse(text) as { tracking: Tracking }).tracking, text };
}
const impression = async (token: string) =>
  handleImpressionPost(new Request("https://blisscco.test/api/v1/ads/impression", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, event: "impression" }) }), {
    requestGuard: createIpGuard(300),
    failureGuard: createIpGuard(30),
  });
const click = (ref: string) =>
  handleClickGet(new Request(`https://blisscco.test/api/v1/ads/click?ref=${encodeURIComponent(ref)}`), { requestGuard: createIpGuard(300), failureGuard: createIpGuard(30) });

describe("day 17 part 5 | impression still uses the ORIGINAL bt1 token", () => {
  it("the response token records the impression (then duplicate); the click_ref is NOT accepted by the impression endpoint", async () => {
    const { tracking } = await match();
    assert.match(tracking.token, /^bt1\./);
    assert.match(tracking.click_ref, /^bc1\./);
    assert.deepEqual(tracking.events, ["impression", "click"]);

    const spendBefore = JSON.stringify([...db.spend.entries()]);
    const bad = await impression(tracking.click_ref);
    assert.equal(bad.status, 401);
    assert.equal(impressions.size, 0);
    assert.equal(eventCalls.includes("record_ad_impression"), false);

    const first = await impression(tracking.token);
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { ok: true, status: "recorded" });
    const again = await impression(tracking.token);
    assert.deepEqual(await again.json(), { ok: true, status: "duplicate" });
    assert.equal(impressions.size, 1);
    assert.equal(JSON.stringify([...db.spend.entries()]), spendBefore, "impression never changes spend");
    assert.equal(db.rpcCount("record_ad_serve"), 1);
  });

  it("the bt1 token is not accepted by the click endpoint", async () => {
    const { tracking } = await match();
    assert.equal((await impression(tracking.token)).status, 200);
    const res = await click(tracking.token);
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("location"), null);
    assert.equal(clicks.size, 0);
  });
});

describe("day 17 part 5 | idempotent retries create no extra serve and no extra click", () => {
  it("same Idempotency-Key x3: one serve, one charge, identical token + click_ref; clicking every copy gives ONE click", async () => {
    const a = await match(IDEM);
    const b = await match(IDEM);
    const c = await match(IDEM);
    assert.deepEqual(b.tracking, a.tracking);
    assert.deepEqual(c.tracking, a.tracking);
    assert.equal(db.serveLog.length, 1);
    assert.equal(db.rpcCount("record_ad_serve"), 1);
    const spend = JSON.stringify([...db.spend.entries()]);

    assert.equal((await impression(a.tracking.token)).status, 200);
    assert.equal((await impression(b.tracking.token)).status, 200);
    assert.equal(impressions.size, 1);
    for (const t of [a, b, c, a, b]) assert.equal((await click(t.tracking.click_ref)).status, 302);
    assert.equal(clicks.size, 1);
    assert.equal(db.serveLog.length, 1);
    assert.equal(JSON.stringify([...db.spend.entries()]), spend, "retries and clicks never charge again");
  });

  it("a different key is a different serve with its own click_ref (and its own single click)", async () => {
    const a = await match(IDEM);
    const b = await match("a-different-retry-key-0002");
    assert.notEqual(a.tracking.click_ref, b.tracking.click_ref);
    assert.equal(db.serveLog.length, 2);
    for (const t of [a, b]) {
      await impression(t.tracking.token);
      await click(t.tracking.click_ref);
      await click(t.tracking.click_ref);
    }
    assert.equal(clicks.size, 2);
  });
});
