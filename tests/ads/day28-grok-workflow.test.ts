// grok.yml ka contract: write permission sirf is alag workflow me, sirf manual trigger, koi secret / Production / deploy nahi,
// aur ci.yml + integration.yml read-only hi rehte hain. Sirf local files padhta hai; koi network, GitHub call ya env value nahi.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const WF = ".github/workflows";
const GROK = `${WF}/grok.yml`;
const code = (s: string) => s.replace(/^\s*#.*$/gm, "");
const grok = () => code(read(GROK));

describe("grok workflow | write permission lives only in grok.yml", () => {
  it("grok.yml exists and grants exactly contents, pull-requests and issues write, nothing else", () => {
    assert.ok(existsSync(path.join(ROOT, GROK)));
    const block = /^permissions:\n((?: {2}[\w-]+: \w+\n)+)/m.exec(grok());
    assert.ok(block, "top-level permissions block");
    assert.deepEqual(block[1].trim().split("\n").map((l) => l.trim()), ["contents: write", "pull-requests: write", "issues: write"]);
    assert.equal((grok().match(/^permissions:/gm) ?? []).length, 1);
    assert.doesNotMatch(grok(), /write-all|read-all|id-token|actions: write|packages: write|deployments: write|security-events: write|statuses: write/);
  });

  it("every other workflow stays read-only: no write permission at all, and ci.yml / integration.yml keep contents: read", () => {
    const others = readdirSync(path.join(ROOT, WF)).filter((f) => f.endsWith(".yml") && f !== "grok.yml");
    assert.ok(others.includes("ci.yml") && others.includes("integration.yml"));
    for (const f of others) {
      const src = code(read(`${WF}/${f}`));
      assert.doesNotMatch(src, /:\s*write\b|write-all/, f);
      assert.match(src, /^permissions:\n {2}contents: read\n/m, f);
    }
  });
});

describe("grok workflow | it can only be started by hand", () => {
  it("the only trigger is workflow_dispatch", () => {
    const on = /^on:\n([\s\S]*?)\n(?=\S)/m.exec(grok());
    assert.ok(on);
    assert.deepEqual([...on[1].matchAll(/^ {2}([\w_]+):/gm)].map((m) => m[1]), ["workflow_dispatch"]);
    assert.doesNotMatch(grok(), /pull_request|pull_request_target|\bpush:|issue_comment|issues:\s*$|workflow_run|workflow_call|schedule:|repository_dispatch|\bcheck_run|\bdiscussion/m);
  });

  it("the one input is a required string that is checked to be digits only before use", () => {
    assert.match(grok(), /inputs:\n {6}number:\n[\s\S]*?required: true\n {8}type: string/);
    assert.match(grok(), /\*\[!0-9\]\*\) echo "number must contain digits only"; exit 1/);
  });
});

describe("grok workflow | no injection, no secrets, no Production", () => {
  it("expressions are never inside a run script: the input and token reach the script through env only", () => {
    const runBlock = /run: \|\n([\s\S]*?)(?=\n {6}- |\n*$)/.exec(grok());
    assert.ok(runBlock);
    assert.doesNotMatch(runBlock[1], /\$\{\{/);
    assert.match(grok(), /env:\n {10}GH_TOKEN: \$\{\{ github\.token \}\}\n {10}NUMBER: \$\{\{ inputs\.number \}\}/);
  });

  it("uses no repository secret or variable, no environment, no database, hosting, deploy or app setting", () => {
    assert.doesNotMatch(grok(), /\$\{\{\s*(secrets|vars)\./);
    assert.doesNotMatch(grok(), /^\s*environment\s*:/m);
    assert.doesNotMatch(grok(), /TEST_DATABASE_URL|TEST_DB_CONFIRM|DATABASE_URL|POSTGRES_URL|SUPABASE|SERVICE_ROLE|NODE_ENV|VERCEL/i);
    assert.doesNotMatch(grok(), /vercel|deploy|psql|migrat|\bnpm\b|\bnpx\b|\.sql\b/i);
    assert.doesNotMatch(read(GROK), /revive/i);
  });

  it("only first-party actions/checkout@v4 is used, and nothing is ignored on failure", () => {
    assert.deepEqual([...grok().matchAll(/uses: (\S+)/g)].map((m) => m[1]), ["actions/checkout@v4"]);
    assert.doesNotMatch(grok(), /continue-on-error|\|\|\s*(true|:)|if:\s*(always|failure)\(\)/);
  });

  it("is bounded: a timeout, a concurrency group that never cancels a running write, and no matrix", () => {
    assert.match(grok(), /timeout-minutes: 10/);
    assert.match(grok(), /group: grok-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: false/);
    assert.doesNotMatch(grok(), /matrix/);
  });

  it("holds no credential-shaped value or real host", () => {
    assert.doesNotMatch(read(GROK), /blc_live_|sb_secret_|sb_publishable_|eyJ[\w-]{10,}|ghp_\w{10,}|github_pat_|xai-\w{6,}|postgres(ql)?:\/\//i);
    assert.doesNotMatch(read(GROK), /https?:\/\/\S/);
  });
});

describe("grok workflow | the placeholder says what is still undecided", () => {
  it("has no Grok action or API call yet, and the file says so", () => {
    assert.match(read(GROK), /Grok ka asli step yahan aayega/);
    assert.doesNotMatch(grok(), /\bgrok\b.*(curl|api\.|\/v1\/)|\bcurl\b|\bwget\b/i);
  });
});
