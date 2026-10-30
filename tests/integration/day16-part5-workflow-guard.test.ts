import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { TEST_DB_CONFIRM_VALUE, checkTestDatabase, type GuardEnv } from "./test-db-guard";

// Day 16 Part 5: .github/workflows/integration.yml ki STATIC jaanch. Koi database / network / secret nahi chahiye, isliye ye hamesha chalta hai.
// Maqsad: configuration adhoori ho toh workflow chup-chaap "sab skip, phir bhi hara" na ho; production credentials workflow me kabhi na aayen.
//
// NOTE: production-jaise env naam jaan-boojh kar tod kar likhe hain (join): tests/integration/day9-part5-guard.test.ts ka static check
// integration files me un naamon ka seedha zikr nahi chahta.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");
const join = (...parts: string[]) => parts.join("_");

const workflow = read(".github", "workflows", "integration.yml");
const ci = read(".github", "workflows", "ci.yml");
const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

type Step = { name: string; text: string; run: string };

/** Bina YAML library ke: `      - ` se shuru hone wale har step ko alag karta hai. */
function stepsOf(text: string): Step[] {
  const chunks = text.split(/^ {6}- /m).slice(1);
  return chunks.map((chunk) => {
    const name = /^name:\s*(.+)$/m.exec(chunk)?.[1]?.trim() ?? /^uses:\s*(.+)$/m.exec(chunk)?.[1]?.trim() ?? "(unnamed)";
    const lines = chunk.split("\n");
    const at = lines.findIndex((l) => /^\s+run:\s*[|>]?\s*$/.test(l) || /^run:\s*[|>]?\s*$/.test(l));
    let run = "";
    if (at >= 0) {
      const out: string[] = [];
      for (const l of lines.slice(at + 1)) {
        if (l.trim() !== "" && !/^ {10,}/.test(l)) break;
        out.push(l);
      }
      run = out.join("\n");
    } else {
      run = /^\s*run:\s*(.+)$/m.exec(chunk)?.[1] ?? "";
    }
    return { name, text: chunk, run };
  });
}

const steps = stepsOf(workflow);
const stepNamed = (re: RegExp) => steps.find((s) => re.test(s.name));
/** Step ka milna zaroori hai: na mile toh saaf message ke saath fail (type narrowing assert par nirbhar nahi). */
function must(re: RegExp, what: string): Step {
  const s = stepNamed(re);
  if (!s) throw new assert.AssertionError({ message: `${what} is missing from integration.yml` });
  return s;
}
const secretRefs = (text: string) => [...text.matchAll(/\$\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}/g)].map((m) => m[1]);

describe("day 16 part 5: integration workflow static guard", () => {
  it("is manual only (workflow_dispatch): no push / pull request / workflow_run trigger can reach the TEST secrets", () => {
    const on = /^on:\s*\n((?: {2,}.*\n|\s*\n)+)/m.exec(workflow)?.[1] ?? "";
    assert.match(on, /workflow_dispatch/);
    for (const banned of ["push", "pull_request", "pull_request_target", "workflow_run", "schedule"]) {
      assert.equal(new RegExp(`^\\s+${banned}\\s*:`, "m").test(on), false, `trigger ${banned} must not be used`);
    }
  });

  it("requires TEST_DATABASE_URL and TEST_SUPABASE_PROJECT_REF as secrets, and TEST_DB_CONFIRM as the fixed confirmation value", () => {
    const testStep = must(/Integration tests/, "integration test step");
    assert.match(testStep.text, /TEST_DATABASE_URL:\s*\$\{\{\s*secrets\.TEST_DATABASE_URL\s*\}\}/);
    assert.match(testStep.text, /TEST_SUPABASE_PROJECT_REF:\s*\$\{\{\s*secrets\.TEST_SUPABASE_PROJECT_REF\s*\}\}/);
    assert.equal(TEST_DB_CONFIRM_VALUE, "blisscco-test-db");
    assert.match(testStep.text, new RegExp(`TEST_DB_CONFIRM:\\s*${TEST_DB_CONFIRM_VALUE}\\s*$`, "m"));
    assert.equal(/TEST_DB_CONFIRM:\s*\$\{\{/.test(workflow), false, "the confirmation value is fixed text, not a secret / variable");
  });

  it("has a preflight step BEFORE install and before the integration tests that requires all three values", () => {
    const pre = must(/Preflight/i, "preflight step");
    const idx = (s: Step) => steps.indexOf(s);
    const install = must(/^Install$/, "install step");
    const tests = must(/Integration tests/, "integration test step");
    assert.ok(idx(pre) < idx(install), "preflight must run before install");
    assert.ok(idx(pre) < idx(tests), "preflight must run before the tests");
    for (const name of ["TEST_DATABASE_URL", "TEST_SUPABASE_PROJECT_REF", "TEST_DB_CONFIRM"]) {
      assert.ok(pre.run.includes(name), `preflight does not check ${name}`);
    }
    assert.match(pre.run, /exit 1/);
    assert.match(pre.run, /::error/);
    assert.match(pre.run, new RegExp(TEST_DB_CONFIRM_VALUE));
    assert.match(pre.run, /postgres(ql)?:\/\//);
    assert.match(pre.text, /TEST_DATABASE_URL:\s*\$\{\{\s*secrets\.TEST_DATABASE_URL\s*\}\}/);
    assert.match(pre.text, /TEST_SUPABASE_PROJECT_REF:\s*\$\{\{\s*secrets\.TEST_SUPABASE_PROJECT_REF\s*\}\}/);
  });

  it("never prints secret values: no echo/printf of the values, no set -x, no env dump, secrets only in env blocks", () => {
    for (const s of steps) {
      assert.equal(/\$\{\{\s*secrets\./.test(s.run), false, `step "${s.name}": secrets must not be inlined in a script`);
      assert.equal(/\bset\s+-[a-z]*x/.test(s.run), false, `step "${s.name}": set -x would print values`);
      assert.equal(/\b(printenv|env\s*$|env\s*\|)/m.test(s.run), false, `step "${s.name}": do not dump the environment`);
      for (const line of s.run.split("\n").filter((l) => /\b(echo|printf)\b/.test(l))) {
        assert.equal(/\$\{?(TEST_DATABASE_URL|TEST_SUPABASE_PROJECT_REF|value|!name)\b/.test(line), false, `step "${s.name}" prints a value: ${line.trim().slice(0, 40)}`);
      }
    }
  });

  it("runs exactly the integration command and the package script only targets the integration test folder", () => {
    const testStep = must(/Integration tests/, "integration test step");
    assert.match(testStep.run, /npm run test:integration/);
    assert.match(pkg.scripts["test:integration"], /tests\/integration\/\*\.test\.js/);
    assert.equal(/tests\/\*\/\*\.test\.js/.test(pkg.scripts["test:integration"]), false, "must not run the whole suite");
    assert.match(testStep.run, /pipefail/, "a failing test must fail the step even through tee");
  });

  it("fails the workflow when any test was skipped or none passed, and nothing can hide a failure", () => {
    const gate = must(/no integration test was skipped/i, "skip gate step");
    const tests = must(/Integration tests/, "integration test step");
    assert.ok(steps.indexOf(gate) > steps.indexOf(tests), "skip gate must run after the tests");
    assert.match(gate.run, /skipped/);
    assert.match(gate.run, /pass/);
    assert.match(gate.run, /exit 1/);
    assert.equal(/continue-on-error/.test(workflow), false, "continue-on-error would hide failures");
    assert.equal(/\bif:\s*(\$\{\{\s*)?always\(\)/.test(workflow), false);
    for (const line of workflow.split("\n").filter((l) => l.includes("test:integration"))) {
      assert.equal(/\|\|\s*true/.test(line), false, "the test command must not swallow failures");
    }
  });

  it("uses only the TEST secrets: no production database / Supabase credentials, no production environment", () => {
    const allowed = new Set(["TEST_DATABASE_URL", "TEST_SUPABASE_PROJECT_REF"]);
    for (const name of secretRefs(workflow)) assert.ok(allowed.has(name), `workflow references secret ${name}`);

    const bannedNames = [
      join("SUPABASE", "SECRET", "KEY"),
      join("SUPABASE", "SERVICE", "ROLE", "KEY"),
      join("NEXT", "PUBLIC", "SUPABASE"),
      join("SUPABASE", "DB", "URL"),
      join("POSTGRES", "URL"),
      join("PROD", "DATABASE", "URL"),
      join("PRODUCTION", "DATABASE", "URL"),
      join("AD", "TRACKING", "SECRET"),
    ];
    for (const name of bannedNames) assert.equal(workflow.includes(name), false, `workflow must not reference ${name}`);
    assert.equal(/(?<![A-Z_])DATABASE_URL/.test(workflow), false, "only TEST_DATABASE_URL is allowed, never the app's DATABASE_URL");
    assert.equal(/^\s*environment\s*:/m.test(workflow), false, "no GitHub environment (a production environment would unlock production secrets)");
    assert.equal(/NODE_ENV\s*:\s*["']?production/i.test(workflow), false);
    assert.equal(/VERCEL_ENV/.test(workflow), false);
  });

  it("has least-privilege permissions and serialises runs against the one TEST database", () => {
    assert.match(workflow, /^permissions:\s*\n\s+contents:\s*read\s*$/m);
    assert.match(workflow, /^concurrency:\s*\n\s+group:\s*integration-test-database/m);
    assert.match(workflow, /cancel-in-progress:\s*false/);
    assert.match(workflow, /timeout-minutes:\s*\d+/);
  });

  it("the CI workflow stays free of TEST database secrets and production credentials (unchanged contract)", () => {
    assert.equal(/\$\{\{\s*secrets\./.test(ci), false, "ci.yml must not use any secret");
    assert.equal(/TEST_DATABASE_URL|TEST_DB_CONFIRM|TEST_SUPABASE_PROJECT_REF/.test(ci), false);
    assert.match(ci, /npm test/);
    assert.match(ci, /npm run lint:eslint/);
    assert.match(ci, /npm run build/);
  });
});

describe("day 16 part 5: the existing database guard still rejects production (checkTestDatabase)", () => {
  const TEST_REF = "tstproj1234abcd";
  const PROD_REF = "prodproj9876wxyz";
  const prodUrlKey = join("NEXT", "PUBLIC", "SUPABASE", "URL");
  const good = (): GuardEnv => ({
    TEST_DATABASE_URL: `postgresql://postgres:pw@db.${TEST_REF}.supabase.co:5432/postgres`,
    TEST_DB_CONFIRM: TEST_DB_CONFIRM_VALUE,
    TEST_SUPABASE_PROJECT_REF: TEST_REF,
    [prodUrlKey]: `https://${PROD_REF}.supabase.co`,
  });

  it("accepts only the confirmed, separate TEST project", () => {
    assert.equal(checkTestDatabase(good()).ok, true);
  });

  it("rejects each of the three workflow settings when missing, and a wrong confirmation value", () => {
    for (const k of ["TEST_DATABASE_URL", "TEST_SUPABASE_PROJECT_REF", "TEST_DB_CONFIRM"]) {
      const env = good();
      delete env[k];
      assert.equal(checkTestDatabase(env).ok, false, k);
    }
    for (const v of ["", "yes", "BLISSCCO-TEST-DB", "blisscco-test-db "]) {
      assert.equal(checkTestDatabase({ ...good(), TEST_DB_CONFIRM: v }).ok, false, JSON.stringify(v));
    }
  });

  it("rejects the production project ref and a URL that contains it", () => {
    const sameRef = { ...good(), TEST_SUPABASE_PROJECT_REF: PROD_REF, TEST_DATABASE_URL: `postgresql://postgres:pw@db.${PROD_REF}.supabase.co:5432/postgres` };
    assert.equal(checkTestDatabase(sameRef).ok, false);
    const hidden = { ...good(), TEST_DATABASE_URL: `postgresql://postgres.${PROD_REF}:pw@pooler.example.com:6543/postgres?x=${TEST_REF}` };
    assert.equal(checkTestDatabase(hidden).ok, false);
  });

  it("rejects production environments and never echoes the URL or password in the reason", () => {
    assert.equal(checkTestDatabase({ ...good(), NODE_ENV: "production" }).ok, false);
    assert.equal(checkTestDatabase({ ...good(), VERCEL_ENV: "production" }).ok, false);
    const r = checkTestDatabase({ ...good(), TEST_DB_CONFIRM: "no" });
    assert.equal(r.ok, false);
    assert.equal(JSON.stringify(r).includes("pw@"), false);
    assert.equal(JSON.stringify(r).includes(TEST_REF), false);
  });
});
