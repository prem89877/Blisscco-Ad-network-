import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import * as route from "@/app/api/revive-json-preview/route";
import {
  PREVIEW_CONTENT_TYPE,
  PREVIEW_ENV_FLAG,
  PREVIEW_PROVIDER_TIMEOUT_MS,
  defaultPreviewProvider,
  handlePreviewGet,
  previewEnabled,
} from "@/lib/ads/revive-json-preview";
import { validateJsonEndpointText } from "@/lib/ads/revive-json-endpoint-contract";
import { reviveFallbackEnabled } from "@/lib/ads/fallback-provider";
import { parseReviveEnv } from "@/lib/ads/revive-adapter";

// Day 24 Part 2: preview route prototype. Pure/in-memory: koi network, DB, credential ya Revive server nahi.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const ROUTE_FILE = "app/api/revive-json-preview/route.ts";
const LIB_FILE = "lib/ads/revive-json-preview.ts";
const ON = { REVIVE_JSON_PREVIEW_ENABLED: "true" };
const SECRET = "SECRETVALUE9911";
const NOT_FOUND = '{"error":"not_found"}';
const UNAVAILABLE = '{"error":"unavailable"}';
const good = { headline: "Provider headline", body: "Provider body.", cta_text: "Go", destination_url: "https://example.com/p" };

const text = async (r: Response) => r.text();
const hdr = (r: Response) => Object.fromEntries([...r.headers.entries()].sort());

async function withEnv<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const before = process.env.REVIVE_JSON_PREVIEW_ENABLED;
  if (value === undefined) delete process.env.REVIVE_JSON_PREVIEW_ENABLED;
  else process.env.REVIVE_JSON_PREVIEW_ENABLED = value;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.REVIVE_JSON_PREVIEW_ENABLED;
    else process.env.REVIVE_JSON_PREVIEW_ENABLED = before;
  }
}

describe("day 24 part 2 | disabled by default", () => {
  it("only the exact value 'true' enables it", () => {
    assert.equal(PREVIEW_ENV_FLAG, "REVIVE_JSON_PREVIEW_ENABLED");
    assert.equal(previewEnabled({}), false);
    assert.equal(previewEnabled(null), false);
    assert.equal(previewEnabled(undefined), false);
    for (const v of ["", "1", "TRUE", "True", "yes", " true", "true ", "false", "on"]) assert.equal(previewEnabled({ [PREVIEW_ENV_FLAG]: v }), false, JSON.stringify(v));
    assert.equal(previewEnabled(ON), true);
  });

  it("disabled => fixed 404 with a fixed body, whatever the env contains", async () => {
    const envs = [{}, { REVIVE_JSON_PREVIEW_ENABLED: "false" }, { REVIVE_JSON_PREVIEW_ENABLED: "TRUE" }, { REVIVE_FALLBACK_ENABLED: "true", REVIVE_DELIVERY_URL: `https://x.example.com/?t=${SECRET}` }];
    const bodies = new Set<string>();
    const headers = new Set<string>();
    for (const env of envs) {
      const r = await handlePreviewGet({ env, provider: () => good });
      assert.equal(r.status, 404);
      bodies.add(await text(r));
      headers.add(JSON.stringify(hdr(r)));
    }
    assert.deepEqual([...bodies], [NOT_FOUND]);
    assert.equal(headers.size, 1);
  });

  it("disabled never calls the provider", async () => {
    let calls = 0;
    await handlePreviewGet({ env: {}, provider: () => { calls += 1; return good; } });
    assert.equal(calls, 0);
  });

  it("the 404 does not reveal configuration, the flag name or that a flag exists", async () => {
    const r = await handlePreviewGet({ env: { REVIVE_DELIVERY_URL: `https://x.example.com/?t=${SECRET}` } });
    const shown = `${await text(r)} ${JSON.stringify(hdr(r))}`;
    assert.ok(!/revive|flag|enabled|disabled|env|config|preview|secret/i.test(shown), shown);
    assert.ok(!shown.includes(SECRET));
  });

  it("the real route is disabled when the env flag is unset or not 'true'", async () => {
    for (const v of [undefined, "false", "1", "TRUE"]) {
      const r = await withEnv(v, () => route.GET());
      assert.equal(r.status, 404, String(v));
      assert.equal(await text(r), NOT_FOUND);
    }
  });

  it("the preview flag is separate from the Revive fallback flag, in both directions", () => {
    assert.equal(reviveFallbackEnabled({ REVIVE_JSON_PREVIEW_ENABLED: "true" }), false);
    assert.deepEqual(parseReviveEnv({ REVIVE_JSON_PREVIEW_ENABLED: "true", REVIVE_DELIVERY_URL: "https://x.example.com/a" }), { ok: false, reason: "disabled" });
    assert.equal(previewEnabled({ REVIVE_FALLBACK_ENABLED: "true" }), false);
  });
});

describe("day 24 part 2 | enabled response", () => {
  it("returns 200 with exactly the four contract fields from the provider", async () => {
    const r = await handlePreviewGet({ env: ON, provider: () => good });
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(await text(r)), good);
  });

  it("the default provider gives a fixed example.com test creative the contract validator accepts", async () => {
    const r = await handlePreviewGet({ env: ON });
    assert.equal(r.status, 200);
    const body = await text(r);
    const v = validateJsonEndpointText(body, { strictFields: true });
    assert.ok(v.ok);
    assert.match(v.creative.headline, /TEST FIXTURE/);
    assert.equal(new URL(v.creative.destinationUrl).hostname, "example.com");
    assert.deepEqual(Object.keys(JSON.parse(body)), ["headline", "body", "cta_text", "destination_url"]);
  });

  it("the real route returns the fixed test creative when the env flag is 'true'", async () => {
    const r = await withEnv("true", () => route.GET());
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(await text(r)), defaultPreviewProvider());
  });

  it("the response is the validated, normalized creative, not the raw provider output (extra fields dropped, text trimmed, cta null)", async () => {
    const r = await handlePreviewGet({ env: ON, provider: () => ({ ...good, headline: "  Padded  ", cta_text: "  ", internal: SECRET, price: 5 }) });
    assert.equal(r.status, 200);
    const body = await text(r);
    assert.ok(!body.includes(SECRET));
    assert.deepEqual(JSON.parse(body), { headline: "Padded", body: good.body, cta_text: null, destination_url: good.destination_url });
  });

  it("an async provider works and is called with no arguments", async () => {
    const args: unknown[][] = [];
    const r = await handlePreviewGet({ env: ON, provider: async (...a: unknown[]) => { args.push(a); return good; } });
    assert.equal(r.status, 200);
    assert.deepEqual(args, [[]]);
  });

  it("the output is accepted by the existing adapter's content rules (round trip through the contract)", async () => {
    const body = await text(await handlePreviewGet({ env: ON }));
    assert.ok(new TextEncoder().encode(body).byteLength <= 65536);
    assert.equal(validateJsonEndpointText(body).ok, true);
  });
});

describe("day 24 part 2 | headers", () => {
  const cases: Array<[string, () => Promise<Response>]> = [
    ["200", () => handlePreviewGet({ env: ON, provider: () => good })],
    ["404", () => handlePreviewGet({ env: {} })],
    ["503", () => handlePreviewGet({ env: ON, provider: () => ({}) })],
  ];

  it("every response has strict JSON content type, no-store and nosniff", async () => {
    for (const [name, run] of cases) {
      const r = await run();
      assert.equal(r.headers.get("content-type"), PREVIEW_CONTENT_TYPE, name);
      assert.equal(PREVIEW_CONTENT_TYPE, "application/json; charset=utf-8");
      assert.equal(r.headers.get("cache-control"), "no-store", name);
      assert.equal(r.headers.get("x-content-type-options"), "nosniff", name);
    }
  });

  it("no cookies, no redirects, no CORS, no auth headers, only 200/404/503", async () => {
    for (const [name, run] of cases) {
      const r = await run();
      assert.ok([200, 404, 503].includes(r.status), name);
      assert.equal(r.redirected, false);
      for (const h of ["set-cookie", "location", "refresh", "access-control-allow-origin", "access-control-allow-credentials", "www-authenticate", "authorization"]) {
        assert.equal(r.headers.get(h), null, `${name}: ${h}`);
      }
      assert.deepEqual(Object.keys(hdr(r)).sort(), ["cache-control", "content-type", "x-content-type-options"], name);
    }
  });

  it("the body of every response parses as one JSON object", async () => {
    for (const [name, run] of cases) {
      const v = JSON.parse(await text(await run()));
      assert.ok(v !== null && typeof v === "object" && !Array.isArray(v), name);
    }
  });
});

describe("day 24 part 2 | malformed provider output and failures", () => {
  const bad: Array<[string, unknown]> = [
    ["null", null],
    ["undefined", undefined],
    ["string", "<script>alert(1)</script>"],
    ["array", [good]],
    ["empty object", {}],
    ["missing destination", { headline: "h", body: "b" }],
    ["http destination", { ...good, destination_url: "http://example.com/a" }],
    ["javascript destination", { ...good, destination_url: "javascript:alert(1)" }],
    ["destination with credentials", { ...good, destination_url: `https://u:${SECRET}@example.com/a` }],
    ["markup in headline", { ...good, headline: `<b>${SECRET}</b>` }],
    ["entity in body", { ...good, body: `a &amp; ${SECRET}` }],
    ["control char", { ...good, body: "a\nb" }],
    ["too long headline", { ...good, headline: "h".repeat(91) }],
    ["executable key", { ...good, html: `<p>${SECRET}</p>` }],
    ["script key", { ...good, script: SECRET }],
    ["oversized", { ...good, pad: "x".repeat(70000) }],
  ];

  it("each malformed provider output => fixed 503 with a fixed body that leaks nothing", async () => {
    for (const [name, value] of bad) {
      const r = await handlePreviewGet({ env: ON, provider: () => value });
      assert.equal(r.status, 503, name);
      const body = await text(r);
      assert.equal(body, UNAVAILABLE, name);
      assert.ok(!body.includes(SECRET) && !/example|http|script|html/i.test(body), name);
    }
  });

  it("a throwing or rejecting provider => the same fixed 503 (error text never returned)", async () => {
    for (const provider of [
      () => { throw new Error(`boom ${SECRET}`); },
      async () => { throw new Error(`boom ${SECRET}`); },
      () => Promise.reject(new Error(SECRET)),
    ]) {
      const r = await handlePreviewGet({ env: ON, provider });
      assert.equal(r.status, 503);
      const body = await text(r);
      assert.equal(body, UNAVAILABLE);
      assert.ok(!body.includes(SECRET));
    }
  });

  it("a provider that never answers hits the deadline => fixed 503, and the default deadline is bounded", async () => {
    assert.ok(PREVIEW_PROVIDER_TIMEOUT_MS > 0 && PREVIEW_PROVIDER_TIMEOUT_MS <= 3000);
    const t0 = Date.now();
    const r = await handlePreviewGet({ env: ON, provider: () => new Promise(() => undefined), timeoutMs: 30 });
    assert.equal(r.status, 503);
    assert.equal(await text(r), UNAVAILABLE);
    assert.ok(Date.now() - t0 < 1000);
  });

  it("a late rejection after the deadline does not become an unhandled rejection", async () => {
    let unhandled = 0;
    const onUnhandled = () => { unhandled += 1; };
    process.on("unhandledRejection", onUnhandled);
    try {
      const r = await handlePreviewGet({ env: ON, timeoutMs: 10, provider: () => new Promise((_, rej) => setTimeout(() => rej(new Error(SECRET)), 40)) });
      assert.equal(r.status, 503);
      await new Promise((res) => setTimeout(res, 80));
      assert.equal(unhandled, 0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("a hostile env object never makes the handler throw", async () => {
    const env = new Proxy({}, { get() { throw new Error(SECRET); } });
    const r = await handlePreviewGet({ env: env as never });
    assert.ok([404, 503].includes(r.status));
    assert.ok(!(await text(r)).includes(SECRET));
  });
});

describe("day 24 part 2 | query parameters, headers and cookies cannot control anything", () => {
  const EVIL = "https://evil.example.org/steal?x=1";
  const queries = [
    `destination_url=${encodeURIComponent(EVIL)}`,
    `headline=Hacked&body=Hacked&cta_text=Hacked`,
    `url=${encodeURIComponent(EVIL)}&redirect=${encodeURIComponent(EVIL)}`,
    `creative=${encodeURIComponent(JSON.stringify({ ...good, destination_url: EVIL }))}`,
    `html=%3Cscript%3Ealert(1)%3C/script%3E&format=html&provider=other&enabled=true&REVIVE_JSON_PREVIEW_ENABLED=true`,
  ];

  it("with the route enabled, any query string gives byte-for-byte the same body and headers", async () => {
    const baseline = await withEnv("true", () => route.GET());
    const baseBody = await text(baseline);
    for (const q of queries) {
      const req = new Request(`https://app.example.com/api/revive-json-preview?${q}`, { headers: { cookie: `session=${SECRET}`, authorization: `Bearer ${SECRET}`, "x-forwarded-host": "evil.example.org" } });
      const r = await withEnv("true", () => (route.GET as unknown as (r: Request) => Promise<Response>)(req));
      assert.equal(r.status, 200);
      assert.equal(await text(r), baseBody, q);
      assert.deepEqual(hdr(r), hdr(baseline), q);
      assert.ok(!baseBody.includes("evil") && !baseBody.includes("Hacked"));
    }
  });

  it("with the route disabled, a query string cannot enable it", async () => {
    for (const q of queries) {
      const req = new Request(`https://app.example.com/api/revive-json-preview?${q}`);
      const r = await withEnv(undefined, () => (route.GET as unknown as (r: Request) => Promise<Response>)(req));
      assert.equal(r.status, 404);
      assert.equal(await text(r), NOT_FOUND);
    }
  });

  it("the handler never touches a request: even a request whose every property throws changes nothing", async () => {
    const hostile = new Proxy({}, { get() { throw new Error(SECRET); }, has() { throw new Error(SECRET); } });
    const r = await withEnv("true", () => (route.GET as unknown as (r: unknown) => Promise<Response>)(hostile));
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(await text(r)), defaultPreviewProvider());
  });

  it("the provider is only ever called with no arguments, so it cannot see query, headers or cookies", async () => {
    const seen: number[] = [];
    await handlePreviewGet({ env: ON, provider: (...a: unknown[]) => { seen.push(a.length); return good; } });
    assert.deepEqual(seen, [0]);
  });

  it("the route and handler source never read the request, URL, headers, cookies or auth", () => {
    for (const f of [ROUTE_FILE, LIB_FILE]) {
      const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      assert.doesNotMatch(code, /searchParams|URLSearchParams|new URL|request\b|\.url\b|headers\(|cookies\(|next\/headers|\.cookies|authorization|bearer|getHeader|\.headers\.get/i, f);
    }
    assert.match(read(ROUTE_FILE), /export async function GET\(\) \{/);
  });
});

describe("day 24 part 2 | isolated prototype: nothing else is connected", () => {
  const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("the route exports only GET, runtime and dynamic (nothing else a build would reject)", () => {
    assert.deepEqual(Object.keys(route).sort(), ["GET", "dynamic", "runtime"]);
    assert.equal(route.runtime, "nodejs");
    assert.equal(route.dynamic, "force-dynamic");
    for (const m of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) assert.equal((route as Record<string, unknown>)[m], undefined, m);
  });

  it("route imports only the preview handler; handler imports only the contract validator", () => {
    assert.deepEqual([...code(ROUTE_FILE).matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]), ["@/lib/ads/revive-json-preview"]);
    assert.deepEqual([...code(LIB_FILE).matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]), ["./revive-json-endpoint-contract"]);
  });

  it("no publisher match API, Revive adapter or fallback, DB, billing, ledger, tracking or network code is referenced", () => {
    for (const f of [ROUTE_FILE, LIB_FILE]) {
      assert.doesNotMatch(code(f), /match-handler|handleMatch|\/ads\/match|revive-adapter|fallback|supabase|ledger|billing|payout|impression|click|tracking|\bfetch\s*\(|console\.|\bsql\b|NEXT_PUBLIC_/i, f);
    }
  });

  it("the only env name read is REVIVE_JSON_PREVIEW_ENABLED (no delivery URL, timeout or format variables)", () => {
    const names = new Set([...(code(LIB_FILE) + code(ROUTE_FILE)).matchAll(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]{3,}\b/g)].map((m) => m[0]));
    assert.deepEqual([...names].filter((n) => /REVIVE|DELIVERY|ENV|SECRET|KEY|TOKEN/.test(n)).sort(), ["PREVIEW_ENV_FLAG", "REVIVE_JSON_PREVIEW_ENABLED"]);
  });

  it("no production file imports the preview handler or links to the route (match API, fallback, service unchanged)", () => {
    const walk = (dir: string): string[] =>
      existsSync(path.join(ROOT, dir))
        ? readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
            e.isDirectory() ? (e.name === "node_modules" || e.name === ".next" ? [] : walk(`${dir}/${e.name}`)) : [`${dir}/${e.name}`],
          )
        : [];
    for (const f of [...walk("lib"), ...walk("app"), ...walk("components"), "middleware.ts"]) {
      if (f === LIB_FILE || f === ROUTE_FILE || f === "lib/ads/revive-json-preview-provider.ts" || !/\.(ts|tsx)$/.test(f)) continue; // Day 24 Part 3: alag placeholder provider (tests/ads/day24-part3 usse bandhta hai)
      assert.doesNotMatch(read(f), /revive-json-preview|REVIVE_JSON_PREVIEW_ENABLED/, f);
    }
  });

  it("no SQL, migration, package, env example or workflow file mentions the preview route or flag", () => {
    const files = [
      ...(existsSync(path.join(ROOT, "supabase")) ? readdirSync(path.join(ROOT, "supabase"), { recursive: true }).map((f) => `supabase/${String(f)}`) : []),
      "package.json", ".env.example", "next.config.mjs", "middleware.ts",
    ].filter((f) => existsSync(path.join(ROOT, f)) && /\.(sql|json|example|mjs|ts)$/.test(f));
    for (const f of files) assert.doesNotMatch(read(f), /revive-json-preview|REVIVE_JSON_PREVIEW/, f);
  });

  it("the route path is public-API-only: not covered by the auth middleware matcher", () => {
    assert.doesNotMatch(read("middleware.ts"), /revive-json-preview/);
    assert.match(read("middleware.ts"), /matcher:\s*\["\/dashboard\/:path\*", "\/login", "\/signup"\]/);
  });
});

// Day 27 Part 3: regression hardening of the REAL route (route.GET), not just the handler.
describe("day 27 part 3 | real route: disabled 404, JSON content type, no-store, no redirect", () => {
  const SECURITY_HEADERS = ["cache-control", "content-type", "x-content-type-options"];
  const FORBIDDEN_HEADERS = ["location", "refresh", "set-cookie", "access-control-allow-origin", "access-control-allow-credentials", "www-authenticate", "link", "content-location"];

  it("disabled (flag unset / not exact 'true'): 404, exact fixed body, JSON content type, no-store, nosniff, nothing else", async () => {
    for (const v of [undefined, "", "false", "1", "TRUE", " true", "true "]) {
      const r = await withEnv(v, () => route.GET());
      assert.equal(r.status, 404, String(v));
      assert.equal(await text(r), NOT_FOUND, String(v));
      assert.equal(r.headers.get("content-type"), "application/json; charset=utf-8");
      assert.equal(r.headers.get("cache-control"), "no-store");
      assert.equal(r.headers.get("x-content-type-options"), "nosniff");
      assert.deepEqual(Object.keys(hdr(r)).sort(), SECURITY_HEADERS);
    }
  });

  it("disabled 404 is byte-for-byte identical for every disabled state (cannot distinguish 'off' from 'garbage')", async () => {
    const seen = new Set<string>();
    for (const v of [undefined, "", "false", "yes", "TRUE"]) {
      const r = await withEnv(v, () => route.GET());
      seen.add(`${r.status}|${JSON.stringify(hdr(r))}|${await text(r)}`);
    }
    assert.equal(seen.size, 1);
  });

  it("enabled: 200, JSON content type, no-store, nosniff, body parses to one object", async () => {
    const r = await withEnv("true", () => route.GET());
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Object.keys(hdr(r)).sort(), SECURITY_HEADERS);
    const body = JSON.parse(await text(r)) as unknown;
    assert.ok(body !== null && typeof body === "object" && !Array.isArray(body));
  });

  it("never a redirect: status is never 3xx, redirected is false, and no redirect/cookie/CORS/link header exists (disabled and enabled)", async () => {
    for (const v of [undefined, "true"]) {
      const r = await withEnv(v, () => route.GET());
      assert.ok(r.status === 200 || r.status === 404, String(r.status));
      assert.ok(!(r.status >= 300 && r.status < 400));
      assert.equal(r.redirected, false);
      assert.equal(r.type, "default");
      for (const h of FORBIDDEN_HEADERS) assert.equal(r.headers.get(h), null, h);
    }
  });

  it("a mocked fetch is never called by the route (no outbound request in either state)", async () => {
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => { calls += 1; throw new Error("test: preview route must not fetch"); }) as typeof fetch;
    try {
      for (const v of [undefined, "true"]) await withEnv(v, () => route.GET());
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("an HTTP client that refuses redirects (redirect:'error' semantics) sees the response directly: status 200/404 only", async () => {
    // Simulates what the manual check does: if the route ever produced a 3xx it would be visible as status/Location here.
    for (const v of [undefined, "true"]) {
      const r = await withEnv(v, () => route.GET());
      assert.equal(r.headers.get("location"), null);
      assert.ok([200, 404].includes(r.status));
    }
  });
});
