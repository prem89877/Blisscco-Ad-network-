import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import * as route from "@/app/api/v1/ads/click/route";
import { CLICK_PARAM, MAX_DESTINATION_LENGTH, acceptClick, parseClickQuery, safeDestination, type ClickDeps, type ClickServeRow, type RecordClickOutcome } from "@/lib/ads/click";
import { parseClickLookup, parseRecordClick } from "@/lib/ads/click-db";
import { handleClickGet, isPrefetch } from "@/lib/ads/click-handler";
import { creativeTag, mintClickRef } from "@/lib/ads/click-ref";
import { createIpGuard } from "@/lib/ads/ip-guard";
import { mintTrackingToken, publisherTag, type TrackingConfig } from "@/lib/ads/tracking-token";

// Day 12 Prompt 5 Part 3: click redirect. Database NAKLI hai (FakeClickStore = day-12-10 SQL ka MODEL, SQL khud nahi); asli Supabase / production kabhi nahi chhuta.
// LIMIT: day-12-10 SQL kisi database par chali NAHI hai, isliye SQL ka asli behaviour (unique constraint, eligibility join) yahan sabit nahi hota; sirf uske text ki static jaanch hai.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

const SECRET = "k7f2-0123456789-abcdefghijklmnopqrstuvwxyz-primary";
const OTHER_SECRET = "m4q9-0123456789-abcdefghijklmnopqrstuvwxyz-rotated";
const REF = `bsr_${"ab".repeat(20)}`;
const PUB = "00000000-0000-4000-8000-0000000000a1";
const PUB_2 = "00000000-0000-4000-8000-0000000000a2";
const CREATIVE = "00000000-0000-4000-8000-0000000000c1";
const CREATIVE_2 = "00000000-0000-4000-8000-0000000000c2";
const CAMPAIGN = "00000000-0000-4000-8000-0000000000d1";
const DEST = "https://advertiser.example.com/landing?utm_source=blisscco";
const NOW = Date.UTC(2026, 9, 29, 10, 0, 0);

const config = (over: Partial<TrackingConfig> = {}): TrackingConfig => ({ secrets: [SECRET], ttlSeconds: 3600, ...over });
const makeRef = (over: Partial<Parameters<typeof mintClickRef>[1]> = {}, cfg = config()): string => {
  const g = mintClickRef(cfg, { serveRef: REF, publisherId: PUB, creativeId: CREATIVE, servedAtMs: NOW, nowMs: NOW + 1000, ...over });
  assert.ok(g);
  return g.ref;
};

type CreativeState = { eligible: boolean; destination: string | null };

/** day-12-10 ka model: lookup_serve_for_click + record_ad_click. */
class FakeClickStore {
  serves = new Map<string, { id: number; publisherId: string; campaignId: string; creativeId: string; servedAtMs: number }>();
  creatives = new Map<string, CreativeState>();
  events: { serveId: number; type: "impression" | "click"; source?: string }[] = [];
  lookupCalls = 0;
  recordCalls: { serveRef: string; publisherId: string; creativeId: string }[] = [];
  nowMs = NOW + 1000;

  constructor() {
    this.serves.set(REF, { id: 1, publisherId: PUB, campaignId: CAMPAIGN, creativeId: CREATIVE, servedAtMs: NOW });
    this.creatives.set(CREATIVE, { eligible: true, destination: DEST });
    this.creatives.set(CREATIVE_2, { eligible: true, destination: "https://other.example.org/" });
  }
  get clicks() { return this.events.filter((e) => e.type === "click"); }
  addImpression(serveId = 1) { this.events.push({ serveId, type: "impression" }); }

  lookupServe = async (serveRef: string): Promise<ClickServeRow | null> => {
    this.lookupCalls += 1;
    const s = this.serves.get(serveRef);
    if (!s) return null;
    const c = this.creatives.get(s.creativeId);
    const dest = c && c.eligible ? c.destination : null;
    return { publisherId: s.publisherId, creativeId: s.creativeId, servedAtMs: s.servedAtMs, destinationUrl: dest, eligible: dest !== null };
  };

  record = async (serveRef: string, publisherId: string, creativeId: string): Promise<RecordClickOutcome> => {
    this.recordCalls.push({ serveRef, publisherId, creativeId });
    const s = this.serves.get(serveRef);
    if (!s || s.publisherId !== publisherId || s.creativeId !== creativeId) return { outcome: "rejected" };
    if (this.nowMs > s.servedAtMs + 24 * 3_600_000) return { outcome: "rejected" };
    const c = this.creatives.get(s.creativeId);
    if (!c || !c.eligible || c.destination === null) return { outcome: "ineligible" };
    if (!this.events.some((e) => e.serveId === s.id && e.type === "impression")) return { outcome: "not_counted", destinationUrl: c.destination };
    if (this.events.some((e) => e.serveId === s.id && e.type === "click")) return { outcome: "duplicate", destinationUrl: c.destination };
    this.events.push({ serveId: s.id, type: "click", source: "blisscco_redirect" });
    return { outcome: "recorded", destinationUrl: c.destination };
  };
}

const depsFor = (store: FakeClickStore, over: Partial<ClickDeps> = {}): ClickDeps => ({
  config: config(), nowMs: () => store.nowMs, lookupServe: store.lookupServe, record: store.record, ...over,
});
const readyStore = () => { const s = new FakeClickStore(); s.addImpression(); return s; };

// ===========================================================================================================================
describe("day 12 prompt 5 part 3 | query: only `ref`, never a destination", () => {
  it("accepts exactly one ref parameter", () => {
    assert.deepEqual(parseClickQuery(new URLSearchParams("ref=bc1.a.b")), { ok: true, ref: "bc1.a.b" });
  });
  it("rejects missing / empty / oversized ref", () => {
    assert.deepEqual(parseClickQuery(new URLSearchParams("")), { ok: false, reason: "missing_ref" });
    assert.deepEqual(parseClickQuery(new URLSearchParams("ref=")), { ok: false, reason: "invalid_ref" });
    assert.deepEqual(parseClickQuery(new URLSearchParams(`ref=${"a".repeat(513)}`)), { ok: false, reason: "invalid_ref" });
  });
  it("rejects every extra parameter, especially anything that looks like a destination", () => {
    for (const extra of ["url", "dest", "destination", "destination_url", "redirect", "redirect_uri", "next", "to", "target", "u", "r", "return"]) {
      const q = new URLSearchParams(`ref=bc1.a.b&${extra}=https%3A%2F%2Fevil.example`);
      assert.deepEqual(parseClickQuery(q), { ok: false, reason: "unexpected_parameter" }, extra);
    }
    assert.deepEqual(parseClickQuery(new URLSearchParams("url=https%3A%2F%2Fevil.example")), { ok: false, reason: "unexpected_parameter" });
    assert.deepEqual(parseClickQuery(new URLSearchParams("ref=a&ref=b")), { ok: false, reason: "unexpected_parameter" });
    assert.deepEqual(parseClickQuery(new URLSearchParams("REF=bc1.a.b")), { ok: false, reason: "unexpected_parameter" });
    assert.equal(CLICK_PARAM, "ref");
  });
});

describe("day 12 prompt 5 part 3 | successful click", () => {
  it("valid ref + served + eligible creative -> redirect to the DATABASE destination, one click recorded", async () => {
    const store = readyStore();
    const r = await acceptClick(makeRef(), depsFor(store));
    assert.deepEqual(r, { kind: "redirect", location: new URL(DEST).href, counted: "recorded" });
    assert.equal(store.clicks.length, 1);
    assert.equal(store.clicks[0].source, "blisscco_redirect");
    // publisher + creative database ke serve row se aaye, caller se nahi
    assert.deepEqual(store.recordCalls, [{ serveRef: REF, publisherId: PUB, creativeId: CREATIVE }]);
  });

  it("a second click on the same serve still redirects but is a duplicate (nothing new written)", async () => {
    const store = readyStore();
    const ref = makeRef();
    assert.equal((await acceptClick(ref, depsFor(store)) as { counted: string }).counted, "recorded");
    const again = await acceptClick(ref, depsFor(store));
    assert.deepEqual(again, { kind: "redirect", location: new URL(DEST).href, counted: "duplicate" });
    assert.equal(store.clicks.length, 1);
    for (let i = 0; i < 5; i += 1) await acceptClick(ref, depsFor(store));
    assert.equal(store.clicks.length, 1);
  });

  it("concurrent clicks on one serve produce one click (database dedupe decides)", async () => {
    const store = readyStore();
    const ref = makeRef();
    const results = await Promise.all(Array.from({ length: 8 }, () => acceptClick(ref, depsFor(store))));
    assert.equal(results.filter((x) => x.kind === "redirect" && x.counted === "recorded").length, 1);
    assert.equal(results.filter((x) => x.kind === "redirect").length, 8);
    assert.equal(store.clicks.length, 1);
  });

  it("without a prior impression the user is redirected but no click is counted (D4); after an impression the click counts", async () => {
    const store = new FakeClickStore();
    const ref = makeRef();
    const first = await acceptClick(ref, depsFor(store));
    assert.deepEqual(first, { kind: "redirect", location: new URL(DEST).href, counted: "not_counted" });
    assert.equal(store.clicks.length, 0);
    store.addImpression();
    assert.equal((await acceptClick(ref, depsFor(store)) as { counted: string }).counted, "recorded");
    assert.equal(store.clicks.length, 1);
  });

  it("a click is never recorded for another serve's creative, and clicks do not spend (writer has no spend access)", async () => {
    const store = readyStore();
    const ref = makeRef({ creativeId: CREATIVE_2 }); // ref creative_2 ke liye, par DB me serve creative_1 ki
    const r = await acceptClick(ref, depsFor(store));
    assert.deepEqual(r, { kind: "invalid", reason: "creative_mismatch" });
    assert.equal(store.clicks.length, 0);
    assert.equal(store.recordCalls.length, 0);
  });

  it("a rotated (previous) secret ref still works", async () => {
    const store = readyStore();
    const ref = makeRef({}, config({ secrets: [OTHER_SECRET] }));
    const r = await acceptClick(ref, depsFor(store, { config: config({ secrets: [SECRET, OTHER_SECRET] }) }));
    assert.equal(r.kind, "redirect");
  });
});

describe("day 12 prompt 5 part 3 | invalid references", () => {
  const bad = async (ref: unknown, over: (s: FakeClickStore) => Partial<ClickDeps> = () => ({})) => {
    const store = readyStore();
    const r = await acceptClick(ref, depsFor(store, over(store)));
    assert.equal(r.kind, "invalid", JSON.stringify(r));
    assert.equal(store.recordCalls.length, 0, "no click write on invalid ref");
    assert.equal(store.clicks.length, 0);
    return { r, store };
  };

  it("garbage, wrong type, empty and oversized refs never reach the database", async () => {
    for (const ref of [undefined, null, 5, {}, [], "", "x", "bc1", "bc1.a.b", `bc1.${"a".repeat(600)}.b`, "https://evil.example", "a".repeat(5000)]) {
      const { store } = await bad(ref);
      assert.equal(store.lookupCalls, 0, "malformed ref: no lookup");
    }
  });

  it("a ref signed with an unknown secret is rejected", async () => {
    const { r } = await bad(makeRef({}, config({ secrets: [OTHER_SECRET] })));
    assert.deepEqual(r, { kind: "invalid", reason: "invalid_signature" });
  });

  it("an impression/tracking (bt1) token is not a click ref", async () => {
    const bt = mintTrackingToken(config(), { serveRef: REF, publisherId: PUB, servedAtMs: NOW, nowMs: NOW + 1000 });
    assert.ok(bt);
    await bad(bt.token);
  });

  it("a tampered ref (changed creative tag / publisher tag / signature) is rejected", async () => {
    const ref = makeRef();
    const [prefix, payload, sig] = ref.split(".");
    const original = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    const tag = (o: Record<string, unknown>) => `${prefix}.${Buffer.from(JSON.stringify({ ...original, ...o })).toString("base64url")}.${sig}`;
    await bad(tag({ c: creativeTag(SECRET, CREATIVE_2) }));
    await bad(tag({ p: publisherTag(SECRET, PUB_2) }));
    await bad(tag({ exp: (original.exp as number) + 5000 }));
    await bad(`${prefix}.${payload}.${sig.slice(0, -2)}AA`);
  });

  it("unknown serve (or a purged one) is rejected and no click is written", async () => {
    const { r } = await bad(makeRef({ serveRef: `bsr_${"cd".repeat(20)}` }));
    assert.deepEqual(r, { kind: "invalid", reason: "unknown_serve" });
  });

  it("a ref issued for another publisher is rejected", async () => {
    const { r } = await bad(makeRef({ publisherId: PUB_2 }));
    assert.deepEqual(r, { kind: "invalid", reason: "publisher_mismatch" });
  });

  it("the database refusing the click (rejected) is invalid, never a redirect", async () => {
    const store = readyStore();
    const r = await acceptClick(makeRef(), depsFor(store, { record: async () => ({ outcome: "rejected" }) }));
    assert.deepEqual(r, { kind: "invalid", reason: "unknown_serve" });
  });
});

describe("day 12 prompt 5 part 3 | expired references", () => {
  it("expired ref is rejected before any database call", async () => {
    const store = readyStore();
    store.nowMs = NOW + 3_600_000;
    const r = await acceptClick(makeRef(), depsFor(store));
    assert.deepEqual(r, { kind: "invalid", reason: "expired" });
    assert.equal(store.lookupCalls, 0);
    assert.equal(store.recordCalls.length, 0);
    assert.equal(store.clicks.length, 0);
  });
  it("valid up to the last millisecond, expired exactly at exp", async () => {
    const store = readyStore();
    store.nowMs = NOW + 3_599_999;
    assert.equal((await acceptClick(makeRef(), depsFor(store))).kind, "redirect");
    store.nowMs = NOW + 3_600_000;
    assert.deepEqual(await acceptClick(makeRef(), depsFor(store)), { kind: "invalid", reason: "expired" });
  });
  it("the database 24h cap still refuses a click if a long-TTL ref outlives the serve window", async () => {
    const store = readyStore();
    const longCfg = config({ ttlSeconds: 86_400 });
    const longRef = makeRef({}, longCfg);
    store.nowMs = NOW + 23 * 3_600_000;
    assert.equal((await acceptClick(longRef, depsFor(store, { config: longCfg, nowMs: () => store.nowMs }))).kind, "redirect"); // 23h: ref + DB dono ke andar
    const fresh = readyStore();
    fresh.nowMs = NOW + 25 * 3_600_000; // database ki ghadi serve se 25h aage
    const late = await acceptClick(longRef, depsFor(fresh, { config: longCfg, nowMs: () => NOW + 23 * 3_600_000 })); // ref abhi valid dikh raha
    assert.deepEqual(late, { kind: "invalid", reason: "unknown_serve" });
    assert.equal(fresh.clicks.length, 0);
  });
});

describe("day 12 prompt 5 part 3 | missing or ineligible creatives", () => {
  it("creative no longer eligible (paused / rejected / campaign inactive): no redirect, no click, no write attempt", async () => {
    const store = readyStore();
    store.creatives.set(CREATIVE, { eligible: false, destination: DEST });
    const r = await acceptClick(makeRef(), depsFor(store));
    assert.deepEqual(r, { kind: "unavailable_target" });
    assert.equal(store.recordCalls.length, 0);
    assert.equal(store.clicks.length, 0);
  });
  it("creative row missing entirely: no redirect, no click", async () => {
    const store = readyStore();
    store.creatives.delete(CREATIVE);
    assert.deepEqual(await acceptClick(makeRef(), depsFor(store)), { kind: "unavailable_target" });
    assert.equal(store.recordCalls.length, 0);
    assert.equal(store.clicks.length, 0);
  });
  it("eligible flag true but destination missing: no redirect", async () => {
    const store = readyStore();
    const r = await acceptClick(makeRef(), depsFor(store, { lookupServe: async () => ({ publisherId: PUB, creativeId: CREATIVE, servedAtMs: NOW, destinationUrl: null, eligible: true }) }));
    assert.deepEqual(r, { kind: "unavailable_target" });
    assert.equal(store.recordCalls.length, 0);
  });
  it("creative becomes ineligible between lookup and write (database says ineligible): no redirect", async () => {
    const store = readyStore();
    const r = await acceptClick(makeRef(), depsFor(store, { record: async () => ({ outcome: "ineligible" }) }));
    assert.deepEqual(r, { kind: "unavailable_target" });
  });
});

describe("day 12 prompt 5 part 3 | disallowed destinations", () => {
  const BAD = [
    "http://advertiser.example.com/", "javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "ftp://advertiser.example.com/",
    "//evil.example.com/", "/relative/path", "https://user:pass@advertiser.example.com/", "https://trusted.com@evil.example/", "https://127.0.0.1/", "https://192.168.0.1/x",
    "https://[::1]/", "https://localhost/", "https://intranet/", "https://example.com/has space", "https://example.com/\r\nSet-Cookie: x=1",
    "HTTPS ://example.com", "", `https://example.com/${"a".repeat(MAX_DESTINATION_LENGTH)}`, "https://.example.com/", "https://example./",
  ];

  it("safeDestination rejects all of them and accepts a normal https URL", () => {
    for (const d of BAD) assert.equal(safeDestination(d), null, JSON.stringify(d).slice(0, 60));
    for (const d of [undefined, null, 5, {}, []]) assert.equal(safeDestination(d), null);
    assert.equal(safeDestination(DEST), new URL(DEST).href);
    assert.equal(safeDestination("https://münchen.example/ü?q=ä"), new URL("https://münchen.example/ü?q=ä").href); // ASCII-normalized
    assert.match(safeDestination("https://münchen.example/ü") ?? "", /^[\x21-\x7e]+$/);
  });

  it("a disallowed destination from the database is never redirected to, and its click is never written", async () => {
    for (const d of BAD) {
      const store = readyStore();
      store.creatives.set(CREATIVE, { eligible: true, destination: d });
      const r = await acceptClick(makeRef(), depsFor(store));
      assert.deepEqual(r, { kind: "unavailable_target" }, JSON.stringify(d).slice(0, 60));
      assert.equal(store.recordCalls.length, 0);
      assert.equal(store.clicks.length, 0);
    }
  });

  it("a disallowed destination returned only at write time is not followed either", async () => {
    const store = readyStore();
    const r = await acceptClick(makeRef(), depsFor(store, { record: async () => ({ outcome: "recorded", destinationUrl: "https://127.0.0.1/" }) }));
    assert.deepEqual(r, { kind: "unavailable_target" });
  });
});

describe("day 12 prompt 5 part 3 | availability and database failures", () => {
  it("secret not configured -> unavailable (no lookup, no click)", async () => {
    const store = readyStore();
    assert.deepEqual(await acceptClick(makeRef(), depsFor(store, { config: null })), { kind: "unavailable" });
    assert.equal(store.lookupCalls, 0);
  });
  it("lookup throws -> unavailable (not invalid, not redirect)", async () => {
    const store = readyStore();
    assert.deepEqual(await acceptClick(makeRef(), depsFor(store, { lookupServe: async () => { throw new Error("db"); } })), { kind: "unavailable" });
    assert.equal(store.recordCalls.length, 0);
  });
  it("write error / throw -> unavailable, never a redirect", async () => {
    const store = readyStore();
    assert.deepEqual(await acceptClick(makeRef(), depsFor(store, { record: async () => ({ outcome: "error" }) })), { kind: "unavailable" });
    assert.deepEqual(await acceptClick(makeRef(), depsFor(store, { record: async () => { throw new Error("db"); } })), { kind: "unavailable" });
  });
});

describe("day 12 prompt 5 part 3 | database reply parsing", () => {
  const good = { outcome: "found", publisher_id: PUB, creative_id: CREATIVE, served_at: new Date(NOW).toISOString(), destination_url: DEST, eligible: true };
  it("parses a good lookup, not_found as null, and throws on any odd shape (so it becomes unavailable)", () => {
    assert.deepEqual(parseClickLookup(good), { publisherId: PUB, creativeId: CREATIVE, servedAtMs: NOW, destinationUrl: DEST, eligible: true });
    assert.equal(parseClickLookup({ ...good, destination_url: null, eligible: false })?.destinationUrl, null);
    assert.equal(parseClickLookup({ outcome: "not_found" }), null);
    for (const x of [null, "x", [], {}, { outcome: "maybe" }, { ...good, publisher_id: "x" }, { ...good, creative_id: 5 }, { ...good, served_at: "nope" }, { ...good, eligible: "yes" }, { ...good, destination_url: 7 }]) {
      assert.throws(() => parseClickLookup(x));
    }
  });
  it("parses record outcomes; anything odd is error, never recorded", () => {
    assert.deepEqual(parseRecordClick({ outcome: "recorded", destination_url: DEST }), { outcome: "recorded", destinationUrl: DEST });
    assert.deepEqual(parseRecordClick({ outcome: "duplicate", destination_url: DEST }), { outcome: "duplicate", destinationUrl: DEST });
    assert.deepEqual(parseRecordClick({ outcome: "not_counted", destination_url: DEST }), { outcome: "not_counted", destinationUrl: DEST });
    assert.deepEqual(parseRecordClick({ outcome: "rejected" }), { outcome: "rejected" });
    assert.deepEqual(parseRecordClick({ outcome: "ineligible" }), { outcome: "ineligible" });
    for (const x of [null, 1, [], {}, { outcome: "recorded" }, { outcome: "recorded", destination_url: 5 }, { outcome: "ok" }]) {
      assert.deepEqual(parseRecordClick(x), { outcome: "error" });
    }
  });
});

// ===========================================================================================================================
describe("day 12 prompt 5 part 3 | HTTP handler", () => {
  const req = (qs: string, headers: Record<string, string> = {}) => new Request(`https://blisscco.online/api/v1/ads/click${qs}`, { method: "GET", headers });
  const guards = () => ({ requestGuard: createIpGuard(300), failureGuard: createIpGuard(30) });
  const real = (store: FakeClickStore) => (ref: unknown) => acceptClick(ref, depsFor(store));

  it("valid ref: 302 to the database destination with safe headers; click recorded", async () => {
    const store = readyStore();
    const res = await handleClickGet(req(`?ref=${makeRef()}`), { accept: real(store), ...guards() });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), new URL(DEST).href);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("access-control-allow-origin"), null);
    assert.equal(store.clicks.length, 1);
  });

  it("an attacker-supplied destination in the query is rejected (400) and nothing is looked up or recorded", async () => {
    const store = readyStore();
    for (const qs of [`?ref=${makeRef()}&url=https%3A%2F%2Fevil.example`, `?url=https%3A%2F%2Fevil.example`, `?ref=${makeRef()}&redirect=//evil.example`, `?ref=${makeRef()}&destination_url=https://evil.example`]) {
      const res = await handleClickGet(req(qs), { accept: real(store), ...guards() });
      assert.equal(res.status, 400, qs);
      assert.equal(res.headers.get("location"), null);
    }
    assert.equal(store.lookupCalls, 0);
    assert.equal(store.clicks.length, 0);
  });

  it("missing ref -> 400", async () => {
    const res = await handleClickGet(req(""), { accept: real(readyStore()), ...guards() });
    assert.equal(res.status, 400);
  });

  it("invalid, expired and disallowed-destination/missing-creative cases all give the same 404 body and no Location", async () => {
    const bodies = new Set<string>();
    const run = async (store: FakeClickStore, ref: string) => {
      const res = await handleClickGet(req(`?ref=${ref}`), { accept: real(store), ...guards() });
      assert.equal(res.status, 404);
      assert.equal(res.headers.get("location"), null);
      bodies.add(await res.text());
    };
    await run(readyStore(), "bc1.AAAA.BBBB"); // invalid
    const expired = readyStore(); expired.nowMs = NOW + 7_200_000;
    await run(expired, makeRef()); // expired
    const missing = readyStore(); missing.creatives.delete(CREATIVE);
    await run(missing, makeRef()); // missing creative
    const evil = readyStore(); evil.creatives.set(CREATIVE, { eligible: true, destination: "http://evil.example/" });
    await run(evil, makeRef()); // disallowed destination
    assert.equal(bodies.size, 1, "one generic body: no oracle");
    assert.ok(![...bodies][0].includes("expired") && ![...bodies][0].includes("creative"));
  });

  it("unavailable -> 503; handler never throws, even if accept throws", async () => {
    const a = await handleClickGet(req("?ref=bc1.a.b"), { accept: async () => ({ kind: "unavailable" }), ...guards() });
    assert.equal(a.status, 503);
    const b = await handleClickGet(req("?ref=bc1.a.b"), { accept: async () => { throw new Error("boom"); }, ...guards() });
    assert.equal(b.status, 503);
  });

  it("prefetch / prerender requests do nothing: 204, no click, no redirect", async () => {
    const store = readyStore();
    for (const h of [{ "sec-purpose": "prefetch" }, { purpose: "prefetch" }, { "sec-purpose": "prefetch;prerender" }, { "x-moz": "prefetch" }, { "next-router-prefetch": "1" }]) {
      const res = await handleClickGet(req(`?ref=${makeRef()}`, h), { accept: real(store), ...guards() });
      assert.equal(res.status, 204, JSON.stringify(h));
      assert.equal(res.headers.get("location"), null);
    }
    assert.equal(store.lookupCalls, 0);
    assert.equal(store.clicks.length, 0);
    assert.equal(isPrefetch(new Headers({ accept: "text/html" })), false);
  });

  it("rate limits: too many requests -> 429 before any lookup; repeated bad refs are counted", async () => {
    const store = readyStore();
    const tiny = { requestGuard: createIpGuard(2), failureGuard: createIpGuard(30) };
    const h = { "x-forwarded-for": "203.0.113.9" };
    const r1 = await handleClickGet(req(`?ref=${makeRef()}`, h), { accept: real(store), ...tiny });
    const r2 = await handleClickGet(req(`?ref=${makeRef()}`, h), { accept: real(store), ...tiny });
    const r3 = await handleClickGet(req(`?ref=${makeRef()}`, h), { accept: real(store), ...tiny });
    assert.deepEqual([r1.status, r2.status, r3.status], [302, 302, 429]);
    assert.equal(r3.headers.get("retry-after"), "60");
    const fail = { requestGuard: createIpGuard(300), failureGuard: createIpGuard(2) };
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) statuses.push((await handleClickGet(req("?ref=bc1.x.y", h), { accept: real(readyStore()), ...fail })).status);
    assert.deepEqual(statuses, [404, 404, 429, 429]);
  });

  it("route: GET only. HEAD/POST/PUT/PATCH/DELETE are 405 (a HEAD crawler cannot count a click)", async () => {
    for (const m of [route.HEAD, route.POST, route.PUT, route.PATCH, route.DELETE]) {
      const res = await m();
      assert.equal(res.status, 405);
      assert.equal(res.headers.get("allow"), "GET");
    }
    assert.equal(typeof route.GET, "function");
    assert.equal(route.runtime, "nodejs");
    assert.equal(route.dynamic, "force-dynamic");
  });
});

// ===========================================================================================================================
describe("day 12 prompt 5 part 3 | static safety", () => {
  const walk = (dir: string): string[] =>
    readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${dir}/${e.name}`] : [],
    );
  const code = (f: string) => read(f).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

  it("no click code reads a destination from the request, env, or a cookie", () => {
    for (const f of ["lib/ads/click.ts", "lib/ads/click-handler.ts", "app/api/v1/ads/click/route.ts"]) {
      assert.ok(!/request\.(json|text|formData|body)|req\.body|cookies\(|process\.env/.test(code(f)), f);
    }
    assert.ok(!/searchParams\.get\(\s*["'](url|dest|destination|redirect|next|to|target)/i.test(code("lib/ads/click-handler.ts")));
    // handler sirf click.ts ke parseClickQuery ke raaste query padhta hai
    assert.ok(/parseClickQuery\(new URL\(request\.url\)\.searchParams\)/.test(code("lib/ads/click-handler.ts")));
  });

  it("the redirect location only ever comes from acceptClick's validated result", () => {
    const h = code("lib/ads/click-handler.ts");
    assert.equal((h.match(/Location:/g) ?? []).length, 1);
    assert.ok(/Location: result\.location/.test(h));
    assert.ok(!/NextResponse\.redirect|Response\.redirect|redirect\(/.test(h));
  });

  it("the database bridge touches only the two click rpcs, never a table, spend, or other writers", () => {
    const db = code("lib/ads/click-db.ts");
    assert.deepEqual([...db.matchAll(/\.rpc\(\s*"([a-z_]+)"/g)].map((m) => m[1]).sort(), ["lookup_serve_for_click", "record_ad_click"]);
    assert.ok(!/\.from\(|record_ad_serve|record_ad_impression|campaign_spend|ad_serve_log|NEXT_PUBLIC/.test(db));
    assert.ok(/^import "server-only";/.test(read("lib/ads/click-db.ts")));
  });

  it("the signing secret is still read in one place (service.ts); click files never read env", () => {
    const users = ["app", "lib", "components"].flatMap(walk).filter((f) => /AD_TRACKING_SECRET/.test(read(f)));
    assert.deepEqual(users.sort(), ["lib/ads/service.ts", "lib/ads/tracking-token.ts"]);
    assert.ok(/acceptClickForRef/.test(read("lib/ads/service.ts")));
  });

  it("no wildcard CORS and no browser (client) code imports the click modules", () => {
    for (const f of ["lib/ads/click-handler.ts", "app/api/v1/ads/click/route.ts"]) assert.ok(!/Access-Control-Allow/i.test(read(f)), f);
    for (const f of [...walk("app"), ...walk("components")]) {
      if (f === "app/api/v1/ads/click/route.ts") continue;
      assert.ok(!/lib\/ads\/click|click-ref/.test(read(f)), `${f} imports click modules`);
    }
  });

  it("the match API response and serve code are untouched (no click ref issued yet)", () => {
    for (const f of ["lib/ads/contract.ts", "lib/ads/serve.ts", "lib/ads/match-handler.ts", "lib/ads/serve-db.ts"]) {
      assert.ok(!/click-ref|mintClickRef/.test(read(f)), f);
    }
  });
});

describe("day 12 prompt 5 part 3 | day-12-10 / day-12-11 SQL (text checks only; SQL not run anywhere)", () => {
  const sql = read("supabase/sql/day-12-10-record-ad-click.sql");
  const body = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("creates only functions: no table/column/constraint/index/policy changes", () => {
    assert.doesNotMatch(body, /create\s+table|alter\s+table|create\s+(unique\s+)?index|create\s+policy|drop\s+(table|column|constraint)|create\s+trigger/i);
    assert.equal((body.match(/create or replace function/g) ?? []).length, 3);
  });
  it("all three functions are security definer with an empty search_path", () => {
    assert.equal((body.match(/security definer/g) ?? []).length, 3);
    assert.equal((body.match(/set search_path = ''/g) ?? []).length, 3);
  });
  it("grants: only service_role can execute the two public functions; the private helper has no grant", () => {
    assert.match(body, /revoke all on function public\.lookup_serve_for_click\(text\) from public, anon, authenticated;/);
    assert.match(body, /grant execute on function public\.lookup_serve_for_click\(text\) to service_role;/);
    assert.match(body, /revoke all on function public\.record_ad_click\(text, uuid, uuid\) from public, anon, authenticated;/);
    assert.match(body, /grant execute on function public\.record_ad_click\(text, uuid, uuid\) to service_role;/);
    assert.match(body, /revoke all on function private\.click_target\(uuid\) from public, anon, authenticated, service_role;/);
    assert.doesNotMatch(body, /grant\s+[^;]*\bto\s+(anon|authenticated|public)\b/i);
  });
  it("click writer: click rows only, redirect source, database clock, one-per-type dedupe, no spend", () => {
    assert.match(body, /insert into public\.ad_events[\s\S]*'click', 'blisscco_redirect', now\(\)/);
    assert.match(body, /on conflict on constraint ad_events_one_per_type_key do nothing/);
    assert.doesNotMatch(body, /campaign_spend_daily|creative_serve_daily|update\s+public\.ad_serve_log|insert\s+into\s+public\.ad_serve_log/i);
    assert.doesNotMatch(body, /p_occurred|p_destination|p_url/i);
  });
  it("destination comes from ad_creatives via the same eligibility as replay (approved + active campaign/advertiser/profile)", () => {
    assert.match(body, /x\.status = 'approved'/);
    assert.match(body, /c\.status = 'active'/);
    assert.match(body, /a\.status\s+= 'active'/);
    assert.match(body, /ap\.status = 'active'/);
    assert.match(body, /from public\.ad_creatives x/);
  });
  it("D4 (impression before click) and the 24h cap are in the writer", () => {
    assert.match(body, /e\.event_type = 'impression'/);
    assert.match(body, /interval '24 hours'/);
  });
  it("lookup is stable/read-only and returns no campaign or advertiser id", () => {
    const lookup = /create or replace function public\.lookup_serve_for_click[\s\S]*?\$\$;\n/.exec(body)?.[0] ?? "";
    assert.ok(lookup.length > 100);
    assert.match(lookup, /\bstable\b/);
    assert.doesNotMatch(lookup, /\b(insert|update|delete)\b/i);
    assert.doesNotMatch(lookup, /campaign_id|advertiser/i);
  });
  it("the verify file is read-only (select only)", () => {
    const v = read("supabase/sql/day-12-11-click-verify.sql").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    assert.doesNotMatch(v, /^\s*(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/im);
  });
  it("the older verify files now allow exactly the second writer", () => {
    assert.match(read("supabase/sql/day-12-8-impression-verify.sql"), /proname not in \('record_ad_impression', 'record_ad_click'\)/);
    assert.match(read("supabase/sql/day-12-3-event-verify.sql"), /'record_ad_impression', 'record_ad_click'/);
  });
});
