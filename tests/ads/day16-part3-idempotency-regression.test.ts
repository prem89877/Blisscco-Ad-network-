import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleMatchPost } from "@/lib/ads/match-handler";
import { createIpGuard } from "@/lib/ads/ip-guard";
import { loadAdCandidates } from "@/lib/ads/candidate-loader";
import { selectAd } from "@/lib/ads/selection";
import { serveAd, type ServeDeps } from "@/lib/ads/serve";
import { authorizePublisher, findIdempotentServe, recordServe } from "@/lib/ads/serve-db";
import { parseIdempotencyKey } from "@/lib/ads/validation";
import { FakeAdDb, makeKey, sha256 } from "./fake-ad-db";

// Day 16 Part 3: publisher ad-serving idempotency ka regression coverage.
// Database NAKLI par STATEFUL hai (tests/ads/fake-ad-db.ts, SQL day-9-5 ka model). Asli Supabase / production kabhi nahi.
// Koi naya Idempotency-Key semantic nahi: sirf wahi jo lib/ads/serve.ts, serve-db.ts, match-handler.ts aur validation.ts me hai:
//   - replay lookup (find_idempotent_serve) selection se PEHLE hota hai, (publisher, key) par bandha hai
//   - replay topic / exclude_ad_ids dekhne se pehle hota hai => badla hua request data bhi pehle charge hue ad ko hi replay karta hai
//   - lookup / record ka kharab ya nakaam jawab => 503 (kabhi bina-record ya galat ad nahi)
// Ye sandbox me CHALAYA NAHI gaya (node_modules / @types/node nahi). Pehli baar `npm test` se khud chalao.

const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
const realError = console.error;
let logged: unknown[][] = [];
let db: FakeAdDb;

const KEY_A = makeKey("a");
const KEY_B = makeKey("b");
const IDEM = "retry-key-0001";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Sent = { status: number; body: Record<string, unknown>; text: string };

async function send(
  body: unknown,
  opts: { key?: string; idem?: string | null; headers?: Record<string, string> } = {},
): Promise<Sent> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${opts.key ?? KEY_A}`,
    ...(opts.idem === null ? {} : { "idempotency-key": opts.idem ?? IDEM }),
    ...(opts.headers ?? {}),
  };
  const res = await handleMatchPost(
    new Request("https://example.test/api/v1/ads/match", { method: "POST", headers, body: JSON.stringify(body) }),
    { ipGuard: createIpGuard() },
  );
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text) as Record<string, unknown>, text };
}

const adOf = (s: Sent) => s.body.ad as Record<string, unknown>;
const adId = (s: Sent) => String(adOf(s).id);
const totalSpend = () => Math.round([...new Set(db.serveLog.map((s) => s.campaignId))].reduce((n, c) => n + db.spendOf(c), 0) * 1e6) / 1e6;
const names = () => db.calls.map((c) => c.name);

beforeEach(() => {
  logged = [];
  console.error = (...a: unknown[]) => {
    logged.push(a);
  };
  db = new FakeAdDb();
  globals.__TEST_SUPABASE__ = db.client();
});
afterEach(() => {
  console.error = realError;
});

/** Ek active publisher (KEY_A), do gaming ads (alag campaigns). */
function world() {
  const pub = db.addPublisher("active");
  db.addKey(pub.id, KEY_A);
  const adv = db.addAdvertiser("active");
  const ad1 = db.addAd(adv.id, { category: "gaming", headline: "Ad one" });
  const ad2 = db.addAd(adv.id, { category: "gaming", headline: "Ad two" });
  return { pub, adv, ad1, ad2 };
}

function twoPublishers() {
  const a = db.addPublisher("active");
  db.addKey(a.id, KEY_A);
  const b = db.addPublisher("active");
  db.addKey(b.id, KEY_B);
  const adv = db.addAdvertiser("active");
  db.addAd(adv.id, { category: "gaming", headline: "Ad one" });
  db.addAd(adv.id, { category: "gaming", headline: "Ad two" });
  return { a, b };
}

describe("day 16 part 3 | same key + same publisher: replay, no second serve, no second charge", () => {
  it("retry returns the exact same ad body, creates no serve, charges once, and skips selection and record", async () => {
    const { pub } = world();
    const first = await send({ topic: "gaming" });
    assert.equal(first.status, 200);
    const callsAfterFirst = db.calls.length;
    assert.deepEqual(names(), ["authorize_publisher_key", "find_idempotent_serve", "load_ad_candidates", "record_ad_serve"]);

    const second = await send({ topic: "gaming" });
    const third = await send({ topic: "gaming" });
    assert.deepEqual(second.body, first.body);
    assert.deepEqual(third.body, first.body);
    // retry sirf authorize + replay lookup karta hai: na candidates load, na record
    assert.deepEqual(db.calls.slice(callsAfterFirst).map((c) => c.name), [
      "authorize_publisher_key", "find_idempotent_serve", "authorize_publisher_key", "find_idempotent_serve",
    ]);
    assert.equal(db.rpcCount("record_ad_serve"), 1);
    assert.equal(db.servesFor(pub.id).length, 1);
    assert.equal(totalSpend(), db.unitCostUsd);
  });

  it("a retry is still attributed to the original serve (same serve_ref reaches the tracking issuer, no new serve)", async () => {
    const { pub } = world();
    const seen: { publisherId: string; serveRef: string; servedAtMs: number; creativeId: string }[] = [];
    const deps: ServeDeps = {
      authorize: authorizePublisher,
      select: (request, unitCostUsd) =>
        selectAd(request, { loadCandidates: loadAdCandidates, now: () => new Date(db.nowMs), unitCostUsd, spendTracking: "reliable" }),
      record: recordServe,
      lookupReplay: findIdempotentServe,
      issueTracking: (input) => {
        seen.push(input);
        return null;
      },
    };
    const hash = sha256(KEY_A);
    const req = { topic: "gaming", excludeAdIds: [], idempotencyKey: IDEM, trackingRequested: true };
    const r1 = await serveAd(hash, req, deps);
    const r2 = await serveAd(hash, req, deps);
    assert.equal(r1.kind, "ad");
    assert.deepEqual(r2, r1);
    assert.equal(seen.length, 2);
    assert.equal(seen[0].serveRef, db.servesFor(pub.id)[0].serveRef);
    assert.deepEqual(seen[1], seen[0]);
    assert.equal(seen[0].publisherId, pub.id);
    assert.equal(db.servesFor(pub.id).length, 1);
  });

  it("the replay wins over a newly added ad and over a used-up budget (no re-selection, no re-charge)", async () => {
    const pub = db.addPublisher("active");
    db.addKey(pub.id, KEY_A);
    const first = db.addAd(db.addAdvertiser().id, { totalBudget: db.unitCostUsd, headline: "Only one" }); // exactly one serve
    const r1 = await send({ topic: "gaming" });
    assert.equal(adId(r1), first.creativeId);
    db.addAd(db.addAdvertiser().id, { headline: "Newcomer" });
    const r2 = await send({ topic: "gaming" });
    assert.equal(adId(r2), first.creativeId);
    assert.equal(db.servesFor(pub.id).length, 1);
    assert.equal(db.spendOf(first.campaignId), db.unitCostUsd);
  });

  it("concurrent requests with one key: one serve, one charge, every response is the same ad", async () => {
    const { pub } = world();
    const all = await Promise.all(Array.from({ length: 8 }, () => send({ topic: "gaming" })));
    assert.deepEqual(new Set(all.map((r) => r.status)), new Set([200]));
    assert.equal(new Set(all.map(adId)).size, 1);
    assert.equal(db.servesFor(pub.id).length, 1);
    assert.equal(totalSpend(), db.unitCostUsd);
  });

  it("Idempotency-Key header is trimmed by validation, so a padded header is the same key", () => {
    assert.deepEqual(parseIdempotencyKey(`  ${IDEM}  `), { ok: true, value: IDEM });
    assert.deepEqual(parseIdempotencyKey(null), { ok: true, value: undefined });
    assert.deepEqual(parseIdempotencyKey("short"), { ok: false });
  });
});

describe("day 16 part 3 | independence: different keys, different publishers, changed request data", () => {
  it("different keys are separate serves and separate charges; each key replays its own ad", async () => {
    const { pub } = world();
    const a1 = await send({ topic: "gaming" }, { idem: "key-aaaa-0001" });
    const b1 = await send({ topic: "gaming" }, { idem: "key-bbbb-0002" });
    const none = await send({ topic: "gaming" }, { idem: null });
    assert.equal(db.servesFor(pub.id).length, 3);
    assert.equal(totalSpend(), Math.round(3 * db.unitCostUsd * 1e6) / 1e6);

    assert.deepEqual((await send({ topic: "gaming" }, { idem: "key-aaaa-0001" })).body, a1.body);
    assert.deepEqual((await send({ topic: "gaming" }, { idem: "key-bbbb-0002" })).body, b1.body);
    assert.equal(db.servesFor(pub.id).length, 3, "replays add no serve");
    assert.equal(none.status, 200);
    // key ke bina request kabhi replay nahi hoti: dobara bhejne par naya serve
    await send({ topic: "gaming" }, { idem: null });
    assert.equal(db.servesFor(pub.id).length, 4);
  });

  it("concurrent requests with different keys are all charged separately", async () => {
    const { pub } = world();
    const all = await Promise.all(Array.from({ length: 6 }, (_, i) => send({ topic: "gaming" }, { idem: `parallel-key-${i}` })));
    assert.deepEqual(new Set(all.map((r) => r.status)), new Set([200]));
    assert.equal(db.servesFor(pub.id).length, 6);
    assert.equal(totalSpend(), Math.round(6 * db.unitCostUsd * 1e6) / 1e6);
  });

  it("another publisher cannot reuse this publisher's key record: B gets its own fresh serve, A's replay is untouched", async () => {
    const { a, b } = twoPublishers();
    const a1 = await send({ topic: "gaming" }, { key: KEY_A });
    const spendAfterA = totalSpend();
    const b1 = await send({ topic: "gaming" }, { key: KEY_B });
    assert.equal(b1.status, 200);
    assert.equal(db.servesFor(a.id).length, 1);
    assert.equal(db.servesFor(b.id).length, 1, "B was charged on its own");
    assert.ok(totalSpend() > spendAfterA);
    assert.equal(db.servesFor(b.id)[0].serveRef === db.servesFor(a.id)[0].serveRef, false);

    // beech-beech me dono ke retry: har ek ko apna hi ad / apni hi serve
    assert.deepEqual((await send({ topic: "gaming" }, { key: KEY_A })).body, a1.body);
    assert.deepEqual((await send({ topic: "gaming" }, { key: KEY_B })).body, b1.body);
    assert.deepEqual((await send({ topic: "gaming" }, { key: KEY_A })).body, a1.body);
    assert.equal(db.servesFor(a.id).length, 1);
    assert.equal(db.servesFor(b.id).length, 1);
    for (const s of db.serveLog) assert.ok([a.id, b.id].includes(s.publisherId));
  });

  it("the lookup is made for the caller's own key hash only (never another publisher's hash)", async () => {
    twoPublishers();
    await send({ topic: "gaming" }, { key: KEY_B });
    const lookups = db.calls.filter((c) => c.name === "find_idempotent_serve");
    assert.equal(lookups.length, 1);
    assert.equal(lookups[0].args.p_key_hash, sha256(KEY_B));
    assert.equal(JSON.stringify(db.calls).includes(KEY_B), false, "raw key never reaches the database");
  });

  it("changed topic / fallback / exclude list with the same key still replays the originally charged ad (actual contract: lookup runs first)", async () => {
    const { pub, ad1, ad2 } = world();
    db.addAd(db.addAdvertiser().id, { category: "travel", headline: "Travel ad" });
    const first = await send({ topic: "gaming" });
    const original = adId(first);
    assert.ok([ad1.creativeId, ad2.creativeId].includes(original));

    const changed: unknown[] = [
      { topic: "travel" },
      { topic: "gaming", exclude_ad_ids: [original] },
      { topic: "travel", fallback_topics: ["gaming"], exclude_ad_ids: [original] },
    ];
    for (const body of changed) {
      const r = await send(body);
      assert.equal(r.status, 200, JSON.stringify(body));
      assert.equal(adId(r), original, JSON.stringify(body));
    }
    assert.equal(db.servesFor(pub.id).length, 1);
    assert.equal(db.rpcCount("record_ad_serve"), 1);
    assert.equal(totalSpend(), db.unitCostUsd);
  });

  it("a replay whose creative is no longer eligible is a no-fill: no other ad is served in its place, nothing charged", async () => {
    const { pub, ad1, ad2 } = world();
    const first = await send({ topic: "gaming" });
    const original = adId(first);
    db.setCreativeStatus(original, "paused");
    const spendBefore = totalSpend();
    const r = await send({ topic: "gaming" });
    assert.deepEqual(r.body, { fill: false });
    assert.equal(r.status, 200);
    assert.equal(db.servesFor(pub.id).length, 1);
    assert.equal(totalSpend(), spendBefore);
    assert.ok([ad1.creativeId, ad2.creativeId].includes(original));
  });
});

describe("day 16 part 3 | failures are safe: no unrecorded or wrongly attributed ad", () => {
  const UNAVAILABLE = { fill: false, error: "unavailable" };
  const GOOD_AD = { id: "00000000-0000-4000-8000-0000000000aa", headline: "H", body: "B", cta_text: null, destination_url: "https://example.com/x" };

  function assertNothingServed(extra?: () => void) {
    assert.equal(db.serveLog.length, 0, "no serve recorded");
    assert.equal(totalSpend(), 0, "nothing charged");
    extra?.();
  }

  it("replay lookup error => 503, never guesses: no candidates, no record, no charge, no internal detail leaked", async () => {
    world();
    db.failRpc["find_idempotent_serve"] = { data: null, error: { code: "XX000", message: "internal secret detail: relation ad_serve_requests" } };
    const r = await send({ topic: "gaming" });
    assert.equal(r.status, 503);
    assert.deepEqual(r.body, UNAVAILABLE);
    assert.equal(db.rpcCount("load_ad_candidates"), 0);
    assert.equal(db.rpcCount("record_ad_serve"), 0);
    assertNothingServed(() => assert.equal(/secret detail|ad_serve_requests/.test(r.text + JSON.stringify(logged)), false));
  });

  const malformedReplays: [string, unknown][] = [
    ["null data", null],
    ["string data", "found"],
    ["array data", [{ outcome: "found", ad: GOOD_AD }]],
    ["no outcome", { ad: GOOD_AD }],
    ["unknown outcome", { outcome: "maybe", ad: GOOD_AD }],
    ["found without ad", { outcome: "found" }],
    ["found with null ad", { outcome: "found", ad: null }],
    ["found with array ad", { outcome: "found", ad: [GOOD_AD] }],
    ["found with non-uuid ad id", { outcome: "found", ad: { ...GOOD_AD, id: "not-a-uuid" } }],
    ["found with missing headline", { outcome: "found", ad: { ...GOOD_AD, headline: undefined } }],
    ["found with numeric body", { outcome: "found", ad: { ...GOOD_AD, body: 5 } }],
    ["found with numeric cta_text", { outcome: "found", ad: { ...GOOD_AD, cta_text: 5 } }],
    ["found with missing destination_url", { outcome: "found", ad: { ...GOOD_AD, destination_url: undefined } }],
  ];
  for (const [label, data] of malformedReplays) {
    it(`malformed replay response (${label}) => 503, no ad, no record, no charge`, async () => {
      world();
      db.failRpc["find_idempotent_serve"] = { data, error: null };
      const r = await send({ topic: "gaming" });
      assert.equal(r.status, 503);
      assert.deepEqual(r.body, UNAVAILABLE);
      assert.equal(db.rpcCount("record_ad_serve"), 0);
      assertNothingServed();
    });
  }

  it("a replay with a valid ad but a broken serve receipt still returns that already-recorded ad (no token), and adds nothing", async () => {
    const { pub } = world();
    const first = await send({ topic: "gaming" });
    db.failRpc["find_idempotent_serve"] = { data: { outcome: "found", ad: adOf(first), serve_ref: "garbage", served_at: "not a date" }, error: null };
    const r = await send({ topic: "gaming" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, first.body);
    assert.equal(db.servesFor(pub.id).length, 1);
    assert.equal(db.rpcCount("record_ad_serve"), 1);
  });

  it("replay lookup says unauthorized (key lost between calls) => 401, nothing served", async () => {
    world();
    db.failRpc["find_idempotent_serve"] = { data: { outcome: "unauthorized" }, error: null };
    const r = await send({ topic: "gaming" });
    assert.equal(r.status, 401);
    assertNothingServed();
  });

  const malformedRecords: [string, unknown][] = [
    ["replayed without ad", { outcome: "ok", replayed: true }],
    ["replayed with null ad", { outcome: "ok", replayed: true, ad: null }],
    ["replayed with non-uuid ad id", { outcome: "ok", replayed: true, ad: { ...GOOD_AD, id: "nope" } }],
    ["replayed with wrong field types", { outcome: "ok", replayed: true, ad: { ...GOOD_AD, headline: 1 } }],
    ["unknown outcome", { outcome: "surprise" }],
    ["null data", null],
    ["array data", ["ok"]],
  ];
  for (const [label, data] of malformedRecords) {
    it(`malformed record_ad_serve response (${label}) => 503, no ad returned`, async () => {
      world();
      db.failRpc["record_ad_serve"] = { data, error: null };
      const r = await send({ topic: "gaming" });
      assert.equal(r.status, 503);
      assert.deepEqual(r.body, UNAVAILABLE);
      assert.equal(r.text.includes("Ad one") || r.text.includes("Ad two"), false, "the selected (unrecorded) ad must not leak");
      assert.equal(db.rpcCount("record_ad_serve"), 1, "no further record attempts after an error");
    });
  }

  it("record says replayed with a valid ad => that recorded ad is returned, not the freshly selected one", async () => {
    world();
    db.failRpc["record_ad_serve"] = { data: { outcome: "ok", replayed: true, ad: GOOD_AD }, error: null };
    const r = await send({ topic: "gaming" });
    assert.equal(r.status, 200);
    assert.equal(adId(r), GOOD_AD.id);
    assert.equal(adOf(r).headline, "H");
  });

  it("record_ad_serve rejected (budget / race) never returns the rejected ad and writes nothing", async () => {
    world();
    db.failRpc["record_ad_serve"] = { data: { outcome: "rejected" }, error: null };
    const r = await send({ topic: "gaming" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { fill: false });
    assertNothingServed();
  });

  it("record_ad_serve SQL error => 503, no ad, no charge", async () => {
    world();
    db.failRpc["record_ad_serve"] = { data: null, error: { code: "23514", message: "secret detail" } };
    const r = await send({ topic: "gaming" });
    assert.equal(r.status, 503);
    assert.deepEqual(r.body, UNAVAILABLE);
    assertNothingServed(() => assert.equal(/secret detail/.test(r.text + JSON.stringify(logged)), false));
  });

  for (const rpc of ["authorize_publisher_key", "find_idempotent_serve", "load_ad_candidates", "record_ad_serve"]) {
    it(`database unreachable (${rpc} throws) => 503 with a fixed body, nothing recorded, nothing leaked`, async () => {
      world();
      const client = db.client();
      globals.__TEST_SUPABASE__ = {
        rpc: async (name: string, args: Record<string, unknown>) => {
          if (name === rpc) throw new Error("connection refused: secret-host.internal");
          return client.rpc(name, args);
        },
      };
      const r = await send({ topic: "gaming" });
      assert.equal(r.status, 503);
      assert.deepEqual(r.body, UNAVAILABLE);
      assert.equal(/secret-host/.test(r.text + JSON.stringify(logged)), false);
      assertNothingServed();
    });
  }

  it("recovery: once the lookup works again the same key is served normally and then replays", async () => {
    const { pub } = world();
    db.failRpc["find_idempotent_serve"] = { data: null, error: { code: "XX000" } };
    assert.equal((await send({ topic: "gaming" })).status, 503);
    db.failRpc["find_idempotent_serve"] = undefined;
    const ok1 = await send({ topic: "gaming" });
    const ok2 = await send({ topic: "gaming" });
    assert.equal(ok1.status, 200);
    assert.deepEqual(ok2.body, ok1.body);
    assert.equal(db.servesFor(pub.id).length, 1);
  });
});

describe("day 16 part 3 | serveAd orchestration with a replay dependency (pure deps)", () => {
  const HASH = "a".repeat(64);
  const PUB = { id: "99999999-9999-4999-8999-999999999999", status: "active" };
  const AD = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", headline: "H", body: "B", ctaText: null, destinationUrl: "https://example.com/x" };
  const req = { topic: "gaming", excludeAdIds: [] as string[], idempotencyKey: IDEM };

  function deps(replay: ServeDeps["lookupReplay"]) {
    const trace = { select: 0, record: 0, lookup: 0 };
    const d: ServeDeps = {
      authorize: async () => ({ outcome: "ok", publisher: PUB, unitCostUsd: 0.002 }),
      select: async () => {
        trace.select += 1;
        return { fill: false, reason: "no_candidates" } as never;
      },
      record: async () => {
        trace.record += 1;
        return { outcome: "recorded" };
      },
      lookupReplay: replay
        ? async (...a) => {
            trace.lookup += 1;
            return replay(...a);
          }
        : undefined,
    };
    return { d, trace };
  }

  it("found => the replayed ad with only the 5 public fields; select and record are never called", async () => {
    const { d, trace } = deps(async () => ({ outcome: "found", ad: { ...AD, extra: "secret" } as typeof AD }));
    const r = await serveAd(HASH, req, d);
    assert.deepEqual(r, { kind: "ad", ad: AD });
    assert.deepEqual(trace, { select: 0, record: 0, lookup: 1 });
  });

  it("lookup throws or returns an unknown outcome => unavailable, select and record never called", async () => {
    for (const replay of [
      async () => {
        throw new Error("boom");
      },
      async () => ({ outcome: "weird" }) as never,
    ]) {
      const { d, trace } = deps(replay);
      assert.deepEqual(await serveAd(HASH, req, d), { kind: "unavailable" });
      assert.equal(trace.select + trace.record, 0);
    }
  });

  it("no Idempotency-Key => lookup is not called; rejected replay => no_fill without select/record", async () => {
    const a = deps(async () => ({ outcome: "found", ad: AD }));
    await serveAd(HASH, { topic: "gaming", excludeAdIds: [] }, a.d);
    assert.equal(a.trace.lookup, 0);

    const b = deps(async () => ({ outcome: "rejected" }));
    assert.deepEqual(await serveAd(HASH, req, b.d), { kind: "no_fill" });
    assert.equal(b.trace.select + b.trace.record, 0);
  });

  it("the key is passed to record only when the request has one (3-arg path unchanged without it)", async () => {
    const seen: unknown[][] = [];
    const d: ServeDeps = {
      authorize: async () => ({ outcome: "ok", publisher: PUB, unitCostUsd: 0.002 }),
      select: async () => ({ fill: true, ad: AD, nextAds: [] }) as never,
      record: async (...args) => {
        seen.push(args);
        return { outcome: "recorded" };
      },
    };
    await serveAd(HASH, { topic: "gaming", excludeAdIds: [] }, d);
    await serveAd(HASH, req, d);
    assert.equal(seen[0].length, 3);
    assert.equal(seen[1][3], IDEM);
    assert.ok(UUID_RE.test(PUB.id));
  });
});
