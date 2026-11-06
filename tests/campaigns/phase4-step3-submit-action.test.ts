import "./step3-stubs";
import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { ADV_A, ADV_B, CAMP_A, CAMP_A_CLOSED, CAMP_B, fake, type FakeRow } from "./step3-stubs";
import { submitCreative } from "@/app/dashboard/advertiser/creatives/actions";
import { initialSubmissionState } from "@/lib/campaigns/creative-submission";
import { isOwnedAssetPath } from "@/lib/campaigns/creative-assets";

// Ye tests server action ko NAKLI database + storage ke saath chalate hain. Asli upload, RLS, storage policy aur admin approval
// TEST database par manually check hone baaki hain (PHASE4-STEP3 report me "pending manual").

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 2, 3, 4]);
const RID = "d1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1";
const png = (name = "logo.png") => new File([PNG], name, { type: "image/png" });
const jpg = (name = "banner.jpg") => new File([JPG], name, { type: "image/jpeg" });

function form(over: Record<string, string | File | null> = {}): FormData {
  const base: Record<string, string | File | null> = {
    campaignId: CAMP_A,
    brandName: "Guitar House",
    headline: "Learn guitar online",
    body: "Short lessons you can finish in a week.",
    ctaText: "Learn more",
    destinationUrl: "https://example.com/learn",
    keywords: "guitar, music",
    logo: png(),
    banner: jpg(),
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...base, ...over })) if (v !== null) fd.set(k, v);
  return fd;
}

async function run(fd: FormData): Promise<{ redirect: string } | { state: Awaited<ReturnType<typeof submitCreative>> }> {
  try {
    return { state: await submitCreative(initialSubmissionState, fd) };
  } catch (e) {
    const m = /^REDIRECT:(.*)$/.exec((e as Error).message);
    if (m) return { redirect: m[1] };
    throw e;
  }
}
const inserts = () => fake.dbCalls.filter((c) => c.op === "insert");
const updates = () => fake.dbCalls.filter((c) => c.op === "update");

function rejectedRow(over: Partial<FakeRow> = {}): FakeRow {
  return {
    id: RID, campaign_id: CAMP_A, status: "rejected", rejection_reason: "Logo is blurry", reviewed_by: "admin", reviewed_at: "x",
    headline: "Old", body: "Old body", cta_text: "Shop now", destination_url: "https://example.com/old", brand_name: "Old brand", keywords: null,
    logo_path: `${ADV_A}/${CAMP_A}/logo-c0c0c0c0-0000-4000-8000-0000000000a1.png`,
    banner_path: `${ADV_A}/${CAMP_A}/banner-c0c0c0c0-0000-4000-8000-0000000000a2.jpg`,
    ...over,
  };
}

beforeEach(() => fake.reset());

describe("phase 4 step 3 | submit: happy path", () => {
  it("uploads logo + banner, stores the ad as pending_review, never approved", async () => {
    const r = await run(form());
    assert.deepEqual(r, { redirect: "/dashboard/advertiser/creatives?result=submitted" });
    assert.equal(fake.uploads.length, 2);
    assert.equal(fake.creatives.length, 1);
    const row = fake.creatives[0];
    assert.equal(row.status, "pending_review");
    assert.equal(row.reviewed_by, null);
    assert.equal(row.reviewed_at, null);
    assert.equal(row.rejection_reason, null);
    assert.equal(row.campaign_id, CAMP_A);
    assert.equal(row.brand_name, "Guitar House");
    assert.equal(row.keywords, "guitar, music");
    assert.equal(row.cta_text, "Learn more");
  });
  it("saves images under <my advertiser>/<my campaign>/ in the private bucket", async () => {
    await run(form());
    const row = fake.creatives[0];
    assert.ok(isOwnedAssetPath(String(row.logo_path), ADV_A, CAMP_A, "logo"));
    assert.ok(isOwnedAssetPath(String(row.banner_path), ADV_A, CAMP_A, "banner"));
    assert.deepEqual(fake.uploads.map((u) => u.contentType).sort(), ["image/jpeg", "image/png"]);
  });
  it("insert never carries review fields or a non-draft status", async () => {
    await run(form());
    const payload = inserts()[0].payload ?? {};
    for (const k of ["status", "rejection_reason", "reviewed_by", "reviewed_at"]) assert.ok(!(k in payload), k);
  });
  it("a keyword-less ad is fine", async () => {
    const r = await run(form({ keywords: "" }));
    assert.deepEqual(r, { redirect: "/dashboard/advertiser/creatives?result=submitted" });
    assert.equal(fake.creatives[0].keywords, null);
  });
});

describe("phase 4 step 3 | submit: validation blocks bad input before any upload or insert", () => {
  const blocked = (r: Awaited<ReturnType<typeof run>>) => {
    assert.ok("state" in r && r.state.status === "error");
    assert.equal(fake.uploads.length, 0);
    assert.equal(inserts().length, 0);
    assert.equal(fake.creatives.length, 0);
  };
  it("empty submission", async () => {
    const r = await run(form({ brandName: "", headline: "", body: "", ctaText: "", destinationUrl: "", keywords: "", logo: null, banner: null }));
    blocked(r);
    if ("state" in r) for (const k of ["brandName", "headline", "body", "ctaText", "destinationUrl", "logo", "banner"] as const) assert.ok(r.state.fieldErrors?.[k], k);
  });
  it("missing logo", async () => {
    const r = await run(form({ logo: null }));
    blocked(r);
    if ("state" in r) assert.ok(r.state.fieldErrors?.logo);
  });
  it("missing banner", async () => {
    const r = await run(form({ banner: null }));
    blocked(r);
    if ("state" in r) assert.ok(r.state.fieldErrors?.banner);
  });
  it("invalid URL", async () => {
    for (const url of ["http://example.com", "javascript:alert(1)", "not a url", "https://user@evil.example"]) {
      const r = await run(form({ destinationUrl: url }));
      blocked(r);
      if ("state" in r) assert.ok(r.state.fieldErrors?.destinationUrl, url);
    }
  });
  it("SVG, GIF and text files are rejected", async () => {
    const svg = new File(["<svg onload=alert(1)></svg>"], "logo.svg", { type: "image/svg+xml" });
    const gif = new File([PNG], "banner.gif", { type: "image/gif" });
    blocked(await run(form({ logo: svg })));
    blocked(await run(form({ banner: gif })));
  });
  it("a file renamed to .png whose bytes are not an image is rejected", async () => {
    const fake1 = new File(["just some text, not an image"], "logo.png", { type: "image/png" });
    const r = await run(form({ logo: fake1 }));
    blocked(r);
    if ("state" in r) assert.match(r.state.fieldErrors?.logo ?? "", /not a valid/);
  });
  it("PNG bytes declared as JPEG are rejected", async () => {
    blocked(await run(form({ banner: new File([PNG], "banner.jpg", { type: "image/jpeg" }) })));
  });
  it("oversized logo (> 1 MB) and banner (> 2 MB) are rejected", async () => {
    const big = (n: number) => { const a = new Uint8Array(n); a.set(PNG); return a; };
    blocked(await run(form({ logo: new File([big(1024 * 1024 + 1)], "logo.png", { type: "image/png" }) })));
    blocked(await run(form({ banner: new File([big(2 * 1024 * 1024 + 1)], "banner.png", { type: "image/png" }) })));
  });
  it("a text value in a file field is rejected", async () => {
    blocked(await run(form({ logo: "not-a-file" })));
  });
  it("keeps what the advertiser typed so it is not lost", async () => {
    const r = await run(form({ destinationUrl: "http://bad", headline: "My headline" }));
    assert.ok("state" in r && r.state.values?.headline === "My headline");
  });
});

describe("phase 4 step 3 | submit: ownership and account rules", () => {
  it("cannot submit for another advertiser's campaign", async () => {
    const r = await run(form({ campaignId: CAMP_B }));
    assert.ok("state" in r && r.state.message === "Campaign not found.");
    assert.equal(fake.uploads.length, 0);
    assert.equal(inserts().length, 0);
  });
  it("cannot submit for an unknown or malformed campaign id", async () => {
    for (const id of ["", "nope", "00000000-0000-4000-8000-000000000000"]) {
      fake.reset();
      const r = await run(form({ campaignId: id }));
      assert.ok("state" in r && r.state.status === "error", id);
      assert.equal(fake.uploads.length, 0);
      assert.equal(inserts().length, 0);
    }
  });
  it("cannot submit into an archived campaign", async () => {
    const r = await run(form({ campaignId: CAMP_A_CLOSED }));
    assert.ok("state" in r && /closed campaign/.test(r.state.message ?? ""));
    assert.equal(fake.uploads.length, 0);
  });
  it("an advertiser account that is not active cannot submit", async () => {
    fake.me = { id: ADV_A, status: "pending" };
    const r = await run(form());
    assert.ok("state" in r && /not approved/.test(r.state.message ?? ""));
    assert.equal(fake.uploads.length, 0);
    assert.equal(inserts().length, 0);
  });
  it("no advertiser row: clear message, nothing written", async () => {
    fake.me = null;
    const r = await run(form());
    assert.ok("state" in r && r.state.status === "error");
    assert.equal(fake.uploads.length, 0);
  });
  it("a wrong role is redirected before anything happens", async () => {
    fake.roleFails = true;
    const r = await run(form()).catch((e: Error) => ({ threw: e.message }));
    assert.ok("threw" in r || "redirect" in r);
    assert.equal(fake.uploads.length, 0);
    assert.equal(inserts().length, 0);
  });
  it("another advertiser's session cannot write into my folder (storage policy, simulated)", async () => {
    fake.me = { id: ADV_B, status: "active" };
    const r = await run(form({ campaignId: CAMP_A }));
    assert.ok("state" in r && r.state.status === "error");
    assert.equal(fake.uploads.length, 0);
  });
  it("campaign ad limit (20) is enforced", async () => {
    for (let i = 0; i < 20; i++) fake.creatives.push({ id: `x${i}`, campaign_id: CAMP_A, status: "draft" } as FakeRow);
    const r = await run(form());
    assert.ok("state" in r && /at most 20 ads/.test(r.state.message ?? ""));
    assert.equal(fake.uploads.length, 0);
  });
});

describe("phase 4 step 3 | submit: failures never fake a success and never leave junk", () => {
  it("upload failure: no ad row, clear error", async () => {
    fake.failUpload = true;
    const r = await run(form());
    assert.ok("state" in r && /could not be uploaded/.test(r.state.message ?? ""));
    assert.equal(fake.creatives.length, 0);
  });
  it("insert failure: the uploaded images are removed again", async () => {
    fake.failInsert = true;
    const r = await run(form());
    assert.ok("state" in r && r.state.status === "error");
    assert.equal(fake.creatives.length, 0);
    assert.equal(fake.objects.size, 0);
    assert.equal(fake.removed.length, 2);
  });
  it("send-for-review failure: ad stays draft and the advertiser is told, not shown a fake success", async () => {
    fake.failSend = true;
    const r = await run(form());
    assert.deepEqual(r, { redirect: "/dashboard/advertiser/creatives?result=draft" });
    assert.equal(fake.creatives[0].status, "draft");
  });
  it("error messages never contain raw database text", async () => {
    fake.failInsert = true;
    const r = await run(form());
    assert.ok("state" in r && !/XX000|violates|postgres/i.test(r.state.message ?? ""));
  });
});

describe("phase 4 step 3 | edit and resubmit a rejected ad", () => {
  it("replaces the banner, keeps the logo, clears the rejection and goes back to pending_review", async () => {
    const row = rejectedRow();
    fake.creatives.push(row);
    fake.objects.set(String(row.logo_path), "image/png");
    fake.objects.set(String(row.banner_path), "image/jpeg");
    const oldLogo = row.logo_path;
    const oldBanner = row.banner_path;
    const r = await run(form({ creativeId: RID, logo: null, headline: "Fixed headline" }));
    assert.deepEqual(r, { redirect: "/dashboard/advertiser/creatives?result=resubmitted" });
    assert.equal(row.status, "pending_review");
    assert.equal(row.rejection_reason, null);
    assert.equal(row.reviewed_by, null);
    assert.equal(row.headline, "Fixed headline");
    assert.equal(row.logo_path, oldLogo);
    assert.notEqual(row.banner_path, oldBanner);
    assert.ok(isOwnedAssetPath(String(row.banner_path), ADV_A, CAMP_A, "banner"));
    assert.ok(fake.removed.includes(String(oldBanner)));
    assert.ok(!fake.removed.includes(String(oldLogo)));
    assert.equal(fake.uploads.length, 1);
  });
  it("a rejected ad resubmitted without changes still goes to review (not stuck)", async () => {
    const row = rejectedRow();
    fake.creatives.push(row);
    const r = await run(
      form({ creativeId: RID, logo: null, banner: null, brandName: "Old brand", headline: "Old", body: "Old body", ctaText: "Shop now", destinationUrl: "https://example.com/old", keywords: "" }),
    );
    assert.deepEqual(r, { redirect: "/dashboard/advertiser/creatives?result=resubmitted" });
    assert.equal(row.status, "pending_review");
  });
  it("the campaign of an ad cannot be changed through the form", async () => {
    const row = rejectedRow();
    fake.creatives.push(row);
    await run(form({ creativeId: RID, logo: null, banner: null, campaignId: CAMP_B }));
    assert.equal(row.campaign_id, CAMP_A);
    assert.ok(updates().every((u) => !("campaign_id" in (u.payload ?? {}))));
  });
  it("cannot edit another advertiser's ad", async () => {
    const row = rejectedRow({ campaign_id: CAMP_B, logo_path: null, banner_path: null });
    fake.creatives.push(row);
    const r = await run(form({ creativeId: RID, logo: null, banner: null }));
    assert.ok("state" in r && r.state.message === "Ad not found.");
    assert.equal(updates().length, 0);
    assert.equal(row.status, "rejected");
  });
  it("cannot edit an approved ad or an ad under review through this form", async () => {
    for (const status of ["approved", "pending_review", "paused", "archived"]) {
      fake.reset();
      const row = rejectedRow({ status, rejection_reason: null });
      fake.creatives.push(row);
      const r = await run(form({ creativeId: RID, logo: null, banner: null }));
      assert.ok("state" in r && r.state.status === "error", status);
      assert.equal(updates().length, 0, status);
      assert.equal(row.status, status);
    }
  });
  it("a malformed creative id is refused", async () => {
    const r = await run(form({ creativeId: "not-a-uuid", logo: null, banner: null }));
    assert.ok("state" in r && r.state.message === "Ad not found.");
    assert.equal(updates().length, 0);
  });
  it("edit of an ad with a tampered path in the database is refused", async () => {
    const row = rejectedRow({ logo_path: `${ADV_B}/${CAMP_B}/logo-c0c0c0c0-0000-4000-8000-0000000000a1.png` });
    fake.creatives.push(row);
    const r = await run(form({ creativeId: RID, logo: null, banner: null }));
    assert.ok("state" in r && r.state.status === "error");
    assert.equal(row.status, "rejected");
  });
});
