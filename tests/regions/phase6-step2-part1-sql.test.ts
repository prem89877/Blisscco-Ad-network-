import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// Phase 6 Step 2 Part 1: SQL migration ke static checks (file ka text). SQL kisi database par CHALAYI NAHI jaati.
const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const FILE = "supabase/sql/phase6-step2-1-publisher-country-verification.sql";
const sql = read(FILE);
const code = sql.replace(/^\s*--.*$/gm, ""); // sirf asli SQL (comments hata kar)

function fn(name: string): string {
  const start = code.indexOf(`create or replace function ${name}`);
  assert.ok(start >= 0, name);
  const end = code.indexOf("$$;", code.indexOf("as $$", start));
  return code.slice(start, end);
}

describe("migration: columns and constraints", () => {
  it("adds exactly the 5 country columns to publishers, additive only", () => {
    for (const c of ["country_code", "country_status", "country_submitted_at", "country_reviewed_by", "country_reviewed_at"]) {
      assert.match(code, new RegExp(`add column if not exists ${c} `), c);
    }
    assert.equal((code.match(/add column if not exists/g) ?? []).length, 5);
    assert.ok(!/drop table|drop column|truncate|delete from|update public\.publishers\s+set\s+status/i.test(code));
  });

  it("status is pending / verified / rejected; verified and rejected need admin id and time; format is two capital letters", () => {
    assert.match(code, /country_status = 'pending'/);
    assert.match(code, /country_status in \('verified', 'rejected'\)/);
    assert.match(code, /country_reviewed_by is not null and country_reviewed_at is not null/);
    assert.match(code, /country_code ~ '\^\[A-Z\]\{2\}\$'/);
    assert.match(code, /country_reviewed_by\s+uuid references public\.profiles \(id\) on delete restrict/);
  });

  it("no ISO list or country->region mapping in SQL (single source is lib/regions/country-region.ts)", () => {
    assert.ok(!/'(US|GB|IN|DE|FR|AU)'\s*,\s*'[A-Z]{2}'/.test(code));
    assert.ok(!/north_america|western_europe|southeast_asia|rest_of_world|south_asia|middle_east/.test(code));
  });
});

describe("migration: publisher cannot set or verify their own country", () => {
  it("no GRANT of insert/update on publishers (column grants from day-3-5 stay: name, website_url, category only)", () => {
    assert.ok(!/grant\s+(insert|update)[^;]*on\s+public\.publishers/i.test(code));
    assert.ok(!/grant\s+all/i.test(code));
    assert.ok(!/create policy|drop policy|alter table[^;]*row level security|disable row level security/i.test(code));
  });

  it("guard trigger blocks any direct change of the country columns by anon / authenticated, on insert and update", () => {
    const g = fn("private.guard_publisher_country_changes()");
    assert.match(g, /current_user not in \('anon', 'authenticated'\)/);
    assert.match(g, /tg_op = 'INSERT'/);
    assert.match(g, /is distinct from/);
    assert.match(g, /errcode = '42501'/);
    assert.match(code, /before insert or update on public\.publishers/);
    assert.match(code, /revoke all on function private\.guard_publisher_country_changes\(\) from public, anon, authenticated/);
  });

  it("submit_publisher_country: own row via auth.uid(), caller-supplied publisher id impossible, always pending, reviewer data cleared", () => {
    const f = fn("public.submit_publisher_country(p_country_code text)");
    assert.match(f, /security definer/);
    assert.match(f, /set search_path = ''/);
    assert.match(f, /auth\.uid\(\)/);
    assert.match(f, /where p\.profile_id = v_uid/);
    assert.match(f, /for update of p/);
    assert.match(f, /private\.is_active_profile\(\)/);
    assert.match(f, /country_status = 'pending'/);
    assert.match(f, /country_reviewed_by = null/);
    assert.match(f, /country_reviewed_at = null/);
    assert.ok(!/'verified'\s*,?\s*\n?\s*country_submitted_at|country_status = 'verified'/.test(f));
    assert.match(f, /publisher_suspended/);
    assert.match(f, /invalid_country_format/);
    assert.ok(!/p_publisher_id|p_status|p_reviewed/.test(f));
  });
});

describe("migration: admin approval / rejection", () => {
  const f = fn("public.admin_review_publisher_country(");
  it("admin only, approve/reject only, records admin id and time from auth.uid() (never from input)", () => {
    assert.match(f, /private\.is_admin\(\)/);
    assert.match(f, /errcode = '42501'/);
    assert.match(f, /p_decision not in \('approve', 'reject'\)/);
    assert.match(f, /country_reviewed_by = v_uid/);
    assert.match(f, /country_reviewed_at = now\(\)/);
    assert.match(f, /v_uid\s+uuid := \(select auth\.uid\(\)\)/);
    assert.ok(!/p_reviewed|p_admin/.test(f));
  });

  it("blocks self approval, stale country, approving a non-pending country, and locks the row", () => {
    assert.match(f, /v_profile = v_uid/);
    assert.match(f, /self_approval_blocked/);
    assert.match(f, /country_changed/);
    assert.match(f, /country_not_submitted/);
    assert.match(f, /country_not_pending/);
    assert.match(f, /for update of p/);
  });

  it("repeating the same decision changes nothing (review time not overwritten)", () => {
    assert.match(f, /if v_status = v_target then\s+return v_status;/);
  });
});

describe("migration: serving read function and access", () => {
  it("get_publisher_country_state returns the code only for verified, writes nothing", () => {
    const f = fn("public.get_publisher_country_state(p_publisher_id uuid)");
    assert.match(f, /case when p\.country_status = 'verified' then p\.country_code else null end/);
    assert.match(f, /stable/);
    assert.ok(!/\b(insert|update|delete)\b/i.test(f));
  });

  it("service_role only for the serving function; anon never gets any of the three; admin/submit functions are authenticated", () => {
    assert.match(code, /revoke all on function public\.get_publisher_country_state\(uuid\)\s+from public, anon, authenticated/);
    assert.match(code, /grant execute on function public\.get_publisher_country_state\(uuid\)\s+to service_role/);
    assert.match(code, /revoke all on function public\.submit_publisher_country\(text\)\s+from public, anon/);
    assert.match(code, /revoke all on function public\.admin_review_publisher_country\(uuid, text, text\)\s+from public, anon/);
    assert.match(code, /grant execute on function public\.submit_publisher_country\(text\)\s+to authenticated/);
    assert.match(code, /grant execute on function public\.admin_review_publisher_country\(uuid, text, text\)\s+to authenticated/);
    assert.ok(!/to\s+(anon|public)\b/i.test(code));
  });

  it("every function is security definer with an empty search_path", () => {
    for (const name of ["public.submit_publisher_country(p_country_code text)", "public.admin_review_publisher_country(", "public.get_publisher_country_state(p_publisher_id uuid)"]) {
      const f = fn(name);
      assert.match(f, /security definer/, name);
      assert.match(f, /set search_path = ''/, name);
    }
  });
});

describe("migration: nothing else is changed", () => {
  it("does not touch pricing, payments, ledger, payouts, serving, key or review functions", () => {
    assert.ok(!/ad_platform_settings|advertiser_payments|ledger|payout|campaign_spend|authorize_publisher_key|record_ad_serve|load_ad_candidates|admin_set_publisher_status|issue_publisher_key_for/i.test(code));
  });

  it("is wrapped in a transaction and says it was not run anywhere (TEST first)", () => {
    assert.match(code, /^\s*begin;/m);
    assert.match(code, /^\s*commit;/m);
    assert.match(sql, /PRODUCTION PAR ABHI NAHI/);
    assert.match(sql, /kisi database par chalayi NAHI gayi/);
  });

  it("is listed in the migration order doc after phase5-step5-1", () => {
    const doc = read("supabase/MIGRATION-ORDER.md");
    assert.match(doc, /phase6-step2-1/);
    assert.ok(doc.indexOf("phase6-step2-1") > doc.indexOf("phase5-step5-1"));
  });
});
