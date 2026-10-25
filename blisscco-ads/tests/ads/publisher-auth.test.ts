import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { hashApiKey } from "@/lib/ads/api-key";
import * as legacyRoute from "@/app/api/ads/match/route";
import * as v1Route from "@/app/api/v1/ads/match/route";

// Day 6 (Part 3): publisher API-key authentication ke audit ke baad ke tests.
// Maujooda tests (R9, R10, serve.test.ts, final-review) jo pehle se cover karte hain unhe dohraya nahi gaya.
// Yahan sirf wahi hai jo pehle nahi tha: runtime logs, har response me secret nahi, authorize ke naye bigde jawab,
// authorize ke BAAD key revoke, DB ko jaane wale arguments, aur SQL files ki static jaanch (SQL yahan chal nahi sakti).
// Database NAKLI hai (tests/register.cjs). Koi asli key nahi: neeche ki KEY sirf test ka dummy hai.

const ROOT = path.join(__dirname, "..", "..", "..");
const KEY = `blc_live_${"c".repeat(64)}`;
const HASH = hashApiKey(KEY);
const UUID_1 = "11111111-1111-4111-8111-111111111111";
const PUBLISHER_ID = "99999999-9999-4999-8999-999999999999";
const CAMPAIGN_ID = "33333333-3333-4333-8333-333333333333";
const AUTH_OK = { outcome: "ok", publisher_id: PUBLISHER_ID, publisher_status: "active", unit_cost_usd: 0.002 };

type Reply = { data: unknown; error: { code?: string; message?: string } | null } | (() => never);
type RpcCall = { name: string; args: Record<string, unknown> };

const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
let rpcCalls: RpcCall[] = [];
const rpcNames = () => rpcCalls.map((c) => c.name);

type Logged = { level: string; args: unknown[] };
let logged: Logged[] = [];
const LEVELS = ["error", "log", "warn", "info", "debug"] as const;
const realConsole: Record<string, (...a: unknown[]) => void> = {};

function candidateRow(): Record<string, unknown> {
  return {
    creative_id: UUID_1, headline: "Secret headline", body: "B", cta_text: null, destination_url: "https://example.com/x",
    creative_status: "approved", campaign_id: CAMPAIGN_ID, campaign_status: "active", category: "gaming",
    start_date: "2020-01-01", end_date: null, total_budget: 100, daily_budget: null, spent_total: 0, spent_today: 0,
    advertiser_status: "active", advertiser_profile_status: "active", campaign_serves_today: 0, creative_serves_today: 0,
  };
}

function setDb(over: Record<string, Reply> = {}) {
  const replies: Record<string, Reply> = {
    authorize_publisher_key: { data: AUTH_OK, error: null },
    load_ad_candidates: { data: [candidateRow()], error: null },
    record_ad_serve: { data: { outcome: "ok" }, error: null },
    ...over,
  };
  globals.__TEST_SUPABASE__ = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      const reply = replies[name];
      if (!reply) throw new Error(`test: unexpected rpc ${name}`);
      return typeof reply === "function" ? reply() : reply;
    },
  };
}

beforeEach(() => {
  rpcCalls = [];
  logged = [];
  for (const level of LEVELS) {
    realConsole[level] = console[level] as (...a: unknown[]) => void;
    (console as unknown as Record<string, (...a: unknown[]) => void>)[level] = (...args: unknown[]) => {
      logged.push({ level, args });
    };
  }
  setDb();
});
afterEach(() => {
  for (const level of LEVELS) (console as unknown as Record<string, (...a: unknown[]) => void>)[level] = realConsole[level];
  delete globals.__TEST_SUPABASE__;
});

function request(urlPath: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://blisscco.test${urlPath}`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", ...headers },
    body,
  });
}

const ROUTES: Array<[string, string, (r: Request) => Promise<Response>]> = [
  ["legacy /api/ads/match", "/api/ads/match", legacyRoute.POST],
  ["v1 /api/v1/ads/match", "/api/v1/ads/match", v1Route.POST],
];

async function fullText(res: Response): Promise<string> {
  const headers = Array.from(res.headers.entries()).map(([k, v]) => `${k}: ${v}`).join("\n");
  return `${headers}\n${await res.text()}`;
}

// ---------------------------------------------------------------------------
// 1. Key / hash / identity kisi bhi response ya log me nahi
// ---------------------------------------------------------------------------
type Scenario = {
  name: string;
  body: string;
  headers?: Record<string, string>;
  db?: Record<string, Reply>;
  noAdminClient?: boolean;
  status: number;
};

const LEAKY_ERROR = { code: "XX000", message: `connection failed key=${KEY} hash=${HASH} publisher=${PUBLISHER_ID}` };
const throwsLeaky = (): never => {
  throw new Error(`db down ${KEY} ${HASH} ${PUBLISHER_ID}`);
};

const SCENARIOS: Scenario[] = [
  { name: "ad found", body: '{"topic":"gaming"}', status: 200 },
  { name: "sensitive topic (no-fill)", body: '{"topic":"health"}', status: 200 },
  { name: "no eligible candidate", body: '{"topic":"gaming"}', db: { load_ad_candidates: { data: [], error: null } }, status: 200 },
  { name: "candidate load error (outage, 503)", body: '{"topic":"gaming"}', db: { load_ad_candidates: { data: null, error: LEAKY_ERROR } }, status: 503 },
  { name: "record rejected", body: '{"topic":"gaming"}', db: { record_ad_serve: { data: { outcome: "rejected" }, error: null } }, status: 200 },
  { name: "unknown field", body: '{"topic":"gaming","prompt":"my private chat"}', status: 400 },
  { name: "missing key", body: '{"topic":"gaming"}', headers: { authorization: "" }, status: 401 },
  { name: "database says unauthorized", body: '{"topic":"gaming"}', db: { authorize_publisher_key: { data: { outcome: "unauthorized" }, error: null } }, status: 401 },
  { name: "oversized body", body: JSON.stringify({ topic: "gaming", pad: "x".repeat(3000) }), status: 413 },
  { name: "wrong content-type", body: '{"topic":"gaming"}', headers: { "content-type": "text/plain" }, status: 415 },
  { name: "rate limited", body: '{"topic":"gaming"}', db: { authorize_publisher_key: { data: { outcome: "rate_limited" }, error: null } }, status: 429 },
  { name: "authorize rpc error (message contains secrets)", body: '{"topic":"gaming"}', db: { authorize_publisher_key: { data: null, error: LEAKY_ERROR } }, status: 503 },
  { name: "authorize rpc throws (message contains secrets)", body: '{"topic":"gaming"}', db: { authorize_publisher_key: throwsLeaky }, status: 503 },
  { name: "record rpc error", body: '{"topic":"gaming"}', db: { record_ad_serve: { data: null, error: LEAKY_ERROR } }, status: 503 },
  { name: "admin client unavailable", body: '{"topic":"gaming"}', noAdminClient: true, status: 503 },
];

describe("auth: no key, hash or publisher id in any response", () => {
  for (const [routeName, urlPath, post] of ROUTES) {
    for (const s of SCENARIOS) {
      it(`${routeName}: ${s.name} -> ${s.status}`, async () => {
        setDb(s.db);
        if (s.noAdminClient) delete globals.__TEST_SUPABASE__;
        const res = await post(request(urlPath, s.body, s.headers));
        assert.equal(res.status, s.status);
        const text = await fullText(res);
        for (const secret of [KEY, HASH, PUBLISHER_ID, KEY.slice(9), "Bearer blc_", "sb_secret_", "SUPABASE_SECRET_KEY"]) {
          assert.ok(!text.includes(secret), `${s.name}: response leaks ${secret.slice(0, 12)}...`);
        }
        assert.ok(!/my private chat/.test(text), "request body text is never echoed");
        assert.ok(!/stack|at .*\(.*:\d+:\d+\)/i.test(text), "no stack trace");
      });
    }
  }
});

describe("auth: logs never contain key, hash, publisher id, topic, body or ad text", () => {
  it("every failure path logs only a static label plus an error code", async () => {
    for (const [, urlPath, post] of ROUTES) {
      for (const s of SCENARIOS) {
        setDb(s.db);
        if (s.noAdminClient) delete globals.__TEST_SUPABASE__;
        await (await post(request(urlPath, s.body, s.headers))).text();
      }
    }
    assert.ok(logged.length > 0, "failure paths should log something (error code), otherwise monitoring is blind");
    const blob = JSON.stringify(logged);
    for (const secret of [KEY, HASH, PUBLISHER_ID, "gaming", "health", "Secret headline", "my private chat", "connection failed", "db down"]) {
      assert.ok(!blob.includes(secret), `log contains: ${secret}`);
    }
    for (const entry of logged) {
      assert.equal(entry.level, "error", "only console.error is used");
      const [label, code, ...rest] = entry.args;
      assert.match(String(label), /^\[ads\/(serve|load)\] [a-z ]+$/);
      assert.equal(rest.length, 0);
      if (code !== undefined) assert.match(String(code), /^[A-Za-z0-9]{1,10}$/);
    }
  });

  it("successful and rejected-by-validation requests log nothing at all", async () => {
    await (await v1Route.POST(request("/api/v1/ads/match", '{"topic":"gaming"}'))).text();
    await (await v1Route.POST(request("/api/v1/ads/match", '{"topic":"gaming","x":1}'))).text();
    await (await v1Route.POST(request("/api/v1/ads/match", '{"topic":"gaming"}', { authorization: "" }))).text();
    assert.deepEqual(logged, []);
  });
});

// ---------------------------------------------------------------------------
// 2. Database ka jawab bigda ho toh fail closed
// ---------------------------------------------------------------------------
describe("auth: database problems fail closed (503, no ad, nothing else runs)", () => {
  const bad: Array<[string, Reply]> = [
    ["rpc throws", throwsLeaky],
    ["null data", { data: null, error: null }],
    ["array instead of object", { data: [AUTH_OK], error: null }],
    ["plain string", { data: "ok", error: null }],
    ["publisher_status pending", { data: { ...AUTH_OK, publisher_status: "pending" }, error: null }],
    ["publisher_status missing", { data: { outcome: "ok", publisher_id: PUBLISHER_ID, unit_cost_usd: 0.002 }, error: null }],
    ["unit cost Infinity", { data: { ...AUTH_OK, unit_cost_usd: Number.POSITIVE_INFINITY }, error: null }],
    ["unit cost NaN", { data: { ...AUTH_OK, unit_cost_usd: Number.NaN }, error: null }],
    ["error object AND ok data together", { data: AUTH_OK, error: { code: "57014" } }],
  ];
  for (const [name, reply] of bad) {
    it(`authorize: ${name}`, async () => {
      setDb({ authorize_publisher_key: reply });
      const res = await v1Route.POST(request("/api/v1/ads/match", '{"topic":"gaming"}'));
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), { fill: false, error: "unavailable" });
      assert.deepEqual(rpcNames(), ["authorize_publisher_key"]);
    });
  }

  it("admin client cannot be created (missing env) -> 503, nothing leaks", async () => {
    delete globals.__TEST_SUPABASE__;
    const res = await v1Route.POST(request("/api/v1/ads/match", '{"topic":"gaming"}'));
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { fill: false, error: "unavailable" });
  });
});

describe("auth: key revoked or publisher suspended between authorize and record", () => {
  it("record says unauthorized -> 200 no-fill, the ad is NOT returned", async () => {
    setDb({ record_ad_serve: { data: { outcome: "unauthorized" }, error: null } });
    const res = await v1Route.POST(request("/api/v1/ads/match", '{"topic":"gaming"}'));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { fill: false });
    assert.deepEqual(rpcNames(), ["authorize_publisher_key", "load_ad_candidates", "record_ad_serve"]);
  });

  it("record returns garbage -> 503, the ad is NOT returned", async () => {
    setDb({ record_ad_serve: { data: { outcome: "ok-ish" }, error: null } });
    const res = await v1Route.POST(request("/api/v1/ads/match", '{"topic":"gaming"}'));
    assert.equal(res.status, 503);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.ad, undefined);
  });
});

// ---------------------------------------------------------------------------
// 3. Identity: key se, body se kabhi nahi
// ---------------------------------------------------------------------------
describe("auth: publisher identity comes only from the key", () => {
  it("the database receives exactly these arguments (no publisher id, ever)", async () => {
    const res = await v1Route.POST(request("/api/v1/ads/match", JSON.stringify({ topic: "gaming", exclude_ad_ids: [UUID_1] })));
    assert.equal(res.status, 200);
    const byName = Object.fromEntries(rpcCalls.map((c) => [c.name, Object.keys(c.args).sort()]));
    assert.deepEqual(byName, {
      authorize_publisher_key: ["p_key_hash"],
      load_ad_candidates: ["p_category", "p_today"],
      record_ad_serve: ["p_creative_id", "p_key_hash", "p_topic"],
    });
    assert.equal(rpcCalls[0].args.p_key_hash, HASH);
    assert.equal(rpcCalls[2].args.p_key_hash, HASH);
    assert.ok(!JSON.stringify(rpcCalls).includes(PUBLISHER_ID));
  });

  it("credential-looking or identity body fields are rejected (400) before any database call", async () => {
    for (const extra of [
      { api_key: KEY }, { key: KEY }, { authorization: `Bearer ${KEY}` }, { key_hash: HASH },
      { publisher_id: PUBLISHER_ID }, { publisher_status: "active" }, { status: "active" }, { role: "admin" },
    ]) {
      const res = await v1Route.POST(request("/api/v1/ads/match", JSON.stringify({ topic: "gaming", ...extra })));
      assert.equal(res.status, 400, JSON.stringify(Object.keys(extra)));
      assert.deepEqual(await res.json(), { error: "invalid_request", reason: "unknown_field" });
    }
    assert.equal(rpcCalls.length, 0);
  });

  it("two Authorization values in one header, or junk after the key, are 401 without a database call", async () => {
    for (const authorization of [`Bearer ${KEY}, Bearer ${KEY}`, `Bearer ${KEY},`, `Bearer ${KEY}x`, `Bearer  `, "Bearer", `Bearer ${KEY.toUpperCase()}`]) {
      const res = await v1Route.POST(request("/api/v1/ads/match", '{"topic":"gaming"}', { authorization }));
      assert.equal(res.status, 401, authorization);
    }
    assert.equal(rpcCalls.length, 0);
  });

  it("a request with a valid key header but a bad body is 400 and never reaches the database", async () => {
    const res = await v1Route.POST(request("/api/v1/ads/match", "{nope"));
    assert.equal(res.status, 400);
    assert.equal(rpcCalls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// 4. SQL ki static jaanch (SQL yahan chal nahi sakti; ye sirf regression pakadti hai, asli saboot SQL tests ka run hai)
// ---------------------------------------------------------------------------
function sql(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8").replace(/--.*$/gm, "");
}

describe("auth: SQL source pins (static, not a substitute for running the SQL tests)", () => {
  it("authorize_publisher_key: active key + active publisher + active profile, lowercase 64-hex hash only", () => {
    const s = sql("supabase/sql/day-5-8-serve-functions.sql");
    const body = /create or replace function public\.authorize_publisher_key[\s\S]*?\n\$\$;/.exec(s)?.[0] ?? "";
    assert.ok(body.length > 200, "function body found");
    for (const re of [
      /p_key_hash !~ '\^\[0-9a-f\]\{64\}\$'/,
      /k\.key_hash = p_key_hash/,
      /k\.status\s*=\s*'active'/,
      /p\.status\s*=\s*'active'/,
      /pr\.status\s*=\s*'active'/,
      /security definer/,
      /set search_path = ''/,
    ]) {
      assert.match(body, re);
    }
    assert.ok(!/publisher_id\s*:=\s*p_/.test(body), "publisher id never comes from a parameter");
  });

  it("record_ad_serve derives the publisher from the key hash and re-checks key, publisher and profile", () => {
    const s = sql("supabase/sql/day-5-8-serve-functions.sql");
    const body = /create or replace function public\.record_ad_serve[\s\S]*?\n\$\$;/.exec(s)?.[0] ?? "";
    for (const re of [/k\.key_hash = p_key_hash/, /k\.status\s*=\s*'active'/, /p\.status\s*=\s*'active'/, /pr\.status\s*=\s*'active'/]) {
      assert.match(body, re);
    }
    assert.ok(!/p_publisher_id/.test(body));
  });

  it("both functions: execute only for service_role (no grant to anon, authenticated or public)", () => {
    const s = sql("supabase/sql/day-5-8-serve-functions.sql");
    assert.match(s, /revoke all on function public\.authorize_publisher_key\(text\)\s+from public, anon, authenticated;/);
    assert.match(s, /revoke all on function public\.record_ad_serve\(text, uuid, text\)\s+from public, anon, authenticated;/);
    const grants = s.match(/grant\s+[^;]*;/gi) ?? [];
    assert.equal(grants.length, 2);
    for (const g of grants) assert.match(g, /to service_role;$/);
  });

  it("publisher_api_keys stores only a hash: fixed column list, hash CHECK, no grants, RLS on", () => {
    const s = sql("supabase/sql/day-5-2-publisher-keys.sql");
    const table = /create table if not exists public\.publisher_api_keys \(([\s\S]*?)\n\);/.exec(s)?.[1] ?? "";
    const columns = Array.from(table.matchAll(/^\s{2}([a-z_]+)\s+(?:uuid|text|timestamptz)\b/gm)).map((m) => m[1]).sort();
    assert.deepEqual(columns, ["created_at", "id", "key_hash", "key_prefix", "last_used_at", "publisher_id", "revoked_at", "status"]);
    assert.match(table, /key_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
    assert.match(table, /status in \('active', 'revoked'\)/);
    assert.match(s, /enable row level security/);
    assert.match(s, /revoke all on table public\.publisher_api_keys from public, anon, authenticated, service_role;/);
    assert.ok(!/grant\s/i.test(s.replace(/revoke[^;]*;/gi, "")), "no grant statements in the keys migration");
    assert.match(s, /left\(v_key, 13\)/, "only a 13 character prefix is stored");
  });
});

describe("auth: Day 6 part 3 SQL tests and docs are safe", () => {
  const SQL_FILE = "supabase/sql/day-6-1-publisher-auth-tests.sql";

  it("the SQL test file changes no schema, never commits, and every transaction is rolled back", () => {
    const s = sql(SQL_FILE);
    assert.ok(!/\b(create|alter|drop|truncate|grant|revoke|commit)\b/i.test(s), "no DDL/grant/commit");
    const begins = (s.match(/^\s*begin;/gim) ?? []).length;
    const rollbacks = (s.match(/^\s*rollback;/gim) ?? []).length;
    assert.ok(begins >= 10);
    assert.equal(begins, rollbacks);
  });

  it("no live-looking API key is written anywhere in the SQL tests or the doc", () => {
    for (const f of [SQL_FILE, "DAY6-PUBLISHER-AUTH.md"]) {
      const raw = readFileSync(path.join(ROOT, f), "utf8");
      assert.ok(!/blc_live_[0-9a-f]{16,}/i.test(raw), `${f}: live-looking key`);
      assert.ok(!/sb_secret_[A-Za-z0-9]{10,}/.test(raw), `${f}: secret-looking value`);
    }
  });
});
