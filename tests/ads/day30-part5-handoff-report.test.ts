import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Day 30 Part 5: DAY30-MVP-HANDOFF-REPORT.md has the required sections and links, and claims no verification and no
// live integration that was not performed. Reads local files only: no network, no database, no npm, no secrets.

const ROOT = path.join(__dirname, "..", "..", "..");
const DOC = "DAY30-MVP-HANDOFF-REPORT.md";
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const doc = read(DOC);

/** Text of a "## Heading" section, up to the next "## " heading. */
function section(title: string): string {
  const parts = doc.split(/^## /m).slice(1);
  const hit = parts.find((p) => p.split("\n")[0].trim() === title);
  assert.ok(hit, `section missing: ${title}`);
  return hit.split("\n").slice(1).join("\n");
}

const SENTENCES = doc
  .split(/\n|(?<=[.!?])\s+/)
  .map((s) => s.trim())
  .filter(Boolean);
const NEGATION = /\b(not|no|nor|never|none|nothing|without|neither|cannot|unset|off)\b/i;
const NEG_OR_PENDING = new RegExp(NEGATION.source + "|\\b(pending|until|before|if|must|unless|only|separate|still|to be|whether|record|recorded|different|need|needs)\\b", "i");

const REQUIRED_LINKS = [
  "DAY28-VERIFICATION-GUIDE.md",
  "DAY29-PART5-COMPLETION-REPORT.md",
  "MVP-FEATURE-STATUS.md",
  "MVP-PILOT-SAFETY-CHECKLIST.md",
  "PUBLISHER-PILOT-ONBOARDING.md",
  "MVP-VERIFICATION-RUNBOOK.md",
];

describe("day 30 part 5: required sections", () => {
  it("has the title and every section with content", () => {
    assert.match(doc, /^# Day 30 MVP Handoff Report: Blisscco Online Ad Network/m);
    for (const s of [
      "1. MVP scope",
      "2. Related documents",
      "3. Implemented but not verified",
      "4. Not integrated",
      "5. Known limitations",
      "6. Before first real pilot",
      "7. What was not changed",
    ]) {
      assert.ok(section(s).trim().length > 60, s);
    }
  });

  it("says up front that it is documentation only and that nothing was run", () => {
    assert.match(doc, /This is documentation only/);
    assert.match(doc, /Nothing was run to write it/);
    assert.match(doc, /does not mean tested, working in a deployed environment, or ready for production/);
  });

  it("the MVP scope covers advertiser, publisher, matching, tracking, dashboard, ledger and the optional fallback", () => {
    const s = section("1. MVP scope");
    for (const w of ["Advertiser", "Publisher", "Contextual matching", "Tracking", "Dashboard", "Ledger and payouts", "Optional Revive fallback"]) {
      assert.match(s, new RegExp(`^\\| ${w} \\|`, "m"), w);
    }
    const rows = s.split("\n").filter((l) => /^\| (Advertiser|Publisher|Contextual matching|Tracking|Dashboard|Ledger and payouts|Optional Revive fallback) \|/.test(l));
    assert.equal(rows.length, 7);
    for (const r of rows) assert.match(r, /\| Implemented, not verified \|$/, r);
    assert.match(s, /Not part of the MVP: .*third-party chatbot platform/);
  });
});

describe("day 30 part 5: linked documents", () => {
  const s = section("2. Related documents");

  it("links all six required documents, and each target exists", () => {
    for (const f of REQUIRED_LINKS) {
      assert.ok(s.includes(`[${f}](${f})`), `link missing: ${f}`);
      assert.ok(existsSync(path.join(ROOT, f)), `file missing: ${f}`);
    }
  });

  it("every markdown link in the report points to an existing file", () => {
    const targets = [...doc.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
    assert.ok(targets.length >= 7);
    for (const t of new Set(targets)) {
      assert.doesNotMatch(t, /^[a-z]+:\/\//i, `external link: ${t}`);
      assert.ok(existsSync(path.join(ROOT, t)), t);
    }
  });
});

describe("day 30 part 5: implemented but not verified", () => {
  const s = section("3. Implemented but not verified");

  it("states explicitly that none of the eight checks was performed", () => {
    assert.match(
      doc,
      /No fresh tests, lint, ESLint, build, GitHub CI, real PostgreSQL, Preview deployment or real Revive endpoint check was performed/,
    );
    assert.match(doc, /No `npm install`, database check or live endpoint check was performed either/);
    assert.match(doc, /No service was contacted/);
  });

  it("lists every check as not performed", () => {
    for (const w of [
      /Fresh tests \(`npm test`\)/,
      /Type check \(`npm run lint`\)/,
      /ESLint \(`npm run lint:eslint`\)/,
      /Build \(`npm run build`\)/,
      /GitHub CI: no run was started or read/,
      /Real PostgreSQL: no TEST database and no other database was contacted/,
      /Preview deployment: none was contacted/,
      /Real Revive endpoint: none was contacted/,
    ]) assert.match(s, w, String(w));
    assert.match(s, /no result is claimed for any of them/);
  });

  it("admits that tests may need fixes, that mistakes may exist and that no defect list or SQL state exists", () => {
    assert.match(s, /written but not executed/);
    assert.match(s, /may contain mistakes that only a run will show/);
    assert.match(s, /does not say which SQL files are applied to any database/);
    assert.match(s, /No defect list exists, because nothing was run/);
  });
});

describe("day 30 part 5: not integrated and known limitations", () => {
  it("says what is not integrated", () => {
    const s = section("4. Not integrated");
    assert.match(s, /real Revive endpoint/);
    assert.match(s, /not proof of a live Revive integration/);
    assert.match(s, /A Revive ad is not charged, has no tracking and earns the publisher nothing/);
    assert.match(s, /payment provider/);
    assert.match(s, /Blisscco has no integration with any of them, and none has been tested/);
    assert.match(s, /ChatGPT or any other third-party chatbot/);
  });

  it("repeats the limitations a pilot publisher must know, and they match the guide", () => {
    const s = section("5. Known limitations");
    const guide = read("app/dashboard/publisher/guide/page.tsx").replace(/\s+/g, " ");
    for (const [g, d] of [
      [/Not ready for production use/, /not ready for production use/],
      [/No staging environment is published/, /No staging environment is published/],
      [/The contract can still change/, /the contract can still change/],
      [/this guide does not promise ad fill or earnings/, /Ad fill and earnings are not promised/],
    ] as const) {
      assert.match(guide, g, String(g));
      assert.match(s, d, String(d));
    }
    assert.match(s, /Revive fallback and the Revive JSON preview stay off/);
  });
});

describe("day 30 part 5: before first real pilot", () => {
  const s = section("6. Before first real pilot");
  const blocks = s.split(/^### /m).slice(1);
  const block = (title: string) => {
    const hit = blocks.find((b) => b.split("\n")[0].trim() === title);
    assert.ok(hit, `subsection missing: ${title}`);
    return hit;
  };

  it("is a real checklist: every box is empty and none is ticked", () => {
    assert.doesNotMatch(doc, /^\s*- \[[xX]\]/m);
    assert.ok((s.match(/^- \[ \] /gm) ?? []).length >= 15);
    assert.match(s, /All boxes start empty/);
    assert.match(s, /This report confirms none of them/);
  });

  it("requires completing verification, in the runbook's order, with skipped steps recorded as not run", () => {
    const b = block("Complete verification");
    assert.match(b, /MVP-VERIFICATION-RUNBOOK\.md/);
    assert.match(b, /install, type check, tests, ESLint, build, GitHub CI and the separate TEST PostgreSQL run/);
    assert.match(b, /manual Preview checks/);
    assert.match(b, /recorded as not run, and none is counted as a success/);
  });

  it("requires reviewing remaining defects", () => {
    const b = block("Review remaining defects");
    assert.match(b, /Every failure from the verification runs is written down/);
    assert.match(b, /fixed and the failing step is run again, or it is consciously accepted in writing/);
    assert.match(b, /ledger, payouts, budgets or the sponsored-ad label/);
  });

  it("requires confirming secrets are server-side", () => {
    const b = block("Confirm secrets are server-side");
    for (const w of [/`SUPABASE_SECRET_KEY`/, /`AD_TRACKING_SECRET`/, /no `NEXT_PUBLIC_` prefix/, /`BLISSCCO_PUBLISHER_API_KEY`/, /never in browser code/, /built client bundle/, /different projects/, /revoked/]) {
      assert.match(b, w, String(w));
    }
  });

  it("requires the pilot publisher to understand the current limitations", () => {
    const b = block("Confirm the pilot publisher understands the limitations");
    for (const w of [/PUBLISHER-PILOT-ONBOARDING\.md/, /no integration with ChatGPT or any other third-party chatbot platform/, /not ready for production use/, /contract can still change/, /fill and earnings are not promised/, /payouts are manual/, /Sponsored label/, /only a topic/, /no-fill/]) {
      assert.match(b, w, String(w));
    }
  });

  it("keeps the safety checklist and the Revive flags off as gates", () => {
    const b = block("Other gates");
    assert.match(b, /MVP-PILOT-SAFETY-CHECKLIST\.md/);
    assert.match(b, /`REVIVE_FALLBACK_ENABLED` and `REVIVE_JSON_PREVIEW_ENABLED` are unset/);
    assert.doesNotMatch(doc, /REVIVE_[A-Z_]+\s*[=:]\s*"?true/i);
  });
});

describe("day 30 part 5: no verification and no live integration is claimed", () => {
  it("makes no pass, success, build or CI claim", () => {
    for (const re of [
      /\b\d+\s+(tests?\s+)?(pass|passed|passing)\b/i,
      /\b(all|every) (tests?|checks?|suites?|commands?) (pass|passed|are passing|are green)\b/i,
      /\b(lint|eslint|build|ci)\b[^.\n]{0,20}\b(passed|succeeded|is green|was green)\b/i,
      /\bexit (code )?0\b/i,
      /\bno (defects?|bugs?|failures?) (found|remain)/i,
      /\b(ran|completed|finished) successfully\b/i,
    ]) assert.doesNotMatch(doc, re, String(re));
  });

  it("every sentence that says verified, confirmed, passed, succeeded or green is a negation, a requirement or an empty box", () => {
    const OK = new RegExp(NEGATION.source + "|\\b(until|if|when|before|only|must|unless|to be|is run again|is recorded|are run|is run)\\b|^- \\[ \\] ", "i");
    for (const x of SENTENCES) if (/\b(verified|confirmed|passed|passing|succeeded|green)\b/i.test(x)) assert.match(x, OK, x);
  });

  it("every sentence that says something is working, live, connected, integrated, compatible, certified or deployed is a negation", () => {
    const CLAIM = /\b(is|are|was|were|has been|have been)\s+(now\s+)?(working|live|connected|integrated|compatible|certified|deployed|complete|ready|approved)\b/i;
    for (const x of SENTENCES) if (CLAIM.test(x)) assert.match(x, NEGATION, x);
  });

  it("every sentence that names a live service or chatbot platform is a negation, a pending item or a requirement", () => {
    const NAMES = /\b(Revive|Preview|Production|ChatGPT|third-party|Supabase|Vercel|PostgreSQL|GitHub CI)\b/i;
    let seen = 0;
    for (const x of SENTENCES) {
      if (NAMES.test(x)) {
        seen++;
        assert.match(x, NEG_OR_PENDING, x);
      }
    }
    assert.ok(seen >= 15);
  });

  it("makes no production-readiness, pilot-approval or certification claim without a negation", () => {
    const CLAIM = /\b(production[- ]ready|ready for production|certified|guaranteed?|approved for (a )?pilot|pilot (is )?approved|safe to launch|ready to launch)\b/i;
    for (const x of SENTENCES) if (CLAIM.test(x)) assert.match(x, NEGATION, x);
  });
});

describe("day 30 part 5: no credentials, no external addresses, no sharing of secrets", () => {
  const ALLOWED_ENV = ["SUPABASE_SECRET_KEY", "AD_TRACKING_SECRET", "BLISSCCO_PUBLISHER_API_KEY", "REVIVE_FALLBACK_ENABLED", "REVIVE_JSON_PREVIEW_ENABLED"];

  it("every environment-style name is a known one that exists in the repository", () => {
    const names = [...new Set([...doc.matchAll(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g)].map((m) => m[0]))];
    const haystack = [read(".env.example"), read("lib/ads/revive-adapter.ts"), read("lib/ads/revive-json-preview.ts"), read("app/dashboard/publisher/guide/page.tsx")].join("\n");
    for (const n of names) {
      assert.ok(ALLOWED_ENV.includes(n), `unknown environment name: ${n}`);
      assert.ok(haystack.includes(n), `${n} not found in the repository`);
    }
    assert.doesNotMatch(doc, /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\s*=\s*\S/);
  });

  it("holds no live-looking credential, database URL or web address", () => {
    for (const re of [
      /blc_live_[0-9a-f]{8,}/i,
      /\bb[tc]1\.(?!EXAMPLE)[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
      /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
      /\bsb_(secret|publishable)_[A-Za-z0-9_]{6,}/i,
      /\b[0-9a-f]{32,}\b/i,
      /postgres(ql)?:\/\//i,
      /https?:\/\//i,
      /(vercel\.app|supabase\.co)/i,
    ]) assert.doesNotMatch(doc, re, String(re));
  });

  it("every sentence about sharing or printing a credential is a prohibition", () => {
    const VERB = /\b(commit|paste|email|post|share|publish|print|echo|embed|hard-?code|expose)(s|ed|ing)?\b/i;
    const NOUN = /\b(key|secret|token|password|credentials?)\b/i;
    for (const x of SENTENCES) if (VERB.test(x) && NOUN.test(x)) assert.match(x, NEGATION, x);
  });
});

describe("day 30 part 5: nothing else was changed", () => {
  it("states what was not changed", () => {
    const s = section("7. What was not changed");
    assert.match(s, /Application code, ledger, payout and revenue-share behavior, SQL and migration files, Production data, secrets and deployment configuration were not changed/);
    assert.match(s, /No existing report or test was deleted/);
    assert.match(s, /No `\.sh` script was added, so `\.github\/workflows\/ci\.yml` is unchanged/);
  });

  it("the earlier Day 28 to Day 30 documents and tests still exist", () => {
    for (const f of ["DAY28-VERIFICATION-GUIDE.md", "DAY29-PART5-COMPLETION-REPORT.md", "MVP-FEATURE-STATUS.md", "MVP-PILOT-SAFETY-CHECKLIST.md", "tests/ads/day30-part1-feature-status.test.ts", "tests/ads/day30-part2-pilot-safety-doc.test.ts"]) {
      assert.ok(existsSync(path.join(ROOT, f)), f);
    }
  });

  it("the repository still has exactly one .sh script, and ci.yml does not mention the report", () => {
    const sh = readdirSync(path.join(ROOT, "scripts")).filter((f) => f.endsWith(".sh"));
    assert.deepEqual(sh, ["backup-production-db.sh", "day28-verify.sh"]); // backup-production-db.sh: pilot limits + backup task, ci.yml me syntax check
    assert.doesNotMatch(read(".github/workflows/ci.yml"), /DAY30-MVP-HANDOFF-REPORT/);
  });
});
