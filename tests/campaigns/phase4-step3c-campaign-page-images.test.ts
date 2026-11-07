import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ASSET_LIMITS, BANNER_MAX_BYTES, LOGO_MAX_BYTES } from "@/lib/campaigns/creative-assets";

// Phase 4 Step 3C: campaign page ke "Add an ad" form me logo + ad image upload, aur nayi size limits (logo 2 MB, ad image 4 MB).
// Static source checks + limit constants. Asli upload TEST database par manually check hota hai.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

describe("phase 4 step 3c | image size limits", () => {
  it("logo is 2 MB and ad image is 4 MB", () => {
    assert.equal(LOGO_MAX_BYTES, 2 * 1024 * 1024);
    assert.equal(BANNER_MAX_BYTES, 4 * 1024 * 1024);
    assert.equal(ASSET_LIMITS.logo.maxBytes, LOGO_MAX_BYTES);
    assert.equal(ASSET_LIMITS.banner.maxBytes, BANNER_MAX_BYTES);
  });
  it("server action body limit fits logo + ad image together (8 MB > 2 + 4 MB)", () => {
    assert.match(read("next.config.mjs"), /bodySizeLimit:\s*"8mb"/);
  });
  it("a migration raises the bucket limit for databases that already ran phase4-step3-1", () => {
    const sql = read("supabase/sql/phase4-step3c-1-raise-image-limits.sql");
    assert.match(sql, /file_size_limit\s*=\s*4194304/);
    assert.match(sql, /id\s*=\s*'creative-assets'/);
    assert.doesNotMatch(sql, /drop |truncate|delete from/i);
  });
});

describe("phase 4 step 3c | campaign page 'Add an ad' form has image upload", () => {
  const form = read("components/campaigns/CreativeForm.tsx");
  it("form is multipart and has optional logo and ad image file inputs", () => {
    assert.match(form, /encType="multipart\/form-data"/);
    assert.match(form, /name="logo"/);
    assert.match(form, /name="banner"/);
    assert.match(form, /accept="image\/png,image\/jpeg,image\/webp"/);
  });
  it("action checks the real file on the server and cleans up uploads if the insert fails", () => {
    const src = read("app/dashboard/advertiser/campaigns/creative-actions.ts");
    assert.match(src, /checkFile\(kind, pick\.file\)/);
    assert.match(src, /storage\.from\(ASSET_BUCKET\)\.upload\(/);
    assert.match(src, /logo_path: uploaded\.logo/);
    assert.match(src, /banner_path: uploaded\.banner/);
    assert.ok(src.indexOf("removeQuietly(supabase.storage, uploadedPaths(uploaded));\n    return { status: \"error\", message: mapDbError(error)") > 0);
  });
});
