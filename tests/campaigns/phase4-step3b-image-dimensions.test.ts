import "./step3-stubs";
import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { ADV_A, CAMP_A, fake } from "./step3-stubs";
import { submitCreative } from "@/app/dashboard/advertiser/creatives/actions";
import { initialSubmissionState } from "@/lib/campaigns/creative-submission";
import { checkFile } from "@/lib/campaigns/creative-upload";
import {
  BANNER_RATIO_MAX, BANNER_RATIO_MIN, checkImageDimensions, checkImageSize, readImageSize,
} from "@/lib/campaigns/image-dimensions";
import { makeJpeg, makePng, makeWebpExtended, makeWebpLossless, makeWebpLossy } from "./image-fixtures";

// Phase 4 Step 3B | logo / banner: pixel dimensions (asli bytes se) + banner aspect ratio. NAKLI database + storage.
// Asli upload TEST project par manually check hona baaki hai.

const file = (bytes: Uint8Array, name: string, type: string) => new File([bytes as BlobPart], name, { type });

describe("step 3B dimensions | reading real header bytes", () => {
  it("PNG (IHDR), JPEG (SOF0) and the three WebP flavours (VP8X, VP8, VP8L)", () => {
    assert.deepEqual(readImageSize(makePng(256, 128), "image/png"), { width: 256, height: 128 });
    assert.deepEqual(readImageSize(makeJpeg(1200, 628), "image/jpeg"), { width: 1200, height: 628 });
    assert.deepEqual(readImageSize(makeWebpExtended(1200, 628), "image/webp"), { width: 1200, height: 628 });
    assert.deepEqual(readImageSize(makeWebpLossy(640, 480), "image/webp"), { width: 640, height: 480 });
    assert.deepEqual(readImageSize(makeWebpLossless(512, 512), "image/webp"), { width: 512, height: 512 });
  });

  it("a JPEG with extra segments (EXIF-like APP1, comment) before the frame header is still read", () => {
    const base = makeJpeg(1200, 628);
    const app1 = [0xff, 0xe1, 0x00, 0x0a, 0x45, 0x78, 0x69, 0x66, 0, 0, 1, 2];
    const com = [0xff, 0xfe, 0x00, 0x05, 0x68, 0x69, 0x21];
    const out = Uint8Array.from([0xff, 0xd8, ...app1, ...com, ...base.subarray(2)]);
    assert.deepEqual(readImageSize(out, "image/jpeg"), { width: 1200, height: 628 });
  });

  it("garbage, truncated and zero-size headers give null (never a guess, never a throw)", () => {
    assert.equal(readImageSize(new Uint8Array(0), "image/png"), null);
    assert.equal(readImageSize(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), "image/png"), null);
    assert.equal(readImageSize(makePng(0, 0), "image/png"), null);
    assert.equal(readImageSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 2]), "image/jpeg"), null);
    assert.equal(readImageSize(new Uint8Array(40), "image/webp"), null);
    assert.equal(readImageSize(new TextEncoder().encode("not an image at all, just text"), "image/png"), null);
  });
});

describe("step 3B dimensions | logo rules", () => {
  it("64x64 up to 1024x1024 is accepted (any shape inside that range)", () => {
    for (const [w, h] of [[64, 64], [256, 256], [1024, 1024], [200, 64], [64, 900]]) assert.ok(checkImageSize("logo", { width: w, height: h }).ok, `${w}x${h}`);
  });
  it("smaller than 64 or bigger than 1024 on either side is rejected with a clear message", () => {
    for (const [w, h] of [[63, 64], [64, 63], [1, 1], [1025, 1024], [1024, 1025], [4000, 4000]]) {
      const r = checkImageSize("logo", { width: w, height: h });
      assert.equal(r.ok, false, `${w}x${h}`);
      if (!r.ok) assert.match(r.error, /^Logo must be at (least|most) /);
    }
  });
});

describe("step 3B dimensions | banner rules (size + 1.91:1 aspect ratio)", () => {
  it("accepts the standard sizes", () => {
    for (const [w, h] of [[1200, 628], [600, 314], [2400, 1256], [1910, 1000], [1000, 524]]) assert.ok(checkImageSize("banner", { width: w, height: h }).ok, `${w}x${h}`);
  });
  it("the ratio window is 1.91 +- 5 percent", () => {
    assert.ok(Math.abs(BANNER_RATIO_MIN - 1.8145) < 0.001);
    assert.ok(Math.abs(BANNER_RATIO_MAX - 2.0055) < 0.001);
  });
  it("rejects wrong shapes: square, 16:9, 4:3, very wide, portrait", () => {
    for (const [w, h] of [[1000, 1000], [1280, 720], [1200, 900], [2400, 600], [600, 900], [1200, 700], [1200, 580]]) {
      const r = checkImageSize("banner", { width: w, height: h });
      assert.equal(r.ok, false, `${w}x${h}`);
      if (!r.ok) assert.match(r.error, /1\.91:1/);
    }
  });
  it("rejects too small and too big even with the right shape", () => {
    for (const [w, h] of [[599, 314], [300, 157], [2401, 1257], [4000, 2094]]) {
      const r = checkImageSize("banner", { width: w, height: h });
      assert.equal(r.ok, false, `${w}x${h}`);
      if (!r.ok) assert.match(r.error, /at (least|most)/);
    }
  });
  it("checkImageDimensions fails closed when the size cannot be read", () => {
    const r = checkImageDimensions("banner", "image/jpeg", new Uint8Array([0xff, 0xd8, 0xff]));
    assert.equal(r.ok, false);
  });
});

describe("step 3B dimensions | upload check (checkFile) uses the real bytes", () => {
  it("good logo / banner pass", async () => {
    assert.equal((await checkFile("logo", file(makePng(256, 256), "logo.png", "image/png"))).check.ok, true);
    assert.equal((await checkFile("banner", file(makeJpeg(1200, 628), "banner.jpg", "image/jpeg"))).check.ok, true);
    assert.equal((await checkFile("banner", file(makeWebpExtended(1200, 628), "banner.webp", "image/webp"))).check.ok, true);
  });
  it("the file name and browser type cannot lie about the size: a 32 px logo is rejected whatever it is called", async () => {
    const r = await checkFile("logo", file(makePng(32, 32), "big-logo-1024.png", "image/png"));
    assert.equal(r.check.ok, false);
    assert.equal(r.bytes, null, "rejected files are never kept for upload");
  });
  it("a banner with the wrong shape is rejected", async () => {
    const r = await checkFile("banner", file(makePng(1000, 1000), "banner.png", "image/png"));
    assert.equal(r.check.ok, false);
    if (!r.check.ok) assert.match(r.check.error, /1\.91:1/);
  });
  it("the old checks still run first: renamed text / SVG / GIF stay rejected", async () => {
    assert.equal((await checkFile("logo", file(new TextEncoder().encode("hello"), "a.png", "image/png"))).check.ok, false);
    assert.equal((await checkFile("logo", file(new TextEncoder().encode("<svg/>"), "a.svg", "image/svg+xml"))).check.ok, false);
    assert.equal((await checkFile("banner", file(makePng(1200, 628), "a.gif", "image/gif"))).check.ok, false);
  });
});

function form(over: Record<string, string | File | null> = {}): FormData {
  const base: Record<string, string | File | null> = {
    campaignId: CAMP_A, brandName: "Guitar House", headline: "Learn guitar online", body: "Short lessons you can finish in a week.",
    ctaText: "Learn more", destinationUrl: "https://example.com/learn", keywords: "guitar, music",
    logo: file(makePng(256, 256), "logo.png", "image/png"), banner: file(makeJpeg(1200, 628), "banner.jpg", "image/jpeg"),
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...base, ...over })) if (v !== null) fd.set(k, v);
  return fd;
}
async function run(fd: FormData) {
  try {
    return { state: await submitCreative(initialSubmissionState, fd) };
  } catch (e) {
    const m = /^REDIRECT:(.*)$/.exec((e as Error).message);
    if (m) return { redirect: m[1] };
    throw e;
  }
}

describe("step 3B dimensions | the submit action blocks bad dimensions before anything is stored", () => {
  beforeEach(() => fake.reset());

  it("valid dimensions still submit (pending_review)", async () => {
    const out = await run(form());
    assert.ok("redirect" in out, JSON.stringify(out));
    assert.equal(fake.uploads.length, 2);
  });

  for (const [name, over, field] of [
    ["tiny logo", { logo: file(makePng(32, 32), "logo.png", "image/png") }, "logo"],
    ["huge logo", { logo: file(makePng(2000, 2000), "logo.png", "image/png") }, "logo"],
    ["square banner", { banner: file(makeJpeg(900, 900), "banner.jpg", "image/jpeg") }, "banner"],
    ["tiny banner", { banner: file(makeJpeg(300, 157), "banner.jpg", "image/jpeg") }, "banner"],
  ] as const) {
    it(`${name}: field error on ${field}, nothing uploaded, nothing inserted`, async () => {
      const out = await run(form(over));
      const st = "state" in out ? out.state : undefined;
      assert.equal(st?.status, "error");
      assert.ok(st?.fieldErrors?.[field], "has a field error");
      assert.deepEqual(fake.uploads, []);
      assert.equal(fake.dbCalls.filter((c) => c.op === "insert").length, 0);
    });
  }

  it("an advertiser cannot bypass the check by uploading into someone else's folder: ownership rules are unchanged", async () => {
    const out = await run(form({ campaignId: "b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1" }));
    assert.ok("state" in out);
    assert.deepEqual(fake.uploads, []);
    assert.ok(ADV_A);
  });
});
