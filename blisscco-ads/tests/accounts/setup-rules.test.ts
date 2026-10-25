import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkHttpsUrl, parseAdvertiserSetup, parsePublisherSetup } from "@/lib/accounts/validation";
import { validateAdminDecision, isAdminDecisionKind } from "@/lib/admin/decisions";

describe("accounts: advertiser and publisher setup", () => {
  it("advertiser: name required, website optional but must be https", () => {
    assert.ok(!parseAdvertiserSetup({ companyName: " ", websiteUrl: "" }).ok);
    const ok = parseAdvertiserSetup({ companyName: "  Glow  Parlour ", websiteUrl: "" });
    assert.ok(ok.ok);
    if (ok.ok) assert.deepEqual(ok.value, { companyName: "Glow Parlour", websiteUrl: null });
    assert.ok(!parseAdvertiserSetup({ companyName: "A", websiteUrl: "http://a.com" }).ok);
    assert.ok(!parseAdvertiserSetup({ companyName: "x".repeat(151), websiteUrl: "" }).ok);
  });
  it("publisher: name required, category must be on the list", () => {
    assert.ok(!parsePublisherSetup({ name: "", websiteUrl: "", category: "" }).ok);
    assert.ok(!parsePublisherSetup({ name: "Bot", websiteUrl: "", category: "weapons" }).ok);
    const r = parsePublisherSetup({ name: "Bot", websiteUrl: "https://bot.example.com", category: "gaming" });
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.value.category, "gaming");
  });
  it("checkHttpsUrl basics", () => {
    assert.equal(checkHttpsUrl("https://example.com"), undefined);
    assert.equal(checkHttpsUrl("https://sub.example.co.in/a?b=1#c"), undefined);
    assert.ok(checkHttpsUrl("ftp://example.com"));
  });
});

describe("admin: decisions", () => {
  it("accounts: only active or suspended", () => {
    assert.deepEqual(validateAdminDecision("advertiser", "active", ""), { ok: true, value: "active", reason: null });
    assert.ok(!validateAdminDecision("publisher", "pending", "").ok);
    assert.ok(!validateAdminDecision("publisher", "approve", "").ok);
  });
  it("creative reject needs a reason; approve does not", () => {
    assert.ok(!validateAdminDecision("creative", "reject", "   ").ok);
    assert.ok(!validateAdminDecision("creative", "reject", "x".repeat(501)).ok);
    assert.deepEqual(validateAdminDecision("creative", "reject", " Misleading claim "), { ok: true, value: "reject", reason: "Misleading claim" });
    assert.deepEqual(validateAdminDecision("creative", "approve", ""), { ok: true, value: "approve", reason: null });
  });
  it("campaign: approve or reject only", () => {
    assert.ok(validateAdminDecision("campaign", "approve", "").ok);
    assert.ok(!validateAdminDecision("campaign", "active", "").ok);
  });
  it("kind is checked", () => {
    assert.ok(isAdminDecisionKind("creative"));
    assert.ok(!isAdminDecisionKind("profile"));
  });
});
