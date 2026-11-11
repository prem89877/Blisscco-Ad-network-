import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// "[auth] code exchange failed { code: 'pkce_code_verifier_not_found', status: 400 }": link doosre browser me khula ya do baar khula.
// Source (text) checks: Next.js route yahan nahi chalta.
const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("auth confirm | pkce_code_verifier_not_found", () => {
  const src = code("app/auth/confirm/route.ts");
  it("an already-signed-in browser (link opened twice) goes on to the dashboard, verified by getUser(), never by getSession()", () => {
    assert.match(src, /error\?\.code === "pkce_code_verifier_not_found"/);
    assert.match(src, /supabase\.auth\.getUser\(\)/);
    assert.doesNotMatch(src, /getSession\(\)/);
    assert.match(src, /redirect\(next\)/);
  });
  it("without a session the user gets a clear message, not the generic invalid-link one", () => {
    assert.match(src, /confirm_other_browser/);
    assert.match(src, /confirm_failed/);
  });
  it("the login page knows the new message key", () => {
    assert.match(read("app/login/page.tsx"), /confirm_other_browser:/);
  });
  it("the redirect still always goes through safeNextPath and no session is created without a valid code / token", () => {
    assert.match(src, /safeNextPath\(params\.get\("next"\)\)/);
    assert.equal([...src.matchAll(/exchangeCodeForSession\(/g)].length, 1);
  });
});
