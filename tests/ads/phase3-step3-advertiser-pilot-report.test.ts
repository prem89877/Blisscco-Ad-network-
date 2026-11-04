import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Phase 3 Step 3: the advertiser pilot report and checklist section 14 keep every unrun check Pending, hold no credential,
// host or full identifier, tick no box and claim no readiness. Reads local files only: no network, no database, no npm, no secrets.
// A passing run shows the documents agree with their own rules. It does not show that any product check passed.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const safety = read("MVP-PILOT-SAFETY-CHECKLIST.md");
const REPORT_FILE = "PHASE3-STEP3-ADVERTISER-PILOT-VERIFICATION-REPORT.md";
const report = read(REPORT_FILE);

function section(doc: string, title: string): string {
  const hit = doc.split(/^## /m).slice(1).find((p) => p.split("\n")[0].trim() === title);
  assert.ok(hit, `section missing: ${title}`);
  return hit.split("\n").slice(1).join("\n");
}

describe("phase 3 step 3: verification record in the safety checklist", () => {
  const s = section(safety, "14. Phase 3 Step 3: advertiser campaign verification record");

  it("has every required field", () => {
    for (const f of [
      "Environment",
      "Advertiser campaign identifier",
      "Campaign eligibility result",
      "Campaign category",
      "Budget cap configuration",
      "Match result",
      "Served creative identifier",
      "Advertiser spend result",
      "Budget-exhaustion behavior",
      "Verification date",
      "Verification status",
    ]) {
      assert.ok(s.includes(`| ${f} |`), f);
    }
  });

  it("keeps unrecorded and unrun items Pending, and the status PARTIAL", () => {
    const id = s.split("\n").find((l) => l.startsWith("| Advertiser campaign identifier |")) ?? "";
    assert.match(id, /Pending/);
    const ex = s.split("\n").find((l) => l.startsWith("| Budget-exhaustion behavior |")) ?? "";
    assert.match(ex, /Pending/);
    const st = s.split("\n").find((l) => l.startsWith("| Verification status |")) ?? "";
    assert.equal((st.match(/PARTIAL/g) ?? []).length, 2);
  });

  it("records at most 8 characters of any identifier and no full identifier", () => {
    assert.doesNotMatch(s, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    assert.doesNotMatch(report, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("ticks no box, keeps the gates NOT CONFIRMED and does not touch sections 1 to 13", () => {
    assert.doesNotMatch(safety, /^\s*- \[[xX]\]/m);
    const rows = safety.split("\n").filter((l) => /^\| (Section \d|Gate [A-D])/.test(l));
    assert.equal(rows.length, 9);
    for (const r of rows) assert.match(r, /\| NOT CONFIRMED \|$/, r);
    assert.match(s, /Sections 1 to 13 are unchanged/);
    assert.match(s, /No real advertiser spending and no public launch/);
  });

  it("keeps the open checks as unticked boxes", () => {
    const boxes = s.split("\n").filter((l) => /^- \[ \]/.test(l));
    assert.ok(boxes.length >= 5);
  });
});

describe("phase 3 step 3: advertiser pilot report", () => {
  it("writes no key, token, host or credential", () => {
    for (const doc of [report, safety]) {
      assert.doesNotMatch(doc, /blc_live_[0-9a-f]{8,}/i);
      assert.doesNotMatch(doc, /\bbt1\.[A-Za-z0-9_-]{6,}/);
      assert.doesNotMatch(doc, /\bbc1\.[A-Za-z0-9_-]{6,}/);
      assert.doesNotMatch(doc, /vercel\.app/i);
    }
  });

  it("states the status as partial, not ready, and no real spending", () => {
    assert.match(report, /\*\*Status: PARTIAL\./);
    assert.match(report, /\*\*Not declared ready\.\*\*/);
    assert.match(report, /NO REAL ADVERTISER SPENDING MAY START/);
    assert.match(report, /Gates A to D in `MVP-PILOT-SAFETY-CHECKLIST\.md` stay NOT CONFIRMED/);
  });

  it("marks the evidence level and keeps concurrency, ownership and the key revoke pending", () => {
    for (const w of ["Seen by Claude", "User-reported", "Read in code"]) assert.ok(report.includes(w), w);
    const p = section(report, "8. Pending");
    for (const w of ["Campaign B identifier", "Other-advertiser access", "Concurrency", "Revoke of the TEST key", "timing tests"]) {
      assert.ok(p.includes(w), w);
    }
    const b = section(report, "4. Budget and spend safety: result");
    assert.match(b, /not tested/);
    assert.doesNotMatch(report, /\bwas revoked\b|\bhas been revoked\b/i);
  });

  it("does not trust the loop count over the server count", () => {
    assert.match(report, /fill=252 nofill=18 rate_limited=0/);
    assert.match(report, /The server and dashboard number is the one recorded/);
    assert.match(report, /not confirmed/);
  });

  it("states that no product code or product test was changed", () => {
    const c = section(report, "6. Code and test changes");
    assert.match(c, /did not change them/);
    assert.match(c, /No Step 3 product code or product test was changed/);
  });

  it("names only real files", () => {
    for (const f of [
      "MVP-PILOT-SAFETY-CHECKLIST.md",
      "PHASE3-STEP2-FIRST-SERVE-VERIFICATION-REPORT.md",
      "tests/ads/phase3-step3-advertiser-pilot-report.test.ts",
      "lib/campaigns/delivery.ts",
      "lib/campaigns/money.ts",
      "lib/campaigns/budget-rules.ts",
      "supabase/sql/day-12-5-serve-ref-return.sql",
      "tests/integration/day9-part5-db.test.ts",
    ]) {
      assert.ok(report.includes("`" + f + "`"), f);
      assert.ok(existsSync(path.join(ROOT, f)), f);
    }
  });
});
