import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import * as ts from "typescript";
import * as v1Route from "@/app/api/v1/ads/match/route";
import { readBearerKey } from "@/lib/ads/api-key";
import { PUBLIC_AD_FIELDS } from "@/lib/ads/contract";
import { ACTIVE_CATEGORIES } from "@/lib/ads/taxonomy";
import { EXPIRY_CHOICES, KEY_PREFIX, buildKeyParts } from "@/lib/publisher/keys";
import * as nextRoute from "../../examples/publisher-nextjs/app/api/blisscco-ad/route";
import { MAX_IMPRESSION_BODY_BYTES } from "@/lib/ads/impression";
import { handleClickGet } from "@/lib/ads/click-handler";
import { handleImpressionPost } from "@/lib/ads/impression-handler";
import { createIpGuard } from "@/lib/ads/ip-guard";
import { mintTrackingToken, verifyTrackingToken, readTrackingConfig } from "@/lib/ads/tracking-token";

// Day 10 Part 4: publisher guide ke SERVER-SIDE examples (TypeScript aur JavaScript) asli API handler ke against CHALAYE jaate hain.
// Database nakli hai (tests/register.cjs): koi asli Supabase / network nahi. Fetch ek local raasta hai jo seedha asli v1 route ko bulata hai.
// Guide ke text se example nikalkar chalate hain, isliye guide aur code alag nahi ho sakte.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const flat = (f: string) => read(f).replace(/\s+/g, " ");
const GUIDE = "app/dashboard/publisher/guide/page.tsx";
const CONTRACT_DOC = "DAY6-ADS-MATCH-CONTRACT.md";

/** Guide me `const NAME = [ ... ].join("\n");` ko chalakar uska text nikaalta hai (sirf string literals). */
function lines(name: string): string {
  const m = new RegExp(`const ${name} = (\\[[\\s\\S]*?\\])\\.join\\("\\\\n"\\);`).exec(read(GUIDE));
  assert.ok(m, `${name} guide me nahi mila`);
  return (new Function(`return ${m[1]}`)() as string[]).join("\n");
}

// ---------------------------------------------------------------------------
// Nakli database (waisi hi jaisi tests/ads/day10-part3-api.test.ts me), par rpc ke arguments bhi yaad rakhta hai.
// ---------------------------------------------------------------------------

const KEY = `blc_live_${"d".repeat(64)}`;
const AUTH_OK = { outcome: "ok", publisher_id: "99999999-9999-4999-8999-999999999999", publisher_status: "active", unit_cost_usd: 0.002 };
const ROW = {
  creative_id: "00000000-0000-4000-8000-000000000001", headline: "Level up", body: "Gaming laptops", cta_text: "Shop now", destination_url: "https://example.com/g",
  creative_status: "approved", campaign_id: "c0000000-0000-4000-8000-000000000001", campaign_status: "active", category: "gaming",
  start_date: "2020-01-01", end_date: null, total_budget: 100, daily_budget: null, spent_total: 0, spent_today: 0,
  advertiser_status: "active", advertiser_profile_status: "active", campaign_serves_today: 0, creative_serves_today: 0,
};

type Reply = { data: unknown; error: { code?: string; message?: string } | null };
type RpcCall = { name: string; args: Record<string, unknown> };
const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
let rpcCalls: RpcCall[] = [];
// authorize ke jawab ek ek karke (queue). Khali ho toh AUTH_OK.
let authQueue: Reply[] = [];
let dbOverrides: Record<string, Reply> = {};
const realError = console.error;

function setDb(over: Record<string, Reply> = {}) {
  dbOverrides = over;
  globals.__TEST_SUPABASE__ = {
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push({ name, args });
      if (name === "authorize_publisher_key" && authQueue.length > 0) return authQueue.shift() as Reply;
      const replies: Record<string, Reply> = {
        authorize_publisher_key: { data: AUTH_OK, error: null },
        find_idempotent_serve: { data: { outcome: "none" }, error: null },
        load_ad_candidates: { data: [ROW], error: null },
        record_ad_serve: { data: { outcome: "ok" }, error: null },
        ...dbOverrides,
      };
      const r = replies[name];
      if (!r) throw new Error(`test: unexpected rpc ${name}`);
      return r;
    },
  };
}

beforeEach(() => {
  rpcCalls = [];
  authQueue = [];
  console.error = () => {};
  setDb();
});
afterEach(() => {
  console.error = realError;
});

// Guide ke example ke "fetch" ka asli jawab: seedha v1 route (asli handler). Har request yaad rakhta hai.
type Seen = { url: string; method: string; headers: Record<string, string>; body: string };
function makeFetch(seen: Seen[]) {
  return async (input: string, init: RequestInit & { signal?: AbortSignal }): Promise<Response> => {
    const headers = new Headers(init.headers as Record<string, string>);
    seen.push({ url: input, method: String(init.method), headers: Object.fromEntries(headers.entries()), body: String(init.body) });
    return v1Route.POST(new Request(input, { method: init.method, headers, body: init.body as string, signal: init.signal }));
  };
}

// ---------------------------------------------------------------------------
// 1. TypeScript example: guide se nikala, transpile kiya, asli handler ke against chalaya
// ---------------------------------------------------------------------------

type SponsoredAd = { id: string; headline: string; body: string; cta_text: string | null; destination_url: string };
type GetAd = (topic: string, shown?: string[], idempotencyKey?: string) => Promise<SponsoredAd | null>;

const TS_SOURCE = lines("SERVER_EXAMPLE");
const API_BASE = "https://api.example.test";

function loadTsExample(
  env: Record<string, string | undefined>,
  seen: Seen[],
  sleeps: number[] = [],
  fetchImpl: unknown = makeFetch(seen),
): GetAd {
  const js = ts.transpileModule(TS_SOURCE, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, strict: true },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  const sandbox = {
    module: mod,
    exports: mod.exports,
    process: { env },
    fetch: fetchImpl,
    crypto: globalThis.crypto,
    AbortSignal,
    // Asli intezaar nahi: sirf dekhte hain ki kitni der ka maanga gaya.
    setTimeout: (fn: () => void, ms: number) => {
      sleeps.push(ms);
      fn();
      return 0;
    },
    Promise,
    Date,
    Math,
    Number,
    JSON,
  };
  vm.runInNewContext(js, sandbox);
  return mod.exports.getSponsoredAd as GetAd;
}

const ENV_OK = { BLISSCCO_API_BASE_URL: API_BASE, BLISSCCO_PUBLISHER_API_KEY: KEY };

describe("guide TypeScript example runs against the real API handler", () => {
  it("the example compiles with no type errors (strict)", () => {
    const fileName = "example.ts";
    const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, strict: true, noEmit: true, lib: ["lib.es2022.d.ts", "lib.dom.d.ts"], types: ["node"], skipLibCheck: true };
    const host = ts.createCompilerHost(options);
    const original = host.getSourceFile.bind(host);
    host.getSourceFile = (name, lang, ...rest) => (name === fileName ? ts.createSourceFile(name, TS_SOURCE, lang) : original(name, lang, ...rest));
    const originalExists = host.fileExists.bind(host);
    host.fileExists = (name) => name === fileName || originalExists(name);
    const program = ts.createProgram([fileName], options, host);
    const diagnostics = ts.getPreEmitDiagnostics(program).filter((d) => d.file?.fileName === fileName);
    assert.deepEqual(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")), []);
  });

  it("success: returns the ad; sends the documented URL, headers and ONLY topic + exclude_ad_ids", async () => {
    const seen: Seen[] = [];
    const getSponsoredAd = loadTsExample(ENV_OK, seen);
    const ad = await getSponsoredAd("gaming", ["3f2b8c1e-5a47-4d9e-9b62-7c1d8e4a6f10"]);
    assert.ok(ad);
    assert.deepEqual(Object.keys(ad).sort(), [...PUBLIC_AD_FIELDS].sort());
    assert.equal(ad.headline, "Level up");
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, `${API_BASE}/api/v1/ads/match`);
    assert.equal(seen[0].method, "POST");
    assert.equal(seen[0].headers.authorization, `Bearer ${KEY}`);
    assert.equal(seen[0].headers["content-type"], "application/json");
    assert.match(seen[0].headers["idempotency-key"], /^[A-Za-z0-9_-]{8,64}$/);
    assert.deepEqual(Object.keys(JSON.parse(seen[0].body)).sort(), ["exclude_ad_ids", "topic"]);
    assert.equal(seen[0].body.includes(KEY), false, "key body me nahi jaani chahiye");
  });

  it("the Idempotency-Key reaches the database record call (real handler path)", async () => {
    const getSponsoredAd = loadTsExample(ENV_OK, []);
    await getSponsoredAd("gaming", [], "retry-key-12345678");
    const record = rpcCalls.find((c) => c.name === "record_ad_serve");
    assert.ok(record);
    assert.equal(record.args.p_idempotency_key, "retry-key-12345678");
    assert.equal(rpcCalls.some((c) => c.name === "find_idempotent_serve"), true);
  });

  it("each call without an explicit key gets a fresh random valid Idempotency-Key", async () => {
    const seen: Seen[] = [];
    const getSponsoredAd = loadTsExample(ENV_OK, seen);
    await getSponsoredAd("gaming");
    await getSponsoredAd("gaming");
    assert.notEqual(seen[0].headers["idempotency-key"], seen[1].headers["idempotency-key"]);
  });

  it("no-fill (sensitive topic, unsupported topic, nothing eligible) returns null without retrying", async () => {
    for (const topic of ["health", "cars"]) {
      const seen: Seen[] = [];
      assert.equal(await loadTsExample(ENV_OK, seen)(topic), null, topic);
      assert.equal(seen.length, 1, topic);
    }
    setDb({ load_ad_candidates: { data: [], error: null } });
    const seen: Seen[] = [];
    assert.equal(await loadTsExample(ENV_OK, seen)("gaming"), null);
    assert.equal(seen.length, 1);
  });

  it("401 (bad key) and 400 (bad topic) return null and are NOT retried", async () => {
    setDb({ authorize_publisher_key: { data: { outcome: "unauthorized" }, error: null } });
    let seen: Seen[] = [];
    assert.equal(await loadTsExample(ENV_OK, seen)("gaming"), null);
    assert.equal(seen.length, 1);

    setDb();
    rpcCalls = [];
    seen = [];
    assert.equal(await loadTsExample(ENV_OK, seen)("Gaming"), null); // capital letter => real API answers 400
    assert.equal(seen.length, 1);
    assert.equal(rpcCalls.length, 0, "400 database tak nahi pahunchta");
  });

  it("429 returns null and pauses: the next call makes no request at all", async () => {
    setDb({ authorize_publisher_key: { data: { outcome: "rate_limited" }, error: null } });
    const seen: Seen[] = [];
    const getSponsoredAd = loadTsExample(ENV_OK, seen);
    assert.equal(await getSponsoredAd("gaming"), null);
    assert.equal(seen.length, 1);
    assert.equal(await getSponsoredAd("gaming"), null);
    assert.equal(seen.length, 1, "Retry-After tak koi nayi request nahi");
  });

  it("503 once, then success: ONE retry after 1s+ with the SAME Idempotency-Key", async () => {
    authQueue = [{ data: null, error: { code: "XX000" } }];
    const seen: Seen[] = [];
    const sleeps: number[] = [];
    const ad = await loadTsExample(ENV_OK, seen, sleeps)("gaming");
    assert.ok(ad);
    assert.equal(seen.length, 2);
    assert.equal(seen[0].headers["idempotency-key"], seen[1].headers["idempotency-key"]);
    assert.equal(sleeps.length, 1);
    assert.ok(sleeps[0] >= 1000 && sleeps[0] <= 1500, `backoff ${sleeps[0]}`);
  });

  it("503 twice: gives up after exactly 2 attempts and returns null", async () => {
    setDb({ authorize_publisher_key: { data: null, error: { code: "XX000" } } });
    const seen: Seen[] = [];
    assert.equal(await loadTsExample(ENV_OK, seen)("gaming"), null);
    assert.equal(seen.length, 2);
  });

  it("a network error (fetch rejects) is retried once with the same key, then returns null (never throws)", async () => {
    const keys: string[] = [];
    let calls = 0;
    const failing = async (_url: string, init: { headers: Record<string, string> }) => {
      calls += 1;
      keys.push(init.headers["Idempotency-Key"]);
      throw new TypeError("fetch failed");
    };
    assert.equal(await loadTsExample(ENV_OK, [], [], failing)("gaming"), null);
    assert.equal(calls, 2);
    assert.equal(keys[0], keys[1]);
  });

  it("a timeout (fetch rejects with TimeoutError, like AbortSignal.timeout) is retried once, then returns null", async () => {
    let calls = 0;
    const timesOut = async () => {
      calls += 1;
      throw new DOMException("The operation timed out.", "TimeoutError");
    };
    assert.equal(await loadTsExample(ENV_OK, [], [], timesOut)("gaming"), null);
    assert.equal(calls, 2);
  });

  it("without the env variables it makes no request and returns null", async () => {
    for (const env of [{}, { BLISSCCO_API_BASE_URL: API_BASE }, { BLISSCCO_PUBLISHER_API_KEY: KEY }]) {
      const seen: Seen[] = [];
      assert.equal(await loadTsExample(env, seen)("gaming"), null);
      assert.equal(seen.length, 0);
    }
  });

  it("reads only server env variables (no public prefix) and never contains a key", () => {
    assert.match(TS_SOURCE, /process\.env\.BLISSCCO_PUBLISHER_API_KEY/);
    assert.equal(/NEXT_PUBLIC|VITE_|REACT_APP|EXPO_PUBLIC|localStorage|document\.|window\./.test(TS_SOURCE.replace(/\/\/.*$/gm, "")), false);
    assert.equal(/blc_live_/.test(TS_SOURCE), false);
  });
});

// ---------------------------------------------------------------------------
// 2. JavaScript proxy example: asli Node process me, local fake "Blisscco" server ke saath (jiske peeche asli handler hai)
// ---------------------------------------------------------------------------

type UpstreamSeen = { method: string; url: string; headers: IncomingMessage["headers"]; body: string };

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
}

async function freePort(): Promise<number> {
  const s = createServer();
  const port = await listen(s);
  await new Promise((r) => s.close(r));
  return port;
}

describe("guide JavaScript proxy example runs as a real Node process", () => {
  let upstream: Server;
  let upstreamPort = 0;
  let upstreamSeen: UpstreamSeen[] = [];
  let child: ChildProcess | null = null;
  let tmp = "";

  async function startProxy(env: Record<string, string>): Promise<number> {
    const port = await freePort();
    child = spawn(process.execPath, [path.join(tmp, "proxy.mjs")], {
      env: { PATH: process.env.PATH ?? "", PORT: String(port), ...env } as unknown as NodeJS.ProcessEnv,
      stdio: "ignore",
    });
    // Tab tak ruko jab tak proxy sun raha ho.
    for (let i = 0; i < 100; i++) {
      try {
        await fetch(`http://127.0.0.1:${port}/ping`);
        return port;
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    throw new Error("proxy start nahi hua");
  }

  beforeEach(async () => {
    upstreamSeen = [];
    tmp = mkdtempSync(path.join(tmpdir(), "blisscco-proxy-"));
    writeFileSync(path.join(tmp, "proxy.mjs"), lines("PROXY_EXAMPLE"));
    upstream = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", async () => {
        const body = Buffer.concat(chunks).toString("utf8");
        upstreamSeen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
        const r = await v1Route.POST(new Request(`http://localhost${req.url}`, { method: "POST", headers, body }));
        res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
        res.end(await r.text());
      });
    });
    upstreamPort = await listen(upstream);
  });

  afterEach(async () => {
    child?.kill();
    child = null;
    await new Promise((r) => upstream.close(r));
    rmSync(tmp, { recursive: true, force: true });
  });

  const env = () => ({ BLISSCCO_API_BASE_URL: `http://127.0.0.1:${upstreamPort}`, BLISSCCO_PUBLISHER_API_KEY: KEY });

  it("success: the browser gets exactly {sponsored:true, ad:{5 public fields}} and never the key", async () => {
    const port = await startProxy(env());
    const res = await fetch(`http://127.0.0.1:${port}/sponsored?area=gaming`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const text = await res.text();
    assert.equal(text.includes(KEY), false);
    assert.equal(text.includes("fill"), false, "upstream body seedha nahi bheji jaati");
    const body = JSON.parse(text);
    assert.deepEqual(Object.keys(body).sort(), ["ad", "sponsored"]);
    assert.equal(body.sponsored, true);
    assert.deepEqual(Object.keys(body.ad).sort(), [...PUBLIC_AD_FIELDS].sort());
    for (const [name] of res.headers) assert.equal(/authorization|idempotency/i.test(name), false, name);
  });

  it("upstream receives the documented request: POST, Bearer key, JSON, random Idempotency-Key, body is ONLY the topic", async () => {
    const port = await startProxy(env());
    await fetch(`http://127.0.0.1:${port}/sponsored?area=coding`);
    assert.equal(upstreamSeen.length, 1);
    const u = upstreamSeen[0];
    assert.equal(u.method, "POST");
    assert.equal(u.url, "/api/v1/ads/match");
    assert.equal(u.headers.authorization, `Bearer ${KEY}`);
    assert.equal(u.headers["content-type"], "application/json");
    assert.match(String(u.headers["idempotency-key"]), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.deepEqual(JSON.parse(u.body), { topic: "developer_tools" });
    assert.equal(rpcCalls.find((c) => c.name === "load_ad_candidates") !== undefined, true);
  });

  it("unknown, missing or hostile area values send NOTHING upstream and answer 204", async () => {
    const port = await startProxy(env());
    for (const q of ["area=cars", "", "area=__proto__", "area=constructor", "area=GAMING", "area=gaming%20please%20help%20me"]) {
      const res = await fetch(`http://127.0.0.1:${port}/sponsored?${q}`);
      assert.equal(res.status, 204, q);
    }
    assert.equal(upstreamSeen.length, 0);
  });

  it("no-fill, 401 and 503 from upstream all become a quiet 204 for the browser", async () => {
    setDb({ load_ad_candidates: { data: [], error: null } });
    const port = await startProxy(env());
    assert.equal((await fetch(`http://127.0.0.1:${port}/sponsored?area=gaming`)).status, 204);

    setDb({ authorize_publisher_key: { data: { outcome: "unauthorized" }, error: null } });
    assert.equal((await fetch(`http://127.0.0.1:${port}/sponsored?area=gaming`)).status, 204);

    setDb({ authorize_publisher_key: { data: null, error: { code: "XX000" } } });
    assert.equal((await fetch(`http://127.0.0.1:${port}/sponsored?area=gaming`)).status, 204);

    setDb({ authorize_publisher_key: { data: { outcome: "rate_limited" }, error: null } });
    assert.equal((await fetch(`http://127.0.0.1:${port}/sponsored?area=gaming`)).status, 204);
  });

  it("other methods and paths get 404; without env variables it answers 204 and calls nobody", async () => {
    const port = await startProxy(env());
    assert.equal((await fetch(`http://127.0.0.1:${port}/other`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/sponsored?area=gaming`, { method: "POST" })).status, 404);
    child?.kill();
    child = null;

    const port2 = await startProxy({});
    const before = upstreamSeen.length;
    assert.equal((await fetch(`http://127.0.0.1:${port2}/sponsored?area=gaming`)).status, 204);
    assert.equal(upstreamSeen.length, before);
  });

  it("the example source holds no key and no public-prefix variable", () => {
    const src = lines("PROXY_EXAMPLE");
    assert.equal(/blc_live_/.test(src), false);
    assert.equal(/NEXT_PUBLIC|VITE_|REACT_APP|EXPO_PUBLIC/.test(src.replace(/\/\/.*$/gm, "")), false);
    assert.match(src, /process\.env\.BLISSCCO_PUBLISHER_API_KEY/);
  });
});

// ---------------------------------------------------------------------------
// 3. Guide / contract document ke daave asli behaviour ke saath
// ---------------------------------------------------------------------------

async function call(body: string, headers: Record<string, string> = {}): Promise<Response> {
  return v1Route.POST(
    new Request("https://example.test/api/v1/ads/match", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, ...headers },
      body,
    }),
  );
}

describe("guide and contract claims about topics, keys and limits are true", () => {
  it("every supported topic in the guide is an active category, and the guide lists them all", () => {
    const g = flat(GUIDE);
    for (const c of ACTIVE_CATEGORIES) assert.ok(g.includes(`<code>${c.slug}</code>`), c.slug);
  });

  it("topic format claims: capital letters or spaces => 400 invalid_topic; unsupported, sensitive or 4-word topics => plain no-fill", async () => {
    for (const topic of ["Gaming", "video games", "a-b"]) {
      const res = await call(JSON.stringify({ topic }));
      assert.equal(res.status, 400, topic);
      assert.deepEqual(await res.json(), { error: "invalid_request", reason: "invalid_topic" });
    }
    for (const topic of ["cars", "health", "politics", "a_b_c_d", "__proto__"]) {
      const res = await call(JSON.stringify({ topic }));
      assert.equal(res.status, 200, topic);
      assert.deepEqual(await res.json(), { fill: false }, topic);
    }
    const alias = await call('{"topic":"games"}');
    assert.equal((await alias.json()).fill, true);
  });

  it("person-identifying or text fields are refused with 400 unknown_field and never reach the database", async () => {
    for (const field of ["user_id", "email", "ip", "device_id", "session_id", "conversation_id", "location", "prompt", "messages", "api_key", "publisher_id"]) {
      rpcCalls = [];
      const res = await call(JSON.stringify({ topic: "gaming", [field]: "x" }));
      assert.equal(res.status, 400, field);
      assert.deepEqual(await res.json(), { error: "invalid_request", reason: "unknown_field" }, field);
      assert.equal(rpcCalls.length, 0, field);
    }
  });

  it("400 / 413 / 415 and a malformed key are answered before the key check (they do not use the rate-limit quota)", async () => {
    const cases: Array<() => Promise<Response>> = [
      () => call('{"topic":"Gaming"}'),
      () => call(JSON.stringify({ topic: "gaming", pad: "x".repeat(3000) })),
      () => call('{"topic":"gaming"}', { "content-type": "text/plain" }),
      () => call('{"topic":"gaming"}', { authorization: "Bearer not-a-key" }),
      () => call('{"topic":"gaming"}', { "idempotency-key": "short" }),
    ];
    for (const run of cases) {
      rpcCalls = [];
      await run();
      assert.equal(rpcCalls.some((c) => c.name === "authorize_publisher_key"), false);
    }
  });

  it("the key is accepted only as 'Bearer <key>' in the Authorization header, not in the body or query string", async () => {
    const noHeader = await v1Route.POST(
      new Request(`https://example.test/api/v1/ads/match?api_key=${KEY}`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"topic":"gaming"}' }),
    );
    assert.equal(noHeader.status, 401);
    assert.equal(noHeader.headers.get("www-authenticate"), 'Bearer realm="blisscco-ads"');
    assert.equal((await call(JSON.stringify({ topic: "gaming", api_key: KEY }))).status, 400);
  });

  it("an expired, revoked, unknown or suspended-publisher key all look the same: 401 {error:unauthorized}", async () => {
    const bodies: string[] = [];
    for (const outcome of ["unauthorized"]) {
      setDb({ authorize_publisher_key: { data: { outcome }, error: null } });
      const res = await call('{"topic":"gaming"}');
      assert.equal(res.status, 401);
      bodies.push(JSON.stringify(await res.json()));
    }
    const missing = await v1Route.POST(new Request("https://example.test/api/v1/ads/match", { method: "POST", headers: { "content-type": "application/json" }, body: '{"topic":"gaming"}' }));
    bodies.push(JSON.stringify(await missing.json()));
    assert.equal(new Set(bodies).size, 1);
  });

  it("key format in the guide and contract: prefix + 64 lowercase hex, generated by the real key builder", () => {
    assert.equal(KEY_PREFIX, "blc_live_");
    const parts = buildKeyParts("a1".repeat(32));
    assert.ok(parts);
    assert.equal(readBearerKey(`Bearer ${parts.key}`), parts.key);
    assert.equal(parts.key.length, 9 + 64);
    // Dashboard par dikhne wale hisse: shuruaat ke 13 akshar + aakhri 4 (guide / contract me yahi likha hai)
    assert.equal(parts.prefix, parts.key.slice(0, 13));
    assert.equal(parts.hint, parts.key.slice(-4));
    for (const f of [GUIDE, CONTRACT_DOC]) {
      const doc = flat(f);
      assert.ok(doc.includes("blc_live_"), f);
      assert.match(doc, /64 lowercase hex/, f);
    }
    assert.equal(readBearerKey(`Bearer ${parts.key.toUpperCase()}`), null, "uppercase key format reject");
  });

  it("guide describes the real expiry choices, the 5-key limit, approval states, revocation and rotation", () => {
    const g = flat(GUIDE);
    assert.deepEqual(EXPIRY_CHOICES.map((c) => c.value).sort(), ["30", "365", "90", "never"]);
    for (const needle of ["30 days", "90 days (the default)", "1 year", "no expiry", "up to 5 active keys", "Waiting for approval", "Approved", "Suspended",
      "Revoke", "Rotate", "same name", "old key keeps working", "returns 401"]) {
      assert.ok(g.includes(needle), needle);
    }
    assert.match(g, /shows when each key was last used/);
  });

  it("guide separates the private key from public values and says the API has no public key", () => {
    const g = flat(GUIDE);
    assert.match(g, /Private key or public value\?/);
    assert.match(g, /no public or &quot;site&quot; key and no publisher id/);
    assert.match(g, /Identifier only\. It cannot be used to call the API/);
  });

  it("guide error table covers the new 401 / 429 causes and the guide has both examples", () => {
    const g = flat(GUIDE);
    assert.match(g, /revoked or expired, or the publisher account is not active/);
    assert.match(g, /too many wrong keys from your IP address/);
    assert.match(g, /Server-side TypeScript example/);
    assert.match(g, /Server-side JavaScript example/);
  });

  it("contract document lists every 400 reason the real handler produces", async () => {
    const doc = read(CONTRACT_DOC);
    const attempts: Array<[string, () => Promise<Response>]> = [
      ["invalid_json", () => call("{nope")],
      ["invalid_body", () => call("[]")],
      ["unknown_field", () => call('{"topic":"gaming","x":1}')],
      ["invalid_topic", () => call('{"topic":"Gaming"}')],
      ["invalid_exclude_ad_ids", () => call('{"topic":"gaming","exclude_ad_ids":["nope"]}')],
      ["invalid_idempotency_key", () => call('{"topic":"gaming"}', { "idempotency-key": "x" })],
    ];
    for (const [reason, run] of attempts) {
      const res = await run();
      assert.equal(res.status, 400, reason);
      assert.deepEqual(await res.json(), { error: "invalid_request", reason });
      assert.ok(doc.includes(`\`${reason}\``), `contract doc me ${reason} nahi`);
    }
  });

  it("contract document documents the Idempotency-Key header, key lifecycle and the private-vs-public rule", () => {
    const doc = read(CONTRACT_DOC);
    for (const needle of ["Idempotency-Key", "Koi public / site key ya publisher id nahi hai", "Rotate", "Revoke", "Expired", "`pending`", "`suspended`", "BLISSCCO_PUBLISHER_API_KEY"]) {
      assert.ok(doc.includes(needle), needle);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Day 20 Part 4: guide ka quickstart / troubleshooting asli examples/ code aur asli routes ke against CHALAYA jaata hai.
// Node quickstart snippet guide se nikalkar transpile hota hai aur examples/publisher-node/src/client.ts ke saath asli v1 route chalata hai.
// Next.js example ka route mocked fetch ke saath (koi network / database nahi).
// ---------------------------------------------------------------------------------------------------------------------

type QsSeen = Seen; // same shape the shared makeFetch() records

function transpile(source: string): string {
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, strict: true } }).outputText;
}

/** Guide ka Node quickstart + asli client.ts, ek hi sandbox me. `fetch` seedha asli v1 route hai; sleep nakli (sirf maanga gaya samay yaad). */
function loadNodeQuickstart(env: Record<string, string | undefined>, seen: QsSeen[], sleeps: number[], logs: string[]) {
  const clientJs = transpile(read("examples/publisher-node/src/client.ts"));
  const sampleJs = transpile(lines("NODE_QUICKSTART_EXAMPLE"));
  const timeoutMs = 3000; // sample ka timeoutMs: asli timer; baaki sab (retry wait) nakli
  const sandbox: Record<string, unknown> = {
    process: { env },
    AbortController, URL,
    Promise, Date, Math, Number, JSON, Error, Array, Object, Symbol,
    clearTimeout,
    setTimeout: (fn: () => void, ms: number) => {
      if (ms === timeoutMs) return setTimeout(fn, ms);
      sleeps.push(ms);
      fn();
      return 0;
    },
    console: { error: (...a: unknown[]) => void logs.push(a.map(String).join(" ")) },
    fetch: makeFetch(seen),
  };
  const modules: Record<string, Record<string, unknown>> = {};
  const load = (id: string, js: string): Record<string, unknown> => {
    const mod = { exports: {} as Record<string, unknown> };
    const req = (name: string): unknown => {
      if (name === "node:crypto") return { randomUUID: () => globalThis.crypto.randomUUID() };
      if (name === "./client") return (modules[name] ??= load(name, clientJs));
      throw new Error(`unexpected import ${name}`);
    };
    vm.runInNewContext(js, { ...sandbox, module: mod, exports: mod.exports, require: req, globalThis: sandbox });
    return mod.exports;
  };
  const sample = load("sample", sampleJs);
  return sample.sponsoredAdFor as (topic: string, placementKey?: string) => Promise<SponsoredAd | null>;
}

describe("Day 20 part 4: the guide's Node.js quickstart runs against the real API handler", () => {
  const PLACEMENT = "placement-key-12345678";

  it("the quickstart compiles with no type errors against the real client (strict)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "blisscco-qs-"));
    try {
      writeFileSync(path.join(dir, "client.ts"), read("examples/publisher-node/src/client.ts"));
      writeFileSync(path.join(dir, "types.ts"), read("examples/publisher-node/src/types.ts"));
      writeFileSync(path.join(dir, "sample.ts"), lines("NODE_QUICKSTART_EXAMPLE"));
      const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, noEmit: true, lib: ["lib.es2022.d.ts", "lib.dom.d.ts"], types: ["node"], skipLibCheck: true };
      const program = ts.createProgram([path.join(dir, "sample.ts")], options);
      const diagnostics = ts
        .getPreEmitDiagnostics(program)
        .filter((d) => d.file && d.file.fileName.startsWith(dir))
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
        // Kuch machines par @types/node installed nahi hota; baaki har type error asli hai.
        .filter((m) => !/Cannot find (name|module) '(process|console|node:crypto)'/.test(m));
      assert.deepEqual(diagnostics, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("success: documented URL, Bearer key, JSON, the supplied placement key as Idempotency-Key, body is ONLY the topic", async () => {
    const seen: QsSeen[] = [];
    const ad = await loadNodeQuickstart(ENV_OK, seen, [], [])("gaming", PLACEMENT);
    assert.ok(ad);
    assert.deepEqual(Object.keys(ad).sort(), [...PUBLIC_AD_FIELDS].sort());
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, `${API_BASE}/api/v1/ads/match`);
    assert.equal(seen[0].headers.authorization, `Bearer ${KEY}`);
    assert.equal(seen[0].headers["content-type"], "application/json");
    assert.equal(seen[0].headers["idempotency-key"], PLACEMENT);
    assert.equal(seen[0].headers["x-blisscco-tracking"], undefined, "quickstart tracking opt-in nahi karta");
    assert.deepEqual(JSON.parse(seen[0].body), { topic: "gaming" });
    assert.equal(seen[0].body.includes(KEY), false);
    assert.equal(rpcCalls.find((c) => c.name === "record_ad_serve")?.args.p_idempotency_key, PLACEMENT, "the key reaches the serve record");
  });

  it("without a supplied key each placement gets its own fresh random Idempotency-Key", async () => {
    const seen: QsSeen[] = [];
    const run = loadNodeQuickstart(ENV_OK, seen, [], []);
    await run("gaming");
    await run("gaming");
    assert.match(seen[0].headers["idempotency-key"], /^[A-Za-z0-9_-]{8,64}$/);
    assert.notEqual(seen[0].headers["idempotency-key"], seen[1].headers["idempotency-key"]);
  });

  it("no-fill (sensitive topic, nothing eligible) returns null and sends exactly one request", async () => {
    let seen: QsSeen[] = [];
    assert.equal(await loadNodeQuickstart(ENV_OK, seen, [], [])("health", PLACEMENT), null);
    assert.equal(seen.length, 1);
    setDb({ load_ad_candidates: { data: [], error: null } });
    seen = [];
    assert.equal(await loadNodeQuickstart(ENV_OK, seen, [], [])("gaming", PLACEMENT), null);
    assert.equal(seen.length, 1);
  });

  it("a bad topic is stopped before any network call; a 401 is answered once and never retried", async () => {
    let seen: QsSeen[] = [];
    assert.equal(await loadNodeQuickstart(ENV_OK, seen, [], [])("Gaming", PLACEMENT), null);
    assert.equal(seen.length, 0);
    setDb({ authorize_publisher_key: { data: { outcome: "unauthorized" }, error: null } });
    seen = [];
    const sleeps: number[] = [];
    assert.equal(await loadNodeQuickstart(ENV_OK, seen, sleeps, [])("gaming", PLACEMENT), null);
    assert.equal(seen.length, 1);
    assert.equal(sleeps.length, 0);
  });

  it("429 (Retry-After: 60 is above the 5 second cap): one request, no waiting, no loop", async () => {
    setDb({ authorize_publisher_key: { data: { outcome: "rate_limited" }, error: null } });
    const seen: QsSeen[] = [];
    const sleeps: number[] = [];
    const logs: string[] = [];
    assert.equal(await loadNodeQuickstart(ENV_OK, seen, sleeps, logs)("gaming", PLACEMENT), null);
    assert.equal(seen.length, 1);
    assert.equal(sleeps.length, 0);
    assert.match(logs.join("\n"), /BlissccoRetryExhaustedError/);
  });

  it("503 once, then success: retried with the SAME Idempotency-Key after a wait of 1 second or more", async () => {
    authQueue = [{ data: null, error: { code: "XX000" } }];
    const seen: QsSeen[] = [];
    const sleeps: number[] = [];
    const ad = await loadNodeQuickstart(ENV_OK, seen, sleeps, [])("gaming", PLACEMENT);
    assert.ok(ad);
    assert.equal(seen.length, 2);
    assert.equal(seen[0].headers["idempotency-key"], PLACEMENT);
    assert.equal(seen[1].headers["idempotency-key"], PLACEMENT);
    assert.equal(sleeps.length, 1);
    assert.ok(sleeps[0] >= 1000 && sleeps[0] <= 2000, `wait ${sleeps[0]}`);
  });

  it("503 every time: at most two retries (three requests), the same key each time, waits of 1 second or more, then null", async () => {
    setDb({ authorize_publisher_key: { data: null, error: { code: "XX000" } } });
    const seen: QsSeen[] = [];
    const sleeps: number[] = [];
    const logs: string[] = [];
    assert.equal(await loadNodeQuickstart(ENV_OK, seen, sleeps, logs)("gaming", PLACEMENT), null);
    assert.equal(seen.length, 3);
    assert.deepEqual([...new Set(seen.map((x) => x.headers["idempotency-key"]))], [PLACEMENT]);
    assert.equal(sleeps.length, 2);
    assert.ok(sleeps.every((ms) => ms >= 1000 && ms <= 5000), JSON.stringify(sleeps));
    assert.match(logs.join("\n"), /BlissccoRetryExhaustedError/);
  });

  it("the error log carries only the error class name, never the key, the URL or a message", async () => {
    setDb({ authorize_publisher_key: { data: null, error: { code: "XX000" } } });
    const logs: string[] = [];
    await loadNodeQuickstart(ENV_OK, [], [], logs)("gaming", PLACEMENT);
    const text = logs.join("\n");
    assert.equal(text.includes(KEY), false);
    assert.equal(text.includes(API_BASE), false);
    assert.equal(/Bearer|HTTP 5/.test(text), false);
  });

  it("without the env variables the config error is caught: no request, null", async () => {
    for (const env of [{}, { BLISSCCO_API_BASE_URL: API_BASE }, { BLISSCCO_PUBLISHER_API_KEY: KEY }]) {
      const seen: QsSeen[] = [];
      const logs: string[] = [];
      assert.equal(await loadNodeQuickstart(env, seen, [], logs)("gaming", PLACEMENT), null);
      assert.equal(seen.length, 0);
      assert.match(logs.join("\n"), /BlissccoConfigError/);
    }
  });
});

describe("Day 20 part 4: troubleshooting claims come from the real match route", () => {
  it("every documented 400 reason is really returned by the route with status 400", async () => {
    const attempts: Array<[string, () => Promise<Response>]> = [
      ["invalid_json", () => call("{nope")],
      ["invalid_body", () => call("[]")],
      ["unknown_field", () => call('{"topic":"gaming","messages":["hi"]}')],
      ["invalid_topic", () => call('{"topic":"Gaming"}')],
      ["invalid_topic", () => call('{"topic":"gaming","fallback_topics":["Bad Topic"]}')],
      ["invalid_exclude_ad_ids", () => call('{"topic":"gaming","exclude_ad_ids":["nope"]}')],
      ["invalid_idempotency_key", () => call('{"topic":"gaming"}', { "idempotency-key": "short" })],
      ["invalid_tracking_header", () => call('{"topic":"gaming"}', { "x-blisscco-tracking": "2" })],
    ];
    for (const [reason, run] of attempts) {
      const res = await run();
      assert.equal(res.status, 400, reason);
      assert.deepEqual(await res.json(), { error: "invalid_request", reason });
    }
    const doc = read(GUIDE);
    const row = /status: "400", body: "invalid_request \+ reason", meaning: "(Match reasons:[^"]+)"/.exec(doc.slice(doc.indexOf("const TROUBLESHOOTING")));
    assert.ok(row);
    for (const [reason] of attempts) assert.ok(row[1].includes(reason), reason);
  });

  it("413 (over 2048 bytes), 415, 401 and 429 are answered as documented", async () => {
    const big = await call(JSON.stringify({ topic: "gaming", pad: "x".repeat(3000) }));
    assert.equal(big.status, 413);
    assert.deepEqual(await big.json(), { error: "payload_too_large" });
    const wrongType = await call('{"topic":"gaming"}', { "content-type": "text/plain" });
    assert.equal(wrongType.status, 415);
    assert.deepEqual(await wrongType.json(), { error: "unsupported_media_type" });
    setDb({ authorize_publisher_key: { data: { outcome: "unauthorized" }, error: null } });
    const un = await call('{"topic":"gaming"}');
    assert.equal(un.status, 401);
    assert.deepEqual(await un.json(), { error: "unauthorized" });
    setDb({ authorize_publisher_key: { data: { outcome: "rate_limited" }, error: null } });
    const lim = await call('{"topic":"gaming"}');
    assert.equal(lim.status, 429);
    assert.equal(lim.headers.get("retry-after"), "60");
    assert.deepEqual(await lim.json(), { error: "rate_limited" });
  });

  it("503 is {fill:false,error:unavailable}; no-fill is exactly {fill:false}; no opt-in header means no tracking object", async () => {
    setDb({ authorize_publisher_key: { data: null, error: { code: "XX000" } } });
    const down = await call('{"topic":"gaming"}');
    assert.equal(down.status, 503);
    assert.deepEqual(await down.json(), { fill: false, error: "unavailable" });
    setDb();
    const nofill = await call('{"topic":"health"}');
    assert.equal(nofill.status, 200);
    assert.deepEqual(await nofill.json(), { fill: false });
    const plain = (await (await call('{"topic":"gaming"}')).json()) as Record<string, unknown>;
    assert.equal(plain.fill, true);
    assert.equal("tracking" in plain, false);
  });

  it("expired tracking credentials: a token past its lifetime is refused, and no fresh token is minted for an old serve", () => {
    const secret = "k7f2-0123456789-abcdefghijklmnopqrstuvwxyz-primary";
    const cfg = readTrackingConfig({ AD_TRACKING_SECRET: secret, AD_TRACKING_TTL_SECONDS: "3600" });
    assert.ok(cfg);
    const servedAtMs = Date.UTC(2026, 9, 27, 10, 0, 0);
    const input = { serveRef: "bsr_" + "ab".repeat(20), publisherId: "00000000-0000-4000-8000-0000000000a1", servedAtMs, nowMs: servedAtMs };
    const grant = mintTrackingToken(cfg, input);
    assert.ok(grant);
    assert.equal(verifyTrackingToken(grant.token, "impression", cfg, servedAtMs + 1000).ok, true);
    assert.equal(verifyTrackingToken(grant.token, "impression", cfg, grant.expiresAtMs + 1000).ok, false, "expired token refused");
    assert.equal(mintTrackingToken(cfg, { ...input, nowMs: servedAtMs + 2 * 3_600_000 }), null, "a retry after expiry gets no new token");
  });

  it("expired token on the impression route is the same generic 401, and an expired click_ref is the same generic 404", async () => {
    const json = { "content-type": "application/json" };
    const imp = await handleImpressionPost(
      new Request("https://api.example.test/api/v1/ads/impression", { method: "POST", headers: json, body: JSON.stringify({ token: "bt1.EXAMPLE-PAYLOAD.EXAMPLE-SIGNATURE", event: "impression" }) }),
      { accept: async () => ({ kind: "unauthorized" }), requestGuard: createIpGuard(300), failureGuard: createIpGuard(30) },
    );
    assert.equal(imp.status, 401);
    assert.deepEqual(await imp.json(), { error: "unauthorized" });
    assert.equal(MAX_IMPRESSION_BODY_BYTES, 1024);
    const click = await handleClickGet(new Request("https://api.example.test/api/v1/ads/click?ref=bc1.EXAMPLE-PAYLOAD.EXAMPLE-SIGNATURE"), {
      accept: async () => ({ kind: "invalid", reason: "expired" }),
      requestGuard: createIpGuard(300),
      failureGuard: createIpGuard(30),
    });
    assert.equal(click.status, 404);
    assert.deepEqual(await click.json(), { error: "not_found" });
  });
});

describe("Day 20 part 4: the Next.js example behaves as the quickstart and troubleshooting say", () => {
  const AD_ROW = { id: "3f2b8c1e-5a47-4d9e-9b62-7c1d8e4a6f10", headline: "Level up", body: "Gaming laptops", cta_text: "Shop now", destination_url: "https://example.com/g" };
  const realFetch = globalThis.fetch;
  const saved = { key: process.env.BLISSCCO_PUBLISHER_API_KEY, base: process.env.BLISSCCO_API_BASE_URL };
  let upstream: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const mock = (status: number, body: unknown) => {
    globalThis.fetch = (async (url: unknown, init: RequestInit) => {
      upstream.push({ url: String(url), headers: init.headers as Record<string, string>, body: String(init.body) });
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
  };
  const post = (body: string, headers: Record<string, string> = { "content-type": "application/json" }) =>
    nextRoute.POST(new Request("http://localhost/api/blisscco-ad", { method: "POST", headers, body }));

  beforeEach(() => {
    upstream = [];
    process.env.BLISSCCO_PUBLISHER_API_KEY = KEY;
    process.env.BLISSCCO_API_BASE_URL = API_BASE;
    mock(200, { fill: true, sponsored: true, ad: AD_ROW });
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    for (const [name, v] of [["BLISSCCO_PUBLISHER_API_KEY", saved.key], ["BLISSCCO_API_BASE_URL", saved.base]] as const) {
      if (v === undefined) delete process.env[name];
      else process.env[name] = v;
    }
  });

  it("only a topic is accepted: conversation-shaped or person-identifying fields get a 400 and nothing is sent to Blisscco", async () => {
    for (const field of ["messages", "prompt", "user_id", "conversation_id", "email"]) {
      const res = await post(JSON.stringify({ topic: "gaming", [field]: "x" }));
      assert.equal(res.status, 400, field);
      assert.deepEqual(await res.json(), { error: "invalid_request", reason: "unknown_field" }, field);
    }
    assert.equal(upstream.length, 0);
  });

  it("a topic outside the allowlist is the route's own 400 invalid_topic; a supported topic is forwarded with a key and a topic-only body", async () => {
    const bad = await post('{"topic":"politics"}');
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: "invalid_request", reason: "invalid_topic" });
    assert.equal(upstream.length, 0);
    const ok = await post('{"topic":"travel"}');
    assert.equal(ok.status, 200);
    assert.equal(upstream.length, 1);
    assert.deepEqual(JSON.parse(upstream[0].body), { topic: "travel" });
    assert.match(upstream[0].headers["Idempotency-Key"], /^[A-Za-z0-9_-]{8,64}$/);
    assert.equal(upstream[0].headers["X-Blisscco-Tracking"], undefined, "the example never opts in to tracking");
    assert.equal((await ok.text()).includes(KEY), false);
  });

  it("each call to the route is a new placement: a different Idempotency-Key every time", async () => {
    await post('{"topic":"gaming"}');
    await post('{"topic":"gaming"}');
    assert.notEqual(upstream[0].headers["Idempotency-Key"], upstream[1].headers["Idempotency-Key"]);
  });

  it("415 and 413 from the route itself: wrong Content-Type, body over 1024 characters", async () => {
    const wrong = await post('{"topic":"gaming"}', { "content-type": "text/plain" });
    assert.equal(wrong.status, 415);
    assert.deepEqual(await wrong.json(), { error: "unsupported_media_type" });
    const big = await post(JSON.stringify({ topic: "gaming", pad: "x".repeat(1100) }));
    assert.equal(big.status, 413);
    assert.deepEqual(await big.json(), { error: "payload_too_large" });
    assert.equal(upstream.length, 0);
  });

  it("every failure behind the route (401, 429, 503, missing or malformed env) reaches the browser as the same generic 503", async () => {
    const quiet = console.error;
    console.error = () => {};
    try {
      for (const [status, body] of [[401, { error: "unauthorized" }], [429, { error: "rate_limited" }], [503, { fill: false, error: "unavailable" }]] as const) {
        mock(status, body);
        const res = await post('{"topic":"gaming"}');
        assert.equal(res.status, 503, String(status));
        assert.deepEqual(await res.json(), { fill: false, error: "unavailable" }, String(status));
      }
      mock(200, { fill: true, sponsored: true, ad: AD_ROW });
      delete process.env.BLISSCCO_PUBLISHER_API_KEY;
      const noKey = await post('{"topic":"gaming"}');
      assert.equal(noKey.status, 503);
      process.env.BLISSCCO_PUBLISHER_API_KEY = "not-a-real-key-format";
      const badKey = await post('{"topic":"gaming"}');
      assert.equal(badKey.status, 503);
      assert.deepEqual(await badKey.json(), { fill: false, error: "unavailable" });
    } finally {
      console.error = quiet;
    }
  });

  it("no-fill and an unsafe destination both become {fill:false}; the browser never gets tracking data", async () => {
    mock(200, { fill: false });
    assert.deepEqual(await (await post('{"topic":"gaming"}')).json(), { fill: false });
    mock(200, { fill: true, sponsored: true, ad: { ...AD_ROW, destination_url: "javascript:alert(1)" } });
    assert.deepEqual(await (await post('{"topic":"gaming"}')).json(), { fill: false });
    mock(200, { fill: true, sponsored: true, ad: AD_ROW, tracking: { token: "bt1.EXAMPLE-PAYLOAD.EXAMPLE-SIGNATURE", expires_at: "2099-01-01T00:00:00.000Z", events: ["impression", "click"], click_ref: "bc1.EXAMPLE-PAYLOAD.EXAMPLE-SIGNATURE" } });
    const text = await (await post('{"topic":"gaming"}')).text();
    assert.equal(/tracking|bt1\.|bc1\./.test(text), false);
  });

  it("the route allowlist is a subset of the supported topics, and every entry is accepted by the real API (alias or active slug)", () => {
    const list = /ALLOWED_TOPICS: ReadonlySet<string> = new Set\(\[([^\]]*)\]\)/.exec(read("examples/publisher-nextjs/app/api/blisscco-ad/route.ts"));
    assert.ok(list);
    const active = new Set(ACTIVE_CATEGORIES.map((c) => c.slug));
    for (const m of list[1].matchAll(/"([a-z_]+)"/g)) assert.ok(active.has(m[1]), m[1]);
  });
});
