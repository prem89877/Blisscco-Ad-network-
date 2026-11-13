import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildAdResponse, buildProviderAdResponse, hasSafeDestination, PUBLIC_AD_FIELDS } from "@/lib/ads/contract";
import * as v1Route from "@/app/api/v1/ads/match/route";
import * as legacyRoute from "@/app/api/ads/match/route";

// Phase 6 Day 3 Part 1 (N1): advertiser ki apni destination_url ab response se PEHLE safeDestination rules se dobara jaanchi jaati hai.
// Regression: valid HTTPS, HTTP, credentials, malformed, unsafe (IP/localhost/single-label/whitespace/javascript:). Provider path ka behaviour same rehta hai.
// Database NAKLI hai (tests/register.cjs). Koi network/SQL/env nahi.

const ROOT = path.join(__dirname, "..", "..", "..");
const KEY = `blc_live_${"d".repeat(64)}`;
const AD_ID = "3f2b8c1e-5a47-4d9e-9b62-7c1d8e4a6f10";
const PUBLISHER_ID = "99999999-9999-4999-8999-999999999999";
const CAMPAIGN_ID = "33333333-3333-4333-8333-333333333333";
const AUTH_OK = { outcome: "ok", publisher_id: PUBLISHER_ID, publisher_status: "active", unit_cost_usd: 0.002 };
const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
let rpcNames: string[] = [];

function candidateRow(destination: string): Record<string, unknown> {
  return {
    creative_id: AD_ID, headline: "Level up your game nights", body: "Compare gaming laptops built for long sessions.",
    cta_text: "Shop now", destination_url: destination,
    creative_status: "approved", campaign_id: CAMPAIGN_ID, campaign_status: "active", category: "gaming",
    start_date: "2020-01-01", end_date: null, total_budget: 100, daily_budget: null, spent_total: 0, spent_today: 0,
    advertiser_status: "active", advertiser_profile_status: "active", campaign_serves_today: 0, creative_serves_today: 0,
  };
}

function setDb(destination: string) {
  const replies: Record<string, { data: unknown; error: null }> = {
    authorize_publisher_key: { data: AUTH_OK, error: null },
    load_ad_candidates: { data: [candidateRow(destination)], error: null },
    record_ad_serve: { data: { outcome: "ok" }, error: null },
  };
  globals.__TEST_SUPABASE__ = {
    rpc: async (name: string) => {
      rpcNames.push(name);
      const reply = replies[name];
      if (!reply) throw new Error(`test: unexpected rpc ${name}`);
      return reply;
    },
  };
}

beforeEach(() => { rpcNames = []; });
afterEach(() => { delete globals.__TEST_SUPABASE__; });

const ad = (destinationUrl: unknown) => ({ id: AD_ID, headline: "h", body: "b", ctaText: null, destinationUrl }) as Parameters<typeof hasSafeDestination>[0];

const VALID = ["https://example.com", "https://example.com/gaming-laptops", "https://shop.example.com:8443/a/b?x=1&y=2#top", "https://example.com/a@b"];
const HTTP = ["http://example.com", "http://example.com/a", "HTTP://EXAMPLE.COM"];
const CREDENTIALS = ["https://user:pw@example.com", "https://user@example.com", "https://trusted.com@evil.example/x", "https://:pw@example.com"];
const MALFORMED = ["", "not a url", "https://", "https:///x", "//example.com", "example.com", "https//example.com", "https://exa mple.com"];
const UNSAFE = [
  "javascript:alert(1)", "data:text/html,<b>x</b>", "ftp://example.com", "file:///etc/passwd",
  "https://127.0.0.1/x", "https://10.0.0.5/x", "https://[::1]/x", "https://localhost/x", "https://intranet/x", "https://example.com./x",
  " https://example.com", "https://example.com ", "https://example.com/a\nb", `https://example.com/${"a".repeat(2100)}`,
];

describe("hasSafeDestination (same rules as safeDestination)", () => {
  it("accepts valid HTTPS URLs", () => {
    for (const u of VALID) assert.equal(hasSafeDestination(ad(u)), true, u);
  });
  it("rejects HTTP URLs", () => {
    for (const u of HTTP) assert.equal(hasSafeDestination(ad(u)), false, u);
  });
  it("rejects credentials in URLs", () => {
    for (const u of CREDENTIALS) assert.equal(hasSafeDestination(ad(u)), false, u);
  });
  it("rejects malformed URLs", () => {
    for (const u of MALFORMED) assert.equal(hasSafeDestination(ad(u)), false, JSON.stringify(u));
  });
  it("rejects unsafe destinations (non-https scheme, IP, localhost, single-label host, whitespace, too long)", () => {
    for (const u of UNSAFE) assert.equal(hasSafeDestination(ad(u)), false, JSON.stringify(u.slice(0, 60)));
  });
  it("fails closed (false, never throws) for non-string or missing destination", () => {
    for (const v of [undefined, null, 5, {}, [], true]) assert.equal(hasSafeDestination(ad(v)), false, String(v));
    assert.equal(hasSafeDestination(null as never), false);
    assert.equal(hasSafeDestination(undefined as never), false);
  });
});

describe("buildAdResponse itself is unchanged (public contract, no URL rewriting)", () => {
  it("passes a valid URL through exactly as given, with only the 5 public ad fields", () => {
    const res = buildAdResponse(ad("https://example.com"));
    assert.deepEqual(res, { fill: true, sponsored: true, ad: { id: AD_ID, headline: "h", body: "b", cta_text: null, destination_url: "https://example.com" } });
    assert.deepEqual(Object.keys(res.ad).sort(), [...PUBLIC_AD_FIELDS].sort());
  });
});

for (const route of [
  { name: "v1", url: "/api/v1/ads/match", post: (r: Request) => v1Route.POST(r) },
  { name: "legacy", url: "/api/ads/match", post: (r: Request) => legacyRoute.POST(r) },
]) {
  const go = async () => {
    const res = await route.post(new Request(`https://blisscco.test${route.url}`, {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", "x-blisscco-tracking": "1" },
      body: '{"topic":"gaming"}',
    }));
    const text = await res.text();
    return { status: res.status, text, json: JSON.parse(text) as Record<string, unknown> };
  };

  describe(`${route.name}: match handler destination safety`, () => {
    it("valid HTTPS destination => fill:true, destination_url unchanged", async () => {
      for (const u of VALID) {
        setDb(u);
        const res = await go();
        assert.equal(res.status, 200, u);
        assert.equal(res.json.fill, true, u);
        assert.equal((res.json.ad as { destination_url: string }).destination_url, u, u);
      }
    });

    it("IP / localhost / single-label host reaches the serve stage but is NOT returned: exact { fill:false }, no ad, no tracking", async () => {
      for (const u of ["https://127.0.0.1/x", "https://10.0.0.5/x", "https://localhost/x", "https://intranet/x"]) {
        setDb(u);
        const res = await go();
        assert.equal(res.status, 200, u);
        assert.deepEqual(res.json, { fill: false }, u);
        assert.equal(res.text.includes(u), false, `${u} must not leak into the response`);
        assert.equal("ad" in res.json || "tracking" in res.json, false, u);
      }
    });

    it("HTTP, credentials and malformed destinations never produce an ad (no-fill)", async () => {
      for (const u of [...HTTP, ...CREDENTIALS, "not a url", "https://", "https://exa mple.com"]) {
        setDb(u);
        const res = await go();
        assert.equal(res.status, 200, u);
        assert.deepEqual(res.json, { fill: false }, u);
        assert.equal(res.text.includes("destination_url"), false, u);
      }
    });

    it("unsafe destination never turns into an error (no 5xx) and never reaches an impression/click path", async () => {
      setDb("https://localhost/x");
      const res = await go();
      assert.equal(res.status, 200);
      assert.equal(rpcNames.some((n) => /impression|click/.test(n)), false);
    });
  });
}

describe("provider fallback path keeps its existing safeDestination behaviour", () => {
  const creative = (destinationUrl: string) => ({ headline: "Headline", body: "Body text", ctaText: "Go", destinationUrl });

  it("valid HTTPS => ok, response without tracking key", () => {
    const out = buildProviderAdResponse("revive", creative("https://example.com/p"));
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.response.ad.destination_url, "https://example.com/p");
      assert.equal("tracking" in out.response, false);
    }
  });

  it("HTTP, credentials, malformed and unsafe => rejected as unsafe_destination", () => {
    for (const u of [...HTTP, ...CREDENTIALS, "not a url", "https://", "https://127.0.0.1/x", "https://localhost/x", "javascript:alert(1)"]) {
      assert.deepEqual(buildProviderAdResponse("revive", creative(u)), { ok: false, reason: "unsafe_destination" }, u);
    }
  });
});

describe("wiring", () => {
  it("match-handler validates the destination BEFORE buildAdResponse and returns no-fill on failure", () => {
    const src = readFileSync(path.join(ROOT, "lib", "ads", "match-handler.ts"), "utf8");
    const check = src.indexOf("hasSafeDestination(result.ad)");
    const build = src.indexOf("buildAdResponse(result.ad");
    assert.ok(check > 0 && build > 0 && check < build, "hasSafeDestination must run before buildAdResponse");
    assert.match(src, /if \(!hasSafeDestination\(result\.ad\)\) return json\(\{ fill: false \}, 200\);/);
  });
});
