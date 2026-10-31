import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import * as legacyRoute from "@/app/api/ads/match/route";
import * as v1Route from "@/app/api/v1/ads/match/route";
import * as impressionRoute from "@/app/api/v1/ads/impression/route";
import { FAILURE_LIMIT } from "@/lib/ads/ip-guard";
import { MAX_BODY_BYTES, MAX_EXCLUDE_IDS } from "@/lib/ads/validation";
import { KEY_PREFIX, buildKeyParts } from "@/lib/publisher/keys";

// Day 10 / Part 6: aakhri jaanch. Sirf static + contract (koi database, koi network, koi asli key nahi).
// Maqsad: secrets bahar na jaayein, server/client ki seema bani rahe, API ka surface chhota rahe, guide asli code se mele,
// Revive Adserver ka koi integration / duplicate tracking na aaye, CI type-check + test + build chalaye,
// aur Day 10 ki SQL files me koi destructive statement na ho.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const SKIP = new Set(["node_modules", ".next", ".test-build", ".git"]);

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  for (const name of readdirSync(path.join(ROOT, dir))) {
    if (SKIP.has(name)) continue;
    const rel = path.join(dir, name);
    const full = path.join(ROOT, rel);
    if (statSync(full).isDirectory()) walk(rel, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(rel);
  }
  return out;
}

const SOURCE_DIRS = ["app", "lib", "components"];
const sourceFiles = [...SOURCE_DIRS.flatMap((d) => walk(d, [".ts", ".tsx"])), "middleware.ts", "next.config.mjs"];
const isClient = (src: string) => /^\s*["']use client["']/.test(src);

describe("Day 10 part 6: secrets are not exposed", () => {
  it("no real-looking secret is hard-coded in source, SQL, docs, CI or env example", () => {
    const files = [
      ...sourceFiles,
      ...walk("supabase", [".sql"]),
      ...walk(".github", [".yml"]),
      ".env.example",
      "package.json",
      ...readdirSync(ROOT).filter((f) => f.endsWith(".md")),
    ];
    const patterns: [string, RegExp][] = [
      ["JWT", /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/],
      ["supabase secret with a real-looking body", /sb_secret_(?!dummy|YOUR_KEY)[A-Za-z0-9_-]{16,}/],
      ["supabase publishable with a real-looking body", /sb_publishable_(?!dummy|YOUR_KEY)[A-Za-z0-9_-]{16,}/],
      ["publisher api key literal", /blc_live_[0-9a-f]{64}/],
      ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
      ["google api key", /AIza[0-9A-Za-z_-]{30,}/],
      ["razorpay / stripe live key", /(rzp_live|sk_live)_[A-Za-z0-9]{8,}/],
      ["postgres url with password", /postgres(ql)?:\/\/[^\s:@/]+:[^\s@/]{4,}@(?!localhost|127\.0\.0\.1)/],
    ];
    for (const f of files) {
      const text = read(f);
      for (const [label, re] of patterns) assert.equal(re.test(text), false, `${label} found in ${f}`);
    }
  });

  it(".env.example holds only placeholders and the secret key is never NEXT_PUBLIC_", () => {
    const env = read(".env.example");
    const assignments = env.split("\n").filter((l) => /^[A-Z0-9_]+=/.test(l));
    for (const l of assignments) {
      const [name, value] = [l.split("=")[0], l.slice(l.indexOf("=") + 1)];
      assert.match(value, /YOUR|you@example\.com/, `${name} must be a placeholder`);
      assert.doesNotMatch(name, /^NEXT_PUBLIC_.*(SECRET|SERVICE|PRIVATE|PASSWORD)/, `${name} would be shipped to browsers`);
    }
    assert.ok(assignments.some((l) => l.startsWith("SUPABASE_SECRET_KEY=")));
  });

  it("every process.env name in source is either a known public name or the one server secret", () => {
    const allowedPublic = new Set(["NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_CONTACT_EMAIL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]);
    const names = new Set<string>();
    for (const f of sourceFiles) for (const m of read(f).matchAll(/process\.env\.([A-Z0-9_]+)/g)) names.add(m[1]);
    for (const n of names) {
      if (allowedPublic.has(n)) continue;
      // baaki: SUPABASE_SECRET_KEY (server) + publisher ke apne server ke example env (guide ke code samples me sirf text)
      assert.ok(["SUPABASE_SECRET_KEY", "BLISSCCO_PUBLISHER_API_KEY", "BLISSCCO_API_BASE_URL", "PORT", "NEXT_PUBLIC_XXX"].includes(n), `unexpected env name ${n}`);
    }
  });

  it("SUPABASE_SECRET_KEY is read only inside lib/supabase/admin.ts, which is server-only", () => {
    const readers = sourceFiles.filter((f) => /SUPABASE_SECRET_KEY/.test(read(f)) && !/^\s*\/\//.test(read(f)));
    const real = readers.filter((f) => /process\.env\.SUPABASE_SECRET_KEY/.test(read(f)));
    assert.deepEqual(real, [path.join("lib", "supabase", "admin.ts")]);
    assert.match(read("lib/supabase/admin.ts"), /^import "server-only";/m);
  });

  it("no client component imports server-only modules or the admin client", () => {
    const serverOnly = /supabase\/admin|publisher\/keys-db|ads\/serve-db|ads\/candidate-loader|ads\/match-handler|ads\/match"|node:crypto|server-only/;
    for (const f of sourceFiles.filter((x) => x.endsWith(".tsx") || x.endsWith(".ts"))) {
      const src = read(f);
      if (isClient(src)) assert.equal(serverOnly.test(src), false, `${f} is a client component but imports server code`);
    }
  });

  it("only the expected server files import the admin client", () => {
    const importers = sourceFiles.filter((f) => /from "@\/lib\/supabase\/admin"/.test(read(f))).sort();
    assert.deepEqual(importers.map((f) => f.split(path.sep).join("/")), [
      "lib/ads/candidate-loader.ts",
      "lib/ads/click-db.ts", // Day 12 prompt 5 part 3: click redirect ka DB pul (2 rpc, server-only)
      "lib/ads/impression-db.ts",
      "lib/ads/match.ts",
      "lib/ads/serve-db.ts",
      "lib/ledger/ledger-db.ts", // Day 13 part 2: ledger ka server-only service (admin reversal / adjustment rpc)
      "lib/publisher/keys-db.ts",
    ]);
  });

  it("nothing logs keys, hashes, authorization headers or request bodies", () => {
    for (const f of sourceFiles) {
      for (const m of read(f).matchAll(/console\.(log|error|warn|info|debug)\(([^;]*)\)/g)) {
        const args = m[2];
        assert.equal(/authorization|api[_-]?key|key_hash|hashApiKey|rawBody|request\.(text|json)\(|\bbody\b|\.key\b|parts\.key/i.test(args), false, `${f}: ${m[0].slice(0, 80)}`);
      }
    }
  });

  it("publisher keys are 256-bit random, prefixed, and the hint/prefix reveal almost nothing", () => {
    const hex = "ab".repeat(32);
    const p = buildKeyParts(hex);
    assert.ok(p);
    assert.equal(p.key, `${KEY_PREFIX}${hex}`);
    assert.equal(p.prefix.length, 13);
    assert.equal(p.hint.length, 4);
    assert.equal(buildKeyParts("short"), null);
    assert.equal(buildKeyParts("AB".repeat(32)), null);
    assert.match(read("lib/publisher/keys-db.ts"), /randomBytes\(32\)/);
  });

  it("security headers are set and no wildcard CORS is configured anywhere", () => {
    const cfg = read("next.config.mjs");
    for (const h of ["X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy"]) assert.ok(cfg.includes(h), h);
    assert.match(cfg, /poweredByHeader:\s*false/);
    for (const f of sourceFiles) assert.equal(/Access-Control-Allow-Origin/i.test(read(f)), false, `${f} sets CORS`);
  });
});

describe("Day 10 part 6: API surface and docs match the code", () => {
  it("only the two match routes, the impression route and the click route exist under app/api (plus the health check) and all export only POST", () => {
    const routes = walk("app/api", [".ts"]).map((f) => f.split(path.sep).join("/")).sort();
    assert.deepEqual(routes, ["app/api/ads/match/route.ts", "app/api/supabase-health/route.ts", "app/api/v1/ads/click/route.ts", "app/api/v1/ads/impression/route.ts", "app/api/v1/ads/match/route.ts"]);
    for (const mod of [legacyRoute, v1Route, impressionRoute]) {
      assert.deepEqual(Object.keys(mod).filter((k) => /^[A-Z]+$/.test(k)), ["POST"]);
    }
  });

  it("the health route does not reveal configuration values", () => {
    const src = read("app/api/supabase-health/route.ts");
    assert.equal(/SUPABASE_SECRET_KEY|process\.env/.test(src), false);
  });

  it("limits in the guide equal the limits in the code", () => {
    const guide = read("app/dashboard/publisher/guide/page.tsx").replace(/\s+/g, " ");
    assert.equal(MAX_BODY_BYTES, 2048);
    assert.match(guide, new RegExp(`${MAX_BODY_BYTES} bytes`));
    assert.match(guide, new RegExp(`up to ${MAX_EXCLUDE_IDS} ad ids`));
    assert.match(guide, new RegExp(`about ${FAILURE_LIMIT} wrong keys per minute`));
    assert.match(guide, /60 by default/);
    assert.match(guide, /up to 5 active keys/);
  });

  it("the SQL really enforces the 5-active-key limit and the 60/min default the guide promises", () => {
    assert.match(read("supabase/sql/day-10-2-key-limits.sql"), />= 5 then/);
    const sql = walk("supabase/sql", [".sql"]).map((f) => read(f)).join("\n");
    assert.match(sql, /rate_limit_per_minute[^;]*default 60/i);
  });

  it("every status code the guide lists is one the handler can actually return", () => {
    const handler = read("lib/ads/match-handler.ts") + read("lib/ads/validation.ts");
    for (const code of ["400", "401", "413", "415", "429", "503"]) {
      assert.match(handler, new RegExp(`\\b${code}\\b`), `handler never returns ${code}`);
      assert.match(read("app/dashboard/publisher/guide/page.tsx"), new RegExp(`status: "${code}`), `guide misses ${code}`);
    }
  });
});

describe("Day 10 part 6: Revive Adserver and tracking are not claimed or duplicated", () => {
  const code = [...sourceFiles, ...walk("supabase/sql", [".sql"])];

  it("no source or SQL mentions Revive / an adserver integration", () => {
    for (const f of code) if (!["lib/ads/revive-adapter.ts", "lib/ads/fallback-provider.ts", "app/dashboard/publisher/guide/page.tsx"].includes(f.split(path.sep).join("/"))) assert.equal(/revive|adserver|ad server|openx/i.test(read(f)), false, `${f} mentions an external ad server`); // Day 22 Part 1: sirf alag Revive boundary file allowed
  });

  it("no impression / click / conversion route, table, pixel or beacon exists", () => {
    const sql = walk("supabase/sql", [".sql"]).filter((f) => !/-tests?\.sql$/.test(f)).map((f) => read(f)).join("\n");
    // Day 12 part 2: generic `ad_events` table ab hai (jaan-boojh kar). Rok sirf impression/click/conversion NAAM wali alag tables par hai.
    assert.equal(/create table\s+(if not exists\s+)?(public\.)?\w*(impression|click|conversion)\w*/i.test(sql), false);
    for (const f of sourceFiles.filter((x) => !x.includes("demo-data") && !x.includes("components/dashboard"))) {
      const src = read(f);
      assert.equal(/sendBeacon|tracking pixel|new Image\(\)\.src|\/api\/(click|impression|track)/i.test(src), false, f);
    }
  });

  it("publisher guide documents the impression and click endpoints; advertiser pages use real analytics (Day 15)", () => {
    const pages = [
      "app/dashboard/publisher/guide/page.tsx",
      "app/dashboard/analytics/page.tsx",
      "app/dashboard/advertiser/campaigns/[id]/page.tsx",
    ].map((f) => read(f).replace(/\s+/g, " "));
    assert.match(pages[0], /POST \/api\/v1\/ads\/impression/);
    assert.match(pages[0], /GET \/api\/v1\/ads\/click/);
    assert.doesNotMatch(pages[0], /no impression or click reporting/);
    assert.match(pages[1], /loadAdvertiserOverview\(/);
    assert.match(pages[2], /loadCampaignPerformance\(/);
    assert.match(read("DAY9-COMPLETION-REPORT.md"), /Revive Adserver:\*\* koi reference ya duplicate tracking nahi/);
  });
});

describe("Day 10 part 6: delivery pipeline and SQL safety", () => {
  it("CI runs type check, tests and a production build; scripts exist", () => {
    const ci = read(".github/workflows/ci.yml");
    for (const step of ["npm run lint", "npm test", "npm run build"]) assert.ok(ci.includes(step), step);
    const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;
    for (const s of ["lint", "test", "build", "test:integration"]) assert.ok(scripts[s], s);
    assert.match(scripts.lint, /tsc --noEmit/);
  });

  it("the production-database integration tests are blocked unless a separate TEST database is confirmed", () => {
    const guard = read("tests/integration/test-db-guard.ts");
    assert.match(guard, /TEST_DB_CONFIRM/);
    for (const f of ["tests/integration/day9-part5-db.test.ts", "tests/integration/day10-part5-db.test.ts"]) {
      assert.match(read(f), /checkTestDatabase/);
      assert.equal(/process\.env\.(DATABASE_URL|SUPABASE_SECRET_KEY|POSTGRES_URL)\b/.test(read(f)), false, `${f} may read production credentials`);
    }
  });

  it("Day 10 migrations contain no destructive data statements (only the intended policy replacement)", () => {
    for (const f of walk("supabase/sql", [".sql"]).filter((x) => /day-10-/.test(x) && !/-tests?\.sql$/.test(x))) {
      const sql = read(f).replace(/--.*$/gm, "");
      assert.equal(/\b(truncate|drop\s+(table|schema|column|database)|delete\s+from)\b/i.test(sql), false, `${f} is destructive`);
      for (const m of sql.matchAll(/drop\s+policy[^;]*;/gi)) assert.match(m[0], /publishers_update_own/, `unexpected policy drop in ${f}`);
    }
  });

  it("publishers cannot approve themselves: column grants exclude status, and the Day 10 policy only tightens updates", () => {
    const base = read("supabase/sql/day-3-5-security.sql");
    assert.match(base, /grant insert \(profile_id, name, website_url, category\) on public\.publishers to authenticated;/);
    assert.match(base, /grant update \(name, website_url, category\) on public\.publishers to authenticated;/);
    const sql = read("supabase/sql/day-10-1-publisher-hardening.sql").replace(/--.*$/gm, "");
    const policy = /create policy publishers_update_own[\s\S]*?;/i.exec(sql);
    assert.ok(policy, "policy is recreated, not just dropped");
    assert.match(policy[0], /status <> 'suspended'/);
    assert.match(policy[0], /profile_id = \(select auth\.uid\(\)\)/);
    assert.equal(/grant\s+update[^;]*\bstatus\b[^;]*publishers/i.test(sql), false, "status must never become user-updatable");
  });
});
