import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Phase 2 Step 5: PHASE2-STABILIZATION-EXIT-REPORT.md keeps a fixed vocabulary for statuses, cites a real file as
// evidence for every area, gives one decision that agrees with its own criteria and blockers, and does not
// contradict MVP-FEATURE-STATUS.md or MVP-VERIFICATION-RUNBOOK.md. Reads local files only: no network, no database,
// no npm, no secrets. A passing run of this file shows the report is consistent. It does not show that any
// product check passed.

const ROOT = path.join(__dirname, "..", "..", "..");
const REPORT = "PHASE2-STABILIZATION-EXIT-REPORT.md";
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const doc = read(REPORT);
const status = read("MVP-FEATURE-STATUS.md");
const runbook = read("MVP-VERIFICATION-RUNBOOK.md");

const TITLES = [
  "1. Decision",
  "2. Scope and safety",
  "3. Verification areas",
  "4. Critical stabilization criteria",
  "5. Automated test results",
  "6. Manual Preview results",
  "7. User-confirmed results",
  "8. Blockers",
  "9. Remaining work",
  "10. What changed in Step 5",
  "11. Safety statement",
];

/** Text of a "## Heading" section, up to the next "## " heading. */
function section(title: string): string {
  const parts = doc.split(/^## /m).slice(1);
  const hit = parts.find((p) => p.split("\n")[0].trim() === title);
  assert.ok(hit, `section missing: ${title}`);
  return hit.split("\n").slice(1).join("\n");
}

function tableRows(title: string): string[][] {
  return section(title)
    .split("\n")
    .filter((l) => /^\|/.test(l) && !/^\|[-| ]+\|$/.test(l))
    .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()))
    .slice(1); // drop the header row
}

const DECISIONS = ["READY FOR CONTROLLED PILOT", "NOT READY — BLOCKERS REMAIN", "REVIEW INCOMPLETE"];
const decisionMatch = [...doc.matchAll(/^\*\*Decision: (.+)\*\*$/gm)];
const decision = decisionMatch[0]?.[1] ?? "";
const areas = tableRows("3. Verification areas");

describe("phase 2 step 5 exit report: structure", () => {
  it("has the title and every section in order", () => {
    assert.match(doc, /^# Phase 2 Step 5: Stabilization Exit Report/m);
    let last = -1;
    for (const t of TITLES) {
      const at = doc.indexOf(`\n## ${t}\n`);
      assert.ok(at > last, `section missing or out of order: ${t}`);
      last = at;
    }
  });

  it("has no unfilled placeholder", () => {
    assert.doesNotMatch(doc, /@@|TODO|TBD|FIXME|\bXXX\b/);
  });

  it("keeps automated, manual Preview and user-confirmed results in three separate sections", () => {
    assert.match(section("5. Automated test results"), /Automated/);
    assert.match(section("6. Manual Preview results"), /Preview/);
    assert.match(section("7. User-confirmed results"), /user's word/i);
    // no row of the Automated section carries a Preview or user-confirmed label
    assert.doesNotMatch(section("5. Automated test results"), /User-confirmed/);
  });
});

describe("phase 2 step 5 exit report: decision", () => {
  it("has exactly one decision and it is one of the three allowed values", () => {
    assert.equal(decisionMatch.length, 1);
    assert.ok(DECISIONS.includes(decision), decision);
    // the decision line sits in the header, before the first section
    assert.ok(doc.indexOf("**Decision: ") < doc.indexOf("\n## 1. Decision\n"));
  });

  it("the decision agrees with the criteria, the critical rows and the blockers", () => {
    const criteria = section("4. Critical stabilization criteria")
      .split("\n")
      .filter((l) => /^\| C\d /.test(l));
    assert.equal(criteria.length, 5, "five criteria");
    const notMet = criteria.filter((l) => /\| Not met\b/.test(l));
    const criticalOpen = areas.filter((r) => /\(critical\)/.test(r[1]) && /^(Pending|Failed)/.test(r[2]));
    const blockers = section("8. Blockers");
    if (decision === "READY FOR CONTROLLED PILOT") {
      assert.equal(notMet.length, 0, "ready, but a criterion is not met");
      assert.equal(criticalOpen.length, 0, "ready, but a critical area is pending or failed");
      assert.match(blockers, /None/);
    } else if (decision === "NOT READY — BLOCKERS REMAIN") {
      assert.ok(notMet.length + criticalOpen.length >= 1, "not ready, but nothing is open");
      assert.match(blockers, /\bB1\b/);
    } else {
      assert.match(section("9. Remaining work"), /\S/);
    }
  });

  it("does not claim pilot readiness unless it is the decision", () => {
    if (decision !== "READY FOR CONTROLLED PILOT") {
      for (const l of doc.split("\n").filter((x) => /READY FOR CONTROLLED PILOT/.test(x))) {
        assert.match(l, /not chosen/i, l);
      }
    }
  });

  it("states whether the exit criteria are met", () => {
    assert.match(section("1. Decision"), /exit criteria (are|are not) met/i);
  });
});

describe("phase 2 step 5 exit report: verification areas", () => {
  it("has areas, each with a number, a status word from the fixed set and a named evidence file that exists", () => {
    assert.ok(areas.length >= 20, `only ${areas.length} areas`);
    for (const r of areas) {
      assert.equal(r.length, 4, r.join(" | "));
      assert.match(r[2], /^(Passed|Failed|Pending|User-confirmed)\b/, `status of: ${r[1]}`);
      const paths = [...r[3].matchAll(/`([^`\s]+)`/g)].map((m) => m[1]);
      assert.ok(paths.length >= 1, `no evidence file for: ${r[1]}`);
      for (const p of paths) assert.ok(existsSync(path.join(ROOT, p)), `${p} (area: ${r[1]})`);
    }
  });

  it("a Passed row gives a count of the form N of N, and a Failed row gives the failing count", () => {
    for (const r of areas.filter((x) => /^Passed/.test(x[2]))) {
      const m = r[2].match(/(\d+) of (\d+)/);
      assert.ok(m, `Passed without a count: ${r[1]}`);
      assert.equal(m![1], m![2], `Passed, but not all tests passed: ${r[1]}`);
    }
    for (const r of areas.filter((x) => /^Failed/.test(x[2]))) assert.match(r[2], /\d+ of \d+/, r[1]);
  });

  it("a Pending row gives its reason", () => {
    for (const r of areas.filter((x) => /^Pending/.test(x[2]))) assert.match(r[2], /Reason: \S/, r[1]);
  });

  it("a User-confirmed row says it rests on the user's word", () => {
    for (const r of areas.filter((x) => /^User-confirmed/.test(x[2]))) assert.match(r[2], /user's word/i, r[1]);
  });

  it("Revive, payment, Production, cleanup, pilot gates and the campaign page root cause are Pending, never confirmed", () => {
    const need: [RegExp, RegExp][] = [
      [/Controlled Revive test/, /^Pending/],
      [/Revive preview route|Revive fallback wiring|real Revive endpoint/i, /^Pending/],
      [/Payment checkout/, /^Pending/],
      [/Production deployment and data/, /^Pending/],
      [/scheduled cleanup/i, /^Pending/],
      [/Pilot gates/, /^Pending/],
      [/Campaign page root cause/, /^Pending/],
    ];
    for (const [area, st] of need) {
      const row = areas.find((r) => area.test(r[1]));
      assert.ok(row, String(area));
      assert.match(row![2], st, String(area));
    }
  });

  it("the critical rows are marked", () => {
    assert.ok(areas.filter((r) => /\(critical\)/.test(r[1])).length >= 5);
  });
});

describe("phase 2 step 5 exit report: no mismatch with the status documents", () => {
  it("the campaign page root cause is Pending in the report and in the feature status", () => {
    const row = areas.find((r) => /Campaign page root cause/.test(r[1]));
    assert.match(row![2], /^Pending/);
    const line = status.split("\n").find((l) => /^\| Advertiser campaign page error/.test(l));
    assert.ok(line);
    assert.match(line!, /\*\*Pending\*\*/);
    const rb = runbook.split("\n").find((l) => /^\| Advertiser campaign page error/.test(l));
    assert.ok(rb);
    assert.match(rb!, /\*\*Pending\*\*/);
  });

  it("the number of ticked runbook boxes named in the report equals the number in the runbook", () => {
    const ticked = (runbook.match(/^- \[x\] /gm) ?? []).length;
    assert.ok(ticked >= 1);
    assert.match(doc, new RegExp(`\\b${ticked} runbook boxes are ticked`));
  });

  it("the Step 5 user-confirmed rows named in the report exist in both status documents", () => {
    for (const d of [status, runbook]) assert.match(d, /^### Phase 2 Step 5 status/m);
    assert.match(status, /Rerun on Preview: add an ad, then send it for review/);
    assert.match(runbook, /Rerun on Preview: add an ad, then send it for review/);
  });

  it("the status documents keep CI and the TEST database recheck as the user's word only", () => {
    for (const d of [status, runbook]) {
      assert.match(d, /Done \(user's word only\)/);
      for (const l of d.split("\n").filter((x) => /^\|/.test(x) && /GitHub CI|PostgreSQL/.test(x))) {
        assert.doesNotMatch(l, /User-confirmed — completed successfully/, l);
      }
    }
  });

  it("the report names the narrowed runbook-test assertions and says they were requested by the user", () => {
    const s = section("10. What changed in Step 5");
    assert.match(s, /`tests\/ads\/day30-part4-verification-runbook\.test\.ts`/);
    assert.match(s, /requested by the user/i);
    assert.match(s, /7d/);
  });
});

describe("phase 2 step 5 exit report: safety", () => {
  it("contains no secret-shaped value and no web address", () => {
    assert.doesNotMatch(doc, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
    assert.doesNotMatch(doc, /postgres(ql)?:\/\//i);
    assert.doesNotMatch(doc, /sb_secret_[A-Za-z0-9_-]{10,}/);
    assert.doesNotMatch(doc, /blc_live_[0-9a-f]{20,}/);
    assert.doesNotMatch(doc, /https?:\/\//i);
    assert.doesNotMatch(doc, /(vercel\.app|supabase\.co)/i);
  });

  it("the safety statement keeps Production, Revive, spend, ledger and payout untouched", () => {
    const s = section("11. Safety statement");
    for (const w of [/Production/, /Revive/, /ledger/i, /payout/i, /spend/i, /deploy/i, /secret/i]) assert.match(s, w, String(w));
  });

  it("claims no result without a source: no blanket pass or green wording", () => {
    for (const re of [
      /\b(all|every) (tests?|checks?|suites?) (pass|passed|are passing|are green)\b/i,
      /\bno (defects?|bugs?|failures?) (found|remain)/i,
      /\bproduction[- ]ready\b/i,
    ]) assert.doesNotMatch(doc, re, String(re));
  });

  it("every repository path named in backticks exists", () => {
    const paths = [...doc.matchAll(/`((?:app|components|lib|tests|config|scripts|examples)\/[^`\s,]+|\.github\/[^`\s,]+|[A-Z][A-Z0-9-]*\.md|\.nvmrc)`/g)].map((m) => m[1]);
    assert.ok(paths.length >= 12);
    for (const p of new Set(paths)) assert.ok(existsSync(path.join(ROOT, p)), p);
  });
});
