import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as assetRoute from "@/app/api/v1/ads/asset/[id]/route";
import { makeJpeg, makePng, makeWebpExtended } from "../campaigns/image-fixtures";

// Phase 4 Step 3B | asset proxy GET /api/v1/ads/asset/[id]: image access security.
// Database + storage NAKLI hain. get_creative_rich_assets ke SQL niyam yahan sirf NAKAL kiye gaye hain (emulateEligibility): asli SQL,
// RLS aur private bucket TEST database par manually check hone baaki hain (checks R1-R5 SQL file ke footer me).

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

const ADV_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ADV_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CAMP_A = "a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1";
const CAMP_B = "b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1";
const CAMP_A2 = "a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2";
const uid = (n: number) => `c0c0c0c0-0000-4000-8000-${String(n).padStart(12, "0")}`;
const cid = (n: number) => `d${String(n).padStart(7, "0")}-0000-4000-8000-000000000000`;

const LOGO_A = `${ADV_A}/${CAMP_A}/logo-${uid(1)}.png`;
const BANNER_A = `${ADV_A}/${CAMP_A}/banner-${uid(2)}.jpg`;
const LOGO_B = `${ADV_B}/${CAMP_B}/logo-${uid(3)}.png`;
const BANNER_B = `${ADV_B}/${CAMP_B}/banner-${uid(4)}.webp`;

type Creative = { id: string; status: string; campaign: string; logo: string | null; banner: string | null; brand?: string };
type Campaign = { id: string; advertiser: string; status: string };
type Advertiser = { id: string; status: string; profileStatus: string };

const advertisers: Advertiser[] = [];
const campaigns: Campaign[] = [];
const creatives: Creative[] = [];
const objects = new Map<string, Uint8Array>();
let rpcCalls: { name: string; args: unknown }[] = [];
let storageCalls: { bucket: string; op: string; path: string }[] = [];
let rpcMode: "normal" | "error" | "throw" = "normal";

const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
const savedFlag = process.env.RICH_AD_DELIVERY_ENABLED;
const realConsoleError = console.error;

/** SQL get_creative_rich_assets ka niyam: approved + campaign active + advertiser active + profile active. */
function emulateEligibility(id: string): Record<string, unknown> {
  const x = creatives.find((c) => c.id === id);
  const c = x && campaigns.find((k) => k.id === x.campaign);
  const a = c && advertisers.find((k) => k.id === c.advertiser);
  if (!x || !c || !a || x.status !== "approved" || c.status !== "active" || a.status !== "active" || a.profileStatus !== "active") return { outcome: "not_found" };
  return { outcome: "ok", advertiser_id: c.advertiser, campaign_id: c.id, brand_name: x.brand ?? null, logo_path: x.logo, banner_path: x.banner };
}

function reset() {
  advertisers.splice(0, advertisers.length, { id: ADV_A, status: "active", profileStatus: "active" }, { id: ADV_B, status: "active", profileStatus: "active" });
  campaigns.splice(0, campaigns.length,
    { id: CAMP_A, advertiser: ADV_A, status: "active" },
    { id: CAMP_A2, advertiser: ADV_A, status: "active" },
    { id: CAMP_B, advertiser: ADV_B, status: "active" },
  );
  creatives.splice(0, creatives.length, { id: cid(1), status: "approved", campaign: CAMP_A, logo: LOGO_A, banner: BANNER_A, brand: "Guitar House" });
  objects.clear();
  objects.set(LOGO_A, makePng(256, 256));
  objects.set(BANNER_A, makeJpeg(1200, 628));
  objects.set(LOGO_B, makePng(300, 300));
  objects.set(BANNER_B, makeWebpExtended(1200, 628));
  rpcCalls = [];
  storageCalls = [];
  rpcMode = "normal";
}

function install() {
  globals.__TEST_SUPABASE__ = {
    rpc: async (name: string, args: { p_creative_id?: string }) => {
      rpcCalls.push({ name, args });
      if (name !== "get_creative_rich_assets") throw new Error(`test: unexpected rpc ${name}`);
      if (rpcMode === "throw") throw new Error("db down");
      if (rpcMode === "error") return { data: null, error: { code: "XX000", message: "internal secret detail" } };
      return { data: emulateEligibility(String(args.p_creative_id)), error: null };
    },
    storage: {
      from: (bucket: string) => ({
        download: async (p: string) => {
          storageCalls.push({ bucket, op: "download", path: p });
          const bytes = objects.get(p);
          if (!bytes) return { data: null, error: { message: "Object not found" } };
          return { data: new Blob([bytes as BlobPart]), error: null };
        },
      }),
    },
  };
}

async function get(id: string, query = "kind=image"): Promise<Response> {
  return assetRoute.GET(new Request(`https://preview.example.test/api/v1/ads/asset/${id}${query ? `?${query}` : ""}`), { params: Promise.resolve({ id }) });
}
const bytesOf = async (r: Response) => new Uint8Array(await r.arrayBuffer());

beforeEach(() => {
  reset();
  install();
  console.error = () => {};
  process.env.RICH_AD_DELIVERY_ENABLED = "1";
});
afterEach(() => {
  console.error = realConsoleError;
  if (savedFlag === undefined) delete process.env.RICH_AD_DELIVERY_ENABLED;
  else process.env.RICH_AD_DELIVERY_ENABLED = savedFlag;
});

async function assert404(res: Response, why: string) {
  assert.equal(res.status, 404, why);
  assert.equal((await res.arrayBuffer()).byteLength, 0, `${why}: empty body`);
  assert.equal(res.headers.get("cache-control"), "no-store", why);
}

describe("step 3B asset proxy | an approved ad in an active campaign of an active advertiser is served", () => {
  it("serves the banner (kind=image) and the logo (kind=logo) with the real content type", async () => {
    const image = await get(cid(1), "kind=image");
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/jpeg");
    assert.deepEqual(await bytesOf(image), objects.get(BANNER_A));
    const logo = await get(cid(1), "kind=logo");
    assert.equal(logo.status, 200);
    assert.equal(logo.headers.get("content-type"), "image/png");
    assert.deepEqual(await bytesOf(logo), objects.get(LOGO_A));
  });

  it("kind defaults to image", async () => {
    const res = await get(cid(1), "");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/jpeg");
  });

  it("a WebP banner is served as image/webp", async () => {
    creatives.push({ id: cid(2), status: "approved", campaign: CAMP_B, logo: LOGO_B, banner: BANNER_B });
    const res = await get(cid(2), "kind=image");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/webp");
  });

  it("safe response headers: nosniff, locked-down CSP, no cookie, no CORS, short cache, no filename", async () => {
    const res = await get(cid(1));
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("content-security-policy"), "default-src 'none'; sandbox");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    assert.equal(res.headers.get("set-cookie"), null);
    assert.equal(res.headers.get("access-control-allow-origin"), null);
    assert.equal(res.headers.get("cache-control"), "public, max-age=60");
    assert.equal(res.headers.get("content-disposition"), null);
    assert.equal(res.headers.get("x-blisscco-api-version"), "1");
  });
});

describe("step 3B asset proxy | pending / rejected / paused / draft / archived ads => 404", () => {
  for (const status of ["pending_review", "rejected", "paused", "draft", "archived"]) {
    it(`creative status ${status} => 404 for both kinds, and storage is never touched`, async () => {
      creatives[0].status = status;
      await assert404(await get(cid(1), "kind=image"), `${status} image`);
      await assert404(await get(cid(1), "kind=logo"), `${status} logo`);
      assert.deepEqual(storageCalls, []);
    });
  }

  it("an approved ad later paused / edited back to draft stops being served immediately (no stale state in the proxy)", async () => {
    assert.equal((await get(cid(1))).status, 200);
    creatives[0].status = "paused";
    await assert404(await get(cid(1)), "paused");
    creatives[0].status = "approved";
    assert.equal((await get(cid(1))).status, 200);
    creatives[0].status = "draft";
    await assert404(await get(cid(1)), "draft");
  });

  for (const status of ["draft", "paused", "completed", "archived"]) {
    it(`campaign status ${status} => 404`, async () => {
      campaigns[0].status = status;
      await assert404(await get(cid(1)), `campaign ${status}`);
      assert.deepEqual(storageCalls, []);
    });
  }

  it("advertiser not active (pending / suspended) or advertiser profile suspended => 404", async () => {
    advertisers[0].status = "suspended";
    await assert404(await get(cid(1)), "advertiser suspended");
    advertisers[0].status = "pending";
    await assert404(await get(cid(1)), "advertiser pending");
    advertisers[0].status = "active";
    advertisers[0].profileStatus = "suspended";
    await assert404(await get(cid(1)), "profile suspended");
  });

  it("an unknown ad id => 404", async () => {
    await assert404(await get(cid(99)), "unknown");
  });

  it("a creative without that image => 404 (logo missing / banner missing)", async () => {
    creatives[0].logo = null;
    await assert404(await get(cid(1), "kind=logo"), "no logo");
    assert.equal((await get(cid(1), "kind=image")).status, 200);
    creatives[0].banner = null;
    await assert404(await get(cid(1), "kind=image"), "no banner");
  });
});

describe("step 3B asset proxy | cross-advertiser protection", () => {
  it("advertiser B's approved ad serves B's image only; A's ad serves A's image only", async () => {
    creatives.push({ id: cid(2), status: "approved", campaign: CAMP_B, logo: LOGO_B, banner: BANNER_B });
    assert.deepEqual(await bytesOf(await get(cid(2), "kind=logo")), objects.get(LOGO_B));
    assert.deepEqual(await bytesOf(await get(cid(1), "kind=logo")), objects.get(LOGO_A));
    assert.deepEqual(storageCalls.map((c) => c.path), [LOGO_B, LOGO_A]);
  });

  it("a row of advertiser A that points at advertiser B's image (bad data) => 404 and B's file is never downloaded", async () => {
    creatives[0].logo = LOGO_B;
    creatives[0].banner = BANNER_B;
    await assert404(await get(cid(1), "kind=logo"), "logo of B");
    await assert404(await get(cid(1), "kind=image"), "banner of B");
    assert.deepEqual(storageCalls, []);
  });

  it("same advertiser but another campaign's folder => 404", async () => {
    const other = `${ADV_A}/${CAMP_A2}/logo-${uid(7)}.png`;
    objects.set(other, makePng(256, 256));
    creatives[0].logo = other;
    await assert404(await get(cid(1), "kind=logo"), "other campaign");
    assert.deepEqual(storageCalls, []);
  });

  it("a banner path stored in the logo column (and the reverse) => 404", async () => {
    creatives[0].logo = BANNER_A;
    creatives[0].banner = LOGO_A;
    await assert404(await get(cid(1), "kind=logo"), "banner as logo");
    await assert404(await get(cid(1), "kind=image"), "logo as banner");
    assert.deepEqual(storageCalls, []);
  });

  it("malformed / traversal paths in the row => 404, never downloaded", async () => {
    for (const bad of [`../${LOGO_A}`, `${ADV_A}/${CAMP_A}/../${ADV_B}/${CAMP_B}/logo-${uid(3)}.png`, `${ADV_A}/${CAMP_A}/logo-${uid(1)}.svg`, `${ADV_A}/${CAMP_A}/logo-${uid(1)}.png/extra`, `${LOGO_A}?x=1`, `/${LOGO_A}`, "", "logo.png"]) {
      creatives[0].logo = bad;
      await assert404(await get(cid(1), "kind=logo"), bad);
    }
    assert.deepEqual(storageCalls, []);
  });

  it("the downloaded path is always the verified stored path, never anything from the URL", async () => {
    await get(cid(1), "kind=logo");
    assert.deepEqual(storageCalls, [{ bucket: "creative-assets", op: "download", path: LOGO_A }]);
  });
});

describe("step 3B asset proxy | request validation", () => {
  it("flag OFF (default) => every request is 404 and neither database nor storage is called", async () => {
    delete process.env.RICH_AD_DELIVERY_ENABLED;
    await assert404(await get(cid(1)), "flag off");
    process.env.RICH_AD_DELIVERY_ENABLED = "true";
    await assert404(await get(cid(1)), "flag true");
    assert.deepEqual(rpcCalls, []);
    assert.deepEqual(storageCalls, []);
  });

  it("a bad id (not a UUID) => 404 without any database call", async () => {
    for (const id of ["abc", "1", "../etc/passwd", "'; drop table ad_creatives;--", cid(1) + "x", "", "%00", "null"]) {
      await assert404(await get(id), id);
    }
    assert.deepEqual(rpcCalls, []);
  });

  it("an unknown kind or an extra query parameter => 404", async () => {
    for (const q of ["kind=banner", "kind=", "kind=LOGO", "kind=logo&kind=image", "kind=logo&path=" + encodeURIComponent(LOGO_B), "path=" + encodeURIComponent(LOGO_B), "kind=logo&v=1", "kind=../logo"]) {
      await assert404(await get(cid(1), q), q);
    }
    assert.deepEqual(storageCalls, []);
  });

  it("only GET is exported (no POST / PUT / DELETE / upload)", () => {
    assert.deepEqual(Object.keys(assetRoute).filter((k) => /^[A-Z]+$/.test(k)), ["GET"]);
  });
});

describe("step 3B asset proxy | the file itself is verified again before it is served", () => {
  it("bytes that are not a real PNG / JPEG / WebP (text, SVG, GIF, HTML) => 404", async () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    for (const bytes of [enc("just text"), enc("<svg onload=alert(1)></svg>"), enc("<html><script>1</script></html>"), Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]), new Uint8Array(0)]) {
      objects.set(BANNER_A, bytes);
      await assert404(await get(cid(1), "kind=image"), "bad bytes");
    }
  });

  it("an image outside the dimension rules (logo too small / too big, banner wrong shape or size) => 404", async () => {
    objects.set(LOGO_A, makePng(32, 32));
    await assert404(await get(cid(1), "kind=logo"), "logo 32");
    objects.set(LOGO_A, makePng(2000, 2000));
    await assert404(await get(cid(1), "kind=logo"), "logo 2000");
    objects.set(BANNER_A, makeJpeg(800, 800));
    await assert404(await get(cid(1), "kind=image"), "banner square");
    objects.set(BANNER_A, makeJpeg(300, 157));
    await assert404(await get(cid(1), "kind=image"), "banner tiny");
    objects.set(BANNER_A, makeJpeg(4000, 2094));
    await assert404(await get(cid(1), "kind=image"), "banner huge");
  });

  it("an oversize file (logo > 2 MB, banner > 4 MB) => 404", async () => {
    const big = (n: number) => { const a = new Uint8Array(n); a.set(makePng(256, 256)); return a; };
    objects.set(LOGO_A, big(2 * 1024 * 1024 + 1));
    await assert404(await get(cid(1), "kind=logo"), "logo big");
    const bigJ = new Uint8Array(4 * 1024 * 1024 + 1);
    bigJ.set(makeJpeg(1200, 628));
    objects.set(BANNER_A, bigJ);
    await assert404(await get(cid(1), "kind=image"), "banner big");
  });

  it("the type comes from the real bytes, not from the file name: PNG bytes under a .jpg name are served as image/png", async () => {
    objects.set(BANNER_A, makePng(1200, 628));
    const res = await get(cid(1), "kind=image");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
  });

  it("a missing storage object => 404", async () => {
    objects.delete(BANNER_A);
    await assert404(await get(cid(1)), "missing object");
  });
});

describe("step 3B asset proxy | failures and read-only guarantees", () => {
  it("a database outage is a 503 with no body and no internal detail (not a 404, so it is visible in monitoring)", async () => {
    for (const mode of ["error", "throw"] as const) {
      rpcMode = mode;
      const res = await get(cid(1));
      assert.equal(res.status, 503, mode);
      assert.equal((await res.text()).includes("secret"), false);
      assert.equal(res.headers.get("cache-control"), "no-store");
    }
  });

  it("serving an image only runs the read-only lookup and one download: no serve, spend, impression, click, ledger or payout call", async () => {
    await get(cid(1), "kind=logo");
    await get(cid(1), "kind=image");
    assert.deepEqual(rpcCalls.map((c) => c.name), ["get_creative_rich_assets", "get_creative_rich_assets"]);
    assert.deepEqual(storageCalls.map((c) => c.op), ["download", "download"]);
  });

  it("source guards: no signed / public URL, no storage write, no table write in the proxy code", () => {
    for (const f of ["lib/ads/asset-handler.ts", "lib/ads/rich-assets.ts", "lib/ads/rich-assets-db.ts", "app/api/v1/ads/asset/[id]/route.ts"]) {
      const src = read(f);
      assert.doesNotMatch(src, /createSignedUrl|createSignedUrls|getPublicUrl|\.upload\(|\.remove\(|\.move\(|\.copy\(/, `${f} touches storage beyond download`);
      assert.doesNotMatch(src, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/, `${f} writes to a table`);
      assert.doesNotMatch(src, /Access-Control-Allow-Origin/i, `${f} sets CORS`);
      assert.doesNotMatch(src, /record_ad_serve|record_ad_impression|record_ad_click|ledger|payout|SUPABASE_SECRET_KEY/i, `${f} touches billing or secrets`);
    }
    assert.match(read("lib/ads/rich-assets-db.ts"), /^import "server-only";/m);
  });

  it("the new SQL is read-only and does not touch RLS, policies, buckets or grants to anon / authenticated", () => {
    const sql = read("supabase/sql/phase4-step3b-1-rich-ad-assets.sql").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    assert.doesNotMatch(sql, /\b(insert\s+into|update\s+public|delete\s+from|alter\s+table|create\s+table|drop\s+table|create\s+policy|alter\s+policy|drop\s+policy|enable\s+row|disable\s+row|storage\.buckets|storage\.objects)\b/i);
    assert.match(sql, /language sql\s+stable\s+security definer\s+set search_path = ''/i);
    assert.match(sql, /revoke all on function public\.get_creative_rich_assets\(uuid\) from public, anon, authenticated;/);
    assert.match(sql, /grant execute on function public\.get_creative_rich_assets\(uuid\) to service_role;/);
    assert.doesNotMatch(sql, /grant[^;]*to[^;]*\b(anon|authenticated|public)\b/i);
    for (const rule of ["x.status  = 'approved'", "c.status  = 'active'", "a.status  = 'active'", "ap.status = 'active'"]) assert.ok(sql.includes(rule), rule);
  });

  it("the bucket stays private: the Step 3 SQL still creates it with public = false and the Step 3B SQL never changes it", () => {
    assert.match(read("supabase/sql/phase4-step3-1-creative-submission.sql"), /values \('creative-assets', 'creative-assets', false,/);
    assert.doesNotMatch(read("supabase/sql/phase4-step3b-1-rich-ad-assets.sql").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n"), /public\s*=\s*true/i);
  });
});
