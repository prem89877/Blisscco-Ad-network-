import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// Har dashboard page / action par login + role ki jaanch maujood hai (source check; ye asli login ka test nahi).

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const dashboardFiles = walk("app/dashboard");
const pages = dashboardFiles.filter((f) => f.endsWith("/page.tsx"));
const actionFiles = dashboardFiles.filter((f) => /actions\.ts$/.test(f));

describe("route protection: dashboard pages", () => {
  it("found the dashboard pages", () => assert.ok(pages.length >= 8, String(pages.length)));

  for (const page of pages) {
    it(`${page} checks login (requireAccount / requireRole)`, () => {
      // account-status sirf requireUser use karta hai (requireAccount se redirect loop banta)
      assert.match(read(page), /require(Account|Role|User)\(/);
    });
  }

  it("role-specific pages ask for the right role", () => {
    assert.match(read("app/dashboard/admin/page.tsx"), /requireRole\(\["admin"\]\)/);
    assert.match(read("app/dashboard/publisher/page.tsx"), /requireRole\(\["publisher"\]\)/);
    for (const f of pages.filter((p) => p.includes("/advertiser/campaigns"))) {
      assert.match(read(f), /requireRole\(\["advertiser"\]\)/, f);
    }
  });

  it("the dashboard layout verifies the user on the server", () => {
    assert.match(read("app/dashboard/layout.tsx"), /requireUser\(\)/);
  });
});

describe("route protection: server actions", () => {
  it("found the action files", () => assert.ok(actionFiles.length >= 5, actionFiles.join(",")));

  for (const f of actionFiles) {
    it(`${f} is a server-action file and checks the role`, () => {
      const src = read(f);
      assert.match(src, /^"use server";/);
      assert.match(src, /requireRole\(/);
    });
  }

  it("admin actions never use the service-role client; admin decisions use RLS session", () => {
    const src = read("app/dashboard/admin/actions.ts");
    assert.ok(!/createAdminClient|SUPABASE_SECRET/.test(src));
    assert.match(src, /requireRole\(\["admin"\]\)/);
  });

  it("publisher actions never take publisher id from the form", () => {
    const src = read("app/dashboard/publisher/actions.ts");
    assert.ok(!/formData\.get\("publisherId"\)/.test(src));
    // Publisher hamesha login se dhoondha jata hai (loadMyPublisher: database error alag se pata chalta hai).
    assert.match(src, /loadMyPublisher\(\)/);
  });
});

describe("route protection: middleware", () => {
  it("only auth-related routes go through the middleware (API routes do not)", () => {
    const src = read("middleware.ts");
    assert.match(src, /"\/dashboard\/:path\*"/);
    assert.ok(!/\/api/.test(src));
  });
});
