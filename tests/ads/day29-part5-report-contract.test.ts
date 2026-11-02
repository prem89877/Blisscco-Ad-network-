import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Day 29 Part 5: the completion report has the required sections and keeps implementation apart from verification.
// Reads local files only: no network, no database, no npm, no secrets.

const ROOT = path.join(__dirname, "..", "..", "..");
const REPORT = "DAY29-PART5-COMPLETION-REPORT.md";
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const report = read(REPORT);

/** Text of a "## Heading" section, up to the next "## " heading. */
function section(title: string): string {
  const parts = report.split(/^## /m).slice(1);
  const hit = parts.find((p) => p.split("\n")[0].trim() === title);
  assert.ok(hit, `section missing: ${title}`);
  return hit.split("\n").slice(1).join("\n");
}

describe("day 29 part 5: report structure", () => {
  it("has every required section", () => {
    for (const s of [
      "Changed paths",
      "What was implemented",
      "Verification pending",
      "Real integrations pending",
      "Not changed",
      "Limits of this report",
    ]) {
      assert.ok(section(s).trim().length > 40, s);
    }
    assert.match(report, /^# Day 29 Part 5 — Completion Report/m);
  });

  it("summarises the four Day 29 parts", () => {
    const s = section("What was implemented");
    assert.match(s, /\*\*Part 1 — Publisher quick-start\.\*\*/);
    assert.match(s, /\*\*Part 2 — Publisher setup guidance\.\*\*/);
    assert.match(s, /\*\*Part 3 — Advertiser launch guidance\.\*\*/);
    assert.match(s, /\*\*Part 4 — Trust and privacy pages\.\*\*/);
  });
});

describe("day 29 part 5: changed paths are real and honest", () => {
  const paths = [...report.matchAll(/`((?:app|components|lib|tests|examples|supabase)\/[^`\s,]+|DAY29-PART5-COMPLETION-REPORT\.md)`/g)].map((m) => m[1]);

  it("every path named in the report exists in the project", () => {
    assert.ok(paths.length >= 18, `only ${paths.length} paths found`);
    for (const p of new Set(paths)) assert.ok(existsSync(path.join(ROOT, p)), p);
  });

  it("lists the files of each Day 29 part", () => {
    for (const p of [
      "app/dashboard/publisher/guide/page.tsx",
      "components/dashboard/IntegrationSteps.tsx",
      "tests/publisher/day29-part1-quick-start.test.ts",
      "lib/publisher/setup-guidance.ts",
      "app/dashboard/publisher/page.tsx",
      "tests/dashboard/day29-part2-publisher-setup.test.ts",
      "app/dashboard/advertiser/campaigns/new/page.tsx",
      "components/dashboard/CreateCampaignForm.tsx",
      "components/campaigns/DeliveryNote.tsx",
      "app/dashboard/advertiser/campaigns/[id]/page.tsx",
      "tests/campaigns/day29-part3-launch-guidance.test.ts",
      "app/privacy/page.tsx",
      "app/terms/page.tsx",
      "tests/landing/day29-part4-trust-pages.test.ts",
      "tests/ads/day29-part5-report-contract.test.ts",
      REPORT,
    ]) assert.ok(paths.includes(p), `report does not list ${p}`);
  });

  it("files marked Confirmed really carry a Day 29 marker or belong to Part 3 or 4", () => {
    const rows = report.split("\n").filter((l) => /^\| [1-4] \|/.test(l) && /\| Confirmed/.test(l));
    assert.ok(rows.length >= 12);
    for (const row of rows) {
      const part = Number(row.charAt(2));
      for (const m of row.matchAll(/`([^`]+)`/g)) {
        const f = m[1];
        if (!f.includes("/")) continue; // a bare word in backticks (e.g. `setup-guidance`) is a module name in prose, not a file path
        if (part >= 3 || f.startsWith("tests/")) continue; // Part 3/4 files are checked by their own tests; tests carry the name
        assert.match(read(f), /Day 29 Part [12]|setup-guidance/, `${f} has no Day 29 Part ${part} marker`);
      }
    }
  });

  it("unconfirmed files are labelled as test-referenced, not as changed", () => {
    assert.match(report, /Test-referenced/);
    assert.match(report, /the upload has no change history/i);
  });

  it("Part 5 itself adds only the report and this test, and no .sh file or workflow change", () => {
    const s = section("Changed paths");
    assert.match(s, /No source, SQL, migration, config, env, workflow or package file changed/);
    assert.match(s, /No `\.sh` script was added, so `\.github\/workflows\/ci\.yml` is unchanged/);
  });
});

describe("day 29 part 5: verification is pending, never claimed", () => {
  const v = section("Verification pending");

  it("names each check that was not run", () => {
    assert.match(v, /None of the following has been run as part of this task/);
    for (const what of [/Tests \(`npm test`\)/, /`npm run lint`/, /ESLint/, /Production build/, /GitHub CI/, /Real PostgreSQL checks/]) {
      assert.match(v, what, String(what));
    }
    assert.match(v, /scheduled all verification after MVP completion/);
    assert.match(v, /implemented, not verified/);
  });

  it("claims no result anywhere in the report", () => {
    const CLAIMS: [RegExp, string][] = [
      [/\b\d+\s+(tests?\s+)?(pass|passed|passing)\b/i, "pass count"],
      [/\b(all|every) (tests?|checks?|suites?) (pass|passed|are passing|are green|green)\b/i, "all pass"],
      [/\b(lint|eslint|build|ci|type check)\b[^.\n]{0,20}\b(passed|succeeded|is green|was green|ok)\b/i, "tool passed"],
      [/\bexit (code )?0\b/i, "exit code"],
      [/\b(verified|confirmed) (against|on|with|by) (a |the )?(real|live|production|preview|test) (database|postgres|endpoint|deployment|revive)/i, "live verification"],
      [/\bno (defects?|bugs?|failures?) (found|remain)/i, "no-defect claim"],
    ];
    for (const [re, label] of CLAIMS) assert.doesNotMatch(report, re, label);
  });

  it("has no results table (suite counts) like a run report would", () => {
    assert.doesNotMatch(report, /\|\s*Tests\s*\|\s*Pass\s*\|\s*Fail/i);
    assert.doesNotMatch(report, /\|\s*Suite\s*\|/i);
  });
});

describe("day 29 part 5: real integrations are pending, none implied", () => {
  const r = section("Real integrations pending");

  it("says explicitly that Revive, Preview and Production were not contacted", () => {
    assert.match(r, /Revive endpoint contacted: \*\*NO\*\*/);
    assert.match(r, /Preview deployment contacted: \*\*NO\*\*/);
    assert.match(r, /Production service contacted: \*\*NO\*\*/);
    assert.match(r, /No live integration is implied/);
    assert.doesNotMatch(r, /contacted:\s*\*{0,2}yes/i);
  });

  it("makes no live Revive, Preview or Production claim anywhere in the report", () => {
    assert.doesNotMatch(report, /\b(live|real|production) (revive )?(integration|endpoint) (is|was|has been) (working|verified|connected|complete|enabled)/i);
    assert.doesNotMatch(report, /revive[^.\n]{0,40}\b(compatible|certified|connected|live)\b(?![^.\n]*\b(not|no|nor)\b)/i);
  });

  it("the guide, privacy and terms pages carry no live Revive compatibility claim (Part 4 promise still holds)", () => {
    for (const f of ["app/privacy/page.tsx", "app/terms/page.tsx"]) assert.doesNotMatch(read(f), /revive/i, f);
  });
});

describe("day 29 part 5: scope and safety", () => {
  it("states that money, SQL, auth, schema and deployment behavior were not changed", () => {
    const n = section("Not changed");
    for (const w of [/SQL and migration files/, /Production data/, /ledger/, /payout/, /revenue-share/, /real ad-spend/, /authentication/, /database schema/, /deployment/]) {
      assert.match(n, w, String(w));
    }
  });

  it("contains no secret-like value", () => {
    for (const re of [
      /blc_live_[0-9a-f]{16,}/i,
      /\bb[tc]1\.(?!EXAMPLE)[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
      /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
      /\bsb_(secret|publishable)_[A-Za-z0-9_]{6,}/i,
      /\b[0-9a-f]{32,}\b/i,
      /postgres(ql)?:\/\/[^\s`]+:[^\s`@]+@/i,
      /\bhttps?:\/\/[^\s`)]*(supabase\.co|vercel\.app)/i,
    ]) assert.doesNotMatch(report, re, String(re));
  });

  it("this part touches no SQL: the migration list is unchanged by name and no SQL file is named in the report", () => {
    assert.doesNotMatch(report, /`[^`]*\.sql`/);
    assert.ok(existsSync(path.join(ROOT, "supabase/sql/day-12-2-ad-events.sql")));
  });
});
