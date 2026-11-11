import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Phase 6 Step 5: final readiness report ka contract. Sirf local files padhta hai: koi network, database, npm, secret ya env nahi.

const ROOT = path.join(__dirname, "..", "..", "..");
const REPORT = "PHASE6-STEP5-FINAL-PILOT-READINESS-REPORT.md";

describe("Phase 6 Step 5 readiness report contract", () => {
  it("report exists at the repo root", () => {
    assert.ok(existsSync(path.join(ROOT, REPORT)), "report file must exist at repo root");
  });

  const content = existsSync(path.join(ROOT, REPORT)) ? readFileSync(path.join(ROOT, REPORT), "utf8") : "";

  it("has all required sections", () => {
    const requiredHeadings = [
      "1. Exact changed file paths",
      "2. Existing implementations verified",
      "3. Tests executed and actual results",
      "4. Security and operational gaps",
      "5. G1–G12 evidence status",
      "6. Publisher readiness",
      "7. Advertiser readiness",
      "8. Manual owner actions",
      "9. Final GO/NO-GO recommendation",
      "10. Confirmations",
    ];
    for (const heading of requiredHeadings) {
      assert.ok(content.includes(`## ${heading}`), `report must include heading: ${heading}`);
    }
  });

  it("evaluates every gate G1 to G12 in its own table row", () => {
    for (let i = 1; i <= 12; i++) {
      assert.ok(content.includes(`| **G${i}** |`), `report must have a table row for gate G${i}`);
    }
  });

  it("never claims unrun tests passed or Production actions done", () => {
    assert.ok(!content.toLowerCase().includes("all tests passed"), "must not contain 'all tests passed'");
    assert.ok(!content.includes("Production SQL executed"), "must not claim Production SQL executed");
    assert.ok(!content.includes("Production deployed"), "must not claim Production deployed");
  });

  it("keeps the recommendation at NO-GO while gates are open", () => {
    assert.match(content, /RECOMMENDATION: NO-GO/);
  });

  it("every concrete tests/*.test.ts path cited in the report exists", () => {
    const cited = new Set<string>();
    for (const m of content.matchAll(/`(tests\/[A-Za-z0-9_\-./]+\.test\.ts)`/g)) cited.add(m[1]);
    assert.ok(cited.size > 0, "report should cite test files");
    for (const f of cited) assert.ok(existsSync(path.join(ROOT, f)), `cited test file does not exist: ${f}`);
  });
});
