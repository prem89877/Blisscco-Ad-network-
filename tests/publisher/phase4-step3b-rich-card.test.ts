import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";
import * as route from "../../examples/publisher-nextjs/app/api/blisscco-ad/route";
import { readRichFields, safeAssetSrc, safeBrandName } from "../../examples/publisher-nextjs/lib/safe-url";
import { PROJECT_ROOT, compileForPublisherExample } from "../ads/helpers/publisher-example-compiler";

// Phase 4 Step 3B | publisher side: ad card (logo, image, brand, title, description, Sponsored label) with a text-only fallback,
// the example route's whitelist for the new optional fields, the documentation, and COMPILATION of the example files.
// Upstream (Blisscco) is NAKLI. A real browser render of the card is a manual TEST/Preview check.

const read = (f: string) => readFileSync(path.join(PROJECT_ROOT, f), "utf8");
const COMPONENT = read("examples/publisher-nextjs/components/SponsoredAd.tsx");

const KEY = `blc_live_${"c".repeat(64)}`;
const BASE = "https://ads.example.com";
const AD_ID = "11111111-1111-4111-8111-111111111111";
const AD = { id: AD_ID, headline: "Level up", body: "Gaming laptops", cta_text: "Shop now", destination_url: "https://example.com/g" };
const LOGO = `${BASE}/api/v1/ads/asset/${AD_ID}?kind=logo`;
const IMAGE = `${BASE}/api/v1/ads/asset/${AD_ID}?kind=image`;
const FIVE = ["body", "cta_text", "destination_url", "headline", "id"];

const realFetch = globalThis.fetch;
const realConsole = { log: console.log, error: console.error, warn: console.warn, info: console.info };
const saved = { key: process.env.BLISSCCO_PUBLISHER_API_KEY, base: process.env.BLISSCCO_API_BASE_URL };

function mockUpstream(body: unknown): void {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
}
async function ask(): Promise<{ fill: boolean; ad: Record<string, unknown> }> {
  const res = await route.POST(new Request("http://localhost/api/blisscco-ad", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topic: "gaming" }) }));
  assert.equal(res.status, 200);
  return (await res.json()) as { fill: boolean; ad: Record<string, unknown> };
}

beforeEach(() => {
  process.env.BLISSCCO_PUBLISHER_API_KEY = KEY;
  process.env.BLISSCCO_API_BASE_URL = BASE;
  for (const m of ["log", "error", "warn", "info"] as const) console[m] = () => {};
});
afterEach(() => {
  globalThis.fetch = realFetch;
  Object.assign(console, realConsole);
  for (const [name, v] of [["BLISSCCO_PUBLISHER_API_KEY", saved.key], ["BLISSCCO_API_BASE_URL", saved.base]] as const) {
    if (v === undefined) delete process.env[name];
    else process.env[name] = v;
  }
});

describe("step 3B publisher example | route whitelist for the optional rich fields", () => {
  it("passes brand_name, logo_url and image_url from YOUR Blisscco host, next to the 5 fields", async () => {
    mockUpstream({ fill: true, sponsored: true, ad: { ...AD, brand_name: "Guitar House", logo_url: LOGO, image_url: IMAGE } });
    const body = await ask();
    assert.deepEqual(Object.keys(body.ad).sort(), [...FIVE, "brand_name", "image_url", "logo_url"].sort());
    assert.equal(body.ad.brand_name, "Guitar House");
    assert.equal(body.ad.logo_url, LOGO);
    assert.equal(body.ad.image_url, IMAGE);
  });

  it("text-only fallback: an ad without rich fields comes out with exactly the 5 fields", async () => {
    mockUpstream({ fill: true, sponsored: true, ad: AD });
    assert.deepEqual(Object.keys((await ask()).ad).sort(), FIVE);
  });

  it("each rich field is independent (brand only / logo only / image only)", async () => {
    mockUpstream({ fill: true, sponsored: true, ad: { ...AD, brand_name: "Only Brand" } });
    assert.deepEqual(Object.keys((await ask()).ad).sort(), [...FIVE, "brand_name"].sort());
    mockUpstream({ fill: true, sponsored: true, ad: { ...AD, logo_url: LOGO } });
    assert.deepEqual(Object.keys((await ask()).ad).sort(), [...FIVE, "logo_url"].sort());
    mockUpstream({ fill: true, sponsored: true, ad: { ...AD, image_url: IMAGE } });
    assert.deepEqual(Object.keys((await ask()).ad).sort(), [...FIVE, "image_url"].sort());
  });

  it("an image address that is not YOUR Blisscco host + the asset path is dropped (the ad stays, text-only)", async () => {
    const bad = [
      `https://evil.example/api/v1/ads/asset/${AD_ID}?kind=logo`,
      `https://ads.example.com:8443/api/v1/ads/asset/${AD_ID}?kind=logo`,
      `http://ads.example.com/api/v1/ads/asset/${AD_ID}?kind=logo`,
      `https://ads.example.com.evil.example/api/v1/ads/asset/${AD_ID}?kind=logo`,
      `https://user:pw@ads.example.com/api/v1/ads/asset/${AD_ID}?kind=logo`,
      `https://ads.example.com/other/path.png?kind=logo`,
      `https://ads.example.com/api/v1/ads/asset/not-a-uuid?kind=logo`,
      `https://ads.example.com/api/v1/ads/asset/${AD_ID}?kind=image`, // image URL in the logo slot
      `https://ads.example.com/api/v1/ads/asset/${AD_ID}?kind=logo&x=1`,
      `https://ads.example.com/api/v1/ads/asset/${AD_ID}`,
      `https://ads.example.com/api/v1/ads/asset/${AD_ID}?kind=logo#frag`,
      "data:image/svg+xml,<svg onload=alert(1)>", "javascript:alert(1)", "//ads.example.com/x", "/api/v1/ads/asset/x", "", 42,
    ];
    for (const logo_url of bad) {
      mockUpstream({ fill: true, sponsored: true, ad: { ...AD, brand_name: "Brand", logo_url } });
      const out = await ask();
      assert.equal(out.fill, true, String(logo_url));
      assert.equal("logo_url" in out.ad, false, String(logo_url));
      assert.equal(out.ad.brand_name, "Brand");
    }
  });

  it("a brand name with markup, control characters or more than 80 characters is dropped", async () => {
    for (const brand_name of ["<b>x</b>", "a &amp; b", "&#60;", "x\u0000y", "x".repeat(81), "   ", 7, null]) {
      mockUpstream({ fill: true, sponsored: true, ad: { ...AD, brand_name, logo_url: LOGO } });
      const out = await ask();
      assert.equal("brand_name" in out.ad, false, String(brand_name));
      assert.equal(out.ad.logo_url, LOGO);
    }
  });

  it("unknown extra upstream keys are still dropped", async () => {
    mockUpstream({ fill: true, sponsored: true, ad: { ...AD, logo_url: LOGO, advertiser_email: "a@b.com", spent_total: 9, logo_path: "a/b/logo-x.png", banner_path: "x" } });
    const out = await ask();
    assert.equal(/advertiser_email|spent_total|logo_path|banner_path/.test(JSON.stringify(out)), false);
  });

  it("with a localhost API base URL, http localhost image URLs are accepted (local testing)", async () => {
    process.env.BLISSCCO_API_BASE_URL = "http://localhost:3000";
    const local = `http://localhost:3000/api/v1/ads/asset/${AD_ID}?kind=image`;
    mockUpstream({ fill: true, sponsored: true, ad: { ...AD, image_url: local } });
    assert.equal((await ask()).ad.image_url, local);
  });
});

describe("step 3B publisher example | safe-url helpers (shared by the route and the browser component)", () => {
  it("safeAssetSrc without an expected origin (browser): shape only, any https host, logo/image kinds must match", () => {
    assert.equal(safeAssetSrc(LOGO, "logo"), LOGO);
    assert.equal(safeAssetSrc(IMAGE, "image"), IMAGE);
    assert.equal(safeAssetSrc(IMAGE, "logo"), null);
    assert.equal(safeAssetSrc(LOGO, "image"), null);
    assert.equal(safeAssetSrc(`http://localhost:3000/api/v1/ads/asset/${AD_ID}?kind=logo`, "logo"), `http://localhost:3000/api/v1/ads/asset/${AD_ID}?kind=logo`);
    assert.equal(safeAssetSrc(`http://example.com/api/v1/ads/asset/${AD_ID}?kind=logo`, "logo"), null);
  });
  it("safeAssetSrc with an expected origin (server): the host must match exactly", () => {
    assert.equal(safeAssetSrc(LOGO, "logo", BASE), LOGO);
    assert.equal(safeAssetSrc(LOGO, "logo", "https://other.example.com"), null);
  });
  it("safeBrandName trims and accepts plain text only", () => {
    assert.equal(safeBrandName("  Guitar House  "), "Guitar House");
    assert.equal(safeBrandName("Tom & Jerry"), "Tom & Jerry");
    for (const bad of ["", "   ", "<i>", "a &amp; b", "a\nb", "x".repeat(81), 1, null, undefined, {}]) assert.equal(safeBrandName(bad), null);
  });
  it("readRichFields: empty / hostile ads give {} (so the card is the plain text-only card)", () => {
    assert.deepEqual(readRichFields({}), {});
    assert.deepEqual(readRichFields({ brand_name: 1, logo_url: {}, image_url: [] }), {});
    assert.deepEqual(readRichFields({ logo_url: "javascript:alert(1)", image_url: "https://evil.example/x.png" }), {});
  });
  it("the helpers never touch env, the API key or the network", () => {
    const src = read("examples/publisher-nextjs/lib/safe-url.ts");
    assert.doesNotMatch(src, /process\.env|fetch\(|BLISSCCO_PUBLISHER_API_KEY|XMLHttpRequest/);
  });
});

describe("step 3B publisher example | the ad card component", () => {
  it("shows logo, brand, image, headline, description and the CTA, with the visible Sponsored label first", () => {
    assert.match(COMPONENT, />Sponsored<\/p>/);
    assert.match(COMPONENT, /aria-label="Sponsored"/);
    assert.ok(COMPONENT.indexOf(">Sponsored</p>") < COMPONENT.indexOf("{ad.headline}"), "label comes before the content");
    for (const piece of ["logoSrc", "ad.brand", "imageSrc", "{ad.headline}", "{ad.body}", "{ad.ctaText}"]) assert.ok(COMPONENT.includes(piece), piece);
    assert.match(COMPONENT, /<img\b[^>]*src=\{logoSrc\}/s);
    assert.match(COMPONENT, /<img\b[^>]*src=\{imageSrc\}/s);
  });

  it("text-only fallback: logo, brand and image are each rendered only when present; a broken image is dropped (no broken-image icon)", () => {
    assert.match(COMPONENT, /\{\(logoSrc \|\| ad\.brand\) && \(/);
    assert.match(COMPONENT, /\{imageSrc && \(/);
    assert.match(COMPONENT, /onError=\{\(\) => setBrokenImages\(\(b\) => \(\{ \.\.\.b, logo: true \}\)\)\}/);
    assert.match(COMPONENT, /onError=\{\(\) => setBrokenImages\(\(b\) => \(\{ \.\.\.b, image: true \}\)\)\}/);
    assert.match(COMPONENT, /brokenImages\.logo \? null : ad\.logoSrc/);
    assert.match(COMPONENT, /brokenImages\.image \? null : ad\.imageSrc/);
    assert.match(COMPONENT, /brand: rich\.brand_name \?\? null, logoSrc: rich\.logo_url \?\? null, imageSrc: rich\.image_url \?\? null/);
  });

  it("images load with no referrer, lazily, with empty alt (decorative; the headline carries the meaning) and never inject HTML", () => {
    assert.equal((COMPONENT.match(/referrerPolicy="no-referrer"/g) ?? []).length, 2);
    assert.equal((COMPONENT.match(/loading="lazy"/g) ?? []).length, 2);
    assert.equal((COMPONENT.match(/alt=""/g) ?? []).length, 2);
    assert.doesNotMatch(COMPONENT, /dangerouslySetInnerHTML|innerHTML|eval\(|document\.write/);
  });

  it("the component re-checks image addresses itself (readRichFields) and still has no direct advertiser link and no secrets", () => {
    assert.match(COMPONENT, /readRichFields\(d\.ad\)/);
    assert.match(COMPONENT, /import \{ readRichFields, safeHref \} from "\.\.\/lib\/safe-url";/);
    assert.doesNotMatch(COMPONENT, /<a\b|href=\{/);
    assert.doesNotMatch(COMPONENT, /NEXT_PUBLIC|process\.env|BLISSCCO_PUBLISHER_API_KEY/);
    assert.match(COMPONENT, /safeHref\(ad\.href\)/);
  });

  it("the tracking behaviour is unchanged (impression once on screen, click ref via own route)", () => {
    for (const piece of ["IntersectionObserver", 'event: "impression"', 'event: "click"', "reportedToken", "reportedClickRef", 'window.open(target, "_blank", "noopener,noreferrer")']) assert.ok(COMPONENT.includes(piece), piece);
  });
});

describe("step 3B publisher example | documentation", () => {
  const readme = read("examples/publisher-nextjs/README.md");
  const guide = read("app/dashboard/publisher/guide/page.tsx");
  const nodeTypes = read("examples/publisher-node/src/types.ts");

  it("the Next.js README documents the card, the optional fields, the asset proxy and the text-only fallback", () => {
    for (const w of [/brand_name/, /logo_url/, /image_url/, /Sponsored/, /text-only/i, /\/api\/v1\/ads\/asset\//, /RICH_AD_DELIVERY_ENABLED/]) assert.match(readme, w);
  });
  it("the in-app publisher guide documents the optional fields, the proxy URL shape, the fallback and that images are not billed", () => {
    for (const w of [/brand_name/, /logo_url/, /image_url/, /\/api\/v1\/ads\/asset\//, /text-only/i, /RICH_AD_DELIVERY_ENABLED/, /1\.91:1/, /64/, /1024/]) assert.match(guide, w);
  });
  it("the Node example types describe the optional fields as optional strings", () => {
    assert.match(nodeTypes, /brand_name\?: string;/);
    assert.match(nodeTypes, /logo_url\?: string;/);
    assert.match(nodeTypes, /image_url\?: string;/);
  });
});

describe("step 3B publisher example | compilation", () => {
  it("client.ts, types.ts and safe-url.ts compile together under strict mode with no diagnostics", () => {
    const diags = compileForPublisherExample([
      path.join(PROJECT_ROOT, "examples/publisher-node/src/client.ts"),
      path.join(PROJECT_ROOT, "examples/publisher-node/src/types.ts"),
      path.join(PROJECT_ROOT, "examples/publisher-nextjs/lib/safe-url.ts"),
    ]);
    assert.deepEqual(diags, []);
  });

  it("SponsoredAd.tsx has no syntax error (TSX transpile)", () => {
    const out = ts.transpileModule(COMPONENT, {
      reportDiagnostics: true,
      fileName: "SponsoredAd.tsx",
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    });
    assert.deepEqual((out.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")), []);
  });

  const haveFramework = existsSync(path.join(PROJECT_ROOT, "node_modules", "next", "package.json")) && existsSync(path.join(PROJECT_ROOT, "node_modules", "@types", "react", "index.d.ts"));
  it("route.ts and SponsoredAd.tsx type-check strictly together with the project's next + react types", { skip: haveFramework ? false : "next / @types/react are not installed here; runs after `npm ci` (CI)" }, () => {
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, noEmit: true,
      jsx: ts.JsxEmit.ReactJSX, lib: ["lib.es2022.d.ts", "lib.dom.d.ts"], types: ["node"], typeRoots: [path.join(PROJECT_ROOT, "node_modules", "@types")], skipLibCheck: true,
    };
    const files = ["examples/publisher-nextjs/app/api/blisscco-ad/route.ts", "examples/publisher-nextjs/components/SponsoredAd.tsx"].map((f) => path.join(PROJECT_ROOT, f));
    const program = ts.createProgram(files, options);
    const diags = ts.getPreEmitDiagnostics(program).filter((d) => !d.file || !/node_modules/.test(d.file.fileName)).map((d) => `${d.file?.fileName ?? ""}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
    assert.deepEqual(diags, []);
  });
});
