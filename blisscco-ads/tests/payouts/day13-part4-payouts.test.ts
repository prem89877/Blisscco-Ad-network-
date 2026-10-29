import { payoutFake } from "./payout-stubs"; // SABSE PEHLE: nakli modules lagte hain
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { requestPayout } from "@/app/dashboard/publisher/payout-actions";
import { adminPayoutAction } from "@/app/dashboard/admin/payout-actions";
import { initialRunState } from "@/lib/campaigns/types";
import {
  PAYOUT_STATUSES, PAYOUT_TRANSITIONS, canTransition, availableUnits, parsePayoutAmount, parsePayoutReason,
  adminActionsFor, parseRequestOutcome, parseReviewOutcome, type PayoutStatus,
} from "@/lib/payouts/rules";
import { fetchMyPayoutSummary, fetchMyPayoutRequests, fetchAdminPayoutRequests, parsePayoutSummaryRow, parsePayoutRequestRow } from "@/lib/payouts/data";

// Day 13 Part 4: payout request workflow. Asli database niyam (lock, unique index, guard trigger, is_admin) SQL me hain;
// unka asli saboot sirf day-13-11 (rollback-only, denim) chalne par milega. Yahan: pure niyam, server actions, data parsers, aur SQL / UI ke source checks.
const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const SQL = read("supabase/sql/day-13-9-payout-requests.sql");
const KEY = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const stripComments = (s: string) => s.replace(/--[^\n]*/g, "");

describe("day 13 part 4 | valid state transitions", () => {
  it("exactly requested -> approved|rejected and approved -> paid|rejected; paid and rejected are final", () => {
    assert.deepEqual([...PAYOUT_STATUSES], ["requested", "approved", "rejected", "paid"]);
    for (const a of PAYOUT_STATUSES) for (const b of PAYOUT_STATUSES) {
      const ok = (a === "requested" && (b === "approved" || b === "rejected")) || (a === "approved" && (b === "paid" || b === "rejected"));
      assert.equal(canTransition(a, b), ok, `${a} -> ${b}`);
    }
    assert.deepEqual(PAYOUT_TRANSITIONS.paid, []);
    assert.deepEqual(PAYOUT_TRANSITIONS.rejected, []);
  });
  it("the SQL guard allows the same transitions and nothing else", () => {
    const g = SQL.match(/create or replace function private\.guard_payout_request\(\)[\s\S]*?\$\$;/)![0];
    assert.match(g, /old\.status = 'requested' and new\.status in \('approved', 'rejected'\)/);
    assert.match(g, /old\.status = 'approved'\s+and new\.status in \('paid', 'rejected'\)/);
    assert.match(g, /payout_invalid_transition/);
    assert.match(g, /payout_no_delete/);
    assert.match(g, /payout_immutable_field/);
    assert.match(SQL, /status in \('requested', 'approved', 'rejected', 'paid'\)/);
  });
  it("admin buttons follow the transitions (a hint only; the database guard is the rule)", () => {
    assert.deepEqual(adminActionsFor("requested"), ["approve", "reject"]);
    assert.deepEqual(adminActionsFor("approved"), ["paid", "reject"]);
    assert.deepEqual(adminActionsFor("paid"), []);
    assert.deepEqual(adminActionsFor("rejected"), []);
    for (const s of PAYOUT_STATUSES) for (const a of adminActionsFor(s as PayoutStatus)) {
      assert.ok(canTransition(s, a === "approve" ? "approved" : a === "reject" ? "rejected" : "paid"));
    }
  });
});

describe("day 13 part 4 | balance limits and amounts", () => {
  it("available = ledger - reserved - paid, never below zero", () => {
    assert.equal(availableUnits(250n, 100n, 0n), 150n);
    assert.equal(availableUnits(250n, 0n, 100n), 150n);
    assert.equal(availableUnits(50n, 100n, 100n), 0n);
  });
  it("amounts: zero, negative, float text, 5 decimals, empty are all refused; exact 4-decimal values pass", () => {
    for (const bad of ["", "0", "0.0000", "-1", "-0.0001", "1e3", "+5", "1,5", "1.00005", " ", "abc"]) assert.equal(parsePayoutAmount(bad).ok, false, bad);
    const ok = parsePayoutAmount(" 0.0150 ");
    assert.deepEqual(ok, { ok: true, units: 150n });
  });
  it("SQL refuses invalid amounts without rounding and refuses more than available", () => {
    const f = SQL.match(/create or replace function public\.request_my_payout[\s\S]*?\$\$;/)![0];
    assert.match(f, /p_amount <= 0/);
    assert.match(f, /p_amount <> round\(p_amount, 4\)/);
    assert.match(f, /p_amount > v_avail/);
    assert.match(f, /v_pos\.ledger_balance - v_pos\.reserved - v_pos\.paid/);
    assert.match(SQL, /constraint publisher_payout_amount_check check \(amount > 0\)/);
  });
  it("no minimum payout amount is invented anywhere", () => {
    const code = stripComments(SQL) + read("lib/payouts/rules.ts").replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(code, /(^|[^a-z])min(imum)?[_ ]?payout|payout[_ ]min(imum)?\b/i);
  });
});

describe("day 13 part 4 | duplicate and concurrent requests (SQL source checks; real proof = day-13-11 on denim)", () => {
  it("one open request per publisher is a unique partial index; retry key is unique", () => {
    assert.match(SQL, /create unique index if not exists publisher_payout_one_open_key[\s\S]*?\(publisher_id\)[\s\S]*?where status in \('requested', 'approved'\)/);
    assert.match(SQL, /unique \(publisher_id, request_key\)/);
  });
  it("the request function locks the publisher row BEFORE reading the balance, and admin functions lock in the same order", () => {
    const f = SQL.match(/create or replace function public\.request_my_payout[\s\S]*?\$\$;/)![0];
    assert.ok(f.indexOf("for no key update of p") > 0 && f.indexOf("for no key update of p") < f.indexOf("publisher_payout_position"));
    for (const name of ["admin_review_payout_request", "admin_mark_payout_paid"]) {
      const a = SQL.match(new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\$\\$;`))![0];
      assert.ok(a.indexOf("for no key update of p") > 0 && a.indexOf("for no key update of p") < a.indexOf("for update;"), name);
    }
  });
  it("same key + same amount is 'duplicate'; same key + other amount is 'conflict'; open request is refused", () => {
    assert.match(SQL, /'outcome', 'duplicate'/);
    assert.match(SQL, /'outcome', 'conflict'/);
    assert.match(SQL, /'outcome', 'open_request_exists'/);
  });
});

describe("day 13 part 4 | ownership", () => {
  it("publisher functions take no publisher id; they use auth.uid()", () => {
    assert.match(SQL, /request_my_payout\(p_amount numeric, p_request_key uuid\)/);
    assert.match(SQL, /get_my_payout_summary\(\)/);
    assert.match(SQL, /get_my_payout_requests\(p_limit integer default 25\)/);
    for (const n of ["request_my_payout", "get_my_payout_summary", "get_my_payout_requests"]) {
      const f = SQL.match(new RegExp(`create or replace function public\\.${n}[\\s\\S]*?\\$\\$;`))![0];
      assert.match(f, /auth\.uid\(\)/, n);
    }
  });
  it("publisher read functions never expose reviewer / actor / publisher ids", () => {
    const f = SQL.match(/create or replace function public\.get_my_payout_requests[\s\S]*?\$\$;/)![0];
    assert.doesNotMatch(f, /reviewed_by|paid_by|requested_by|publisher_id,/);
  });
  it("the publisher action never sends a publisher id, an admin field or a status; amount goes as exact text", async () => {
    payoutFake.reset();
    payoutFake.rpcData = { outcome: "requested", id: ID, status: "requested", amount: "0.0150" };
    const r = await requestPayout(initialRunState, form({ amount: "0.015", requestKey: KEY, publisher_id: ID, status: "paid", role: "admin", reviewed_by: ID }));
    assert.equal(r.status, "success");
    assert.deepEqual(payoutFake.rpcCalls, [{ name: "request_my_payout", args: { p_amount: "0.0150", p_request_key: KEY } }]);
    assert.equal(typeof payoutFake.rpcCalls[0].args.p_amount, "string");
    assert.deepEqual(payoutFake.revalidated, ["/dashboard/publisher/payouts"]);
  });
  it("the publisher form has only amount + requestKey (no bank / card / UPI / publisher fields)", () => {
    const ui = read("components/dashboard/PayoutRequestForm.tsx");
    const names = [...ui.matchAll(/name="([^"]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(names, ["amount", "requestKey"]);
    assert.doesNotMatch(ui.replace(/\/\*[\s\S]*?\*\//g, ""), /\b(bank|card|upi|ifsc|iban|cvv|account[_ ]?number)\b/i);
  });
});

describe("day 13 part 4 | permissions", () => {
  beforeEach(() => { payoutFake.reset(); console.error = () => {}; });

  it("publisher action: requireRole(['publisher']) first; admin / advertiser / logged-out never reach the database", async () => {
    for (const role of ["admin", "advertiser", null] as const) {
      payoutFake.reset(); payoutFake.role = role;
      await assert.rejects(requestPayout(initialRunState, form({ amount: "1", requestKey: KEY })));
      assert.deepEqual(payoutFake.roleCalls, [["publisher"]]);
      assert.equal(payoutFake.rpcCalls.length, 0);
    }
  });
  it("admin action: requireRole(['admin']) first; publisher / advertiser / logged-out never reach the database", async () => {
    for (const role of ["publisher", "advertiser", null] as const) {
      for (const action of ["approve", "reject", "paid"]) {
        payoutFake.reset(); payoutFake.role = role;
        await assert.rejects(adminPayoutAction(initialRunState, form({ id: ID, action, reason: "valid reason" })));
        assert.deepEqual(payoutFake.roleCalls, [["admin"]]);
        assert.equal(payoutFake.rpcCalls.length, 0);
        assert.equal(payoutFake.revalidated.length, 0);
      }
    }
  });
  it("admin action maps each action to the right database function; reject needs a reason; nothing else is trusted", async () => {
    payoutFake.role = "admin";
    payoutFake.rpcData = { outcome: "approved", id: ID, status: "approved" };
    await adminPayoutAction(initialRunState, form({ id: ID, action: "approve", reviewed_by: ID, status: "paid" }));
    payoutFake.rpcData = { outcome: "paid", id: ID, status: "paid" };
    await adminPayoutAction(initialRunState, form({ id: ID, action: "paid" }));
    payoutFake.rpcData = { outcome: "rejected", id: ID, status: "rejected" };
    await adminPayoutAction(initialRunState, form({ id: ID, action: "reject", reason: "  Wrong   period  " }));
    assert.deepEqual(payoutFake.rpcCalls, [
      { name: "admin_review_payout_request", args: { p_request_id: ID, p_decision: "approve", p_reason: null } },
      { name: "admin_mark_payout_paid", args: { p_request_id: ID } },
      { name: "admin_review_payout_request", args: { p_request_id: ID, p_decision: "reject", p_reason: "Wrong period" } },
    ]);
    const before = payoutFake.rpcCalls.length;
    const noReason = await adminPayoutAction(initialRunState, form({ id: ID, action: "reject", reason: "ab" }));
    assert.equal(noReason.status, "error");
    const bad = await adminPayoutAction(initialRunState, form({ id: "not-a-uuid", action: "paid" }));
    const unknown = await adminPayoutAction(initialRunState, form({ id: ID, action: "transfer" }));
    assert.equal(bad.status, "error"); assert.equal(unknown.status, "error");
    assert.equal(payoutFake.rpcCalls.length, before);
  });
  it("a database 42501 (not an admin) or a refused transition is shown as an error, never as success", async () => {
    payoutFake.role = "admin";
    payoutFake.rpcError = { code: "42501" };
    const a = await adminPayoutAction(initialRunState, form({ id: ID, action: "paid" }));
    assert.deepEqual(a, { status: "error", message: "Only an admin can do this." });
    payoutFake.rpcError = null;
    for (const outcome of ["invalid_transition", "not_eligible", "insufficient", "not_found", "forbidden", "invalid"]) {
      payoutFake.rpcData = { outcome };
      const r = await adminPayoutAction(initialRunState, form({ id: ID, action: "paid" }));
      assert.equal(r.status, "error", outcome);
    }
    payoutFake.rpcData = { surprise: true };
    assert.equal((await adminPayoutAction(initialRunState, form({ id: ID, action: "paid" }))).status, "error");
    assert.equal(payoutFake.revalidated.length, 0);
  });
  it("SQL: admin functions check private.is_admin() first and raise 42501; EXECUTE only for authenticated; tables closed to all roles", () => {
    for (const n of ["admin_review_payout_request", "admin_mark_payout_paid"]) {
      const f = SQL.match(new RegExp(`create or replace function public\\.${n}[\\s\\S]*?\\$\\$;`))![0];
      assert.ok(f.indexOf("private.is_admin()") > 0 && f.indexOf("private.is_admin()") < f.indexOf("select r."), n);
      assert.match(f, /errcode = '42501'/);
    }
    assert.match(SQL, /revoke all on function public\.admin_mark_payout_paid\(uuid\) from public, anon, service_role;\s*grant execute on function public\.admin_mark_payout_paid\(uuid\) to authenticated;/);
    assert.match(SQL, /revoke all on table public\.publisher_payout_requests from public, anon, authenticated, service_role;/);
    assert.match(SQL, /alter table public\.publisher_payout_requests enable row level security;/);
    assert.doesNotMatch(SQL, /create policy|grant (select|insert|update|delete)/i);
    assert.doesNotMatch(SQL, /to service_role|to anon/);
  });
  it("the admin page is still admin-only and the panel / actions use the session client, never the service-role key", () => {
    assert.match(read("app/dashboard/admin/page.tsx"), /await requireRole\(\["admin"\]\)/);
    for (const f of ["app/dashboard/admin/payout-actions.ts", "app/dashboard/publisher/payout-actions.ts", "components/admin/PayoutRequestsPanel.tsx", "app/dashboard/publisher/payouts/page.tsx"]) {
      assert.doesNotMatch(read(f), /supabase\/admin|createAdminClient|SERVICE_ROLE/, f);
    }
    assert.match(read("app/dashboard/publisher/payouts/page.tsx"), /requireRole\(\["publisher"\]\)/);
  });
});

describe("day 13 part 4 | audit trail and no real transfer", () => {
  it("every status change writes an events row from a trigger (actor from the row), and events are append-only", () => {
    assert.match(SQL, /create trigger publisher_payout_requests_audit\s+after insert or update on public\.publisher_payout_requests/);
    assert.match(SQL, /case when new\.status = 'paid' then new\.paid_by else new\.reviewed_by end/);
    assert.match(SQL, /create trigger publisher_payout_events_guard\s+before update or delete on public\.publisher_payout_events/);
    assert.match(SQL, /create trigger publisher_payout_events_no_truncate\s+before truncate on public\.publisher_payout_events/);
  });
  it("marking paid records who and when, writes no ledger row and calls no provider", () => {
    const f = SQL.match(/create or replace function public\.admin_mark_payout_paid[\s\S]*?\$\$;/)![0];
    assert.match(f, /set status = 'paid', paid_by = v_uid, paid_at = now\(\)/);
    assert.doesNotMatch(f, /financial_ledger|ledger_append|http|net\./i);
    assert.doesNotMatch(stripComments(SQL), /insert into public\.financial_ledger|ledger_append\(/);
  });
  it("no payment provider, SDK or secret is used by any payout file", () => {
    for (const f of ["lib/payouts/rules.ts", "lib/payouts/data.ts", "app/dashboard/publisher/payout-actions.ts", "app/dashboard/admin/payout-actions.ts", "components/admin/PayoutRequestsPanel.tsx", "components/admin/PayoutActionButton.tsx", "components/dashboard/PayoutRequestForm.tsx", "app/dashboard/publisher/payouts/page.tsx"]) {
      const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      assert.doesNotMatch(code, /razorpay|stripe|paypal|payoneer|wise\b|fetch\(|process\.env/i, f);
    }
  });
  it("payout tables have no bank / card / UPI / account / provider columns", () => {
    const tables = [...stripComments(SQL).matchAll(/create table if not exists public\.(publisher_payout_\w+) \(([\s\S]*?)\n\);/g)];
    assert.equal(tables.length, 2);
    for (const [, name, body] of tables) assert.doesNotMatch(body.replace(/constraint[^\n]*/g, ""), /bank|card|upi|ifsc|iban|swift|cvv|account_no|routing|provider|vpa/i, name);
  });
  it("financial_ledger is not altered by the migration", () => {
    assert.doesNotMatch(stripComments(SQL), /alter table public\.financial_ledger|drop (constraint|trigger)[^;]*financial_ledger/i);
  });
});

describe("day 13 part 4 | database answers are parsed strictly", () => {
  const sum = { currency_code: "USD", eligible: true, ledger_balance: "0.0250", reserved: "0.0100", paid_out: "0.0000", available: "0.0150", has_open_request: true };
  const req = { id: ID, amount: "0.0100", status: "requested", rejection_reason: null, created_at: "2026-10-29T10:00:00+00:00", reviewed_at: null, paid_at: null };
  it("summary must reconcile (available = ledger - reserved - paid) and reserved implies an open request", () => {
    assert.equal(parsePayoutSummaryRow(sum)?.available, 150n);
    assert.equal(parsePayoutSummaryRow({ ...sum, available: "0.0200" }), null);
    assert.equal(parsePayoutSummaryRow({ ...sum, has_open_request: false }), null);
    assert.equal(parsePayoutSummaryRow({ ...sum, ledger_balance: 0.025 }), null);
    assert.equal(parsePayoutSummaryRow({ ...sum, currency_code: "INR" }), null);
    assert.equal(parsePayoutSummaryRow({ ...sum, ledger_balance: "0.0050", reserved: "0.0000", paid_out: "0.0100", available: "0.0000", has_open_request: false })?.available, 0n);
  });
  it("request rows: status must agree with timestamps / reason", () => {
    assert.ok(parsePayoutRequestRow(req));
    assert.equal(parsePayoutRequestRow({ ...req, status: "paid" }), null);
    assert.equal(parsePayoutRequestRow({ ...req, status: "rejected", reviewed_at: "2026-10-29T11:00:00+00:00" }), null);
    assert.equal(parsePayoutRequestRow({ ...req, status: "bogus" }), null);
    assert.equal(parsePayoutRequestRow({ ...req, amount: "0.0000" }), null);
    assert.equal(parsePayoutRequestRow({ ...req, id: "nope" }), null);
  });
  it("fetch helpers: database error or one bad row => error (never a made-up zero); no rows => not_found / empty", async () => {
    const ok = (data: unknown) => ({ rpc: async () => ({ data, error: null }) });
    const err = { rpc: async () => ({ data: null, error: { code: "x" } }) };
    console.error = () => {};
    assert.equal((await fetchMyPayoutSummary(err)).status, "error");
    assert.equal((await fetchMyPayoutSummary(ok([]))).status, "not_found");
    assert.equal((await fetchMyPayoutSummary(ok([sum]))).status, "ok");
    assert.equal((await fetchMyPayoutRequests(ok([req, { ...req, id: "bad" }]))).status, "error");
    const calls: unknown[] = [];
    const spy = { rpc: async (fn: string, args?: Record<string, unknown>) => { calls.push([fn, args]); return { data: [], error: null }; } };
    await fetchMyPayoutRequests(spy, 9999);
    await fetchAdminPayoutRequests(spy, 9999);
    assert.deepEqual(calls, [["get_my_payout_requests", { p_limit: 100 }], ["admin_list_payout_requests", { p_limit: 200 }]]);
  });
  it("outcome parsers reject unknown answers and reason rules match the SQL (3..500)", () => {
    assert.equal(parseRequestOutcome({ outcome: "paid" }), null);
    assert.equal(parseReviewOutcome("approved"), null);
    assert.deepEqual(parseRequestOutcome({ outcome: "insufficient", available: "0.0150" }), { outcome: "insufficient", available: "0.0150" });
    assert.equal(parsePayoutReason("ab").ok, false);
    assert.equal(parsePayoutReason("x".repeat(501)).ok, false);
    assert.deepEqual(parsePayoutReason("  a   b c "), { ok: true, value: "a b c" });
    assert.match(SQL, /length\(v_reason\) not between 3 and 500/);
  });
});
