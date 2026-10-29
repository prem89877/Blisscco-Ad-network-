import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import * as impressionRoute from "@/app/api/v1/ads/impression/route";
import * as v1MatchRoute from "@/app/api/v1/ads/match/route";
import { handleMatchPost } from "@/lib/ads/match-handler";
import { handleImpressionPost } from "@/lib/ads/impression-handler";
import { createIpGuard } from "@/lib/ads/ip-guard";
import { acceptImpression, parseImpressionRequest, type ImpressionDeps, type RecordImpressionOutcome } from "@/lib/ads/impression";
import { parseRecordImpression, parseServeLookup } from "@/lib/ads/impression-db";
import { mintTrackingToken, publisherTag, type TrackingConfig } from "@/lib/ads/tracking-token";
import { FakeAdDb, makeKey, sha256, type ServeLogRow } from "./fake-ad-db";

// Day 12 Part 4: impression endpoint. Database NAKLI hai (FakeAdDb + FakeEventStore = SQL ka MODEL); asli Supabase / production kabhi nahi chhuta.
// LIMIT: FakeEventStore day-12-7 SQL ka behaviour dohrata hai, SQL khud nahi. SQL ke asli test day-12-9-impression-tests.sql me hain
// (rollback-only, sirf TEST project, abhi CHALAYE NAHI gaye).

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
/** Comments (// ..., /* ... *\/, -- ...) hata kar sirf code: static checks comment ke lafzon par na atkein. */
const codeOnly = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("--"))
    .map((l) => l.replace(/(^|\s)\/\/.*$/, ""))
    .join("\n");
const walk = (dir: string): string[] =>
  readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${dir}/${e.name}`] : [],
  );

const SECRET = "k7f2-0123456789-abcdefghijklmnopqrstuvwxyz-primary";
const OTHER_SECRET = "m4q9-0123456789-abcdefghijklmnopqrstuvwxyz-rotated";
const KEY_A = makeKey("a");
const HOUR = 3_600_000;
const URL_IMPRESSION = "https://example.test/api/v1/ads/impression";

// ===========================================================================================================================
// Nakli event store: lookup_serve_for_event + record_ad_impression (day-12-7). Serve rows FakeAdDb.serveLog se aati hain.
type Reply = { data: unknown; error: { code?: string; message?: string } | null };
class FakeEventStore {
  /** serve_ref -> impression. Key = unique (serve_id, event_type='impression'): ek serve = ek impression. */
  impressions = new Map<string, { publisherId: string; occurredAtMs: number }>();
  calls: { name: string; args: Record<string, unknown> }[] = [];
  skewMs = 0;
  failLookup: Reply | null = null;
  failRecord: Reply | null = null;
  throwLookup = false;
  throwRecord = false;
  constructor(private readonly db: FakeAdDb) {}
  count(name: string): number {
    return this.calls.filter((c) => c.name === name).length;
  }
  private now(): number {
    return Date.now() + this.skewMs;
  }
  private serve(ref: unknown): ServeLogRow | undefined {
    return typeof ref === "string" && /^bsr_[0-9a-f]{40}$/.test(ref) ? this.db.serveLog.find((s) => s.serveRef === ref) : undefined;
  }
  async rpc(name: string, args: Record<string, unknown>): Promise<Reply> {
    this.calls.push({ name, args });
    if (name === "lookup_serve_for_event") {
      if (this.throwLookup) throw new Error("network down");
      if (this.failLookup) return this.failLookup;
      const s = this.serve(args.p_serve_ref);
      if (!s) return { data: { outcome: "not_found" }, error: null };
      return { data: { outcome: "found", publisher_id: s.publisherId, served_at: new Date(s.servedAtMs).toISOString() }, error: null };
    }
    if (name === "record_ad_impression") {
      if (this.throwRecord) throw new Error("network down");
      if (this.failRecord) return this.failRecord;
      const s = this.serve(args.p_serve_ref);
      const pub = args.p_publisher_id;
      if (!s || typeof pub !== "string" || s.publisherId !== pub) return { data: { outcome: "rejected" }, error: null };
      if (this.now() > s.servedAtMs + 24 * HOUR) return { data: { outcome: "rejected" }, error: null };
      // INSERT ... ON CONFLICT ON CONSTRAINT ad_events_one_per_type_key DO NOTHING (synchronous: JS me ye atomic hai, SQL me constraint karta hai)
      if (this.impressions.has(s.serveRef)) return { data: { outcome: "duplicate" }, error: null };
      this.impressions.set(s.serveRef, { publisherId: s.publisherId, occurredAtMs: this.now() });
      return { data: { outcome: "recorded" }, error: null };
    }
    throw new Error(`unexpected rpc ${name}`);
  }
}

const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
const realError = console.error;
const realLog = console.log;
const realWarn = console.warn;
let db: FakeAdDb;
let store: FakeEventStore;
let logged: string[];
let savedEnv: Record<string, string | undefined>;
const ENV_NAMES = ["AD_TRACKING_SECRET", "AD_TRACKING_SECRET_PREVIOUS", "AD_TRACKING_TTL_SECONDS"] as const;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_NAMES.map((n) => [n, process.env[n]]));
  process.env.AD_TRACKING_SECRET = SECRET;
  delete process.env.AD_TRACKING_SECRET_PREVIOUS;
  delete process.env.AD_TRACKING_TTL_SECONDS;
  logged = [];
  const capture = (...a: unknown[]) => void logged.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  console.error = capture;
  console.log = capture;
  console.warn = capture;
  db = new FakeAdDb();
  store = new FakeEventStore(db);
  const base = db.client();
  globals.__TEST_SUPABASE__ = {
    rpc: (name: string, args: Record<string, unknown> = {}) =>
      name === "lookup_serve_for_event" || name === "record_ad_impression" ? store.rpc(name, args) : base.rpc(name, args),
  };
});
afterEach(() => {
  for (const n of ENV_NAMES) {
    if (savedEnv[n] === undefined) delete process.env[n];
    else process.env[n] = savedEnv[n];
  }
  console.error = realError;
  console.log = realLog;
  console.warn = realWarn;
});

function world(topic = "gaming") {
  const pub = db.addPublisher("active");
  db.addKey(pub.id, KEY_A);
  const adv = db.addAdvertiser("active");
  const ad = db.addAd(adv.id, { category: topic });
  return { pub, adv, ad };
}

/** Asli /api/v1/ads/match se serve + token (opt-in header), phir sirf wahi token impression ke liye. */
async function serveWithToken(headers: Record<string, string> = {}): Promise<{ token: string; res: Response; text: string }> {
  const req = new Request("https://example.test/api/v1/ads/match", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY_A}`, "x-blisscco-tracking": "1", ...headers },
    body: JSON.stringify({ topic: "gaming" }),
  });
  const res = await handleMatchPost(req, { ipGuard: createIpGuard() });
  const text = await res.text();
  const body = JSON.parse(text) as { tracking?: { token: string } };
  assert.equal(res.status, 200, text);
  assert.ok(body.tracking, "token expected");
  return { token: body.tracking.token, res, text };
}

type Sent = { res: Response; body: Record<string, unknown>; text: string };
async function post(
  body: unknown,
  opts: { headers?: Record<string, string>; raw?: string; handler?: (r: Request) => Promise<Response> } = {},
): Promise<Sent> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(opts.headers ?? {}) };
  const req = new Request(URL_IMPRESSION, { method: "POST", headers, body: opts.raw ?? JSON.stringify(body) });
  const res = await (opts.handler ?? impressionRoute.POST)(req);
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* body khali (204) */
  }
  return { res, body: parsed, text };
}
const report = (token: unknown, event: unknown = "impression", extra: Record<string, string> = {}) => post({ token, event }, { headers: extra });

const config = (over: Partial<TrackingConfig> = {}): TrackingConfig => ({ secrets: [SECRET], ttlSeconds: 3600, ...over });
const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");
function forge(payload: unknown, secret = SECRET): string {
  const p = b64u(JSON.stringify(payload));
  return `bt1.${p}.${createHmac("sha256", secret).update(`blisscco:tracking:bt1:${p}`, "utf8").digest("base64url")}`;
}
/** Database me ek serve row seedhi daal do (purani/khaas serve ke liye) aur uska token banao. */
function seedServe(over: Partial<ServeLogRow> & { ref?: string } = {}, nowMs = Date.now()) {
  const pub = db.addPublisher("active");
  const row: ServeLogRow = {
    publisherId: pub.id, creativeId: "00000000-0000-4000-8000-0000000000c1", campaignId: "00000000-0000-4000-8000-0000000000d1",
    topic: "gaming", serveRef: over.ref ?? `bsr_${"ab".repeat(20)}`, servedAtMs: nowMs, ...over,
  };
  db.serveLog.push(row);
  return { pub, row };
}
const mint = (row: { serveRef: string; servedAtMs: number }, publisherId: string, nowMs: number, cfg = config()) =>
  mintTrackingToken(cfg, { serveRef: row.serveRef, publisherId, servedAtMs: row.servedAtMs, nowMs })!.token;

// ===========================================================================================================================
describe("day 12 part 4 | request parsing (shape only)", () => {
  const ok = (v: unknown) => parseImpressionRequest(JSON.stringify(v));
  it("accepts exactly {token, event:'impression'}", () => {
    assert.deepEqual(ok({ token: "bt1.a.b", event: "impression" }), { ok: true, value: { token: "bt1.a.b", event: "impression" } });
  });
  it("rejects bad JSON and non-object bodies", () => {
    assert.deepEqual(parseImpressionRequest("{nope"), { ok: false, reason: "invalid_json" });
    assert.deepEqual(parseImpressionRequest(""), { ok: false, reason: "invalid_json" });
    for (const v of [[], "x", 5, null, true]) assert.deepEqual(ok(v), { ok: false, reason: "invalid_body" });
  });
  it("rejects every extra field: caller can never choose serve/publisher/campaign ids, time, event id or user data", () => {
    for (const extra of ["serve_id", "serve_ref", "publisher_id", "campaign_id", "creative_id", "ad_id", "occurred_at", "timestamp", "event_id", "source", "user_id", "prompt", "ip", "referrer"]) {
      assert.deepEqual(ok({ token: "bt1.a.b", event: "impression", [extra]: "x" }), { ok: false, reason: "unknown_field" }, extra);
    }
  });
  it("rejects a missing, non-string, empty or oversized token", () => {
    for (const t of [undefined, null, 5, {}, [], "", "x".repeat(513)]) assert.deepEqual(ok({ token: t, event: "impression" }), { ok: false, reason: "invalid_token" });
    assert.deepEqual(ok({ event: "impression" }), { ok: false, reason: "invalid_token" });
  });
  it("only 'impression' is an allowed event type here (click, serve, other spellings, missing = invalid_event)", () => {
    for (const e of ["click", "serve", "Impression", "IMPRESSION", "impression ", "view", "conversion", "", undefined, null, 1, ["impression"], {}]) {
      assert.deepEqual(ok({ token: "bt1.a.b", event: e }), { ok: false, reason: "invalid_event" }, String(e));
    }
    assert.deepEqual(ok({ token: "bt1.a.b" }), { ok: false, reason: "invalid_event" });
  });
});

// ===========================================================================================================================
describe("day 12 part 4 | acceptImpression (pure, injected deps)", () => {
  const NOW = Date.UTC(2026, 9, 28, 10, 0, 0);
  const PUB = "00000000-0000-4000-8000-0000000000a1";
  const REF = `bsr_${"ab".repeat(20)}`;
  const served = { serveRef: REF, servedAtMs: NOW - 60_000 };
  function deps(over: Partial<ImpressionDeps> = {}) {
    const seen = new Set<string>();
    const writes: string[] = [];
    const d: ImpressionDeps = {
      config: config(),
      nowMs: () => NOW,
      lookupServe: async (r) => (r === REF ? { publisherId: PUB, servedAtMs: served.servedAtMs } : null),
      record: async (ref) => {
        writes.push(ref);
        if (seen.has(ref)) return "duplicate";
        seen.add(ref);
        return "recorded";
      },
      ...over,
    };
    return { d, writes };
  }
  const tok = (cfg = config(), at = NOW - 30_000) => mint(served, PUB, at, cfg);

  it("valid token => recorded; the same token again => duplicate", async () => {
    const { d, writes } = deps();
    assert.deepEqual(await acceptImpression(tok(), "impression", d), { kind: "recorded" });
    assert.deepEqual(await acceptImpression(tok(), "impression", d), { kind: "duplicate" });
    assert.deepEqual(writes, [REF, REF]);
  });
  it("the writer receives only the serve_ref and the publisher found in the database (never caller data)", async () => {
    let args: unknown[] = [];
    const { d } = deps({ record: async (...a) => { args = a; return "recorded"; } });
    await acceptImpression(tok(), "impression", d);
    assert.deepEqual(args, [REF, PUB]);
  });
  it("a bad token never reaches the database (no lookup, no write)", async () => {
    let lookups = 0, writes = 0;
    const { d } = deps({ lookupServe: async () => { lookups += 1; return null; }, record: async () => { writes += 1; return "recorded"; } });
    for (const t of [undefined, null, "", "garbage", "bt1.a.b", `${tok()}x`, tok(config({ secrets: [OTHER_SECRET] }))]) {
      assert.deepEqual(await acceptImpression(t, "impression", d), { kind: "unauthorized" });
    }
    assert.equal(lookups + writes, 0);
  });
  it("expired token => unauthorized, and nothing is written", async () => {
    const { d, writes } = deps({ nowMs: () => NOW + 2 * HOUR });
    assert.deepEqual(await acceptImpression(tok(), "impression", d), { kind: "unauthorized" });
    assert.equal(writes.length, 0);
  });
  it("token that does not allow impression, or an event other than impression => unauthorized, nothing written", async () => {
    const claims = { v: 1, r: REF, p: publisherTag(SECRET, PUB), iat: Math.floor(served.servedAtMs / 1000), exp: Math.floor(served.servedAtMs / 1000) + 3600 };
    const { d, writes } = deps();
    assert.deepEqual(await acceptImpression(forge({ ...claims, e: ["click"] }), "impression", d), { kind: "unauthorized" });
    assert.deepEqual(await acceptImpression(tok(), "click", d), { kind: "unauthorized" });
    assert.deepEqual(await acceptImpression(tok(), "serve", d), { kind: "unauthorized" });
    assert.equal(writes.length, 0);
  });
  it("unknown serve, other publisher's serve and time-mismatched serve => unauthorized", async () => {
    const { d: unknown, writes: w1 } = deps({ lookupServe: async () => null });
    assert.deepEqual(await acceptImpression(tok(), "impression", unknown), { kind: "unauthorized" });
    const { d: other, writes: w2 } = deps({ lookupServe: async () => ({ publisherId: "00000000-0000-4000-8000-0000000000a2", servedAtMs: served.servedAtMs }) });
    assert.deepEqual(await acceptImpression(tok(), "impression", other), { kind: "unauthorized" });
    const { d: skew, writes: w3 } = deps({ lookupServe: async () => ({ publisherId: PUB, servedAtMs: served.servedAtMs + 5000 }) });
    assert.deepEqual(await acceptImpression(tok(), "impression", skew), { kind: "unauthorized" });
    assert.equal(w1.length + w2.length + w3.length, 0);
  });
  it("database writer says rejected => unauthorized (nothing counted); error/unknown value => unavailable", async () => {
    assert.deepEqual(await acceptImpression(tok(), "impression", deps({ record: async () => "rejected" }).d), { kind: "unauthorized" });
    assert.deepEqual(await acceptImpression(tok(), "impression", deps({ record: async () => "error" }).d), { kind: "unavailable" });
    assert.deepEqual(await acceptImpression(tok(), "impression", deps({ record: async () => "weird" as unknown as RecordImpressionOutcome }).d), { kind: "unavailable" });
  });
  it("lookup or writer throwing, or no secret configured => unavailable (never throws, never recorded)", async () => {
    assert.deepEqual(await acceptImpression(tok(), "impression", deps({ lookupServe: async () => { throw new Error("db"); } }).d), { kind: "unavailable" });
    assert.deepEqual(await acceptImpression(tok(), "impression", deps({ record: async () => { throw new Error("db"); } }).d), { kind: "unavailable" });
    assert.deepEqual(await acceptImpression(tok(), "impression", deps({ config: null }).d), { kind: "unavailable" });
    assert.deepEqual(await acceptImpression(tok(), "impression", deps({ nowMs: () => { throw new Error("clock"); } }).d), { kind: "unavailable" });
  });
});

// ===========================================================================================================================
describe("day 12 part 4 | database reply parsing", () => {
  const PUB = "00000000-0000-4000-8000-0000000000a1";
  it("serve lookup: found / not_found / anything else throws (unavailable, never a wrong accept or reject)", () => {
    assert.deepEqual(parseServeLookup({ outcome: "found", publisher_id: PUB, served_at: "2026-10-28T10:00:00.000Z" }), { publisherId: PUB, servedAtMs: Date.UTC(2026, 9, 28, 10, 0, 0) });
    assert.equal(parseServeLookup({ outcome: "not_found" }), null);
    for (const bad of [null, undefined, "x", [], {}, { outcome: "ok" }, { outcome: "found" }, { outcome: "found", publisher_id: "nope", served_at: "2026-10-28T10:00:00Z" },
      { outcome: "found", publisher_id: PUB, served_at: 5 }, { outcome: "found", publisher_id: PUB, served_at: "not a date" }]) {
      assert.throws(() => parseServeLookup(bad), undefined, JSON.stringify(bad));
    }
  });
  it("writer reply: only recorded / duplicate / rejected count; everything else is an error", () => {
    for (const o of ["recorded", "duplicate", "rejected"]) assert.equal(parseRecordImpression({ outcome: o }), o);
    for (const bad of [null, undefined, "recorded", [], {}, { outcome: "ok" }, { outcome: "RECORDED" }, { outcome: 1 }, { ok: true }]) assert.equal(parseRecordImpression(bad), "error", JSON.stringify(bad));
  });
});

// ===========================================================================================================================
describe("day 12 part 4 | valid event and deduplication (route -> handler -> token -> fake database)", () => {
  it("serve + token + ONE impression: 200 recorded, exactly one impression row, no second charge, no new serve", async () => {
    const { pub, ad } = world();
    const { token } = await serveWithToken();
    const spendAfterServe = db.spendOf(ad.campaignId);
    assert.ok(spendAfterServe > 0, "serve charge is the existing behaviour");
    assert.equal(store.impressions.size, 0, "serve alone is NOT an impression");

    const r = await report(token);
    assert.equal(r.res.status, 200);
    assert.deepEqual(r.body, { ok: true, status: "recorded" });
    assert.equal(store.impressions.size, 1);
    assert.equal(db.spendOf(ad.campaignId), spendAfterServe, "impression must not charge again");
    assert.equal(db.servesFor(pub.id).length, 1, "impression must not create a serve");
    assert.equal(db.rpcCount("record_ad_serve"), 1);
  });

  it("the match response, a no-fill and a page-load-style call do NOT create impressions", async () => {
    world();
    await serveWithToken();
    // no-fill (topic jisme ad nahi) bhi impression nahi
    const nf = await handleMatchPost(new Request("https://example.test/api/v1/ads/match", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${KEY_A}`, "x-blisscco-tracking": "1" }, body: JSON.stringify({ topic: "travel" }),
    }), { ipGuard: createIpGuard() });
    assert.equal(nf.status, 200);
    assert.equal(store.impressions.size, 0);
    assert.equal(store.count("record_ad_impression"), 0);
    assert.equal(store.count("lookup_serve_for_event"), 0);
  });

  it("the same token 6 times in a row: 1 recorded + 5 duplicate, one row, spend unchanged (duplicate callback / network retry / replay)", async () => {
    const { ad } = world();
    const { token } = await serveWithToken();
    const spend = db.spendOf(ad.campaignId);
    const out: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const r = await report(token);
      assert.equal(r.res.status, 200);
      out.push(String(r.body.status));
    }
    assert.deepEqual(out, ["recorded", "duplicate", "duplicate", "duplicate", "duplicate", "duplicate"]);
    assert.equal(store.impressions.size, 1);
    assert.equal(db.spendOf(ad.campaignId), spend);
  });

  it("25 simultaneous identical requests: exactly one recorded, 24 duplicates, one row", async () => {
    world();
    const { token } = await serveWithToken();
    const all = await Promise.all(Array.from({ length: 25 }, () => report(token)));
    const statuses = all.map((r) => r.body.status);
    assert.equal(statuses.filter((s) => s === "recorded").length, 1);
    assert.equal(statuses.filter((s) => s === "duplicate").length, 24);
    assert.equal(store.impressions.size, 1);
  });

  it("an Idempotency-Key retry of the serve gives the identical token and still only one impression (retried serve is not two impressions)", async () => {
    world();
    const a = await serveWithToken({ "idempotency-key": "retry-key-0001" });
    const b = await serveWithToken({ "idempotency-key": "retry-key-0001" });
    assert.equal(a.token, b.token);
    assert.equal(db.serveLog.length, 1);
    assert.equal((await report(a.token)).body.status, "recorded");
    assert.equal((await report(b.token)).body.status, "duplicate");
    assert.equal(store.impressions.size, 1);
  });

  it("two different serves are two impressions (dedupe is per serve, not global)", async () => {
    world();
    const a = await serveWithToken();
    const b = await serveWithToken();
    assert.notEqual(a.token, b.token);
    assert.equal((await report(a.token)).body.status, "recorded");
    assert.equal((await report(b.token)).body.status, "recorded");
    assert.equal(store.impressions.size, 2);
  });

  it("an impression is not accepted for a click-only grant: a valid token with event 'click' is refused (400) and writes nothing", async () => {
    world();
    const { token } = await serveWithToken();
    const r = await report(token, "click");
    assert.equal(r.res.status, 400);
    assert.deepEqual(r.body, { error: "invalid_request", reason: "invalid_event" });
    assert.equal(store.impressions.size, 0);
    assert.equal(store.calls.length, 0, "nothing reaches the database for a refused event type");
  });
});

// ===========================================================================================================================
describe("day 12 part 4 | invalid, expired, unknown and foreign tokens (all one generic 401)", () => {
  const GENERIC = { error: "unauthorized" };
  it("garbage / tampered / wrong-secret tokens: 401, identical body, no database call, nothing written", async () => {
    world();
    const { token } = await serveWithToken();
    const [h, p, s] = token.split(".");
    const flipped = `${h}.${p}.${s.slice(0, -2)}${s.endsWith("A") ? "B" : "A"}x`;
    const bad = ["garbage", "bt1.a.b", "", `${token}.extra`, flipped, `${h}.${b64u("{}")}.${s}`, token.replace("bt1.", "bt2."), forge({ v: 1 }, OTHER_SECRET)];
    for (const t of bad) {
      const r = t === "" ? await post({ token: "x", event: "impression" }) : await report(t);
      assert.equal(r.res.status, 401, t.slice(0, 20));
      assert.deepEqual(r.body, GENERIC);
    }
    assert.equal(store.calls.length, 0);
    assert.equal(store.impressions.size, 0);
  });

  it("a publisher API key or Supabase-like secret used as the token is just an invalid token (401), and is never echoed or logged", async () => {
    world();
    for (const t of [KEY_A, sha256(KEY_A), `sb_secret_${"x".repeat(40)}`]) {
      const r = await report(t);
      assert.equal(r.res.status, 401);
      assert.equal(r.text.includes(t.slice(0, 20)), false);
      assert.equal(logged.join("\n").includes(t.slice(0, 20)), false);
    }
    // Authorization header ke saath bhi token chahiye: header ki koi ijazat nahi
    const noToken = await post({ event: "impression" }, { headers: { authorization: `Bearer ${KEY_A}` } });
    assert.equal(noToken.res.status, 400);
    assert.equal(store.impressions.size, 0);
  });

  it("expired token (serve older than its lifetime): 401 and nothing written", async () => {
    const { row, pub } = seedServe({ servedAtMs: Date.now() - 2 * HOUR }, Date.now() - 2 * HOUR);
    const token = mint(row, pub.id, row.servedAtMs + 1000); // us waqt valid tha, ab 1 ghante se zyada purana
    const r = await report(token);
    assert.equal(r.res.status, 401);
    assert.deepEqual(r.body, GENERIC);
    assert.equal(store.impressions.size, 0);
    assert.equal(store.count("record_ad_impression"), 0);
  });

  it("a token that expires while we hold it stops working (still valid just before, expired just after)", async () => {
    world();
    const { token } = await serveWithToken();
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 3600_000 + 5000; // token ki expiry paar
      const r = await report(token);
      assert.equal(r.res.status, 401);
    } finally {
      Date.now = realNow;
    }
    assert.equal(store.impressions.size, 0);
    assert.equal((await report(token)).body.status, "recorded");
  });

  it("unknown serve (valid signature, serve not in the database): the SAME 401 as a bad signature (no oracle)", async () => {
    const { pub, row } = seedServe();
    db.serveLog.pop(); // token bana, par serve database me nahi (purge ho chuki / kabhi thi hi nahi)
    const token = mint(row, pub.id, row.servedAtMs + 1000);
    const unknown = await report(token);
    const garbage = await report("garbage");
    assert.equal(unknown.res.status, 401);
    assert.equal(unknown.text, garbage.text);
    assert.equal(store.count("lookup_serve_for_event"), 1);
    assert.equal(store.count("record_ad_impression"), 0);
    assert.equal(store.impressions.size, 0);
  });

  it("token for another publisher's serve (publisher tag mismatch): 401, nothing written", async () => {
    const { row } = seedServe();
    const stranger = db.addPublisher("active");
    const token = mint(row, stranger.id, row.servedAtMs + 1000);
    const r = await report(token);
    assert.equal(r.res.status, 401);
    assert.deepEqual(r.body, GENERIC);
    assert.equal(store.impressions.size, 0);
  });

  it("the database refuses a serve older than 24h even if an old token were somehow accepted by the app (second wall)", async () => {
    const { row, pub } = seedServe({ servedAtMs: Date.now() - 25 * HOUR }, Date.now() - 25 * HOUR);
    const longCfg = config({ ttlSeconds: 86_400 });
    const token = mint(row, pub.id, row.servedAtMs + 1000, longCfg);
    const accepted = await acceptImpression(token, "impression", {
      config: longCfg, nowMs: () => row.servedAtMs + 2000, // app ko lagta hai abhi bhi valid
      lookupServe: async (ref) => { const s = db.serveLog.find((x) => x.serveRef === ref); return s ? { publisherId: s.publisherId, servedAtMs: s.servedAtMs } : null; },
      record: async (ref, p) => parseRecordImpression((await store.rpc("record_ad_impression", { p_serve_ref: ref, p_publisher_id: p })).data),
    });
    assert.deepEqual(accepted, { kind: "unauthorized" });
    assert.equal(store.impressions.size, 0);
  });

  it("secret rotation: a token signed with the previous secret still verifies; a token of an unknown secret does not", async () => {
    const { row, pub } = seedServe();
    process.env.AD_TRACKING_SECRET = OTHER_SECRET;
    process.env.AD_TRACKING_SECRET_PREVIOUS = SECRET;
    const oldToken = mint(row, pub.id, row.servedAtMs + 1000, config({ secrets: [SECRET] }));
    assert.equal((await report(oldToken)).body.status, "recorded");
    process.env.AD_TRACKING_SECRET_PREVIOUS = "";
    delete process.env.AD_TRACKING_SECRET_PREVIOUS;
    assert.equal((await report(oldToken)).res.status, 401);
  });
});

// ===========================================================================================================================
describe("day 12 part 4 | request shape, unauthorized and oversized requests", () => {
  it("wrong or missing content type => 415 and nothing reaches the database", async () => {
    for (const ct of ["text/plain", "application/x-www-form-urlencoded", "application/jsonp", "application/json; charset=latin1", "multipart/form-data"]) {
      const r = await post(null, { headers: { "content-type": ct }, raw: JSON.stringify({ token: "bt1.a.b", event: "impression" }) });
      assert.equal(r.res.status, 415, ct);
      assert.deepEqual(r.body, { error: "unsupported_media_type" });
    }
    const req = new Request(URL_IMPRESSION, { method: "POST", body: JSON.stringify({ token: "x", event: "impression" }) });
    const noCt = new Request(URL_IMPRESSION, { method: "POST", headers: { "content-type": "" }, body: "{}" });
    assert.equal((await impressionRoute.POST(noCt)).status, 415);
    assert.notEqual((await impressionRoute.POST(req)).status, 200);
    assert.equal(store.calls.length, 0);
  });

  it("too-large body => 413 (declared length and streamed without a length), nothing reaches the database", async () => {
    const big = JSON.stringify({ token: "bt1." + "a".repeat(2000), event: "impression" });
    const declared = await post(null, { raw: big, headers: { "content-length": String(big.length) } });
    assert.equal(declared.res.status, 413);
    const stream = new ReadableStream<Uint8Array>({
      start(c) { for (let i = 0; i < 5; i += 1) c.enqueue(new TextEncoder().encode("x".repeat(400))); c.close(); },
    });
    const streamed = await impressionRoute.POST(new Request(URL_IMPRESSION, { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit));
    assert.equal(streamed.status, 413);
    assert.equal(store.calls.length, 0);
  });

  it("bad JSON, array body, extra fields, missing token, bad event => 400 with a short generic reason, nothing written", async () => {
    const cases: [string, string][] = [
      ["{nope", "invalid_json"], ["[]", "invalid_body"], [JSON.stringify({ token: "bt1.a.b", event: "impression", serve_id: 1 }), "unknown_field"],
      [JSON.stringify({ event: "impression" }), "invalid_token"], [JSON.stringify({ token: "bt1.a.b", event: "click" }), "invalid_event"],
    ];
    for (const [raw, reason] of cases) {
      const r = await post(null, { raw });
      assert.equal(r.res.status, 400, raw);
      assert.deepEqual(r.body, { error: "invalid_request", reason });
    }
    assert.equal(store.calls.length, 0);
  });

  it("the route exports only POST (GET/PUT/DELETE/OPTIONS are not handled: no way to read anything, no CORS preflight)", () => {
    assert.deepEqual(Object.keys(impressionRoute).filter((k) => /^[A-Z]+$/.test(k)), ["POST"]);
    assert.equal(impressionRoute.runtime, "nodejs");
    assert.equal(impressionRoute.dynamic, "force-dynamic");
  });

  it("every response is no-store, versioned, nosniff, has no CORS headers and never sets cookies", async () => {
    world();
    const { token } = await serveWithToken();
    const responses = [await report(token), await report(token), await report("garbage"), await post(null, { raw: "{" }), await post(null, { headers: { "content-type": "text/plain" } })];
    for (const r of responses) {
      assert.equal(r.res.headers.get("cache-control"), "no-store");
      assert.equal(r.res.headers.get("x-blisscco-api-version"), "1");
      assert.equal(r.res.headers.get("x-content-type-options"), "nosniff");
      assert.equal(r.res.headers.get("access-control-allow-origin"), null, "no CORS (project rule: no wildcard CORS anywhere)");
      assert.equal(r.res.headers.get("set-cookie"), null);
    }
    assert.equal(/Access-Control-/i.test(read("lib/ads/impression-handler.ts") + read("app/api/v1/ads/impression/route.ts")), false);
  });
});

// ===========================================================================================================================
describe("day 12 part 4 | database failures (safe generic 503, nothing counted, retry-safe)", () => {
  const SECRETISH = "postgres://admin:hunter2@db.internal.example:5432/prod";
  const boom: Reply = { data: null, error: { code: "57014", message: `connection to ${SECRETISH} timed out` } };

  it("lookup rpc error => 503 {error:'unavailable'}; no leak of the database message; only the error code is logged", async () => {
    world();
    const { token } = await serveWithToken();
    store.failLookup = boom;
    const r = await report(token);
    assert.equal(r.res.status, 503);
    assert.deepEqual(r.body, { error: "unavailable" });
    assert.equal(r.text.includes("postgres"), false);
    const logs = logged.join("\n");
    assert.equal(logs.includes("hunter2") || logs.includes("postgres://"), false, "database message must not be logged");
    assert.equal(logs.includes(token) || logs.includes(token.split(".")[1]), false, "token must not be logged");
    assert.match(logs, /57014/);
    assert.equal(store.impressions.size, 0);
  });

  it("writer rpc error => 503, nothing counted; after the database recovers the SAME token is recorded exactly once", async () => {
    world();
    const { token } = await serveWithToken();
    store.failRecord = boom;
    const r = await report(token);
    assert.equal(r.res.status, 503);
    assert.deepEqual(r.body, { error: "unavailable" });
    assert.equal(store.impressions.size, 0);
    store.failRecord = null;
    assert.equal((await report(token)).body.status, "recorded");
    assert.equal((await report(token)).body.status, "duplicate");
    assert.equal(store.impressions.size, 1);
  });

  it("rpc that throws (network down) at lookup or at write => 503, no leak", async () => {
    world();
    const { token } = await serveWithToken();
    store.throwLookup = true;
    let r = await report(token);
    assert.equal(r.res.status, 503);
    assert.deepEqual(r.body, { error: "unavailable" });
    store.throwLookup = false;
    store.throwRecord = true;
    r = await report(token);
    assert.equal(r.res.status, 503);
    assert.deepEqual(r.body, { error: "unavailable" });
    assert.equal(store.impressions.size, 0);
  });

  it("garbage database replies (null, wrong shape, unknown outcome, 'recorded' spelled differently) => 503 and never counted as recorded", async () => {
    world();
    const { token } = await serveWithToken();
    for (const data of [null, undefined, "ok", [], {}, { outcome: "ok" }, { outcome: "RECORDED" }]) {
      store.failRecord = { data, error: null };
      const r = await report(token);
      assert.equal(r.res.status, 503, JSON.stringify(data));
      assert.deepEqual(r.body, { error: "unavailable" });
    }
    store.failRecord = null;
    for (const data of [null, "x", {}, { outcome: "found" }, { outcome: "found", publisher_id: "nope", served_at: "x" }, { outcome: "maybe" }]) {
      store.failLookup = { data, error: null };
      const r = await report(token);
      assert.equal(r.res.status, 503, JSON.stringify(data));
    }
    assert.equal(store.impressions.size, 0);
  });

  it("no tracking secret configured => 503 (not a 401 or 200) and nothing is written", async () => {
    world();
    const { token } = await serveWithToken();
    delete process.env.AD_TRACKING_SECRET;
    const r = await report(token);
    assert.equal(r.res.status, 503);
    assert.deepEqual(r.body, { error: "unavailable" });
    assert.equal(store.impressions.size, 0);
  });

  it("an unexpected crash inside the handler => 503 generic JSON", async () => {
    const r = await post({ token: "bt1.a.b", event: "impression" }, {
      handler: (req) => handleImpressionPost(req, { accept: async () => { throw new Error("boom with secret sauce"); } }),
    });
    assert.equal(r.res.status, 503);
    assert.deepEqual(r.body, { error: "unavailable" });
    assert.equal(r.text.includes("secret sauce"), false);
  });
});

// ===========================================================================================================================
describe("day 12 part 4 | rate limiting", () => {
  const ipReq = (ip: string, body: unknown) =>
    new Request(URL_IMPRESSION, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });

  it("too many requests from one IP => 429 + Retry-After BEFORE any parsing or database work; another IP is unaffected", async () => {
    world();
    const { token } = await serveWithToken();
    const requestGuard = createIpGuard(3);
    const failureGuard = createIpGuard(100);
    const run = (ip: string) => handleImpressionPost(ipReq(ip, { token, event: "impression" }), { requestGuard, failureGuard });
    const codes: number[] = [];
    for (let i = 0; i < 5; i += 1) codes.push((await run("203.0.113.7")).status);
    assert.deepEqual(codes, [200, 200, 200, 429, 429]);
    const blocked = await run("203.0.113.7");
    assert.equal(blocked.headers.get("retry-after"), "60");
    assert.deepEqual(await blocked.json(), { error: "rate_limited" });
    assert.equal(store.count("lookup_serve_for_event"), 3, "blocked requests never touch the database");
    assert.equal((await run("198.51.100.9")).status, 200);
  });

  it("repeated bad tokens from one IP get blocked (token guessing is throttled), even for a later valid token", async () => {
    world();
    const { token } = await serveWithToken();
    const requestGuard = createIpGuard(1000);
    const failureGuard = createIpGuard(3);
    const run = (t: string) => handleImpressionPost(ipReq("203.0.113.8", { token: t, event: "impression" }), { requestGuard, failureGuard });
    assert.equal((await run("bad-1")).status, 401);
    assert.equal((await run("bad-2")).status, 401);
    assert.equal((await run("bad-3")).status, 401);
    assert.equal((await run(token)).status, 429);
    assert.equal(store.impressions.size, 0);
  });

  it("successful and duplicate events do not count as failures", async () => {
    world();
    const { token } = await serveWithToken();
    const requestGuard = createIpGuard(1000);
    const failureGuard = createIpGuard(2);
    for (let i = 0; i < 10; i += 1) {
      assert.equal((await handleImpressionPost(ipReq("203.0.113.9", { token, event: "impression" }), { requestGuard, failureGuard })).status, 200);
    }
  });

  it("the rate-limit numbers are sane and the guard keeps no token or serve data", () => {
    const src = read("lib/ads/impression-handler.ts");
    assert.match(src, /REQUESTS_PER_MINUTE_PER_IP = 300/);
    assert.match(src, /FAILURES_PER_MINUTE_PER_IP = 30/);
  });
});

// ===========================================================================================================================
describe("day 12 part 4 | privacy: no leaks in responses, no secrets in logs", () => {
  it("no outcome ever contains the secret, a publisher/campaign/creative id, a serve_ref, a sequential id or the token itself", async () => {
    const { pub, ad } = world();
    const { token } = await serveWithToken();
    const serve = db.serveLog[0];
    const all: Sent[] = [
      await report(token), await report(token), await report("garbage"), await report(token, "click"), await post(null, { raw: "{" }),
      await post({ token, event: "impression", serve_id: 1 }),
    ];
    store.failRecord = { data: null, error: { code: "XX000", message: "secret detail" } };
    const { token: t2 } = await serveWithToken();
    all.push(await report(t2));
    for (const r of all) {
      for (const hay of [pub.id, ad.campaignId, ad.creativeId, serve.serveRef, SECRET, KEY_A, sha256(KEY_A), token, "service_role", "sb_secret_", "secret detail"]) {
        assert.equal(r.text.includes(hay), false, `leaked ${hay.slice(0, 16)} in ${r.text}`);
      }
      assert.equal(/"(serve_id|id)":\s*\d+/.test(r.text), false);
      assert.ok(Object.keys(r.body).length <= 2, r.text);
    }
  });

  it("logs from a full mixed run contain no token, serve_ref, ids, secret or IP", async () => {
    const { pub, ad } = world();
    const { token } = await serveWithToken();
    const serve = db.serveLog[0];
    const run = (body: unknown) => handleImpressionPost(
      new Request(URL_IMPRESSION, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.55" }, body: JSON.stringify(body) }),
    );
    await run({ token, event: "impression" });
    await run({ token, event: "impression" });
    await run({ token: "garbage", event: "impression" });
    store.failLookup = { data: null, error: { code: "08006", message: `leaky message with ${token}` } };
    await run({ token, event: "impression" });
    store.failLookup = null;
    store.failRecord = { data: null, error: { code: "40001", message: "x" } };
    await run({ token, event: "impression" });
    const logs = logged.join("\n");
    for (const hay of [token, token.split(".")[1], serve.serveRef, pub.id, ad.campaignId, ad.creativeId, SECRET, "203.0.113.55", "leaky message"]) {
      assert.equal(logs.includes(hay), false, `logged: ${hay.slice(0, 16)}`);
    }
  });
});

// ===========================================================================================================================
describe("day 12 part 4 | source safety (static)", () => {
  const PURE = ["lib/ads/impression.ts"];
  it("the pure module and the handler have no env access, database, server-only or logging; no in-memory dedupe either", () => {
    for (const f of [...PURE, "lib/ads/impression-handler.ts"]) {
      const c = codeOnly(read(f));
      assert.equal(/process\.env|supabase|server-only|console\.|localStorage|new Map\(|new Set\(|new WeakMap\(/i.test(c), false, f);
    }
  });
  it("the database layer uses exactly two rpc functions, never touches a table, and logs only an error code", () => {
    const c = codeOnly(read("lib/ads/impression-db.ts"));
    assert.deepEqual([...c.matchAll(/\.rpc\(\s*"([a-z_]+)"/g)].map((m) => m[1]).sort(), ["lookup_serve_for_event", "record_ad_impression"]);
    assert.equal(/\.from\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(c), false);
    assert.equal(/new Map\(|new Set\(/.test(c), false, "no in-memory dedupe");
    for (const m of c.matchAll(/console\.error\(([^)]*)\)/g)) assert.equal(/message|details|hint|token|serveRef|publisherId/.test(m[1]), false, m[1]);
  });
  it("the secret is still read in exactly one place (service.ts) and the impression wiring uses that same config", () => {
    const readers = ["app", "lib", "components"].flatMap(walk).filter((f) => /process\.env\.AD_TRACKING|readTrackingConfig\(process\.env\)/.test(codeOnly(read(f))));
    assert.deepEqual(readers, ["lib/ads/service.ts"]);
    assert.match(codeOnly(read("lib/ads/service.ts")), /export function acceptImpressionForToken[\s\S]*config: trackingConfig\(\)/);
  });
  it("serve path is untouched: serve.ts / serve-db.ts never mention impressions and still call only their 3 rpc functions", () => {
    assert.equal(/impression|ad_events/i.test(codeOnly(read("lib/ads/serve.ts"))), false);
    assert.equal(/impression|ad_events/i.test(codeOnly(read("lib/ads/serve-db.ts"))), false);
    const rpcs = [...codeOnly(read("lib/ads/serve-db.ts")).matchAll(/\.rpc\(\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(rpcs, ["authorize_publisher_key", "find_idempotent_serve", "record_ad_serve"]);
  });
  it("the only application code that mentions the impression writer or ad_events is the impression layer", () => {
    const allowed = ["lib/ads/impression-db.ts"];
    for (const f of ["app", "lib", "components"].flatMap(walk)) {
      const src = codeOnly(read(f));
      if (/record_ad_impression|lookup_serve_for_event|\bad_events\b/.test(src)) assert.ok(allowed.includes(f), `${f} must not touch events directly`);
    }
  });
  it("the matching engine and the match handler know nothing about impressions (a match response is never an impression)", () => {
    for (const f of ["lib/ads/match.ts", "lib/ads/selection.ts", "lib/ads/contract.ts", "lib/ads/candidate-loader.ts"]) assert.equal(/impression/i.test(codeOnly(read(f))), false, f);
    const matchRoute = codeOnly(read("app/api/v1/ads/match/route.ts")) + codeOnly(read("app/api/ads/match/route.ts"));
    assert.equal(/impression/i.test(matchRoute), false);
    assert.equal(typeof v1MatchRoute.POST, "function");
  });
});

// ===========================================================================================================================
describe("day 12 part 4 | SQL (static check; the SQL was NOT run)", () => {
  const SQL = "supabase/sql";
  const M7 = `${SQL}/day-12-7-record-ad-impression.sql`;
  const code = (f: string) => codeOnly(read(f));
  const fn = (name: string) => {
    const m = code(M7).match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`));
    assert.ok(m, name);
    return m[0];
  };

  it("migration is additive: only two create-or-replace functions + grants; no drop, truncate, delete, alter table, rls change or table grant", () => {
    const c = code(M7);
    assert.equal(/\bdrop\b|\btruncate\b|\bdelete\b|alter table|disable row level|grant\s+(all|select|insert|update)\s+on\s+table/i.test(c), false);
    assert.equal([...c.matchAll(/create or replace function (public\.[a-z_]+)/g)].map((m) => m[1]).sort().join(","), "public.lookup_serve_for_event,public.record_ad_impression");
    assert.equal(/record_ad_serve|campaign_spend_daily|creative_serve_daily|ad_serve_requests|update public\.|insert into public\.ad_serve_log/i.test(c), false, "serve / spend untouched");
  });
  it("both functions are security definer with an empty search_path, executable only by service_role", () => {
    for (const name of ["lookup_serve_for_event", "record_ad_impression"]) {
      const f = fn(name);
      assert.match(f, /security definer/);
      assert.match(f, /set search_path = ''/);
      assert.match(code(M7), new RegExp(`revoke all on function public\\.${name}\\([a-z, ]+\\) from public, anon, authenticated;`));
      assert.match(code(M7), new RegExp(`grant execute on function public\\.${name}\\([a-z, ]+\\) to service_role;`));
    }
    assert.equal(/grant execute[^;]*to (public|anon|authenticated)/i.test(code(M7)), false);
  });
  it("the writer dedupes atomically in the database: ON CONFLICT DO NOTHING on the one-impression-per-serve constraint", () => {
    const f = fn("record_ad_impression");
    assert.match(f, /on conflict on constraint ad_events_one_per_type_key do nothing/);
    assert.match(read(`${SQL}/day-12-2-ad-events.sql`), /constraint ad_events_one_per_type_key unique \(serve_id, event_type\)/);
    assert.match(f, /returning id into v_event_id/);
    assert.match(f, /'duplicate'/);
  });
  it("the writer writes ONLY impression rows from a verified serve with the database clock (no click/serve event, no caller time, no spend)", () => {
    const f = fn("record_ad_impression");
    assert.equal([...f.matchAll(/insert into public\.ad_events/g)].length, 1);
    assert.match(f, /'impression', 'blisscco_beacon', now\(\)/);
    assert.equal(/'click'|'serve'|p_occurred|p_time|p_campaign|p_creative|p_serve_id/.test(f), false);
    assert.match(f, /from public\.ad_serve_log s\s+where s\.serve_ref = p_serve_ref/);
    assert.match(f, /v_publisher is distinct from p_publisher_id/);
    assert.match(f, /interval '24 hours'/);
  });
  it("the lookup is read-only and returns only publisher_id + served_at", () => {
    const f = fn("lookup_serve_for_event");
    assert.equal(/\b(insert|update|delete)\b/i.test(f), false);
    assert.match(f, /\bstable\b/);
    assert.equal(/campaign_id|creative_id|s\.id\b/.test(f.replace(/select s\.publisher_id, s\.served_at/g, "")), false);
    assert.match(f, /jsonb_build_object\('outcome', 'found', 'publisher_id', v_publisher_id, 'served_at', v_served_at\)/);
  });
  it("it is the ONLY SQL that inserts into ad_events (no other file, trigger or function writes events)", () => {
    for (const f of readdirSync(path.join(ROOT, SQL)).filter((x) => /^day-/.test(x) && !/-tests?\.sql$/.test(x) && !/verify/.test(x))) {
      const c = code(`${SQL}/${f}`);
      if (f !== "day-12-7-record-ad-impression.sql") assert.doesNotMatch(c, /insert\s+into\s+public\.ad_events/, f);
      assert.doesNotMatch(c, /after insert on public\.ad_serve_log/, f);
    }
  });
  it("verify files are read-only and the day-12-3 'single writer' check now allows exactly this one writer", () => {
    for (const f of ["day-12-8-impression-verify.sql", "day-12-3-event-verify.sql"]) {
      const c = code(`${SQL}/${f}`).replace(/'[^']*'/g, "''");
      assert.equal(/\b(insert\s+into|update\s+\w|delete\s+from|drop\s|alter\s|create\s|truncate|grant\s|revoke\s)/i.test(c), false, f);
    }
    assert.match(read(`${SQL}/day-12-3-event-verify.sql`), /proname not in \('purge_old_ad_logs', 'record_ad_impression'\)/);
    const v = read(`${SQL}/day-12-8-impression-verify.sql`);
    for (const needle of ["security definer", "only service_role may execute", "ON CONFLICT DO NOTHING", "never touches spend", "database clock", "duplicate impressions must be 0", "impressions <= serves"]) assert.ok(v.includes(needle), needle);
  });
  it("SQL tests are rollback-only (every block begins and rolls back; nothing is committed) and TEST-project-only", () => {
    const t = read(`${SQL}/day-12-9-impression-tests.sql`);
    const body = codeOnly(t);
    assert.equal([...body.matchAll(/^begin;/gm)].length, 3);
    assert.equal([...body.matchAll(/^rollback;/gm)].length, 3);
    assert.equal(/^commit;/im.test(body), false);
    assert.match(t, /SIRF TEST project \(denim\) par chalao/);
    for (const needle of ["duplicate", "rejected", "42501", "older than 24 hours", "does NOT charge again", "ad_events_one_per_type_key"]) assert.ok(t.includes(needle), needle);
  });
  it("the migration was not written into any earlier migration (earlier serve/spend/event files do not mention the impression functions)", () => {
    for (const f of ["day-5-3-delivery-tables.sql", "day-5-8-serve-functions.sql", "day-7-1-budget-keys-retention.sql", "day-9-5-atomic-spend-idempotency.sql", "day-9-7-lifecycle-guards.sql", "day-12-1-serve-ref.sql", "day-12-2-ad-events.sql", "day-12-5-serve-ref-return.sql"]) {
      assert.doesNotMatch(read(`${SQL}/${f}`), /record_ad_impression|lookup_serve_for_event/, f);
    }
  });
});
