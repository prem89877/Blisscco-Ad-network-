// Day 28 Part 2: CI contract. Node version .nvmrc se, install sirf lockfile se (`npm ci`), chaaron checks active, koi secret nahi.
// Sirf local files padhta hai. Koi network, npm install, database, SQL, secret ya production nahi.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const CI = ".github/workflows/ci.yml";

type Step = { name?: string; uses?: string; run?: string; if?: string; env: Record<string, string>; with: Record<string, string>; keys: string[] };

/** ci.yml ke steps ko chhote parser se nikalta hai (is file ka format fixed hai; koi YAML dependency nahi). */
function parseSteps(yml: string): Step[] {
  const lines = yml.split("\n");
  const start = lines.findIndex((l) => /^ {4}steps:\s*$/.test(l));
  assert.ok(start >= 0, "jobs.check.steps nahi mila");
  const steps: Step[] = [];
  let cur: Step | null = null;
  let block: "env" | "with" | null = null;
  for (const raw of lines.slice(start + 1)) {
    if (/^\s*#/.test(raw) || raw.trim() === "") continue;
    if (/^\S/.test(raw) || /^ {0,4}\S/.test(raw)) break; // steps ke baad ka koi naya top-level / job-level key
    const item = /^ {6}- (\w[\w-]*):\s*(.*)$/.exec(raw);
    if (item) {
      cur = { env: {}, with: {}, keys: [] };
      steps.push(cur);
      block = null;
      assign(cur, item[1], item[2]);
      continue;
    }
    assert.ok(cur, `unexpected line before first step: ${raw}`);
    const sub = /^ {8}([\w-]+):\s*(.*)$/.exec(raw);
    if (sub) {
      if (sub[2] === "") block = sub[1] === "env" ? "env" : sub[1] === "with" ? "with" : null;
      else block = null;
      assign(cur, sub[1], sub[2]);
      continue;
    }
    const nested = /^ {10}([\w-]+):\s*(.*)$/.exec(raw);
    if (nested && block) {
      cur[block][nested[1]] = nested[2];
      continue;
    }
    assert.fail(`ci.yml line not understood by the contract parser: ${raw}`);
  }
  return steps;
}
function assign(step: Step, key: string, value: string) {
  step.keys.push(key);
  if (key === "name" || key === "uses" || key === "run" || key === "if") step[key] = value;
}

const REQUIRED = [
  { script: "lint", command: "npm run lint", body: /^tsc --noEmit$/ },
  { script: "test", command: "npm test", body: /^tsc -p tsconfig\.test\.json && node --require \.\/tests\/register\.cjs --test \.test-build\/tests\/\*\/\*\.test\.js$/ },
  { script: "lint:eslint", command: "npm run lint:eslint", body: /^next lint$/ },
  { script: "build", command: "npm run build", body: /^next build$/ },
];

describe("day 28 part 2 | lockfile is present and consistent with package.json", () => {
  const pkg = JSON.parse(read("package.json")) as {
    name: string; version: string; engines?: Record<string, string>; dependencies: Record<string, string>; devDependencies: Record<string, string>;
  };
  const lock = JSON.parse(read("package-lock.json")) as { name: string; version: string; lockfileVersion: number; packages: Record<string, { version?: string; resolved?: string; integrity?: string; link?: boolean; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; engines?: Record<string, string> }> };

  it("package-lock.json exists, is lockfileVersion 3 (npm 7+), and is not git-ignored", () => {
    assert.ok(existsSync(path.join(ROOT, "package-lock.json")));
    assert.equal(lock.lockfileVersion, 3);
    assert.doesNotMatch(read(".gitignore"), /^\/?package-lock\.json\s*$/m);
  });

  it("the lockfile's root entry equals package.json (name, version, dependencies, devDependencies, engines)", () => {
    assert.equal(lock.name, pkg.name);
    assert.equal(lock.version, pkg.version);
    const root = lock.packages[""];
    assert.equal(root.version, pkg.version);
    assert.deepEqual(root.dependencies, pkg.dependencies);
    assert.deepEqual(root.devDependencies, pkg.devDependencies);
    assert.deepEqual(root.engines, pkg.engines);
  });

  it("every declared dependency is locked at a version its caret range allows", () => {
    for (const [name, range] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
      const m = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);
      assert.ok(m, `${name}: this check expects a simple caret range, got ${range}`);
      const locked = lock.packages[`node_modules/${name}`];
      assert.ok(locked?.version, `${name} is missing from package-lock.json`);
      const v = /^(\d+)\.(\d+)\.(\d+)/.exec(locked.version);
      assert.ok(v, `${name}: unreadable locked version ${locked.version}`);
      const [lo, hi] = [m.slice(1, 4).map(Number), v.slice(1, 4).map(Number)];
      assert.equal(hi[0], lo[0], `${name} ${locked.version} leaves ${range}`);
      const atLeast = hi[1] > lo[1] || (hi[1] === lo[1] && hi[2] >= lo[2]);
      assert.ok(atLeast, `${name} ${locked.version} is below ${range}`);
    }
  });

  it("every locked package has a registry URL and an integrity hash (no git, file or unpinned entries)", () => {
    const entries = Object.entries(lock.packages).filter(([k]) => k !== "");
    assert.ok(entries.length > 100);
    for (const [k, v] of entries) {
      if (v.link) continue;
      assert.ok(v.version, k);
      assert.match(v.resolved ?? "", /^https:\/\/registry\.npmjs\.org\//, k);
      assert.match(v.integrity ?? "", /^sha(256|384|512)-/, k);
    }
  });

  it(".npmrc does not turn the lockfile off or loosen installs", () => {
    const npmrc = read(".npmrc").replace(/^\s*#.*$/gm, "");
    assert.doesNotMatch(npmrc, /package-lock\s*=\s*false/);
    assert.doesNotMatch(npmrc, /legacy-peer-deps|force\s*=|strict-peer-deps\s*=\s*false/);
  });
});

describe("day 28 part 2 | Node version: .nvmrc, package.json engines and CI agree", () => {
  const RAW = read(CI);
  const yml = RAW.replace(/^\s*#.*$/gm, ""); // sirf code; comments me "npm install" jaise shabd ho sakte hain

  it(".nvmrc is a single major version that matches engines.node", () => {
    const nvmrc = read(".nvmrc").trim();
    assert.match(nvmrc, /^\d+$/);
    const engines = (JSON.parse(read("package.json")) as { engines: { node: string } }).engines.node;
    assert.equal(engines, `${nvmrc}.x`);
    assert.equal(nvmrc, "22");
  });

  it("CI installs Node with actions/setup-node@v4 reading node-version-file: .nvmrc, and no second Node version", () => {
    const steps = parseSteps(RAW);
    const setups = steps.filter((s) => s.uses?.startsWith("actions/setup-node@"));
    assert.equal(setups.length, 1);
    assert.equal(setups[0].uses, "actions/setup-node@v4");
    assert.deepEqual(setups[0].with, { "node-version-file": ".nvmrc" });
    assert.doesNotMatch(yml, /^\s*node-version\s*:/m);
    assert.doesNotMatch(yml, /matrix\s*:/);
    assert.doesNotMatch(yml, /\b(nvm|n|volta|fnm) (install|use)\b/);
  });

  it("checkout and Node setup come before the install step", () => {
    const steps = parseSteps(RAW);
    const idx = (pred: (s: Step) => boolean) => steps.findIndex(pred);
    const checkout = idx((s) => !!s.uses?.startsWith("actions/checkout@"));
    const setup = idx((s) => !!s.uses?.startsWith("actions/setup-node@"));
    const install = idx((s) => s.run === "npm ci");
    assert.ok(checkout >= 0 && setup > checkout && install > setup, `order: checkout ${checkout}, setup-node ${setup}, install ${install}`);
  });
});

describe("day 28 part 2 | install uses the reproducible lockfile path only", () => {
  const RAW = read(CI);
  const yml = RAW.replace(/^\s*#.*$/gm, ""); // sirf code; comments me "npm install" jaise shabd ho sakte hain
  const steps = parseSteps(RAW);
  const runs = steps.filter((s) => s.run).map((s) => s.run as string);

  it("exactly one install step and it is `npm ci`", () => {
    const installs = runs.filter((r) => /\bnpm (ci|install|i|update|add)\b/.test(r));
    assert.deepEqual(installs, ["npm ci"]);
  });

  it("no npm install fallback, lockfile detection, package-lock bypass, forced or loosened install", () => {
    assert.doesNotMatch(yml, /npm (install|i|update|add)\b/);
    assert.doesNotMatch(yml, /--no-package-lock|--force|--legacy-peer-deps|--no-audit=false|--ignore-scripts=false/);
    assert.doesNotMatch(yml, /Detect lockfile|steps\.lock|present\s*[=!]=/);
    assert.doesNotMatch(yml, /package-lock\.json missing/);
  });

  it("CI does not generate or upload a lockfile", () => {
    assert.equal(steps.some((s) => s.uses?.startsWith("actions/upload-artifact@")), false);
    assert.doesNotMatch(yml, /upload-artifact|name:\s*package-lock/);
  });

  it("the install step is a plain step: no condition, no continue-on-error, no env", () => {
    const install = steps.find((s) => s.run === "npm ci");
    assert.ok(install);
    assert.deepEqual(install.keys.sort(), ["name", "run"]);
  });
});

describe("day 28 part 2 | all four verification commands are active, in order, and can fail the job", () => {
  const RAW = read(CI);
  const yml = RAW.replace(/^\s*#.*$/gm, ""); // sirf code; comments me "npm install" jaise shabd ho sakte hain
  const steps = parseSteps(RAW);
  const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;

  it("package.json scripts are what the CI commands run", () => {
    for (const r of REQUIRED) {
      assert.match(scripts[r.script] ?? "", r.body, r.script);
    }
  });

  it("CI runs `npm run lint`, `npm test`, `npm run lint:eslint`, `npm run build` as exact run commands, once each", () => {
    for (const r of REQUIRED) {
      assert.equal(steps.filter((s) => s.run === r.command).length, 1, r.command);
    }
  });

  it("they run in the order lint, test, eslint, build, after the install", () => {
    const at = REQUIRED.map((r) => steps.findIndex((s) => s.run === r.command));
    const install = steps.findIndex((s) => s.run === "npm ci");
    assert.ok(install >= 0 && at[0] > install, JSON.stringify({ install, at }));
    assert.deepEqual([...at].sort((a, b) => a - b), at);
    assert.ok(at.every((i, n) => n === 0 || i > at[n - 1]));
  });

  it("none is optional: no continue-on-error, no `|| true`, no `if` other than !cancelled()", () => {
    for (const r of REQUIRED) {
      const step = steps.find((s) => s.run === r.command);
      assert.ok(step, r.command);
      assert.equal(step.keys.includes("continue-on-error"), false, r.command);
      if (step.if !== undefined) assert.equal(step.if, "${{ !cancelled() }}", r.command);
    }
    assert.doesNotMatch(yml, /continue-on-error/);
    assert.doesNotMatch(yml, /\|\|\s*(true|:|exit 0)/);
    assert.doesNotMatch(yml, /if:\s*\$\{\{\s*(always|failure|success)\(\)/);
    assert.doesNotMatch(yml, /if:\s*(false|\$\{\{\s*false\s*\}\})/);
    assert.doesNotMatch(RAW, /^\s*#\s*- (name|run|uses)/m);
  });

  it("no job-level switch can skip or soften the job (no fail-fast override, no job `if`, one job)", () => {
    assert.doesNotMatch(yml, /^ {4}if:/m);
    assert.doesNotMatch(yml, /fail-fast|strategy\s*:/);
    assert.equal((yml.slice(yml.indexOf("\njobs:")).match(/^ {2}[\w-]+:\s*$/gm) ?? []).length, 1, "only the `check` job");
    assert.match(yml, /^jobs:\n {2}check:\n/m);
  });

  it("the production build step only gets dummy public-shaped values, nothing real", () => {
    const build = steps.find((s) => s.run === "npm run build");
    assert.ok(build);
    assert.deepEqual(build.env, {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_dummy",
      SUPABASE_SECRET_KEY: "sb_secret_dummy",
    });
  });
});

describe("day 28 part 2 | no secrets, no production access, least privilege", () => {
  const RAW = read(CI);
  const yml = RAW.replace(/^\s*#.*$/gm, ""); // sirf code; comments me "npm install" jaise shabd ho sakte hain

  it("uses no GitHub secret or variable, no database or test-DB settings, no deploy", () => {
    assert.doesNotMatch(yml, /\$\{\{\s*(secrets|vars)\./);
    assert.doesNotMatch(yml, /TEST_DATABASE_URL|TEST_DB_CONFIRM|TEST_SUPABASE_PROJECT_REF|DATABASE_URL|POSTGRES_URL|SUPABASE_DB_URL|SERVICE_ROLE/);
    assert.doesNotMatch(yml, /vercel|deploy|supabase (db|link|login)|psql|migrat/i);
    assert.doesNotMatch(yml, /^\s*environment\s*:/m);
    assert.doesNotMatch(yml, /NODE_ENV\s*:|VERCEL_ENV/);
  });

  it("every supabase-looking value is the example/dummy one", () => {
    for (const m of yml.matchAll(/https?:\/\/[^\s"']+/g)) assert.match(m[0], /^https:\/\/example\.supabase\.co$/, m[0]);
    for (const m of yml.matchAll(/\b(sb_(?:publishable|secret)_\w+|eyJ[\w-]{10,})/g)) assert.match(m[0], /^sb_(publishable|secret)_dummy$/, m[0]);
  });

  it("read-only permissions, push and pull_request only (no pull_request_target or workflow_run)", () => {
    assert.match(yml, /^permissions:\n {2}contents: read\n/m);
    assert.match(yml, /^on:\n {2}push:\n {2}pull_request:\n/m);
    assert.doesNotMatch(yml, /pull_request_target|workflow_run|workflow_dispatch|schedule:/);
  });

  it("only first-party pinned-major actions are used", () => {
    for (const s of parseSteps(RAW).filter((x) => x.uses)) assert.match(s.uses as string, /^actions\/(checkout|setup-node)@v4$/, s.uses);
  });
});

describe("day 28 part 2 | scope: workflow and tests only", () => {
  it("the Revive preview checker and other unrelated tooling are not wired into CI", () => {
    assert.doesNotMatch(read(CI), /revive/i);
  });

  it("no SQL file and no package script were added for Day 28", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    assert.deepEqual(Object.keys(pkg.scripts).sort(), ["build", "dev", "lint", "lint:eslint", "start", "test", "test:integration"]);
  });
});
