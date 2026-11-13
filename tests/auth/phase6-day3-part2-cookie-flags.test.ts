import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { hardenCookieOptions } from "@/lib/supabase/cookie-options";

// Phase 6 Day 3 Part 2, F4: session cookie flags (code level). Live Set-Cookie check owner karega (curl), yahan nahi hota.
const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

describe("F4 cookie flags | hardenCookieOptions", () => {
  it("production: HttpOnly + Secure + SameSite=Lax + path /, even when options are missing", () => {
    for (const input of [undefined, {}, { httpOnly: false, secure: false, sameSite: "none" as const }]) {
      const o = hardenCookieOptions(input, true);
      assert.equal(o.httpOnly, true);
      assert.equal(o.secure, true);
      assert.equal(o.sameSite, "lax");
      assert.equal(o.path, "/");
    }
  });
  it("SameSite=None is never kept; Strict is kept; boolean true means Strict", () => {
    assert.equal(hardenCookieOptions({ sameSite: "none" }, true).sameSite, "lax");
    assert.equal(hardenCookieOptions({ sameSite: "strict" }, true).sameSite, "strict");
    assert.equal(hardenCookieOptions({ sameSite: true }, true).sameSite, "strict");
    assert.equal(hardenCookieOptions({ sameSite: false }, true).sameSite, "lax");
  });
  it("non-production (local http): Secure is not forced, HttpOnly and SameSite still are", () => {
    const o = hardenCookieOptions({}, false);
    assert.equal(o.secure, false);
    assert.equal(o.httpOnly, true);
    assert.equal(o.sameSite, "lax");
  });
  it("keeps maxAge, expires, domain (session lifetime and deletion keep working) and does not mutate the input", () => {
    const exp = new Date(0);
    const input = { maxAge: 0, expires: exp, domain: "example.com", path: "/x" };
    const o = hardenCookieOptions(input, true);
    assert.equal(o.maxAge, 0);
    assert.equal(o.expires, exp);
    assert.equal(o.domain, "example.com");
    assert.equal(o.path, "/x");
    assert.deepEqual(input, { maxAge: 0, expires: exp, domain: "example.com", path: "/x" });
  });
  it("invalid path falls back to /", () => {
    assert.equal(hardenCookieOptions({ path: "x" }, true).path, "/");
  });
});

describe("F4 cookie flags | wiring (source check)", () => {
  it("server client and middleware both pass cookie options through hardenCookieOptions", () => {
    assert.match(read("lib/supabase/server.ts"), /cookieStore\.set\(name, value, hardenCookieOptions\(options\)\)/);
    assert.match(read("lib/supabase/middleware.ts"), /response\.cookies\.set\(name, value, hardenCookieOptions\(options\)\)/);
  });
  it("no file imports the browser Supabase client (HttpOnly cookies would be unreadable there)", () => {
    const files = ["app", "components", "lib"].flatMap((d) => walk(path.join(ROOT, d)));
    const users = files.filter((f) => !f.endsWith(path.join("lib", "supabase", "client.ts")) && /from ["']@\/lib\/supabase\/client["']/.test(readFileSync(f, "utf8")));
    assert.deepEqual(users, []);
  });
});

import { readdirSync, statSync } from "node:fs";
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}
