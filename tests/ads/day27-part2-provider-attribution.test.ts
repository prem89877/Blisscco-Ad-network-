// Day 27 Part 2: provider attribution stays consistent across the Revive fallback path.
// Existing contract (lib/ads/contract.ts): `provider` is INTERNAL only. The public response carries no provider field; a provider ad is recognisable
// ONLY by its id "<provider>_<8 hex>" (e.g. revive_1a2b3c4d), which is never a UUID, so it can never be mistaken for a Blisscco campaign/ad id.
// Real route -> match-handler -> service -> fallback-routing -> fallback-provider -> revive-adapter; in-memory DB stubs; mocked fetch; no network.
import { HARNESS_CREATIVE, HARNESS_DELIVERY_URL, HARNESS_ERROR_MARKER } from "./helpers/day26-revive-provider-harness";
import { buildProviderAdResponse } from "@/lib/ads/contract";
import { extractReviveCreative } from "@/lib/ads/revive-adapter";
import { publicAdFromFallbackFill } from "@/lib/ads/fallback-provider";
import { routeServeWithFallback } from "@/lib/ads/fallback-routing";
import { isUuid } from "@/lib/campaigns/constants";
import type { MatchRequest } from "@/lib/ads/types";
import type { ServeResult } from "@/lib/ads/serve";
import { db, installDb } from "../workflows/publisher-flow-stubs";
import { setupPublisher } from "@/app/dashboard/account/actions";
import { createKey } from "@/app/dashboard/publisher/actions";
import { adminDecision } from "@/app/dashboard/admin/actions";
import * as v1Route from "@/app/api/v1/ads/match/route";
import * as impressionRoute from "@/app/api/v1/ads/impression/route";
import * as clickRoute from "@/app/api/v1/ads/click/route";
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

const idle = { status: "idle" } as never;
const REVIVE_ID = /^revive_[0-9a-f]{8}$/;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENV_KEYS = ["REVIVE_FALLBACK_ENABLED", "REVIVE_DELIVERY_URL", "REVIVE_TIMEOUT_MS", "REVIVE_RESPONSE_FORMAT", "AD_TRACKING_SECRET"] as const;
const savedEnv: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
const realConsole = { error: console.error, log: console.log, warn: console.warn, info: console.info };
let logs: unknown[][] = [];
let ipCounter = 0;
let fetchCalls = 0;

function provider(body: unknown, init: { status?: number; type?: string } = {}): void {
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === "string" ? input : String((input as { url?: unknown } | null)?.url ?? "");
    assert.equal(url, HARNESS_DELIVERY_URL, "only the test-only URL may be requested");
    fetchCalls += 1;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: init.status ?? 200, headers: { "content-type": init.type ?? "application/json" } });
  }) as typeof fetch;
}
beforeEach(() => {
  db.reset();
  installDb();
  logs = [];
  fetchCalls = 0;
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  process.env.REVIVE_FALLBACK_ENABLED = "true";
  process.env.REVIVE_DELIVERY_URL = HARNESS_DELIVERY_URL;
  process.env.REVIVE_TIMEOUT_MS = "25";
  process.env.AD_TRACKING_SECRET = "day27-p2-0123456789-abcdefghijklmnopqrstuvwxyz-test-only";
  const sink = (...a: unknown[]) => void logs.push(a);
  console.error = sink; console.log = sink; console.warn = sink; console.info = sink;
  globalThis.fetch = (async () => { throw new Error("test: no provider installed"); }) as typeof fetch;
});
afterEach(() => {
  Object.assign(console, realConsole);
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  const text = JSON.stringify(logs);
  for (const s of [HARNESS_ERROR_MARKER, "day27-p2-0123"]) assert.ok(!text.includes(s), `leaked into a log: ${s}`);
});

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}
async function run(p: Promise<unknown>): Promise<unknown> {
  try { return await p; } catch (e) { if (/^REDIRECT:/.test(e instanceof Error ? e.message : "")) return undefined; throw e; }
}
async function activeKey(): Promise<string> {
  await run(setupPublisher(idle, form({ name: "My Bot", websiteUrl: "https://bot.example.com", category: "gaming" })));
  await run(adminDecision(idle, form({ kind: "publisher", id: db.publisher!.id, decision: "active" })));
  return ((await createKey(idle, form({ label: "Prod server", expiry: "90" }))) as { newKey: string }).newKey;
}
function match(key: string, body = '{"topic":"gaming"}', extra: Record<string, string> = {}): Promise<Response> {
  return v1Route.POST(new Request("https://blisscco.test/api/v1/ads/match", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "x-forwarded-for": `10.27.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`, ...extra },
    body,
  }));
}
const serveRpcs = () => db.rpcCalls.filter((c) => c.name === "record_ad_serve").length;
const writeRpcs = () => db.rpcCalls.filter((c) => /^record_ad_|ledger|earning|payout|impression|click/i.test(c.name));

describe("day 27 part 2 | provider-prefixed ids are never Blisscco UUIDs", () => {
  it("buildProviderAdResponse: id is exactly '<provider>_<8 hex>', deterministic, input-dependent, and never UUID-shaped", () => {
    const creative = { headline: "Hello", body: "World", ctaText: "Go", destinationUrl: "https://example.com/a" };
    const a = buildProviderAdResponse("revive", creative);
    const b = buildProviderAdResponse("revive", creative);
    const c = buildProviderAdResponse("revive", { ...creative, headline: "Hello 2" });
    assert.ok(a.ok && b.ok && c.ok);
    if (!(a.ok && b.ok && c.ok)) return;
    assert.match(a.response.ad.id, REVIVE_ID);
    assert.equal(a.response.ad.id, b.response.ad.id);
    assert.notEqual(a.response.ad.id, c.response.ad.id);
    assert.equal(isUuid(a.response.ad.id), false);
    assert.ok(!UUID_SHAPE.test(a.response.ad.id));
    assert.equal(a.provider, "revive");
    assert.ok(!("provider" in a.response) && !("provider" in a.response.ad));
    assert.deepEqual(Object.keys(a.response).sort(), ["ad", "fill", "sponsored"]);
    const other = buildProviderAdResponse("acme_ads", creative);
    assert.ok(other.ok && /^acme_ads_[0-9a-f]{8}$/.test(other.response.ad.id));
  });

  it("no provider-looking id can pass the UUID check used for Blisscco ids", () => {
    for (const id of ["revive_1a2b3c4d", "revive_00000000", "revive_ffffffff", "revive_1a2b3c4d-0000-4000-8000-000000000000"]) {
      assert.equal(isUuid(id), false, id);
    }
    assert.equal(isUuid("00000000-0000-4000-8000-000000000001"), true);
  });

  it("route: a provider id in exclude_ad_ids is rejected as invalid_request (400); no provider call, no serve, no write RPC", async () => {
    const key = await activeKey();
    provider(HARNESS_CREATIVE);
    const first = await (await match(key)).json() as { ad: { id: string } };
    assert.match(first.ad.id, REVIVE_ID);
    const callsBefore = fetchCalls;
    for (const ids of [[first.ad.id], [first.ad.id, "00000000-0000-4000-8000-000000000001"], ["revive_00000000"]]) {
      const res = await match(key, JSON.stringify({ topic: "gaming", exclude_ad_ids: ids }));
      assert.equal(res.status, 400);
      assert.equal(await res.text(), '{"error":"invalid_request","reason":"invalid_exclude_ad_ids"}');
    }
    assert.equal(fetchCalls, callsBefore);
    assert.equal(serveRpcs(), 0);
  });

  it("route: a provider id used as an impression token or click ref is rejected; no impression/click write RPC, no redirect", async () => {
    const key = await activeKey();
    provider(HARNESS_CREATIVE);
    const id = ((await (await match(key, '{"topic":"gaming"}', { "x-blisscco-tracking": "1" })).json()) as { ad: { id: string } }).ad.id;
    db.rpcCalls = [];
    const imp = await impressionRoute.POST(new Request("https://blisscco.test/api/v1/ads/impression", {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.27.250.1" }, body: JSON.stringify({ token: id, event: "impression" }),
    }));
    assert.equal(imp.status, 401);
    assert.equal(await imp.text(), '{"error":"unauthorized"}');
    const clk = await clickRoute.GET(new Request(`https://blisscco.test/api/v1/ads/click?ref=${encodeURIComponent(id)}`, { headers: { "x-forwarded-for": "10.27.250.2" } }));
    assert.notEqual(clk.status, 302);
    assert.equal(clk.headers.get("location"), null);
    assert.deepEqual(writeRpcs(), []);
  });
});

describe("day 27 part 2 | a Revive response carries no Blisscco tracking, refs or internal provider data", () => {
  const FORBIDDEN = ["bt1.", "bc1.", "tracking", "click_ref", "token", "impression", "serve_ref", "provider", "HARNESS", "day26-harness", ".invalid", "REVIVE_", "campaign", "creative_id", "Set-Cookie"];

  it("with the tracking opt-in header: exactly {fill,sponsored,ad}, id is revive_*, and the body and headers contain none of the forbidden markers", async () => {
    const key = await activeKey();
    provider(HARNESS_CREATIVE);
    const res = await match(key, '{"topic":"gaming"}', { "x-blisscco-tracking": "1" });
    assert.equal(res.status, 200);
    const text = await res.text();
    const body = JSON.parse(text) as { fill: boolean; sponsored: boolean; ad: Record<string, unknown> };
    assert.deepEqual(Object.keys(body).sort(), ["ad", "fill", "sponsored"]);
    assert.deepEqual(Object.keys(body.ad).sort(), ["body", "cta_text", "destination_url", "headline", "id"]);
    assert.match(String(body.ad.id), REVIVE_ID);
    assert.equal(body.ad.destination_url, HARNESS_CREATIVE.destination_url, "destination is the provider's own safe URL, not a Blisscco click redirect");
    assert.ok(!String(body.ad.destination_url).includes("blisscco"));
    // The revive_<hex> id is the ONLY place the provider name may appear; remove it, then nothing provider/internal may remain.
    const all = `${text.split(String(body.ad.id)).join("")}\n${JSON.stringify([...res.headers.entries()])}`;
    for (const s of FORBIDDEN) assert.ok(!all.toLowerCase().includes(s.toLowerCase()), `response contains ${s}`);
    assert.ok(!all.toLowerCase().includes("revive"), "provider name appears only inside the id");
    assert.equal(serveRpcs(), 0);
    assert.deepEqual(writeRpcs(), []);
  });

  it("provider-supplied extra fields (tracking, click_ref, id, provider, token) never reach the public response", async () => {
    const key = await activeKey();
    const injected = {
      ...HARNESS_CREATIVE,
      tracking: { token: "bt1.AAAA.BBBB" }, click_ref: "bc1.AAAA.BBBB", token: "bt1.AAAA.BBBB",
      id: "00000000-0000-4000-8000-000000000001", provider: "blisscco", campaign_id: "00000000-0000-4000-8000-000000000002",
    };
    provider(injected);
    const res = await match(key, '{"topic":"gaming"}', { "x-blisscco-tracking": "1" });
    const text = await res.text();
    for (const s of ["bt1.", "bc1.", "00000000-0000-4000", "blisscco", "click_ref", "tracking", "campaign"]) assert.ok(!text.includes(s), `leaked ${s}`);
    const body = JSON.parse(text) as Record<string, unknown>;
    if (body.fill === true) assert.match(String((body.ad as { id: string }).id), REVIVE_ID);
    else assert.deepEqual(body, { fill: false });
    assert.equal(serveRpcs(), 0);
    assert.deepEqual(writeRpcs(), []);
  });
});

describe("day 27 part 2 | malformed or missing provider attribution => existing no-fill, no Blisscco record", () => {
  const BAD_PROVIDERS: unknown[] = [undefined, null, "", " ", "Revive", "REVIVE", "revive-x", "1revive", "re vive", "a".repeat(31), 7, {}, [], "revive\n"];

  it("buildProviderAdResponse rejects every malformed provider name with invalid_provider (never throws)", () => {
    const creative = { headline: "h", body: "b", ctaText: null, destinationUrl: "https://example.com/a" };
    for (const p of BAD_PROVIDERS) {
      const out = buildProviderAdResponse(p as string, creative);
      assert.deepEqual(out, { ok: false, reason: "invalid_provider" }, String(p));
    }
  });

  it("publicAdFromFallbackFill / extractReviveCreative: missing, wrong or non-string provider => null / not_a_fill", () => {
    const data = { ...HARNESS_CREATIVE };
    const fills: unknown[] = [
      undefined, null, "revive", 5, {}, { format: "json", data },
      { provider: "", format: "json", data }, { provider: 7, format: "json", data }, { provider: "other", format: "json", data },
      { provider: "Revive", format: "json", data }, { provider: "revive", format: "xml", data }, { provider: "revive", format: "json", data: null },
      { provider: "revive", format: "json", data: [] }, { provider: "revive", format: "html", data: "<b>x</b>" },
    ];
    for (const f of fills) assert.equal(publicAdFromFallbackFill(f), null, JSON.stringify(f));
    for (const f of [undefined, null, {}, { provider: "other", format: "json", data }]) assert.deepEqual(extractReviveCreative(f), { ok: false, reason: "not_a_fill" });
    const good = publicAdFromFallbackFill({ provider: "revive", format: "json", data });
    assert.ok(good && /^revive_[0-9a-f]{8}$/.test(good.ad.id));
  });

  it("routeServeWithFallback (DI): a provider outcome with bad attribution is dropped => Blisscco no_fill; nothing else is invoked", async () => {
    const request = { topic: "gaming" } as unknown as MatchRequest;
    const bad: unknown[] = [
      { provider: "", format: "json", data: { a: 1 } }, { provider: undefined, format: "json", data: { a: 1 } }, { format: "json", data: { a: 1 } },
      { provider: 5, format: "json", data: { a: 1 } }, { provider: "revive", format: "pdf", data: {} }, { provider: "revive", format: "json", data: "str" },
      { provider: "revive", format: "json", data: null }, { provider: "revive", format: "html", data: "   " }, "revive", 42,
    ];
    let serves = 0;
    for (const out of bad) {
      const routed = await routeServeWithFallback("hash", request, {
        serve: async () => { serves += 1; return { kind: "no_fill" } as ServeResult; },
        isEnabled: () => true,
        request: async () => out as never,
      });
      assert.equal(routed.source, "blisscco", JSON.stringify(out));
      assert.deepEqual(routed.source === "blisscco" ? routed.result : null, { kind: "no_fill" });
    }
    assert.equal(serves, bad.length, "only Blisscco's own serve ran, once per request");
  });

  it("route: provider replies that cannot be attributed (missing fields, wrong types, empty, non-object) => exactly {fill:false}, no serve or write RPC", async () => {
    const key = await activeKey();
    const bodies: unknown[] = [
      {}, { headline: "only" }, { ...HARNESS_CREATIVE, headline: 5 }, { ...HARNESS_CREATIVE, destination_url: null }, { ...HARNESS_CREATIVE, headline: "<b>x</b>" },
      [], "just text", 12, null, { ...HARNESS_CREATIVE, script: "alert(1)" },
    ];
    for (const b of bodies) {
      provider(typeof b === "string" ? b : JSON.stringify(b));
      db.rpcCalls = [];
      const res = await match(key);
      assert.equal(res.status, 200);
      assert.equal(await res.text(), '{"fill":false}', JSON.stringify(b));
      assert.equal(serveRpcs(), 0);
      assert.deepEqual(db.serves, []);
      assert.deepEqual(writeRpcs(), []);
    }
    assert.equal(fetchCalls, bodies.length);
  });
});
