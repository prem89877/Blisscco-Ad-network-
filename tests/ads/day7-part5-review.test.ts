import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createIpGuard, type IpGuard } from "@/lib/ads/ip-guard";
import { handleMatchPost } from "@/lib/ads/match-handler";

// Day 7 / Part 5: performance + deployment-safety review ke fixes ki jaanch.
// Asli database kabhi nahi chhuta.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const GOOD_KEY = `blc_live_${"a".repeat(64)}`;

function post(headers: Record<string, string>, body: string, options?: Parameters<typeof handleMatchPost>[1]) {
  return handleMatchPost(
    new Request("http://x/api/v1/ads/match", { method: "POST", headers, body }),
    options,
  );
}

describe("part5: caching - har jawab no-store + Vary: Authorization", () => {
  const json = { "content-type": "application/json" };
  const auth = { ...json, authorization: `Bearer ${GOOD_KEY}` };
  const freshGuard = () => createIpGuard(100, 60_000);

  const cases: Array<[string, () => Promise<Response>, number]> = [
    ["401 no key", () => post(json, '{"topic":"gaming"}', { ipGuard: freshGuard() }), 401],
    ["415 wrong content-type", () => post({ authorization: `Bearer ${GOOD_KEY}`, "content-type": "text/plain" }, "x", { ipGuard: freshGuard() }), 415],
    ["413 too large", () => post({ ...auth, "content-length": "999999" }, "x", { ipGuard: freshGuard() }), 413],
    ["400 bad json", () => post(auth, "{nope", { ipGuard: freshGuard() }), 400],
    [
      "429 blocked ip",
      () => {
        const g = createIpGuard(1, 60_000);
        g.recordFailure("9.9.9.9", Date.now());
        return post({ ...auth, "x-forwarded-for": "9.9.9.9" }, '{"topic":"gaming"}', { ipGuard: g });
      },
      429,
    ],
  ];

  for (const [name, run, status] of cases) {
    it(`${name}: status ${status}, no-store, Vary: Authorization`, async () => {
      const res = await run();
      assert.equal(res.status, status);
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.equal(res.headers.get("vary"), "Authorization");
    });
  }

  it("route files stay force-dynamic (never statically cached)", () => {
    for (const f of ["app/api/ads/match/route.ts", "app/api/v1/ads/match/route.ts"]) {
      assert.match(read(f), /export const dynamic = "force-dynamic";/);
    }
  });
});

describe("part5: unexpected crash => clean JSON 503, nothing leaks", () => {
  it("handler never throws; answers 503 fill:false, no-store, keeps extra headers, no error text", async () => {
    const exploding: IpGuard = {
      isBlocked() {
        throw new Error("secret internal detail sb_secret_should_never_appear");
      },
      recordFailure() {},
    };
    const res = await post({ "content-type": "application/json", authorization: `Bearer ${GOOD_KEY}` }, '{"topic":"gaming"}', {
      ipGuard: exploding,
      extraHeaders: { "X-Blisscco-Api-Version": "1" },
    });
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("x-blisscco-api-version"), "1");
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { fill: false, error: "unavailable" });
    assert.ok(!/secret|internal|stack/i.test(text));
  });
});

describe("part5: secrets and configuration", () => {
  it(".gitignore blocks every .env file except .env.example", () => {
    const lines = read(".gitignore").split("\n").map((l) => l.trim());
    assert.ok(lines.includes(".env"), ".env must be ignored");
    assert.ok(lines.includes(".env.*"), ".env.* must be ignored");
    assert.ok(lines.includes("!.env.example"), ".env.example must stay committable");
  });

  it("no NEXT_PUBLIC_ variable name looks like a secret (code + .env.example)", () => {
    const names = new Set<string>();
    const scan = (text: string) => {
      for (const m of text.matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) names.add(m[0]);
    };
    const walk = (dir: string) => {
      for (const n of readdirSync(path.join(ROOT, dir))) {
        if (n === "node_modules" || n === ".next" || n === ".test-build") continue;
        const rel = path.join(dir, n);
        const st = statSync(path.join(ROOT, rel));
        if (st.isDirectory()) walk(rel);
        else if (/\.(ts|tsx|mjs)$/.test(n)) scan(read(rel));
      }
    };
    for (const d of ["app", "lib", "components"]) walk(d);
    scan(read(".env.example"));
    scan(read("middleware.ts"));
    assert.ok(names.size >= 3);
    for (const n of names) assert.ok(!/SECRET|SERVICE|PRIVATE|PASSWORD|TOKEN/.test(n), `public-looking secret name: ${n}`);
  });

  it("next.config.mjs does not copy any env var into the browser bundle", () => {
    const cfg = read("next.config.mjs").replace(/\/\/.*$/gm, "");
    assert.ok(!/\benv\s*:/.test(cfg), "next.config env block would inline values into the client bundle");
    assert.ok(!/SECRET|SERVICE_ROLE/.test(cfg));
  });

  it(".env.example holds only placeholders", () => {
    const text = read(".env.example");
    assert.ok(!/sb_secret_[A-Za-z0-9]{12,}/.test(text.replace(/sb_secret_YOUR_KEY/g, "")));
    assert.ok(!/eyJ[A-Za-z0-9_-]{20,}/.test(text));
    assert.ok(!/blc_live_[0-9a-f]{64}/.test(text));
    assert.match(text, /^SUPABASE_SECRET_KEY=/m);
    assert.ok(!/NEXT_PUBLIC_SUPABASE_SECRET/.test(text));
  });

  it("admin client: reused within an instance, missing env logs variable NAMES only, timeout kept", () => {
    const src = read("lib/supabase/admin.ts");
    assert.match(src, /^import "server-only";/m);
    assert.match(src, /let cached/);
    assert.match(src, /AbortSignal\.timeout/);
    assert.match(src, /persistSession: false/);
    const logLine = src.split("\n").find((l) => /console\.error\(/.test(l)) ?? "";
    assert.match(logLine, /\[config\] missing server env:/);
    assert.ok(!/process\.env/.test(logLine), "must never print env values");
    assert.ok(!/secretKey\s*[,)]/.test(logLine), "must never print the key");
  });
});

describe("part5: SQL day-7-5 (static check; real proof = running it on Supabase)", () => {
  const sql = read("supabase/sql/day-7-5-rate-limit-cleanup.sql").replace(/--.*$/gm, "");
  it("keeps the same security shape as day-7-1", () => {
    assert.match(sql, /create or replace function public\.authorize_publisher_key\(p_key_hash text\)/);
    assert.match(sql, /security definer/);
    assert.match(sql, /set search_path = ''/);
    assert.match(sql, /k\.expires_at is null or k\.expires_at > now\(\)/);
    assert.match(sql, /on conflict \(key_id, window_start\)\s+do update set hits = public\.api_rate_limits\.hits \+ 1/);
    assert.match(sql, /if v_hits > v_limit then\s+return jsonb_build_object\('outcome', 'rate_limited'\);/);
    assert.ok(!/grant execute[^;]*to (anon|public|authenticated)\b/i.test(sql));
    assert.match(sql, /\bbegin;/);
    assert.match(sql, /\bcommit;/);
  });
  it("old-row cleanup runs only when a new minute starts (hits = 1), after the counter update", () => {
    const upsert = sql.indexOf("insert into public.api_rate_limits");
    const guarded = /if v_hits = 1 then\s+delete from public\.api_rate_limits\s+where key_id = v_key_id and window_start < now\(\) - interval '1 hour';\s+end if;/.exec(sql);
    assert.ok(guarded, "delete must be inside if v_hits = 1");
    assert.ok(upsert >= 0 && guarded.index > upsert);
    assert.equal((sql.match(/delete from public\.api_rate_limits/g) ?? []).length, 1);
  });
});
