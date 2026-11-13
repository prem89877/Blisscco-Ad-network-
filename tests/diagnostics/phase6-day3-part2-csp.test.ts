import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

// Phase 6 Day 3 Part 2, F1: CSP Report-Only sirf Preview par. Plain .mjs ko alag Node process me chalata hai (network nahi).
const ROOT = path.join(__dirname, "..", "..", "..");

function run(env: Record<string, string>): { key: string; value: string }[] {
  const code = `import { cspHeaders } from ${JSON.stringify(path.join(ROOT, "config", "csp.mjs"))};
    console.log(JSON.stringify(cspHeaders(JSON.parse(process.argv[1]))));`;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", code, JSON.stringify(env)], { encoding: "utf8" }).trim());
}

describe("F1 CSP | Report-Only on Preview only", () => {
  it("Production, development and unset env => no CSP header (Production unchanged)", () => {
    assert.deepEqual(run({ VERCEL_ENV: "production" }), []);
    assert.deepEqual(run({ VERCEL_ENV: "development" }), []);
    assert.deepEqual(run({}), []);
  });
  it("Preview => exactly one Report-Only header (never the enforcing header)", () => {
    const h = run({ VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.co" });
    assert.equal(h.length, 1);
    assert.equal(h[0].key, "Content-Security-Policy-Report-Only");
  });
  it("policy has the required directives and the Supabase origin only in img-src", () => {
    const v = run({ VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.co/rest/v1" })[0].value;
    for (const d of ["default-src 'self'", "frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'", "connect-src 'self'"]) assert.ok(v.includes(d), d);
    assert.match(v, /img-src 'self' data: blob: https:\/\/abcd\.supabase\.co(;|$)/);
    assert.equal(v.split("https://abcd.supabase.co").length, 2);
    assert.ok(!v.includes("form-action"));
  });
  it("bad or non-https Supabase URL is ignored (no crash, no extra origin)", () => {
    for (const u of ["", "not a url", "http://insecure.example"]) {
      const v = run({ VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: u })[0].value;
      assert.match(v, /img-src 'self' data: blob:(;|$)/);
    }
  });
  it("next.config.mjs wires cspHeaders and keeps the 4 existing headers", () => {
    const cfg = readFileSync(path.join(ROOT, "next.config.mjs"), "utf8");
    assert.ok(cfg.includes("cspHeaders(process.env)"));
    for (const h of ["X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy"]) assert.ok(cfg.includes(h), h);
    assert.ok(!cfg.includes('"Content-Security-Policy"'));
  });
});
