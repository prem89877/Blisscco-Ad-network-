import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import {
  PLACEHOLDER_BODY,
  PLACEHOLDER_CTA,
  PLACEHOLDER_DESTINATION,
  PLACEHOLDER_HEADLINE,
  PLACEHOLDER_PROVIDER_FLAG,
  getPlaceholderPreviewCreative,
  placeholderPreviewProvider,
  placeholderProviderEnabled,
} from "@/lib/ads/revive-json-preview-provider";
import { PREVIEW_ENV_FLAG, handlePreviewGet } from "@/lib/ads/revive-json-preview";
import { validateJsonEndpointPayload } from "@/lib/ads/revive-json-endpoint-contract";

// Day 24 Part 3: placeholder provider. Pure/in-memory: koi network, DB, credential ya Revive server nahi.

const ROOT = path.join(__dirname, "..", "..", "..");
const FILE = "lib/ads/revive-json-preview-provider.ts";
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n"); // sirf poori-line comments (string ke andar "https://" na kate)
const code = (f: string) => strip(read(f));
const ON = { REVIVE_JSON_PREVIEW_ENABLED: "true" };
const SECRET = "SECRETVALUE9911";

const walk = (dir: string): string[] =>
  existsSync(path.join(ROOT, dir))
    ? readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? (e.name === "node_modules" || e.name === ".next" ? [] : walk(`${dir}/${e.name}`)) : [`${dir}/${e.name}`],
      )
    : [];

async function withEnv<T>(value: string | undefined, fn: () => Promise<T> | T): Promise<T> {
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

describe("day 24 part 3 | disabled state", () => {
  it("uses the same flag name as the preview handler", () => {
    assert.equal(PLACEHOLDER_PROVIDER_FLAG, "REVIVE_JSON_PREVIEW_ENABLED");
    assert.equal(PLACEHOLDER_PROVIDER_FLAG, PREVIEW_ENV_FLAG);
  });

  it("only the exact value 'true' enables it", () => {
    assert.equal(placeholderProviderEnabled({}), false);
    assert.equal(placeholderProviderEnabled(null), false);
    assert.equal(placeholderProviderEnabled(undefined), false);
    for (const v of ["", "1", "TRUE", "True", "yes", " true", "true ", "false", "on"]) {
      assert.equal(placeholderProviderEnabled({ [PLACEHOLDER_PROVIDER_FLAG]: v }), false, JSON.stringify(v));
    }
    assert.equal(placeholderProviderEnabled(ON), true);
  });

  it("disabled => null, whatever else the env contains", () => {
    const envs = [{}, { REVIVE_JSON_PREVIEW_ENABLED: "false" }, { REVIVE_JSON_PREVIEW_ENABLED: "TRUE" }, { REVIVE_FALLBACK_ENABLED: "true", REVIVE_DELIVERY_URL: `https://x.example.com/?t=${SECRET}` }];
    for (const env of envs) assert.equal(getPlaceholderPreviewCreative(env), null);
    assert.equal(getPlaceholderPreviewCreative(null), null);
  });

  it("the fallback flag alone never enables it", () => {
    assert.equal(getPlaceholderPreviewCreative({ REVIVE_FALLBACK_ENABLED: "true" }), null);
  });

  it("with no env argument it reads process.env: unset => null, 'true' => creative", async () => {
    assert.equal(await withEnv(undefined, () => getPlaceholderPreviewCreative()), null);
    assert.equal(await withEnv("false", () => placeholderPreviewProvider()), null);
    assert.notEqual(await withEnv("true", () => placeholderPreviewProvider()), null);
  });

  it("a hostile env object never makes it throw", () => {
    const env = new Proxy({}, { get() { throw new Error(SECRET); } });
    assert.equal(getPlaceholderPreviewCreative(env as never), null);
    assert.equal(placeholderProviderEnabled(env as never), false);
  });
});

describe("day 24 part 3 | test-only labels and fixed safe destination", () => {
  it("enabled => exactly the four contract fields, all fixed constants", () => {
    const c = getPlaceholderPreviewCreative(ON);
    assert.deepEqual(c, { headline: PLACEHOLDER_HEADLINE, body: PLACEHOLDER_BODY, cta_text: PLACEHOLDER_CTA, destination_url: PLACEHOLDER_DESTINATION });
    assert.deepEqual(Object.keys(c ?? {}), ["headline", "body", "cta_text", "destination_url"]);
  });

  it("headline, body and CTA are all marked TEST ONLY", () => {
    for (const v of [PLACEHOLDER_HEADLINE, PLACEHOLDER_BODY, PLACEHOLDER_CTA]) assert.match(v, /TEST ONLY/);
    assert.match(PLACEHOLDER_BODY, /not a real advertiser/i);
  });

  it("never represents itself as a Revive ad or any real advertiser", () => {
    for (const v of [PLACEHOLDER_HEADLINE, PLACEHOLDER_BODY, PLACEHOLDER_CTA, PLACEHOLDER_DESTINATION]) {
      assert.doesNotMatch(v, /revive|openx|adserver|sponsored by/i, v);
    }
  });

  it("destination is fixed: https, example.com, no credentials, no query, no fragment", () => {
    const u = new URL(PLACEHOLDER_DESTINATION);
    assert.equal(u.protocol, "https:");
    assert.equal(u.hostname, "example.com");
    assert.equal(u.username, "");
    assert.equal(u.password, "");
    assert.equal(u.search, "");
    assert.equal(u.hash, "");
    assert.equal(u.port, "");
  });

  it("the creative passes the strict JSON endpoint contract", () => {
    const v = validateJsonEndpointPayload(getPlaceholderPreviewCreative(ON));
    assert.equal(v.ok, true);
    assert.ok(v.ok);
    assert.equal(v.creative.headline, PLACEHOLDER_HEADLINE);
    assert.equal(v.creative.ctaText, PLACEHOLDER_CTA);
    assert.equal(v.creative.destinationUrl, PLACEHOLDER_DESTINATION);
  });

  it("every call returns a fresh object; changing one never changes the next", () => {
    const a = getPlaceholderPreviewCreative(ON) as { headline: string };
    const b = getPlaceholderPreviewCreative(ON);
    assert.notEqual(a, b);
    a.headline = "changed";
    assert.equal(getPlaceholderPreviewCreative(ON)?.headline, PLACEHOLDER_HEADLINE);
  });

  it("works as a provider for the preview handler (mocked env, no network)", async () => {
    const on = await handlePreviewGet({ env: ON, provider: () => getPlaceholderPreviewCreative(ON) });
    assert.equal(on.status, 200);
    assert.deepEqual(JSON.parse(await on.text()), getPlaceholderPreviewCreative(ON));
    const off = await handlePreviewGet({ env: {}, provider: () => getPlaceholderPreviewCreative({}) });
    assert.equal(off.status, 404);
  });
});

describe("day 24 part 3 | no external requests", () => {
  it("calling every export makes no fetch, http or socket call", async () => {
    const g = globalThis as { fetch?: unknown };
    const originalFetch = g.fetch;
    let calls = 0;
    g.fetch = () => { calls += 1; throw new Error(SECRET); };
    try {
      for (const env of [{}, ON, { REVIVE_JSON_PREVIEW_ENABLED: "false" }]) {
        getPlaceholderPreviewCreative(env);
        placeholderProviderEnabled(env);
      }
      await withEnv("true", () => placeholderPreviewProvider());
    } finally {
      g.fetch = originalFetch;
    }
    assert.equal(calls, 0);
  });

  it("the provider is synchronous: returns a plain value, not a promise", () => {
    assert.ok(!(getPlaceholderPreviewCreative(ON) instanceof Promise));
    assert.ok(!(placeholderPreviewProvider() instanceof Promise));
  });
});

describe("day 24 part 3 | no sensitive imports or dependencies", () => {
  it("the module has no import, require or dynamic import at all", () => {
    const src = code(FILE);
    assert.deepEqual(src.match(/^\s*import\s[^;]+;/gm) ?? [], []);
    assert.doesNotMatch(src, /\brequire\s*\(|\bimport\s*\(|\bexport\s+\*\s+from|\bfrom\s+["']/);
  });

  it("no database, billing, tracking, ledger, payout, network or logging code", () => {
    assert.doesNotMatch(code(FILE), /supabase|createAdminClient|ledger|billing|payout|revenue|spend|budget|campaign|serve-db|click|impression|tracking|\bfetch\s*\(|XMLHttpRequest|WebSocket|node:(http|https|net|dns|tls)|console\.|\bsql\b|SELECT |INSERT |UPDATE |\.rpc\(/i);
  });

  it("no credential, key, token or delivery URL dependency; only the one preview flag is read", () => {
    const src = code(FILE);
    assert.doesNotMatch(src, /api[_-]?key|secret|token|password|authorization|bearer|cookie|REVIVE_DELIVERY_URL|REVIVE_FALLBACK_ENABLED|NEXT_PUBLIC_/i);
    assert.equal((src.match(/process\.env/g) ?? []).length, 1);
    const names = new Set([...src.matchAll(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]{3,}\b/g)].map((m) => m[0]));
    assert.deepEqual([...names].filter((n) => /REVIVE|DELIVERY|ENV|SECRET|KEY|TOKEN/.test(n)), ["REVIVE_JSON_PREVIEW_ENABLED"]);
  });

  it("the module never reads a request, URL, headers or cookies", () => {
    assert.doesNotMatch(code(FILE), /searchParams|URLSearchParams|new URL|request\b|\.url\b|headers|cookies|next\/headers/i);
  });

  it("the only URL in the module is the fixed example.com destination", () => {
    const urls = [...code(FILE).matchAll(/https?:\/\/[^\s"'`)]+/g)].map((m) => m[0]);
    assert.deepEqual(urls, [PLACEHOLDER_DESTINATION]);
  });
});

describe("day 24 part 3 | not used anywhere (isolated placeholder)", () => {
  const NAME = /revive-json-preview-provider|getPlaceholderPreviewCreative|placeholderPreviewProvider|placeholderProviderEnabled/;

  it("service, fallback routing, fallback provider, adapter and the match routes do not reference it", () => {
    for (const f of [
      "lib/ads/service.ts",
      "lib/ads/fallback-routing.ts",
      "lib/ads/fallback-provider.ts",
      "lib/ads/revive-adapter.ts",
      "lib/ads/match-handler.ts",
      "app/api/v1/ads/match/route.ts",
      "app/api/ads/match/route.ts",
    ]) {
      if (existsSync(path.join(ROOT, f))) assert.doesNotMatch(read(f), NAME, f);
    }
  });

  it("no file in app, lib, components or middleware imports or mentions it", () => {
    for (const f of [...walk("app"), ...walk("lib"), ...walk("components"), "middleware.ts"]) {
      if (f === FILE || !/\.(ts|tsx)$/.test(f)) continue;
      assert.doesNotMatch(read(f), NAME, f);
    }
  });

  it("the preview route and handler still do not use it (they keep their own fixture)", () => {
    assert.doesNotMatch(read("lib/ads/revive-json-preview.ts"), NAME);
    assert.doesNotMatch(read("app/api/revive-json-preview/route.ts"), NAME);
  });

  it("no SQL, migration, package, env example or workflow file mentions it", () => {
    const files = [
      ...(existsSync(path.join(ROOT, "supabase")) ? readdirSync(path.join(ROOT, "supabase"), { recursive: true }).map((f) => `supabase/${String(f)}`) : []),
      "package.json", ".env.example", "next.config.mjs", "middleware.ts",
    ].filter((f) => existsSync(path.join(ROOT, f)) && /\.(sql|json|example|mjs|ts)$/.test(f));
    for (const f of files) assert.doesNotMatch(read(f), NAME, f);
  });
});
