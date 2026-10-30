import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CREATIVE_ACTIONS,
  availableCreativeActions,
  isCreativeAction,
  parseCreativeForm,
  toCreative,
  type CreativeFormValues,
} from "@/lib/campaigns/creative-validation";

const good: CreativeFormValues = {
  headline: "Learn guitar online",
  body: "Short lessons you can finish in a week.",
  ctaText: "Start now",
  destinationUrl: "https://example.com/learn?ref=blisscco",
};

describe("creatives: form validation", () => {
  it("accepts a good ad and cleans spaces", () => {
    const r = parseCreativeForm({ ...good, headline: "  Learn   guitar ", ctaText: "  " });
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.value.headline, "Learn guitar");
      assert.equal(r.value.ctaText, null);
    }
  });
  it("enforces the same limits as the database", () => {
    assert.ok(!parseCreativeForm({ ...good, headline: "" }).ok);
    assert.ok(!parseCreativeForm({ ...good, headline: "x".repeat(91) }).ok);
    assert.ok(parseCreativeForm({ ...good, headline: "x".repeat(90) }).ok);
    assert.ok(!parseCreativeForm({ ...good, body: "x".repeat(301) }).ok);
    assert.ok(!parseCreativeForm({ ...good, ctaText: "x".repeat(31) }).ok);
  });
  it("rejects unsafe or sloppy web addresses", () => {
    for (const url of [
      "",
      "http://example.com",
      "javascript:alert(1)",
      "https://",
      "https://localhost/x",
      "https://127.0.0.1/x",
      "https://intranet/x",
      "https://good.com@evil.example/x",
      "https://user:pw@example.com/",
      "https://exa mple.com",
      `https://example.com/${"a".repeat(2100)}`,
    ]) {
      const r = parseCreativeForm({ ...good, destinationUrl: url });
      assert.ok(!r.ok && r.errors.destinationUrl, url.slice(0, 40));
    }
  });
  it("rejects control characters in text", () => {
    assert.ok(!parseCreativeForm({ ...good, headline: "Hi\u0000there" }).ok);
  });
});

describe("creatives: allowed status changes match the database trigger", () => {
  it("draft can be sent for review or archived", () => {
    assert.deepEqual(availableCreativeActions("draft").sort(), ["archive", "submit"]);
  });
  it("pending review can only be taken back", () => assert.deepEqual(availableCreativeActions("pending_review"), ["withdraw"]));
  it("rejected can be reopened or archived", () => assert.deepEqual(availableCreativeActions("rejected").sort(), ["archive", "reopen"]));
  it("an advertiser has no way to approve an ad", () => {
    assert.ok(!isCreativeAction("approve"));
    for (const a of Object.values(CREATIVE_ACTIONS)) assert.notEqual(a.to, "approved");
  });
  it("archived ads have no actions", () => assert.deepEqual(availableCreativeActions("archived"), []));
});

describe("creatives: database rows", () => {
  it("toCreative reads good rows and rejects broken ones", () => {
    const row = { id: "a", campaign_id: "b", headline: "H", body: "B", cta_text: null, destination_url: "https://x.co", status: "draft", rejection_reason: null };
    assert.equal(toCreative(row)?.headline, "H");
    assert.equal(toCreative({ ...row, status: "weird" }), null);
    assert.equal(toCreative(null), null);
    assert.equal(toCreative({ ...row, headline: 5 }), null);
  });
});
