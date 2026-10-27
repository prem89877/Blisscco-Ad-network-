import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseIdempotencyKey } from "@/lib/ads/validation";
import { MAX_BUDGET, MIN_TOTAL_BUDGET, MIN_DAILY_BUDGET } from "@/lib/campaigns/constants";

// Day 9 / Part 6: final verification. Sirf static + contract jaanch (koi database, koi network nahi).
// Maqsad: publisher guide asli API se mele, migrations ka order/dependency sahi rahe, destructive SQL na ho,
// tracking (impression/click) aur spend alag rahe, Revive/Adserver ka duplicate tracking code na aaye.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const SQL_DIR = "supabase/sql";
const GUIDE = "app/dashboard/publisher/guide/page.tsx";

/** Guide me `const NAME = [ ... ].join("\n");` ka text (sirf string literals). */
function lines(name: string): string {
  const m = new RegExp(`const ${name} = (\\[[\\s\\S]*?\\])\\.join\\("\\\\n"\\);`).exec(read(GUIDE));
  assert.ok(m, `${name} guide me nahi mila`);
  return (new Function(`return ${m[1]}`)() as string[]).join("\n");
}

/** day-9-5 jaise naam ko (9, 5) me badalta hai, taaki sahi tarah sort ho. */
function version(file: string): number[] {
  const m = /^day-(\d+)-(\d+)-/.exec(file);
  assert.ok(m, file);
  return [Number(m[1]), Number(m[2])];
}
const cmp = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1];

const allSql = readdirSync(path.join(ROOT, SQL_DIR)).filter((f) => f.endsWith(".sql"));
const DAY9_MIGRATIONS = ["day-9-3-budget-rules.sql", "day-9-5-atomic-spend-idempotency.sql", "day-9-7-lifecycle-guards.sql"];
const DAY9_TESTS = ["day-9-2-campaign-checks.sql", "day-9-4-budget-tests.sql", "day-9-6-atomic-spend-tests.sql", "day-9-8-lifecycle-tests.sql"];

describe("Day 9 part 6: publisher guide matches the Idempotency-Key contract", () => {
  it("the cURL example sends an Idempotency-Key that the real validator accepts", () => {
    const m = /Idempotency-Key: ([^"\s]+)"/.exec(lines("CURL_EXAMPLE"));
    assert.ok(m, "cURL example me Idempotency-Key header nahi");
    const r = parseIdempotencyKey(m[1]);
    assert.equal(r.ok, true);
  });

  it("the server example sends the header, makes a fresh key per placement and lets a retry reuse it", () => {
    const ts = lines("SERVER_EXAMPLE");
    assert.match(ts, /"Idempotency-Key": idempotencyKey/);
    assert.match(ts, /idempotencyKey: string = crypto\.randomUUID\(\)/);
    assert.match(ts, /const API_KEY = process\.env\.BLISSCCO_PUBLISHER_API_KEY;/);
    assert.doesNotMatch(ts, /idempotencyKey\s*=\s*process\.env/);
  });

  it("the guide documents the invalid_idempotency_key reason and tells publishers to retry with the SAME key", () => {
    const g = read(GUIDE).replace(/\s+/g, " ");
    assert.match(g, /invalid_idempotency_key/);
    assert.match(g, /send the SAME Idempotency-Key/);
    assert.match(g, /48 hours/);
    assert.match(g, /8 to 64/);
  });

  it("the guide still says there is no impression/click reporting and nothing is for billing or payouts", () => {
    const g = read(GUIDE).replace(/\s+/g, " ");
    assert.match(g, /no impression or click reporting/);
    assert.match(g, /billing or payouts/);
  });

  it("a malformed key is rejected, a missing key is allowed (old publishers keep working)", () => {
    assert.deepEqual(parseIdempotencyKey(null), { ok: true, value: undefined });
    for (const bad of ["", "short", "has space in it", "bad/slash/key1", "x".repeat(65), "emoji-\u{1F600}-key1"]) {
      assert.equal(parseIdempotencyKey(bad).ok, false, JSON.stringify(bad));
    }
    assert.equal(parseIdempotencyKey("7b0e3c1a-1c2d-4e5f-8a9b-0c1d2e3f4a5b").ok, true);
  });
});

describe("Day 9 part 6: migration ordering and safety", () => {
  it("all Day 9 migrations and tests exist, and migrations sort in the documented order", () => {
    for (const f of [...DAY9_MIGRATIONS, ...DAY9_TESTS]) assert.ok(allSql.includes(f), f);
    const sorted = [...DAY9_MIGRATIONS].sort((a, b) => cmp(version(a), version(b)));
    assert.deepEqual(sorted, DAY9_MIGRATIONS);
  });

  it("each Day 9 migration only depends on files that sort BEFORE it and exist", () => {
    for (const f of DAY9_MIGRATIONS) {
      const head = read(`${SQL_DIR}/${f}`).split("\n").slice(0, 6).join(" ");
      const deps = [...head.matchAll(/day-(\d+)-(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
      const own = version(f);
      if (deps.length === 0) {
        assert.match(head, /Pehle Day \d/, `${f}: dependency line nahi mili`); // 9-3: "Pehle Day 3 aur Day 7 ki SQL chalni chahiye"
        continue;
      }
      for (const d of deps) {
        assert.ok(cmp(d, own) < 0, `${f} apne se baad wali file (${d.join("-")}) par depend karti hai`);
        assert.ok(allSql.some((x) => version(x).join("-") === d.join("-")), `${f}: day-${d.join("-")} file hai hi nahi`);
      }
    }
  });

  it("day-9-5 defines private.replay_serve BEFORE record_ad_serve uses it, and day-9-7 replaces it with the same signature", () => {
    const s5 = read(`${SQL_DIR}/day-9-5-atomic-spend-idempotency.sql`);
    const defAt = s5.indexOf("create or replace function private.replay_serve(p_publisher_id uuid, p_key text)");
    const useAt = s5.indexOf("private.replay_serve(", s5.indexOf("create or replace function public.record_ad_serve("));
    assert.ok(defAt >= 0 && useAt > defAt);
    assert.match(read(`${SQL_DIR}/day-9-7-lifecycle-guards.sql`), /create or replace function private\.replay_serve\(p_publisher_id uuid, p_key text\)/);
  });

  it("Day 9 migrations never drop/delete/truncate data, tables, columns or RLS, and never touch statuses", () => {
    for (const f of DAY9_MIGRATIONS) {
      // purge_old_ad_logs ka `delete from` purana, documented retention kaam hai (function ke andar, migration chalte waqt nahi chalta).
      const sql = read(`${SQL_DIR}/${f}`)
        .replace(/create or replace function private\.purge_old_ad_logs[\s\S]*?\$\$;/, "")
        .split("\n")
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n")
        .toLowerCase();
      assert.doesNotMatch(sql, /\bdrop\s+(table|column|schema|policy)\b/, f);
      assert.doesNotMatch(sql, /\btruncate\b/, f);
      assert.doesNotMatch(sql, /\bdelete\s+from\b/, f);
      assert.doesNotMatch(sql, /disable\s+row\s+level\s+security/, f);
      assert.doesNotMatch(sql, /grant\s+[^;]*\bto\s+(anon|public)\b/, f);
      assert.doesNotMatch(sql, /service_role_key|sb_secret|eyJ[a-z0-9_-]{20,}/i, f);
    }
  });

  it("Day 9 test SQL files are rollback-only (they end in a deliberate raise, never commit)", () => {
    for (const f of ["day-9-4-budget-tests.sql", "day-9-8-lifecycle-tests.sql"]) {
      const sql = read(`${SQL_DIR}/${f}`);
      assert.match(sql, /raise exception 'DAY9_/, f);
      assert.doesNotMatch(sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n"), /\bcommit\b/i, f);
    }
  });

  it("app limits and database limits agree (max total budget, min budgets)", () => {
    assert.equal(MAX_BUDGET, 10_000_000);
    assert.match(read(`${SQL_DIR}/day-9-3-budget-rules.sql`), /total_budget <= 10000000/);
    assert.ok(MIN_TOTAL_BUDGET > 0 && MIN_DAILY_BUDGET > 0 && MIN_DAILY_BUDGET <= MIN_TOTAL_BUDGET);
  });
});

describe("Day 9 part 6: spend accounting stays separate from impression/click tracking", () => {
  const SKIP = new Set(["lib/demo-data.ts"]);
  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) out.push(...sourceFiles(rel));
      else if (/\.(ts|tsx)$/.test(e.name) && !SKIP.has(rel)) out.push(rel);
    }
    return out;
  }
  const code = [...sourceFiles("app"), ...sourceFiles("lib"), ...sourceFiles("components")];

  it("no code references Revive Adserver (no duplicate tracking has been introduced)", () => {
    for (const f of code) assert.doesNotMatch(read(f), /revive|adserver|ad-server/i, f);
    for (const f of allSql) assert.doesNotMatch(read(`${SQL_DIR}/${f}`), /revive|adserver/i, f);
  });

  it("no impression/click tracking endpoint, table or pixel exists", () => {
    for (const f of code) {
      assert.doesNotMatch(f, /track|pixel|beacon|impression|click/i, `route/file naam: ${f}`);
    }
    for (const f of DAY9_MIGRATIONS) {
      const sql = read(`${SQL_DIR}/${f}`).toLowerCase();
      assert.doesNotMatch(sql, /create\s+table[^;]*(impression|click)/, f);
    }
    for (const f of allSql) {
      assert.doesNotMatch(read(`${SQL_DIR}/${f}`).toLowerCase(), /create\s+table[^;]*(impression|click)/, f);
    }
  });

  it("app code never writes spend tables directly: spend is written only by the record_ad_serve database function", () => {
    for (const f of code) {
      const src = read(f);
      assert.doesNotMatch(src, /from\(\s*["'](campaign_spend_daily|ad_serve_log|ad_serve_requests)["']\s*\)\s*\.\s*(insert|update|upsert|delete)/, f);
    }
    const rpcUsers = code.filter((f) => /\.rpc\(\s*["']record_ad_serve["']/.test(read(f)));
    assert.deepEqual(rpcUsers, ["lib/ads/serve-db.ts"]);
  });

  it("advertiser-facing copy does not promise impression/click numbers that do not exist", () => {
    const detail = read("app/dashboard/advertiser/campaigns/[id]/page.tsx");
    assert.match(detail, /Not tracked yet/);
    assert.match(read("app/dashboard/analytics/page.tsx"), /not tracked yet/i);
  });
});

describe("Day 9 part 6: documentation matches what exists", () => {
  it("SCHEMA-OVERVIEW lists every Day 9 migration in order", () => {
    const doc = read("supabase/SCHEMA-OVERVIEW.md");
    let last = -1;
    for (const f of DAY9_MIGRATIONS) {
      const at = doc.indexOf(f);
      assert.ok(at > last, `${f} SCHEMA-OVERVIEW me nahi ya galat order me`);
      last = at;
    }
  });

  it("the Day 9 completion report exists, is honest about what was NOT run, and has no secrets", () => {
    const rep = read("DAY9-COMPLETION-REPORT.md");
    assert.match(rep, /NOT RUN/);
    assert.match(rep, /Manual deployment steps/i);
    assert.doesNotMatch(rep, /sb_secret_[A-Za-z0-9]{8,}|eyJ[a-z0-9_-]{20,}|postgres:\/\/[^\s]+:[^\s@]+@/i);
  });
});
