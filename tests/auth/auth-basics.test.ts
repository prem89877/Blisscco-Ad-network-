import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { safeNextPath } from "@/lib/auth/redirect";
import { normalizeEmail, validateEmail, validateNewPassword, PASSWORD_MIN } from "@/lib/auth/validation";

// Login / signup ke chhote niyam. Asli Supabase yahan nahi chhuta.

describe("auth: safeNextPath (open-redirect se bachav)", () => {
  it("allows dashboard paths and keeps the query", () => {
    assert.equal(safeNextPath("/dashboard"), "/dashboard");
    assert.equal(safeNextPath("/dashboard/advertiser/campaigns?status=draft"), "/dashboard/advertiser/campaigns?status=draft");
  });
  it("falls back for anything outside the dashboard or off-site", () => {
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "/login", "/dashboardx", "javascript:alert(1)", "", null, 42, undefined]) {
      assert.equal(safeNextPath(bad), "/dashboard", String(bad));
    }
  });
  it("rejects control characters and very long values", () => {
    assert.equal(safeNextPath("/dashboard/\u0000x"), "/dashboard");
    assert.equal(safeNextPath("/dashboard/" + "a".repeat(600)), "/dashboard");
  });
  it("uses a custom fallback", () => {
    assert.equal(safeNextPath("https://evil.com", "/dashboard/publisher"), "/dashboard/publisher");
  });
});

describe("auth: email and password rules", () => {
  it("normalizes email (trim + lowercase) and ignores files / null", () => {
    assert.equal(normalizeEmail("  Test@Example.COM "), "test@example.com");
    assert.equal(normalizeEmail(null), "");
  });
  it("validateEmail accepts normal emails and rejects broken ones", () => {
    assert.equal(validateEmail("a@b.co"), undefined);
    for (const bad of ["", "a", "a@b", "a b@c.com", "@x.com", `${"a".repeat(250)}@b.co`]) {
      assert.ok(validateEmail(bad), bad);
    }
  });
  it("validateNewPassword: min 8 characters, max 72 bytes", () => {
    assert.ok(validateNewPassword("a".repeat(PASSWORD_MIN - 1)));
    assert.equal(validateNewPassword("a".repeat(PASSWORD_MIN)), undefined);
    assert.equal(validateNewPassword("a".repeat(72)), undefined);
    assert.ok(validateNewPassword("a".repeat(73)));
    assert.ok(validateNewPassword("é".repeat(37)), "74 bytes");
  });
});
