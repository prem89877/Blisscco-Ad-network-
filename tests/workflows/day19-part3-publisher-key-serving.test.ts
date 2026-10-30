// Day 19 Part 3: publisher setup -> API key (create / rotate / revoke) -> authenticated POST /api/v1/ads/match -> serve / no-fill.
// SIRF nakli (in-memory) database: koi SQL nahi chalti, koi production database nahi. Asli keys-db.ts, serve-db.ts, service.ts, serve.ts,
// match-handler.ts aur v1 route chalte hain; sirf database client aur login/Next.js wale hisse nakli hain (publisher-flow-stubs).
import { db, hashOf, installDb, type Camp, type Creative } from "./publisher-flow-stubs";
import { setupPublisher } from "@/app/dashboard/account/actions";
import { createKey, revokeKey, rotateKey } from "@/app/dashboard/publisher/actions";
import { adminDecision } from "@/app/dashboard/admin/actions";
import * as v1Route from "@/app/api/v1/ads/match/route";
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");
const source = (f: string) => readFileSync(join(ROOT, f), "utf8");
const TODAY = new Date().toISOString().slice(0, 10);
const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const TOMORROW = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const idle = { status: "idle" } as never;

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}
type KeyState = { status: string; message?: string; newKey?: string };
async function run<T>(p: Promise<T>): Promise<{ state?: T; redirect?: string }> {
  try {
    return { state: await p };
  } catch (e) {
    const m = /^REDIRECT:(.*)$/.exec(e instanceof Error ? e.message : "");
    if (m) return { redirect: m[1] };
    throw e;
  }
}

// Har console output pakadte hain: plain key kabhi bhi kisi log me nahi aani chahiye.
const real = { error: console.error, log: console.log, warn: console.warn, info: console.info };
let logs: unknown[][] = [];
const issuedKeys = new Set<string>();
let ipCounter = 0;
beforeEach(() => {
  db.reset();
  installDb();
  logs = [];
  const sink = (...a: unknown[]) => void logs.push(a);
  console.error = sink;
  console.log = sink;
  console.warn = sink;
  console.info = sink;
});
afterEach(() => {
  Object.assign(console, real);
  // Har test ke baad: banai gayi har plain key ke liye, logs me wo kahin nahi.
  const text = JSON.stringify(logs);
  for (const k of issuedKeys) {
    assert.ok(!text.includes(k), "plaintext key leaked to a log");
    assert.ok(!text.includes(k.slice(9)), "key secret part leaked to a log");
  }
  // Database ko sirf hash gaya, plain key nahi.
  const rpcText = JSON.stringify(db.rpcCalls);
  for (const k of issuedKeys) assert.ok(!rpcText.includes(k), "plaintext key sent to the database");
  issuedKeys.clear();
});

const logsText = () => JSON.stringify(logs);

/* ------------------------------ helpers ------------------------------ */
async function activePublisher(): Promise<string> {
  const r = await run(setupPublisher(idle, form({ name: "My Bot", websiteUrl: "https://bot.example.com", category: "gaming" })));
  assert.equal(r.redirect, "/dashboard/publisher?setup=1");
  const id = db.publisher!.id;
  const a = await run(adminDecision(idle, form({ kind: "publisher", id, decision: "active" })));
  assert.equal((a.state as { status?: string }).status, "success");
  return id;
}
async function newKey(label = "Prod server", expiry = "90"): Promise<string> {
  const r = await run(createKey(idle, form({ label, expiry })));
  const s = r.state as KeyState;
  assert.equal(s.status, "success", JSON.stringify(s));
  assert.match(s.newKey ?? "", /^blc_live_[0-9a-f]{64}$/);
  issuedKeys.add(s.newKey!);
  return s.newKey!;
}
function addAd(over: { camp?: Partial<Camp>; cr?: Partial<Creative> } = {}): { campaignId: string; creativeId: string } {
  const campaignId = db.id();
  const creativeId = db.id();
  db.campaigns.push({
    id: campaignId, status: "active", category: "gaming", startDate: "2020-01-01", endDate: null, totalBudget: 100, dailyBudget: null,
    spentTotal: 0, spentToday: 0, ...over.camp,
  });
  db.creatives.push({
    id: creativeId, campaignId, status: "approved", headline: "Visible headline", body: "Body text", ctaText: "Play",
    destinationUrl: "https://games.example.com/x", ...over.cr,
  });
  return { campaignId, creativeId };
}
async function match(key: string | null, over: { body?: string; headers?: Record<string, string>; ip?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": over.ip ?? `10.19.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`,
    ...(key === null ? {} : { authorization: `Bearer ${key}` }),
    ...over.headers,
  };
  return v1Route.POST(new Request("https://blisscco.test/api/v1/ads/match", { method: "POST", headers, body: over.body ?? '{"topic":"gaming"}' }));
}
const rpcNames = () => db.rpcCalls.map((c) => c.name);
const noServeCalls = () => !rpcNames().some((n) => n === "load_ad_candidates" || n === "record_ad_serve");

/* ===========================================================================================
 * 1. Publisher setup + key creation
 * ========================================================================================= */
describe("day 19 part 3: publisher setup and key creation", () => {
  it("setup makes a PENDING publisher for the logged-in user (status / profile_id from the form are ignored)", async () => {
    const r = await run(setupPublisher(idle, form({ name: "My Bot", websiteUrl: "https://bot.example.com", category: "gaming", status: "active", profile_id: "someone-else" })));
    assert.equal(r.redirect, "/dashboard/publisher?setup=1");
    assert.equal(db.inserts[0].payload.profile_id, "user-pub-1");
    assert.ok(!("status" in db.inserts[0].payload));
    assert.equal(db.publisher!.status, "pending");
  });

  it("a pending publisher cannot create a key; nothing reaches the database", async () => {
    await run(setupPublisher(idle, form({ name: "My Bot", websiteUrl: "", category: "gaming" })));
    const r = await run(createKey(idle, form({ label: "x", expiry: "90" })));
    assert.equal((r.state as KeyState).status, "error");
    assert.match((r.state as KeyState).message ?? "", /not approved yet/);
    assert.equal(db.rpcCalls.length, 0);
    assert.equal(db.keys.length, 0);
  });

  it("no publisher row: clear message and no key", async () => {
    const r = await run(createKey(idle, form({ label: "x", expiry: "90" })));
    assert.match((r.state as KeyState).message ?? "", /set up your platform/i);
    assert.equal(db.rpcCalls.length, 0);
  });

  it("an approved publisher gets a key shown ONCE; only its hash / prefix / last-4 hint are stored", async () => {
    const pubId = await activePublisher();
    db.rpcCalls = [];
    const key = await newKey("  Prod   server ");
    assert.equal(db.keys.length, 1);
    const row = db.keys[0];
    assert.equal(row.publisherId, pubId);
    assert.equal(row.hash, hashOf(key));
    assert.equal(row.prefix, key.slice(0, 13));
    assert.equal(row.hint, key.slice(-4));
    assert.equal(row.label, "Prod server");
    assert.ok(row.expiresAt && new Date(row.expiresAt) > new Date());
    assert.ok(!JSON.stringify(db.keys).includes(key), "plain key is never stored");
    assert.deepEqual(db.rpcCalls.map((c) => c.name), ["issue_publisher_key_for"]);
    assert.ok(db.revalidated.includes("/dashboard/publisher"));
  });

  it("the publisher id comes from login, never the form; forged ids are ignored", async () => {
    const pubId = await activePublisher();
    const fd = form({ label: "x", expiry: "30", publisherId: "pub-forged", publisher_id: "pub-forged" });
    const r = await run(createKey(idle, fd));
    assert.equal((r.state as KeyState).status, "success");
    issuedKeys.add((r.state as KeyState).newKey!);
    assert.equal(db.rpcCalls.at(-1)!.args.p_publisher_id, pubId);
  });

  it("each key is different and random (no repeats)", async () => {
    await activePublisher();
    const keys = new Set<string>();
    for (let i = 0; i < 4; i++) keys.add(await newKey(`k${i}`));
    assert.equal(keys.size, 4);
  });

  it("bad label / bad expiry are refused before the database", async () => {
    await activePublisher();
    db.rpcCalls = [];
    for (const f of [{ label: "bad\u202elabel", expiry: "90" }, { label: "x".repeat(61), expiry: "90" }, { label: "ok", expiry: "7" }, { label: "ok", expiry: "" }, { label: "ok" }]) {
      const r = await run(createKey(idle, form(f as Record<string, string>)));
      assert.equal((r.state as KeyState).status, "error", JSON.stringify(f));
    }
    assert.equal(db.rpcCalls.length, 0);
  });

  it("the 5-active-key limit and daily limit show clear messages and never leak raw errors", async () => {
    await activePublisher();
    for (let i = 0; i < 5; i++) await newKey(`k${i}`);
    const sixth = await run(createKey(idle, form({ label: "k6", expiry: "90" })));
    assert.equal((sixth.state as KeyState).message, "You already have 5 active keys. Revoke an old key first.");
    assert.equal((sixth.state as KeyState).newKey, undefined);
    assert.equal(db.keys.length, 5);
    db.keys[0].status = "revoked";
    db.issueDailyLimit = true;
    const daily = await run(createKey(idle, form({ label: "k7", expiry: "90" })));
    assert.match((daily.state as KeyState).message ?? "", /too many keys today/);
  });

  it("database failure while creating: generic message, only the error CODE is logged, no key in the answer", async () => {
    await activePublisher();
    db.rpcFail = { name: "issue_publisher_key_for", error: { code: "XX000", message: "SECRET internal detail" } };
    const r = await run(createKey(idle, form({ label: "x", expiry: "90" })));
    assert.equal((r.state as KeyState).message, "We could not create the key. Please try again.");
    assert.equal((r.state as KeyState).newKey, undefined);
    assert.ok(!logsText().includes("SECRET"));
    assert.ok(logsText().includes("XX000"));
  });

  it("role check is kept: wrong role / logged out never reaches the database", async () => {
    await activePublisher();
    db.rpcCalls = [];
    db.roleFails = true;
    assert.equal((await run(createKey(idle, form({ label: "x", expiry: "90" })))).redirect, "/login");
    assert.equal((await run(rotateKey(idle, form({ rotateKeyId: db.id(), expiry: "90" })))).redirect, "/login");
    assert.equal((await run(revokeKey(idle, form({ keyId: db.id() })))).redirect, "/login");
    assert.equal(db.rpcCalls.length, 0);
  });
});

/* ===========================================================================================
 * 2. Rotation and revocation
 * ========================================================================================= */
describe("day 19 part 3: key rotation and revocation", () => {
  it("rotation makes a NEW key with the same label; the old key keeps working until it is revoked (no downtime)", async () => {
    await activePublisher();
    addAd();
    const oldKey = await newKey("Prod");
    const oldId = db.keys[0].id;
    const r = await run(rotateKey(idle, form({ rotateKeyId: oldId, expiry: "365" })));
    const s = r.state as KeyState;
    assert.equal(s.status, "success");
    assert.match(s.newKey ?? "", /^blc_live_[0-9a-f]{64}$/);
    issuedKeys.add(s.newKey!);
    assert.notEqual(s.newKey, oldKey);
    assert.equal(db.keys.length, 2);
    assert.equal(db.keys[1].label, "Prod");
    assert.equal(db.keys[0].status, "active");
    assert.equal((await match(oldKey)).status, 200);
    assert.equal((await match(s.newKey!)).status, 200);
  });

  it("after the old key is revoked, only the new key serves", async () => {
    await activePublisher();
    addAd();
    const oldKey = await newKey("Prod");
    const oldId = db.keys[0].id;
    const newer = ((await run(rotateKey(idle, form({ rotateKeyId: oldId, expiry: "90" })))).state as KeyState).newKey!;
    issuedKeys.add(newer);
    const rev = await run(revokeKey(idle, form({ keyId: oldId })));
    assert.equal((rev.state as KeyState).message, "Key revoked. It stops working immediately.");
    const dead = await match(oldKey);
    assert.equal(dead.status, 401);
    assert.equal((await match(newer)).status, 200);
  });

  it("rotation of a revoked, expired, unknown or someone else's key is refused and creates nothing", async () => {
    const pubId = await activePublisher();
    await newKey("A");
    await newKey("B");
    await newKey("C");
    db.keys[0].status = "revoked";
    db.keys[1].expiresAt = new Date(Date.now() - 1000).toISOString();
    db.keys.push({ ...db.keys[2], id: db.id(), publisherId: "pub-other", hash: "f".repeat(64) });
    const before = db.keys.length;
    for (const id of [db.keys[0].id, db.keys[1].id, db.keys[3].id, db.id()]) {
      const r = await run(rotateKey(idle, form({ rotateKeyId: id, expiry: "90" })));
      assert.equal((r.state as KeyState).status, "error", id);
      assert.equal((r.state as KeyState).newKey, undefined, id);
    }
    assert.equal(db.keys.length, before);
    assert.ok(db.keys.every((k) => k.publisherId !== pubId || ["A", "B", "C"].includes(k.label ?? "")));
  });

  it("bad rotation input (not a uuid, bad expiry) never reaches the database", async () => {
    await activePublisher();
    await newKey("A");
    db.rpcCalls = [];
    for (const f of [{ rotateKeyId: "abc", expiry: "90" }, { rotateKeyId: "1; drop table", expiry: "90" }, { expiry: "90" }, { rotateKeyId: db.keys[0].id, expiry: "5" }]) {
      const r = await run(rotateKey(idle, form(f as Record<string, string>)));
      assert.equal((r.state as KeyState).status, "error", JSON.stringify(f));
    }
    assert.equal(db.rpcCalls.length, 0);
  });

  it("a pending / suspended publisher cannot rotate (needs an active account)", async () => {
    const pubId = await activePublisher();
    await newKey("A");
    const keyId = db.keys[0].id;
    db.publisher!.status = "suspended";
    const r = await run(rotateKey(idle, form({ rotateKeyId: keyId, expiry: "90" })));
    assert.match((r.state as KeyState).message ?? "", /not approved yet/);
    assert.equal(db.keys.length, 1);
    assert.ok(pubId);
  });

  it("revoke: own key works once; a second revoke, an unknown key and another publisher's key all fail safely", async () => {
    await activePublisher();
    await newKey("A");
    const keyId = db.keys[0].id;
    assert.equal(((await run(revokeKey(idle, form({ keyId })))).state as KeyState).status, "success");
    assert.equal(db.keys[0].status, "revoked");
    assert.match(((await run(revokeKey(idle, form({ keyId })))).state as KeyState).message ?? "", /could not be revoked/);
    db.keys.push({ ...db.keys[0], id: db.id(), publisherId: "pub-other", status: "active", hash: "e".repeat(64) });
    const other = db.keys[1];
    assert.match(((await run(revokeKey(idle, form({ keyId: other.id })))).state as KeyState).message ?? "", /could not be revoked/);
    assert.equal(other.status, "active", "someone else's key is untouched");
    for (const bad of ["abc", "", "x".repeat(40)]) {
      assert.equal(((await run(revokeKey(idle, form({ keyId: bad })))).state as KeyState).message, "Key not found.", bad);
    }
    const calls = db.rpcCalls.filter((c) => c.name === "revoke_publisher_key_for");
    assert.ok(calls.every((c) => c.args.p_publisher_id === db.publisher!.id), "publisher id always from login");
  });

  it("a suspended publisher can still revoke a leaked key (safety rule), and the key is dead immediately", async () => {
    await activePublisher();
    addAd();
    const key = await newKey("A");
    db.publisher!.status = "suspended";
    const r = await run(revokeKey(idle, form({ keyId: db.keys[0].id })));
    assert.equal((r.state as KeyState).status, "success");
    assert.equal((await match(key)).status, 401);
  });

  it("revoke database failure: safe message, only the error code is logged", async () => {
    await activePublisher();
    await newKey("A");
    db.rpcFail = { name: "revoke_publisher_key_for", error: { code: "57014", message: "SECRET detail" } };
    const r = await run(revokeKey(idle, form({ keyId: db.keys[0].id })));
    assert.match((r.state as KeyState).message ?? "", /could not be revoked/);
    assert.equal(db.keys[0].status, "active");
    assert.ok(!logsText().includes("SECRET"));
  });

  it("source check: the action file never logs or returns anything but the one-time newKey", () => {
    const src = source("app/dashboard/publisher/actions.ts").replace(/\/\/.*$/gm, "");
    assert.ok(!/console\./.test(src), "actions.ts has no logging at all");
    assert.equal((src.match(/newKey:/g) ?? []).length, 2, "newKey is returned only by create and rotate");
    const keysDb = source("lib/publisher/keys-db.ts").replace(/\/\/.*$/gm, "");
    assert.ok(!/console\.\w+\([^)]*(parts\.key|\bkey\b)/.test(keysDb), "keys-db never logs the key");
  });
});

/* ===========================================================================================
 * 3. Authenticated access to POST /api/v1/ads/match
 * ========================================================================================= */
describe("day 19 part 3: who may call POST /api/v1/ads/match", () => {
  it("an active publisher's key is accepted: 200, fill:true, version header, no-store, only the 5 public ad fields, no key echo", async () => {
    await activePublisher();
    const { creativeId } = addAd();
    const key = await newKey();
    db.rpcCalls = [];
    const res = await match(key);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-blisscco-api-version"), "1");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("vary"), "Authorization");
    const text = await res.text();
    const body = JSON.parse(text) as { fill: boolean; ad: Record<string, unknown> };
    assert.equal(body.fill, true);
    assert.equal(body.ad.id, creativeId);
    assert.deepEqual(Object.keys(body.ad).sort(), ["body", "cta_text", "destination_url", "headline", "id"].sort());
    assert.ok(!text.includes(key) && !text.includes(hashOf(key)));
    assert.ok(!/campaign|advertiser|budget|spent/i.test(text));
    assert.deepEqual(rpcNames().slice(-3), ["authorize_publisher_key", "load_ad_candidates", "record_ad_serve"]);
  });

  it("the key is sent to the database as a SHA-256 hash only", async () => {
    await activePublisher();
    addAd();
    const key = await newKey();
    db.rpcCalls = [];
    await match(key);
    assert.deepEqual(db.rpcCalls[0], { name: "authorize_publisher_key", args: { p_key_hash: hashOf(key) } });
  });

  it("missing / malformed Authorization headers: 401 + WWW-Authenticate, database never called", async () => {
    await activePublisher();
    addAd();
    const good = await newKey();
    db.rpcCalls = [];
    const bad: Array<string | null> = [null, "", "Bearer", "Bearer ", `Basic ${good}`, good, `Bearer ${good.toUpperCase()}`, `Bearer ${good}x`, `Bearer ${good.slice(0, -1)}`,
      `Bearer blc_test_${"a".repeat(64)}`, `Bearer ${good} extra`, "Bearer not-a-key"];
    for (const h of bad) {
      const res = await match(null, { headers: h === null ? {} : { authorization: h } });
      assert.equal(res.status, 401, String(h));
      assert.equal(res.headers.get("www-authenticate"), 'Bearer realm="blisscco-ads"', String(h));
      assert.deepEqual(await res.json(), { error: "unauthorized" }, String(h));
    }
    assert.equal(db.rpcCalls.length, 0);
  });

  it("a well-formed but unknown key: 401, same body as any other 401, no ad, no candidate loading", async () => {
    await activePublisher();
    addAd();
    db.rpcCalls = [];
    const res = await match(`blc_live_${"c".repeat(64)}`);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "unauthorized" });
    assert.deepEqual(rpcNames(), ["authorize_publisher_key"]);
  });

  it("revoked key: 401 (same answer as unknown, so nothing is revealed)", async () => {
    await activePublisher();
    addAd();
    const key = await newKey();
    assert.equal((await match(key)).status, 200);
    await run(revokeKey(idle, form({ keyId: db.keys[0].id })));
    db.rpcCalls = [];
    const res = await match(key);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "unauthorized" });
    assert.ok(noServeCalls());
  });

  it("expired key: 401", async () => {
    await activePublisher();
    addAd();
    const key = await newKey();
    db.keys[0].expiresAt = new Date(Date.now() - 1000).toISOString();
    assert.equal((await match(key)).status, 401);
  });

  it("pending and suspended publishers are rejected even with a valid key; reactivation works again", async () => {
    await activePublisher();
    addAd();
    const key = await newKey();
    for (const st of ["suspended", "pending"] as const) {
      db.publisher!.status = st;
      db.rpcCalls = [];
      const res = await match(key);
      assert.equal(res.status, 401, st);
      assert.ok(noServeCalls(), st);
    }
    const a = await run(adminDecision(idle, form({ kind: "publisher", id: db.publisher!.id, decision: "active" })));
    assert.equal((a.state as { status?: string }).status, "success");
    assert.equal((await match(key)).status, 200);
  });

  it("a suspended publisher PROFILE is rejected too", async () => {
    await activePublisher();
    addAd();
    const key = await newKey();
    db.profileStatus = "suspended";
    assert.equal((await match(key)).status, 401);
  });

  it("another publisher's key never works for this one: a key's hash only matches its own publisher", async () => {
    await activePublisher();
    addAd();
    const key = await newKey();
    db.keys[0].publisherId = "pub-someone-else";
    assert.equal((await match(key)).status, 401);
  });

  it("request shape is checked AFTER the key format but before the database: wrong media type 415, big body 413, bad JSON 400", async () => {
    await activePublisher();
    addAd();
    const key = await newKey();
    db.rpcCalls = [];
    assert.equal((await match(key, { headers: { "content-type": "text/plain" } })).status, 415);
    assert.equal((await match(key, { headers: { "content-type": "application/jsonp" } })).status, 415);
    assert.equal((await match(key, { body: `{"topic":"gaming","pad":"${"x".repeat(5000)}"}` })).status, 413);
    assert.equal((await match(key, { body: "{not json" })).status, 400);
    assert.equal((await match(key, { body: "[]" })).status, 400);
    assert.equal((await match(key, { headers: { "idempotency-key": "bad key!" } })).status, 400);
    assert.equal((await match(key, { headers: { "x-blisscco-tracking": "yes" } })).status, 400);
    assert.equal(db.rpcCalls.length, 0);
  });

  it("per-key rate limit: over the limit gives 429 + Retry-After and no ad; another key is unaffected", async () => {
    await activePublisher();
    addAd();
    db.rateLimit = 3;
    const a = await newKey("a");
    const b = await newKey("b");
    for (let i = 0; i < 3; i++) assert.equal((await match(a)).status, 200);
    const limited = await match(a);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "60");
    assert.deepEqual(await limited.json(), { error: "rate_limited" });
    assert.equal((await match(b)).status, 200);
  });

  it("many wrong keys from ONE IP are stopped with 429 before the database; other IPs are not affected", async () => {
    await activePublisher();
    addAd();
    const key = await newKey();
    const attacker = "203.0.113.77";
    for (let i = 0; i < 20; i++) await match(`blc_live_${String(i).padStart(2, "0").repeat(32)}`, { ip: attacker });
    db.rpcCalls = [];
    const blocked = await match(key, { ip: attacker });
    assert.equal(blocked.status, 429);
    assert.equal(db.rpcCalls.length, 0);
    assert.equal((await match(key, { ip: "203.0.113.78" })).status, 200);
  });

  it("database outage while authorizing: 503 JSON (never a raw error); only the error code is logged", async () => {
    await activePublisher();
    addAd();
    const key = await newKey();
    db.rpcFail = { name: "authorize_publisher_key", error: { code: "57014", message: "SECRET detail" } };
    const res = await match(key);
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { fill: false, error: "unavailable" });
    assert.ok(!logsText().includes("SECRET"));
  });

  it("the match handler and serve code contain no logging of keys / headers / bodies", () => {
    const handler = source("lib/ads/match-handler.ts").replace(/\/\/.*$/gm, "");
    assert.ok(!/console\./.test(handler));
    const keyLib = source("lib/ads/api-key.ts").replace(/\/\/.*$/gm, "");
    assert.ok(!/console\./.test(keyLib));
    const serve = source("lib/ads/serve.ts").replace(/\/\/.*$/gm, "");
    assert.ok(!/console\./.test(serve));
  });
});

/* ===========================================================================================
 * 4. Serving: approved ads serve, everything else is no-fill
 * ========================================================================================= */
describe("day 19 part 3: eligible ads serve, ineligible ads return no-fill", () => {
  async function setup() {
    await activePublisher();
    return newKey();
  }
  const noFill = async (res: Response) => {
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { fill: false });
  };

  it("approved creative + active campaign + active advertiser serves and spend goes up by exactly one impression", async () => {
    const key = await setup();
    const { campaignId } = addAd();
    const res = await match(key);
    assert.equal(((await res.json()) as { fill: boolean }).fill, true);
    assert.equal(db.serves.length, 1);
    assert.equal(db.campaigns.find((c) => c.id === campaignId)!.spentTotal, 0.002);
  });

  it("no ads at all, or a different category: no-fill (200)", async () => {
    const key = await setup();
    await noFill(await match(key));
    addAd({ camp: { category: "travel" } });
    await noFill(await match(key));
    assert.equal(db.serves.length, 0);
  });

  it("every non-approved creative status returns no-fill and nothing is recorded", async () => {
    const key = await setup();
    for (const st of ["draft", "pending_review", "rejected", "paused", "archived"]) {
      db.creatives = [];
      db.campaigns = [];
      addAd({ cr: { status: st } });
      await noFill(await match(key));
    }
    assert.equal(db.serves.length, 0);
    assert.ok(!rpcNames().includes("record_ad_serve"), "never even tried to record a serve");
  });

  it("every non-active campaign status (draft, pending_review, rejected, paused, completed, archived) returns no-fill", async () => {
    const key = await setup();
    for (const st of ["draft", "pending_review", "rejected", "paused", "completed", "archived"]) {
      db.creatives = [];
      db.campaigns = [];
      addAd({ camp: { status: st } });
      await noFill(await match(key));
    }
    assert.equal(db.serves.length, 0);
  });

  it("expired and not-yet-started campaigns return no-fill; one that ends today still serves", async () => {
    const key = await setup();
    addAd({ camp: { endDate: YESTERDAY } });
    await noFill(await match(key));
    db.creatives = [];
    db.campaigns = [];
    addAd({ camp: { startDate: TOMORROW } });
    await noFill(await match(key));
    db.creatives = [];
    db.campaigns = [];
    addAd({ camp: { startDate: TODAY, endDate: TODAY } });
    assert.equal(((await (await match(key)).json()) as { fill: boolean }).fill, true);
  });

  it("budget-ineligible ads return no-fill: total used up, daily used up, and just-below-one-impression left", async () => {
    const key = await setup();
    for (const camp of [{ totalBudget: 10, spentTotal: 10 }, { totalBudget: 10, spentTotal: 9.999 }, { dailyBudget: 1, spentToday: 1 }, { dailyBudget: 1, spentToday: 0.999 }]) {
      db.creatives = [];
      db.campaigns = [];
      addAd({ camp });
      await noFill(await match(key));
    }
    assert.equal(db.serves.length, 0);
  });

  it("the LAST impression that fits the budget serves, and the next request is no-fill (budget never overspent)", async () => {
    const key = await setup();
    const { campaignId } = addAd({ camp: { totalBudget: 0.004 } });
    assert.equal(((await (await match(key)).json()) as { fill: boolean }).fill, true);
    assert.equal(((await (await match(key)).json()) as { fill: boolean }).fill, true);
    await noFill(await match(key));
    const c = db.campaigns.find((x) => x.id === campaignId)!;
    assert.ok(c.spentTotal <= c.totalBudget + 1e-9);
    assert.equal(db.serves.length, 2);
  });

  it("suspended / pending ADVERTISER (or advertiser profile) returns no-fill even with approved ad + active campaign", async () => {
    const key = await setup();
    addAd();
    for (const st of ["pending", "suspended"] as const) {
      db.advertiserStatus = st;
      await noFill(await match(key));
    }
    db.advertiserStatus = "active";
    db.advertiserProfileStatus = "suspended";
    await noFill(await match(key));
    assert.equal(db.serves.length, 0);
  });

  it("ad status changes take effect on the very next request: approve -> serve, reject -> no-fill, approve again -> serve", async () => {
    const key = await setup();
    const { creativeId } = addAd({ cr: { status: "pending_review" } });
    await noFill(await match(key));
    db.creatives.find((c) => c.id === creativeId)!.status = "approved";
    assert.equal(((await (await match(key)).json()) as { fill: boolean }).fill, true);
    db.creatives.find((c) => c.id === creativeId)!.status = "rejected";
    await noFill(await match(key));
    db.creatives.find((c) => c.id === creativeId)!.status = "approved";
    assert.equal(((await (await match(key)).json()) as { fill: boolean }).fill, true);
  });

  it("if the candidate list is stale but the database re-check rejects the ad, the answer is no-fill (nothing charged)", async () => {
    const key = await setup();
    const { campaignId } = addAd();
    // load_ad_candidates ko abhi 'active' dikhta hai, par record_ad_serve tak campaign 'paused' ho chuka hai (race).
    const original = db.rpcCalls.length;
    const c = db.campaigns.find((x) => x.id === campaignId)!;
    const realLoadStatus = c.status;
    const base = baseRpc();
    (globalThis as unknown as { __TEST_SUPABASE__: unknown }).__TEST_SUPABASE__ = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        const out = await base(name, args);
        if (name === "load_ad_candidates") c.status = "paused";
        return out;
      },
    };
    await noFill(await match(key));
    c.status = realLoadStatus;
    assert.equal(db.serves.length, 0);
    assert.equal(c.spentTotal, 0);
    assert.ok(db.rpcCalls.length > original);
  });

  it("sensitive topics are no-fill with no candidate loading; unknown topic with no fallback is no-fill", async () => {
    const key = await setup();
    addAd();
    db.rpcCalls = [];
    await noFill(await match(key, { body: '{"topic":"health"}' }));
    await noFill(await match(key, { body: '{"topic":"totally_unknown_topic"}' }));
    assert.equal(db.serves.length, 0);
    assert.ok(!rpcNames().includes("record_ad_serve"));
  });

  it("the exclude list moves to another ad when there is one", async () => {
    const key = await setup();
    const first = addAd();
    const second = addAd();
    const res = await match(key, { body: JSON.stringify({ topic: "gaming", exclude_ad_ids: [first.creativeId] }) });
    assert.equal(((await res.json()) as { ad: { id: string } }).ad.id, second.creativeId);
  });

  it("the old /api/ads/match and the v1 endpoint share one handler (same protections, same rate-limit key)", () => {
    const v1 = source("app/api/v1/ads/match/route.ts");
    const legacy = source("app/api/ads/match/route.ts");
    assert.match(v1, /handleMatchPost/);
    assert.match(legacy, /handleMatchPost/);
  });
});

function baseRpc(): (name: string, args: Record<string, unknown>) => Promise<unknown> {
  const g = globalThis as unknown as { __TEST_SUPABASE__: { rpc: (n: string, a: Record<string, unknown>) => Promise<unknown> } };
  return g.__TEST_SUPABASE__.rpc;
}
