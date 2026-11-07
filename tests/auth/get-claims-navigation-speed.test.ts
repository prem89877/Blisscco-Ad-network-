import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// Dashboard navigation speed: middleware getClaims() (local JWT verify) + profile query getUser() ke saath parallel.
// Security niyam wahi: server par asli user check getUser() se, role sirf database se, fail closed.
const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("get-claims | middleware", () => {
  const src = code("lib/supabase/middleware.ts");
  it("protected routes use getClaims(); /login and /signup keep getUser() (no redirect loop for a revoked session)", () => {
    assert.match(src, /getClaims\(\)/);
    assert.match(src, /if \(isAuthPage\) \{\s*user = \(await supabase\.auth\.getUser\(\)\)\.data\.user;/);
  });
  it("never uses getSession() and still redirects a logged-out user away from /dashboard", () => {
    assert.doesNotMatch(src, /getSession\(\)/);
    assert.match(src, /!user && isProtected/);
  });
});

describe("get-claims | session", () => {
  const src = code("lib/auth/session.ts");
  it("the real user check is still getUser()", () => {
    assert.match(src, /supabase\.auth\.getUser\(\)/);
    assert.doesNotMatch(src, /getSession\(\)/);
  });
  it("only the user id (sub) is taken from claims, never role / status / metadata", () => {
    const claimUses = [...src.matchAll(/claims\??\.(\w+)/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(claimUses)], ["sub"]);
    assert.doesNotMatch(src, /user_metadata|app_metadata/);
  });
  it("profile query and getUser() run together, and the two users must match (fail closed)", () => {
    assert.match(src, /Promise\.all\(\[getCurrentUser\(\), loadProfileRow\(userId\)\]\)/);
    assert.match(src, /!user \|\| user\.id !== userId\) return null/);
  });
  it("requireAccount and the dashboard layout start the user check and the profile query together", () => {
    assert.match(src, /Promise\.all\(\[requireUser\(\), getCurrentAccount\(\)\]\)/);
    assert.match(code("app/dashboard/layout.tsx"), /Promise\.all\(\[requireUser\(\), getCurrentAccount\(\)\]\)/);
  });
  it("older fallback query and the role-choice redirect are unchanged", () => {
    assert.match(src, /select\("role, status"\)/);
    assert.match(src, /roleChoicePending\) redirect\("\/auth\/choose-role"\)/);
    assert.match(src, /account\.status !== "active"\) redirect\("\/dashboard\/account-status"\)/);
  });
});
