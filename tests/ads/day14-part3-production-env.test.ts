import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isValidSupabaseUrl, jwtRole, serverKeyProblem } from "@/lib/supabase/env";
import { readTrackingConfig, trackingSecretStatus } from "@/lib/ads/tracking-token";

// Day 14 / Part 3: production env + security safeguards. Asli database / network kabhi nahi chhuta.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (role: string) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ role })}.sig`;

/** next.config ka build-time guard (plain .mjs) ko alag Node process me chalata hai. */
function guard(env: Record<string, string>): { ok: boolean; message: string } {
  const code = `import { assertPublicEnvIsSafe } from ${JSON.stringify(path.join(ROOT, "config", "public-env-guard.mjs"))};
    try { assertPublicEnvIsSafe(JSON.parse(process.argv[1])); console.log("OK"); } catch (e) { console.log("FAIL:" + e.message); }`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", code, JSON.stringify(env)], { encoding: "utf8" }).trim();
  return { ok: out === "OK", message: out };
}

describe("day 14 part 3 | server key / url checks", () => {
  it("serverKeyProblem flags publishable, anon and placeholder keys, accepts secret / service_role keys", () => {
    assert.equal(serverKeyProblem("sb_publishable_abc123"), "publishable_key");
    assert.equal(serverKeyProblem(jwt("anon")), "anon_key");
    assert.equal(serverKeyProblem("sb_secret_YOUR_KEY"), "placeholder");
    assert.equal(serverKeyProblem("sb_secret_a1b2c3d4e5f6"), null);
    assert.equal(serverKeyProblem(jwt("service_role")), null);
  });

  it("jwtRole / isValidSupabaseUrl behave and never throw on junk", () => {
    assert.equal(jwtRole("not-a-jwt"), null);
    assert.equal(jwtRole("a.b.c"), null);
    assert.equal(jwtRole(jwt("anon")), "anon");
    assert.equal(isValidSupabaseUrl("https://abcd.supabase.co"), true);
    assert.equal(isValidSupabaseUrl("http://localhost:54321"), true);
    assert.equal(isValidSupabaseUrl("http://evil.example.com"), false);
    assert.equal(isValidSupabaseUrl(""), false);
  });

  it("admin client: missing -> logs NAMES only; invalid -> clear error with no key value; first log line unchanged", () => {
    const src = read("lib/supabase/admin.ts");
    assert.match(src, /^import "server-only";/m);
    assert.match(src, /serverKeyProblem\(secretKey\)/);
    assert.match(src, /\[config\] invalid server env:/);
    const logLines = src.split("\n").filter((l) => /console\.error\(/.test(l));
    assert.match(logLines[0], /\[config\] missing server env:/);
    for (const l of logLines) {
      assert.ok(!/process\.env/.test(l), l);
      assert.ok(!/secretKey\s*[,)]/.test(l), l);
    }
    // validation cache se pehle nahi, naye client banne se pehle hai
    assert.ok(src.indexOf("serverKeyProblem(secretKey)") < src.indexOf("createClient(url, secretKey"));
  });
});

describe("day 14 part 3 | optional tracking secret disables tracking safely", () => {
  it("missing / short / placeholder / credential-like secret => null (tracking off), good secret => config", () => {
    assert.equal(readTrackingConfig({}), null);
    assert.equal(readTrackingConfig({ AD_TRACKING_SECRET: "short" }), null);
    assert.equal(readTrackingConfig({ AD_TRACKING_SECRET: "YOUR-RANDOM-SECRET-AT-LEAST-32-CHARS-LONG" }), null);
    assert.equal(readTrackingConfig({ AD_TRACKING_SECRET: `sb_secret_${"a".repeat(40)}` }), null);
    assert.equal(readTrackingConfig({ AD_TRACKING_SECRET: `blc_live_${"a".repeat(64)}` }), null);
    assert.ok(readTrackingConfig({ AD_TRACKING_SECRET: "a".repeat(64) }));
  });

  it("trackingSecretStatus tells not-set from rejected without ever returning the value", () => {
    assert.equal(trackingSecretStatus({}), "not_set");
    assert.equal(trackingSecretStatus({ AD_TRACKING_SECRET: "" }), "not_set");
    assert.equal(trackingSecretStatus({ AD_TRACKING_SECRET: "short" }), "rejected");
    assert.equal(trackingSecretStatus({ AD_TRACKING_SECRET: "YOUR-RANDOM-SECRET-AT-LEAST-32-CHARS-LONG" }), "rejected");
    assert.equal(trackingSecretStatus({ AD_TRACKING_SECRET: "a".repeat(64) }), "ok");
  });

  it("tracking-off logs are static labels only (no secret value) and the secret is still read only via service.ts / the pure token module", () => {
    const src = read("lib/ads/service.ts");
    assert.match(src, /console\.error\("\[ads\/serve\] tracking token off"\)/);
    assert.match(src, /console\.error\("\[ads\/serve\] tracking secret rejected"\)/);
    assert.equal(/process\.env\.AD_TRACKING/.test(src), false);
  });
});

describe("day 14 part 3 | build-time public env guard", () => {
  it("passes the four allowed public variables and normal Vercel system variables", () => {
    const r = guard({
      NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc",
      NEXT_PUBLIC_SITE_URL: "https://example.com",
      NEXT_PUBLIC_CONTACT_EMAIL: "you@example.com",
      NEXT_PUBLIC_VERCEL_ENV: "production",
      NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: "abc123",
      SUPABASE_SECRET_KEY: "sb_secret_server_only_is_fine_without_public_prefix",
    });
    assert.equal(r.ok, true, r.message);
  });

  it("fails on secret-looking public names and on secret values, naming the variable but never the value", () => {
    for (const name of ["NEXT_PUBLIC_SUPABASE_SECRET_KEY", "NEXT_PUBLIC_AD_TRACKING_SECRET", "NEXT_PUBLIC_SERVICE_ROLE_KEY", "NEXT_PUBLIC_ADMIN_PASSWORD"]) {
      const r = guard({ [name]: "whatever-value-123" });
      assert.equal(r.ok, false, name);
      assert.ok(r.message.includes(name), name);
    }
    const value = `sb_secret_${"z".repeat(30)}`;
    const r = guard({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: value });
    assert.equal(r.ok, false);
    assert.ok(r.message.includes("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"));
    assert.ok(!r.message.includes(value), "value must never appear in the error");
    assert.equal(guard({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt("service_role") }).ok, false);
    assert.equal(guard({ NEXT_PUBLIC_X: `blc_live_${"a".repeat(64)}` }).ok, false);
  });

  it("next.config.mjs runs the guard and still has no env block", () => {
    const cfg = read("next.config.mjs").replace(/\/\/.*$/gm, "");
    assert.match(cfg, /assertPublicEnvIsSafe\(process\.env\)/);
    assert.doesNotMatch(cfg, /\benv\s*:/);
  });
});

describe("day 14 part 3 | .env.example, .gitignore, docs", () => {
  it(".env.example documents every required + optional variable, secrets without NEXT_PUBLIC_", () => {
    const env = read(".env.example");
    for (const n of [
      "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "AD_TRACKING_SECRET",
      "AD_TRACKING_SECRET_PREVIOUS", "AD_TRACKING_TTL_SECONDS", "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_CONTACT_EMAIL",
    ]) assert.ok(env.includes(n), n);
    assert.ok(env.indexOf("REQUIRED") < env.indexOf("SUPABASE_SECRET_KEY=") && env.indexOf("SUPABASE_SECRET_KEY=") < env.indexOf("OPTIONAL"));
    assert.ok(env.indexOf("OPTIONAL") < env.indexOf("AD_TRACKING_SECRET="));
    assert.ok(!/NEXT_PUBLIC_[A-Z_]*(SECRET|SERVICE|TRACKING)/.test(env));
  });

  it(".gitignore also blocks keys, logs and supabase CLI state", () => {
    const lines = read(".gitignore").split("\n").map((l) => l.trim());
    for (const l of [".env", ".env.*", "!.env.example", ".vercel", "*.pem", "*.log", ".supabase", "supabase/.temp"]) assert.ok(lines.includes(l), l);
  });

  it("production env doc lists every variable the owner must set", () => {
    const doc = read("DAY14-PART3-PRODUCTION-ENV.md");
    for (const n of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "AD_TRACKING_SECRET", "AD_TRACKING_SECRET_PREVIOUS", "AD_TRACKING_TTL_SECONDS"]) {
      assert.ok(doc.includes(n), n);
    }
    assert.ok(!/sb_secret_[A-Za-z0-9]{12,}|eyJ[A-Za-z0-9_-]{20,}|blc_live_[0-9a-f]{64}/.test(doc));
  });
});

describe("day 14 part 3 | middleware config log", () => {
  it("logs variable NAMES once, never values, and still fails closed + uses getUser()", () => {
    const src = read("lib/supabase/middleware.ts");
    assert.match(src, /warnConfigUnusableOnce\(\)/);
    assert.match(src, /let warnedConfig = false/);
    const logBlock = src.slice(src.indexOf("console.error("), src.indexOf("console.error(") + 400);
    assert.ok(!/process\.env\.[A-Z_]+\s*[,)]/.test(logBlock.replace(/process\.env\.[A-Z_]+ \?/g, "")), "no env value in log");
    assert.match(src, /getUser\(\)/);
    assert.ok(!/getSession\(\)/.test(src));
    assert.match(src, /error=config/);
  });
});
