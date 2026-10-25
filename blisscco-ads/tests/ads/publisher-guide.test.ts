import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PUBLIC_AD_FIELDS } from "@/lib/ads/contract";
import { parseMatchRequest } from "@/lib/ads/validation";

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
