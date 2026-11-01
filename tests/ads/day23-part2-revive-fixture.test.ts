import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { extractReviveCreative } from "@/lib/ads/revive-adapter";
import { buildProviderAdResponse } from "@/lib/ads/contract";
import { safeDestination } from "@/lib/ads/click";

// Day 23 Part 2: examples/revive-provider/ad.json sirf ek static test fixture hai. Koi network, DB, credential ya Revive server nahi.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const FIXTURE = "examples/revive-provider/ad.json";
const README = "examples/revive-provider/README.md";
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const walk = (dir: string): string[] =>
  existsSync(path.join(ROOT, dir))
    ? readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? (e.name === "node_modules" ? [] : walk(`${dir}/${e.name}`)) : [`${dir}/${e.name}`],
      )
    : [];

const raw = read(FIXTURE);
const ad = JSON.parse(raw) as Record<string, unknown>;

describe("day 23 part 2 | fixture shape", () => {
  it("is valid JSON: one plain object", () => {
    assert.ok(ad !== null && typeof ad === "object" && !Array.isArray(ad));
  });

  it("has exactly headline, body, cta_text and destination_url (no extra provider data)", () => {
    assert.deepEqual(Object.keys(ad).sort(), ["body", "cta_text", "destination_url", "headline"]);
  });

  it("text fields are non-empty strings within the project's creative limits", () => {
    assert.ok(typeof ad.headline === "string" && ad.headline.trim() !== "" && ad.headline.length <= 90);
    assert.ok(typeof ad.body === "string" && ad.body.trim() !== "" && ad.body.length <= 300);
    assert.ok(ad.cta_text === null || (typeof ad.cta_text === "string" && ad.cta_text.trim() !== "" && ad.cta_text.length <= 30));
    for (const k of ["headline", "body", "cta_text"]) {
      const v = ad[k];
      if (typeof v === "string") assert.ok(!/[<>\u0000-\u001f\u007f]/.test(v) && !/&(#\d+|#x[0-9a-f]+|[a-z]+);/i.test(v), k);
    }
  });

  it("is clearly marked as a test fixture and not a real advertiser", () => {
    assert.match(String(ad.headline), /TEST FIXTURE/);
    assert.match(String(ad.body), /not a real advertiser/i);
  });

  it("destination is a plain https URL on a reserved example domain, no credentials, query or fragment", () => {
    const u = new URL(String(ad.destination_url));
    assert.equal(u.protocol, "https:");
    assert.equal(u.username + u.password, "");
    assert.equal(u.search, "");
    assert.equal(u.hash, "");
    assert.match(u.hostname, /^(www\.)?example\.(com|org|net)$/);
    assert.equal(safeDestination(ad.destination_url), String(ad.destination_url));
  });
});

describe("day 23 part 2 | passes the existing contract", () => {
  it("extractReviveCreative accepts it as a json fill", () => {
    const r = extractReviveCreative({ status: "fill", format: "json", payload: ad });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.creative.headline, ad.headline);
      assert.equal(r.creative.body, ad.body);
      assert.equal(r.creative.ctaText, ad.cta_text);
      assert.equal(r.creative.destinationUrl, ad.destination_url);
    }
  });

  it("buildProviderAdResponse maps it to the public ad (no tracking, no extra fields)", () => {
    const e = extractReviveCreative({ status: "fill", format: "json", payload: ad });
    assert.equal(e.ok, true);
    if (!e.ok) return;
    const m = buildProviderAdResponse(e.provider, e.creative);
    assert.equal(m.ok, true);
    if (m.ok) {
      assert.deepEqual(Object.keys(m.response.ad).sort(), ["body", "cta_text", "destination_url", "headline", "id"]);
      assert.equal("tracking" in m.response, false);
    }
  });

  it("the optional cta_text may be null or omitted", () => {
    for (const p of [{ ...ad, cta_text: null }, (({ cta_text, ...rest }) => rest)(ad)]) {
      const r = extractReviveCreative({ status: "fill", format: "json", payload: p });
      assert.equal(r.ok && r.creative.ctaText, null);
    }
  });
});

describe("day 23 part 2 | no executable markup or credential-like values", () => {
  it("no markup, script, event handler or javascript:/data: URL anywhere in the file", () => {
    assert.doesNotMatch(raw, /[<>]/);
    assert.doesNotMatch(raw, /<\s*\/?\s*(script|iframe|img|svg|object|embed|a|style|link|meta)\b/i);
    assert.doesNotMatch(raw, /\bon[a-z]+\s*=|javascript:|data:|vbscript:|\beval\s*\(|document\.|window\./i);
  });

  it("no executable keys in the fixture", () => {
    const bad = ["html", "script", "scripts", "js", "javascript", "iframe", "tag", "code", "markup", "adm", "creative_html", "ad_html", "body_html", "snippet", "embed", "vast", "xml"];
    for (const k of Object.keys(ad)) assert.ok(!bad.includes(k.toLowerCase()), k);
  });

  it("no credential-like values: keys, tokens, secrets, zone ids, long random strings", () => {
    assert.doesNotMatch(raw, /api[_-]?key|secret|token|password|passwd|bearer|authorization|credential|zoneid|auth=|key=|sig=|signature|sk[-_][a-z0-9]{8,}|eyJ[a-z0-9_-]{10,}/i);
    assert.doesNotMatch(raw, /(?=[A-Za-z0-9+/_]*\d)(?=[A-Za-z0-9+/_]*[A-Za-z])[A-Za-z0-9+/_]{24,}/); // mixed letters+digits, random-looking
    assert.ok(Object.values(ad).every((v) => typeof v !== "string" || !/\S{60,}/.test(v.replace(/^https:\/\/example\.com/, ""))));
    assert.doesNotMatch(raw, /[0-9a-f]{24,}/i);
  });

  it("the README has no credentials or real delivery URL either", () => {
    const r = read(README);
    assert.doesNotMatch(r, /api[_-]?key=|secret=|token=|password=|bearer\s+\S+|zoneid=|eyJ[a-z0-9_-]{10,}/i);
    assert.doesNotMatch(r, /https?:\/\/(?!example\.com)[^\s)`]+/i);
  });
});

describe("day 23 part 2 | README states what the fixture is not", () => {
  const r = read(README);
  it("says static test fixture, not real Revive ad, not a Revive API endpoint, not production advertiser content", () => {
    assert.match(r, /static test fixture/i);
    assert.match(r, /not a real Revive-generated ad/i);
    assert.match(r, /not a Revive API endpoint/i);
    assert.match(r, /not production advertiser content/i);
  });
  it("says it is opt-in and manual only", () => {
    assert.match(r, /opt-in/i);
    assert.match(r, /Nothing in Blisscco reads this file/);
    assert.match(r, /test environment only/i);
  });
});

describe("day 23 part 2 | fixture is never used automatically", () => {
  const SERVING = [
    "lib/ads/revive-adapter.ts",
    "lib/ads/fallback-routing.ts",
    "lib/ads/fallback-provider.ts",
    "lib/ads/service.ts",
    "lib/ads/match-handler.ts",
    "lib/ads/contract.ts",
    "app/api/v1/ads/match/route.ts",
    "app/api/ads/match/route.ts",
  ];

  it("no serving, adapter, routing or route file refers to the fixture or the examples folder", () => {
    for (const f of SERVING) {
      const c = code(f);
      assert.doesNotMatch(c, /revive-provider|examples\/|ad\.json/i, f);
      assert.doesNotMatch(c, /readFile|readFileSync|from\s+["']node:fs|require\(["']fs/, f);
    }
  });

  it("nothing in app, lib or components imports, reads or names the fixture", () => {
    for (const f of ["app", "lib", "components"].flatMap(walk)) {
      if (!/\.(ts|tsx|js|jsx|mjs|json)$/.test(f)) continue;
      assert.doesNotMatch(code(f), /revive-provider/i, f);
    }
  });

  it("the adapter and fallback code add no fixed-fixture or mock fallback and no static JSON import", () => {
    for (const f of ["lib/ads/revive-adapter.ts", "lib/ads/fallback-routing.ts", "lib/ads/fallback-provider.ts"]) {
      const c = code(f);
      assert.doesNotMatch(c, /import\s+[^;]*\.json["']|require\([^)]*\.json/, f);
      assert.doesNotMatch(c, /fixture|TEST FIXTURE|example\.com/i, f);
    }
  });

  it("the fixture is not copied into public/ and not referenced by config, package or workflows", () => {
    assert.equal(existsSync(path.join(ROOT, "public/ad.json")), false);
    assert.equal(walk("public").some((f) => /ad\.json$/.test(f) && /revive/i.test(read(f))), false);
    for (const f of ["package.json", "next.config.mjs", "middleware.ts", "tsconfig.json"]) assert.doesNotMatch(read(f), /revive-provider/i, f);
    for (const f of walk(".github/workflows")) assert.doesNotMatch(read(f), /revive-provider/i, f);
  });

  it("only the fixture, its README and this test live in the revive-provider folder; no SQL or migrations mention it", () => {
    assert.deepEqual(readdirSync(path.join(ROOT, "examples/revive-provider")).sort(), ["README.md", "ad.json"]);
    for (const f of walk("supabase")) assert.doesNotMatch(read(f), /revive-provider/i, f);
  });
});
