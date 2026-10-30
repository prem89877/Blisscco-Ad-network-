import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { splitCharge } from "@/lib/ledger/revenue-share";
import { serveChargeUnitsFromCpm } from "@/lib/ledger/decimal";
import { availableUnits } from "@/lib/payouts/rules";
import { parsePayoutSummaryRow as parseSummaryRow } from "@/lib/payouts/data";

// Day 13 Part 6: ledger + publisher earnings + manual payout ka integration regression.
// Asli SQL behaviour (lock, race) sirf Postgres par saabit hota hai; yahan: SQL ke TEXT checks, TypeScript hisaab, aur pages ke wiring.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const strip = (s: string) => s.replace(/--[^\n]*/g, "");
const noStrings = (t: string) => t.replace(/'(?:[^']|'')*'/g, "''");
const SQL_DIR = path.join(ROOT, "supabase", "sql");
const allSql = () => readdirSync(SQL_DIR).filter((f) => f.endsWith(".sql"));

function fn(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function ${name}(`);
  assert.ok(start >= 0, `function ${name} missing`);
  const end = sql.indexOf("\n$$;", start);
  return sql.slice(start, end);
}

describe("day 13 part 6 | day-13-15: admin ledger writers take the same publisher lock as the payout functions", () => {
  const sql = strip(read("supabase/sql/day-13-15-financial-integration.sql"));
  const reverse = fn(sql, "public.ledger_reverse_entry");
  const adjust = fn(sql, "public.ledger_add_adjustment");
  const lock = /perform 1 from public\.publishers p where p\.id = v_pub for no key update;/;

  it("ledger_reverse_entry locks the publisher row for a publisher-account entry, after the admin + validation checks and before the write", () => {
    assert.match(reverse, /v_acct = 'publisher' and v_pub is not null/);
    assert.match(reverse, lock);
    const order = [reverse.indexOf("ledger_is_active_admin"), reverse.indexOf("'invalid'"), reverse.search(lock), reverse.indexOf("private.ledger_reverse(")];
    assert.ok(order.every((n) => n >= 0), order.join(","));
    assert.deepEqual([...order].sort((a, b) => a - b), order, "order must be: admin check, validation, lock, write");
  });

  it("ledger_add_adjustment locks the publisher row only for the publisher account, before the write", () => {
    assert.match(adjust, /p_account = 'publisher' and p_publisher_id is not null/);
    assert.match(adjust, /perform 1 from public\.publishers p where p\.id = p_publisher_id for no key update;/);
    assert.ok(adjust.indexOf("for no key update") < adjust.indexOf("private.ledger_append("));
    assert.ok(adjust.indexOf("ledger_is_active_admin") < adjust.indexOf("for no key update"));
  });

  it("uses exactly the lock strength the payout functions use (so they serialize), and no stronger", () => {
    const payouts = strip(read("supabase/sql/day-13-9-payout-requests.sql"));
    for (const name of ["public.request_my_payout", "public.admin_review_payout_request", "public.admin_mark_payout_paid"]) {
      assert.match(fn(payouts, name), /for no key update of p;/, name);
    }
    assert.doesNotMatch(noStrings(sql), /for update|for share|lock table/i);
  });

  it("keeps both signatures and grants unchanged: service_role only, never anon / authenticated", () => {
    const base = strip(read("supabase/sql/day-13-4-ledger-service.sql"));
    for (const sig of ["public.ledger_reverse_entry(uuid, bigint, text, text)", "public.ledger_add_adjustment(uuid, text, numeric, text, text, uuid, uuid, uuid)"]) {
      assert.ok(base.includes(`revoke all on function ${sig} from public, anon, authenticated;`), sig);
      assert.ok(sql.includes(`revoke all on function ${sig} from public, anon, authenticated;`), sig);
      assert.ok(sql.includes(`grant execute on function ${sig} to service_role;`), sig);
    }
    assert.doesNotMatch(sql, /grant [^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/);
  });

  it("changes no balance, spend, serve, impression, click or payout data: only the two functions and their grants / comments", () => {
    const code = noStrings(sql);
    assert.doesNotMatch(code, /\b(insert\s+into|delete\s+from|truncate|alter\s+table|create\s+table|drop\s+)/i);
    assert.doesNotMatch(code, /\bupdate\s+public\./i);
    assert.doesNotMatch(code, /campaign_spend_daily|record_ad_serve|ad_events|ad_serve_log|publisher_payout_requests|ledger_settings/);
    assert.equal((code.match(/create or replace function/g) ?? []).length, 2);
  });
});

describe("day 13 part 6 | day-13-16: consistency check is read-only and covers the rules actually implemented", () => {
  const raw = read("supabase/sql/day-13-16-financial-consistency-verify.sql");
  const code = noStrings(strip(raw));

  it("is SELECT-only: no write, DDL, grant or function creation", () => {
    assert.doesNotMatch(code, /\b(insert|update|delete|truncate|alter|create|drop|grant|revoke|perform|execute)\b/i);
    assert.match(code, /^\s*with\b/);
  });

  it("checks split = charge, orphan split rows, one campaign per serve, balance >= reserved + paid, audit trail, one open request", () => {
    for (const n of ["1.", "2.", "3.", "4.", "5a.", "5b.", "6."]) assert.ok(raw.includes(`('${n} `), n);
    assert.match(raw, /s\.earning \+ s\.platform <> s\.charge/);
    assert.match(raw, /x\.ledger_balance < x\.reserved \+ x\.paid/);
  });

  it("does not claim a campaign_spend_daily match as PASS / FAIL (no backfill, so only an INFO query)", () => {
    const checks = strip(raw).slice(0, strip(raw).indexOf("select name, case when ok"));
    assert.doesNotMatch(checks, /campaign_spend_daily/);
    assert.match(raw, /INFO \(PASS \/ FAIL nahi\)/);
  });
});

describe("day 13 part 6 | one charge per serve: the ledger is written from exactly one place, and never from impression / click", () => {
  it("private.ledger_record_serve is called from exactly one SQL statement, after the spend insert", () => {
    const calls = allSql().flatMap((f) => (strip(read(`supabase/sql/${f}`)).match(/perform private\.ledger_record_serve\(/g) ?? []).map(() => f));
    assert.deepEqual(calls, ["day-13-4-ledger-service.sql"]);
    const sql = strip(read("supabase/sql/day-13-4-ledger-service.sql"));
    const rec = fn(sql, "public.record_ad_serve");
    assert.ok(rec.indexOf("insert into public.campaign_spend_daily") < rec.indexOf("perform private.ledger_record_serve("));
    assert.equal((rec.match(/perform private\.ledger_record_serve\(/g) ?? []).length, 1);
  });

  it("the ledger amount is the same v_unit that went into campaign_spend_daily (no second calculation)", () => {
    const rec = fn(strip(read("supabase/sql/day-13-4-ledger-service.sql")), "public.record_ad_serve");
    assert.match(rec, /perform private\.ledger_record_serve\(v_serve_ref, v_campaign_id, v_publisher_id, v_unit\);/);
    assert.equal((rec.match(/v_unit :=/g) ?? []).length, 1);
  });

  it("impression / click code and SQL never touch the ledger, a charge or a payout", () => {
    const files = [
      "supabase/sql/day-12-7-record-ad-impression.sql",
      "supabase/sql/day-12-10-record-ad-click.sql",
      "lib/ads/impression-db.ts",
      "lib/ads/impression-handler.ts",
      "lib/ads/click-db.ts",
      "lib/ads/click-handler.ts",
      "app/api/v1/ads/impression/route.ts",
      "app/api/v1/ads/click/route.ts",
    ];
    for (const f of files) {
      const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "").replace(/^\s*\/\/.*$/gm, "");
      assert.doesNotMatch(code, /financial_ledger|ledger_record_serve|ledger_append|publisher_payout|payout_request|campaign_spend_daily/i, f);
    }
  });
});

describe("day 13 part 6 | earnings page and payouts page show one consistent payout position", () => {
  const earnings = read("app/dashboard/publisher/earnings/page.tsx");
  const payouts = read("app/dashboard/publisher/payouts/page.tsx");

  it("both pages read the same database summary (get_my_payout_summary via fetchMyPayoutSummary)", () => {
    assert.match(earnings, /fetchMyPayoutSummary/);
    assert.match(payouts, /fetchMyPayoutSummary/);
    assert.ok(read("lib/payouts/data.ts").includes('"get_my_payout_summary"'));
  });

  it("the earnings page does no payout arithmetic of its own and never uses the service-role client", () => {
    const code = earnings.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/[^\n]*/g, "");
    assert.doesNotMatch(code, /availableUnits|BigInt|Number\(|parseFloat|toFixed/);
    assert.doesNotMatch(code, /supabase\/admin|createAdminClient|SERVICE_ROLE|SECRET_KEY/);
    assert.match(code, /payout\.data\.available/);
  });

  it("a payout-figure failure never hides or zeroes the ledger figures, and no made-up zero is shown", () => {
    assert.match(earnings, /payout\.status === "error"/);
    assert.match(earnings, /The ledger figures above are not affected/);
    assert.match(earnings, /payout\.status === "ok"/); // figures render only when the summary was read and validated
  });

  it("per-earning pending / approved / paid stays honestly 'Not tracked yet'", () => {
    assert.match(earnings, /Not tracked yet/);
    assert.match(earnings, /UNSUPPORTED_BALANCES/);
  });
});

describe("day 13 part 6 | accounting arithmetic stays consistent (exact BigInt units, no float)", () => {
  it("for many CPMs and shares: publisher + platform = charge, nothing is created or lost, the charge equals the budget unit", () => {
    for (const cpm of [1n, 9n, 10n, 500n, 1_000n, 4_999n, 20_000n, 123_456n, 999_999n]) {
      const charge = serveChargeUnitsFromCpm(cpm);
      assert.ok(charge >= 1n);
      for (const bps of [0, 1, 3333, 5000, 7000, 9999, 10000]) {
        const s = splitCharge(charge, bps);
        assert.equal(s.publisherUnits + s.platformUnits, charge, `cpm ${cpm} bps ${bps}`);
        assert.ok(s.publisherUnits >= 0n && s.platformUnits >= 0n);
        assert.ok(s.publisherUnits <= charge);
      }
    }
  });

  it("a ledger whose serves are split by the rule always reconciles: sum(charge) = sum(earning) + sum(platform)", () => {
    let charges = 0n;
    let earnings = 0n;
    let platform = 0n;
    for (let i = 1n; i <= 200n; i++) {
      const charge = serveChargeUnitsFromCpm(i * 37n);
      const s = splitCharge(charge, 7000);
      charges += charge;
      earnings += s.publisherUnits;
      platform += s.platformUnits;
    }
    assert.equal(earnings + platform, charges);
  });

  it("two payout requests cannot reserve the same earnings: the second sees the first as reserved", () => {
    const ledger = 10_000n; // 1.0000 USD
    assert.equal(availableUnits(ledger, 0n, 0n), 10_000n);
    const afterFirst = availableUnits(ledger, 6_000n, 0n); // 0.6000 reserved
    assert.equal(afterFirst, 4_000n);
    assert.ok(5_000n > afterFirst, "a second 0.5000 request must be refused");
    assert.ok(4_000n <= afterFirst, "exactly the remaining 0.4000 may still be requested");
    assert.equal(availableUnits(ledger, 6_000n + 4_000n, 0n), 0n);
  });

  it("a paid payout is deducted once: available falls by the paid amount and reserved releases it", () => {
    const ledger = 10_000n;
    assert.equal(availableUnits(ledger, 6_000n, 0n), 4_000n); // approved, not paid
    assert.equal(availableUnits(ledger, 0n, 6_000n), 4_000n); // after paid: same available, not 4_000 - 6_000
    assert.equal(availableUnits(ledger, 6_000n, 6_000n), 0n); // double-counting would show 0 (never negative)
  });

  it("a reversal after a request can make the ledger smaller than reserved + paid: available is 0, never negative, and the summary row must still reconcile", () => {
    assert.equal(availableUnits(3_000n, 6_000n, 0n), 0n);
    const row = { currency_code: "USD", eligible: true, ledger_balance: "0.3000", reserved: "0.6000", paid_out: "0.0000", available: "0.0000", has_open_request: true };
    const ok = parseSummaryRow(row);
    if (!ok) throw new Error("a reconciling summary row must parse");
    assert.equal(ok.available, 0n);
    assert.equal(parseSummaryRow({ ...row, available: "0.1000" }), null); // a row that does not reconcile is an error, not a number
    assert.equal(parseSummaryRow({ ...row, available: "-0.3000" }), null);
  });
});
