import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Day 13 Part 1: financial ledger foundation. Ye TEXT checks hain: SQL kisi database par nahi chalayi gayi (sandbox me Postgres nahi, aur is part me
// connected Supabase par SQL chalana mana tha). SQL ke asli behaviour ke liye rollback-only file supabase/sql/day-13-3-ledger-tests.sql (denim par) chalani hogi.

const ROOT = path.join(__dirname, "..", "..", "..");
const SQL_DIR = path.join(ROOT, "supabase", "sql");
const read = (f: string) => readFileSync(path.join(SQL_DIR, f), "utf8");
const code = (f: string) =>
  read(f)
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .toLowerCase();

const M = "day-13-1-financial-ledger.sql";
const VERIFY = "day-13-2-ledger-verify.sql";
const TESTS = "day-13-3-ledger-tests.sql";
/** Executable text bina quoted strings ke (comment / label ke shabd galat alarm na dein). */
const noStrings = (t: string) => t.replace(/'(?:[^']|'')*'/g, "''");
const sql = code(M);

describe("day 13 part 1 | files and dependencies", () => {
  it("the three Part 1 Day 13 SQL files exist, named day-N-K, migration sorts first (Part 2 adds day-13-4..6 after them)", () => {
    const files = readdirSync(SQL_DIR).filter((f) => /^day-13-/.test(f)).sort();
    assert.deepEqual(files.slice(0, 3), [M, VERIFY, TESTS]);
    assert.ok(files.slice(3).every((f) => /^day-13-[4-9]-/.test(f)), files.join(", "));
  });
  it("migration documents its dependencies and that it was not run anywhere", () => {
    const text = read(M);
    assert.match(text, /Pehle chali honi chahiye/);
    assert.match(text, /chalayi NAHI gayi/);
    assert.match(text, /PEHLE TEST project/);
  });
  it("no existing migration was edited into a ledger writer (record_ad_serve / spend / budget files untouched by name)", () => {
    for (const f of readdirSync(SQL_DIR).filter((x) => !/^day-13-/.test(x))) {
      assert.doesNotMatch(read(f), /financial_ledger|ledger_append|ledger_reverse/, f);
    }
  });
});

describe("day 13 part 1 | table design", () => {
  it("creates exactly one new table; it never alters or drops an existing table, and never touches spend tables", () => {
    assert.equal((sql.match(/create table/g) ?? []).length, 1);
    assert.doesNotMatch(sql, /\balter\s+table\s+public\.(?!financial_ledger)/);
    assert.doesNotMatch(sql, /\bdrop\s+(table|column|schema|policy|function|index)\b/);
    assert.doesNotMatch(sql, /\b(update|insert\s+into|delete\s+from)\s+public\.(?!financial_ledger)/);
    assert.doesNotMatch(sql, /campaign_spend_daily|creative_serve_daily|ad_serve_log|ad_platform_settings|record_ad_serve/);
  });
  it("all five entry types and three accounts are modelled", () => {
    for (const t of ["advertiser_charge", "publisher_earning", "platform_revenue", "adjustment", "reversal"]) assert.ok(sql.includes(`'${t}'`), t);
    for (const a of ["advertiser", "publisher", "platform"]) assert.ok(sql.includes(`'${a}'`), a);
  });
  it("money is numeric (never float), currency is explicit and USD-only like the rest of the project", () => {
    assert.match(sql, /amount\s+numeric\(14, 4\) not null/);
    assert.doesNotMatch(sql, /\b(float|real|double precision|money)\b/);
    assert.match(sql, /currency_code\s+text\s+not null default 'usd'/);
    assert.match(sql, /check \(currency_code = 'usd'\)/);
  });
  it("amount can never be zero, and charge / earning / revenue are always positive", () => {
    assert.match(sql, /check \(amount <> 0\)/);
    assert.match(sql, /entry_type not in \('advertiser_charge', 'publisher_earning', 'platform_revenue'\) or amount > 0/);
  });
  it("foreign keys are RESTRICT (no cascade deletes of financial history)", () => {
    const fks = sql.match(/references public\.\w+ \(\w+\)[^,\n]*/g) ?? [];
    assert.ok(fks.length >= 5, String(fks.length));
    for (const fk of fks) assert.match(fk, /on delete restrict/, fk);
    assert.doesNotMatch(sql, /on delete (cascade|set null)/);
  });
  it("serve source is an opaque reference with NO foreign key to the purgeable serve log", () => {
    assert.match(sql, /source_ref ~ '\^bsr_\[0-9a-f\]\{40\}\$'/);
    assert.doesNotMatch(sql, /references public\.ad_serve_log/);
  });
  it("idempotency: unique key, one entry per serve+type, one reversal per entry", () => {
    assert.match(sql, /constraint financial_ledger_idempotency_key_key unique \(idempotency_key\)/);
    assert.match(sql, /create unique index if not exists financial_ledger_one_per_serve_type_key[\s\S]*?\(source_ref, entry_type\)[\s\S]*?where source_type = 'serve'/);
    assert.match(sql, /create unique index if not exists financial_ledger_one_reversal_key[\s\S]*?\(reverses_entry_id\)/);
  });
  it("adjustments and reversals must name a person and a reason, and only manual source", () => {
    assert.match(sql, /entry_type not in \('adjustment', 'reversal'\)[\s\S]*?source_type = 'manual' and created_by is not null and reason is not null/);
  });
  it("has indexes for campaign, advertiser, publisher and account lookups", () => {
    for (const i of ["financial_ledger_campaign_idx", "financial_ledger_advertiser_idx", "financial_ledger_publisher_idx", "financial_ledger_account_idx"]) assert.ok(sql.includes(i), i);
  });
});

describe("day 13 part 1 | no invented pricing or shares, no billing assumptions", () => {
  it("no percentage, rate, share or cpm is hardcoded in executable SQL", () => {
    const exec = noStrings(sql);
    assert.doesNotMatch(exec, /revenue[_ ]?share|payout|commission|percent|cpm|\*\s*0\.\d|\/\s*100/);
    assert.doesNotMatch(exec, /\b\d+(\.\d+)?\s*%/);
  });
  it("writers take the amount from the caller and never derive it from impressions or clicks", () => {
    assert.match(sql, /p_amount\s+numeric/);
    assert.doesNotMatch(sql, /impression|click|event_type/);
  });
  it("no backfill: the migration inserts no ledger rows by itself", () => {
    const withoutFunctions = sql.replace(/create or replace function[\s\S]*?\$\$;/g, "");
    assert.doesNotMatch(withoutFunctions, /insert\s+into/);
  });
});

describe("day 13 part 1 | append-only and permissions", () => {
  it("UPDATE, DELETE and TRUNCATE are all blocked by triggers", () => {
    assert.match(sql, /before insert or update or delete on public\.financial_ledger/);
    assert.match(sql, /before truncate on public\.financial_ledger/);
    assert.match(sql, /tg_op in \('update', 'delete'\)[\s\S]*?raise exception 'financial_ledger is append-only'/);
  });
  it("reversal rules: must exactly negate, no reversal of a reversal, campaign must belong to the advertiser", () => {
    assert.match(sql, /new\.amount <> -o\.amount/);
    assert.match(sql, /ledger_reversal_of_reversal/);
    assert.match(sql, /ledger_campaign_advertiser_mismatch/);
  });
  it("RLS is on, there is no policy, and every app role (service_role too) loses table and sequence access", () => {
    assert.match(sql, /alter table public\.financial_ledger enable row level security/);
    assert.doesNotMatch(sql, /create policy/);
    assert.match(sql, /revoke all on table public\.financial_ledger from public, anon, authenticated, service_role/);
    assert.match(sql, /revoke all on sequence public\.financial_ledger_id_seq from public, anon, authenticated, service_role/);
    assert.doesNotMatch(sql, /\bgrant\b/);
  });
  it("every function is security definer with an empty search_path and has no EXECUTE for any role", () => {
    const fns = (sql.match(/create or replace function/g) ?? []).length;
    assert.equal(fns, 4);
    assert.equal((sql.match(/security definer/g) ?? []).length, fns);
    assert.equal((sql.match(/set search_path = ''/g) ?? []).length, fns);
    assert.equal((sql.match(/revoke all on function private\.\w+\([^)]*\) from public, anon, authenticated, service_role/g) ?? []).length, fns);
  });
  it("writers are idempotent: duplicate returns the existing row, a different payload raises", () => {
    assert.match(sql, /on conflict do nothing/);
    assert.match(sql, /'outcome', 'duplicate'/);
    assert.match(sql, /ledger_idempotency_conflict/);
  });
});

describe("day 13 part 1 | verify and test files", () => {
  it("verify file is read-only (select only)", () => {
    const v = code(VERIFY);
    assert.doesNotMatch(noStrings(v), /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate)\b/);
    assert.match(v, /select name, case when ok then 'pass' else 'fail' end/);
  });
  it("test file is rollback-only, never commits, and is honest that it was not run", () => {
    const t = read(TESTS);
    assert.match(t, /rollback;\s*$/);
    assert.doesNotMatch(t.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n"), /\bcommit\b/i);
    assert.match(t, /CHALAYA NAHI/);
    assert.match(t, /SIRF TEST project/);
  });
});
