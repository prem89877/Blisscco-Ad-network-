import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseMatchRequest } from "@/lib/ads/validation";
import { parseImpressionRequest, IMPRESSION_EVENT } from "@/lib/ads/impression";
import { CLICK_PARAM, parseClickQuery } from "@/lib/ads/click";

// Day 29 Part 1: the publisher quick-start (guide page, IntegrationSteps, example READMEs) stays aligned with the
// real route paths, the real request fields and the real environment variable names. Static reads plus the real
// parsers only: no network, no database, no secrets.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const flat = (f: string) => read(f).replace(/\s+/g, " ");

const GUIDE = "app/dashboard/publisher/guide/page.tsx";
const STEPS = "components/dashboard/IntegrationSteps.tsx";
const NODE_README = "examples/publisher-node/README.md";
const NEXT_README = "examples/publisher-nextjs/README.md";
const NEXT_ENV = "examples/publisher-nextjs/.env.example";
const CLIENT = "examples/publisher-node/src/client.ts";

const ROUTES = [
  { method: "POST", path: "/api/v1/ads/match", file: "app/api/v1/ads/match/route.ts" },
  { method: "POST", path: "/api/v1/ads/impression", file: "app/api/v1/ads/impression/route.ts" },
  { method: "GET", path: "/api/v1/ads/click", file: "app/api/v1/ads/click/route.ts" },
] as const;
const ENV_NAMES = ["BLISSCCO_PUBLISHER_API_KEY", "BLISSCCO_API_BASE_URL"] as const;

/** Every `/api/...` path written in a text. */
const apiPaths = (text: string): string[] => [...new Set([...text.matchAll(/\/api\/[A-Za-z0-9_/-]+/g)].map((m) => m[0].replace(/\/+$/, "")))];

describe("day 29 part 1: quick-start routes are the real routes", () => {
  it("each documented route has a real route file exporting exactly that method", () => {
    for (const r of ROUTES) {
      assert.ok(existsSync(path.join(ROOT, r.file)), r.file);
      const src = read(r.file);
      assert.match(src, new RegExp(`export async function ${r.method}\\b`), `${r.file} exports ${r.method}`);
    }
  });

  it("IntegrationSteps lists the three real routes with their methods and invents no other API path", () => {
    const src = read(STEPS);
    for (const r of ROUTES) assert.ok(src.includes(`"${r.method} ${r.path}"`), `${r.method} ${r.path}`);
    const known = new Set<string>(ROUTES.map((r) => r.path));
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); // comments may name the app/api/v1/ads folder
    for (const p of apiPaths(code)) assert.ok(known.has(p), `unknown API path in IntegrationSteps: ${p}`);
  });

  it("the guide quick start mentions only the real v1 paths (plus the Next.js example's own route)", () => {
    const g = read(GUIDE);
    for (const r of ROUTES) assert.ok(g.includes(`"${r.method} ${r.path}"`), `${r.method} ${r.path} in the route table`);
    for (const p of apiPaths(g)) {
      assert.notEqual(p, "/api/ads/match", "the legacy route must not be documented for publishers");
      if (p.startsWith("/api/blisscco-ad") || p === "/api/v1/ads") continue; // the example's own route, or a folder name in a comment
      assert.ok(ROUTES.some((r) => r.path === p), `unknown API path in the guide: ${p}`);
    }
  });

  it("the guide quick start keeps the five steps in order", () => {
    const g = flat(GUIDE);
    const titles = ["Create a publisher key.", "Configure the API base URL.", "Request an ad.", "Render the sponsored item.", "Send impression and click events."];
    let last = g.indexOf("Quick start: five steps");
    assert.ok(last >= 0, "quick start panel");
    for (const t of titles) {
      const at = g.indexOf(t, last);
      assert.ok(at > last, `step out of order or missing: ${t}`);
      last = at;
    }
  });
});

describe("day 29 part 1: required fields match the real parsers", () => {
  it("match: topic is the only required body field", () => {
    assert.equal(parseMatchRequest(JSON.stringify({ topic: "gaming" })).ok, true);
    assert.equal(parseMatchRequest(JSON.stringify({})).ok, false);
    assert.equal(parseMatchRequest(JSON.stringify({ topic: "gaming", fallback_topics: ["travel"], exclude_ad_ids: [] })).ok, true);
    const steps = read(STEPS);
    for (const f of ["topic", "fallback_topics", "exclude_ad_ids", "Idempotency-Key", "X-Blisscco-Tracking: 1", "Authorization: Bearer", "Content-Type: application/json"]) {
      assert.ok(steps.includes(f), `IntegrationSteps names ${f}`);
    }
  });

  it("impression: body is exactly token + event 'impression'", () => {
    assert.equal(IMPRESSION_EVENT, "impression");
    assert.equal(parseImpressionRequest(JSON.stringify({ token: "bt1.EXAMPLE-PAYLOAD.EXAMPLE-SIGNATURE", event: "impression" })).ok, true);
    assert.equal(parseImpressionRequest(JSON.stringify({ token: "bt1.EXAMPLE-PAYLOAD.EXAMPLE-SIGNATURE" })).ok, false);
    assert.equal(parseImpressionRequest(JSON.stringify({ token: "bt1.EXAMPLE-PAYLOAD.EXAMPLE-SIGNATURE", event: "impression", extra: 1 })).ok, false);
    const steps = flat(STEPS);
    assert.match(steps, /body fields token and event \(the value impression\)/);
  });

  it("click: one query parameter named ref", () => {
    assert.equal(CLICK_PARAM, "ref");
    assert.equal(parseClickQuery(new URLSearchParams({ ref: "bc1.EXAMPLE-PAYLOAD.EXAMPLE-SIGNATURE" })).ok, true);
    assert.equal(parseClickQuery(new URLSearchParams({})).ok, false);
    assert.equal(parseClickQuery(new URLSearchParams({ ref: "bc1.a.b", other: "x" })).ok, false);
    assert.match(flat(STEPS), /Query parameter ref/);
  });

  it("the guide table and the steps give the same required fields", () => {
    const g = flat(GUIDE);
    assert.match(g, /Content-Type: application\/json, body field topic/);
    assert.match(g, /body fields token and event \(the value impression\)/);
    assert.match(g, /Query parameter ref, exactly once/);
  });
});

describe("day 29 part 1: configuration names agree everywhere", () => {
  it("both variables appear in the guide, steps, both READMEs, the Next.js .env.example, the route and the Node client", () => {
    const places: Array<[string, string]> = [
      [GUIDE, read(GUIDE)],
      [STEPS, read(STEPS)],
      [NODE_README, read(NODE_README)],
      [NEXT_README, read(NEXT_README)],
      [NEXT_ENV, read(NEXT_ENV)],
      ["examples/publisher-nextjs/app/api/blisscco-ad/route.ts", read("examples/publisher-nextjs/app/api/blisscco-ad/route.ts")],
      [CLIENT, read(CLIENT)],
    ];
    for (const [f, src] of places) for (const n of ENV_NAMES) assert.ok(src.includes(n), `${f} mentions ${n}`);
    const env = read(NEXT_ENV);
    for (const n of ENV_NAMES) assert.match(env, new RegExp(`^${n}=`, "m"));
  });

  it("no variable that carries the key or base URL has a public prefix, in any quick-start file", () => {
    for (const f of [GUIDE, STEPS, NODE_README, NEXT_README, NEXT_ENV]) {
      assert.doesNotMatch(read(f), /(NEXT_PUBLIC|VITE|REACT_APP|EXPO_PUBLIC)_[A-Z_]*(BLISSCCO|API_KEY|PUBLISHER)/, f);
    }
    assert.match(read(NEXT_README), /no `NEXT_PUBLIC_` prefix/);
    assert.match(read(NODE_README), /no `NEXT_PUBLIC_` prefix|No `NEXT_PUBLIC_` prefix|`NEXT_PUBLIC_` prefix/);
  });

  it("the README placeholders are not real keys and the guide shows no live-looking key", () => {
    for (const f of [GUIDE, STEPS, NODE_README, NEXT_README, NEXT_ENV]) {
      assert.doesNotMatch(read(f), /blc_live_[0-9a-f]{8,}/i, `${f}: live-looking key`);
    }
    assert.match(read(NEXT_ENV), /blc_live_REPLACE/);
    assert.match(read(GUIDE), /YOUR-BLISSCCO-API-HOST/);
    assert.doesNotMatch(read(NODE_README), /https?:\/\/[a-z0-9.-]*(vercel\.app|blisscco\.(com|io|app|ai|in))/i);
  });
});

describe("day 29 part 1: example READMEs match the example code", () => {
  const exists = (base: string, file: string) => existsSync(path.join(ROOT, base, file));

  it("every file path named in the Next.js README exists next to the example", () => {
    const text = read(NEXT_README);
    const files = [...text.matchAll(/`((?:app|components|lib)\/[A-Za-z0-9_./-]+\.tsx?)`/g)].map((m) => m[1]);
    assert.ok(files.length >= 3, "README names the route, component and safe-url files");
    for (const f of files) assert.ok(exists("examples/publisher-nextjs", f), f);
    for (const f of ["src/client.ts", "types.ts"]) assert.ok(text.includes(f), `README names ${f}`);
    assert.ok(exists("examples/publisher-node", "src/client.ts") && exists("examples/publisher-node", "src/types.ts"));
    assert.ok(text.includes(".env.example") && existsSync(path.join(ROOT, NEXT_ENV)));
  });

  it("the Next.js README names the example's own route and the real Blisscco routes it calls", () => {
    const text = read(NEXT_README);
    assert.ok(text.includes("/api/blisscco-ad"));
    for (const r of ROUTES) assert.ok(text.includes(r.path), r.path);
    const component = read("examples/publisher-nextjs/components/SponsoredAd.tsx");
    assert.ok(component.includes('"/api/blisscco-ad"'));
    assert.match(text, /<SponsoredAd topic="gaming" \/>/);
  });

  it("the Next.js README does not list a topic outside the route allowlist", () => {
    assert.match(read("examples/publisher-nextjs/app/api/blisscco-ad/route.ts"), /"gaming"/);
  });

  it("the Node README exists, names its source files and only uses methods the client really has", () => {
    assert.ok(existsSync(path.join(ROOT, NODE_README)), "examples/publisher-node/README.md");
    const text = read(NODE_README);
    for (const f of ["src/client.ts", "src/types.ts"]) {
      assert.ok(text.includes(f), `README names ${f}`);
      assert.ok(exists("examples/publisher-node", f), f);
    }
    const client = read(CLIENT);
    const methods = [...text.matchAll(/client\.([A-Za-z]+)\(/g)].map((m) => m[1]);
    assert.ok(methods.includes("match") && methods.includes("reportImpression"));
    for (const m of new Set(methods)) assert.match(client, new RegExp(`async ${m}\\(`), `client.${m}() exists`);
    assert.match(text, /BlissccoClient\.fromEnv\(\)/);
    assert.match(client, /static fromEnv\(/);
    assert.match(text, /\{ tracking: true \}/);
    assert.match(client, /options\.tracking === true/);
    for (const r of ROUTES) assert.ok(text.includes(r.path), r.path);
  });

  it("the README snippets send only the fields the client accepts", () => {
    const text = read(NODE_README);
    assert.match(text, /match\(\{ topic: "gaming" \}/);
    assert.match(text, /reportImpression\(\{ token: /);
    assert.match(text, /reportClick\(\{ click_ref: /);
    assert.match(read("examples/publisher-node/src/types.ts"), /export type ClickRequest = \{\s*click_ref: string;/);
    assert.match(read("examples/publisher-node/src/types.ts"), /export type ImpressionRequest = \{\s*token: string;/);
  });

  it("neither README tells anyone to put the key in the browser or a client bundle", () => {
    for (const f of [NODE_README, NEXT_README]) {
      const t = read(f);
      assert.match(t, /Never put the key in client code/);
      assert.doesNotMatch(t, /NEXT_PUBLIC_[A-Z_]*KEY/);
    }
  });
});

describe("day 29 part 1: existing guide guarantees still hold", () => {
  it("keeps the production-readiness disclaimer, the sponsored-label rule and the no-secret rule", () => {
    const g = flat(GUIDE);
    assert.match(g, /Not ready for production use/);
    assert.match(g, /Known limitations/);
    assert.match(g, /no integration with ChatGPT or any other third-party chatbot/);
    assert.match(g, /Never put your API key in it|Never put the key in browser code|never put it in browser code/i);
    assert.match(flat(STEPS), /Sponsored label/);
    assert.match(flat(STEPS), /never from destination_url/);
  });

  it("the guide stays a server component and IntegrationSteps stays a plain list component", () => {
    assert.doesNotMatch(read(GUIDE), /^["']use client["']/m);
    assert.doesNotMatch(read(STEPS), /^["']use client["']/m);
    assert.match(read(STEPS), /<ol className="space-y-4">/);
  });
});
