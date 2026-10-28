import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Day 12 / Part 2: event database foundation ki STATIC jaanch (koi database, network ya SQL execution nahi).
// Ye sirf migration/test SQL files ka text padhta hai. Asli Postgres behaviour tab tak "NOT RUN" hai jab tak
// supabase/sql/day-12-4-event-tests.sql TEST project par chalakar PASS na dikh jaye.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const SQL = "supabase/sql";
const M1 = `${SQL}/day-12-1-serve-ref.sql`;
const M2 = `${SQL}/day-12-2-ad-events.sql`;
const VERIFY = `${SQL}/day-12-3-event-verify.sql`;
const TESTS = `${SQL}/day-12-4-event-tests.sql`;

/** Comments hata kar lowercase SQL (sirf executable text). */
function code(f: string): string {
  return read(f)
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .toLowerCase();
}

describe("Day 12 part 2: migrations are additive and safe", () => {
  it("the four Day 12 files exist and follow the project's day-N-K naming (migration 1 sorts before 2)", () => {
    const files = readdirSync(path.join(ROOT, SQL)).filter((f) => /^day-12-/.test(f)).sort();
    assert.deepEqual(files, ["day-12-1-serve-ref.sql", "day-12-2-ad-events.sql", "day-12-3-event-verify.sql", "day-12-4-event-tests.sql"]);
  });

  it("migrations never drop, truncate or rewrite existing data, never disable RLS, never grant to app roles", () => {
    for (const f of [M1, M2]) {
      // purge_old_ad_logs ka `delete from` documented retention kaam hai (function ke andar; migration chalte waqt nahi chalta).
      const sql = code(f).replace(/create or replace function private\.purge_old_ad_logs[\s\S]*?\$\$;/, "");
      assert.doesNotMatch(sql, /\bdrop\s+(table|column|schema|policy|function|index)\b/, f);
      assert.doesNotMatch(sql, /\btruncate\b/, f);
      assert.doesNotMatch(sql, /\bdelete\s+from\b/, f);
      assert.doesNotMatch(sql, /\bupdate\s+public\./, `${f} rewrites existing rows`);
      assert.doesNotMatch(sql, /\binsert\s+into\s+public\.(ad_serve_log|campaign_spend_daily|creative_serve_daily|ad_serve_requests)\b/, `${f} writes to a spend/serve table`);
      assert.doesNotMatch(sql, /disable\s+row\s+level\s+security/, f);
      assert.doesNotMatch(sql, /\bgrant\s+(?!execute on function)/, `${f} grants table access`);
      assert.doesNotMatch(sql, /set\s+not\s+null/, `${f} would fail or rewrite on legacy rows`);
      assert.doesNotMatch(sql, /service_role_key|sb_secret|eyJ[a-z0-9_-]{20,}/i, f);
    }
  });

  it("migration 1: nullable serve_ref + default set separately (no rewrite), unique index, format check, NOT VALID required check, attribution key", () => {
    const sql = code(M1);
    assert.match(sql, /add column if not exists serve_ref text;/);
    assert.match(sql, /alter column serve_ref set default \('bsr_' \|\|/);
    assert.doesNotMatch(sql, /add column[^;]*default/, "default must be set in a separate step so legacy rows are not rewritten/backfilled");
    assert.match(sql, /create unique index if not exists ad_serve_log_serve_ref_key on public\.ad_serve_log \(serve_ref\)/);
    assert.match(sql, /check \(serve_ref is null or serve_ref ~ '\^bsr_\[0-9a-f\]\{40\}\$'\)/);
    assert.match(sql, /check \(serve_ref is not null\) not valid/);
    assert.match(sql, /unique \(id, publisher_id, creative_id, campaign_id\)/);
    assert.match(sql, /if not exists \(select 1 from pg_constraint/, "constraints must be re-runnable");
  });

  it("migration 2: ad_events has the three dedupe rules, the attribution FK, checks, guard trigger, RLS on and every role revoked", () => {
    const sql = code(M2);
    assert.match(sql, /create table if not exists public\.ad_events/);
    assert.match(sql, /constraint ad_events_event_id_key unique \(event_id\)/);
    assert.match(sql, /constraint ad_events_one_per_type_key unique \(serve_id, event_type\)/);
    assert.match(sql, /create unique index if not exists ad_events_source_external_key\s+on public\.ad_events \(source, external_event_id\)\s+where external_event_id is not null/);
    assert.match(sql, /foreign key \(serve_id, publisher_id, creative_id, campaign_id\)\s+references public\.ad_serve_log \(id, publisher_id, creative_id, campaign_id\)\s+on delete restrict/);
    assert.match(sql, /check \(event_type in \('serve', 'impression', 'click'\)\)/);
    assert.match(sql, /check \(source in \('blisscco_beacon', 'blisscco_redirect', 'publisher_server', 'external'\)\)/);
    assert.match(sql, /occurred_at <= received_at \+ interval '5 minutes'/);
    assert.match(sql, /create trigger ad_events_guard\s+before insert or update on public\.ad_events/);
    assert.match(sql, /append-only/);
    assert.match(sql, /alter table public\.ad_events enable row level security;/);
    assert.match(sql, /revoke all on table public\.ad_events from public, anon, authenticated, service_role;/);
    assert.match(sql, /revoke all on sequence public\.ad_events_id_seq from public, anon, authenticated, service_role;/);
    assert.match(sql, /revoke all on function private\.guard_ad_event\(\) from public, anon, authenticated, service_role;/);
    assert.doesNotMatch(sql, /create policy/, "no RLS policy: table stays closed to every API role");
  });

  it("ad_events stores no prompt, IP, user agent, user id, email, referrer, cookie or fingerprint", () => {
    const body = /create table if not exists public\.ad_events \(([\s\S]*?)\n\);/.exec(code(M2))?.[1] ?? "";
    assert.ok(body.length > 100, "ad_events table body not found");
    const cols = body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("constraint") && !l.startsWith("foreign") && !l.startsWith("references") && !l.startsWith("on delete"))
      .map((l) => l.split(/\s+/)[0]);
    assert.deepEqual(cols.filter((c) => /^[a-z_]+$/.test(c)).sort(), [
      "campaign_id", "creative_id", "event_id", "event_type", "external_event_id", "id", "occurred_at", "publisher_id", "received_at", "serve_id", "source",
    ]);
    assert.doesNotMatch(body, /prompt|message|user_agent|useragent|\bip\b|ip_address|user_id|email|referrer|referer|cookie|fingerprint|conversation/);
  });

  it("retention: purge deletes events BEFORE serve log (FK RESTRICT), keeps the 90/30-day rule, 48h retry keys and never touches campaign_spend_daily", () => {
    const purge = /create or replace function private\.purge_old_ad_logs[\s\S]*?\n\$\$;/.exec(code(M2))?.[0] ?? "";
    assert.ok(purge.length > 200, "purge function not found");
    const at = (needle: string) => purge.indexOf(needle);
    assert.ok(at("delete from public.ad_events") >= 0);
    assert.ok(at("delete from public.ad_events") < at("delete from public.ad_serve_log"));
    assert.ok(at("delete from public.ad_serve_log") < at("delete from public.creative_serve_daily"));
    assert.match(purge, /greatest\(coalesce\(p_keep_days, 90\), 30\)/);
    assert.match(purge, /delete from public\.api_rate_limits where window_start < now\(\) - interval '1 day'/);
    assert.match(purge, /delete from public\.ad_serve_requests where created_at < now\(\) - interval '48 hours'/);
    assert.doesNotMatch(purge, /campaign_spend_daily/);
    assert.match(purge, /'ad_events', v_events/);
    assert.match(code(M2), /revoke all on function private\.purge_old_ad_logs\(integer\) from public, anon, authenticated, service_role;/);
  });

  it("the purge function keeps everything the Day 9 version had (nothing silently dropped)", () => {
    const old = /create or replace function private\.purge_old_ad_logs[\s\S]*?\n\$\$;/.exec(code(`${SQL}/day-9-5-atomic-spend-idempotency.sql`))?.[0] ?? "";
    const now = /create or replace function private\.purge_old_ad_logs[\s\S]*?\n\$\$;/.exec(code(M2))?.[0] ?? "";
    for (const stmt of old.match(/delete from [^;]+;/g) ?? []) assert.ok(now.includes(stmt), `missing from new purge: ${stmt}`);
    for (const key of ["ad_serve_log", "creative_serve_daily", "api_rate_limits", "ad_serve_requests"]) assert.ok(now.includes(`'${key}'`), key);
  });
});

describe("Day 12 part 2: billing, serve and the API contract are untouched", () => {
  it("no Day 12 migration redefines record_ad_serve, replay/idempotency functions or the spend guard", () => {
    for (const f of [M1, M2]) {
      const sql = code(f);
      assert.doesNotMatch(sql, /function public\.record_ad_serve/, f);
      assert.doesNotMatch(sql, /function private\.replay_serve|function public\.find_idempotent_serve|function private\.guard_campaign_spend/, f);
      assert.doesNotMatch(sql, /campaign_spend_daily/, `${f} must not touch spend`);
      assert.doesNotMatch(sql, /ad_platform_settings|cpm_usd/, `${f} must not touch the billing rate`);
    }
  });

  it("the earlier serve/spend migrations do not mention serve_ref or ad_events (they were not edited)", () => {
    for (const f of ["day-5-3-delivery-tables.sql", "day-5-8-serve-functions.sql", "day-7-1-budget-keys-retention.sql", "day-9-5-atomic-spend-idempotency.sql", "day-9-7-lifecycle-guards.sql"]) {
      assert.doesNotMatch(read(`${SQL}/${f}`), /serve_ref|ad_events/i, f);
    }
  });

  it("nothing writes ad_events: no trigger or function copies a serve into an event (a serve is never an impression)", () => {
    // (verify file sirf SELECT hai; uske andar ka "insert into" text ek string literal hai jo dusre functions me ye dhoondta hai.)
    for (const f of readdirSync(path.join(ROOT, SQL)).filter((x) => /^day-/.test(x) && !/-tests?\.sql$/.test(x) && x !== "day-12-3-event-verify.sql")) {
      assert.doesNotMatch(code(`${SQL}/${f}`), /insert\s+into\s+public\.ad_events/, f);
    }
    assert.doesNotMatch(code(M2), /after insert on public\.ad_serve_log/);
  });

  it("no application code, route or response mentions serve_ref / ad_events yet (public API contract unchanged)", () => {
    const walk = (dir: string): string[] =>
      readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${dir}/${e.name}`] : [],
      );
    for (const f of ["app", "lib", "components"].flatMap(walk)) {
      assert.doesNotMatch(read(f), /serve_ref|serveRef|ad_events|record_ad_event/, f);
    }
  });
});

describe("Day 12 part 2: verification and test SQL", () => {
  it("verify file is read-only (select only, no DML/DDL)", () => {
    // String literals (jaise position('delete from ...' in prosrc)) hata kar dekho: sirf asli statements matter karte hain.
    const sql = code(VERIFY).replace(/'(?:[^']|'')*'/g, "''");
    assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/);
    assert.match(sql, /^\s*with checks\(check_name, passed, detail\)/m);
  });

  it("test file has the seven blocks and every block is rollback-only (never commits)", () => {
    const sql = read(TESTS);
    for (const t of ["T1 :", "T2 :", "T3 :", "T4 :", "T5 :", "T6 :", "T7 :"]) assert.ok(sql.includes(`===== ${t}`) || sql.includes(`${t} `), t);
    const exec = code(TESTS);
    assert.doesNotMatch(exec, /\bcommit\b/);
    const begins = (exec.match(/^begin;/gm) ?? []).length;
    const rollbacks = (exec.match(/^rollback;/gm) ?? []).length;
    assert.equal(begins, 7);
    assert.equal(rollbacks, 7);
  });

  it("the tests cover duplicates, invalid references, unauthorized roles, retention and unchanged billing", () => {
    const sql = read(TESTS);
    for (const needle of [
      "ad_events_one_per_type_key", "ad_events_event_id_key", "ad_events_source_external_key",
      "ad_events_serve_attribution_fk", "ad_events_type_check", "ad_events_source_check", "ad_events_external_id_check", "ad_events_not_future_check",
      "append-only", "RESTRICT", "anon", "authenticated", "service_role", "42501",
      "private.purge_old_ad_logs", "clamped to 30", "campaign_spend_daily", "serve_created_no_impression", "spend_is_exactly_one_unit",
    ]) {
      assert.ok(sql.includes(needle), `test SQL does not cover: ${needle}`);
    }
  });

  it("no Day 12 SQL mentions an external ad server product", () => {
    for (const f of [M1, M2, VERIFY, TESTS]) assert.doesNotMatch(read(f), /revive|adserver|ad server|openx/i, f);
  });
});

describe("Day 12 part 2: report", () => {
  const report = read("DAY12-PART2-EVENT-DB.md");
  it("states honestly that no SQL was run and which tests were actually run", () => {
    assert.match(report, /Koi SQL kisi Supabase project par NAHI chalayi/);
    assert.match(report, /NOT RUN/);
  });
  it("lists the migration order, dependencies and rollback", () => {
    assert.match(report, /Migration order/);
    assert.ok(report.indexOf("day-12-1-serve-ref.sql") < report.indexOf("day-12-2-ad-events.sql"));
    assert.match(report, /Dependencies/);
    assert.match(report, /Rollback/);
  });
});
