import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Phase 3 Step 2: the first-serve report and checklist section 13 keep every unrun check Pending, hold no credential or
// host, tick no box and claim no readiness. Reads local files only: no network, no database, no npm, no secrets.
// A passing run shows the documents agree with their own rules. It does not show that any product check passed.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const safety = read("MVP-PILOT-SAFETY-CHECKLIST.md");
const report = read("PHASE3-STEP2-FIRST-SERVE-VERIFICATION-REPORT.md");

function section(doc: string, title: string): string {
  const hit = doc.split(/^## /m).slice(1).find((p) => p.split("\n")[0].trim() === title);
  assert.ok(hit, `section missing: ${title}`);
  return hit.split("\n").slice(1).join("\n");
}

describe("phase 3 step 2: evidence record in the safety checklist", () => {
  const s = section(safety, "13. Phase 3 Step 2: first controlled serve evidence");

  it("has every required field", () => {
    for (const f of [
      "Environment name",
      "Publisher integration type",
      "Date and time (UTC)",
      "Match response",
      "Ad rendering result",
      "Sponsored disclosure visible or not",
      "Impression response",
      "Click redirect behavior",
      "API latency",
      "Failure behavior",
      "Verification status",
    ]) {
      assert.ok(s.includes(`| ${f} |`), f);
    }
  });

  it("keeps unrun checks Pending and records no latency number", () => {
    for (const f of ["Ad rendering result", "Sponsored disclosure visible or not", "Impression response", "Click redirect behavior", "API latency", "Failure behavior"]) {
      const row = s.split("\n").find((l) => l.startsWith(`| ${f} |`)) ?? "";
      assert.match(row, /Pending/, f);
    }
    const latency = s.split("\n").find((l) => l.startsWith("| API latency |")) ?? "";
    assert.doesNotMatch(latency, /\d\s*(ms|s)\b/i);
    assert.match(s, /Verification status \| PARTIAL/);
  });

  it("ticks no box, keeps the gates NOT CONFIRMED and does not touch sections 1 to 12", () => {
    assert.doesNotMatch(safety, /^\s*- \[[xX]\]/m);
    const rows = safety.split("\n").filter((l) => /^\| (Section \d|Gate [A-D])/.test(l));
    assert.equal(rows.length, 9);
    for (const r of rows) assert.match(r, /\| NOT CONFIRMED \|$/, r);
    assert.match(safety, /Sections 1 to 12 are unchanged/);
  });

  it("does not approve a pilot or declare the API ready", () => {
    assert.match(s, /does not approve a pilot/);
    assert.match(s, /does not declare the publisher API ready for production use/);
  });
});

describe("phase 3 step 2: first-serve report", () => {
  it("writes no key, token, host or destination", () => {
    for (const doc of [report, safety]) {
      assert.doesNotMatch(doc, /blc_live_[0-9a-f]{8,}/i);
      assert.doesNotMatch(doc, /\bbt1\.[A-Za-z0-9_-]{6,}/);
      assert.doesNotMatch(doc, /\bbc1\.[A-Za-z0-9_-]{6,}/);
      assert.doesNotMatch(doc, /vercel\.app/i);
    }
  });

  it("states the status as partial and not ready", () => {
    assert.match(report, /\*\*Status: PARTIAL\./);
    assert.match(report, /\*\*Not declared ready\.\*\*/);
    assert.match(report, /Gates A to D in `MVP-PILOT-SAFETY-CHECKLIST\.md` stay NOT CONFIRMED/);
    assert.match(report, /REAL PUBLISHER TRAFFIC MAY NOT START/);
  });

  it("keeps the unrun checks pending and the three failing tests open", () => {
    const p = section(report, "4. Not run in this pass (Pending)");
    for (const w of ["Latency", "Impression", "Click redirect", "429", "Revoke"]) assert.ok(p.includes(w), w);
    const t = section(report, "5. Tests");
    for (const f of ["day12-prompt5-part4-adapter", "day22-part1-revive-boundary", "day22-part3-fallback-routing"]) assert.ok(t.includes(f), f);
    assert.match(t, /failing and open/);
    assert.match(report, /not an API latency value/);
  });

  it("keeps the key revoke pending", () => {
    const k = section(report, "7. Credential exposure");
    assert.match(k, /pending/);
    assert.doesNotMatch(k, /\bwas revoked\b|\bhas been revoked\b/i);
  });

  it("names only real files", () => {
    for (const f of ["MVP-PILOT-SAFETY-CHECKLIST.md", "PHASE3-STEP1-PILOT-PREPARATION-REPORT.md", "tests/ads/phase3-step2-first-serve-report.test.ts"]) {
      assert.ok(report.includes("`" + f + "`"), f);
      assert.ok(existsSync(path.join(ROOT, f)), f);
    }
  });
});
