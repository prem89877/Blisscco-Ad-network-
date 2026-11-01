import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { PREVIEW_CONTENT_TYPE, PREVIEW_ENV_FLAG, defaultPreviewProvider, handlePreviewGet } from "@/lib/ads/revive-json-preview";

// Day 24 Part 4 (+ Day 25 Part 4): preview guide doc check. Sirf file padhta hai: koi network, DB, env, credential ya Revive server nahi.

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

// ---------------------------------------------------------------------------
// Day 25 Part 4: guide ke naye hisse (manual check script, headers, cleanup) asli route aur script se milte hain.
// ---------------------------------------------------------------------------

const SCRIPT = "scripts/revive-json-preview-check.mjs";
const script = () => read(SCRIPT);
const flatDoc = () => doc().replace(/\s+/g, " ");
const ENABLED = { REVIVE_JSON_PREVIEW_ENABLED: "true" } as const;

describe("day 25 part 4 | guide documents the manual check script", () => {
  it("names the script file, which exists, and says it is manual only and never for Production", () => {
    assert.ok(doc().includes(SCRIPT));
    assert.ok(existsSync(path.join(ROOT, SCRIPT)));
    assert.match(doc(), /\*\*Manual only\.\*\*/);
    assert.match(doc(), /Never run it against Production/);
  });

  it("documents exactly the environment variables the script reads, and no others", () => {
    const used = [...new Set([...script().matchAll(/env\.(BLISSCCO_[A-Z_]+)/g)].map((m) => m[1]))].sort();
    assert.deepEqual(used, ["BLISSCCO_PREVIEW_CHECK_CONFIRM", "BLISSCCO_PREVIEW_CHECK_EXPECT", "BLISSCCO_PREVIEW_URL", "BLISSCCO_PRODUCTION_HOST"]);
    for (const name of used) assert.ok(doc().includes(`\`${name}\``), name);
    const mentioned = [...new Set([...doc().matchAll(/BLISSCCO_[A-Z_]+/g)].map((m) => m[0]))].sort();
    assert.deepEqual(mentioned, used);
  });

  it("the script accepts only a Preview origin, a fixed path, and an explicit 'yes' confirmation", () => {
    assert.match(script(), /CHECK_PATH = "\/api\/revive-json-preview"/);
    assert.match(script(), /BLISSCCO_PREVIEW_CHECK_CONFIRM !== "yes"/);
    assert.match(doc(), /exactly `yes`/);
    assert.match(doc(), /does not accept a path or query string/i);
    assert.match(doc(), /Without it the script refuses to run/);
  });

  it("states what the script never does: redirects, API keys, cookies, printing values", () => {
    const d = flatDoc();
    assert.match(d, /does not follow redirects/);
    assert.match(d, /Location` header is never read or printed/);
    assert.match(d, /does not send a publisher API key/);
    assert.match(d, /does not read or print cookies/);
    assert.match(d, /does not print environment values/);
    assert.match(script(), /redirect:\s*"manual"/);
    assert.match(script(), /credentials:\s*"omit"/);
  });

  it("documents every reason code the script can print, and the script has no undocumented code", () => {
    const src = script();
    const codes = new Set<string>();
    for (const m of src.matchAll(/(?:config|failed)\("([a-z0-9_]+)"\)/g)) codes.add(m[1]);
    for (const m of src.matchAll(/reason:\s*"([a-z0-9_]+)"/g)) codes.add(m[1]);
    for (const m of src.matchAll(/"(unexpected_\d+)"/g)) codes.add(m[1]);
    codes.delete("ok"); // PASS ki line ("PASS ok state=..."), failure code nahi
    assert.ok(codes.size >= 25, `found ${codes.size} codes`);
    for (const c of codes) assert.ok(doc().includes(`\`${c}\``), `undocumented reason code: ${c}`);
  });

  it("exit codes and the PASS output format match the script", () => {
    assert.match(script(), /EXIT_OK = 0/);
    assert.match(script(), /EXIT_FAIL = 1/);
    assert.match(script(), /EXIT_CONFIG = 2/);
    assert.match(doc(), /\| `0` \| PASS \|/);
    assert.match(doc(), /\| `1` \|/);
    assert.match(doc(), /\| `2` \|/);
    assert.ok(doc().includes("`PASS ok state=enabled`"));
    assert.ok(doc().includes("`PASS ok state=disabled`"));
  });

  it("the documented expectation values are the ones the script accepts", () => {
    assert.match(script(), /\["enabled", "disabled", "unavailable"\]/);
    for (const v of ["enabled", "disabled", "unavailable"]) assert.ok(doc().includes(`\`${v}\``), v);
  });

  it("the script is not wired into npm scripts or CI (manual only)", () => {
    assert.equal(read("package.json").includes("revive-json-preview-check"), false);
    for (const wf of ["ci.yml", "integration.yml"]) assert.equal(read(`.github/workflows/${wf}`).includes("revive-json-preview-check"), false);
  });

  it("the documented usage lines contain only placeholders, never a real URL", () => {
    assert.ok(doc().includes("export BLISSCCO_PREVIEW_URL=https://<your-preview-deployment-domain>"));
    assert.ok(doc().includes("export BLISSCCO_PREVIEW_CHECK_CONFIRM=yes"));
    assert.ok(doc().includes("node scripts/revive-json-preview-check.mjs"));
  });
});

describe("day 25 part 4 | documented headers and statuses match the real route", () => {
  it("enabled route sends the documented status and headers", async () => {
    const res = await handlePreviewGet({ env: ENABLED });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), PREVIEW_CONTENT_TYPE);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("set-cookie"), null);
    assert.equal(res.headers.get("location"), null);
    assert.ok(doc().includes("`application/json; charset=utf-8`"));
    assert.ok(doc().includes("`no-store`"));
    assert.ok(doc().includes("`nosniff`"));
  });

  it("disabled and unavailable routes use the same headers and the documented bodies", async () => {
    const off = await handlePreviewGet({ env: {} });
    assert.equal(off.status, 404);
    assert.deepEqual(await off.json(), { error: "not_found" });
    const bad = await handlePreviewGet({ env: ENABLED, provider: () => ({ headline: "x" }) });
    assert.equal(bad.status, 503);
    assert.deepEqual(await bad.json(), { error: "unavailable" });
    for (const r of [off, bad]) {
      assert.equal(r.headers.get("content-type"), PREVIEW_CONTENT_TYPE);
      assert.equal(r.headers.get("cache-control"), "no-store");
      assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    }
  });

  it("says the script checks content type and no-store, and that it does not check nosniff", () => {
    assert.match(doc(), /\| `X-Content-Type-Options` \| `nosniff` \| no /);
    assert.match(doc(), /\| `Cache-Control` \| `no-store` \| yes \|/);
    assert.match(doc(), /\| `Content-Type` \| `application\/json; charset=utf-8` \| yes /);
    assert.equal(/nosniff/i.test(script().split("\n").filter((l) => !l.trim().startsWith("//")).join("\n")), false);
  });

  it("the documented fixture rules match the script constants", () => {
    const flat = flatDoc();
    assert.match(flat, /`headline` is 1 to 90 characters, `body` 1 to 300, `cta_text` 1 to 30 or `null`/);
    assert.match(flat, /at most 2048 characters/);
    assert.match(flat, /at most 65,536 characters/);
    assert.match(script(), /HEADLINE_MAX = 90/);
    assert.match(script(), /BODY_MAX = 300/);
    assert.match(script(), /CTA_MAX = 30/);
    assert.match(script(), /MAX_DESTINATION_LENGTH = 2048/);
    assert.match(script(), /MAX_RESPONSE_CHARS = 65536/);
    assert.match(script(), /FIXTURE_LABEL = "TEST FIXTURE"/);
    assert.match(flat, /`TEST FIXTURE`/);
  });
});

describe("day 25 part 4 | Preview-only setup and cleanup instructions", () => {
  it("keeps the flag Preview only and mentions the redeploy, same-commit branch and --prod warnings", () => {
    assert.match(doc(), /Never use `--prod` for this test/);
    assert.match(doc(), /same commit as `main`/);
    assert.match(doc(), /Redeploy the Preview/);
  });

  it("explains Deployment Protection redirects without suggesting a bypass inside the script", () => {
    const d = flatDoc();
    assert.match(d, /Deployment Protection/);
    assert.match(d, /no way to send cookies or a bypass header, on purpose/);
    assert.match(d, /turn it back on afterwards/);
  });

  it("has a cleanup section: delete flag, redeploy, check disabled, check Production 404, restore protection, unset variables", () => {
    const i = doc().indexOf("## 8. Cleanup after testing");
    assert.ok(i > 0);
    const c = doc().slice(i);
    assert.match(c, /delete `REVIVE_JSON_PREVIEW_ENABLED`/);
    assert.match(c, /Redeploy the Preview deployment/);
    assert.match(c, /BLISSCCO_PREVIEW_CHECK_EXPECT=disabled/);
    assert.match(c, /Production still answers `404`/);
    assert.match(c, /Deployment Protection off for the test, turn it back on|turn it back on/);
    assert.match(c, /unset BLISSCCO_PREVIEW_URL BLISSCCO_PREVIEW_CHECK_CONFIRM BLISSCCO_PREVIEW_CHECK_EXPECT BLISSCCO_PRODUCTION_HOST/);
  });
});

describe("day 25 part 4 | fixture vs real Revive creative, no unconfirmed claims", () => {
  it("has a fixture vs real Revive creative section, and points to the compatibility checklist", () => {
    assert.match(doc(), /## 7\. Static fixture vs a real Revive-generated creative/);
    assert.match(doc(), /Do not describe the fixture as Revive output/);
    assert.ok(doc().includes("DAY25-REVIVE-ENDPOINT-COMPATIBILITY.md"));
    assert.ok(existsSync(path.join(ROOT, "DAY25-REVIVE-ENDPOINT-COMPATIBILITY.md")));
  });

  it("says Revive supplying the JSON shape is not confirmed, and never claims it does", () => {
    assert.match(doc(), /is \*\*not confirmed\*\*/);
    const claims = doc().split("\n").filter((l) => /Revive (natively )?(supplies|provides|returns|generates) (this|the|a) JSON/i.test(l) && !/not confirmed|Do not/i.test(l));
    assert.deepEqual(claims, []);
  });

  it("says a passing check proves nothing about Revive or another provider", () => {
    assert.match(flatDoc(), /does not show that Revive, or any other provider, can supply a compatible endpoint/);
  });

  it("states the check script cannot be pointed at an external endpoint", () => {
    assert.match(doc(), /cannot be pointed at an external endpoint/);
  });

  it("adds no production enablement, SQL or migration instruction", () => {
    assert.doesNotMatch(doc(), /\b(CREATE|ALTER|INSERT|DROP)\s+(TABLE|INDEX|FUNCTION|POLICY)\b/i);
    assert.doesNotMatch(doc(), /migration|supabase db/i);
    assert.match(doc(), /must not be enabled in Production/i);
  });
});
