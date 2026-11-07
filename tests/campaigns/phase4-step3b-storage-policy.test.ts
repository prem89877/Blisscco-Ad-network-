import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// Regression: the upload (INSERT) policy of the private creative-assets bucket must name the storage object's path as objects.name.
// Inside `exists (select ... from public.campaigns c ...)` a bare `name` means campaigns.name, the folder check never matches,
// and every advertiser upload is denied ("[creatives] upload failed"). Found on the TEST database; the policy text is checked here.
const sql = readFileSync(path.join(__dirname, "..", "..", "..", "supabase/sql/phase4-step3-1-creative-submission.sql"), "utf8");

describe("step 3 storage policy | creative_assets_insert_own", () => {
  const start = sql.indexOf("create policy creative_assets_insert_own");
  const policy = sql.slice(start, sql.indexOf(");", start) + 2).split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("both folder checks use the qualified objects.name", () => {
    assert.ok(start > 0);
    assert.equal((policy.match(/storage\.foldername\(objects\.name\)/g) ?? []).length, 2);
    assert.doesNotMatch(policy, /storage\.foldername\(name\)/);
  });
  it("still limited to the active advertiser, own campaign, not archived / completed, authenticated only", () => {
    assert.match(policy, /for insert to authenticated/);
    assert.match(policy, /\(storage\.foldername\(objects\.name\)\)\[1\] = \(select private\.my_active_advertiser_id\(\)\)::text/);
    assert.match(policy, /c\.advertiser_id = \(select private\.my_active_advertiser_id\(\)\)/);
    assert.match(policy, /c\.status not in \('archived', 'completed'\)/);
  });
});
