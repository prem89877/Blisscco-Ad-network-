import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { PREVIEW_ENV_FLAG, defaultPreviewProvider } from "@/lib/ads/revive-json-preview";

// Day 24 Part 4: preview guide doc check. Sirf file padhta hai: koi network, DB, env, credential ya Revive server nahi.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const GUIDE = "DAY24-JSON-PREVIEW-SETUP.md";
const ROUTE = "/api/revive-json-preview";
const doc = () => read(GUIDE);

describe("day 24 part 4 | guide documents the route, flag and safe default", () => {
  it("the guide file exists", () => {
    assert.ok(existsSync(path.join(ROOT, GUIDE)));
  });

  it("documents the preview route and its files", () => {
    assert.ok(doc().includes(`GET ${ROUTE}`));
    assert.ok(doc().includes("app/api/revive-json-preview/route.ts"));
    assert.ok(existsSync(path.join(ROOT, "app/api/revive-json-preview/route.ts")));
  });

  it("documents the exact flag name used by the code, server-side only", () => {
    assert.equal(PREVIEW_ENV_FLAG, "REVIVE_JSON_PREVIEW_ENABLED");
    assert.ok(doc().includes(PREVIEW_ENV_FLAG));
    assert.doesNotMatch(doc(), /NEXT_PUBLIC_REVIVE/);
    assert.match(doc(), /Never prefix it with `NEXT_PUBLIC_`/);
  });

  it("documents the disabled default and exact-'true' rule", () => {
    assert.match(doc(), /Default is disabled/i);
    assert.match(doc(), /exact value `true`/);
    assert.match(doc(), /`404`/);
    assert.ok(doc().includes('{"error":"not_found"}'));
    assert.ok(doc().includes('{"error":"unavailable"}'));
  });

  it("the documented JSON example matches the real default fixture", () => {
    const m = doc().match(/```json\n([\s\S]*?)\n```/);
    assert.ok(m);
    assert.deepEqual(JSON.parse(m[1]), defaultPreviewProvider());
  });

  it("the flag is documented as separate from the fallback flag", () => {
    assert.match(doc(), /separate flag from `REVIVE_FALLBACK_ENABLED`/);
  });
});

describe("day 24 part 4 | Vercel Preview-only procedure, no secrets or guessed URLs", () => {
  it("says to set the variable for Preview only, not Production or Development", () => {
    assert.match(doc(), /Preview only/);
    assert.match(doc(), /Leave \*\*Production\*\* and \*\*Development\*\* unticked/);
    assert.match(doc(), /Vercel project > Settings > Environment Variables/);
  });

  it("tells the reader to turn it off after testing and to check Production stays 404", () => {
    assert.match(doc(), /Production separately/);
    assert.match(doc(), /delete the variable/i);
  });

  it("the only value shown for the flag is 'true'; no credentials or tokens appear", () => {
    assert.match(doc(), /Value: `true`/);
    assert.doesNotMatch(doc(), /(api[_-]?key|secret|token|password|bearer)\s*[:=]\s*\S{6,}/i);
    assert.doesNotMatch(doc(), /\bsk[-_][A-Za-z0-9]{8,}/);
    assert.match(doc(), /Do not put real credentials/);
  });

  it("contains no real or guessed URL: only example.com or an angle-bracket placeholder", () => {
    const urls = [...doc().matchAll(/https?:\/\/[^\s)`"']+/g)].map((m) => m[0]);
    assert.ok(urls.length > 0);
    for (const u of urls) {
      assert.ok(u.startsWith("https://<") || new URL(u).hostname === "example.com", u);
    }
    assert.doesNotMatch(doc(), /revive\.[a-z]+|\.vercel\.app|openx|adserver/i);
  });

  it("never tells the reader to set REVIVE_DELIVERY_URL or REVIVE_FALLBACK_ENABLED to a value", () => {
    assert.doesNotMatch(doc(), /REVIVE_(DELIVERY_URL|FALLBACK_ENABLED)\s*=/);
  });
});

describe("day 24 part 4 | explicit prototype limitations", () => {
  it("states it is a test fixture, not Revive-generated, not connected to match fallback", () => {
    assert.match(doc(), /fixed test fixture/i);
    assert.match(doc(), /not Revive-generated/i);
    assert.match(doc(), /not connected to Blisscco match fallback/i);
  });

  it("states it must not be enabled in Production", () => {
    assert.match(doc(), /must not be enabled in Production/i);
  });

  it("does not claim live integration", () => {
    assert.doesNotMatch(doc(), /live (revive )?integration (is|has been) (complete|done|enabled)/i);
    assert.doesNotMatch(doc(), /production[- ]ready/i);
    assert.match(doc(), /Prototype/i);
  });

  it("the existing Revive setup guide is untouched: still documentation-only, no preview flag or route", () => {
    const g = read("REVIVE-JSON-ENDPOINT-SETUP.md");
    assert.match(g, /documentation only/i);
    assert.doesNotMatch(g, /REVIVE_JSON_PREVIEW_ENABLED|revive-json-preview/);
  });
});
