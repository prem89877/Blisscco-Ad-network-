// Day 28 Part 4: scripts/day28-verify.sh ka command order, fail-fast behavior aur "kuch secret print nahi hota" check.
// Script ko NAKLI `node` / `npm` ke saath chalaya jaata hai (temp folder me stubs, PATH me sabse aage). Asli npm ci / build / network /
// database / SQL / Production kuch nahi chalta. Test process.env se koi value nahi padhta.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const SCRIPT = "scripts/day28-verify.sh";
const GUIDE = "DAY28-VERIFICATION-GUIDE.md";
const COMMANDS = ["npm ci", "npm run lint", "npm test", "npm run lint:eslint", "npm run build"] as const;
const DUMMY = { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_dummy", SUPABASE_SECRET_KEY: "sb_secret_dummy" };

/** Script ka sirf code (comment lines hata kar). */
const scriptCode = () => read(SCRIPT).split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
const runLines = () => scriptCode().split("\n").filter((l) => /^run_step "/.test(l));

describe("day 28 part 4 | the script exists and is a plain bash script", () => {
  it("exists, starts with a bash shebang, parses (bash -n) and sets strict unset-variable handling", () => {
    assert.ok(existsSync(path.join(ROOT, SCRIPT)));
    assert.equal(read(SCRIPT).split("\n")[0], "#!/usr/bin/env bash");
    assert.match(scriptCode(), /^set -u$/m);
    assert.match(scriptCode(), /^set -o pipefail$/m);
  });

  it("is not wired into package.json scripts or the CI workflow (CI behaviour unchanged)", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    assert.deepEqual(Object.keys(pkg.scripts).sort(), ["build", "dev", "lint", "lint:eslint", "start", "test", "test:integration"]);
    for (const f of readdirSync(path.join(ROOT, ".github", "workflows"))) {
      assert.equal(read(`.github/workflows/${f}`).includes("day28-verify"), false, f);
    }
  });
});

describe("day 28 part 4 | command order", () => {
  it("runs exactly npm ci, npm run lint, npm test, npm run lint:eslint, npm run build, in that order", () => {
    const labels = runLines().map((l) => /^run_step "([^"]+)"/.exec(l)?.[1]);
    assert.deepEqual(labels, [...COMMANDS]);
  });

  it("each label is the command that really runs (the build one only adds the dummy env prefix)", () => {
    for (const l of runLines()) {
      const m = /^run_step "([^"]+)" (.+)$/.exec(l);
      assert.ok(m, l);
      const cmd = m[2].replace(/^env (?:[A-Z_]+=\S+ )+/, "");
      assert.equal(cmd, m[1], l);
    }
  });

  it("the commands are the same five, in the same order, as the CI workflow (ignoring its informational npm ls)", () => {
    const ci = [...read(".github/workflows/ci.yml").matchAll(/^\s+run: (npm[^\n]*)$/gm)].map((m) => m[1]).filter((c) => !c.startsWith("npm ls "));
    assert.deepEqual(ci, [...COMMANDS]);
  });

  it("every npm script the helper calls exists in package.json", () => {
    const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;
    for (const name of ["lint", "test", "lint:eslint", "build"]) assert.ok(scripts[name], name);
  });

  it("nothing else is executed between or around the five steps (no extra npm/npx/node run, no background job, no pipes into them)", () => {
    const code = scriptCode();
    assert.equal((code.match(/\bnpx\b/g) ?? []).length, 0);
    assert.equal((code.match(/\bnpm (ci|run|test|install|i|update|add|exec|audit|publish)\b/g) ?? []).length, COMMANDS.length * 2, "only the five run_step lines (label + command each)");
    assert.doesNotMatch(code, /&\s*$/m);
    assert.doesNotMatch(code, /\bwait\b|\bnohup\b|\bdisown\b/);
    for (const l of runLines()) assert.doesNotMatch(l, /[|;&<>]/, l);
  });
});

describe("day 28 part 4 | fail-fast (static)", () => {
  it("run_step checks the status, prints FAIL and exits with that same status", () => {
    const fn = /run_step\(\) \{([\s\S]*?)\n\}/.exec(scriptCode());
    assert.ok(fn);
    assert.match(fn[1], /"\$@"\s*\n\s*status=\$\?/);
    assert.match(fn[1], /if \[ "\$status" -ne 0 \]; then/);
    assert.match(fn[1], /exit "\$status"/);
    assert.match(fn[1], /FAIL \$label \(exit \$status\)/);
  });

  it("no option or idiom can swallow a failure", () => {
    const code = scriptCode();
    assert.doesNotMatch(code, /set \+e/);
    assert.doesNotMatch(code, /\|\|\s*(true|:|exit 0|return 0)/);
    assert.doesNotMatch(code, /\bcontinue\b|\btrap\b/);
    assert.doesNotMatch(code, /--force|--legacy-peer-deps|--no-audit|--if-present|--ignore-scripts/);
    assert.doesNotMatch(code, /status=0|status=\$\{?status:-0/);
    assert.match(code, /^exit 0$/m);
  });

  it("the Node check and setup checks all exit non-zero before any command runs", () => {
    const code = scriptCode();
    const firstRun = code.indexOf('run_step "npm ci"');
    for (const needle of ['exit 64; }', "exit 65"]) {
      const idx = code.indexOf(needle);
      assert.ok(idx > 0 && idx < firstRun, needle);
    }
    assert.match(code, /node major version does not match \.nvmrc/i);
  });
});

describe("day 28 part 4 | no secret-printing command", () => {
  const code = scriptCode();
  const printLines = code.split("\n").filter((l) => /^\s*(echo|printf)\b/.test(l) || /;\s*(echo|printf)\b/.test(l) || /\{\s*echo\b/.test(l));

  it("has print lines to check, and they only expand the known harmless variables", () => {
    assert.ok(printLines.length >= 8);
    const allowed = new Set(["label", "status", "total", "expected_major", "actual_major"]);
    for (const full of printLines) {
      const l = full.slice(full.search(/\b(echo|printf)\b/)).replace(/;.*$/, ""); // sirf print ka argument (cd wali line me $BASH_SOURCE print nahi hota)
      for (const m of l.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g)) assert.ok(allowed.has(m[1]), `${l.trim()} -> $${m[1]}`);
      assert.doesNotMatch(l, /\$\(|`/, l);
    }
  });

  it("print lines never mention URLs, keys, secrets, tokens, passwords, databases or Revive", () => {
    for (const l of printLines) assert.doesNotMatch(l, /URL|KEY|SECRET|TOKEN|PASSWORD|DATABASE|SUPABASE|POSTGRES|REVIVE|https?:/i, l);
  });

  it("uses no command that lists or dumps the environment or traces commands", () => {
    assert.doesNotMatch(code, /\bprintenv\b|\bdeclare -[a-zA-Z]*p|\bexport\s*(-p)?\s*$|\bexport -p\b|\bcompgen -e\b|\bset\s*$/m);
    assert.doesNotMatch(code, /^\s*env\s*($|\||>)/m);
    assert.doesNotMatch(code, /\bset -[a-zA-Z]*[xv]|\bset \+[a-zA-Z]*[xv]|\bBASH_XTRACEFD\b|\bPS4\b|\bnpm_config_loglevel|--loglevel|--verbose|-ddd/);
    assert.doesNotMatch(code, /\beval\b|\bsource\b|^\s*\.\s+\S|\benv\.local\b|\.env\b/m);
    assert.doesNotMatch(code, /\bcat\b|\bhead\b|\btail\b|\bgrep\b|\bsed\b|\bawk\b|\bcurl\b|\bwget\b/);
  });

  it("calls no database, SQL, deployment or hosting tool", () => {
    const code = scriptCode().replace(/(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY|SUPABASE_SECRET_KEY)=\S+/g, "DUMMY"); // CI ke teen dummy values chhod kar
    assert.doesNotMatch(code, /\b(psql|pg_dump|supabase|vercel|gh|git|docker|ssh|scp|rsync|mysql|sqlite3)\b/);
    assert.doesNotMatch(code, /--prod\b|\bdeploy\b|\bmigrat|\bselect\b.*\bfrom\b/i);
  });

  it("only the three CI dummy values appear, and only as the env prefix of the build command", () => {
    const hits = code.split("\n").filter((l) => /sb_(publishable|secret)_|supabase\.co|NEXT_PUBLIC_|SUPABASE_/.test(l) && !/^unset /.test(l));
    assert.equal(hits.length, 1);
    for (const [k, v] of Object.entries(DUMMY)) assert.ok(hits[0].includes(`${k}=${v}`), k);
    assert.match(hits[0], /^run_step "npm run build" env /);
    assert.doesNotMatch(code, /\bexport\b/);
  });

  it("clears the real database, secret, Revive and tracking variables for its commands, in the script's own process", () => {
    const unset = code.split("\n").filter((l) => /^unset /.test(l)).join(" ").split(/\s+/).filter((w) => w && w !== "unset");
    for (const n of ["TEST_DATABASE_URL", "TEST_DB_CONFIRM", "TEST_SUPABASE_PROJECT_REF", "DATABASE_URL", "POSTGRES_URL", "SUPABASE_DB_URL", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY",
      "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "BLISSCCO_PUBLISHER_API_KEY", "AD_TRACKING_SECRET", "REVIVE_FALLBACK_ENABLED", "REVIVE_DELIVERY_URL", "REVIVE_JSON_PREVIEW_ENABLED", "NODE_ENV"]) {
      assert.ok(unset.includes(n), n);
    }
    assert.ok(code.indexOf("unset TEST_DATABASE_URL") < code.indexOf('run_step "npm ci"'));
  });
});

// ---- behaviour: the real script, fake node/npm, in a temp folder ------------------------------------------------------------------
const BASH = ["/bin/bash", "/usr/bin/bash"].find((b) => existsSync(b));
const CAN_RUN = process.platform !== "win32" && BASH !== undefined;
const CANARY_NAMES = [
  "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "DATABASE_URL", "POSTGRES_URL", "TEST_DATABASE_URL",
  "TEST_DB_CONFIRM", "TEST_SUPABASE_PROJECT_REF", "REVIVE_DELIVERY_URL", "REVIVE_FALLBACK_ENABLED", "BLISSCCO_PUBLISHER_API_KEY", "AD_TRACKING_SECRET", "NODE_ENV",
] as const;
const canary = (n: string) => `CANARY_${n}_7f3a9c21`;

type Run = { status: number | null; out: string; log: string[] };
function runScript(opts: { nodeMajor?: string; failStep?: string; failCode?: number; withCanaries?: boolean } = {}): Run {
  const dir = mkdtempSync(path.join(tmpdir(), "day28-verify-"));
  try {
    const log = path.join(dir, "calls.log");
    writeFileSync(log, "");
    const state = 'state() { eval "v=\\${$1+set}"; if [ -z "$v" ]; then echo unset; else eval "val=\\${$1}"; if [ "$val" = "$2" ]; then echo dummy; else echo OTHER; fi; fi; }';
    const npmStub = [
      "#!/bin/sh", state, `LOG="${log}"`,
      'step="npm $*"',
      'echo "$step | url=$(state NEXT_PUBLIC_SUPABASE_URL https://example.supabase.co) pub=$(state NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY sb_publishable_dummy) secret=$(state SUPABASE_SECRET_KEY sb_secret_dummy) svc=$(state SUPABASE_SERVICE_ROLE_KEY x) db=$(state DATABASE_URL x) pg=$(state POSTGRES_URL x) testdb=$(state TEST_DATABASE_URL x) confirm=$(state TEST_DB_CONFIRM x) ref=$(state TEST_SUPABASE_PROJECT_REF x) revive=$(state REVIVE_DELIVERY_URL x) flag=$(state REVIVE_FALLBACK_ENABLED x) pubkey=$(state BLISSCCO_PUBLISHER_API_KEY x) track=$(state AD_TRACKING_SECRET x) nodeenv=$(state NODE_ENV x)" >> "$LOG"',
      'if [ "$step" = "$STUB_FAIL_STEP" ]; then exit "$STUB_FAIL_CODE"; fi',
      "exit 0", "",
    ].join("\n");
    writeFileSync(path.join(dir, "npm"), npmStub);
    writeFileSync(path.join(dir, "node"), '#!/bin/sh\necho "$STUB_NODE_MAJOR"\n');
    chmodSync(path.join(dir, "npm"), 0o755);
    chmodSync(path.join(dir, "node"), 0o755);
    const expectedMajor = read(".nvmrc").trim();
    const env: Record<string, string> = {
      PATH: `${dir}:/usr/bin:/bin`,
      HOME: dir,
      STUB_NODE_MAJOR: opts.nodeMajor ?? expectedMajor,
      STUB_FAIL_STEP: opts.failStep ?? "no-such-step",
      STUB_FAIL_CODE: String(opts.failCode ?? 1),
    };
    if (opts.withCanaries) for (const n of CANARY_NAMES) env[n] = canary(n);
    const res = spawnSync(BASH as string, [path.join(ROOT, SCRIPT)], { cwd: dir, env, encoding: "utf8" });
    return { status: res.status, out: `${res.stdout}\n${res.stderr}`, log: readFileSync(log, "utf8").split("\n").filter(Boolean) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const calls = (r: Run) => r.log.map((l) => l.split(" | ")[0]);
const field = (line: string, name: string) => new RegExp(`${name}=(\\w+)`).exec(line)?.[1];

describe("day 28 part 4 | behaviour with fake node and npm (nothing real runs)", { skip: !CAN_RUN ? "needs bash on a non-Windows system" : false }, () => {
  it("the fake npm is the one found first (so the real npm can never run in these tests)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "day28-verify-path-"));
    try {
      writeFileSync(path.join(dir, "npm"), "#!/bin/sh\nexit 0\n");
      chmodSync(path.join(dir, "npm"), 0o755);
      const res = spawnSync(BASH as string, ["-c", "command -v npm"], { env: { PATH: `${dir}:/usr/bin:/bin` }, encoding: "utf8" });
      assert.equal(res.stdout.trim(), path.join(dir, "npm"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("all pass: the five commands run once each in order, exit 0, PASS/RUN lines only", () => {
    const r = runScript();
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(calls(r), [...COMMANDS]);
    assert.deepEqual(
      r.out.split("\n").filter(Boolean),
      [...COMMANDS.flatMap((c) => [`==> RUN  ${c}`, `<== PASS ${c} (exit 0)`]), "day28-verify: all 5 commands passed"],
    );
  });

  it("fail-fast: a failure in the middle stops the run, passes its exit status through and never starts later commands", () => {
    const r = runScript({ failStep: "npm test", failCode: 7 });
    assert.equal(r.status, 7);
    assert.deepEqual(calls(r), ["npm ci", "npm run lint", "npm test"]);
    assert.match(r.out, /<== FAIL npm test \(exit 7\)/);
    assert.match(r.out, /stopped at the first failure; later commands were not run/);
    assert.doesNotMatch(r.out, /RUN\s+npm run lint:eslint|RUN\s+npm run build|all 5 commands passed/);
  });

  it("fail-fast at every position: each of the five failing alone stops exactly there with a non-zero status", () => {
    COMMANDS.forEach((cmd, i) => {
      const r = runScript({ failStep: cmd, failCode: 3 });
      assert.equal(r.status, 3, cmd);
      assert.deepEqual(calls(r), COMMANDS.slice(0, i + 1), cmd);
      assert.match(r.out, new RegExp(`<== FAIL ${cmd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(exit 3\\)`), cmd);
    });
  });

  it("a non-zero status is never turned into success (exit codes 1, 2 and 255 all pass through)", () => {
    for (const code of [1, 2, 255]) assert.equal(runScript({ failStep: "npm run build", failCode: code }).status, code);
  });

  it("Node major version different from .nvmrc: exit 65 before any command runs", () => {
    const r = runScript({ nodeMajor: "18" });
    assert.equal(r.status, 65);
    assert.deepEqual(r.log, []);
    assert.match(r.out, /Node major version does not match \.nvmrc \(expected 22, found 18\)/);
  });

  it("does not depend on the working directory (it runs from a temp folder here)", () => {
    const r = runScript();
    assert.equal(r.status, 0);
    assert.equal(r.log.length, 5);
  });

  it("clean environment: real database, secret, Revive, tracking and NODE_ENV values never reach the first four commands", () => {
    const r = runScript({ withCanaries: true });
    assert.equal(r.status, 0, r.out);
    for (const line of r.log.slice(0, 4)) {
      for (const f of ["url", "pub", "secret", "svc", "db", "pg", "testdb", "confirm", "ref", "revive", "flag", "pubkey", "track", "nodeenv"]) assert.equal(field(line, f), "unset", `${line.split(" | ")[0]} ${f}`);
    }
  });

  it("the build gets only the three dummy CI values; everything real stays unset", () => {
    const r = runScript({ withCanaries: true });
    const build = r.log[4];
    assert.ok(build.startsWith("npm run build | "));
    for (const f of ["url", "pub", "secret"]) assert.equal(field(build, f), "dummy", f);
    for (const f of ["svc", "db", "pg", "testdb", "confirm", "ref", "revive", "flag", "pubkey", "track", "nodeenv"]) assert.equal(field(build, f), "unset", f);
  });

  it("prints no canary value: nothing from the environment appears in the script's output, pass or fail", () => {
    for (const opts of [{}, { failStep: "npm test", failCode: 9 }, { nodeMajor: "20" }]) {
      const r = runScript({ ...opts, withCanaries: true });
      assert.equal(r.out.includes("CANARY_"), false);
      assert.equal(/example\.supabase\.co|sb_secret_dummy|sb_publishable_dummy|postgres|https?:\/\//i.test(r.out), false);
      assert.ok(r.log.every((l) => !l.includes("CANARY_")));
    }
  });

  it("the output is only RUN / PASS / FAIL lines, the stop notice, the node-version notice or the final summary", () => {
    for (const opts of [{}, { failStep: "npm run lint", failCode: 4 }, { nodeMajor: "21" }]) {
      const r = runScript(opts);
      for (const line of r.out.split("\n").filter(Boolean)) {
        assert.match(line, /^(==> RUN  npm[\w :-]*|<== (PASS|FAIL) npm[\w :-]* \(exit \d+\)|day28-verify: (stopped at the first failure; later commands were not run|all 5 commands passed|Node major version does not match \.nvmrc \(expected \d+, found \d+\)))$/, line);
      }
    }
  });
});

describe("day 28 part 4 | the guide", () => {
  const doc = read(GUIDE);
  const flat = doc.replace(/\s+/g, " ");

  it("exists and documents usage with the exact command", () => {
    assert.ok(existsSync(path.join(ROOT, GUIDE)));
    assert.match(doc, /```bash\nbash scripts\/day28-verify\.sh\n```/);
  });

  it("lists the five commands in the script's order", () => {
    const rows = doc.split("\n").filter((l) => /^\| [1-5] \|/.test(l)).map((l) => /`([^`]+)`/.exec(l)?.[1]);
    assert.deepEqual(rows, [...COMMANDS]);
  });

  it("states the network requirement and the Node version from .nvmrc", () => {
    assert.match(flat, /\*\*Network access\.\*\* `npm ci` downloads every package from the npm registry/);
    assert.match(flat, /\*\*Node version from `\.nvmrc`\.\*\*/);
    assert.match(flat, /currently 22/);
    assert.equal(read(".nvmrc").trim(), "22");
    assert.match(flat, /exit code 65 on a mismatch/);
  });

  it("documents fail-fast, the exit codes the script defines, and the clean environment", () => {
    assert.match(flat, /stops at the first failure/);
    assert.match(doc, /\| 64 \| setup problem/);
    assert.match(doc, /\| 65 \| the Node major version does not match `\.nvmrc`/);
    for (const code of ["64", "65"]) assert.ok(read(SCRIPT).includes(`exit ${code}`), code);
    assert.match(flat, /same three dummy values that CI uses/);
    assert.match(flat, /real PostgreSQL integration tests are skipped here/);
  });

  it("says it prints only command names and exit statuses, never environment values, and is never run against Production", () => {
    assert.match(flat, /Only command names and exit statuses/);
    assert.match(flat, /never prints an environment variable, a secret, a key or a database URL/);
    assert.match(flat, /Nothing here is run against Production/);
    assert.match(flat, /opens no database connection, runs no SQL, makes no deployment and calls no Revive endpoint/);
    assert.match(flat, /changes no application code, no CI workflow, no database and no deployment/);
  });

  it("warns that npm ci reinstalls node_modules and that a local run does not replace CI", () => {
    assert.match(flat, /`npm ci` removes the existing `node_modules` folder and installs it again/);
    assert.match(flat, /does not replace the GitHub Actions run/);
  });

  it("contains no URL, credential-shaped value or env assignment", () => {
    assert.doesNotMatch(doc, /https?:\/\/\S/);
    assert.doesNotMatch(doc, /blc_live_[0-9a-f]{8}|sb_secret_|sb_publishable_|eyJ[\w-]{10,}|postgres(ql)?:\/\//i);
    assert.doesNotMatch(doc, /\b[A-Z][A-Z0-9_]{5,}=\S/);
  });
});

describe("day 28 part 4 | scope: helper, guide and test only", () => {
  it("no SQL file for Day 28 and no application source mentions the helper", () => {
    assert.equal(readdirSync(path.join(ROOT, "supabase", "sql")).some((f) => /day-?28/i.test(f)), false);
    for (const d of ["app", "lib"]) {
      const walk = (dir: string): string[] => readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
      for (const f of walk(d)) assert.equal(read(f).includes("day28-verify"), false, f);
    }
  });
});
