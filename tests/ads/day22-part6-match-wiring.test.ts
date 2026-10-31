// Day 22 Part 6: Revive fallback ab match endpoint (v1 route -> match-handler -> service.serveMatchForPublisher) se juda hai.
// SIRF nakli (in-memory) database + nakli globalThis.fetch: koi asli network, database, SQL, Revive server ya billing nahi.
// Asli match-handler.ts, service.ts, fallback-routing.ts, fallback-provider.ts, revive-adapter.ts, contract.ts chalte hain.
import { db, installDb, type Camp, type Creative } from "../workflows/publisher-flow-stubs";
import { setupPublisher } from "@/app/dashboard/account/actions";
import { createKey } from "@/app/dashboard/publisher/actions";
import { adminDecision } from "@/app/dashboard/admin/actions";
import * as v1Route from "@/app/api/v1/ads/match/route";
import * as legacyRoute from "@/app/api/ads/match/route";
import { publicAdFromFallbackFill } from "@/lib/ads/fallback-provider";
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const idle = { status: "idle" } as never;
const DELIVERY = "https://delivery.test/Blisscco-test-ad/ad.json?zone=SECRETZONE77";
const PUBLIC_AD_FIELDS = ["id", "headline", "body", "cta_text", "destination_url"];

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}
async function run<T>(p: Promise<T>): Promise<{ state?: T; redirect?: string }> {
  try {
    return { state: await p };
  } catch (e) {
    const m = /^REDIRECT:(.*)$/.exec(e instanceof Error ? e.message : "");
    if (m) return { redirect: m[1] };
    throw e;
  }
}

const envKeys = ["REVIVE_FALLBACK_ENABLED", "REVIVE_DELIVERY_URL", "REVIVE_TIMEOUT_MS", "REVIVE_RESPONSE_FORMAT"] as const;
const savedEnv: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
const realConsole = { error: console.error, log: console.log, warn: console.warn, info: console.info };
let logs: unknown[][] = [];
let fetchCalls: string[] = [];
let ipCounter = 0;

function setEnv(over: Partial<Record<(typeof envKeys)[number], string>> = {}): void {
  process.env.REVIVE_FALLBACK_ENABLED = "true";
  process.env.REVIVE_DELIVERY_URL = DELIVERY;
  for (const [k, v] of Object.entries(over)) process.env[k] = v;
}
function mockProvider(body: unknown, init: { status?: number; type?: string; raw?: string } = {}): void {
  globalThis.fetch = (async (input: unknown) => {
    fetchCalls.push(String(input));
    return new Response(init.raw ?? JSON.stringify(body), { status: init.status ?? 200, headers: { "content-type": init.type ?? "application/json" } });
  }) as typeof fetch;
}
const GOOD_CREATIVE = { headline: "Test sponsored offer", body: "This is a plain text test ad for the Blisscco fallback.", cta_text: "Learn more", destination_url: "https://example.com/" };

beforeEach(() => {
  db.reset();
  installDb();
  logs = [];
  fetchCalls = [];
  for (const k of envKeys) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  const sink = (...a: unknown[]) => void logs.push(a);
  console.error = sink; console.log = sink; console.warn = sink; console.info = sink;
  globalThis.fetch = (async (input: unknown) => {
    fetchCalls.push(String(input));
    throw new Error("test: unexpected network call");
  }) as typeof fetch;
});
afterEach(() => {
  Object.assign(console, realConsole);
  globalThis.fetch = realFetch;
  for (const k of envKeys) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  const text = JSON.stringify(logs);
  assert.ok(!text.includes("SECRETZONE77") && !text.includes(DELIVERY), "delivery URL leaked to a log");
});

async function activeKey(): Promise<string> {
  await run(setupPublisher(idle, form({ name: "My Bot", websiteUrl: "https://bot.example.com", category: "gaming" })));
  const id = db.publisher!.id;
  await run(adminDecision(idle, form({ kind: "publisher", id, decision: "active" })));
  const r = await run(createKey(idle, form({ label: "Prod server", expiry: "90" })));
  return (r.state as { newKey: string }).newKey;
}
function addAd(over: { camp?: Partial<Camp>; cr?: Partial<Creative> } = {}): void {
  const campaignId = db.id();
  const creativeId = db.id();
  db.campaigns.push({ id: campaignId, status: "active", category: "gaming", startDate: "2020-01-01", endDate: null, totalBudget: 100, dailyBudget: null, spentTotal: 0, spentToday: 0, ...over.camp });
  db.creatives.push({ id: creativeId, campaignId, status: "approved", headline: "Visible headline", body: "Body text", ctaText: "Play", destinationUrl: "https://games.example.com/x", ...over.cr });
}
async function match(key: string | null, over: { body?: string; headers?: Record<string, string> } = {}): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": `10.22.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`,
    ...(key === null ? {} : { authorization: `Bearer ${key}` }),
    ...over.headers,
  };
  return v1Route.POST(new Request("https://blisscco.test/api/v1/ads/match", { method: "POST", headers, body: over.body ?? '{"topic":"gaming"}' }));
}
const serveRpcs = () => db.rpcCalls.filter((c) => c.name === "record_ad_serve").length;

describe("day 22 part 6 | default OFF: behaviour is exactly as before", () => {
  it("flag unset: Blisscco no-fill stays {fill:false}; the provider is never called", async () => {
    const key = await activeKey();
    mockProvider(GOOD_CREATIVE);
    const res = await match(key);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { fill: false });
    assert.deepEqual(fetchCalls, []);
  });

  it("flag set to anything but the exact value 'true' stays off", async () => {
    const key = await activeKey();
    mockProvider(GOOD_CREATIVE);
    for (const v of ["", "1", "TRUE", "yes", " true", "false"]) {
      process.env.REVIVE_FALLBACK_ENABLED = v;
      process.env.REVIVE_DELIVERY_URL = DELIVERY;
      assert.deepEqual(await (await match(key)).json(), { fill: false }, v);
    }
    assert.deepEqual(fetchCalls, []);
  });

  it("flag ON but delivery URL missing or not https: still plain no-fill, no request", async () => {
    const key = await activeKey();
    mockProvider(GOOD_CREATIVE);
    process.env.REVIVE_FALLBACK_ENABLED = "true";
    assert.deepEqual(await (await match(key)).json(), { fill: false });
    process.env.REVIVE_DELIVERY_URL = "http://delivery.test/ad.json";
    assert.deepEqual(await (await match(key)).json(), { fill: false });
    assert.deepEqual(fetchCalls, []);
  });
});

describe("day 22 part 6 | Blisscco first, provider only on a genuine no-fill", () => {
  it("a Blisscco ad is served and charged as before; the provider is never called even with the flag ON", async () => {
    const key = await activeKey();
    addAd();
    setEnv();
    mockProvider(GOOD_CREATIVE);
    const res = await match(key);
    const body = await res.json() as { fill: boolean; ad: { headline: string } };
    assert.equal(res.status, 200);
    assert.equal(body.fill, true);
    assert.equal(body.ad.headline, "Visible headline");
    assert.equal(serveRpcs(), 1);
    assert.deepEqual(fetchCalls, []);
  });

  it("Blisscco no-fill + flag ON + safe provider fill => sponsored provider ad with only the 5 public fields", async () => {
    const key = await activeKey();
    setEnv();
    mockProvider(GOOD_CREATIVE);
    const res = await match(key);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("x-blisscco-api-version"), "1");
    const body = await res.json() as { fill: boolean; sponsored: boolean; ad: Record<string, unknown>; tracking?: unknown };
    assert.equal(body.fill, true);
    assert.equal(body.sponsored, true);
    assert.deepEqual(Object.keys(body.ad).sort(), [...PUBLIC_AD_FIELDS].sort());
    assert.match(String(body.ad.id), /^revive_[0-9a-f]{8}$/);
    assert.equal(body.ad.headline, "Test sponsored offer");
    assert.equal(body.ad.cta_text, "Learn more");
    assert.equal(body.ad.destination_url, "https://example.com/");
    assert.ok(!("tracking" in body));
    assert.deepEqual(fetchCalls, [DELIVERY]);
    const text = JSON.stringify(body);
    assert.ok(!text.includes("SECRETZONE77") && !text.includes("delivery.test") && !/revive"/i.test(text.replace(/revive_[0-9a-f]{8}/, "")));
  });

  it("a provider fill never touches Blisscco serve, spend or ledger: no serve record, no charge", async () => {
    const key = await activeKey();
    setEnv();
    mockProvider(GOOD_CREATIVE);
    db.rpcCalls = [];
    await match(key);
    assert.equal(serveRpcs(), 0);
    assert.deepEqual(db.serves, []);
    assert.ok(!db.rpcCalls.some((c) => /ledger|payout|earning|impression|click/i.test(c.name)));
  });

  it("with X-Blisscco-Tracking: 1 a provider ad still carries no tracking object", async () => {
    const key = await activeKey();
    setEnv();
    mockProvider(GOOD_CREATIVE);
    const body = await (await match(key, { headers: { "x-blisscco-tracking": "1" } })).json() as Record<string, unknown>;
    assert.equal(body.fill, true);
    assert.ok(!("tracking" in body));
  });

  it("Day 22 Part 7: a request WITH an Idempotency-Key also gets the provider ad on a Blisscco no-fill; still no serve, charge or tracking", async () => {
    const key = await activeKey();
    setEnv();
    mockProvider(GOOD_CREATIVE);
    db.rpcCalls = [];
    const res = await match(key, { headers: { "idempotency-key": "retry-key-0001" }, });
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body.fill, true);
    assert.equal(body.sponsored, true);
    assert.ok(!("tracking" in body));
    assert.equal(fetchCalls.length, 1);
    assert.equal(serveRpcs(), 0);
  });

  it("a keyed retry after Blisscco already served the ad replays the Blisscco ad: provider not called, one charge only", async () => {
    const key = await activeKey();
    addAd();
    setEnv();
    mockProvider(GOOD_CREATIVE);
    const h = { "idempotency-key": "same-placement-01" };
    const a = await (await match(key, { headers: h })).json() as { ad: { id: string } };
    const b = await (await match(key, { headers: h })).json() as { ad: { id: string } };
    assert.equal(a.ad.id, b.ad.id);
    assert.ok(!a.ad.id.startsWith("revive_"));
    assert.deepEqual(fetchCalls, []);
    assert.ok(Math.abs(db.campaigns[0].spentTotal - 0.002) < 1e-9, `charged once, got ${db.campaigns[0].spentTotal}`);
  });

  it("a sensitive topic never reaches the provider", async () => {
    const key = await activeKey();
    setEnv();
    mockProvider(GOOD_CREATIVE);
    const res = await match(key, { body: '{"topic":"health"}' });
    assert.ok(res.status === 200 || res.status === 400);
    const body = await res.json() as Record<string, unknown>;
    assert.notEqual(body.fill, true);
    assert.deepEqual(fetchCalls, []);
  });

  it("a wrong key (401) and a rate-limited key (429) never reach the provider", async () => {
    const key = await activeKey();
    setEnv();
    mockProvider(GOOD_CREATIVE);
    assert.equal((await match(`blc_live_${"0".repeat(64)}`)).status, 401);
    assert.equal((await match(null)).status, 401);
    db.rateLimit = 1;
    assert.equal((await match(key)).status, 200); // no-fill + provider fill (1st request in window)
    const calls = fetchCalls.length;
    const limited = await match(key);
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), { error: "rate_limited" });
    assert.equal(fetchCalls.length, calls);
  });
});

describe("day 22 part 6 | every provider failure ends as the normal no-fill (200 {fill:false})", () => {
  const cases: Array<[string, () => void]> = [
    ["500 status", () => mockProvider({}, { status: 500 })],
    ["wrong content-type", () => mockProvider(GOOD_CREATIVE, { type: "text/html" })],
    ["malformed JSON", () => mockProvider(null, { raw: "{broken" })],
    ["JSON array", () => mockProvider([1, 2])],
    ["missing destination_url", () => mockProvider({ headline: "H", body: "B" })],
    ["http (not https) destination", () => mockProvider({ ...GOOD_CREATIVE, destination_url: "http://example.com/" })],
    ["javascript: destination", () => mockProvider({ ...GOOD_CREATIVE, destination_url: "javascript:alert(1)" })],
    ["IP address destination", () => mockProvider({ ...GOOD_CREATIVE, destination_url: "https://127.0.0.1/x" })],
    ["markup in headline", () => mockProvider({ ...GOOD_CREATIVE, headline: "<b>Buy</b>" })],
    ["encoded markup in body", () => mockProvider({ ...GOOD_CREATIVE, body: "&lt;script&gt;" })],
    ["executable key (html)", () => mockProvider({ ...GOOD_CREATIVE, html: "<script>x</script>" })],
    ["executable key (script)", () => mockProvider({ ...GOOD_CREATIVE, script: "x" })],
    ["network error", () => { globalThis.fetch = (async (input: unknown) => { fetchCalls.push(String(input)); throw new Error(`boom SECRETZONE77 ${DELIVERY}`); }) as typeof fetch; }],
  ];
  for (const [name, arrange] of cases) {
    it(name, async () => {
      const key = await activeKey();
      setEnv();
      arrange();
      const res = await match(key);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { fill: false });
    });
  }

  it("REVIVE_RESPONSE_FORMAT=html can never produce an ad (mapper rejects HTML)", async () => {
    const key = await activeKey();
    setEnv({ REVIVE_RESPONSE_FORMAT: "html" });
    mockProvider(null, { raw: "<div>ad</div>", type: "text/html" });
    assert.deepEqual(await (await match(key)).json(), { fill: false });
  });
});

describe("day 22 part 6 | the legacy /api/ads/match route behaves the same", () => {
  it("uses the same handler: provider ad there too, still no tracking", async () => {
    const key = await activeKey();
    setEnv();
    mockProvider(GOOD_CREATIVE);
    const res = await legacyRoute.POST(new Request("https://blisscco.test/api/ads/match", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "x-forwarded-for": "10.99.0.1" },
      body: '{"topic":"gaming"}',
    }));
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body.fill, true);
    assert.equal(body.sponsored, true);
    assert.ok(!("tracking" in body));
  });
});

describe("day 22 part 6 | static isolation", () => {
  it("match-handler reaches the fallback only through the neutral service entry point (no Revive, routing, provider or mapper names)", () => {
    const h = code("lib/ads/match-handler.ts");
    assert.match(h, /serveMatchForPublisher\(hashApiKey\(key\), matchRequest\)/);
    assert.ok(!/revive|fallback-routing|fallback-provider|serveAdWithFallback|buildProviderAdResponse|extractReviveCreative|publicAdFromFallbackFill/i.test(h));
    assert.ok(!/process\.env|\bfetch\(|createAdminClient/.test(h));
  });

  it("service.ts: serveAdForPublisher is unchanged; only service.ts calls the fallback path; no Revive name there", () => {
    const svc = read("lib/ads/service.ts");
    assert.match(svc, /export function serveAdForPublisher\(keyHash: string, request: MatchRequest\): Promise<ServeResult> \{\n  return serveAd\(keyHash, request, productionDeps\);\n\}/);
    assert.ok(!/revive/i.test(code("lib/ads/service.ts")));
    assert.match(svc, /routed\.source === "blisscco"\) return routed\.result/);
  });

  it("provider mapping never throws and never returns tracking; fallback-provider imports no database/billing code", () => {
    for (const bad of [null, undefined, 5, "x", [], {}, { provider: "revive", format: "json", data: null }, { provider: "other", format: "json", data: GOOD_CREATIVE }]) {
      assert.equal(publicAdFromFallbackFill(bad), null);
    }
    const ok = publicAdFromFallbackFill({ provider: "revive", format: "json", data: GOOD_CREATIVE });
    assert.ok(ok && !("tracking" in ok) && ok.sponsored === true);
    const imports = (code("lib/ads/fallback-provider.ts").match(/^\s*import\s[^;]+;/gm) ?? []).join("\n");
    assert.ok(!/supabase|serve-db|click-db|impression-db|ledger|payout|candidate-loader|selection|budget|server-only/i.test(imports));
  });

  it("no SQL, migration, package, workflow or .env file mentions the fallback; no financial file changed its names", () => {
    for (const f of readdirSync(join(ROOT, "supabase/sql"))) assert.ok(!/revive/i.test(read(`supabase/sql/${f}`)), f);
    assert.ok(!/revive/i.test(read("package.json")));
    for (const f of readdirSync(join(ROOT, ".github/workflows"))) assert.ok(!/revive/i.test(read(`.github/workflows/${f}`)), f);
    for (const f of readdirSync(ROOT).filter((n) => /^\.env/.test(n))) assert.ok(!/REVIVE_/.test(read(f)), f);
  });
});
