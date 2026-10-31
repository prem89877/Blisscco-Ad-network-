import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import * as ts from "typescript";
import { PUBLIC_AD_FIELDS, PUBLIC_TRACKING_FIELDS, PUBLIC_TRACKING_OPTIONAL_FIELDS, buildAdResponse, buildProviderAdResponse } from "@/lib/ads/contract";
import { reviveFallbackEnabled } from "@/lib/ads/fallback-provider";
import { MAX_BODY_BYTES, parseMatchRequest } from "@/lib/ads/validation";
import { ACTIVE_CATEGORIES } from "@/lib/ads/taxonomy";
import * as clickRoute from "@/app/api/v1/ads/click/route";
import { handleClickGet, REQUESTS_PER_MINUTE_PER_IP as CLICK_REQ_LIMIT, FAILURES_PER_MINUTE_PER_IP as CLICK_FAIL_LIMIT } from "@/lib/ads/click-handler";
import { handleImpressionPost, REQUESTS_PER_MINUTE_PER_IP as IMP_REQ_LIMIT, FAILURES_PER_MINUTE_PER_IP as IMP_FAIL_LIMIT } from "@/lib/ads/impression-handler";
import { MAX_IMPRESSION_BODY_BYTES, parseImpressionRequest } from "@/lib/ads/impression";
import { CLICK_PARAM, parseClickQuery, type ClickResult } from "@/lib/ads/click";
import { createIpGuard } from "@/lib/ads/ip-guard";
import { CLICK_REF_PREFIX, mintClickRef, verifyClickRef } from "@/lib/ads/click-ref";
import { DEFAULT_TTL_SECONDS, MAX_TOKEN_LENGTH, MAX_TTL_SECONDS, TRACKING_EVENTS, TRACKING_TOKEN_PREFIX, mintTrackingToken } from "@/lib/ads/tracking-token";

// Day 6 (prompt 5): publisher guide (app/dashboard/publisher/guide/page.tsx) asli API contract se mel khata rahe,
// aur wo security/honesty rules todhe nahi (key browser me nahi, koi jhootha URL/key nahi, koi overclaim nahi).

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const flat = (f: string) => read(f).replace(/\s+/g, " ");

const GUIDE = "app/dashboard/publisher/guide/page.tsx";
const PAGES = [GUIDE, "app/dashboard/publisher/page.tsx", "components/dashboard/IntegrationSteps.tsx", "components/Sections.tsx"];

/** Guide me `const NAME = [ ... ].join("\n");` ko chalakar uska text nikaalta hai (sirf string literals, koi import nahi). */
function lines(name: string): string {
  const m = new RegExp(`const ${name} = (\\[[\\s\\S]*?\\])\\.join\\("\\\\n"\\);`).exec(read(GUIDE));
  assert.ok(m, `${name} guide me nahi mila`);
  return (new Function(`return ${m[1]}`)() as string[]).join("\n");
}

describe("publisher guide: examples match the real API contract", () => {
  it("request example is accepted by the real validator", () => {
    const body = JSON.parse(lines("REQUEST_EXAMPLE")) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["exclude_ad_ids", "topic"]);
    assert.equal(parseMatchRequest(JSON.stringify(body)).ok, true);
  });

  it("success example has fill:true, sponsored:true and exactly the 5 public ad fields", () => {
    const body = JSON.parse(lines("SUCCESS_EXAMPLE")) as { fill: unknown; sponsored: unknown; ad: Record<string, unknown> };
    assert.equal(body.fill, true);
    assert.strictEqual(body.sponsored, true);
    assert.deepEqual(Object.keys(body.ad).sort(), [...PUBLIC_AD_FIELDS].sort());
    assert.deepEqual(Object.keys(body).sort(), ["ad", "fill", "sponsored"]);
  });

  it("no-fill example is exactly {fill:false}", () => {
    const m = /const NO_FILL_EXAMPLE = '([^']*)';/.exec(read(GUIDE));
    assert.ok(m);
    assert.deepEqual(JSON.parse(m[1]), { fill: false });
  });

  it("cURL and TypeScript examples use the documented endpoint, headers and a server env variable", () => {
    const curl = lines("CURL_EXAMPLE");
    assert.match(curl, /\/api\/v1\/ads\/match/);
    assert.match(curl, /Authorization: Bearer \$BLISSCCO_PUBLISHER_API_KEY/);
    assert.match(curl, /Content-Type: application\/json/);
    const ts = lines("SERVER_EXAMPLE");
    assert.match(ts, /process\.env\.BLISSCCO_PUBLISHER_API_KEY/);
    assert.match(ts, /\/api\/v1\/ads\/match/);
    assert.match(ts, /"Content-Type": "application\/json"/);
    assert.match(ts, /AbortSignal\.timeout/);
    assert.match(ts, /429/);
    assert.match(ts, /Retry-After/);
  });

  it("the error table covers every documented status", () => {
    const text = read(GUIDE);
    for (const status of ["400", "401", "413", "415", "429", "503"]) assert.match(text, new RegExp(`status: "${status}`), status);
  });

  it("the guide documents the required pieces", () => {
    const g = flat(GUIDE);
    for (const needle of ["POST /api/v1/ads/match", "Authorization: Bearer YOUR_PUBLISHER_API_KEY", "Content-Type: application/json",
      "exclude_ad_ids", "Sponsored", "no-fill", "Retry-After", "2048 bytes", "test publisher", "stay on your server"]) {
      if (needle === "stay on your server") continue; // heading wording: neeche alag se check
      assert.ok(g.includes(needle), needle);
    }
    assert.match(g, /Why the key must stay on your server/);
  });
});

describe("publisher guide: security and honesty rules", () => {
  it("states that keys are created on the Publisher page after approval and that no third-party chatbot integration exists", () => {
    const g = flat(GUIDE);
    assert.match(g, /create a key on the Publisher page/);
    assert.match(g, /no integration with ChatGPT or any other third-party chatbot/);
  });

  it("never tells anyone to expose the key: no public-prefix key variable, no key in client code", () => {
    for (const f of [...PAGES, ".env.example"]) {
      const src = read(f);
      assert.equal(/(NEXT_PUBLIC|VITE|REACT_APP|EXPO_PUBLIC)_[A-Z_]*(API_KEY|PUBLISHER)/.test(src), false, `${f}: public key variable`);
    }
    const g = read(GUIDE);
    assert.equal(/"use client"|'use client'/.test(g), false, "guide server component hi rahe");
    assert.match(g, /BLISSCCO_PUBLISHER_API_KEY/);
  });

  it("contains no live-looking key, no deployment URL and no invented host", () => {
    for (const f of [...PAGES, ".env.example"]) {
      const src = read(f);
      assert.equal(/blc_live_[0-9a-f]{8,}/i.test(src), false, `${f}: live-looking key`);
      assert.equal(/blc_live_x{4,}/i.test(src), false, `${f}: fake-looking key`);
      if (f !== ".env.example") assert.equal(/https?:\/\/[a-z0-9.-]*(vercel\.app|blisscco\.(com|io|app|ai|in))/i.test(src), false, `${f}: deployment URL`);
    }
    assert.match(read(GUIDE), /YOUR-BLISSCCO-API-HOST/);
  });

  it("does not claim production readiness, a working third-party integration, or a self-service key flow", () => {
    for (const f of PAGES) {
      const g = flat(f);
      assert.equal(/production[- ]ready/i.test(g), false, `${f}: production-ready`);
      assert.equal(/(?<!no\s)(?<!not\s)\b(works?|integrat\w*|available|live)\s+(with|in|inside|on)\s+(chatgpt|openai|gemini|claude|perplexity|copilot)/i.test(g), false, `${f}: chatbot claim`);
      assert.equal(/generate (your )?(an? )?api key|create (your )?(an? )?api key (here|below|now)/i.test(g), false, `${f}: self-service claim`);
    }
    assert.match(flat(GUIDE), /Not ready for production use/);
    assert.match(flat(GUIDE), /Known limitations/);
  });

  it("no stale 'coming soon / placeholder / not available yet' copy about the API on the publisher pages", () => {
    for (const f of [GUIDE, "app/dashboard/publisher/page.tsx", "components/dashboard/IntegrationSteps.tsx"]) {
      assert.equal(/coming soon|placeholder page|not available yet|still being built/i.test(flat(f)), false, f);
    }
  });

  it("the landing page API sample is the real contract (no invented placement_id/locale/free-text topic)", () => {
    const s = read("components/Sections.tsx");
    const m = /const SAMPLE = `([\s\S]*?)`;/.exec(s);
    assert.ok(m);
    assert.match(m[1], /POST \/api\/v1\/ads\/match/);
    assert.match(m[1], /Authorization: Bearer YOUR_PUBLISHER_API_KEY/);
    assert.equal(/placement_id|locale|campaign_id|"label"|waterproof/.test(m[1]), false);
  });
});

// ---------------------------------------------------------------------------
// Day 15 Part 4: guide ab asli impression / click API se mel khata hai (kuch bhi purana ya invented nahi).
// Asli handlers ko nakli `accept` ke saath bulate hain: database / secret / network kabhi nahi chhuta.
// ---------------------------------------------------------------------------

const TEST_IP = "203.0.113.7";
/** Is IP ko pehle hi limit tak pahuncha hua guard (429 ka asli raasta). */
function blockedGuard() {
  const g = createIpGuard(1);
  g.recordFailure(TEST_IP, Date.now());
  return g;
}
/** vm ke andar bane objects ka prototype alag hota hai: JSON se guzarkar compare karte hain. */
const plain = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

describe("Day 15 part 4: no outdated 'not implemented' claims", () => {
  const g = flat(GUIDE);
  it("the old 'no endpoint / no reporting / counts no impressions' claims are gone", () => {
    for (const stale of [
      /no impression or click reporting/i,
      /There is no endpoint to send tokens to yet/i,
      /Blisscco counts no impressions or clicks/i,
      /it does not report anything today/i,
      /prepares later impression and click reporting/i,
      /Not tracked yet/i,
    ]) assert.doesNotMatch(g, stale, String(stale));
  });
  it("both endpoints are documented with their exact method and path", () => {
    assert.match(g, /POST \/api\/v1\/ads\/impression/);
    assert.match(g, /GET \/api\/v1\/ads\/click/);
    assert.match(g, /4c\. Reporting an impression/);
    assert.match(g, /4d\. Click redirect/);
    assert.match(g, /4b\. Serve, impression and click are three different events/);
  });
  it("the real route files really export exactly those methods", () => {
    assert.match(read("app/api/v1/ads/impression/route.ts"), /export async function POST/);
    assert.doesNotMatch(read("app/api/v1/ads/impression/route.ts"), /export async function (GET|PUT|PATCH|DELETE|HEAD)/);
    const click = read("app/api/v1/ads/click/route.ts");
    assert.match(click, /export async function GET/);
    for (const m of ["HEAD", "POST", "PUT", "PATCH", "DELETE"]) assert.match(click, new RegExp(`export async function ${m}\\(\\) \\{\\s*return methodNotAllowed`), m);
  });
});

describe("Day 17 part 3: the guide documents the real click_ref response contract (and invents nothing)", () => {
  const CFG = { secrets: ["k7f2-0123456789-abcdefghijklmnopqrstuvwxyz-primary"], ttlSeconds: 3600 };
  it("the real tracking object is token, expires_at, events plus the optional click_ref; click_url exists nowhere", () => {
    assert.deepEqual([...PUBLIC_TRACKING_FIELDS], ["token", "expires_at", "events"]);
    assert.deepEqual([...PUBLIC_TRACKING_OPTIONAL_FIELDS], ["click_ref"]);
    assert.doesNotMatch(read("lib/ads/contract.ts"), /click_url/);
    for (const f of ["lib/ads/match-handler.ts", "lib/ads/serve.ts", "lib/ads/serve-db.ts"]) {
      assert.doesNotMatch(read(f), /click-ref|mintClickRef|click_ref|click_url/, f);
    }
  });

  it("the guide's tracking example has exactly the real keys, an obvious bc1 placeholder, and equals what the real mapper builds", () => {
    const body = JSON.parse(lines("TRACKING_SUCCESS_EXAMPLE")) as { ad: Record<string, unknown>; tracking: Record<string, unknown> };
    assert.deepEqual(Object.keys(body.tracking), [...PUBLIC_TRACKING_FIELDS, ...PUBLIC_TRACKING_OPTIONAL_FIELDS]);
    assert.match(String(body.tracking.token), /^bt1\.EXAMPLE-/);
    assert.match(String(body.tracking.click_ref), /^bc1\.EXAMPLE-/);
    assert.notEqual(body.tracking.token, body.tracking.click_ref);
    const real = buildAdResponse(
      { id: String(body.ad.id), headline: String(body.ad.headline), body: String(body.ad.body), ctaText: body.ad.cta_text as string, destinationUrl: String(body.ad.destination_url) },
      { token: String(body.tracking.token), expiresAtMs: Date.parse(String(body.tracking.expires_at)), events: body.tracking.events as never, clickRef: String(body.tracking.click_ref) },
    );
    assert.deepEqual(plain(real), body, "the example is byte-for-byte what buildAdResponse produces");
    assert.doesNotMatch(JSON.stringify(body), /click_url|clickUrl|publisher_id|creative_id|serve_ref|campaign/);
  });

  it("the plain (no opt-in) success example still has no tracking object and no click_ref", () => {
    const body = JSON.parse(lines("SUCCESS_EXAMPLE")) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["ad", "fill", "sponsored"]);
    assert.doesNotMatch(lines("SUCCESS_EXAMPLE"), /click_ref|bc1|bt1/);
  });

  it("every tracking.* field the guide or its examples mention is a real contract field", () => {
    const allowed = new Set<string>([...PUBLIC_TRACKING_FIELDS, ...PUBLIC_TRACKING_OPTIONAL_FIELDS]);
    for (const text of [flat(GUIDE), lines("TRACKED_SERVER_EXAMPLE")]) {
      const used = new Set([...text.matchAll(/\btracking\??\.([A-Za-z_]+)/g)].map((m) => m[1]));
      assert.ok(used.has("click_ref") && used.has("token"));
      for (const f of used) assert.ok(allowed.has(f), `tracking.${f} is not part of the contract`);
    }
    assert.doesNotMatch(flat(GUIDE), /click_url|click_link|redirect_url|"click":/);
  });

  it("the guide keeps token (bt1, impression) and click_ref (bc1, click redirect) clearly apart", () => {
    const g = flat(GUIDE);
    assert.equal(TRACKING_TOKEN_PREFIX, "bt1");
    assert.equal(CLICK_REF_PREFIX, "bc1");
    assert.match(g, /Two different values for two different jobs/);
    assert.match(g, /tracking\.token<\/td> <td className="py-2 pr-3 font-mono text-xs">bt1\.<\/td> <td className="py-2 pr-3">Impression reporting/);
    assert.match(g, /tracking\.click_ref<\/td> <td className="py-2 pr-3 font-mono text-xs">bc1\.<\/td> <td className="py-2 pr-3">The click redirect and click recording/);
    assert.match(g, /the click endpoint refuses a <code>bt1<\/code> token, and the impression endpoint refuses a <code>bc1<\/code> reference/);
    assert.match(g, /do not send the tracking token to the click endpoint/);
    assert.match(g, /do not try to make a reference yourself/);
    assert.match(g, /Never replace a missing <code>click_ref<\/code> with your own link or with the token/);
    assert.doesNotMatch(g, /does not give you a click reference yet|cannot build a working Blisscco click link|do not return a click reference yet/i);
  });

  it("the guide says the click endpoint performs the redirect using the database-verified destination, and never to link destination_url", () => {
    const g = flat(GUIDE);
    assert.match(g, /looks up the ad&apos;s destination in Blisscco&apos;s own database, and only then redirects the person there/);
    assert.match(g, /the endpoint never reads one from the link/);
    assert.match(g, /destination it verified in its own database/);
    assert.match(g, /Never link straight to <code>destination_url<\/code>, and never build a redirect address from it/);
    assert.match(g, /With such a link the click is not reported to Blisscco/);
    assert.match(g, /<code>encodeURIComponent\(\)<\/code>/);
    assert.match(lines("TRACKED_SERVER_EXAMPLE"), /encodeURIComponent\(tracking\.click_ref\)/);
  });

  it("the production-readiness disclaimer, the Idempotency-Key retry guidance and the no-chatbot-integration statement are still there", () => {
    const g = flat(GUIDE);
    assert.match(g, /Not ready for production use/);
    assert.match(g, /Known limitations/);
    assert.match(g, /so do not roll this out to real users yet/);
    assert.match(g, /no integration with ChatGPT or any other third-party chatbot/);
    assert.match(g, /If you retry that same placement after a timeout or a 5xx,\s*send the same key/);
    assert.match(g, /reuses the original ad and the original serve/);
    assert.match(g, /Match retries are safe only when you send the same <code>Idempotency-Key<\/code>/);
  });

  it("Day 18 part 2: the retry text is expiry-aware (original serve reused; credentials only while the original lifetime is valid)", () => {
    const g = flat(GUIDE);
    // original ad + serve reused, no second serve / charge / click, still eligibility-bound
    assert.match(g, /reuses the original ad and the original serve \(the delivery\)/);
    assert.match(g, /does not create a second delivery or a second charge, and it does not create a second click/);
    assert.match(g, /if it is no longer eligible, the retry is a no-fill and Blisscco does not pick a different ad/);
    // before expiry: identical credentials, same expires_at, never extended
    assert.match(g, /While the original tracking lifetime is still valid<\/strong> \(before the <code>expires_at<\/code> of the first response\), the retry returns the identical <code>tracking\.token<\/code> and <code>tracking\.click_ref<\/code>, with the same <code>expires_at<\/code>/);
    assert.match(g, /so a retry never extends it/);
    // at / after expiry: original ad, no tracking object, no fresh credentials
    assert.match(g, /At or after that <code>expires_at<\/code><\/strong>, the retry still returns the original ad, but with no <code>tracking<\/code> object, so there is no <code>tracking\.token<\/code> and no <code>tracking\.click_ref<\/code>/);
    assert.match(g, /does not issue a fresh token or click reference for an old serve/);
    assert.match(g, /An expired credential can never be refreshed by replaying an old serve/);
    assert.match(g, /new ad request with a new <code>Idempotency-Key<\/code>. That is a new serve and it is charged as a new serve/);
    // the old unconditional claim is gone
    assert.doesNotMatch(g, /returns the same ad, the same delivery and the identical <code>token<\/code> and <code>click_ref<\/code>, with the same <code>expires_at<\/code>\. It does not create/);
    assert.doesNotMatch(g, /Blisscco then returns the same ad and does not count a second serve\. Keys/);
  });

  it("Day 18 part 2: a missing tracking object or click_ref is documented as normal and must be handled safely", () => {
    const g = flat(GUIDE);
    assert.match(g, /you retried an earlier request with the same <code>Idempotency-Key<\/code> after <code>expires_at<\/code> of the first response had passed/);
    assert.match(g, /show the ad with the Sponsored label, do not report an impression, and show no Blisscco click link/);
    assert.match(g, /Do not generate your own tracking reference, and do not reuse a token or <code>click_ref<\/code> after its <code>expires_at<\/code>/);
    assert.match(g, /never make up a tracking reference yourself, and never keep an old one to use after its <code>expires_at<\/code>/);
    assert.match(g, /Never replace a missing <code>click_ref<\/code> with your own link or with the token/);
    assert.match(g, /a late retry returns the ad without <code>tracking<\/code>/);
    assert.match(g, /never refreshes expired tracking credentials/);
  });

  describe("buildClickUrl() in the server example (runs for real)", () => {
    type Tr = { token: string; expires_at: string; events: string[]; click_ref?: string };
    const SRC = lines("TRACKED_SERVER_EXAMPLE");
    const load = (env: Record<string, string | undefined>) => {
      const js = ts.transpileModule(SRC, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, strict: true } }).outputText;
      const mod = { exports: {} as Record<string, unknown> };
      vm.runInNewContext(js, { module: mod, exports: mod.exports, process: { env }, crypto: globalThis.crypto, AbortSignal, Promise, Date, Math, Number, JSON, setTimeout, fetch: async () => { throw new Error("no network in this test"); } });
      return mod.exports.buildClickUrl as (t: Tr | null) => string | null;
    };
    const ENV = { BLISSCCO_API_BASE_URL: "https://api.example.test", BLISSCCO_PUBLISHER_API_KEY: "test-key-not-real" };
    const NOW = Date.now();
    const SERVE = "bsr_" + "ab".repeat(20);
    const PUB = "00000000-0000-4000-8000-0000000000a1";
    const CREATIVE = "00000000-0000-4000-8000-0000000000c1";
    const input = { serveRef: SERVE, publisherId: PUB, servedAtMs: NOW, nowMs: NOW };
    const real = (): Tr => {
      const bt = mintTrackingToken(CFG, input)!;
      const bc = mintClickRef(CFG, { ...input, creativeId: CREATIVE })!;
      return { token: bt.token, expires_at: new Date(bt.expiresAtMs).toISOString(), events: [...bt.events], click_ref: bc.ref };
    };

    it("builds API base + /api/v1/ads/click + one ref parameter; the real parser and the real verifier accept it", () => {
      const tr = real();
      const url = load(ENV)(tr)!;
      assert.equal(url, "https://api.example.test/api/v1/ads/click?ref=" + encodeURIComponent(tr.click_ref!));
      const parsed = new URL(url);
      assert.equal(parsed.pathname, "/api/v1/ads/click");
      assert.deepEqual([...parsed.searchParams.keys()], [CLICK_PARAM]);
      assert.equal(parseClickQuery(parsed.searchParams).ok, true);
      assert.equal(parsed.searchParams.get(CLICK_PARAM), tr.click_ref);
      assert.ok(verifyClickRef(parsed.searchParams.get(CLICK_PARAM), CFG, NOW).ok, "a genuine signed reference survives the round trip");
      assert.equal(url.includes(tr.token), false, "the bt1 token is never part of the click link");
      assert.equal(url.includes("test-key-not-real"), false, "the API key is never part of the click link");
    });

    it("a trailing slash on the base URL does not double up; the reference is URL-encoded", () => {
      const tr = real();
      assert.equal(load({ ...ENV, BLISSCCO_API_BASE_URL: "https://api.example.test/" })(tr), "https://api.example.test/api/v1/ads/click?ref=" + encodeURIComponent(tr.click_ref!));
    });

    it("returns null (no link) for: no tracking, no click_ref, a bt1 token, junk, an oversized value, an expired one or no configured base URL", () => {
      const tr = real();
      const f = load(ENV);
      assert.equal(f(null), null);
      const { click_ref: _omit, ...without } = tr;
      assert.equal(f(without), null);
      for (const bad of [tr.token, "", "bc1.a", "bc1.a.b.c", "BC1.a.b", "https://evil.example/", "bc1.a b.c", "bc1.a.b&url=https://evil.example", `bc1.${"x".repeat(600)}.y`, 42 as never]) {
        assert.equal(f({ ...tr, click_ref: bad }), null, String(bad).slice(0, 30));
      }
      assert.equal(f({ ...tr, expires_at: new Date(Date.now() - 1000).toISOString() }), null);
      assert.equal(load({ ...ENV, BLISSCCO_API_BASE_URL: undefined })(tr), null);
    });

    it("never reads destination_url: the function does not mention it, and the link does not change with it", () => {
      const fn = /export function buildClickUrl[\s\S]*?\n\}/.exec(SRC);
      assert.ok(fn);
      assert.doesNotMatch(fn[0], /destination/i);
      assert.doesNotMatch(fn[0], /API_KEY/);
    });
  });

  describe("the rendering example uses the click endpoint, not destination_url", () => {
    type PublicAd = { id: string; headline: string; body: string; cta_text: string | null; destination_url: string };
    const js = ts.transpileModule(lines("RENDER_EXAMPLE"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, strict: true } }).outputText;
    const mod = { exports: {} as Record<string, unknown> };
    vm.runInNewContext(js, { module: mod, exports: mod.exports });
    const render = mod.exports.renderSponsoredAd as (ad: PublicAd, clickUrl: string | null) => string;
    const ad: PublicAd = { id: "3f2b8c1e-5a47-4d9e-9b62-7c1d8e4a6f10", headline: "Level up", body: "Gaming laptops", cta_text: "Shop now", destination_url: "https://advertiser.example/landing" };
    const CLICK = "https://api.example.test/api/v1/ads/click?ref=bc1.EXAMPLE-PAYLOAD.EXAMPLE-SIGNATURE";

    it("the link is the Blisscco click URL with sponsored rel; the advertiser destination appears nowhere in the HTML", () => {
      assert.match(render(ad, CLICK), /<a href="https:\/\/api\.example\.test\/api\/v1\/ads\/click\?ref=bc1\.EXAMPLE-PAYLOAD\.EXAMPLE-SIGNATURE" rel="sponsored noopener noreferrer">Shop now<\/a>/);
      for (const a of [ad, { ...ad, destination_url: "javascript:alert(1)" }, { ...ad, destination_url: "http://evil.example" }]) {
        assert.equal(render(a, CLICK).includes(a.destination_url), false, a.destination_url);
      }
    });
    it("no click URL (no click_ref) means no link at all; destination_url is never promoted to a link", () => {
      const out = render(ad, null);
      assert.equal(out.includes("<a "), false);
      assert.equal(out.includes("advertiser.example"), false);
      assert.match(out, /<span>Sponsored<\/span>/);
    });
    it("only an https Blisscco click link with a bc1 ref is accepted; any other shape is dropped", () => {
      for (const bad of [
        ad.destination_url, "http://api.example.test/api/v1/ads/click?ref=bc1.a.b", "javascript:alert(1)", "//api.example.test/api/v1/ads/click?ref=bc1.a.b",
        "https://api.example.test/api/v1/ads/click?ref=bt1.a.b", "https://api.example.test/api/v1/ads/click?ref=bc1.a.b&url=https://evil.example",
        "https://api.example.test/other?ref=bc1.a.b", "https://api.example.test/api/v1/ads/click", "https://api.example.test/api/v1/ads/click?ref=bc1.a.b#x",
        'https://api.example.test/api/v1/ads/click?ref=bc1.a"onmouseover="x', "https://api.example.test/api/v1/ads/click?ref=bc1.a b", "",
      ]) {
        assert.equal(render(ad, bad).includes("<a "), false, bad);
      }
    });
    it("a real click_ref run through buildAdResponse and a click URL is accepted by the example", () => {
      const ref = mintClickRef(CFG, { serveRef: "bsr_" + "cd".repeat(20), publisherId: "00000000-0000-4000-8000-0000000000a1", creativeId: "00000000-0000-4000-8000-0000000000c1", servedAtMs: Date.now(), nowMs: Date.now() })!;
      const url = "https://api.example.test/api/v1/ads/click?ref=" + encodeURIComponent(ref.ref);
      assert.match(render(ad, url), /<a href="https:\/\/api\.example\.test\/api\/v1\/ads\/click\?ref=bc1\./);
    });
    it("says that a direct destination link is not reported to Blisscco", () => {
      assert.match(lines("RENDER_EXAMPLE"), /NOT reported to Blisscco/);
      assert.match(flat(GUIDE), /the click is not reported to Blisscco/);
    });
  });

  it("the server example is backend-only, keeps the key out of every link and does not send the key to the click endpoint", () => {
    const SRC = lines("TRACKED_SERVER_EXAMPLE");
    assert.match(SRC, /Runs on YOUR backend only/);
    assert.match(SRC, /a CLICK link/);
    assert.match(SRC, /NEVER from ad\.destination_url/);
    const build = /export function buildClickUrl[\s\S]*?\n\}/.exec(SRC)![0];
    assert.doesNotMatch(build.replace(/\/\/.*$/gm, ""), /Authorization|API_KEY|\.token\b/);
    assert.doesNotMatch(SRC, /blc_live_|NEXT_PUBLIC|VITE_|REACT_APP/);
  });
});

describe("Day 15 part 4: token expiry claims match the code", () => {
  const g = flat(GUIDE);
  it("default one hour, never more than 24 hours, counted from the serve", () => {
    assert.equal(DEFAULT_TTL_SECONDS, 3600);
    assert.equal(MAX_TTL_SECONDS, 86_400);
    assert.match(g, /one hour by default, never more than 24 hours/);
    assert.match(g, /counted from the moment the ad was served/);
    assert.match(g, /more than 24 hours after the serve/);
  });
  it("the 24 hour hard limit really is in the SQL writers", () => {
    for (const f of ["supabase/sql/day-12-7-record-ad-impression.sql", "supabase/sql/day-12-10-record-ad-click.sql"]) {
      assert.match(read(f), /interval '24 hours'/, f);
    }
  });
  it("the guide's 512 character limits are the real ones", () => {
    assert.equal(MAX_TOKEN_LENGTH, 512);
    assert.match(g, /over 512 characters/);
    assert.equal(MAX_IMPRESSION_BODY_BYTES, 1024);
    assert.match(g, /over 1024 bytes/);
  });
});

describe("Day 15 part 4: impression examples are accepted by the real impression API", () => {
  const body = JSON.parse(lines("IMPRESSION_REQUEST_EXAMPLE")) as Record<string, unknown>;
  it("the request body example passes the real parser with exactly two fields", () => {
    assert.deepEqual(Object.keys(body).sort(), ["event", "token"]);
    assert.equal(body.event, "impression");
    assert.match(String(body.token), /^bt1\.EXAMPLE-/, "an obviously fake token");
    assert.equal(parseImpressionRequest(JSON.stringify(body)).ok, true);
  });
  it("the cURL example has the right path, JSON content type, no API key and no Idempotency-Key", () => {
    const curl = lines("IMPRESSION_CURL_EXAMPLE");
    assert.match(curl, /-X POST "https:\/\/YOUR-BLISSCCO-API-HOST\/api\/v1\/ads\/impression"/);
    assert.match(curl, /Content-Type: application\/json/);
    assert.doesNotMatch(curl, /Authorization|BLISSCCO_PUBLISHER_API_KEY|Idempotency-Key|blc_live_/);
  });
  it("the real handler accepts that exact request and answers with the documented bodies", async () => {
    const guards = () => ({ requestGuard: createIpGuard(300), failureGuard: createIpGuard(30) });
    const send = (accept: (t: unknown, e: unknown) => Promise<{ kind: "recorded" } | { kind: "duplicate" }>) =>
      handleImpressionPost(
        new Request("https://api.example.test/api/v1/ads/impression", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
        { accept, ...guards() },
      );
    const first = await send(async () => ({ kind: "recorded" }));
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), JSON.parse(lines("IMPRESSION_RECORDED_EXAMPLE")));
    const again = await send(async () => ({ kind: "duplicate" }));
    assert.equal(again.status, 200);
    assert.deepEqual(await again.json(), JSON.parse(lines("IMPRESSION_DUPLICATE_EXAMPLE")));
    assert.equal(first.headers.get("cache-control"), "no-store");
    assert.equal(first.headers.get("x-blisscco-api-version"), "1");
  });
  it("every documented impression status really is produced by the real handler", async () => {
    const mk = (init: RequestInit, accept?: () => Promise<{ kind: "unauthorized" } | { kind: "unavailable" }>) =>
      handleImpressionPost(new Request("https://api.example.test/api/v1/ads/impression", { method: "POST", ...init }), {
        accept: accept ?? (async () => ({ kind: "unauthorized" as const })),
        requestGuard: createIpGuard(300),
        failureGuard: createIpGuard(30),
      });
    const json = { "content-type": "application/json" };
    const r400 = await mk({ headers: json, body: JSON.stringify({ token: "x", event: "click" }) });
    assert.equal(r400.status, 400);
    assert.deepEqual(await r400.json(), { error: "invalid_request", reason: "invalid_event" });
    const r400b = await mk({ headers: json, body: JSON.stringify({ token: "x", event: "impression", user: "u" }) });
    assert.equal((await r400b.json() as { reason: string }).reason, "unknown_field");
    const r401 = await mk({ headers: json, body: JSON.stringify(body) });
    assert.equal(r401.status, 401);
    assert.deepEqual(await r401.json(), { error: "unauthorized" });
    assert.equal((await mk({ headers: json, body: "x".repeat(MAX_IMPRESSION_BODY_BYTES + 1) })).status, 413);
    assert.equal((await mk({ headers: { "content-type": "text/plain" }, body: "{}" })).status, 415);
    const r503 = await mk({ headers: json, body: JSON.stringify(body) }, async () => ({ kind: "unavailable" }));
    assert.equal(r503.status, 503);
    assert.deepEqual(await r503.json(), { error: "unavailable" });
    const r429 = await handleImpressionPost(
      new Request("https://api.example.test/x", { method: "POST", headers: { ...json, "x-forwarded-for": TEST_IP }, body: JSON.stringify(body) }),
      { accept: async () => ({ kind: "recorded" }), requestGuard: blockedGuard(), failureGuard: createIpGuard(30) },
    );
    assert.equal(r429.status, 429);
    assert.equal(r429.headers.get("retry-after"), "60");
    const g = flat(GUIDE);
    for (const needle of ["invalid_json", "invalid_body", "unknown_field", "invalid_token", "invalid_event", "unreadable_body", "payload_too_large", "unsupported_media_type", "rate_limited", "Retry-After: 60"]) {
      assert.ok(g.includes(needle) || read(GUIDE).includes(needle), needle);
    }
  });
});

describe("Day 15 part 4: click documentation matches the real click API", () => {
  const g = flat(GUIDE);
  it("the click request example uses only the ref parameter and a fake bc1 value, marked 'format only'", () => {
    const curl = lines("CLICK_CURL_EXAMPLE");
    assert.match(curl, /Format only/);
    const url = /"(https:\/\/YOUR-BLISSCCO-API-HOST[^"]+)"/.exec(curl);
    assert.ok(url);
    const parsed = new URL(url[1].replace("YOUR-BLISSCCO-API-HOST", "api.example.test"));
    assert.equal(parsed.pathname, "/api/v1/ads/click");
    assert.deepEqual([...parsed.searchParams.keys()], [CLICK_PARAM]);
    const ref = parsed.searchParams.get(CLICK_PARAM) ?? "";
    assert.ok(ref.startsWith(`${CLICK_REF_PREFIX}.EXAMPLE-`), "obviously fake reference");
    assert.equal(parseClickQuery(parsed.searchParams).ok, true);
    assert.doesNotMatch(curl, /blc_live_|Authorization/);
  });
  it("only ref is allowed: anything else is refused by the real parser, as the guide says", () => {
    assert.deepEqual(parseClickQuery(new URLSearchParams("")), { ok: false, reason: "missing_ref" });
    assert.deepEqual(parseClickQuery(new URLSearchParams("ref=a&url=https://evil.example")), { ok: false, reason: "unexpected_parameter" });
    assert.deepEqual(parseClickQuery(new URLSearchParams("ref=a&ref=b")), { ok: false, reason: "unexpected_parameter" });
    assert.deepEqual(parseClickQuery(new URLSearchParams(`ref=${"a".repeat(MAX_TOKEN_LENGTH + 1)}`)), { ok: false, reason: "invalid_ref" });
    for (const reason of ["missing_ref", "unexpected_parameter", "invalid_ref"]) assert.ok(read(GUIDE).includes(reason), reason);
  });
  it("the real handler produces the documented 302 (with its headers), 204, 400, 404, 405, 429 and 503", async () => {
    const guards = () => ({ requestGuard: createIpGuard(300), failureGuard: createIpGuard(30) });
    const url = "https://api.example.test/api/v1/ads/click?ref=bc1.EXAMPLE-PAYLOAD.EXAMPLE-SIGNATURE";
    const dest = "https://example.com/gaming-laptops";
    const redirect = await handleClickGet(new Request(url), { accept: async () => ({ kind: "redirect", location: dest, counted: "duplicate" }), ...guards() });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get("location"), dest);
    const doc = lines("CLICK_RESPONSE_EXAMPLE");
    assert.match(doc, /^HTTP\/1\.1 302 Found/);
    assert.ok(doc.includes(`Location: ${dest}`));
    assert.ok(doc.includes(`Cache-Control: ${redirect.headers.get("cache-control")}`));
    assert.ok(doc.includes(`Referrer-Policy: ${redirect.headers.get("referrer-policy")}`));
    const prefetch = await handleClickGet(new Request(url, { headers: { "sec-purpose": "prefetch" } }), { accept: async () => ({ kind: "redirect", location: dest, counted: "recorded" }), ...guards() });
    assert.equal(prefetch.status, 204);
    const bad = await handleClickGet(new Request("https://api.example.test/api/v1/ads/click"), { accept: async () => ({ kind: "unavailable" }), ...guards() });
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: "invalid_request", reason: "missing_ref" });
    const nf = await handleClickGet(new Request(url), { accept: async () => ({ kind: "invalid", reason: "expired" }), ...guards() });
    assert.equal(nf.status, 404);
    assert.deepEqual(await nf.json(), { error: "not_found" });
    const nf2 = await handleClickGet(new Request(url), { accept: async () => ({ kind: "unavailable_target" }), ...guards() });
    assert.deepEqual(await nf2.json(), { error: "not_found" }, "an ad that cannot be clicked looks the same as a bad reference");
    const down = await handleClickGet(new Request(url), { accept: async () => ({ kind: "unavailable" }), ...guards() });
    assert.equal(down.status, 503);
    const limited = await handleClickGet(new Request(url, { headers: { "x-forwarded-for": TEST_IP } }), { accept: async () => ({ kind: "unavailable" }), requestGuard: blockedGuard(), failureGuard: createIpGuard(30) });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "60");
    const post = await clickRoute.POST();
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("allow"), "GET");
    assert.equal((await clickRoute.HEAD()).status, 405);
  });
  it("the guide documents the rules the click code and SQL really have", () => {
    assert.match(g, /only <code>GET<\/code> works|Only <code>GET<\/code> works|Only GET works/);
    assert.match(g, /counted only if the impression for that ad delivery was recorded first/);
    assert.match(g, /Only the first click of an ad delivery counts/);
    assert.match(g, /Referrer-Policy: no-referrer/);
    assert.match(g, /valid <code>https:\/\/<\/code> address/);
    assert.match(read("supabase/sql/day-12-10-record-ad-click.sql"), /not_counted/);
    assert.match(read("lib/ads/click-handler.ts"), /"Referrer-Policy": "no-referrer"/);
  });
});

describe("Day 15 part 4: serve, impression and click are kept apart; no charge claims are false", () => {
  const g = flat(GUIDE);
  it("explains all three and that only the serve is charged", () => {
    assert.match(g, /Ad serve/);
    assert.match(g, /Impression/);
    assert.match(g, /Click/);
    assert.match(g, /The only event that is charged/);
    assert.match(g, /Impressions and clicks are reporting counts\. They do not change spend, and they do not add earnings/);
  });
  it("the ledger SQL really says impressions and clicks are not charged or paid out", () => {
    const sql = read("supabase/sql/day-13-1-financial-ledger.sql");
    assert.match(sql, /Impression \/ click par koi charge nahi/);
    assert.match(sql, /koi impression \/ click se ledger nahi bhara jaata/);
  });
  it("the Idempotency-Key is documented for match only (the impression handler really ignores it)", () => {
    assert.match(g, /<code>Idempotency-Key<\/code> header belongs to the match request only|Idempotency-Key<\/code> header belongs to the match request only|header belongs to the match request only/);
    assert.doesNotMatch(read("lib/ads/impression-handler.ts") + read("lib/ads/click-handler.ts"), /idempotency/i);
  });
});

describe("Day 15 part 4: server-side tracking example runs and follows the rules", () => {
  type Tracking = { token: string; expires_at: string; events: string[] };
  type Mod = {
    getTrackedAd: (topic: string, key?: string) => Promise<{ ad: Record<string, unknown>; tracking: Tracking | null } | null>;
    reportImpression: (t: Tracking | null) => Promise<"recorded" | "duplicate" | "dropped" | "failed">;
  };
  type Seen = { url: string; headers: Record<string, string>; body: string };
  const SRC = lines("TRACKED_SERVER_EXAMPLE");
  const FUTURE = new Date(Date.now() + 3_600_000).toISOString();
  const TRACKING: Tracking = { token: "bt1.EXAMPLE-PAYLOAD.EXAMPLE-SIGNATURE", expires_at: FUTURE, events: ["impression", "click"] };
  const AD = { id: "3f2b8c1e-5a47-4d9e-9b62-7c1d8e4a6f10", headline: "Level up", body: "Gaming laptops", cta_text: "Shop now", destination_url: "https://example.com/g" };
  const reply = (status: number, body?: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

  function load(script: Array<ReturnType<typeof reply> | Error>, seen: Seen[], sleeps: number[] = [], env: Record<string, string | undefined> = { BLISSCCO_API_BASE_URL: "https://api.example.test", BLISSCCO_PUBLISHER_API_KEY: "test-key-not-real" }): Mod {
    const js = ts.transpileModule(SRC, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, strict: true } }).outputText;
    const mod = { exports: {} as Record<string, unknown> };
    const queue = [...script];
    const sandbox = {
      module: mod, exports: mod.exports, process: { env }, crypto: globalThis.crypto, AbortSignal, Promise, Date, Math, Number, JSON,
      fetch: async (url: string, init: { headers: Record<string, string>; body: string }) => {
        seen.push({ url, headers: init.headers, body: init.body });
        const next = queue.shift();
        if (!next) throw new Error("test: no more scripted replies");
        if (next instanceof Error) throw next;
        return next;
      },
      setTimeout: (fn: () => void, ms: number) => { sleeps.push(ms); fn(); return 0; },
    };
    vm.runInNewContext(js, sandbox);
    return mod.exports as unknown as Mod;
  }

  it("step 1 opts in to tracking with the real header, sends a key and returns ad + tracking (a missing tracking is fine)", async () => {
    const seen: Seen[] = [];
    const out = await load([reply(200, { fill: true, sponsored: true, ad: AD, tracking: TRACKING })], seen).getTrackedAd("gaming");
    assert.deepEqual(plain(out), { ad: AD, tracking: TRACKING });
    assert.equal(seen[0].url, "https://api.example.test/api/v1/ads/match");
    assert.equal(seen[0].headers["X-Blisscco-Tracking"], "1");
    assert.match(seen[0].headers["Idempotency-Key"], /^[A-Za-z0-9_-]{8,64}$/);
    assert.deepEqual(Object.keys(JSON.parse(seen[0].body)), ["topic"]);
    const none = await load([reply(200, { fill: true, sponsored: true, ad: AD })], []).getTrackedAd("gaming");
    assert.deepEqual(plain(none), { ad: AD, tracking: null });
    assert.equal(await load([reply(200, { fill: false })], []).getTrackedAd("gaming"), null);
  });

  it("step 1 retries a 503 once with the SAME Idempotency-Key and never retries a 4xx", async () => {
    const seen: Seen[] = [];
    const sleeps: number[] = [];
    const out = await load([reply(503, { fill: false, error: "unavailable" }), reply(200, { fill: true, sponsored: true, ad: AD })], seen, sleeps).getTrackedAd("gaming", "retry-key-12345678");
    assert.ok(out);
    assert.equal(seen.length, 2);
    assert.equal(seen[0].headers["Idempotency-Key"], "retry-key-12345678");
    assert.equal(seen[1].headers["Idempotency-Key"], "retry-key-12345678");
    assert.ok(sleeps[0] >= 1000);
    const seen401: Seen[] = [];
    assert.equal(await load([reply(401, { error: "unauthorized" })], seen401).getTrackedAd("gaming"), null);
    assert.equal(seen401.length, 1);
  });

  it("step 2 sends exactly {token, event:'impression'}, with no API key and no Idempotency-Key, to the impression endpoint", async () => {
    const seen: Seen[] = [];
    const out = await load([reply(200, { ok: true, status: "recorded" })], seen).reportImpression(TRACKING);
    assert.equal(out, "recorded");
    assert.equal(seen[0].url, "https://api.example.test/api/v1/ads/impression");
    assert.deepEqual(plain(seen[0].headers), { "Content-Type": "application/json" });
    const sent = JSON.parse(seen[0].body) as Record<string, unknown>;
    assert.deepEqual(sent, { token: TRACKING.token, event: "impression" });
    assert.equal(parseImpressionRequest(seen[0].body).ok, true, "the real parser accepts what the example sends");
    assert.equal(seen[0].body.includes("test-key-not-real"), false);
  });

  it("step 2: duplicate is success; 401 / 400 are dropped without retry; 429 stops; 503 and network errors retry then give up", async () => {
    const run = async (script: Array<ReturnType<typeof reply> | Error>, t: Tracking | null = TRACKING) => {
      const seen: Seen[] = [];
      const sleeps: number[] = [];
      const outcome = await load(script, seen, sleeps).reportImpression(t);
      return { outcome, calls: seen.length, sleeps };
    };
    assert.deepEqual(await run([reply(200, { ok: true, status: "duplicate" })]), { outcome: "duplicate", calls: 1, sleeps: [] });
    assert.equal((await run([reply(401, { error: "unauthorized" })])).calls, 1);
    assert.equal((await run([reply(401, { error: "unauthorized" })])).outcome, "dropped");
    assert.deepEqual(await run([reply(400, { error: "invalid_request" })]).then((r) => [r.outcome, r.calls]), ["dropped", 1]);
    assert.deepEqual(await run([reply(429, { error: "rate_limited" })]).then((r) => [r.outcome, r.calls]), ["failed", 1]);
    const recovered = await run([reply(503, { error: "unavailable" }), new Error("network"), reply(200, { ok: true, status: "recorded" })]);
    assert.equal(recovered.outcome, "recorded");
    assert.equal(recovered.calls, 3);
    assert.ok(recovered.sleeps.every((ms) => ms >= 1000));
    const gaveUp = await run([reply(503, {}), reply(503, {}), reply(503, {})]);
    assert.deepEqual([gaveUp.outcome, gaveUp.calls], ["failed", 3]);
  });

  it("step 2: no token, an expired token, or no configuration means nothing is sent", async () => {
    for (const [t, env] of [
      [null, undefined],
      [{ ...TRACKING, expires_at: new Date(Date.now() - 1000).toISOString() }, undefined],
      [TRACKING, { BLISSCCO_API_BASE_URL: undefined, BLISSCCO_PUBLISHER_API_KEY: undefined }],
    ] as const) {
      const seen: Seen[] = [];
      assert.equal(await load([], seen, [], env as Record<string, string | undefined> | undefined).reportImpression(t), "dropped");
      assert.equal(seen.length, 0);
    }
  });

  it("the example is server-only, holds no key, uses server env variables and says to report only after display", () => {
    assert.match(SRC, /Runs on YOUR backend only/);
    assert.match(SRC, /process\.env\.BLISSCCO_PUBLISHER_API_KEY/);
    assert.doesNotMatch(SRC, /blc_live_|NEXT_PUBLIC|VITE_|REACT_APP/);
    assert.match(SRC, /only after the ad was really displayed/);
    assert.match(SRC, /a SERVE/);
    assert.match(SRC, /an IMPRESSION/);
  });
});

describe("Day 15 part 4: the Sponsored rendering example is safe", () => {
  type PublicAd = { id: string; headline: string; body: string; cta_text: string | null; destination_url: string };
  const js = ts.transpileModule(lines("RENDER_EXAMPLE"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, strict: true } }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  vm.runInNewContext(js, { module: mod, exports: mod.exports });
  const render = mod.exports.renderSponsoredAd as (ad: PublicAd, clickUrl: string | null) => string;
  const ad: PublicAd = { id: "3f2b8c1e-5a47-4d9e-9b62-7c1d8e4a6f10", headline: "Level up", body: "Gaming laptops", cta_text: "Shop now", destination_url: "https://example.com/g" };
  // Day 17 Part 3: link ab sirf Blisscco click URL hai (click_ref se bana); destination_url kabhi link nahi banta.
  const CLICK = "https://api.example.test/api/v1/ads/click?ref=bc1.EXAMPLE-PAYLOAD.EXAMPLE-SIGNATURE";

  it("always includes the visible Sponsored label, also when cta_text is null or there is no click link", () => {
    for (const [a, url] of [[ad, CLICK], [{ ...ad, cta_text: null }, CLICK], [ad, null], [{ ...ad, destination_url: "javascript:alert(1)" }, null]] as const) {
      assert.match(render(a, url), /<span>Sponsored<\/span>/);
    }
  });
  it("escapes HTML in every text field", () => {
    const out = render({ ...ad, headline: "<script>alert(1)</script>", body: "a & b <img src=x onerror=1>", cta_text: "\"><b>" }, CLICK);
    assert.equal(/<script|<img|<b>/.test(out), false);
    assert.match(out, /&lt;script&gt;/);
    assert.match(out, /&amp;/);
  });
  it("links only the Blisscco click URL, with rel sponsored noopener noreferrer, and never destination_url", () => {
    assert.match(render(ad, CLICK), /<a href="https:\/\/api\.example\.test\/api\/v1\/ads\/click\?ref=bc1\.EXAMPLE-PAYLOAD\.EXAMPLE-SIGNATURE" rel="sponsored noopener noreferrer">Shop now<\/a>/);
    for (const url of [ad.destination_url, "http://example.com/g", "javascript:alert(1)", "data:text/html,x", "//example.com"]) {
      assert.equal(render({ ...ad, destination_url: url }, null).includes("<a "), false, url);
      assert.equal(render(ad, url).includes("<a "), false, url);
    }
  });
  it("says that a direct destination link is not reported to Blisscco", () => {
    assert.match(lines("RENDER_EXAMPLE"), /NOT reported to Blisscco/);
    assert.match(flat(GUIDE), /the click is not reported to Blisscco/);
  });
});

describe("Day 15 part 4: guide still never shows a real key or secret", () => {
  it("no live-looking key, no tracking secret, no signing secret and no real token anywhere on the guide", () => {
    const src = read(GUIDE);
    assert.equal(/blc_live_[0-9a-f]{8,}/i.test(src), false);
    assert.equal(/AD_TRACKING_SECRET|signing secret|service[_ -]role|sb_secret_/i.test(src), false);
    for (const m of src.matchAll(/\b(bt1|bc1)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)/g)) {
      assert.match(m[2], /^EXAMPLE-/, `${m[0]}: not an obvious placeholder`);
      assert.match(m[3], /^EXAMPLE-/, `${m[0]}: not an obvious placeholder`);
    }
    assert.equal(/eyJ[A-Za-z0-9_-]{10,}/.test(src), false, "no JWT-looking value");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Day 15 Part 6: guide vs asli impression / click route contracts. Har claim ko asli handler chalakar jaancha gaya.
// Mismatch jo mile aur guide me theek kiye gaye: (1) click ka 429 malformed query (400) ko bhi ginta hai, sirf "rejected ref" ko nahi;
// (2) prefetch 204 sirf sahi shape ke link par, bina ref ke prefetch 400 hai; (3) "har response JSON" ka daawa click ke 302 / 204 par galat tha.
// ---------------------------------------------------------------------------------------------------------------------

describe("Day 15 part 6: guide matches the real impression and click routes", () => {
  const page = flat(GUIDE);
  const IP = { "x-forwarded-for": "203.0.113.9" };
  const guards = () => ({ requestGuard: createIpGuard(300), failureGuard: createIpGuard(30) });
  const clickUrl = (qs: string) => `https://api.example.test/api/v1/ads/click${qs}`;
  const accept = async (): Promise<ClickResult> => ({ kind: "redirect", location: "https://example.com/gaming-laptops", counted: "recorded" });

  it("documented rate limits (300 requests, 30 rejected per minute, Retry-After 60) are the real constants for BOTH endpoints", () => {
    assert.deepEqual([IMP_REQ_LIMIT, IMP_FAIL_LIMIT, CLICK_REQ_LIMIT, CLICK_FAIL_LIMIT], [300, 30, 300, 30]);
    assert.match(page, /about 300 requests per minute, and about 30 rejected tokens per minute/);
    assert.match(page, /Retry-After: 60/);
  });

  it("click: malformed query links (400) really count towards the 429, and the guide now says so", async () => {
    const opts = { ...guards(), accept };
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await handleClickGet(new Request(clickUrl(""), { headers: IP }), opts)).status;
    assert.equal(last, 429);
    const row429 = /status: "429", body: "rate_limited", meaning: "([^"]+)"/.exec(read(GUIDE).slice(read(GUIDE).indexOf("const CLICK_ERRORS")));
    assert.ok(row429);
    assert.match(row429[1], /malformed click links \(400\)/);
    assert.match(row429[1], /rejected references \(404\)/);
  });

  it("click: a rejected reference (404) counts too, but a well-formed link that works never does", async () => {
    const bad = { ...guards(), accept: async (): Promise<ClickResult> => ({ kind: "invalid", reason: "invalid_signature" }) };
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await handleClickGet(new Request(clickUrl("?ref=bc1.a.b"), { headers: IP }), bad)).status;
    assert.equal(last, 429);
    const good = { ...guards(), accept };
    for (let i = 0; i < 100; i++) assert.equal((await handleClickGet(new Request(clickUrl("?ref=bc1.a.b"), { headers: IP }), good)).status, 302);
  });

  it("click: prefetch is 204 only for a well-formed link; a prefetch with no ref is 400, as the guide now says", async () => {
    const h = { ...IP, "sec-purpose": "prefetch" };
    assert.equal((await handleClickGet(new Request(clickUrl("?ref=bc1.a.b"), { headers: h }), { ...guards(), accept })).status, 204);
    const noRef = await handleClickGet(new Request(clickUrl(""), { headers: h }), { ...guards(), accept });
    assert.equal(noRef.status, 400);
    assert.deepEqual(await noRef.json(), { error: "invalid_request", reason: "missing_ref" });
    assert.match(page, /prefetch or prerender asked for a correctly formed click link/);
    assert.match(page, /A prefetch of a malformed link is answered 400/);
  });

  it("impression: only rejected tokens (401) count towards the failure limit, malformed bodies (400) do not, as the guide says", async () => {
    const post = (body: string) => new Request("https://api.example.test/api/v1/ads/impression", { method: "POST", headers: { "content-type": "application/json", ...IP }, body });
    const malformed = guards();
    let last = 0;
    for (let i = 0; i < 40; i++) last = (await handleImpressionPost(post("{"), { ...malformed, accept: async () => ({ kind: "recorded" }) })).status;
    assert.equal(last, 400);
    const rejected = guards();
    for (let i = 0; i < 31; i++) last = (await handleImpressionPost(post('{"token":"bt1.a.b","event":"impression"}'), { ...rejected, accept: async () => ({ kind: "unauthorized" }) })).status;
    assert.equal(last, 429);
    assert.match(page, /about 30 rejected tokens per minute/);
  });

  it("every documented impression 400 reason is exactly the set the real parser can return (no missing, no invented)", () => {
    const row400 = /status: "400", body: "invalid_request \+ reason", meaning: "The body broke the contract: ([^"]+)"/.exec(read(GUIDE));
    assert.ok(row400);
    const documented = [...row400[1].matchAll(/\b(invalid_json|invalid_body|unknown_field|invalid_token|invalid_event|unreadable_body)\b/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(documented)].sort(), ["invalid_body", "invalid_event", "invalid_json", "invalid_token", "unknown_field", "unreadable_body"]);
    const real = new Set<string>();
    for (const body of ["{", "[]", "null", '{"token":"a","event":"impression","x":1}', '{"event":"impression"}', '{"token":"a"}', '{"token":"a","event":"click"}']) {
      const p = parseImpressionRequest(body);
      if (!p.ok) real.add(p.reason);
    }
    assert.deepEqual([...real].sort(), ["invalid_body", "invalid_event", "invalid_json", "invalid_token", "unknown_field"]); // unreadable_body kommt vom Handler (Body-Lesefehler)
  });

  it("every documented click 400 reason is exactly the set the real parser returns", () => {
    const real = new Set<string>();
    for (const qs of ["", "ref=a&x=1", "ref=a&ref=b", "ref=", `ref=${"x".repeat(MAX_TOKEN_LENGTH + 1)}`]) {
      const p = parseClickQuery(new URLSearchParams(qs));
      if (!p.ok) real.add(p.reason);
    }
    assert.deepEqual([...real].sort(), ["invalid_ref", "missing_ref", "unexpected_parameter"]);
    for (const r of real) assert.ok(read(GUIDE).includes(r), r);
  });

  it("response headers: impression and click really send no-store and the version header; click 302/204 have no JSON body", async () => {
    const imp = await handleImpressionPost(
      new Request("https://api.example.test/api/v1/ads/impression", { method: "POST", headers: { "content-type": "application/json", ...IP }, body: '{"token":"bt1.a.b","event":"impression"}' }),
      { ...guards(), accept: async () => ({ kind: "recorded" }) },
    );
    assert.equal(imp.headers.get("cache-control"), "no-store");
    assert.equal(imp.headers.get("x-blisscco-api-version"), "1");
    assert.match(imp.headers.get("content-type") ?? "", /application\/json/);
    const redirect = await handleClickGet(new Request(clickUrl("?ref=bc1.a.b"), { headers: IP }), { ...guards(), accept });
    const prefetch = await handleClickGet(new Request(clickUrl("?ref=bc1.a.b"), { headers: { ...IP, "sec-purpose": "prefetch" } }), { ...guards(), accept });
    for (const r of [redirect, prefetch]) {
      assert.equal(r.headers.get("cache-control"), "no-store");
      assert.equal(r.headers.get("x-blisscco-api-version"), "1");
      assert.equal(await r.text(), "");
    }
    assert.equal(redirect.headers.get("referrer-policy"), "no-referrer");
    assert.equal(redirect.headers.get("location"), "https://example.com/gaming-laptops");
    // Guide ab yeh nahi kehta ki click ke jawab JSON hain.
    assert.doesNotMatch(page, /Every response from the API itself is JSON/);
    assert.match(page, /click endpoint, whose 302 and 204 answers have no body/);
  });

  it("the guide's click 302 example headers are all really sent, and its click and impression cURL examples are accepted by the real parsers", async () => {
    const example = lines("CLICK_RESPONSE_EXAMPLE");
    const redirect = await handleClickGet(new Request(clickUrl("?ref=bc1.EXAMPLE-PAYLOAD.EXAMPLE-SIGNATURE"), { headers: IP }), { ...guards(), accept });
    for (const line of example.split("\n").slice(1)) {
      const [name, ...value] = line.split(": ");
      if (name === "Location") continue; // Location me example.com ka alag URL hai; neeche alag se jaancha
      assert.equal(redirect.headers.get(name.toLowerCase()), value.join(": "), name);
    }
    assert.ok(example.startsWith("HTTP/1.1 302"));
    assert.deepEqual(parseClickQuery(new URLSearchParams("ref=bc1.EXAMPLE-PAYLOAD.EXAMPLE-SIGNATURE")), { ok: true, ref: "bc1.EXAMPLE-PAYLOAD.EXAMPLE-SIGNATURE" });
    assert.equal(parseImpressionRequest(lines("IMPRESSION_REQUEST_EXAMPLE")).ok, true);
  });

  it("405: route files export exactly the documented methods (impression POST only; click GET plus 405 stubs). Platform's empty 405 itself needs a real Next.js server and is NOT verified here", async () => {
    const impressionRoute = read("app/api/v1/ads/impression/route.ts");
    assert.match(impressionRoute, /export async function POST\(/);
    assert.doesNotMatch(impressionRoute, /export async function (GET|HEAD|PUT|PATCH|DELETE|OPTIONS)\(/);
    const res = await clickRoute.POST();
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "GET");
    assert.deepEqual(await res.json(), { error: "method_not_allowed" });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Day 20 Part 4: pilot quickstart + troubleshooting. Guide ke daave asli examples/ files, asli routes, retry rules aur security
// requirements se mel khate rahen. Koi network / database nahi.
// ---------------------------------------------------------------------------------------------------------------------

describe("Day 20 part 4: quickstart points at the real example files and env names", () => {
  const g = flat(GUIDE);
  const NODE_DIR = "examples/publisher-node";
  const NEXT_DIR = "examples/publisher-nextjs";

  it("both example folders are named, and every examples/ path the guide mentions exists", () => {
    assert.match(g, /Pilot quickstart: Node\.js and Next\.js/);
    assert.ok(g.includes(`${NODE_DIR}/`) && g.includes(`${NEXT_DIR}/`));
    const mentioned = new Set([...(read(GUIDE).matchAll(/examples\/publisher-(?:node|nextjs)\/[A-Za-z0-9_./-]*/g))].map((m) => m[0].replace(/[.]+$/, "")));
    assert.ok(mentioned.size >= 3, "guide examples/ paths ka zikr kare");
    for (const f of mentioned) assert.ok(existsSync(path.join(ROOT, f)), `${f} exist nahi karta`);
  });

  it("every example file the quickstart tells you to copy exists", () => {
    for (const f of [`${NODE_DIR}/src/client.ts`, `${NODE_DIR}/src/types.ts`, `${NEXT_DIR}/app/api/blisscco-ad/route.ts`, `${NEXT_DIR}/components/SponsoredAd.tsx`, `${NEXT_DIR}/lib/safe-url.ts`, `${NEXT_DIR}/.env.example`]) {
      assert.ok(existsSync(path.join(ROOT, f)), f);
    }
    for (const name of ["src/client.ts", "src/types.ts", "app/api/blisscco-ad/route.ts", "components/SponsoredAd.tsx", "lib/safe-url.ts", ".env.example"]) {
      assert.ok(g.includes(name), `guide ${name} ka naam nahi leta`);
    }
  });

  it("the env variable names are the ones the Next.js route reads and the example .env.example declares", () => {
    const route = read(`${NEXT_DIR}/app/api/blisscco-ad/route.ts`);
    const env = read(`${NEXT_DIR}/.env.example`);
    for (const name of ["BLISSCCO_PUBLISHER_API_KEY", "BLISSCCO_API_BASE_URL"]) {
      assert.ok(route.includes(`process.env.${name}`), `route ${name} nahi padhta`);
      assert.match(env, new RegExp(`^${name}=`, "m"));
      assert.ok(lines("NODE_QUICKSTART_EXAMPLE").includes(`process.env.${name}`), name);
      assert.match(lines("NEXTJS_ENV_EXAMPLE"), new RegExp(`^${name}=`, "m"));
    }
  });

  it("BlissccoClient.fromEnv() reads the same names as the guide (older names only as a fallback), and the guide says so", () => {
    const client = read(`${NODE_DIR}/src/client.ts`);
    assert.match(client, /ENV_BASE_URL = "BLISSCCO_API_BASE_URL"/);
    assert.match(client, /ENV_API_KEY = "BLISSCCO_PUBLISHER_API_KEY"/);
    assert.match(client, /ENV_BASE_URL_LEGACY = "BLISSCCO_BASE_URL"/);
    assert.match(client, /ENV_API_KEY_LEGACY = "BLISSCCO_API_KEY"/);
    assert.match(g, /<code>BlissccoClient\.fromEnv\(\)<\/code> reads <code>BLISSCCO_API_BASE_URL<\/code> and <code>BLISSCCO_PUBLISHER_API_KEY<\/code>, the same names as this guide/);
    assert.match(g, /older names <code>BLISSCCO_BASE_URL<\/code> and <code>BLISSCCO_API_KEY<\/code> still work as a fallback/);
  });

  it("the browser route and method the guide names are the real ones", () => {
    assert.match(g, /<code>POST \/api\/blisscco-ad<\/code>/);
    const route = read(`${NEXT_DIR}/app/api/blisscco-ad/route.ts`);
    assert.match(route, /export async function POST\(/);
    assert.doesNotMatch(route, /export async function (GET|PUT|PATCH|DELETE|HEAD|OPTIONS)\(/);
    assert.match(read(`${NEXT_DIR}/components/SponsoredAd.tsx`), /fetch\("\/api\/blisscco-ad", \{\s*method: "POST"/);
  });

  it("the guide's retry numbers are the real client defaults and limits", () => {
    const client = read(`${NODE_DIR}/src/client.ts`);
    assert.match(client, /DEFAULT_RETRY = \{ maxRetries: 2, baseDelayMs: 2000, maxDelayMs: 5000 \}/);
    assert.match(client, /RETRYABLE_STATUS: readonly number\[\] = \[429, 503\]/);
    assert.match(client, /IDEMPOTENCY_KEY_RE = \/\^\[A-Za-z0-9_-\]\{8,64\}\$\//);
    assert.match(g, /default <code>baseDelayMs<\/code> is 2000 \(jittered to 50 to 100 percent\), so every wait is at least 1 second/);
    assert.match(g, /60 seconds is above its default 5 second cap/);
    assert.match(g, /400, 401, 413 and 415 are never retried/);
    assert.match(g, /8 to 64 letters, digits, <code>_<\/code> or <code>-<\/code>/);
    assert.match(lines("NODE_QUICKSTART_EXAMPLE"), /baseDelayMs: 2000/);
  });

  it("the Next.js example opts in to impression + click tracking, has no direct advertiser link, and the guide says so honestly", () => {
    const route = read(`${NEXT_DIR}/app/api/blisscco-ad/route.ts`);
    const comp = read(`${NEXT_DIR}/components/SponsoredAd.tsx`);
    const routeCode = route.replace(/\/\/.*$/gm, "");
    assert.match(routeCode, /tracking: true/);
    assert.match(routeCode, /reportClick/);
    assert.match(comp, /click_ref: ref, event: "click"/);
    assert.doesNotMatch(comp, /href=\{ad\.href\}|<a\b/);
    assert.match(g, /opts in to tracking, reports one impression per ad that is really on screen, and reports a click when the button is pressed/);
    assert.match(g, /Your route sends the click ref to Blisscco, then the browser opens the ad&apos;s own https destination in a new tab/);
  });
});

describe("Day 20 part 4: the pilot rules are documented and match the examples", () => {
  const g = flat(GUIDE);

  it("server-side key storage: documented, and the quickstart code and env sample never expose the key", () => {
    assert.match(g, /<strong>Key storage:<\/strong> the API key lives only in your server&apos;s environment variables or secret manager/);
    assert.match(g, /Never put it in browser code, a mobile app, a variable with a public prefix such as <code>NEXT_PUBLIC_<\/code>, git, logs, tickets or chat/);
    for (const name of ["NODE_QUICKSTART_EXAMPLE", "NEXTJS_ENV_EXAMPLE", "NEXTJS_USAGE_EXAMPLE"]) {
      const src = lines(name);
      assert.doesNotMatch(src, /blc_live_/, name);
      assert.doesNotMatch(src, /^\s*(NEXT_PUBLIC|VITE|REACT_APP|EXPO_PUBLIC)_/m, `${name}: public-prefix variable`);
      assert.doesNotMatch(src, /localStorage|document\.|window\./, name);
    }
    assert.doesNotMatch(lines("NODE_QUICKSTART_EXAMPLE"), /NEXT_PUBLIC|VITE_|REACT_APP/);
    assert.match(lines("NODE_QUICKSTART_EXAMPLE"), /Runs on YOUR backend only/);
    assert.match(lines("NEXTJS_ENV_EXAMPLE"), /server only, never commit it/);
    assert.match(lines("NEXTJS_ENV_EXAMPLE"), /YOUR-BLISSCCO-API-HOST/);
    assert.equal(/"use client"|'use client'/.test(read(GUIDE)), false);
  });

  it("Idempotency-Key reuse during retries: documented, and the Node quickstart passes one placement key", () => {
    assert.match(g, /<strong>Idempotency-Key reuse:<\/strong> use one new random key per ad placement/);
    assert.match(g, /send the same key, so no second serve is counted/);
    assert.match(g, /A new placement gets a new key, and a key never contains a user id or text/);
    assert.match(g, /Each browser call makes a new <code>Idempotency-Key<\/code>, so a second call to your route is a new placement and a new serve/);
    const sample = lines("NODE_QUICKSTART_EXAMPLE");
    assert.match(sample, /placementKey: string = randomUUID\(\)/);
    assert.match(sample, /\{ idempotencyKey: placementKey \}/);
    assert.match(read("examples/publisher-node/src/client.ts"), /options\.idempotencyKey \?\? randomUUID\(\)/);
    assert.doesNotMatch(read("examples/publisher-nextjs/app/api/blisscco-ad/route.ts"), /idempotencyKey/);
  });

  it("Sponsored disclosure: documented, and the Next.js component always renders the word as text", () => {
    assert.match(g, /<strong>Sponsored disclosure:<\/strong> show the visible word <strong>Sponsored<\/strong> as text on every ad, in its own box after the assistant&apos;s answer/);
    assert.match(g, /Show nothing at all for a no-fill/);
    const comp = read("examples/publisher-nextjs/components/SponsoredAd.tsx");
    assert.match(comp, /aria-label="Sponsored"/);
    assert.match(comp, />Sponsored<\/p>/);
    assert.match(comp, /window\.open\(target, "_blank", "noopener,noreferrer"\)/);
    assert.match(lines("NEXTJS_USAGE_EXAMPLE"), /the assistant's own answer goes here, first/);
  });

  it("topic categories: the guide lists exactly the active taxonomy, and the Next.js allowlist is the same set", () => {
    const bullet = /<strong>Topic categories:<\/strong>([^]*?)Your code picks one/.exec(read(GUIDE));
    assert.ok(bullet);
    const documented = [...bullet[1].matchAll(/<code>([a-z_]+)<\/code>/g)].map((m) => m[1]).sort();
    assert.deepEqual(documented, ACTIVE_CATEGORIES.map((c) => c.slug).sort());
    const route = read("examples/publisher-nextjs/app/api/blisscco-ad/route.ts");
    const list = /ALLOWED_TOPICS: ReadonlySet<string> = new Set\(\[([^\]]*)\]\)/.exec(route);
    assert.ok(list);
    assert.deepEqual([...list[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort(), documented);
    assert.match(g, /Sensitive topics never return an ad/);
  });

  it("no raw chatbot conversations: documented, and the Next.js route and the API both reject anything but a topic", () => {
    assert.match(g, /<strong>No raw conversations:<\/strong> never forward a chatbot conversation to Blisscco: no user message, assistant answer, prompt, transcript, summary or keyword list, and no user id, email or session id/);
    assert.match(g, /The only signal is the topic slug your code chose/);
    assert.match(g, /The API rejects any other field with a 400/);
    for (const field of ["messages", "prompt", "user_id", "conversation_id"]) {
      assert.deepEqual(parseMatchRequest(JSON.stringify({ topic: "gaming", [field]: "x" })), { ok: false, reason: "unknown_field" }, field);
    }
    assert.match(read("examples/publisher-nextjs/app/api/blisscco-ad/route.ts"), /Object\.keys\(body\)\.some\(\(k\) => k !== "topic"\)\) return invalid\("unknown_field"\)/);
    assert.match(read("examples/publisher-nextjs/components/SponsoredAd.tsx"), /JSON\.stringify\(\{ topic \}\)/);
  });

  it("honesty: no production-ready or tested-with-third-party claim, and the existing disclaimers remain", () => {
    assert.match(g, /No third-party integration has been tested\./);
    assert.match(g, /Their automated tests use a mocked Blisscco API/);
    assert.match(g, /Not ready for production use/);
    assert.match(g, /so do not roll this out to real users yet/);
    assert.equal(/production[- ]ready/i.test(g), false);
    assert.equal(/(successfully|already|fully) (tested|verified|validated) (with|by|on)/i.test(g), false);
    assert.equal(/(works|runs|is live) (with|in|on) (chatgpt|openai|gemini|claude|perplexity|copilot)/i.test(g), false);
  });
});

describe("Day 20 part 4: troubleshooting section matches the real API contract", () => {
  const g = flat(GUIDE);
  const src = read(GUIDE);
  const table = src.slice(src.indexOf("const TROUBLESHOOTING"), src.indexOf("function StatusTable"));
  const rowOf = (status: string) => {
    const m = new RegExp(`status: "${status.replace(/[/ ]/g, (c) => `\\${c}`)}", body: "([^"]+)", meaning: "([^"]+)", action: "([^"]+)"`).exec(table);
    assert.ok(m, `troubleshooting row ${status}`);
    return { body: m[1], meaning: m[2], action: m[3] };
  };

  it("the section exists, is placed after section 5 and covers every required symptom", () => {
    assert.match(g, /5a\. Troubleshooting/);
    assert.ok(g.indexOf("5. Errors and retries") < g.indexOf("5a. Troubleshooting"));
    assert.ok(g.indexOf("5a. Troubleshooting") < g.indexOf("6. Showing the ad with a Sponsored label"));
    for (const status of ["400", "401", "413", "415", "429", "503", "200 no-fill", "200 without tracking", "401 / 404"]) rowOf(status);
    assert.match(g, /Troubleshooting: symptom, cause and fix/);
  });

  it("every 400 reason the guide lists is one the real validators produce, and nothing is missing", () => {
    const documented = [...rowOf("400").meaning.matchAll(/\b(invalid_[a-z_]+|unknown_field)\b/g)].map((m) => m[1]);
    const real = new Set<string>();
    for (const body of ["{", "[]", '{"topic":"gaming","x":1}', '{"topic":"Gaming"}', '{"topic":"gaming","fallback_topics":["Bad"]}', '{"topic":"gaming","exclude_ad_ids":["nope"]}']) {
      const r = parseMatchRequest(body);
      assert.equal(r.ok, false, body);
      if (!r.ok) real.add(r.reason);
    }
    real.add("invalid_idempotency_key"); // match-handler: parseIdempotencyKey ok:false
    real.add("invalid_tracking_header"); // match-handler: parseTrackingOptIn ok:false
    assert.deepEqual([...new Set(documented)].sort(), [...real].sort());
    assert.match(read("lib/ads/match-handler.ts"), /invalid_idempotency_key/);
    assert.match(read("lib/ads/match-handler.ts"), /invalid_tracking_header/);
  });

  it("413 / 415 / 429 / 503 numbers and names are the real ones", () => {
    assert.equal(MAX_BODY_BYTES, 2048);
    assert.match(rowOf("413").meaning, /over 2048 bytes \(impression: 1024 bytes\)/);
    assert.match(rowOf("413").meaning, /Next\.js route has a smaller limit of 1024 characters/);
    assert.match(read("examples/publisher-nextjs/app/api/blisscco-ad/route.ts"), /MAX_BODY_CHARS = 1024/);
    assert.equal(MAX_IMPRESSION_BODY_BYTES, 1024);
    assert.equal(rowOf("415").body, "unsupported_media_type");
    assert.equal(rowOf("413").body, "payload_too_large");
    assert.equal(rowOf("401").body, "unauthorized");
    assert.equal(rowOf("429").body, "rate_limited + Retry-After: 60");
    assert.equal(rowOf("503").body, "fill:false + error:unavailable");
    assert.match(read("lib/ads/match-handler.ts"), /"Retry-After": "60"/);
    assert.match(rowOf("429").meaning, /BlissccoRetryExhaustedError \(last status 429\)/);
    assert.match(read("examples/publisher-node/src/client.ts"), /readonly lastStatus\?: number/);
  });

  it("the Next.js route behaviour described in the table is what its source does (503 for any failure, own 400 invalid_topic)", () => {
    const route = read("examples/publisher-nextjs/app/api/blisscco-ad/route.ts");
    assert.match(route, /const unavailable = \(\) => reply\(\{ fill: false, error: "unavailable" \}, 503\)/);
    assert.match(route, /ALLOWED_TOPICS\.has\(topic\)\) return invalid\("invalid_topic"\)/);
    assert.match(route, /err instanceof Error \? err\.name : "unknown"/);
    assert.match(rowOf("503").meaning, /BlissccoConfigError/);
    assert.match(rowOf("400").meaning, /Next\.js route also answers 400 invalid_topic/);
    assert.match(rowOf("200 no-fill").meaning, /not a plain https link/);
  });

  it("missing and expired tracking credentials: the causes named are real contract behaviour", () => {
    const miss = rowOf("200 without tracking");
    assert.match(miss.meaning, /X-Blisscco-Tracking: 1/);
    assert.match(miss.meaning, /tracking: true/);
    assert.match(miss.action, /Never invent a token or click_ref/);
    assert.match(read("examples/publisher-node/src/client.ts"), /options\.tracking === true\) headers\["X-Blisscco-Tracking"\] = "1"/);
    assert.match(read("lib/ads/validation.ts"), /header\.trim\(\) === "1"/);
    const exp = rowOf("401 / 404");
    assert.equal(exp.body, "unauthorized (impression) / not_found (click)");
    assert.match(exp.meaning, /one hour by default, never more than 24 hours/);
    assert.match(exp.meaning, /after expires_at returns the ad but no tracking/);
    assert.match(exp.action, /NEW Idempotency-Key is a new serve and is charged as a new serve/);
    assert.match(exp.action, /Do not retry and do not try to refresh it: drop it/);
  });

  it("the troubleshooting text keeps every older rule: nothing is retried except 429 / 5xx, one key per placement", () => {
    assert.match(rowOf("400").action, /^Do not retry/);
    assert.match(rowOf("413").action, /^Do not retry/);
    assert.match(rowOf("415").action, /^Do not retry/);
    assert.match(rowOf("401").action, /^Do not retry/);
    assert.match(rowOf("503").action, /SAME Idempotency-Key/);
    assert.match(rowOf("429").action, /Do not loop/);
    assert.match(g, /Retry only 429 and 5xx/);
  });
});

describe("Day 22 part 4: the guide describes the optional Revive fallback accurately", () => {
  const section = (): string => {
    const g = flat(GUIDE);
    const start = g.indexOf("7a. Optional Revive fallback");
    const end = g.indexOf("8. Why the key must stay on your server");
    assert.ok(start > 0 && end > start, "Revive section must sit between sections 7 and 8");
    return g.slice(start, end);
  };

  it("says it is optional, disabled by default, may be no-fill, and is not an advertiser impression or billing event", () => {
    const t = section();
    assert.match(t, /optional and disabled by default/);
    assert.match(t, /may return no-fill/);
    assert.match(t, /\{"fill":false\}/);
    assert.match(t, /not a Blisscco advertiser impression or billing event/);
    assert.match(t, /No Blisscco advertiser is charged/);
  });

  it("'disabled by default' is true in the code: only the exact value 'true' switches the flag on", () => {
    assert.equal(reviveFallbackEnabled({}), false);
    for (const v of ["", "1", "TRUE", "yes", " true", "false"]) assert.equal(reviveFallbackEnabled({ REVIVE_FALLBACK_ENABLED: v }), false, v);
    assert.equal(reviveFallbackEnabled({ REVIVE_FALLBACK_ENABLED: "true" }), true);
  });

  it("does not promise tracking or reporting for Revive ads", () => {
    const t = section();
    assert.match(t, /does not provide tracking or reporting for Revive ads/);
    assert.match(t, /no tracking token and no <code>click_ref<\/code>/);
    assert.doesNotMatch(t, /Revive[^.]*\b(impressions? (are|is) (counted|reported|tracked)|earn(ings)? (are|will be)|will be (tracked|reported|paid))/i);
    assert.doesNotMatch(t, /\b(reporting|analytics|dashboard) (is|are) available for Revive/i);
  });

  it("a mapped Revive ad really has no tracking object and only the documented public fields", () => {
    const out = buildProviderAdResponse("revive", { headline: "H", body: "B", ctaText: null, destinationUrl: "https://example.com/x" });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.ok(!("tracking" in out.response));
    assert.deepEqual(Object.keys(out.response.ad).sort(), [...PUBLIC_AD_FIELDS].sort());
    const t = section();
    for (const field of PUBLIC_AD_FIELDS) assert.ok(t.includes(`<code>${field}</code>`), field);
  });

  it("the stated limit is true (Day 22 Part 6): attached to the match endpoint through service.ts, off by default, not idempotent", () => {
    assert.match(section(), /attached to the match endpoint but stays off unless Blisscco switches it on/);
    assert.match(section(), /A Revive ad is not idempotent/);
    assert.match(read("lib/ads/match-handler.ts"), /serveMatchForPublisher\(hashApiKey\(key\), matchRequest\)/);
    for (const f of ["lib/ads/match-handler.ts", "app/api/v1/ads/match/route.ts", "app/api/ads/match/route.ts"]) {
      assert.doesNotMatch(read(f), /serveAdWithFallback|fallback-routing|fallback-provider/, f);
    }
  });

  it("publishers are told nothing to configure: no Revive env variable, URL or key appears in the guide", () => {
    const g = read(GUIDE);
    assert.doesNotMatch(g, /REVIVE_[A-Z_]+/);
    assert.doesNotMatch(g, /zoneid|delivery URL|openx/i);
    assert.match(section(), /You never send a Revive setting, key or flag/);
  });

  it("states the safety limits that the code enforces: plain-text creatives, https destination, no raw HTML or scripts", () => {
    const t = section();
    assert.match(t, /Raw HTML, scripts and the provider&apos;s own data are never passed on/);
    assert.match(t, /plain-text creatives with a plain <code>https<\/code> destination/);
    assert.match(t, /including an HTML creative, is dropped and counts as no-fill/);
    assert.match(t, /has not been verified against a live Revive instance/);
  });

  it("older guide rules are intact: the Known limitations panel and the no-third-party-integration claim remain", () => {
    const g = flat(GUIDE);
    assert.match(g, /Known limitations/);
    assert.match(g, /no integration with ChatGPT or any other third-party chatbot/);
    assert.match(g, /No third-party integration has been tested\./);
  });
});
