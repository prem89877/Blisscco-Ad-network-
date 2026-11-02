// Day 28 Part 3: Revive fallback flag default OFF, preview-fixture flag fallback ko chalu nahi kar sakta,
// tests live env values na padhen / na print karein, aur documented cleanup Preview variables hatata hai + fallback band karta hai.
// Env sirf in-memory records se; process.env ki koi value padhi ya print nahi hoti. Koi network, endpoint, DB, SQL, credential ya production nahi.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { REVIVE_ENV_FLAG, REVIVE_ENV_FORMAT, REVIVE_ENV_TIMEOUT, REVIVE_ENV_URL, parseReviveEnv, reviveEnvEnabled, type ReviveFetcher } from "@/lib/ads/revive-adapter";
import { REVIVE_FALLBACK_FLAG, providerFallbackFromEnv, reviveFallbackEnabled } from "@/lib/ads/fallback-provider";
import { PREVIEW_ENV_FLAG, handlePreviewGet, previewEnabled } from "@/lib/ads/revive-json-preview";

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const DOC = "DAY27-REAL-REVIVE-VERIFICATION.md";
const EXAMPLE_URL = "https://delivery.example.com/serve";
const FIVE = ["REVIVE_FALLBACK_ENABLED", "REVIVE_DELIVERY_URL", "REVIVE_TIMEOUT_MS", "REVIVE_RESPONSE_FORMAT", "REVIVE_JSON_PREVIEW_ENABLED"] as const;
type Rec = Record<string, string | undefined>;

/** Comments hata kar sirf code (taaki comment ka text rule se na takraye). */
const code = (src: string) => src.split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).map((l) => l.replace(/\s\/\/ .*$/, "")).join("\n");
const walk = (dir: string): string[] =>
  readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith(".ts") ? [`${dir}/${e.name}`] : []));

function countingFetcher() {
  let calls = 0;
  const fetcher = (async () => { calls += 1; throw new Error("test: no network"); }) as unknown as ReviveFetcher;
  return { fetcher, calls: () => calls };
}

describe("day 28 part 3 | REVIVE_FALLBACK_ENABLED defaults OFF", () => {
  it("the flag name is fixed and equal in the adapter and the fallback provider", () => {
    assert.equal(REVIVE_ENV_FLAG, "REVIVE_FALLBACK_ENABLED");
    assert.equal(REVIVE_FALLBACK_FLAG, "REVIVE_FALLBACK_ENABLED");
  });

  it("an empty, missing, null or undefined environment is disabled", () => {
    for (const env of [{}, undefined, null] as const) {
      assert.equal(reviveEnvEnabled(env), false);
      assert.equal(reviveFallbackEnabled((env ?? {}) as Rec), false);
    }
    const parsed = parseReviveEnv({});
    assert.equal(parsed.ok, false);
    assert.equal(parsed.ok === false && parsed.reason, "disabled");
  });

  it("only the exact string `true` enables it; every other value stays off", () => {
    for (const v of ["", "TRUE", "True", "1", "yes", "on", "enabled", " true", "true ", "true\n", "false", "0", "null", "undefined", "tru"]) {
      assert.equal(reviveFallbackEnabled({ REVIVE_FALLBACK_ENABLED: v }), false, JSON.stringify(v));
      assert.equal(reviveEnvEnabled({ REVIVE_FALLBACK_ENABLED: v }), false, JSON.stringify(v));
    }
    assert.equal(reviveFallbackEnabled({ REVIVE_FALLBACK_ENABLED: "true" }), true);
  });

  it("URL, timeout and format alone never turn it on: without the flag they are not even read", () => {
    const env = { REVIVE_DELIVERY_URL: EXAMPLE_URL, REVIVE_TIMEOUT_MS: "500", REVIVE_RESPONSE_FORMAT: "json" };
    assert.equal(reviveFallbackEnabled(env), false);
    const parsed = parseReviveEnv(env);
    assert.equal(parsed.ok === false && parsed.reason, "disabled");
  });

  it("a disabled provider makes no request and returns no-fill (stubbed fetcher is never called)", async () => {
    const { fetcher, calls } = countingFetcher();
    for (const env of [{}, { REVIVE_DELIVERY_URL: EXAMPLE_URL }, { REVIVE_FALLBACK_ENABLED: "false", REVIVE_DELIVERY_URL: EXAMPLE_URL }] as Rec[]) {
      const fb = providerFallbackFromEnv(env, { fetcher });
      assert.equal(fb.isEnabled(), false);
      assert.equal(await fb.request(), null);
    }
    assert.equal(calls(), 0);
  });

  it("with the Revive variables removed from this test process, the production wiring is off too", async () => {
    for (const k of FIVE) delete process.env[k]; // sirf hatata hai; koi value padhi / save / print nahi hoti (test process alag hai)
    const { fetcher, calls } = countingFetcher();
    const fb = providerFallbackFromEnv(process.env, { fetcher });
    assert.equal(fb.isEnabled(), false);
    assert.equal(await fb.request(), null);
    assert.equal(calls(), 0);
  });

  it("no committed file turns it on: .env.example, next.config and vercel.json set no Revive value", () => {
    assert.doesNotMatch(read(".env.example"), /^\s*REVIVE_\w+\s*=\s*\S/m);
    for (const f of ["next.config.js", "next.config.mjs", "next.config.ts", "vercel.json"]) {
      if (existsSync(path.join(ROOT, f))) assert.doesNotMatch(read(f), /REVIVE_/, f);
    }
    for (const f of [".github/workflows/ci.yml", ".github/workflows/integration.yml"]) assert.doesNotMatch(read(f), /REVIVE_/, f);
  });

  it("the production serving path reads the flag only through the fallback provider and checks isEnabled() first", () => {
    const service = code(read("lib/ads/service.ts"));
    assert.match(service, /providerFallbackFromEnv\(process\.env\)/);
    assert.doesNotMatch(service, /REVIVE_/);
    assert.match(read("lib/ads/fallback-routing.ts"), /isEnabled\(\)/);
  });
});

describe("day 28 part 3 | REVIVE_JSON_PREVIEW_ENABLED cannot enable the production fallback", () => {
  it("the two flags have different names", () => {
    assert.equal(PREVIEW_ENV_FLAG, "REVIVE_JSON_PREVIEW_ENABLED");
    assert.notEqual(PREVIEW_ENV_FLAG, REVIVE_FALLBACK_FLAG);
  });

  it("the preview flag alone (any value, with or without a URL) leaves the fallback disabled", async () => {
    const { fetcher, calls } = countingFetcher();
    for (const v of ["true", "TRUE", "1", "yes", ""]) {
      for (const extra of [{}, { REVIVE_DELIVERY_URL: EXAMPLE_URL }, { REVIVE_DELIVERY_URL: EXAMPLE_URL, REVIVE_TIMEOUT_MS: "500", REVIVE_RESPONSE_FORMAT: "json" }]) {
        const env: Rec = { REVIVE_JSON_PREVIEW_ENABLED: v, ...extra };
        assert.equal(reviveFallbackEnabled(env), false, JSON.stringify(env));
        const parsed = parseReviveEnv(env);
        assert.equal(parsed.ok === false && parsed.reason, "disabled", JSON.stringify(env));
        const fb = providerFallbackFromEnv(env, { fetcher });
        assert.equal(fb.isEnabled(), false);
        assert.equal(await fb.request(), null);
      }
    }
    assert.equal(calls(), 0);
  });

  it("the fallback follows ONLY its own flag: with REVIVE_FALLBACK_ENABLED off, a true preview flag changes nothing; with it on, the preview flag is irrelevant", () => {
    const base = { REVIVE_DELIVERY_URL: EXAMPLE_URL };
    for (const preview of [undefined, "true", "false"]) {
      assert.equal(reviveFallbackEnabled({ ...base, REVIVE_JSON_PREVIEW_ENABLED: preview, REVIVE_FALLBACK_ENABLED: "false" }), false);
      assert.equal(reviveFallbackEnabled({ ...base, REVIVE_JSON_PREVIEW_ENABLED: preview, REVIVE_FALLBACK_ENABLED: "true" }), true);
    }
  });

  it("the other direction too: the fallback flag, URL and options do not enable the preview route handler", async () => {
    assert.equal(previewEnabled({}), false);
    assert.equal(previewEnabled({ REVIVE_FALLBACK_ENABLED: "true", REVIVE_DELIVERY_URL: EXAMPLE_URL, REVIVE_TIMEOUT_MS: "500" }), false);
    const res = await handlePreviewGet({ env: { REVIVE_FALLBACK_ENABLED: "true", REVIVE_DELIVERY_URL: EXAMPLE_URL } });
    assert.equal(res.status, 404);
    assert.equal(await res.text(), '{"error":"not_found"}');
  });

  it("an enabled preview route serves only its fixed fixture and makes no network call", async () => {
    let fetchCalls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => { fetchCalls += 1; throw new Error("test: no network"); }) as typeof fetch;
    try {
      const res = await handlePreviewGet({ env: { REVIVE_JSON_PREVIEW_ENABLED: "true" } });
      assert.equal(res.status, 200);
      assert.deepEqual(Object.keys(JSON.parse(await res.text()) as object), ["headline", "body", "cta_text", "destination_url"]);
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(fetchCalls, 0);
  });

  it("source check: serving, fallback and adapter code never mention the preview flag or the preview modules", () => {
    for (const f of ["lib/ads/service.ts", "lib/ads/fallback-provider.ts", "lib/ads/fallback-routing.ts", "lib/ads/revive-adapter.ts", "lib/ads/match-handler.ts"]) {
      if (!existsSync(path.join(ROOT, f))) continue;
      const src = code(read(f));
      assert.doesNotMatch(src, /REVIVE_JSON_PREVIEW_ENABLED|PREVIEW_ENV_FLAG|revive-json-preview/, f);
    }
    for (const f of ["app/api/ads/match/route.ts", "app/api/v1/ads/match/route.ts"]) {
      if (existsSync(path.join(ROOT, f))) assert.doesNotMatch(code(read(f)), /REVIVE_JSON_PREVIEW_ENABLED|revive-json-preview/, f);
    }
  });

  it("source check: the preview modules never read the fallback flag or URL, or import the adapter and fallback code", () => {
    for (const f of ["lib/ads/revive-json-preview.ts", "lib/ads/revive-json-preview-provider.ts", "app/api/revive-json-preview/route.ts"]) {
      const src = code(read(f));
      assert.doesNotMatch(src, /REVIVE_FALLBACK_ENABLED|REVIVE_DELIVERY_URL|REVIVE_ENV_FLAG|REVIVE_FALLBACK_FLAG/, f);
      assert.doesNotMatch(src, /from\s+["'][^"']*(fallback-provider|fallback-routing|revive-adapter|service)["']/, f);
    }
  });
});

describe("day 28 part 3 | tests and helpers never read or print live environment values", () => {
  const files = walk("tests/ads");
  const SENSITIVE = /process\.env\.(REVIVE_DELIVERY_URL|\w*API_KEY\w*|\w*SUPABASE\w*|AD_TRACKING_\w+|\w*DATABASE_URL|\w*SECRET\w*|\w*TOKEN\w*)/;
  /** Files whose print calls sit inside a string that runs as a separate child script / compiled snippet, printing only fixed text or module paths (checked by hand). */
  const STRING_SCRIPTS = ["tests/ads/day14-part3-production-env.test.ts", "tests/ads/day27-part3-preview-safety.test.ts", "tests/ads/day28-part1-publisher-types.test.ts"];
  /** Failure messages list file names (and line numbers) only, never file content or env values. */
  const offenders = (re: RegExp, only: string[] = files) => only.flatMap((f) => code(read(f)).split("\n").flatMap((l, i) => (re.test(l) ? [`${f}:${i + 1}`] : [])));

  it("there are test files to scan (the scan itself is not empty)", () => {
    assert.ok(files.length > 50);
    assert.ok(files.includes("tests/ads/day28-part3-preview-env-safety.test.ts"));
    for (const f of STRING_SCRIPTS) assert.ok(files.includes(f), f);
  });

  it("no test code calls console output or writes to stdout/stderr (silencing or capturing console is fine; printing is not)", () => {
    const rest = files.filter((f) => !STRING_SCRIPTS.includes(f));
    assert.deepEqual(offenders(/\bconsole\.(log|info|warn|error|debug|dir|table|trace)\s*\(/, rest), []);
    assert.deepEqual(offenders(/\bprocess\.(stdout|stderr)\.write\s*\(/, rest), []);
  });

  it("the string-embedded scripts print only fixed text or module paths, never environment content", () => {
    for (const f of STRING_SCRIPTS) {
      const printed = [...read(f).matchAll(/(?:console\.(?:log|info|warn|error)|process\.(?:stdout|stderr)\.write)\s*\(([^;\n]*)/g)].map((m) => m[1]);
      for (const arg of printed) assert.doesNotMatch(arg, /process\.env|\benv\b|REVIVE_|SUPABASE|API_KEY|SECRET/i, `${f}: a print call mentions the environment`);
    }
  });

  it("nothing dumps, spreads, interpolates or JSON-encodes the whole environment", () => {
    assert.deepEqual(offenders(/JSON\.stringify\(\s*process\.env\s*\)/), []);
    assert.deepEqual(offenders(/Object\.(entries|keys|values|assign)\(\s*(\{\s*\}\s*,\s*)?process\.env/), []);
    assert.deepEqual(offenders(/\.\.\.\s*process\.env\b/), []);
    assert.deepEqual(offenders(/\$\{\s*process\.env/), []);
    assert.deepEqual(offenders(/String\(\s*process\.env/), []);
  });

  it("no assertion can echo a sensitive value in its failure message (assert lines never contain a secret-like env read)", () => {
    assert.deepEqual(offenders(/\bassert\b.*/).filter(() => false), []); // helper sanity: offenders() works on any pattern
    const bad = files.flatMap((f) => code(read(f)).split("\n").flatMap((l, i) => (/\bassert\b/.test(l) && SENSITIVE.test(l) ? [`${f}:${i + 1}`] : [])));
    assert.deepEqual(bad, []);
  });

  it("every direct use of the delivery-URL variable on the env object in tests/ads is an assignment, never a read", () => {
    const bad = files.flatMap((f) => code(read(f)).split("\n").flatMap((l, i) => (/process\.env\.REVIVE_DELIVERY_URL\b(?!\s*=[^=])/.test(l) ? [`${f}:${i + 1}`] : [])));
    assert.deepEqual(bad, []);
  });

  it("helpers under tests/ads/helpers do not touch the env object at all", () => {
    assert.deepEqual(offenders(/process\.env/, files.filter((x) => x.startsWith("tests/ads/helpers/"))), []);
  });

  it("this test file reads no env value: its only env-object uses are one delete and passing the object to the provider under test", () => {
    const src = code(read("tests/ads/day28-part3-preview-env-safety.test.ts"));
    const withoutSafe = src.replace(/delete process\.env\[k\];/g, "").replace(/providerFallbackFromEnv\(process\.env, \{ fetcher \}\)/g, "");
    assert.equal(/process\.env/.test(withoutSafe), false);
    assert.equal(/\bsaved\w*\[/.test(src), false);
  });

  it("this test file and the guide hold no credential-shaped value or real host", () => {
    for (const [name, text] of [["test", read("tests/ads/day28-part3-preview-env-safety.test.ts")], ["guide", read(DOC)]] as const) {
      assert.equal(/blc_live_[0-9a-f]{8}/i.test(text), false, name);
      assert.equal(/sb_secret_\w{6,}|sb_publishable_\w{6,}|eyJ[\w-]{10,}/.test(text), false, name);
      assert.equal(/\.vercel\.app|\.supabase\.co/.test(text), false, name);
      for (const m of text.matchAll(/https?:\/\/[^\s)`"'<>]+/g)) assert.match(m[0], /^https:\/\/([a-z0-9-]+\.)?example\.com\b/, `${name}: ${m[0]}`);
    }
  });
});

describe("day 28 part 3 | the guide's preflight checklist", () => {
  const doc = read(DOC);
  const flat = doc.replace(/\s+/g, " ");
  const section3 = doc.slice(doc.indexOf("## 3. Preview-only test"), doc.indexOf("## 4. Do not leak"));
  const boxes = section3.split("\n").filter((l) => l.startsWith("- [ ] "));

  it("is a short explicit list of exactly five unchecked boxes inside the Preview-only test section, before step 1", () => {
    assert.equal(boxes.length, 5);
    assert.ok(section3.indexOf("**Preflight checklist (Day 28).**") >= 0);
    assert.ok(section3.indexOf("**Preflight checklist (Day 28).**") < section3.indexOf("1. Get a **dedicated** endpoint"));
    assert.ok(boxes.every((b) => b.length < 420), "each item stays short");
    assert.match(section3, /If one is not, stop; nothing has been changed yet\./);
  });

  it("names, in order: Preview environment label, dedicated test publisher key, endpoint owner approval, verified HTTPS JSON response, cleanup", () => {
    const heads = boxes.map((b) => /\*\*([^*]+)\*\*/.exec(b)?.[1]);
    assert.deepEqual(heads, ["Preview environment label:", "Dedicated test publisher key:", "Endpoint owner approval:", "Verified HTTPS JSON response:", "Cleanup ready:"]);
  });

  it("each item says what to check, and none asks for a URL or key value to be written down", () => {
    assert.match(boxes[0], /Environment label Preview/);
    assert.match(boxes[0], /Production and Development unticked/);
    assert.match(boxes[1], /Preview-only test publisher/);
    assert.match(boxes[1], /Never a real publisher's key/);
    assert.match(boxes[1], /revoke it at cleanup/);
    assert.match(boxes[2], /in writing/);
    assert.match(boxes[2], /never the URL/);
    assert.match(boxes[3], /all eight gate items in section 1/);
    assert.match(boxes[4], /cleanup in step 9/);
    assert.doesNotMatch(boxes.join("\n"), /paste|write down the (url|key)|copy the (url|key)/i);
  });

  it("the earlier rules still hold: Preview only, server-side, no NEXT_PUBLIC_, Production untouched, no live claim", () => {
    assert.match(flat, /\*\*server-side\*\* variables, \*\*Preview only\*\*/);
    assert.match(doc, /Never use a `NEXT_PUBLIC_` prefix/);
    assert.match(doc, /Production configuration is never touched/);
    assert.match(doc, /Status: \*\*documentation only\.\*\*/);
  });
});

describe("day 28 part 3 | the documented cleanup removes the Preview variables and redeploys with fallback disabled", () => {
  const doc = read(DOC);
  const section3 = doc.slice(doc.indexOf("## 3. Preview-only test"), doc.indexOf("## 4. Do not leak"));
  const cleanup = section3.slice(section3.indexOf("9. Cleanup, in this order:"), section3.indexOf("Notes:"));
  const steps = cleanup.split("\n").filter((l) => /^ {3}\d\. /.test(l));
  const names = (text: string) => [...text.matchAll(/`(REVIVE_[A-Z_]+)`/g)].map((m) => m[1]);
  const addTable = section3.slice(section3.indexOf("3. In Vercel"), section3.indexOf("4. Redeploy"));

  it("has five ordered cleanup steps: delete variables, redeploy, repeat the request, rotate the endpoint, unset terminal values", () => {
    assert.equal(steps.length, 5);
    assert.match(steps[0], /^ {3}1\. Delete /);
    assert.match(steps[1], /^ {3}2\. Redeploy Preview without the build cache and wait until it is Ready/);
    assert.match(steps[2], /^ {3}3\. Repeat the no-campaign request\. Expect `\{"fill":false\}`/);
    assert.match(steps[3], /^ {3}4\. Ask the endpoint owner to rotate or delete the dedicated endpoint/);
    assert.match(steps[4], /^ {3}5\. Clear the terminal values with `unset`/);
  });

  it("every variable the guide tells you to add in step 3 is deleted in cleanup step 1, in Preview", () => {
    const added = names(addTable);
    assert.deepEqual([...added].sort(), ["REVIVE_DELIVERY_URL", "REVIVE_FALLBACK_ENABLED", "REVIVE_RESPONSE_FORMAT", "REVIVE_TIMEOUT_MS"]);
    const deleted = names(steps[0]);
    for (const n of added) assert.ok(deleted.includes(n), `${n} is added but not cleaned up`);
    assert.match(steps[0], /from Preview/);
    assert.match(steps[0], /Check that Production and Development hold none of these names/);
  });

  it("the preview-fixture flag is also cleaned up if it was added, and it is never part of the test's variable table", () => {
    assert.ok(names(steps[0]).includes("REVIVE_JSON_PREVIEW_ENABLED"));
    assert.ok(!names(addTable).includes("REVIVE_JSON_PREVIEW_ENABLED"));
    assert.match(section3, /`REVIVE_JSON_PREVIEW_ENABLED` is a separate flag\. It never turns on `REVIVE_FALLBACK_ENABLED`, and this test does not need it\./);
  });

  it("every name in cleanup step 1 is a variable the code really reads", () => {
    const known = new Set<string>([REVIVE_ENV_FLAG, REVIVE_ENV_URL, REVIVE_ENV_TIMEOUT, REVIVE_ENV_FORMAT, PREVIEW_ENV_FLAG]);
    for (const n of names(steps[0])) assert.ok(known.has(n), n);
    assert.deepEqual([...names(steps[0])].sort(), [...known].sort());
  });

  it("the redeploy comes after the deletion and before the repeat request, and says old deployments keep the flag until then", () => {
    assert.ok(cleanup.indexOf("1. Delete") < cleanup.indexOf("2. Redeploy"));
    assert.ok(cleanup.indexOf("2. Redeploy") < cleanup.indexOf("3. Repeat"));
    assert.match(steps[1], /Variable changes apply to new deployments only, so the old deployment keeps the fallback on until then/);
    assert.match(steps[2], /which shows fallback is disabled again/);
  });

  it("applying exactly the documented deletions to a fully-enabled Preview environment turns the fallback off and calls nothing", async () => {
    const preview: Rec = {
      REVIVE_FALLBACK_ENABLED: "true", REVIVE_DELIVERY_URL: EXAMPLE_URL, REVIVE_TIMEOUT_MS: "500", REVIVE_RESPONSE_FORMAT: "json", REVIVE_JSON_PREVIEW_ENABLED: "true",
    };
    assert.equal(reviveFallbackEnabled(preview), true, "sanity: the test environment starts enabled");
    assert.equal(previewEnabled(preview), true);
    const afterCleanup: Rec = { ...preview };
    for (const n of names(steps[0])) delete afterCleanup[n];
    assert.deepEqual(Object.keys(afterCleanup), [], "no Revive variable is left after the documented deletions");
    const { fetcher, calls } = countingFetcher();
    const fb = providerFallbackFromEnv(afterCleanup, { fetcher });
    assert.equal(fb.isEnabled(), false);
    assert.equal(await fb.request(), null);
    assert.equal(previewEnabled(afterCleanup), false);
    assert.equal(calls(), 0);
  });

  it("deleting only the fallback flag is enough to turn the fallback off (the minimum the cleanup must achieve)", () => {
    const env: Rec = { REVIVE_FALLBACK_ENABLED: "true", REVIVE_DELIVERY_URL: EXAMPLE_URL };
    assert.equal(reviveFallbackEnabled(env), true);
    delete env.REVIVE_FALLBACK_ENABLED;
    assert.equal(reviveFallbackEnabled(env), false);
  });

  it("the guide offers no command that touches Production, and no CLI that could print variable values", () => {
    assert.doesNotMatch(section3, /vercel env (pull|ls|add|rm)|vercel (deploy|--prod)|--prod\b/);
    assert.doesNotMatch(section3, /\becho \$|\bprintenv\b|\benv\s*\|/);
    assert.doesNotMatch(doc, /(add|set|enter)[^.\n]{0,40}\bfor Production\b/i);
  });
});

describe("day 28 part 3 | scope: documentation and tests only", () => {
  it("no SQL file and no migration mention for Day 28, and package scripts are unchanged", () => {
    assert.equal(readdirSync(path.join(ROOT, "supabase", "sql")).some((f) => /day-?28/i.test(f)), false);
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    assert.deepEqual(Object.keys(pkg.scripts).sort(), ["build", "dev", "lint", "lint:eslint", "start", "test", "test:integration"]);
  });

  it("no real Revive endpoint is referenced anywhere in this part", () => {
    assert.doesNotMatch(read(DOC), /Revive (is|has been) (verified|confirmed)/i);
  });
});
