// Day 28 Part 1: publisher examples ka strict type-check, exact compiler config, aur missing Node types ka saaf failure.
// Sirf local files + TypeScript compiler. Koi network, database, SQL, production API, billing ya tracking nahi.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as ts from "typescript";
import {
  NODE_TYPE_ROOT,
  PROJECT_ROOT,
  assertNodeTypesInstalled,
  compileForPublisherExample,
  findProjectRoot,
  nodeTypesProblem,
  publisherExampleCompilerOptions,
} from "./helpers/publisher-example-compiler";

const read = (f: string) => readFileSync(path.join(PROJECT_ROOT, f), "utf8");
const EXAMPLES = [
  "examples/publisher-node/src/client.ts",
  "examples/publisher-node/src/types.ts",
  "examples/publisher-nextjs/app/api/blisscco-ad/route.ts",
];
const NODE_SNIPPET = 'export const key: string = process.env.EXAMPLE_KEY ?? "";\nexport const log = (m: string) => console.log(m);\n';

function withEmptyTypeRoot<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(path.join(tmpdir(), "blisscco-no-types-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("day 28 part 1 | exact compiler configuration", () => {
  it("is strict, no-emit, ES2022 / ESNext / Bundler, with the intended libs and skipLibCheck", () => {
    const o = publisherExampleCompilerOptions();
    assert.equal(o.strict, true);
    assert.equal(o.noEmit, true);
    assert.equal(o.target, ts.ScriptTarget.ES2022);
    assert.equal(o.module, ts.ModuleKind.ESNext);
    assert.equal(o.moduleResolution, ts.ModuleResolutionKind.Bundler);
    assert.deepEqual(o.lib, ["lib.es2022.d.ts", "lib.dom.d.ts"]);
    assert.equal(o.skipLibCheck, true);
  });

  it("loads exactly the Node types, from an absolute typeRoots inside the project's node_modules", () => {
    const o = publisherExampleCompilerOptions();
    assert.deepEqual(o.types, ["node"]);
    assert.deepEqual(o.typeRoots, [NODE_TYPE_ROOT]);
    assert.ok(path.isAbsolute(NODE_TYPE_ROOT));
    assert.equal(NODE_TYPE_ROOT, path.join(PROJECT_ROOT, "node_modules", "@types"));
  });

  it("has no strictness-weakening or error-hiding option anywhere in the config", () => {
    const o = publisherExampleCompilerOptions() as Record<string, unknown>;
    for (const k of ["noImplicitAny", "strictNullChecks", "strictFunctionTypes", "strictBindCallApply", "strictPropertyInitialization", "noImplicitThis", "useUnknownInCatchVariables", "alwaysStrict", "suppressImplicitAnyIndexErrors", "suppressExcessPropertyErrors", "noCheck", "noStrictGenericChecks", "allowJs", "checkJs", "ignoreDeprecations"]) {
      assert.equal(k in o, false, k);
    }
    assert.deepEqual(Object.keys(o).sort(), ["lib", "module", "moduleResolution", "noEmit", "skipLibCheck", "strict", "target", "typeRoots", "types"]);
  });

  it("a custom type root only changes typeRoots", () => {
    const base = publisherExampleCompilerOptions();
    const other = publisherExampleCompilerOptions("/some/other/@types");
    assert.deepEqual(other.typeRoots, ["/some/other/@types"]);
    assert.deepEqual({ ...other, typeRoots: undefined }, { ...base, typeRoots: undefined });
  });

  it("the project root is found from the package files, not from the current working directory", () => {
    assert.ok(existsSync(path.join(PROJECT_ROOT, "package.json")));
    assert.ok(existsSync(path.join(PROJECT_ROOT, "tsconfig.json")));
    assert.equal(findProjectRoot(path.join(PROJECT_ROOT, "tests", "ads")), PROJECT_ROOT);
    const before = process.cwd();
    try {
      process.chdir(tmpdir());
      assert.equal(findProjectRoot(), PROJECT_ROOT);
      assert.deepEqual(compileForPublisherExample([], { virtualFiles: {} }), []);
    } finally {
      process.chdir(before);
    }
  });
});

describe("day 28 part 1 | the existing @types/node dependency is what is used", () => {
  it("package.json declares @types/node as a devDependency and the lockfile pins it", () => {
    const pkg = JSON.parse(read("package.json")) as { devDependencies?: Record<string, string>; dependencies?: Record<string, string> };
    assert.match(pkg.devDependencies?.["@types/node"] ?? "", /^\^?\d+\./);
    assert.equal(pkg.dependencies?.["@types/node"], undefined);
    assert.match(read("package-lock.json"), /"node_modules\/@types\/node": \{/);
  });

  it("the project tsconfig files list the same Node types", () => {
    assert.deepEqual(ts.parseConfigFileTextToJson("tsconfig.test.json", read("tsconfig.test.json")).config.compilerOptions.types, ["node"]);
  });

  it("the Node types are installed where the helper looks for them", () => {
    assert.equal(nodeTypesProblem(), null, "run `npm ci`: @types/node must be installed");
    assert.ok(existsSync(path.join(NODE_TYPE_ROOT, "node", "index.d.ts")));
  });
});

describe("day 28 part 1 | missing Node types fail clearly, never silently", () => {
  it("nodeTypesProblem and assertNodeTypesInstalled name the missing path and the fix", () => {
    withEmptyTypeRoot((dir) => {
      const msg = nodeTypesProblem(dir);
      assert.ok(msg);
      assert.ok(msg.includes(path.join(dir, "node", "index.d.ts")));
      assert.match(msg, /@types\/node/);
      assert.match(msg, /npm ci/);
      assert.throws(() => assertNodeTypesInstalled(dir), /Node type definitions not found at .*npm ci/s);
    });
  });

  it("compileForPublisherExample throws by default when the Node types are missing (no compile, no quiet pass)", () => {
    withEmptyTypeRoot((dir) => {
      const file = path.join(PROJECT_ROOT, "tests", "ads", "__virtual__", "needs-node.ts");
      assert.throws(() => compileForPublisherExample([file], { virtualFiles: { [file]: NODE_SNIPPET }, typeRoot: dir }), /Node type definitions not found/);
    });
  });

  it("when asked to compile anyway, the missing types are REPORTED: the type-definition error and the process/console errors are returned, not filtered", () => {
    withEmptyTypeRoot((dir) => {
      const file = path.join(PROJECT_ROOT, "tests", "ads", "__virtual__", "needs-node.ts");
      const diagnostics = compileForPublisherExample([file], { virtualFiles: { [file]: NODE_SNIPPET }, typeRoot: dir, requireNodeTypes: false });
      assert.ok(diagnostics.length >= 2, diagnostics.join("\n"));
      assert.ok(diagnostics.some((d) => /^TS2688: Cannot find type definition file for 'node'/.test(d)), diagnostics.join("\n"));
      assert.ok(diagnostics.some((d) => /Cannot find name 'process'/.test(d)), diagnostics.join("\n"));
    });
  });

  it("with the real Node types the same snippet compiles with no diagnostics", () => {
    const file = path.join(PROJECT_ROOT, "tests", "ads", "__virtual__", "needs-node.ts");
    assert.deepEqual(compileForPublisherExample([file], { virtualFiles: { [file]: NODE_SNIPPET } }), []);
  });

  it("neither publisher-examples.test.ts nor the helper filters or ignores Node-type errors any more", () => {
    const test = read("tests/ads/publisher-examples.test.ts");
    const helper = read("tests/ads/helpers/publisher-example-compiler.ts");
    assert.doesNotMatch(test, /Cannot find \(name\|module\)/);
    assert.doesNotMatch(test, /node:crypto\)'/);
    assert.doesNotMatch(test, /ts\.createProgram|ts\.createCompilerHost/);
    assert.doesNotMatch(helper, /Cannot find/);
    assert.match(test, /compileForPublisherExample\(/);
    assert.match(helper, /Sab diagnostics/);
  });
});

describe("day 28 part 1 | strict checking is still really strict", () => {
  const file = path.join(PROJECT_ROOT, "tests", "ads", "__virtual__", "strict-probe.ts");
  const compile = (src: string) => compileForPublisherExample([file], { virtualFiles: { [file]: src } });

  it("reports a plain type error, an implicit any, a possibly-null use and an unchecked catch variable", () => {
    assert.ok(compile('export const n: number = "x";\n').some((d) => /TS2322/.test(d)));
    assert.ok(compile("export function f(a) { return a; }\n").some((d) => /TS7006/.test(d)));
    assert.ok(compile("export const g = (s: string | null) => s.length;\n").some((d) => /TS18047/.test(d)));
    assert.ok(compile("export function h() { try { return 1; } catch (e) { return e.message; } }\n").some((d) => /TS18046/.test(d)));
  });

  it("an error-hiding comment is NOT how a real error would pass: // @ts-ignore is a source-scan failure here", () => {
    const src = ["// @ts-ignore", 'export const n: number = "x";'].join("\n");
    assert.equal(compile(src).length, 0, "the compiler honours @ts-ignore, so it must never appear in the examples");
    for (const f of EXAMPLES) assert.doesNotMatch(read(f), /@ts-(ignore|expect-error|nocheck)/, f);
  });
});

describe("day 28 part 1 | the publisher example files compile strictly, unchanged", () => {
  it("the three example files exist", () => {
    for (const f of EXAMPLES) assert.ok(existsSync(path.join(PROJECT_ROOT, f)), f);
  });

  it("contain no any, @ts-ignore, @ts-expect-error, @ts-nocheck or non-null-hiding cast", () => {
    for (const f of EXAMPLES) {
      const src = read(f);
      assert.doesNotMatch(src, /@ts-(ignore|expect-error|nocheck)/, f);
      assert.doesNotMatch(src, /:\s*any\b|\bas any\b|<any>|\bany\[\]|Array<any>|Record<string,\s*any>|\bas unknown as\b/, f);
    }
  });

  it("client.ts, types.ts and the Next.js route compile together under strict mode with no diagnostics", () => {
    assert.ok(existsSync(path.join(PROJECT_ROOT, "node_modules", "next", "package.json")), "run `npm ci`: the `next` package is required to type-check the Next.js route");
    const diagnostics = compileForPublisherExample(EXAMPLES.map((f) => path.join(PROJECT_ROOT, f)));
    assert.deepEqual(diagnostics, []);
  });

  it("client.ts and types.ts alone compile strictly with only the Node types (no framework needed)", () => {
    const diagnostics = compileForPublisherExample(EXAMPLES.slice(0, 2).map((f) => path.join(PROJECT_ROOT, f)));
    assert.deepEqual(diagnostics, []);
  });

  it("the compile does not depend on the working directory", () => {
    const before = process.cwd();
    try {
      process.chdir(tmpdir());
      const diagnostics = compileForPublisherExample(EXAMPLES.slice(0, 2).map((f) => path.join(PROJECT_ROOT, f)));
      assert.deepEqual(diagnostics, []);
    } finally {
      process.chdir(before);
    }
  });
});

describe("day 28 part 1 | scope: test configuration only", () => {
  it("the example sources are unchanged in role: still server-side, no production URL, no key value", () => {
    for (const f of EXAMPLES) {
      assert.doesNotMatch(read(f), /blc_live_[0-9a-f]{8}/i, f);
      assert.doesNotMatch(read(f), /https?:\/\/[a-z0-9.-]+\.(vercel\.app|supabase\.co)/i, f);
    }
  });

  it("no SQL file and no package script was added for Day 28", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    assert.equal(Object.values(pkg.scripts).some((v) => /day28|publisher-example/.test(v)), false);
  });
});
