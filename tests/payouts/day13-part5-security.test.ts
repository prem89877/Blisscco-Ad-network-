import { payoutFake } from "./payout-stubs"; // SABSE PEHLE: nakli modules lagte hain
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { requestPayout } from "@/app/dashboard/publisher/payout-actions";
import { adminPayoutAction } from "@/app/dashboard/admin/payout-actions";
import { initialRunState } from "@/lib/campaigns/types";
import { PAYOUT_STATUSES, canTransition, isPayoutStatus, parsePayoutAmount } from "@/lib/payouts/rules";
import { parseMoney } from "@/lib/ledger/decimal";
import { validateAdjustment, validateReversal } from "@/lib/ledger/validation";

// Day 13 Part 5: financial security regression. Asli database niyam (RLS / grants / triggers) sirf denim par day-13-13 (verify) aur day-13-14 (rollback tests)
// chalane se saabit honge; yahan: server actions ka payload, paise ki jaanch, secrets ka server-only rehna, aur SQL ke TEXT checks.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const strip = (s: string) => s.replace(/--[^\n]*/g, "");
const stripTs = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/[^\n]*/g, "");
const noStrings = (t: string) => t.replace(/'(?:[^']|'')*'/g, "''");
const KEY = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

function walk(dir: string, accept: (f: string) => boolean): string[] {
  const out: string[] = [];
  for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      out.push(...walk(rel, accept));
    } else if (accept(rel)) out.push(rel);
  }
  return out;
}
const SRC = (f: string) => /\.(ts|tsx)$/.test(f);

// ---------------------------------------------------------------------------
describe("day 13 part 5 | admin payout action: payload and identifier validation", () => {
  beforeEach(() => { payoutFake.reset(); payoutFake.role = "admin"; console.error = () => {}; });

  it("odd or malformed action values never reach the database", async () => {
    for (const action of ["APPROVE", "approve ", " paid", "Paid", "pay", "", "reject\n", "approve;drop", "transfer"]) {
      const r = await adminPayoutAction(initialRunState, form({ id: ID, action, reason: "valid reason" }));
      assert.equal(r.status, "error", JSON.stringify(action));
    }
    assert.equal(payoutFake.rpcCalls.length, 0);
  });

  it("malformed record ids never reach the database", async () => {
    for (const id of ["", " " + ID, ID + "\n", ID + "x", "'; drop table x; --", "22222222-2222-4222-8222-22222222222", "1", ID.replace(/-/g, "")]) {
      const r = await adminPayoutAction(initialRunState, form({ id, action: "paid" }));
      assert.equal(r.status, "error", JSON.stringify(id));
    }
    const missing = new FormData(); missing.set("action", "paid");
    assert.equal((await adminPayoutAction(initialRunState, missing)).status, "error");
    assert.equal(payoutFake.rpcCalls.length, 0);
  });

  it("reject reason: blank, 2 chars and 501 chars are refused; exactly 500 is accepted and sent whole", async () => {
    for (const reason of ["", "   ", "ab", "x".repeat(501), "y".repeat(5000)]) {
      assert.equal((await adminPayoutAction(initialRunState, form({ id: ID, action: "reject", reason }))).status, "error", String(reason.length));
    }
    assert.equal(payoutFake.rpcCalls.length, 0);
    payoutFake.rpcData = { outcome: "rejected", id: ID, status: "rejected" };
    const ok = await adminPayoutAction(initialRunState, form({ id: ID, action: "reject", reason: "z".repeat(500) }));
    assert.equal(ok.status, "success");
    assert.equal((payoutFake.rpcCalls[0].args.p_reason as string).length, 500);
  });

  it("only id + decision (+ reason) are ever sent: no actor, status, amount or publisher from the form", async () => {
    payoutFake.rpcData = { outcome: "approved", id: ID, status: "approved" };
    await adminPayoutAction(initialRunState, form({ id: ID, action: "approve", reviewed_by: ID, status: "paid", amount: "999", publisher_id: ID, p_actor: ID }));
    assert.deepEqual(payoutFake.rpcCalls, [{ name: "admin_review_payout_request", args: { p_request_id: ID, p_decision: "approve", p_reason: null } }]);
  });

  it("a database answer that is not a known outcome is never shown as success, and nothing is revalidated", async () => {
    for (const data of [null, "ok", 5, [], {}, { outcome: "success" }, { outcome: "PAID" }, { outcome: "approved_but_not_really" }]) {
      payoutFake.reset(); payoutFake.role = "admin"; payoutFake.rpcData = data;
      const r = await adminPayoutAction(initialRunState, form({ id: ID, action: "paid" }));
      assert.equal(r.status, "error", JSON.stringify(data));
      assert.equal(payoutFake.revalidated.length, 0);
    }
  });
});

describe("day 13 part 5 | publisher payout action: amount and key validation", () => {
  beforeEach(() => { payoutFake.reset(); payoutFake.role = "publisher"; console.error = () => {}; });

  it("hostile amounts never reach the database", async () => {
    const bad = ["", " ", "0", "0.0000", "-1", "-0.0001", "1e3", "1E-3", "0x10", "1,5", "1 000", "NaN", "Infinity", "+5", ".5", "5.", "1.00001",
      "10000000000", "99999999999999999", "\u0663", "\uFF11\uFF12", "1".repeat(100), "12.5;DROP", "12.5 USD", "12.5\u200B", "[1]", "{}"];
    for (const amount of bad) {
      const r = await requestPayout(initialRunState, form({ amount, requestKey: KEY }));
      assert.equal(r.status, "error", JSON.stringify(amount));
    }
    assert.equal(payoutFake.rpcCalls.length, 0);
  });

  it("surrounding spaces / newlines are trimmed, and only the exact normalised amount text is sent (no hidden character passes through)", async () => {
    payoutFake.rpcData = { outcome: "requested", id: ID, status: "requested", amount: "12.5000" };
    await requestPayout(initialRunState, form({ amount: " 12.5\n", requestKey: KEY }));
    assert.deepEqual(payoutFake.rpcCalls.map((c) => c.args.p_amount), ["12.5000"]);
  });

  it("malformed request keys never reach the database", async () => {
    for (const requestKey of ["", "1", "not-a-uuid", KEY + "x", " " + KEY, KEY.replace(/-/g, "")]) {
      assert.equal((await requestPayout(initialRunState, form({ amount: "1", requestKey }))).status, "error", JSON.stringify(requestKey));
    }
    assert.equal(payoutFake.rpcCalls.length, 0);
  });

  it("a valid amount goes out as exact 4-decimal text and nothing else is sent (currency, publisher, status in the form are ignored)", async () => {
    payoutFake.rpcData = { outcome: "requested", id: ID, status: "requested", amount: "12.5000" };
    const r = await requestPayout(initialRunState, form({ amount: "12.5", requestKey: KEY, currency: "EUR", publisher_id: ID, status: "paid", reviewed_by: ID }));
    assert.equal(r.status, "success");
    assert.deepEqual(payoutFake.rpcCalls, [{ name: "request_my_payout", args: { p_amount: "12.5000", p_request_key: KEY } }]);
  });

  it("boundary amounts: smallest (0.0001) and largest (9999999999.9999) are accepted; one unit beyond the largest is not", () => {
    assert.deepEqual(parsePayoutAmount("0.0001"), { ok: true, units: 1n });
    assert.deepEqual(parsePayoutAmount("9999999999.9999"), { ok: true, units: 99_999_999_999_999n });
    assert.deepEqual(parsePayoutAmount("10000000000.0000"), { ok: false, reason: "too_large" });
  });
});

describe("day 13 part 5 | money, currency and status rules", () => {
  it("money parser refuses non-ASCII digits, exponents, hex, signs and separators", () => {
    for (const bad of ["\u0663", "\uFF11", "1e3", "0x1", "1_000", "+1", "1 000", "1,000", "--1", "- 1", "1.", ".1", "\u00BD"]) {
      assert.equal(parseMoney(bad).ok, false, JSON.stringify(bad));
    }
    assert.equal(parseMoney(5 as never).ok, false);
    assert.equal(parseMoney(null as never).ok, false);
  });

  it("adjustment input: number (float) amounts, unknown accounts and unknown currencies are refused; there is no currency field at all", () => {
    const base = { actorProfileId: KEY, account: "publisher" as const, amount: "1.5", idempotencyKey: "adjust-pub-0001", reason: "Manual fix", publisherId: ID };
    assert.equal(validateAdjustment(base).ok, true);
    assert.equal(validateAdjustment({ ...base, amount: 1.5 as never }).ok, false);
    assert.equal(validateAdjustment({ ...base, account: "bank" as never }).ok, false);
    const withCurrency = validateAdjustment({ ...base, currency: "EUR" } as never);
    assert.equal(withCurrency.ok, true);
    assert.ok(withCurrency.ok && !("currency" in withCurrency.value), "currency must be dropped, never forwarded");
    assert.equal(validateAdjustment({ ...base, publisherId: null }).ok, false); // publisher account needs a publisher id
  });

  it("reversal input: ids must be positive safe integers; keys and reasons follow the SQL format", () => {
    const base = { actorProfileId: KEY, entryId: 1, idempotencyKey: "reverse-1-0001", reason: "Duplicate" };
    assert.equal(validateReversal(base).ok, true);
    for (const entryId of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, "1" as never]) assert.equal(validateReversal({ ...base, entryId }).ok, false, String(entryId));
    for (const idempotencyKey of ["short", "has space 0001", "slash/0001/0001", "x".repeat(201)]) assert.equal(validateReversal({ ...base, idempotencyKey }).ok, false, idempotencyKey);
    assert.equal(validateReversal({ ...base, reason: "x" }).ok, false);
  });

  it("status values are exact lowercase words; transitions cannot skip a step or go backwards", () => {
    for (const s of ["PAID", "Paid", " paid", "paid ", "pending", "cancelled", "", null, 1]) assert.equal(isPayoutStatus(s), false, String(s));
    assert.equal(canTransition("requested", "paid"), false); // approve pehle zaroori
    assert.equal(canTransition("approved", "requested"), false);
    for (const a of PAYOUT_STATUSES) for (const b of PAYOUT_STATUSES) {
      if (a === "paid" || a === "rejected") assert.equal(canTransition(a, b), false, `${a}->${b}`); // aakhri
      assert.equal(canTransition(a, a), false, `${a}->${a}`); // wahi status dobara = koi badlav nahi
    }
  });
});

// ---------------------------------------------------------------------------
describe("day 13 part 5 | secrets stay on the server", () => {
  const files = [...walk("app", SRC), ...walk("components", SRC), ...walk("lib", SRC), "middleware.ts"];

  it("SUPABASE_SECRET_KEY is read in exactly one file (lib/supabase/admin.ts), and that file is server-only", () => {
    const users = files.filter((f) => /SUPABASE_SECRET_KEY/.test(stripTs(read(f))));
    assert.deepEqual(users, ["lib/supabase/admin.ts"]);
    assert.match(read("lib/supabase/admin.ts"), /^import "server-only";/m);
  });

  it("no variable that carries a secret is public: NEXT_PUBLIC_ names never contain SECRET / SERVICE / PRIVATE / PASSWORD / TOKEN / SIGNING", () => {
    const sources = [...files, ".env.example", "next.config.mjs"];
    const names = new Set<string>();
    for (const f of sources) for (const m of read(f).matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) names.add(m[0]);
    assert.ok(names.size >= 2);
    for (const n of names) assert.doesNotMatch(n, /SECRET|SERVICE|PRIVATE|PASSWORD|TOKEN|SIGNING/, n);
  });

  it("next.config has no env block (it would copy values into the browser bundle)", () => {
    assert.doesNotMatch(stripTs(read("next.config.mjs")), /\benv\s*:/);
  });

  it("client components read no process.env except NEXT_PUBLIC_ and never import the admin client or the ledger service", () => {
    for (const f of files.filter((x) => /^["']use client["']/m.test(read(x)))) {
      const t = stripTs(read(f));
      for (const m of t.matchAll(/process\.env\.([A-Z0-9_]+)/g)) assert.match(m[1], /^NEXT_PUBLIC_/, `${f}: ${m[0]}`);
      assert.doesNotMatch(t, /supabase\/admin|ledger\/ledger-db|keys-db|serve-db|SUPABASE_SECRET_KEY/, f);
    }
  });

  it("no Day 13 money page / action / component / data module imports the service-role client", () => {
    const money = [
      ...walk("lib/payouts", SRC), ...walk("lib/ledger", SRC).filter((f) => !f.endsWith("ledger-db.ts")),
      "app/dashboard/publisher/payout-actions.ts", "app/dashboard/publisher/earnings/page.tsx", "app/dashboard/publisher/payouts/page.tsx",
      "app/dashboard/admin/payout-actions.ts", "app/dashboard/admin/page.tsx",
      "components/admin/PayoutRequestsPanel.tsx", "components/admin/PayoutActionButton.tsx", "components/dashboard/PayoutRequestForm.tsx",
    ];
    for (const f of money) assert.doesNotMatch(stripTs(read(f)), /supabase\/admin|SUPABASE_SECRET_KEY|ledger\/ledger-db/, f);
  });

  it("public API routes never import money modules or mention ledger / payout / earnings / balance in code", () => {
    const api = walk("app/api", SRC);
    assert.ok(api.length >= 4);
    for (const f of api) {
      const t = stripTs(read(f));
      assert.doesNotMatch(t, /lib\/(ledger|payouts)\//, f);
      assert.doesNotMatch(t, /\b(ledger|payout|payouts|earning|earnings|balance|revenue|publisher_share|service_role)\b/i, f);
    }
  });
});

// ---------------------------------------------------------------------------
describe("day 13 part 5 | SQL: every Day 13 migration keeps the money tables closed (text checks)", () => {
  const MIGRATIONS = ["day-13-1-financial-ledger.sql", "day-13-4-ledger-service.sql", "day-13-7-publisher-earnings.sql", "day-13-9-payout-requests.sql", "day-13-12-financial-security.sql"];
  const code = (f: string) => strip(read(`supabase/sql/${f}`)).toLowerCase();
  const TABLES = ["financial_ledger", "ledger_settings", "publisher_payout_requests", "publisher_payout_events", "financial_settings_history"];

  it("all migrations exist, are wrapped in one transaction, and say they were not run on any database", () => {
    for (const f of MIGRATIONS) {
      assert.ok(existsSync(path.join(ROOT, "supabase/sql", f)), f);
      const c = code(f);
      assert.match(c, /^\s*begin;/m, f);
      assert.match(c, /^\s*commit;/m, f);
      assert.match(read(`supabase/sql/${f}`), /chalay[ai] NAHI|NAHI chalay[ai]/i, f);
    }
  });

  it("every money table: RLS on, no policy, every app role revoked", () => {
    const all = MIGRATIONS.map(code).join("\n");
    for (const t of TABLES) {
      assert.match(all, new RegExp(`alter table public\\.${t} +enable row level security`), t);
      assert.match(all, new RegExp(`revoke all on table public\\.${t}\\s+from public, anon, authenticated, service_role`), t);
    }
    assert.doesNotMatch(all, /create policy/);
  });

  it("no migration grants table access to anyone, and nothing is granted to anon or PUBLIC", () => {
    for (const f of MIGRATIONS) {
      const c = noStrings(code(f));
      assert.doesNotMatch(c, /grant\s+(select|insert|update|delete|truncate|references|trigger|all)\b[^;]*\bon\b/, f);
      assert.doesNotMatch(c, /grant\b[^;]*\bto\b[^;]*\b(anon|public)\b/, f);
    }
  });

  it("every function is security definer with an empty search_path, and has an explicit revoke from app roles", () => {
    for (const f of MIGRATIONS) {
      const c = code(f);
      const names = [...c.matchAll(/create or replace function (public|private)\.(\w+)\(/g)].map((m) => `${m[1]}.${m[2]}`);
      assert.ok(names.length >= 2, f);
      assert.equal((c.match(/security definer/g) ?? []).length, names.length, `${f}: security definer`);
      assert.equal((c.match(/set search_path = ''/g) ?? []).length, names.length, `${f}: search_path`);
      for (const n of names) assert.match(c, new RegExp(`revoke all on function ${n.replace(".", "\\.")}\\(`), `${f}: ${n}`);
    }
  });

  it("ledger writers are not callable by any app role; admin reversal / adjustment are service_role only", () => {
    const c4 = code("day-13-4-ledger-service.sql");
    const c1 = code("day-13-1-financial-ledger.sql");
    assert.match(c1, /revoke all on function private\.ledger_append\([^)]*\) from public, anon, authenticated, service_role/);
    assert.match(c1, /revoke all on function private\.ledger_reverse\([^)]*\) from public, anon, authenticated, service_role/);
    assert.match(c4, /grant execute on function public\.ledger_reverse_entry\([^)]*\) to service_role;/);
    assert.match(c4, /grant execute on function public\.ledger_add_adjustment\([^)]*\) to service_role;/);
    assert.doesNotMatch(c4, /grant execute on function public\.ledger_(reverse_entry|add_adjustment)\([^)]*\) to (authenticated|anon)/);
  });

  it("payout and earnings functions are for 'authenticated' only and each admin function checks is_admin() before it writes", () => {
    const c9 = code("day-13-9-payout-requests.sql");
    for (const fn of ["request_my_payout", "admin_review_payout_request", "admin_mark_payout_paid"]) {
      assert.match(c9, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated;`), fn);
      assert.match(c9, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, service_role;`), fn);
    }
    for (const fn of ["admin_review_payout_request", "admin_mark_payout_paid"]) {
      const body = c9.slice(c9.indexOf(`create or replace function public.${fn}(`));
      const end = body.indexOf("$$;", body.indexOf("$$;") + 3);
      const fnText = body.slice(0, end);
      assert.ok(fnText.indexOf("private.is_admin()") > 0 && fnText.indexOf("private.is_admin()") < fnText.indexOf("update public.publisher_payout_requests"), fn);
    }
  });
});

describe("day 13 part 5 | SQL: day-13-12 closes the audit gaps without touching any balance", () => {
  const raw = read("supabase/sql/day-13-12-financial-security.sql");
  const c = strip(raw).toLowerCase();

  it("settings history is append-only (update / delete / truncate blocked) and has baseline rows that are written only once", () => {
    assert.match(c, /create table if not exists public\.financial_settings_history/);
    assert.match(c, /create trigger financial_settings_history_guard\s+before update or delete/);
    assert.match(c, /create trigger financial_settings_history_no_truncate\s+before truncate/);
    assert.equal((c.match(/'baseline'/g) ?? []).length >= 3, true);
    assert.equal((c.match(/where s\.id and not exists \(select 1 from public\.financial_settings_history/g) ?? []).length, 3);
    for (const col of ["setting", "change_kind", "old_value", "new_value", "changed_by", "db_role", "changed_at"]) assert.match(c, new RegExp(`\\b${col}\\b`));
  });

  it("revenue share, ledger on/off and CPM changes are logged by AFTER UPDATE triggers", () => {
    assert.match(c, /create trigger ledger_settings_log_change\s+after update on public\.ledger_settings/);
    assert.match(c, /create trigger ad_platform_settings_log_change\s+after update on public\.ad_platform_settings/);
    for (const s of ["'ledger_enabled'", "'publisher_share_bps'", "'cpm_usd'"]) assert.ok(c.includes(s), s);
    assert.match(c, /is distinct from/);
  });

  it("settings rows cannot be deleted or truncated (they would silently reset share / ledger / CPM to defaults)", () => {
    for (const t of ["ledger_settings", "ad_platform_settings"]) {
      assert.match(c, new RegExp(`create trigger ${t}_no_delete\\s+before delete on public\\.${t}`));
      assert.match(c, new RegExp(`create trigger ${t}_no_truncate\\s+before truncate on public\\.${t}`));
    }
  });

  it("payout guard keeps every old rule and adds exactly three new ones (requester mismatch, review trail frozen, self-review)", () => {
    for (const hint of ["payout_no_delete", "payout_must_start_requested", "payout_immutable_field", "payout_invalid_transition"]) assert.ok(c.includes(hint), hint);
    for (const hint of ["payout_requester_mismatch", "payout_review_trail_frozen", "payout_self_review"]) assert.ok(c.includes(hint), hint);
    assert.match(c, /\(old\.status = 'requested' and new\.status in \('approved', 'rejected'\)\)/);
    assert.match(c, /\(old\.status = 'approved'\s+and new\.status in \('paid', 'rejected'\)\)/);
    assert.match(c, /p\.profile_id = new\.requested_by/);
    assert.match(c, /new\.paid_by is not distinct from new\.requested_by/);
  });

  it("the new guard does not loosen the old one: same transitions and the same immutable fields as day-13-9", () => {
    const old = strip(read("supabase/sql/day-13-9-payout-requests.sql")).toLowerCase();
    const guardOf = (t: string) => t.slice(t.indexOf("function private.guard_payout_request()"), t.indexOf("revoke all on function private.guard_payout_request()"));
    const og = guardOf(old);
    const ng = guardOf(c);
    for (const must of ["new.id <> old.id", "new.publisher_id <> old.publisher_id", "new.amount <> old.amount", "new.currency_code <> old.currency_code", "new.request_key <> old.request_key", "new.requested_by <> old.requested_by", "new.created_at <> old.created_at"]) {
      assert.ok(og.includes(must) && ng.includes(must), must);
    }
  });

  it("it changes no balance, ledger entry, payout row or setting value: no write statements on money tables", () => {
    const n = noStrings(c);
    assert.doesNotMatch(n, /\bupdate\s+public\.(financial_ledger|ledger_settings|ad_platform_settings|publisher_payout_requests|publisher_payout_events)\b/);
    assert.doesNotMatch(n, /\bdelete\s+from\b/);
    assert.doesNotMatch(n, /\binsert\s+into\s+public\.(financial_ledger|ledger_settings|ad_platform_settings|publisher_payout_requests|publisher_payout_events)\b/);
    assert.doesNotMatch(n, /\btruncate\s+(table\s+)?public\./);
    assert.doesNotMatch(n, /record_ad_serve|campaign_spend_daily/);
  });

  it("the verify file is read-only; the test file is rollback-only and TEST-project-only", () => {
    const v = strip(read("supabase/sql/day-13-13-financial-security-verify.sql")).toLowerCase();
    assert.doesNotMatch(noStrings(v), /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/);
    const t = read("supabase/sql/day-13-14-financial-security-tests.sql");
    assert.match(t, /SIRF TEST project \(denim\)/);
    assert.match(t, /ASLI \(blisscco ad network\) par KABHI NAHI/);
    assert.match(t.trim(), /rollback;$/);
    assert.doesNotMatch(strip(t).toLowerCase(), /\bcommit\b/);
    assert.match(t, /^begin;$/m);
  });
});
