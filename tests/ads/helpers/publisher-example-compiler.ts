// Publisher examples ko STRICT type-check karne ka ek hi tareeka (Day 28 Part 1).
// Pehle har test apna options banata tha, Node types cwd par depend karte the, aur missing @types/node ke errors
// chupchap filter ho jaate the. Ab: project root package.json se milta hai (cwd se nahi), typeRoots absolute hai,
// aur Node types na milen to saaf error aata hai. strict kabhi band nahi hota. Koi network / database / production nahi.
import { existsSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";

/** Project root: upar chadhkar pehla folder jisme package.json aur tsconfig.json dono hon (process.cwd() par depend nahi). */
export function findProjectRoot(from: string = __dirname): string {
  let dir = from;
  for (;;) {
    if (existsSync(path.join(dir, "package.json")) && existsSync(path.join(dir, "tsconfig.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`publisher-example-compiler: project root (package.json + tsconfig.json) not found above ${from}`);
    dir = parent;
  }
}

export const PROJECT_ROOT = findProjectRoot();
/** Project ke apne installed @types (devDependency `@types/node`). */
export const NODE_TYPE_ROOT = path.join(PROJECT_ROOT, "node_modules", "@types");

/** Exact compiler options jinse har publisher example compile hota hai. `strict: true` hamesha. */
export function publisherExampleCompilerOptions(typeRoot: string = NODE_TYPE_ROOT): ts.CompilerOptions {
  return {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
    types: ["node"],
    typeRoots: [typeRoot],
    skipLibCheck: true,
  };
}

/** Node types install nahi hain to saaf wajah (string); theek hain to null. */
export function nodeTypesProblem(typeRoot: string = NODE_TYPE_ROOT): string | null {
  const entry = path.join(typeRoot, "node", "index.d.ts");
  if (existsSync(entry)) return null;
  return `Node type definitions not found at ${entry}. Install the project's @types/node devDependency (run \`npm ci\`) before type-checking the publisher examples.`;
}

export function assertNodeTypesInstalled(typeRoot: string = NODE_TYPE_ROOT): void {
  const problem = nodeTypesProblem(typeRoot);
  if (problem) throw new Error(problem);
}

export type CompileOptions = {
  /** Absolute path -> source text. Asli file na ho to bhi compile hota hai (guide ke snippet ke liye). */
  virtualFiles?: Record<string, string>;
  /** Test ke liye: alag type root. */
  typeRoot?: string;
  /** false sirf tab, jab test jaanbujhkar missing Node types ke errors dekhna chahe. Default true: missing types par throw. */
  requireNodeTypes?: boolean;
};

const inNodeModules = (f: string) => /[\\/]node_modules[\\/]/.test(f);

/**
 * rootNames ko strict compile karta hai. Sab diagnostics lautata hai: file wale (project ke apne files) AUR bina file wale
 * (jaise Node type definition file ka na milna). Kuch bhi filter nahi hota.
 */
export function compileForPublisherExample(rootNames: string[], opts: CompileOptions = {}): string[] {
  const typeRoot = opts.typeRoot ?? NODE_TYPE_ROOT;
  if (opts.requireNodeTypes !== false) assertNodeTypesInstalled(typeRoot);
  const options = publisherExampleCompilerOptions(typeRoot);
  const host = ts.createCompilerHost(options);
  const virtual = opts.virtualFiles ?? {};
  host.getCurrentDirectory = () => PROJECT_ROOT;
  const originalGet = host.getSourceFile.bind(host);
  host.getSourceFile = (name, lang, ...rest) => (name in virtual ? ts.createSourceFile(name, virtual[name], lang) : originalGet(name, lang, ...rest));
  const originalExists = host.fileExists.bind(host);
  host.fileExists = (name) => name in virtual || originalExists(name);
  const program = ts.createProgram(rootNames, options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => !d.file || (!d.file.isDeclarationFile && !inNodeModules(d.file.fileName)))
    .map((d) => {
      const text = ts.flattenDiagnosticMessageText(d.messageText, "\n");
      if (!d.file || d.start === undefined) return `TS${d.code}: ${text}`;
      const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
      return `${path.basename(d.file.fileName)}(${line + 1},${character + 1}) TS${d.code}: ${text}`;
    });
}
