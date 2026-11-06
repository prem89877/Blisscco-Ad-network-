import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { PUBLIC_AD_FIELDS, PUBLIC_AD_OPTIONAL_FIELDS, buildAdResponse, buildProviderAdResponse, buildRichFields } from "@/lib/ads/contract";
import { isRichAdDeliveryEnabled } from "@/lib/ads/rich-assets";
import * as v1Route from "@/app/api/v1/ads/match/route";
import * as legacyRoute from "@/app/api/ads/match/route";

// Phase 4 Step 3B | API contract: optional brand_name / logo_url / image_url + purane 5 fields + backward compatibility.
// Database NAKLI hai (tests/register.cjs). Asli database, RLS, storage aur Preview deployment TEST par manually check hone baaki hain.

const KEY = `blc_live_${"c".repeat(64)}`;
const AD_ID = "3f2b8c1e-5a47-4d9e-9b62-7c1d8e4a6f10";
const ADV_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CAMP_ID = "33333333-3333-4333-8333-333333333333";
const PUBLISHER_ID = "99999999-9999-4999-8999-999999999999";
const LOGO_PATH = `${ADV_ID}/${CAMP_ID}/logo-c0c0c0c0-0000-4000-8000-000000000001.png`;
const BANNER_PATH = `${ADV_ID}/${CAMP_ID}/banner-c0c0c0c0-0000-4000-8000-000000000002.jpg`;
const ORIGIN = "https://preview.example.test";
const AUTH_OK = { outcome: "ok", publisher_id: PUBLISHER_ID, publisher_status: "active", unit_cost_usd: 0.002 };

type Reply = { data: unknown; error: { code?: string; message?: string } | null } | (() => never);
const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
let rpcNames: string[] = [];
const realConsoleError = console.error;
const savedFlag = process.env.RICH_AD_DELIVERY_ENABLED;

const richOk = (over: Record<string, unknown> = {}) => ({
  data: { outcome: "ok", advertiser_id: ADV_ID, campaign_id: CAMP_ID, brand_name: "Guitar House", logo_path: LOGO_PATH, banner_path: BANNER_PATH, ...over },
  error: null,
});

function candidateRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    creative_id: AD_ID, headline: "Level up your game nights", body: "Compare gaming laptops built for long sessions.",
    cta_text: "Shop now", destination_url: "https://example.com/gaming-laptops",
    creative_status: "approved", campaign_id: CAMP_ID, campaign_status: "active", category: "gaming",
    start_date: "2020-01-01", end_date: null, total_budget: 100, daily_budget: null, spent_total: 0, spent_today: 0,
    advertiser_status: "active", advertiser_profile_status: "active", campaign_serves_today: 0, creative_serves_today: 0,
    ...over,
  };
}

function setDb(over: Record<string, Reply> = {}) {
  const replies: Record<string, Reply> = {
    authorize_publisher_key: { data: AUTH_OK, error: null },
    load_ad_candidates: { data: [candidateRow()], error: null },
    record_ad_serve: { data: { outcome: "ok" }, error: null },
    get_creative_rich_assets: richOk(),
    ...over,
  };
  globals.__TEST_SUPABASE__ = {
    rpc: async (name: string) => {
      rpcNames.push(name);
      const reply = replies[name];
      if (!reply) throw new Error(`test: unexpected rpc ${name}`);
      return typeof reply === "function" ? reply() : reply;
    },
  };
}

type Body = { fill: boolean; sponsored?: boolean; ad?: Record<string, unknown>; tracking?: unknown; error?: string };
async function match(extraHeaders: Record<string, string> = {}, route: { POST: (r: Request) => Promise<Response> } = v1Route): Promise<{ status: number; text: string; json: Body }> {
  const res = await route.POST(
    new Request(`${ORIGIN}/api/v1/ads/match`, {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", ...extraHeaders },
      body: JSON.stringify({ topic: "gaming" }),
    }),
  );
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) as Body };
}

const sorted = (o: object) => Object.keys(o).sort();
const FIVE = [...PUBLIC_AD_FIELDS].sort();

beforeEach(() => {
  rpcNames = [];
  console.error = () => {};
  delete process.env.RICH_AD_DELIVERY_ENABLED;
  setDb();
});
afterEach(() => {
  console.error = realConsoleError;
  if (savedFlag === undefined) delete process.env.RICH_AD_DELIVERY_ENABLED;
  else process.env.RICH_AD_DELIVERY_ENABLED = savedFlag;
});

describe("step 3B contract | constants and flag", () => {
  it("the 5 existing public fields are unchanged and the 3 optional fields are exactly brand_name, logo_url, image_url", () => {
    assert.deepEqual([...PUBLIC_AD_FIELDS], ["id", "headline", "body", "cta_text", "destination_url"]);
    assert.deepEqual([...PUBLIC_AD_OPTIONAL_FIELDS], ["brand_name", "logo_url", "image_url"]);
  });
  it("RICH_AD_DELIVERY_ENABLED needs the exact value 1 (default OFF)", () => {
    assert.equal(isRichAdDeliveryEnabled({}), false);
    for (const v of ["", "0", "true", "TRUE", "yes", " 1", "1 ", "on"]) assert.equal(isRichAdDeliveryEnabled({ RICH_AD_DELIVERY_ENABLED: v }), false, v);
    assert.equal(isRichAdDeliveryEnabled({ RICH_AD_DELIVERY_ENABLED: "1" }), true);
  });
});

describe("step 3B contract | backward compatibility (flag OFF = exactly the old response)", () => {
  for (const [name, route] of [["v1", v1Route], ["legacy", legacyRoute]] as const) {
    it(`${name}: flag off => exactly the 5 fields and the rich lookup is never even called`, async () => {
      const res = await match({}, route);
      assert.equal(res.status, 200);
      assert.equal(res.json.fill, true);
      assert.equal(res.json.sponsored, true);
      assert.deepEqual(sorted(res.json.ad!), FIVE);
      assert.equal(rpcNames.includes("get_creative_rich_assets"), false);
      assert.equal(/brand_name|logo_url|image_url/.test(res.text), false);
    });
  }
  it("flag ON but the advertiser gave no rich data => still exactly the 5 fields", async () => {
    process.env.RICH_AD_DELIVERY_ENABLED = "1";
    setDb({ get_creative_rich_assets: richOk({ brand_name: null, logo_path: null, banner_path: null }) });
    assert.deepEqual(sorted((await match()).json.ad!), FIVE);
  });
  it("the values of the 5 fields do not change when rich fields are added", async () => {
    const plain = (await match()).json.ad!;
    process.env.RICH_AD_DELIVERY_ENABLED = "1";
    const rich = (await match()).json.ad!;
    for (const k of PUBLIC_AD_FIELDS) assert.equal(rich[k], plain[k], k);
  });
});

describe("step 3B contract | rich fields (flag ON)", () => {
  beforeEach(() => {
    process.env.RICH_AD_DELIVERY_ENABLED = "1";
  });

  it("adds brand_name, logo_url and image_url next to the 5 fields; URLs are this deployment's asset proxy", async () => {
    const res = await match();
    assert.equal(res.status, 200);
    assert.deepEqual(sorted(res.json.ad!), [...FIVE, ...PUBLIC_AD_OPTIONAL_FIELDS].sort());
    assert.equal(res.json.ad!.brand_name, "Guitar House");
    assert.equal(res.json.ad!.logo_url, `${ORIGIN}/api/v1/ads/asset/${AD_ID}?kind=logo`);
    assert.equal(res.json.ad!.image_url, `${ORIGIN}/api/v1/ads/asset/${AD_ID}?kind=image`);
  });

  it("never leaks storage paths, bucket name, signed-URL parts, advertiser or campaign ids", async () => {
    const { text } = await match();
    for (const secret of [LOGO_PATH, BANNER_PATH, ADV_ID, CAMP_ID, "creative-assets", "logo-c0c0", "banner-c0c0", "token=", "signature", "supabase", PUBLISHER_ID]) {
      assert.equal(text.includes(secret), false, secret);
    }
  });

  it("each rich field is independent: brand only, logo only, image only", async () => {
    setDb({ get_creative_rich_assets: richOk({ logo_path: null, banner_path: null }) });
    assert.deepEqual(sorted((await match()).json.ad!), [...FIVE, "brand_name"].sort());
    setDb({ get_creative_rich_assets: richOk({ brand_name: null, banner_path: null }) });
    assert.deepEqual(sorted((await match()).json.ad!), [...FIVE, "logo_url"].sort());
    setDb({ get_creative_rich_assets: richOk({ brand_name: null, logo_path: null }) });
    assert.deepEqual(sorted((await match()).json.ad!), [...FIVE, "image_url"].sort());
  });

  it("a brand name with markup / control characters is dropped (images still work)", async () => {
    for (const bad of ["<script>alert(1)</script>", "Tom &amp; Jerry", "a\u0000b", "x".repeat(81), "   "]) {
      setDb({ get_creative_rich_assets: richOk({ brand_name: bad }) });
      const ad = (await match()).json.ad!;
      assert.equal("brand_name" in ad, false, JSON.stringify(bad));
      assert.equal(typeof ad.logo_url, "string");
    }
  });

  it("an image path that belongs to another advertiser or campaign never becomes a URL", async () => {
    const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    setDb({ get_creative_rich_assets: richOk({ logo_path: LOGO_PATH.replace(ADV_ID, other), banner_path: BANNER_PATH.replace(CAMP_ID, other) }) });
    const ad = (await match()).json.ad!;
    assert.equal("logo_url" in ad, false);
    assert.equal("image_url" in ad, false);
    assert.equal(ad.brand_name, "Guitar House");
  });

  it("a banner path stored as a logo (wrong kind prefix) never becomes a logo URL", async () => {
    setDb({ get_creative_rich_assets: richOk({ logo_path: BANNER_PATH }) });
    assert.equal("logo_url" in (await match()).json.ad!, false);
  });

  it("lookup failures (not_found, rpc error, thrown, garbage shape) => normal 200 text-only ad", async () => {
    const cases: Reply[] = [
      { data: { outcome: "not_found" }, error: null },
      { data: null, error: { code: "XX000", message: "boom internal secret" } },
      () => { throw new Error("db down"); },
      { data: "garbage", error: null },
      { data: { outcome: "ok", advertiser_id: "nope", campaign_id: CAMP_ID, brand_name: "x", logo_path: null, banner_path: null }, error: null },
    ];
    for (const reply of cases) {
      setDb({ get_creative_rich_assets: reply });
      const res = await match();
      assert.equal(res.status, 200);
      assert.deepEqual(sorted(res.json.ad!), FIVE);
      assert.equal(res.text.includes("secret"), false);
    }
  });

  it("billing / serve isolation: the only extra rpc is the read-only lookup, and it runs AFTER the serve is recorded", async () => {
    await match();
    assert.deepEqual(rpcNames, ["authorize_publisher_key", "load_ad_candidates", "record_ad_serve", "get_creative_rich_assets"]);
    for (const n of rpcNames) assert.equal(/ledger|payout|earning|revenue|spend|impression|click/i.test(n), false, n);
  });

  it("an ad that is not recorded (rejected by the database) gets no rich lookup and no ad", async () => {
    setDb({ record_ad_serve: { data: { outcome: "rejected" }, error: null } });
    const res = await match();
    assert.deepEqual(res.json, { fill: false });
    assert.equal(rpcNames.includes("get_creative_rich_assets"), false);
  });

  it("no-fill stays {fill:false} and does no rich lookup", async () => {
    setDb({ load_ad_candidates: { data: [], error: null } });
    const res = await match();
    assert.deepEqual(res.json, { fill: false });
    assert.equal(rpcNames.includes("get_creative_rich_assets"), false);
  });

  it("an idempotent retry (same Idempotency-Key) returns the same ad WITH rich fields", async () => {
    setDb({
      find_idempotent_serve: {
        data: { outcome: "found", ad: { id: AD_ID, headline: "H", body: "B", cta_text: null, destination_url: "https://example.com/x" } },
        error: null,
      },
    });
    const res = await match({ "idempotency-key": "retry-key-12345678" });
    assert.equal(res.status, 200);
    assert.equal(res.json.ad!.id, AD_ID);
    assert.equal(res.json.ad!.logo_url, `${ORIGIN}/api/v1/ads/asset/${AD_ID}?kind=logo`);
    assert.equal(rpcNames.includes("record_ad_serve"), false, "a replay is never charged again");
  });

  it("response headers are unchanged: no-store, Vary: Authorization, API version", async () => {
    const res = await v1Route.POST(
      new Request(`${ORIGIN}/api/v1/ads/match`, { method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" }, body: JSON.stringify({ topic: "gaming" }) }),
    );
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("vary"), "Authorization");
    assert.equal(res.headers.get("x-blisscco-api-version"), "1");
  });
});

describe("step 3B contract | mapper rules (pure)", () => {
  const ad = { id: AD_ID, headline: "H", body: "B", ctaText: null, destinationUrl: "https://example.com/x" };

  it("buildAdResponse without rich is byte-identical to the old contract", () => {
    assert.deepEqual(buildAdResponse(ad), { fill: true, sponsored: true, ad: { id: AD_ID, headline: "H", body: "B", cta_text: null, destination_url: "https://example.com/x" } });
  });

  it("buildAdResponse passes only the 3 optional keys and only string values (extra keys / wrong types are dropped)", () => {
    const res = buildAdResponse(ad, undefined, { brand_name: "B", logo_url: "https://x/l", image_url: 5 as unknown as string, secret: "s" } as never);
    assert.deepEqual(sorted(res.ad), [...FIVE, "brand_name", "logo_url"].sort());
    assert.equal("secret" in res.ad, false);
  });

  it("buildRichFields: needs a safe https asset base (http only for localhost), otherwise no URLs", () => {
    const rich = { brandName: "Brand", hasLogo: true, hasImage: true };
    assert.deepEqual(buildRichFields(AD_ID, rich, null), { brand_name: "Brand" });
    assert.equal(buildRichFields(AD_ID, { brandName: null, hasLogo: true, hasImage: false }, null), undefined);
    assert.equal(buildRichFields("not-a-uuid", { brandName: null, hasLogo: true, hasImage: true }, ORIGIN), undefined);
    assert.equal(buildRichFields(AD_ID, undefined, ORIGIN), undefined);
  });

  it("provider (Revive) responses are unchanged: only the 5 fields, never brand / logo / image", () => {
    const out = buildProviderAdResponse("revive", { headline: "Provider ad", body: "Body", ctaText: "Go", destinationUrl: "https://example.com/p" });
    assert.ok(out.ok);
    assert.deepEqual(sorted(out.response.ad), FIVE);
  });
});
