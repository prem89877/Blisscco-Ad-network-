import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BANNER_MAX_BYTES,
  LOGO_MAX_BYTES,
  buildAssetPath,
  checkImageMeta,
  checkImageUpload,
  isOwnedAssetPath,
  sniffImageMime,
} from "@/lib/campaigns/creative-assets";
import {
  CTA_OPTIONS,
  parseKeywords,
  parseSubmission,
  toSubmittedCreative,
  type SubmissionValues,
} from "@/lib/campaigns/creative-submission";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
const TEXT = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>");

const ADV = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CAMP = "a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1";
const RND = "c0c0c0c0-0000-4000-8000-000000000001";

describe("phase 4 step 3 | image checks", () => {
  it("accepts PNG, JPG and WebP whose real bytes match", () => {
    assert.deepEqual(checkImageUpload("logo", { name: "a.png", type: "image/png", size: 1000 }, PNG), { ok: true, mime: "image/png", ext: "png" });
    assert.deepEqual(checkImageUpload("banner", { name: "b.jpeg", type: "image/jpeg", size: 1000 }, JPG), { ok: true, mime: "image/jpeg", ext: "jpg" });
    assert.deepEqual(checkImageUpload("banner", { name: "b.WEBP", type: "image/webp", size: 1000 }, WEBP), { ok: true, mime: "image/webp", ext: "webp" });
  });
  it("sniffs the real type from bytes", () => {
    assert.equal(sniffImageMime(PNG), "image/png");
    assert.equal(sniffImageMime(JPG), "image/jpeg");
    assert.equal(sniffImageMime(WEBP), "image/webp");
    assert.equal(sniffImageMime(TEXT), null);
    assert.equal(sniffImageMime(new Uint8Array()), null);
  });
  it("rejects empty files and files over the limit (logo 1 MB, banner 2 MB)", () => {
    assert.equal(checkImageMeta("logo", { name: "a.png", type: "image/png", size: 0 }).ok, false);
    assert.equal(checkImageMeta("logo", { name: "a.png", type: "image/png", size: LOGO_MAX_BYTES }).ok, true);
    assert.equal(checkImageMeta("logo", { name: "a.png", type: "image/png", size: LOGO_MAX_BYTES + 1 }).ok, false);
    assert.equal(checkImageMeta("banner", { name: "a.png", type: "image/png", size: BANNER_MAX_BYTES }).ok, true);
    assert.equal(checkImageMeta("banner", { name: "a.png", type: "image/png", size: BANNER_MAX_BYTES + 1 }).ok, false);
  });
  it("rejects SVG, GIF, PDF, HTML and unknown types", () => {
    for (const [name, type] of [["a.svg", "image/svg+xml"], ["a.gif", "image/gif"], ["a.pdf", "application/pdf"], ["a.html", "text/html"], ["a.png", ""], ["a", "image/png"]]) {
      assert.equal(checkImageMeta("logo", { name, type, size: 100 }).ok, false, `${name} ${type}`);
    }
  });
  it("rejects a file whose bytes are not the declared image (renamed text/SVG, wrong type)", () => {
    assert.equal(checkImageUpload("logo", { name: "a.png", type: "image/png", size: TEXT.length }, TEXT).ok, false);
    assert.equal(checkImageUpload("logo", { name: "a.png", type: "image/png", size: 100 }, JPG).ok, false);
    assert.equal(checkImageUpload("logo", { name: "a.jpg", type: "image/jpeg", size: 100 }, PNG).ok, false);
  });
  it("error messages are clear and never leak internals", () => {
    const r = checkImageMeta("banner", { name: "a.gif", type: "image/gif", size: 10 });
    assert.ok(!r.ok && /PNG, JPG or WebP/.test(r.error));
  });
});

describe("phase 4 step 3 | asset paths", () => {
  it("builds <advertiser>/<campaign>/<kind>-<uuid>.<ext>", () => {
    const p = buildAssetPath({ advertiserId: ADV, campaignId: CAMP, kind: "logo", ext: "png", randomId: RND });
    assert.equal(p, `${ADV}/${CAMP}/logo-${RND}.png`);
  });
  it("refuses non-uuid pieces (no path tricks)", () => {
    assert.equal(buildAssetPath({ advertiserId: "../x", campaignId: CAMP, kind: "logo", ext: "png", randomId: RND }), null);
    assert.equal(buildAssetPath({ advertiserId: ADV, campaignId: `${CAMP}/..`, kind: "logo", ext: "png", randomId: RND }), null);
  });
  it("ownership check: only own advertiser + campaign + right kind", () => {
    const p = `${ADV}/${CAMP}/banner-${RND}.webp`;
    assert.ok(isOwnedAssetPath(p, ADV, CAMP, "banner"));
    assert.ok(!isOwnedAssetPath(p, ADV, CAMP, "logo"));
    assert.ok(!isOwnedAssetPath(p, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", CAMP, "banner"));
    assert.ok(!isOwnedAssetPath(p, ADV, "b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1", "banner"));
    assert.ok(!isOwnedAssetPath(`${ADV}/${CAMP}/../x/banner-${RND}.png`, ADV, CAMP, "banner"));
  });
});

const good: SubmissionValues = {
  campaignId: CAMP,
  brandName: "  Guitar   House ",
  headline: "Learn guitar online",
  body: "Short lessons you can finish in a week.",
  ctaText: "Learn more",
  destinationUrl: "https://example.com/learn?ref=blisscco",
  keywords: "Guitar, lessons , GUITAR,music",
};

describe("phase 4 step 3 | submission form validation", () => {
  it("accepts a good submission and cleans it", () => {
    const r = parseSubmission(good);
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.value.brandName, "Guitar House");
      assert.equal(r.value.keywords, "guitar, lessons, music");
      assert.equal(r.value.ctaText, "Learn more");
    }
  });
  it("makes the required fields mandatory", () => {
    for (const k of ["campaignId", "brandName", "headline", "body", "ctaText", "destinationUrl"] as const) {
      const r = parseSubmission({ ...good, [k]: "" });
      assert.ok(!r.ok && r.errors[k], k);
    }
  });
  it("keywords are optional", () => {
    const r = parseSubmission({ ...good, keywords: "  " });
    assert.ok(r.ok && r.value.keywords === null);
  });
  it("rejects a campaign id that is not a uuid", () => {
    const r = parseSubmission({ ...good, campaignId: "1; drop table" });
    assert.ok(!r.ok && r.errors.campaignId);
  });
  it("same text limits as the database CHECKs", () => {
    assert.ok(!parseSubmission({ ...good, brandName: "x".repeat(81) }).ok);
    assert.ok(parseSubmission({ ...good, brandName: "x".repeat(80) }).ok);
    assert.ok(!parseSubmission({ ...good, headline: "x".repeat(91) }).ok);
    assert.ok(!parseSubmission({ ...good, body: "x".repeat(301) }).ok);
  });
  it("calls the description field 'description' in its error", () => {
    const r = parseSubmission({ ...good, body: "" });
    assert.ok(!r.ok && r.errors.body === "Enter the ad description.");
  });
  it("CTA must be one of the listed options", () => {
    for (const cta of CTA_OPTIONS) assert.ok(parseSubmission({ ...good, ctaText: cta }).ok, cta);
    assert.ok(!parseSubmission({ ...good, ctaText: "Click here now!!!" }).ok);
  });
  it("rejects invalid or unsafe destination URLs", () => {
    for (const url of ["", "example.com", "http://example.com", "javascript:alert(1)", "data:text/html,hi", "https://", "https://localhost/x", "https://127.0.0.1", "https://good.com@evil.example/x", "https://exa mple.com", "ftp://example.com"]) {
      const r = parseSubmission({ ...good, destinationUrl: url });
      assert.ok(!r.ok && r.errors.destinationUrl, url);
    }
  });
  it("rejects control characters in brand and text", () => {
    assert.ok(!parseSubmission({ ...good, brandName: "A\u0000B" }).ok);
    assert.ok(!parseSubmission({ ...good, brandName: "A\u202eB" }).ok);
    assert.ok(!parseSubmission({ ...good, headline: "Hi\u0000there" }).ok);
  });
  it("keywords: max 10, 2-30 chars each, safe characters only", () => {
    assert.ok(parseKeywords("a1,b2,c3,d4,e5,f6,g7,h8,i9,j10").ok);
    assert.ok(!parseKeywords("a1,b2,c3,d4,e5,f6,g7,h8,i9,j10,k11").ok);
    assert.ok(!parseKeywords("a").ok);
    assert.ok(!parseKeywords("x".repeat(31)).ok);
    assert.ok(!parseKeywords("<script>").ok);
    assert.ok(!parseKeywords("ok, bad;word").ok);
    assert.ok(parseKeywords("c++, r&b, dr. who").ok);
  });
});

describe("phase 4 step 3 | row mapping", () => {
  const row = {
    id: "i1", campaign_id: CAMP, headline: "H", body: "B", cta_text: "Shop now", destination_url: "https://example.com",
    status: "rejected", rejection_reason: "Logo is blurry", brand_name: "Brand", logo_path: "p1", banner_path: "p2", keywords: "a, b",
  };
  it("maps a full row including the new columns", () => {
    const c = toSubmittedCreative(row);
    assert.ok(c);
    assert.equal(c?.brandName, "Brand");
    assert.equal(c?.rejectionReason, "Logo is blurry");
    assert.equal(c?.keywords, "a, b");
  });
  it("old ads (no new columns) still map with nulls", () => {
    const { brand_name: _b, logo_path: _l, banner_path: _n, keywords: _k, ...old } = row;
    void [_b, _l, _n, _k];
    const c = toSubmittedCreative({ ...old, status: "approved" });
    assert.ok(c);
    assert.equal(c?.logoPath, null);
    assert.equal(c?.brandName, null);
  });
  it("bad rows give null, never crash", () => {
    assert.equal(toSubmittedCreative(null), null);
    assert.equal(toSubmittedCreative({ ...row, status: "weird" }), null);
    assert.equal(toSubmittedCreative({ ...row, headline: 5 }), null);
  });
});
