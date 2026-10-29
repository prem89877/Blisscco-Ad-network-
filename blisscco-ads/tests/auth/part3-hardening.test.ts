import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { safeNextPath } from "@/lib/auth/redirect";
import { cleanEnvSiteUrl, cleanHostHeader, resolveSiteUrl } from "@/lib/auth/site-url-parse";

// Day 7 Part 3: auth + database access + campaign operations ki SOURCE-LEVEL jaanch.
// Dhyan: ye asli Supabase/login ka test NAHI hai. Do asli accounts wale tests: supabase/sql/day-7-3-authz-gap-tests.sql

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}
const sourceFiles = [...walk("app"), ...walk("lib"), ...walk("components"), "middleware.ts"].filter((f) => /\.(ts|tsx)$/.test(f));

/* ---------------- 1. Unsafe redirects ---------------- */
describe("part3: unsafe redirects", () => {
  const evil = [
    "https://evil.com", "http://evil.com/dashboard", "//evil.com", "///evil.com", "/\\evil.com", "\\\\evil.com",
    "/dashboard\\..\\evil", "/%2F/evil.com", "/%2f%2fevil.com", "/dashboard/../../evil.com", "/login", "/",
    "/dashboardx", "/dashboard@evil.com", "javascript:alert(1)", "data:text/html,x", "/dashboard\r\nLocation: https://evil.com",
    "/dashboard\t//evil.com", "/dashboard\u0000", " /dashboard", "dashboard", "", "/" + "a".repeat(600), "/dashboard/" + "a".repeat(600),
  ];
  for (const raw of evil) {
    it(`falls back for ${JSON.stringify(raw.slice(0, 40))}`, () => {
      const out = safeNextPath(raw);
      assert.equal(out, "/dashboard");
    });
  }
  it("non-string inputs fall back", () => {
    for (const v of [undefined, null, 5, {}, ["/dashboard"], true]) assert.equal(safeNextPath(v), "/dashboard");
  });
  it("keeps good dashboard paths", () => {
    assert.equal(safeNextPath("/dashboard"), "/dashboard");
    assert.equal(safeNextPath("/dashboard/advertiser/campaigns?status=active"), "/dashboard/advertiser/campaigns?status=active");
  });
  it("whatever comes out is always a /dashboard path on our own site", () => {
    const samples = ["/dashboard/x?next=https://evil.com", "/dashboard//evil.com", "/dashboard/%5Cevil.com"];
    for (const s of samples) {
      const out = safeNextPath(s);
      assert.ok(out === "/dashboard" || out.startsWith("/dashboard/"), out);
      assert.ok(!out.startsWith("//") && !out.includes("\\"));
    }
  });
  it("every redirect(next) in auth code goes through safeNextPath", () => {
    for (const f of ["app/auth/actions.ts", "app/auth/confirm/route.ts", "lib/supabase/middleware.ts"]) {
      assert.match(read(f), /safeNextPath\(/, f);
    }
    // login form ka hidden `next` bhi server par dobara jaancha jata hai (actions.ts), client par bharosa nahi
    assert.match(read("app/auth/actions.ts"), /const next = safeNextPath\(formData\.get\("next"\)\)/);
  });
  it("Google sign-in only follows a URL on our own Supabase project", () => {
    const src = read("app/auth/actions.ts");
    assert.match(src, /new URL\(data\.url\)\.origin === expected/);
  });
});

/* ---------------- 2. Email link host poisoning (site-url) ---------------- */
describe("part3: verification-link site URL", () => {
  const base = { envUrl: undefined, forwardedHost: null, host: null, forwardedProto: null };
  it("env URL wins over any header", () => {
    assert.equal(resolveSiteUrl({ ...base, envUrl: "https://blisscco.example/", forwardedHost: "evil.com" }), "https://blisscco.example");
  });
  it("rejects env URL with username/password or junk, then uses headers", () => {
    assert.equal(cleanEnvSiteUrl("https://a:b@evil.com"), null);
    assert.equal(cleanEnvSiteUrl("javascript:alert(1)"), null);
    assert.equal(cleanEnvSiteUrl("https://x.com y"), null);
    assert.equal(cleanEnvSiteUrl(""), null);
  });
  it("a clean forwarded host is used, always over https for real sites", () => {
    assert.equal(resolveSiteUrl({ ...base, forwardedHost: "app.blisscco.com", forwardedProto: "http" }), "https://app.blisscco.com");
    assert.equal(resolveSiteUrl({ ...base, host: "blisscco-ads.vercel.app" }), "https://blisscco-ads.vercel.app");
  });
  it("only the first host of a comma list is used", () => {
    assert.equal(cleanHostHeader("app.blisscco.com, evil.com"), "app.blisscco.com");
  });
  const poisoned = ["evil.com/path", "evil.com@good.com", "evil.com\\x", "a b.com", "evil.com#x", "evil.com?x=1", "-evil.com", "evil..com", "https://evil.com", "evil.com:99999999", "ev<script>.com", ""];
  for (const h of poisoned) {
    it(`ignores poisoned host ${JSON.stringify(h)}`, () => {
      const out = resolveSiteUrl({ ...base, forwardedHost: h, host: "ok.example.com" });
      assert.ok(out === "https://ok.example.com", out);
    });
  }
  it("falls back to localhost only when nothing usable exists", () => {
    assert.equal(resolveSiteUrl({ ...base, forwardedHost: "a b", host: "c/d" }), "http://localhost:3000");
  });
  it("getSiteUrl uses the pure resolver", () => {
    assert.match(read("lib/auth/site-url.ts"), /resolveSiteUrl\(/);
  });
});

/* ---------------- 3. Server-side authorization on every action ---------------- */
describe("part3: every server action checks auth BEFORE touching the database", () => {
  const actionFiles = walk("app").filter((f) => /actions\.ts$/.test(f) && f.startsWith("app/dashboard"));
  const GATES = /(requireRole|requireActiveAdvertiser|requireActivePublisher|requireOwnPublisher|requireAccount|requireUser|changeRunState)\(/;
  const DB = /(createClient\(|createAdminClient\(|\.from\(|\.rpc\(|loadMyCampaign\(|getCreativeSummary\(|countReviewableCreatives\(|issuePublisherKey\(|listPublisherKeys\(|revokePublisherKey\()/;

  for (const f of actionFiles) {
    const src = read(f);
    // har async function (export wale bhi, private helper bhi) ka body, agli function tak.
    // pause/resume chhote wrapper hain jo changeRunState ko bulate hain; changeRunState ki apni jaanch alag se hoti hai.
    const parts = src.split(/\n(?:export )?async function /).slice(1);
    for (const part of parts) {
      const name = part.slice(0, part.indexOf("("));
      it(`${f} :: ${name} runs an auth gate before any database call`, () => {
        const gate = part.search(GATES);
        const db = part.search(DB);
        assert.ok(gate >= 0, "no auth gate");
        assert.ok(db === -1 || gate < db, "database touched before auth gate");
      });
    }
  }

  it("campaign actions never take the advertiser id from the form", () => {
    for (const f of ["app/dashboard/advertiser/campaigns/actions.ts", "app/dashboard/advertiser/campaigns/creative-actions.ts"]) {
      assert.ok(!/formData\.get\("advertiser(Id|_id)"\)/.test(read(f)), f);
      assert.ok(!/fd\.get\("advertiser(Id|_id)"\)/.test(read(f)), f);
    }
  });
  it("campaign create/edit/pause/resume use the logged-in session (RLS), never the service-role client", () => {
    for (const f of ["app/dashboard/advertiser/campaigns/actions.ts", "app/dashboard/advertiser/campaigns/creative-actions.ts"]) {
      assert.ok(!/createAdminClient|SUPABASE_SECRET/.test(read(f)), f);
    }
  });
  it("pause/resume re-check ownership and the from-status on the server", () => {
    const src = read("app/dashboard/advertiser/campaigns/actions.ts");
    assert.match(src, /\.eq\("advertiser_id", adv\.id\)\s*\n\s*\.eq\("status", from\)/);
    assert.match(src, /canPause\(current\.status\)/);
    assert.match(src, /checkResume\(/);
  });
  it("edit re-checks ownership, status lock, and stale timestamp on the server", () => {
    const src = read("app/dashboard/advertiser/campaigns/actions.ts");
    assert.match(src, /EDIT_LOCKED_STATUSES\.includes\(current\.status\)/);
    assert.match(src, /\.eq\("advertiser_id", adv\.id\)/);
    assert.match(src, /\.eq\("updated_at", current\.updatedAt\)/);
  });
  it("account/key actions take profile and publisher from the login, not the form", () => {
    assert.match(read("app/dashboard/account/actions.ts"), /profile_id: account\.user\.id/);
    assert.ok(!/formData\.get\("(profileId|profile_id|publisherId|publisher_id|role|status)"\)/.test(read("app/dashboard/account/actions.ts")));
    assert.ok(!/formData\.get\("(publisherId|publisher_id)"\)/.test(read("app/dashboard/publisher/actions.ts")));
  });
  it("signup can only ask for advertiser or publisher, never admin", () => {
    const src = read("app/auth/actions.ts");
    assert.match(src, /formData\.get\("accountType"\) === "publisher" \? "publisher" : "advertiser"/);
  });
  it("roles are never read from user_metadata / app_metadata / JWT claims in app code", () => {
    for (const f of sourceFiles) {
      const code = read(f).split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*")).join("\n");
      assert.ok(!/(user_metadata|app_metadata|raw_user_meta_data)/.test(code), f);
    }
  });
  it("middleware protects /dashboard and fails closed when config is missing", () => {
    const src = read("lib/supabase/middleware.ts");
    assert.match(src, /isProtected/);
    assert.match(src, /getUser\(\)/);
    assert.ok(!/getSession\(\)/.test(src));
    assert.match(read("middleware.ts"), /"\/dashboard\/:path\*"/);
  });
  it("server auth uses getUser(), never getSession(), anywhere", () => {
    for (const f of sourceFiles) assert.ok(!/auth\.getSession\(\)/.test(read(f)), f);
  });
});

/* ---------------- 4. Secrets stay on the server ---------------- */
describe("part3: service-role key and publisher API keys stay server-side", () => {
  const ADMIN_USERS = new Set([
    "lib/supabase/admin.ts", "lib/publisher/keys-db.ts", "lib/ads/candidate-loader.ts", "lib/ads/match.ts", "lib/ads/serve-db.ts", "lib/ads/impression-db.ts",
    "lib/ads/click-db.ts", // Day 12 prompt 5 part 3
  ]);
  it("only the known server modules import the service-role client, and each is server-only", () => {
    const users = sourceFiles.filter((f) => /@\/lib\/supabase\/admin|createAdminClient/.test(read(f)));
    for (const f of users) assert.ok(ADMIN_USERS.has(f), `unexpected service-role user: ${f}`);
    for (const f of ADMIN_USERS) assert.match(read(f), /^import "server-only";/m, f);
  });
  it("no client component imports server-only modules or mentions the secret key", () => {
    const clientFiles = sourceFiles.filter((f) => /^\s*"use client";/.test(read(f)));
    assert.ok(clientFiles.length > 10);
    for (const f of clientFiles) {
      const src = read(f);
      assert.ok(!/SUPABASE_SECRET_KEY|sb_secret_|service_role/.test(src), f);
      assert.ok(!/@\/lib\/supabase\/admin|@\/lib\/publisher\/keys-db|@\/lib\/ads\/(serve-db|match|candidate-loader|service|api-key)/.test(src), f);
    }
  });
  it("browser Supabase client uses only the publishable key", () => {
    const src = read("lib/supabase/client.ts");
    assert.ok(!/SECRET|service_role/i.test(src));
    assert.match(read("lib/supabase/env.ts"), /isServiceRoleJwt\(key\)/);
  });
  it("NEXT_PUBLIC_ variables are only the known safe ones", () => {
    const allowed = new Set(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_CONTACT_EMAIL"]);
    for (const f of [...sourceFiles, ".env.example"]) {
      const found = read(f).match(/NEXT_PUBLIC_[A-Z0-9_]+/g) ?? [];
      for (const name of found) {
        if (name === "NEXT_PUBLIC_") continue; // comments me prefix ka zikr
        if (name === "NEXT_PUBLIC_XXX") continue; // comment ka example
        assert.ok(allowed.has(name), `${f}: ${name}`);
      }
    }
  });
  it("publisher keys: plain key is never stored client-side (no localStorage / cookies / URL / logs)", () => {
    for (const f of sourceFiles) {
      const src = read(f);
      assert.ok(!/(localStorage|sessionStorage|indexedDB)/.test(src), f);
    }
    const mgr = read("components/dashboard/PublisherKeyManager.tsx");
    assert.ok(!/console\./.test(mgr));
    assert.ok(!/document\.cookie|router\.(push|replace)|window\.location/.test(mgr));
    const keys = read("lib/publisher/keys-db.ts");
    assert.ok(!/console\.[a-z]+\([^)]*(parts\.key|\bkey\b)[^)]*\)/.test(keys));
  });
  it("only the creating response carries the plain key; list/query code never selects key material", () => {
    assert.ok(!/key_hash/.test(read("lib/publisher/keys.ts")));
    assert.ok(!/key_hash/.test(read("lib/publisher/queries.ts")));
    assert.ok(!/key_hash/.test(read("app/dashboard/publisher/page.tsx")));
  });
  it("the match API reads the key only from the Authorization header, not the URL, and does not log", () => {
    const handler = read("lib/ads/match-handler.ts");
    assert.match(handler, /request\.headers\.get\("authorization"\)/);
    assert.ok(!/searchParams|nextUrl|new URL\(request\.url/.test(handler));
    assert.ok(!/console\./.test(handler));
  });
  it("no console call logs a whole error, key, token, password, request or form", () => {
    const bad = /console\.(log|info|debug|warn|error)\([^;]*?(?:,\s*|\(\s*)(error|err|e|key|newKey|token|password|formData|fd|request|req|headers|data)\s*[,)]/;
    for (const f of sourceFiles) {
      const src = read(f);
      assert.ok(!/console\.(log|info|debug)\(/.test(src), `${f}: console.log/info/debug is not allowed`);
      for (const line of src.split("\n")) {
        if (line.includes("console.")) assert.ok(!bad.test(line), `${f}: ${line.trim()}`);
      }
    }
  });
});

/* ---------------- 5. Sensitive error messages ---------------- */
describe("part3: no sensitive error text reaches the browser", () => {
  it("database errors go through mapDbError (fixed messages only)", () => {
    const src = read("lib/campaigns/errors.ts");
    assert.ok(!/error\??\.message|error\??\.details/.test(src));
    for (const f of ["app/dashboard/advertiser/campaigns/actions.ts", "app/dashboard/advertiser/campaigns/creative-actions.ts"]) {
      assert.match(read(f), /mapDbError\(error\)/, f);
    }
  });
  it("no action or page sends error.message / error.details / error.hint text to the user", () => {
    for (const f of sourceFiles.filter((x) => x.startsWith("app/") || x.startsWith("components/"))) {
      const src = read(f);
      assert.ok(!/message:\s*(error|err|e)\??\.(message|details|hint)/.test(src), f);
      assert.ok(!/\{(error|err)\??\.(message|stack|details)\}/.test(src), f);
    }
  });
  it("error pages never print the raw error", () => {
    for (const f of sourceFiles.filter((x) => /(^|\/)(global-)?error\.tsx$/.test(x))) {
      const src = read(f);
      assert.ok(!/error\.message|error\.stack/.test(src), f);
    }
  });
  it("login page maps ?error / ?message to a fixed list (no reflected text)", () => {
    const src = read("app/login/page.tsx");
    assert.match(src, /Object\.hasOwn\(NOTICES, key\)/);
  });
  it("sign-in says the same thing for wrong password and unknown email", () => {
    const src = read("app/auth/actions.ts");
    assert.match(src, /Incorrect email or password\./);
    assert.match(src, /Galat password aur unknown email ka message same/);
  });
  it("match API error bodies are fixed codes", () => {
    const src = read("lib/ads/validation.ts");
    assert.ok(!/(e|err|error)\.message/.test(src));
  });
  it("health route never returns error text", () => {
    const src = read("app/api/supabase-health/route.ts");
    assert.ok(!/NextResponse\.json\(\{[^}]*(message|error)\b/.test(src.replace(/\/\/.*$/gm, "")));
  });
});

/* ---------------- 6. SQL: RLS on, no unrestricted policies, functions locked ---------------- */
describe("part3: SQL migrations (static)", () => {
  const sqlFiles = walk("supabase/sql");
  const isTestFile = (f: string) => /(tests?|verify|cleanup|health-check)\.sql$/.test(f) || /-test\.sql$/.test(f);
  const migrations = sqlFiles.filter((f) => !isTestFile(f));
  const all = migrations.map((f) => read(f)).join("\n");
  const noComments = all.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("found the migrations", () => assert.ok(migrations.length >= 15, String(migrations.length)));
  it("no migration disables RLS", () => assert.ok(!/disable\s+row\s+level\s+security/i.test(noComments)));
  it("no unrestricted policy (using true / with check true)", () => {
    assert.ok(!/using\s*\(\s*true\s*\)/i.test(noComments));
    assert.ok(!/with\s+check\s*\(\s*true\s*\)/i.test(noComments));
  });
  it("no table grant to anon or public", () => {
    const grants = noComments.match(/grant\s+[^;]*\bon\s+(?:table\s+)?public\.[a-z_]+[^;]*\bto\s+[^;]*;/gi) ?? [];
    for (const g of grants) assert.ok(!/\bto\s+[^;]*\b(anon|public)\b/i.test(g), g);
  });
  it("every public table has RLS enabled", () => {
    const tables = [...noComments.matchAll(/create table if not exists public\.([a-z_]+)/gi)].map((m) => m[1]);
    assert.ok(tables.length >= 12, tables.join(","));
    for (const t of tables) {
      assert.match(noComments, new RegExp(`alter table public\\.${t}\\s+enable row level security`, "i"), t);
    }
  });
  it("every function is explicitly locked down (revoke) in the migrations", () => {
    const fns = [...noComments.matchAll(/create or replace function ((?:public|private)\.[a-z_]+)\(/gi)].map((m) => m[1]);
    assert.ok(fns.length >= 20, String(fns.length));
    for (const fn of new Set(fns)) {
      assert.match(noComments, new RegExp(`revoke all on function ${fn.replace(".", "\\.")}\\(`, "i"), `no revoke for ${fn}`);
    }
  });
  it("service-role-only functions are not granted to anon/authenticated", () => {
    const only = ["authorize_publisher_key", "record_ad_serve", "load_ad_candidates", "issue_publisher_key_for", "list_publisher_keys_for", "revoke_publisher_key_for"];
    for (const fn of only) {
      const grants = noComments.match(new RegExp(`grant execute on function public\\.${fn}\\([^;]*;`, "gi")) ?? [];
      assert.ok(grants.length > 0, fn);
      for (const g of grants) assert.match(g, /to service_role;$/i, g);
    }
  });
  it("campaign/creative status workflow is enforced by a database trigger, not only by app code", () => {
    assert.match(noComments, /create trigger campaigns_guard_changes/i);
    assert.match(noComments, /create trigger ad_creatives_guard_changes/i);
    assert.match(noComments, /create trigger profiles_guard_changes/i);
  });
  it("users have no UPDATE right on role/status columns (column-level grants)", () => {
    assert.match(noComments, /grant update \(display_name\) on public\.profiles to authenticated/i);
    assert.ok(!/grant update[^;]*\(([^)]*\b(role|status)\b[^)]*)\)\s+on public\.profiles/i.test(noComments));
    assert.ok(!/grant update[^;]*\([^)]*\bstatus\b[^)]*\)\s+on public\.(advertisers|publishers)/i.test(noComments));
    assert.ok(!/grant (insert|update)[^;]*\([^)]*\b(advertiser_id|currency_code)\b[^)]*\)[^;]*on public\.campaigns[^;]*update/i.test(noComments));
  });
  it("campaign UPDATE grant does not include advertiser_id or currency_code", () => {
    const m = noComments.match(/grant update \(([^)]*)\)\s+on public\.campaigns to authenticated/i);
    assert.ok(m);
    assert.ok(!/advertiser_id|currency_code/.test(m![1]), m![1]);
  });
  it("part 3 gap-test file exists and is clearly marked not-run-by-assistant", () => {
    const t = read("supabase/sql/day-7-3-authz-gap-tests.sql");
    assert.match(t, /NOT RUN/);
    assert.match(t, /rollback;/);
  });
});
