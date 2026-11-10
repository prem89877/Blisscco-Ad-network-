import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Day 30 Part 4: MVP-VERIFICATION-RUNBOOK.md documents the verification in the order the repository really uses,
// keeps local, CI, Preview, TEST database and Production apart, and claims no result. Reads local files only:
// no network, no database, no npm, no secrets.

const ROOT = path.join(__dirname, "..", "..", "..");
const DOC = "MVP-VERIFICATION-RUNBOOK.md";
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const doc = read(DOC);
const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

/** Text of a "## Heading" section, up to the next "## " heading. */
function section(title: string): string {
  const parts = doc.split(/^## /m).slice(1);
  const hit = parts.find((p) => p.split("\n")[0].trim() === title);
  assert.ok(hit, `section missing: ${title}`);
  return hit.split("\n").slice(1).join("\n");
}

const prose = doc.replace(/```[\s\S]*?```/g, "");
const SENTENCES = prose
  .split(/\n|(?<=[.!?])\s+/)
  .map((s) => s.trim())
  .filter(Boolean);
// Phase 2: the only allowed positive wording. A status-table row for a check the user personally completed and
// confirmed, in exactly this shape. Everything else (scripts, CI, build, database, any other row) stays strict.
const USER_CONFIRMED_ROW = /^\| [^|\n]+ \| [^|\n]+ \| \*\*User-confirmed — completed successfully\*\*( \(scope as reported\))? \|$/;
const claimDoc = doc.split("\n").filter((l) => !USER_CONFIRMED_ROW.test(l)).join("\n");
const claimSentences = SENTENCES.filter((x) => !USER_CONFIRMED_ROW.test(x));
const NEGATION = /\b(not|no|nor|never|none|nothing|without|neither|cannot|unset|off)\b/i;
const COMMANDS = ["npm ci", "npm run lint", "npm test", "npm run lint:eslint", "npm run build"];

describe("day 30 part 4: structure", () => {
  it("has the title and every section", () => {
    assert.match(doc, /^# Blisscco MVP Verification Runbook \(Day 30 Part 4\)/m);
    for (const s of [
      "1. Rules",
      "2. Environments",
      "3. Verification order",
      "4. Existing local helper",
      "5. GitHub CI (step 6)",
      "6. TEST PostgreSQL checks (step 7)",
      "7. Manual Preview checks",
      "8. Result log",
      "9. Limits and what was not changed",
    ]) {
      assert.ok(section(s).trim().length > 40, s);
    }
  });

  it("says it is documentation only and starts with nothing confirmed", () => {
    assert.match(doc, /It is documentation only/);
    assert.match(doc, /Nothing was run to write it/);
    assert.match(doc, /No step is confirmed by this document/);
    // Phase 2 Step 5: a ticked box is allowed only inside section 7, where its own test requires a date and a status row.
    for (const l of doc.split("\n").filter((x) => /^\s*- \[[xX]\]/.test(x))) {
      assert.ok(section("7. Manual Preview checks").includes(l), `ticked box outside section 7: ${l}`);
    }
    assert.ok((doc.match(/^- \[[ x]\] /gm) ?? []).length >= 30);
  });
});

describe("day 30 part 4: the documented command order", () => {
  const s = section("3. Verification order");
  const steps = [...s.matchAll(/^(\d+)\. (.+)$/gm)].map((m) => ({ n: Number(m[1]), text: m[2] }));

  it("lists seven numbered steps in order", () => {
    assert.deepEqual(steps.map((x) => x.n), [1, 2, 3, 4, 5, 6, 7]);
  });

  it("steps 1 to 5 are the five commands, in the order install, lint, test, ESLint, build", () => {
    COMMANDS.forEach((c, i) => assert.ok(steps[i].text.startsWith("`" + c + "`"), `step ${i + 1}: ${c}`));
  });

  it("step 6 is GitHub CI and step 7 is the separate TEST PostgreSQL run", () => {
    assert.match(steps[5].text, /^GitHub CI/);
    assert.match(steps[6].text, /^TEST PostgreSQL checks/);
    assert.match(steps[6].text, /never part of steps 1 to 6/);
  });

  it("every npm command named in the document exists in package.json", () => {
    const named = [...new Set([...doc.matchAll(/`(npm (?:ci|test|run [a-z:-]+))`/g)].map((m) => m[1]))];
    assert.ok(named.length >= 6);
    for (const c of named) {
      if (c === "npm ci") continue;
      const script = c === "npm test" ? "test" : c.replace("npm run ", "");
      assert.ok(pkg.scripts[script], `package.json has no script for: ${c}`);
    }
    assert.match(pkg.scripts.lint, /tsc --noEmit/);
    assert.match(pkg.scripts["lint:eslint"], /next lint/);
    assert.match(pkg.scripts.build, /next build/);
    assert.match(pkg.scripts["test:integration"], /integration/);
  });

  it("the order matches scripts/day28-verify.sh", () => {
    const script = read("scripts/day28-verify.sh");
    const order = [...script.matchAll(/^run_step "([^"]+)"/gm)].map((m) => m[1]);
    assert.deepEqual(order, COMMANDS);
  });

  it("the order matches .github/workflows/ci.yml, which also runs one informational npm ls", () => {
    const ci = read(".github/workflows/ci.yml");
    const runs = [...ci.matchAll(/^\s+run: (npm .+)$/gm)].map((m) => m[1].trim());
    assert.deepEqual(runs.filter((r) => !r.startsWith("npm ls")), COMMANDS);
    assert.ok(runs.findIndex((r) => r.startsWith("npm ls")) === 1, "npm ls comes right after the install");
    assert.match(section("5. GitHub CI (step 6)"), /install, `npm ls` \(informational\), type check, tests, ESLint, build/);
  });

  it("the TEST database run is the manual workflow, not push or pull request", () => {
    const wf = read(".github/workflows/integration.yml");
    const onBlock = (wf.split(/^on:\s*$/m)[1] ?? "").split(/^permissions:/m)[0];
    assert.match(onBlock, /workflow_dispatch:/);
    assert.doesNotMatch(onBlock, /push|pull_request|schedule/);
    assert.match(wf, /npm run test:integration/);
    assert.match(section("6. TEST PostgreSQL checks (step 7)"), /started by hand \(it has no push or pull request trigger\)/);
  });

  it("the step 7 facts match the workflow and the guard", () => {
    const wf = read(".github/workflows/integration.yml");
    const s7 = section("6. TEST PostgreSQL checks (step 7)");
    for (const n of ["TEST_DATABASE_URL", "TEST_SUPABASE_PROJECT_REF", "TEST_DB_CONFIRM"]) {
      assert.ok(wf.includes(n), n);
      assert.ok(s7.includes("`" + n + "`"), n);
    }
    assert.match(wf, /name: DB integration \(TEST database only\)/);
    assert.match(read("tests/integration/test-db-guard.ts"), /refusing to run in a production environment/);
    assert.match(s7, /A skipped database test is not a success/);
    assert.match(wf, /A skipped database test is not a pass/);
  });
});

describe("day 30 part 4: the existing script and guide are referenced, not replaced", () => {
  const s = section("4. Existing local helper");

  it("names the script and the guide, and both exist", () => {
    assert.ok(s.includes("`scripts/day28-verify.sh`"));
    assert.ok(s.includes("`DAY28-VERIFICATION-GUIDE.md`"));
    assert.ok(existsSync(path.join(ROOT, "scripts/day28-verify.sh")));
    assert.ok(existsSync(path.join(ROOT, "DAY28-VERIFICATION-GUIDE.md")));
    assert.match(s, /bash scripts\/day28-verify\.sh/);
  });

  it("says no competing script exists and does not say the script succeeded", () => {
    assert.match(s, /adds no second verification script/);
    assert.match(s, /nothing here claims it has succeeded/);
    assert.match(s, /does not replace step 6/);
    assert.doesNotMatch(claimDoc, /(ran successfully|completed successfully|has succeeded\b(?!\.)|all \d+ commands passed|exited with 0)/i);
    const nonNeg = SENTENCES.filter((x) => /day28-verify/.test(x) && /\b(succeeded|passed|passing|green)\b/i.test(x));
    for (const x of nonNeg) assert.match(x, NEGATION, x);
  });

  it("the repository still has exactly one .sh script, so none was added by this part", () => {
    const sh = readdirSync(path.join(ROOT, "scripts")).filter((f) => f.endsWith(".sh"));
    assert.deepEqual(sh, ["backup-production-db.sh", "day28-verify.sh"]); // backup-production-db.sh: pilot limits + backup task, ci.yml me syntax check
    assert.match(section("9. Limits and what was not changed"), /No `\.sh` script was added, so `\.github\/workflows\/ci\.yml` is unchanged/);
    assert.doesNotMatch(read(".github/workflows/ci.yml"), /MVP-VERIFICATION-RUNBOOK/);
  });
});

describe("day 30 part 4: local, CI, Preview, TEST DB and Production are distinguished", () => {
  const s = section("2. Environments");
  const rows = s.split("\n").filter((l) => /^\| (Local|CI|Preview|TEST database|Production) \|/.test(l));
  const row = (name: string) => {
    const hit = rows.find((r) => r.startsWith(`| ${name} |`));
    assert.ok(hit, `row missing: ${name}`);
    return hit.split("|").slice(1, -1).map((c) => c.trim());
  };

  it("has exactly one row for each of the five environments, each with four filled cells", () => {
    assert.equal(rows.length, 5);
    for (const n of ["Local", "CI", "Preview", "TEST database", "Production"]) {
      const cells = row(n);
      assert.equal(cells.length, 4, n);
      for (const c of cells) assert.ok(c.length >= 2, `${n}: empty cell`);
    }
  });

  it("Local and CI are tied to the steps and files they really use", () => {
    assert.match(row("Local")[1], /\.nvmrc/);
    assert.match(row("Local")[3], /Steps 1 to 5/);
    assert.match(row("CI")[1], /\.github\/workflows\/ci\.yml/);
    assert.match(row("CI")[2], /no repository secrets/);
    assert.match(row("CI")[3], /Step 6/);
    assert.ok(existsSync(path.join(ROOT, ".nvmrc")));
  });

  it("Preview uses TEST project values and is checked by hand", () => {
    assert.match(row("Preview")[2], /TEST project values, never real Production values/);
    assert.match(row("Preview")[3], /section 7/);
  });

  it("the TEST database is a separate project, started by hand and guarded", () => {
    assert.match(row("TEST database")[1], /\.github\/workflows\/integration\.yml/);
    assert.match(row("TEST database")[1], /by hand/);
    assert.match(row("TEST database")[2], /guard refuses a Production database/);
    assert.match(row("TEST database")[3], /Step 7/);
  });

  it("Production is not used by any step", () => {
    assert.match(row("Production")[3], /Not used by this runbook/);
    assert.match(section("9. Limits and what was not changed"), /Production data and Production credentials are outside this runbook/);
  });

  it("every sentence that names Production is a negation, a separation or an exclusion", () => {
    const OK = new RegExp(NEGATION.source + "|\\b(separate|different|outside|refuses?)\\b", "i");
    let seen = 0;
    for (const x of SENTENCES) {
      if (/\bProduction\b/.test(x) && !/^\| Environment \|/.test(x)) {
        seen++;
        assert.match(x, OK, x);
      }
    }
    assert.ok(seen >= 6);
  });

  it("the steps are attached to their environments in section 3", () => {
    const v = section("3. Verification order");
    for (const l of v.split("\n").filter((x) => /^[1-5]\. /.test(x))) assert.match(l, /\(Local, CI\)/, l);
    assert.match(v, /6\. GitHub CI \(CI\)/);
    assert.match(v, /7\. TEST PostgreSQL checks \(TEST database\)/);
  });
});

describe("day 30 part 4: manual Preview checks", () => {
  const s = section("7. Manual Preview checks");

  it("has the four subsections, each with at least four checklist items; 7d stays fully unticked", () => {
    for (const h of ["### 7a. Publisher API-key handling", "### 7b. Ad match and no-fill", "### 7c. Impression and click behaviour", "### 7d. Revive fallback stays disabled"]) {
      assert.ok(s.includes(h), h);
    }
    for (const part of s.split(/^### /m).slice(1)) {
      const name = part.split("\n")[0];
      const unticked = (part.match(/^- \[ \] /gm) ?? []).length;
      const ticked = (part.match(/^- \[x\] /gm) ?? []).length;
      assert.ok(unticked + ticked >= 4, name);
      // Phase 2 Step 5: the original rule (at least four unticked items) is kept for 7d, the Revive section.
      if (name.startsWith("7d")) {
        assert.equal(ticked, 0, "7d must stay unticked");
        assert.ok(unticked >= 4, name);
      }
    }
  });

  it("a ticked box is dated, user-reported, and backed by a user-confirmed row naming its subsection", () => {
    for (const part of s.split(/^### /m).slice(1)) {
      const id = part.slice(0, 2);
      for (const l of part.split("\n").filter((x) => /^- \[x\] /.test(x))) {
        assert.match(l, /\(User-reported, \d{4}-\d{2}-\d{2}(, scope as reported)?\.\)$/, l);
        assert.ok(["7a", "7b", "7c"].includes(id), `ticked box outside 7a to 7c: ${l}`);
        const row = new RegExp("^\\| [^|\\n]+ \\| " + id + " \\| \\*\\*User-confirmed — completed successfully\\*\\*", "m");
        assert.match(doc, row, `no user-confirmed row for ${id}`);
      }
    }
  });

  it("uses a TEST-backed Preview and a dedicated test publisher", () => {
    assert.match(s, /Supabase values come from the TEST project/);
    assert.match(s, /dedicated test publisher/);
  });

  it("covers key handling: server-side variable, no public prefix, 401, no query or body key, revoke", () => {
    const k = s.split(/^### /m).find((p) => p.startsWith("7a"))!;
    for (const w of [/`BLISSCCO_PUBLISHER_API_KEY`/, /`BLISSCCO_API_BASE_URL`/, /no public prefix such as `NEXT_PUBLIC_`/, /returns 401/, /query string or the request body is not accepted/, /revoke/i, /shown once/, /network tab/]) {
      assert.match(k, w, String(w));
    }
  });

  it("covers match and no-fill: public fields, headers, no-fill, health topic, 415 and 400", () => {
    const m = s.split(/^### /m).find((p) => p.startsWith("7b"))!;
    for (const w of [/`fill: true`/, /`sponsored: true`/, /five public ad fields/, /X-Blisscco-Api-Version: 1/, /Cache-Control: no-store/, /`\{"fill":false\}`/, /`\{"topic":"health"\}`/, /415/, /400/, /429 or a 503/]) {
      assert.match(m, w, String(w));
    }
  });

  it("covers impression and click: opt-in header, recorded then duplicate, tampering, 302, server only, charge", () => {
    const c = s.split(/^### /m).find((p) => p.startsWith("7c"))!;
    for (const w of [/X-Blisscco-Tracking: 1/, /`tracking\.token`/, /`tracking\.click_ref`/, /`recorded`/, /`duplicate`/, /401/, /404/, /302/, /no CORS/, /only charged event is the match request/]) {
      assert.match(c, w, String(w));
    }
  });

  it("confirms the Revive fallback stays off unless deliberately tested", () => {
    const r = s.split(/^### /m).find((p) => p.startsWith("7d"))!;
    assert.match(r, /`REVIVE_FALLBACK_ENABLED` is unset/);
    assert.match(r, /`REVIVE_JSON_PREVIEW_ENABLED` is unset/);
    assert.match(r, /normal no-fill and not a Revive ad/);
    assert.match(s, /Testing the Revive fallback is a separate, deliberate decision\. It is not part of this runbook/);
    assert.match(s, /`DAY27-REAL-REVIVE-VERIFICATION\.md`/);
    assert.doesNotMatch(doc, /REVIVE_[A-Z_]+\s*[=:]\s*"?true/i);
    assert.doesNotMatch(doc, /\b(set|add|export)\s+`?REVIVE_/i);
    const ALLOWED = /\b(unset|off|not|never|no|disabled|separate)\b/i;
    for (const x of SENTENCES) if (/REVIVE_[A-Z_]+/.test(x)) assert.match(x, ALLOWED, x);
  });

  it("uses only the three existing publisher routes", () => {
    const ROUTES = [
      { method: "POST", path: "/api/v1/ads/match", file: "app/api/v1/ads/match/route.ts" },
      { method: "POST", path: "/api/v1/ads/impression", file: "app/api/v1/ads/impression/route.ts" },
      { method: "GET", path: "/api/v1/ads/click", file: "app/api/v1/ads/click/route.ts" },
    ];
    for (const r of ROUTES) {
      assert.ok(doc.includes(`${r.method} ${r.path}`), r.path);
      assert.match(read(r.file), new RegExp(`export async function ${r.method}\\b`), r.file);
    }
    const found = [...new Set([...doc.matchAll(/\/api\/[A-Za-z0-9_/-]+/g)].map((m) => m[0].replace(/\/+$/, "")))];
    for (const p of found) assert.ok(ROUTES.some((r) => r.path === p), `unknown path: ${p}`);
    assert.doesNotMatch(doc, /\/api\/ads\/match/);
  });

  it("the contract facts used here exist in the code", () => {
    const handler = read("lib/ads/match-handler.ts");
    for (const w of [/unsupported_media_type/, /415/, /Cache-Control": "no-store"/, /invalid_request/]) assert.match(handler, w, String(w));
    assert.match(read("app/api/v1/ads/match/route.ts"), /X-Blisscco-Api-Version/);
    assert.match(read("lib/ads/click-handler.ts"), /not_found/);
    assert.match(read("lib/ads/click.ts"), /"duplicate"/);
    assert.match(read("lib/ads/revive-adapter.ts"), /env\[REVIVE_ENV_FLAG\] === "true"/);
  });
});

describe("day 30 part 4: environment names, credentials and claims", () => {
  const ALLOWED_ENV = [
    "BLISSCCO_PUBLISHER_API_KEY",
    "BLISSCCO_API_BASE_URL",
    "TEST_DATABASE_URL",
    "TEST_SUPABASE_PROJECT_REF",
    "TEST_DB_CONFIRM",
    "REVIVE_FALLBACK_ENABLED",
    "REVIVE_JSON_PREVIEW_ENABLED",
  ];

  it("every environment-style name is a known one that exists in the repository", () => {
    const names = [...new Set([...doc.matchAll(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g)].map((m) => m[0]))];
    const haystack = [
      read(".github/workflows/integration.yml"),
      read("examples/publisher-nextjs/.env.example"),
      read("lib/ads/revive-adapter.ts"),
      read("lib/ads/revive-json-preview.ts"),
      read("app/dashboard/publisher/guide/page.tsx"),
    ].join("\n");
    for (const n of names) {
      assert.ok(ALLOWED_ENV.includes(n), `unknown environment name: ${n}`);
      assert.ok(haystack.includes(n), `${n} not found in the repository`);
    }
  });

  it("assigns no environment variable a value", () => {
    assert.doesNotMatch(doc, /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\s*=\s*\S/);
  });

  it("contains no live-looking credential, database URL or deployment URL", () => {
    for (const re of [
      /blc_live_[0-9a-f]{8,}/i,
      /\bb[tc]1\.(?!EXAMPLE)[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
      /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
      /\bsb_(secret|publishable)_[A-Za-z0-9_]{6,}/i,
      /\b[0-9a-f]{32,}\b/i,
      /postgres(ql)?:\/\//i,
      /Bearer\s+(?!\$)[A-Za-z0-9_-]{16,}/,
    ]) assert.doesNotMatch(doc, re, String(re));
    const urls = [...doc.matchAll(/https?:\/\/[^\s`"')]+/g)].map((m) => m[0]);
    assert.ok(urls.length >= 1);
    for (const u of urls) assert.equal(u, "https://YOUR-PREVIEW-HOST" + (u.includes("/api/") ? u.slice("https://YOUR-PREVIEW-HOST".length) : ""), u);
    assert.doesNotMatch(doc, /(vercel\.app|supabase\.co)/i);
  });

  it("every sentence about sharing or printing a credential is a prohibition", () => {
    const VERB = /\b(commit|paste|email|post|share|publish|print|echo|embed|hard-?code|expose)(s|ed|ing)?\b/i;
    const NOUN = /\b(key|secret|token|password|credentials?)\b/i;
    for (const x of SENTENCES) {
      const t = x.replace(/\bPOST\b/g, ""); // "POST" is the HTTP method, not the verb "post"
      if (VERB.test(t) && NOUN.test(t)) assert.match(x, NEGATION, x);
    }
  });

  it("claims no run, pass, build, CI or database result", () => {
    for (const re of [
      /\b\d+\s+(tests?\s+)?(pass|passed|passing)\b/i,
      /\b(all|every) (tests?|checks?|suites?|commands?) (pass|passed|are passing|are green)\b/i,
      /\b(lint|eslint|build|ci)\b[^.\n]{0,20}\b(passed|succeeded|is green|was green)\b/i,
      /\bno (defects?|bugs?|failures?) (found|remain)/i,
      /\b(verified|confirmed) (against|on|with) (a |the )?(real|live|production|preview) /i,
    ]) assert.doesNotMatch(claimDoc, re, String(re));
    const OK = new RegExp(NEGATION.source + "|\\b(until|if|when|before|only|must|unless|blank)\\b", "i");
    for (const x of claimSentences) if (/\b(verified|confirmed|passed|passing|succeeded)\b/i.test(x)) assert.match(x, OK, x);
  });

  it("user-confirmed rows appear only in a Phase 2 status table, name a section, and never cover CI, build, lint or database", () => {
    const lines = doc.split("\n");
    let heading = "";
    let count = 0;
    for (const l of lines) {
      if (/^#{2,3} /.test(l)) heading = l;
      if (/User-confirmed/.test(l) && /^\|/.test(l)) {
        count++;
        assert.match(l, USER_CONFIRMED_ROW, l);
        assert.match(heading, /^### Phase 2 Step \d+ status/, `user-confirmed row outside a Phase 2 status table: ${l}`);
        assert.doesNotMatch(l, /\b(npm|lint|eslint|build|CI|PostgreSQL|database|integration)\b/i, l);
      }
    }
    assert.ok(count >= 1);
    assert.doesNotMatch(section("8. Result log").split("### ")[0], /User-confirmed/, "the blank result log table must stay blank");
  });

  it("the result log has every row blank", () => {
    const rows = section("8. Result log").split("\n").filter((l) => /^\| (\d\.|Preview)/.test(l));
    assert.equal(rows.length, 8);
    for (const r of rows) assert.match(r, /\| \| \| \|$/, r);
  });

  it("every repository path named in backticks exists", () => {
    const paths = [...doc.matchAll(/`((?:app|components|lib|tests|config|scripts|examples)\/[^`\s,]+|\.github\/[^`\s,]+|[A-Z][A-Z0-9-]*\.md|\.nvmrc)`/g)].map((m) => m[1]);
    assert.ok(paths.length >= 8);
    for (const p of new Set(paths)) assert.ok(existsSync(path.join(ROOT, p)), p);
  });
});
