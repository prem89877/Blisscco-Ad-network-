import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { currentLabel, isActive, navForRole } from "@/lib/dashboard-nav";
import { siteBaseUrl } from "@/lib/site";
import {
  buildKeyParts,
  expiryIso,
  isExpiryChoice,
  keyIsUsable,
  parseKeyLabel,
  toPublisherKey,
} from "@/lib/publisher/keys";

const labels = (r: Parameters<typeof navForRole>[0]) => navForRole(r).map((i) => i.label);

describe("dashboard nav: each role sees only its own links", () => {
  it("advertiser", () => assert.deepEqual(labels("advertiser"), ["Overview", "Campaigns", "Analytics"]));
  it("publisher", () => assert.deepEqual(labels("publisher"), ["Overview", "Publisher", "Analytics"]));
  it("admin", () => assert.deepEqual(labels("admin"), ["Overview", "Admin", "Analytics"]));
  it("unknown role: only Overview", () => assert.deepEqual(labels(null), ["Overview"]));
  it("active link and header label", () => {
    assert.ok(isActive("/dashboard/advertiser/campaigns/abc", "/dashboard/advertiser/campaigns"));
    assert.ok(!isActive("/dashboard/publisher", "/dashboard"));
    assert.equal(currentLabel("/dashboard/publisher/guide"), "Publisher");
    assert.equal(currentLabel("/dashboard/admin"), "Admin");
  });
});

describe("site url", () => {
  it("prefers NEXT_PUBLIC_SITE_URL, trims the slash, ignores junk", () => {
    assert.equal(siteBaseUrl({ NEXT_PUBLIC_SITE_URL: "https://blisscco.com/" }), "https://blisscco.com");
    assert.equal(siteBaseUrl({ NEXT_PUBLIC_SITE_URL: "not a url", VERCEL_PROJECT_PRODUCTION_URL: "blisscco.vercel.app" }), "https://blisscco.vercel.app");
    assert.equal(siteBaseUrl({}), "http://localhost:3000");
  });
});

describe("publisher keys: pure helpers", () => {
  const HEX = "ab".repeat(32);
  it("builds key, prefix (13 chars) and hint (last 4)", () => {
    const p = buildKeyParts(HEX);
    assert.ok(p);
    assert.equal(p?.key, `blc_live_${HEX}`);
    assert.equal(p?.prefix.length, 13);
    assert.equal(p?.hint, "abab");
    assert.equal(buildKeyParts("zz"), null);
    assert.equal(buildKeyParts(HEX.toUpperCase()), null);
  });
  it("expiry choices", () => {
    const now = new Date("2026-10-25T00:00:00Z");
    assert.equal(expiryIso("30", now), "2026-11-24T00:00:00.000Z");
    assert.equal(expiryIso("never", now), null);
    assert.ok(isExpiryChoice("90"));
    assert.ok(!isExpiryChoice("7"));
  });
  it("labels", () => {
    assert.deepEqual(parseKeyLabel("  my   server "), { ok: true, value: "my server" });
    assert.deepEqual(parseKeyLabel(""), { ok: true, value: null });
    assert.ok(!parseKeyLabel("x".repeat(61)).ok);
  });
  it("revoked or expired keys are not usable", () => {
    const now = new Date("2026-10-25T00:00:00Z");
    assert.equal(keyIsUsable({ status: "active", expiresAt: null }, now), true);
    assert.equal(keyIsUsable({ status: "active", expiresAt: "2026-12-01T00:00:00Z" }, now), true);
    assert.equal(keyIsUsable({ status: "active", expiresAt: "2026-10-01T00:00:00Z" }, now), false);
    assert.equal(keyIsUsable({ status: "revoked", expiresAt: null }, now), false);
  });
  it("database rows never expose a hash", () => {
    const k = toPublisherKey({ id: "1", key_prefix: "blc_live_abcd", key_hint: "1234", status: "active", created_at: "2026-10-25", key_hash: "SECRET" });
    assert.ok(k);
    assert.ok(!JSON.stringify(k).includes("SECRET"));
    assert.equal(toPublisherKey({ id: "1", status: "weird" }), null);
  });
});
