import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { formatUsdUnits } from "@/lib/ledger/display";
import {
  UNSUPPORTED_BALANCES,
  earningsAvailability,
  fetchMyEarningsEntries,
  fetchMyEarningsSummary,
  parseEarningsEntryRow,
  parseEarningsSummaryRow,
  type EarningsRpcClient,
  type EarningsSummary,
} from "@/lib/ledger/earnings";

// Day 13 Part 3: publisher earnings view. Data isolation + balance display.
// LIMIT: SQL kisi database par chalayi nahi gayi. Asli isolation DATABASE ke functions me hai (auth.uid()); uska asli saboot sirf rollback-only file
// supabase/sql/day-13-8-publisher-earnings-tests.sql (denim par) chalne par milega. Yahan: (1) TypeScript layer ki shape / honesty checks,
// (2) nakli database jo wahi niyam dohrata hai (caller ka apna publisher, parameter se koi id nahi), (3) SQL aur page ke TEXT checks.

const ROOT = path.join(__dirname, "..", "..", "..");
const SQL_DIR = path.join(ROOT, "supabase", "sql");
const readSql = (f: string) => readFileSync(path.join(SQL_DIR, f), "utf8");
const readSrc = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const codeOnly = (t: string) => t.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").toLowerCase();

const MIGRATION = "day-13-7-publisher-earnings.sql";
const SQL_TESTS = "day-13-8-publisher-earnings-tests.sql";

const UUID_A1 = "11111111-1111-4111-8111-111111111111";
const UUID_A2 = "22222222-2222-4222-8222-222222222222";
const UUID_B1 = "33333333-3333-4333-8333-333333333333";

type LedgerRow = { publisher: "A" | "B"; entryId: string; type: "publisher_earning" | "adjustment" | "reversal" | "advertiser_charge" | "platform_revenue"; amount: string; at: string };
const LEDGER: LedgerRow[] = [
  { publisher: "A", entryId: UUID_A1, type: "publisher_earning", amount: "0.0150", at: "2026-10-27T10:00:00Z" },
  { publisher: "A", entryId: UUID_A2, type: "adjustment", amount: "-0.0050", at: "2026-10-28T10:00:00Z" },
  { publisher: "B", entryId: UUID_B1, type: "publisher_earning", amount: "9.0000", at: "2026-10-28T11:00:00Z" },
];

function toUnits(s: string): bigint {
  const neg = s.startsWith("-");
  const [w, f] = (neg ? s.slice(1) : s).split(".");
  const u = BigInt(w) * 10_000n + BigInt((f ?? "").padEnd(4, "0"));
  return neg ? -u : u;
}
function fromUnits(u: bigint): string {
  const neg = u < 0n;
  const a = neg ? -u : u;
  return `${neg ? "-" : ""}${a / 10_000n}.${(a % 10_000n).toString().padStart(4, "0")}`;
}

/**
 * Nakli database: wahi niyam jo SQL me hai. Caller ki pehchaan CLIENT BANTE WAQT tay hoti hai (login session), rpc ke arguments se kabhi nahi.
 * `calls` me har rpc ka naam + arguments jaate hain, taaki test dekh sake ki koi id bheji hi nahi gayi.
 */
function fakeClient(session: { publisher: "A" | "B" | null; activeProfile?: boolean }) {
  const calls: { fn: string; args: Record<string, unknown> | undefined }[] = [];
  const mine = () => (session.publisher && session.activeProfile !== false ? LEDGER.filter((l) => l.publisher === session.publisher) : []);
  const client: EarningsRpcClient = {
    async rpc(fn, args) {
      calls.push({ fn, args });
      const rows = mine();
      if (fn === "get_my_publisher_earnings") {
        if (!session.publisher || session.activeProfile === false) return { data: [], error: null };
        const sum = (types: string[]) => rows.filter((r) => types.includes(r.type)).reduce((a, r) => a + toUnits(r.amount), 0n);
        return {
          data: [
            {
              ledger_enabled: true,
              share_configured: true,
              currency_code: "USD",
              total_earned: fromUnits(sum(["publisher_earning"])),
              total_adjustments: fromUnits(sum(["adjustment"])),
              total_reversals: fromUnits(sum(["reversal"])),
              ledger_balance: fromUnits(sum(["publisher_earning", "adjustment", "reversal"])),
              entry_count: rows.length,
              last_entry_at: rows.length ? rows.map((r) => r.at).sort().at(-1) : null,
            },
          ],
          error: null,
        };
      }
      if (fn === "get_my_publisher_ledger_entries") {
        const limit = Math.min(Math.max(Number(args?.p_limit ?? 25), 1), 100);
        const data = [...rows]
          .sort((a, b) => (a.at < b.at ? 1 : -1))
          .slice(0, limit)
          .map((r) => ({ entry_id: r.entryId, entry_type: r.type, amount: r.amount, currency_code: "USD", created_at: r.at }));
        return { data, error: null };
      }
      return { data: null, error: { code: "42883" } };
    },
  };
  return { client, calls };
}

const goodRow = {
  ledger_enabled: true,
  share_configured: true,
  currency_code: "USD",
  total_earned: "0.0250",
  total_adjustments: "-0.0050",
  total_reversals: "-0.0100",
  ledger_balance: "0.0100",
  entry_count: 4,
  last_entry_at: "2026-10-28T10:00:00+00:00",
};

describe("day 13 part 3 | money display", () => {
  it("always 4 decimals, thousands separators, currency written, negative sign in front", () => {
    assert.equal(formatUsdUnits(0n), "$0.0000 USD");
    assert.equal(formatUsdUnits(250n), "$0.0250 USD");
    assert.equal(formatUsdUnits(-50n), "-$0.0050 USD");
    assert.equal(formatUsdUnits(12_345_678n), "$1,234.5678 USD");
    assert.equal(formatUsdUnits(1_000_000_000_000n), "$100,000,000.0000 USD");
    assert.equal(formatUsdUnits(1n), "$0.0001 USD");
  });
  it("is exact: sub-cent amounts never round (0.1 + 0.2 style float errors cannot happen)", () => {
    assert.equal(formatUsdUnits(1_000n + 2_000n), "$0.3000 USD");
  });
});

describe("day 13 part 3 | summary parsing is honest", () => {
  it("a consistent row parses to exact BigInt units", () => {
    const s = parseEarningsSummaryRow(goodRow);
    assert.ok(s);
    assert.equal(s.earned, 250n);
    assert.equal(s.adjustments, -50n);
    assert.equal(s.reversals, -100n);
    assert.equal(s.balance, 100n);
    assert.equal(s.entryCount, 4);
  });
  it("bigint count may arrive as a string", () => {
    assert.equal(parseEarningsSummaryRow({ ...goodRow, entry_count: "4" })?.entryCount, 4);
  });
  it("refuses (null => page shows an error, never a wrong number): float amounts, mismatching balance, other currency, bad flags", () => {
    assert.equal(parseEarningsSummaryRow({ ...goodRow, total_earned: 0.025 }), null);
    assert.equal(parseEarningsSummaryRow({ ...goodRow, ledger_balance: "0.0101" }), null);
    assert.equal(parseEarningsSummaryRow({ ...goodRow, currency_code: "EUR" }), null);
    assert.equal(parseEarningsSummaryRow({ ...goodRow, ledger_enabled: "true" }), null);
    assert.equal(parseEarningsSummaryRow({ ...goodRow, total_earned: "1e-3" }), null);
    assert.equal(parseEarningsSummaryRow({ ...goodRow, total_earned: "-0.0250", ledger_balance: "-0.0300" }), null);
    assert.equal(parseEarningsSummaryRow(null), null);
    assert.equal(parseEarningsSummaryRow([goodRow]), null);
  });
  it("zero entries must mean zero amounts and no last-entry date", () => {
    const empty = { ...goodRow, total_earned: "0.0000", total_adjustments: "0.0000", total_reversals: "0.0000", ledger_balance: "0.0000", entry_count: 0, last_entry_at: null };
    assert.ok(parseEarningsSummaryRow(empty));
    assert.equal(parseEarningsSummaryRow({ ...empty, total_earned: "0.0100", ledger_balance: "0.0100" }), null);
    assert.equal(parseEarningsSummaryRow({ ...empty, last_entry_at: "2026-10-28T10:00:00Z" }), null);
    assert.equal(parseEarningsSummaryRow({ ...goodRow, last_entry_at: null }), null);
  });
  it("entry rows: valid types only, never zero, earning never negative, currency USD", () => {
    const ok = { entry_id: UUID_A1, entry_type: "publisher_earning", amount: "0.0150", currency_code: "USD", created_at: "2026-10-27T10:00:00Z" };
    assert.equal(parseEarningsEntryRow(ok)?.amount, 150n);
    assert.equal(parseEarningsEntryRow({ ...ok, entry_type: "adjustment", amount: "-0.0050" })?.amount, -50n);
    assert.equal(parseEarningsEntryRow({ ...ok, entry_type: "advertiser_charge" }), null); // publisher ko advertiser ka charge kabhi nahi
    assert.equal(parseEarningsEntryRow({ ...ok, entry_type: "platform_revenue" }), null);
    assert.equal(parseEarningsEntryRow({ ...ok, amount: "0.0000" }), null);
    assert.equal(parseEarningsEntryRow({ ...ok, amount: "-0.0150" }), null);
    assert.equal(parseEarningsEntryRow({ ...ok, currency_code: "INR" }), null);
    assert.equal(parseEarningsEntryRow({ ...ok, entry_id: "not-a-uuid" }), null);
    assert.equal(parseEarningsEntryRow({ ...ok, amount: 0.015 }), null);
  });
});

describe("day 13 part 3 | what is supported and what is not", () => {
  it("pending / approved / paid are listed as not tracked, and there is no code path that computes them", () => {
    assert.deepEqual(UNSUPPORTED_BALANCES.map((b) => b.key), ["pending", "approved", "paid"]);
    const s = parseEarningsSummaryRow(goodRow);
    assert.ok(s);
    for (const k of ["pending", "approved", "paid"]) assert.equal(k in s, false, k);
  });
  const base = (over: Partial<EarningsSummary>): EarningsSummary => ({
    currency: "USD", ledgerEnabled: true, shareConfigured: true, entryCount: 0, lastEntryAt: null, earned: 0n, adjustments: 0n, reversals: 0n, balance: 0n, ...over,
  });
  it("ledger off and no entries => figures hidden (no invented zero)", () => {
    assert.deepEqual(earningsAvailability(base({ ledgerEnabled: false })), { kind: "not_recording", reason: "ledger_off" });
  });
  it("ledger on but revenue share not set and no entries => figures hidden", () => {
    assert.deepEqual(earningsAvailability(base({ shareConfigured: false })), { kind: "not_recording", reason: "share_not_set" });
  });
  it("ledger on, share set, zero entries => a genuine zero may be shown", () => {
    assert.deepEqual(earningsAvailability(base({})), { kind: "available", recordingNow: true });
  });
  it("existing entries stay visible even if recording is switched off now (with recordingNow = false)", () => {
    assert.deepEqual(earningsAvailability(base({ ledgerEnabled: false, entryCount: 3, earned: 10n, balance: 10n })), { kind: "available", recordingNow: false });
    assert.deepEqual(earningsAvailability(base({ shareConfigured: false, entryCount: 3 })), { kind: "available", recordingNow: false });
  });
});

describe("day 13 part 3 | publisher data isolation (fake database that mirrors the SQL rule)", () => {
  it("publisher A sees only A's records; B's 9.0000 never appears", async () => {
    const { client } = fakeClient({ publisher: "A" });
    const s = await fetchMyEarningsSummary(client);
    assert.equal(s.status, "ok");
    if (s.status !== "ok") return;
    assert.equal(s.data.earned, 150n);
    assert.equal(s.data.adjustments, -50n);
    assert.equal(s.data.balance, 100n);
    assert.equal(s.data.entryCount, 2);
    const e = await fetchMyEarningsEntries(client);
    assert.equal(e.status, "ok");
    if (e.status !== "ok") return;
    assert.deepEqual(e.data.map((x) => x.entryId).sort(), [UUID_A1, UUID_A2]);
    assert.equal(e.data.some((x) => x.entryId === UUID_B1), false);
  });
  it("publisher B sees only B's records", async () => {
    const { client } = fakeClient({ publisher: "B" });
    const s = await fetchMyEarningsSummary(client);
    assert.ok(s.status === "ok" && s.data.earned === 90_000n && s.data.entryCount === 1);
    const e = await fetchMyEarningsEntries(client);
    assert.ok(e.status === "ok" && e.data.length === 1 && e.data[0].entryId === UUID_B1);
  });
  it("no publisher id, profile id or any identity is ever sent: only the function name (+ p_limit for the list)", async () => {
    const { client, calls } = fakeClient({ publisher: "A" });
    await fetchMyEarningsSummary(client);
    await fetchMyEarningsEntries(client, 10);
    assert.deepEqual(calls, [
      { fn: "get_my_publisher_earnings", args: {} },
      { fn: "get_my_publisher_ledger_entries", args: { p_limit: 10 } },
    ]);
  });
  it("user with no publisher (advertiser / admin / no row / inactive profile) => not_found, never zeros or someone else's data", async () => {
    for (const session of [{ publisher: null }, { publisher: "A" as const, activeProfile: false }]) {
      const { client } = fakeClient(session);
      assert.deepEqual(await fetchMyEarningsSummary(client), { status: "not_found" });
      const e = await fetchMyEarningsEntries(client);
      assert.ok(e.status === "ok" && e.data.length === 0);
    }
  });
  it("entries limit is clamped to 1..100 and a non-integer falls back to 25", async () => {
    const { client, calls } = fakeClient({ publisher: "A" });
    await fetchMyEarningsEntries(client, 0);
    await fetchMyEarningsEntries(client, 5000);
    await fetchMyEarningsEntries(client, 2.5);
    assert.deepEqual(calls.map((c) => c.args), [{ p_limit: 1 }, { p_limit: 100 }, { p_limit: 25 }]);
  });
  it("database error => error status (never a zero balance); logs only the function name and code, no amounts or ids", async () => {
    const logged: unknown[][] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void logged.push(a);
    try {
      const failing: EarningsRpcClient = { rpc: async () => ({ data: null, error: { code: "XX000" } }) };
      assert.deepEqual(await fetchMyEarningsSummary(failing), { status: "error" });
      assert.deepEqual(await fetchMyEarningsEntries(failing), { status: "error" });
      const throwing: EarningsRpcClient = { rpc: async () => { throw new Error("boom 0.0150 " + UUID_A1); } };
      assert.deepEqual(await fetchMyEarningsSummary(throwing), { status: "error" });
    } finally {
      console.error = orig;
    }
    const text = JSON.stringify(logged);
    assert.doesNotMatch(text, /0\.0150|1111-4111|boom/);
  });
  it("two summary rows, a broken entry row, or more rows than asked => error (no half answer)", async () => {
    const two: EarningsRpcClient = { rpc: async () => ({ data: [goodRow, goodRow], error: null }) };
    assert.deepEqual(await fetchMyEarningsSummary(two), { status: "error" });
    const bad: EarningsRpcClient = {
      rpc: async () => ({ data: [{ entry_id: UUID_A1, entry_type: "publisher_earning", amount: "0.0150", currency_code: "USD", created_at: "2026-10-27T10:00:00Z" }, { entry_id: "x" }], error: null }),
    };
    assert.deepEqual(await fetchMyEarningsEntries(bad), { status: "error" });
    const many: EarningsRpcClient = {
      rpc: async () => ({ data: Array.from({ length: 3 }, () => ({ entry_id: UUID_A1, entry_type: "publisher_earning", amount: "0.0150", currency_code: "USD", created_at: "2026-10-27T10:00:00Z" })), error: null }),
    };
    assert.deepEqual(await fetchMyEarningsEntries(many, 2), { status: "error" });
  });
});

describe("day 13 part 3 | SQL migration (text checks; real behaviour = day-13-8 on denim)", () => {
  const sql = codeOnly(readSql(MIGRATION));
  it("files exist, sort after Part 2, and say they were not run anywhere", () => {
    const files = readdirSync(SQL_DIR).filter((f) => /^day-13-[7-8]-/.test(f)).sort(); // day-13-9+ Part 4 (payouts) ki files alag test me
    assert.deepEqual(files, [MIGRATION, SQL_TESTS]);
    assert.match(readSql(MIGRATION), /chalayi NAHI gayi/);
    assert.match(readSql(MIGRATION), /PEHLE TEST project/);
  });
  it("exactly two functions, both read-only (stable), security definer, empty search_path", () => {
    assert.equal((sql.match(/create or replace function/g) ?? []).length, 2);
    assert.equal((sql.match(/\bstable\b/g) ?? []).length, 2);
    assert.equal((sql.match(/security definer/g) ?? []).length, 2);
    assert.equal((sql.match(/set search_path = ''/g) ?? []).length, 2);
  });
  it("ownership comes from auth.uid() joined to the caller's own publisher + active profile; no id parameter exists", () => {
    assert.equal((sql.match(/p\.profile_id = \(select auth\.uid\(\)\)/g) ?? []).length, 2);
    assert.equal((sql.match(/pr\.status = 'active'/g) ?? []).length, 2);
    assert.match(sql, /get_my_publisher_earnings\(\)/);
    assert.match(sql, /get_my_publisher_ledger_entries\(p_limit integer default 25\)/);
    assert.doesNotMatch(sql, /p_publisher|p_profile|p_user|p_campaign|p_advertiser/);
  });
  it("only 'authenticated' may execute; PUBLIC / anon / service_role are revoked", () => {
    assert.equal((sql.match(/revoke all on function public\.get_my_publisher_\w+\([a-z]*\) from public, anon, service_role;/g) ?? []).length, 2);
    assert.equal((sql.match(/grant execute on function public\.get_my_publisher_\w+\([a-z]*\) to authenticated;/g) ?? []).length, 2);
    assert.doesNotMatch(sql, /to (anon|public|service_role)\b/);
  });
  it("it only reads: no insert / update / delete / drop / alter / create table / trigger / policy / grant on tables", () => {
    const t = sql.replace(/'(?:[^']|'')*'/g, "''");
    assert.doesNotMatch(t, /\b(insert\s+into|update\s+public|delete\s+from|drop\s+|alter\s+|create\s+table|create\s+trigger|create\s+policy|truncate)\b/);
    assert.doesNotMatch(t, /grant\s+(select|insert|update|delete|all)\b/);
  });
  it("only the caller's publisher account, USD rows are summed; entries output never selects private columns", () => {
    assert.ok((sql.match(/l\.account = 'publisher'/g) ?? []).length >= 2);
    assert.ok((sql.match(/l\.currency_code = 'usd'/g) ?? []).length >= 2);
    const entries = sql.slice(sql.indexOf("get_my_publisher_ledger_entries(p_limit"));
    const selectList = entries.slice(entries.indexOf("select l.entry_id"), entries.indexOf("from public.publishers"));
    assert.doesNotMatch(selectList, /advertiser_id|campaign_id|source_ref|created_by|reason|publisher_id|idempotency_key|reverses_entry_id/);
    assert.match(entries, /limit greatest\(1, least\(coalesce\(p_limit, 25\), 100\)\)/);
  });
  it("money leaves the database as exact text, never float; no pending / approved / paid / payout column invented", () => {
    assert.match(sql, /::numeric\(20, 4\)::text/);
    assert.doesNotMatch(sql, /::(float|double|real)|\bfloat8?\b/);
    // comment-on-function text batata hai ki ye teeno nahi hain; executable SQL (strings ke bina) me inka koi naam nahi.
    assert.doesNotMatch(sql.replace(/'(?:[^']|'')*'/g, "''"), /\b(pending|approved|paid|payout)\w*\b/);
  });
  it("billing is untouched: no mention of record_ad_serve, spend, budget; no existing migration was edited", () => {
    assert.doesNotMatch(sql, /record_ad_serve|campaign_spend_daily|cpm_usd/);
    for (const f of readdirSync(SQL_DIR).filter((x) => !/^day-13-[7-9]-/.test(x) && x !== "day-13-17-publisher-earnings-verify.sql")) { // Day 14 part 2: day-13-7 ka read-only verify
      assert.doesNotMatch(readSql(f), /get_my_publisher_earnings|get_my_publisher_ledger_entries/, f);
    }
  });
  it("the SQL test file is rollback-only and TEST-only", () => {
    const t = readSql(SQL_TESTS);
    assert.match(t, /^begin;$/m);
    assert.match(t, /^rollback;$/m);
    assert.doesNotMatch(codeOnly(t), /^\s*commit;/m);
    assert.match(t, /SIRF TEST project/);
    assert.match(t, /ASLI \(blisscco ad network\) par KABHI NAHI/);
  });
});

describe("day 13 part 3 | page and modules (source checks)", () => {
  const page = readSrc("app/dashboard/publisher/earnings/page.tsx");
  const data = readSrc("lib/ledger/earnings.ts");
  const display = readSrc("lib/ledger/display.ts");
  it("page is publisher-only, server-rendered, and uses the logged-in session (never the service-role client)", () => {
    assert.match(page, /requireRole\(\["publisher"\]\)/);
    assert.doesNotMatch(page, /^\s*["']use client["']/m);
    assert.doesNotMatch(page, /createAdminClient|supabase\/admin|SUPABASE_SECRET/);
    assert.match(page, /createClient\(\)/);
    assert.match(page, /export const dynamic = "force-dynamic"/);
  });
  it("page never sends or reads a publisher id from the URL / form for the earnings queries", () => {
    assert.doesNotMatch(page, /searchParams|params\b|formData|headers\(\)|cookies\(\)/);
    assert.doesNotMatch(data, /publisher_id|publisherId|p_publisher/);
  });
  it("no hardcoded demo balances: no demo-data import, no dollar literal, no money-looking number in the page", () => {
    assert.doesNotMatch(page, /demo-data|demo=\{true\}|Demo data/);
    assert.doesNotMatch(page, /\$\s?\d/);
    assert.doesNotMatch(page, /\b\d+\.\d{2,4}\b/);
  });
  it("unsupported figures are shown as 'Not tracked yet'; the page says the balance is not a payout", () => {
    assert.match(page, /Not tracked yet/);
    assert.match(page, /not a payout/);
    assert.match(page, /UNSUPPORTED_BALANCES/);
  });
  it("amounts all go through the one formatter; currency is named in the page copy", () => {
    assert.ok((page.match(/formatUsdUnits\(/g) ?? []).length >= 5);
    assert.match(page, /US dollars \(USD\)/);
  });
  it("data and display modules have no floating point and do not import the admin client", () => {
    for (const t of [data, display]) {
      const noComments = t.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
      assert.doesNotMatch(noComments, /parseFloat|toFixed|Math\.(round|floor|ceil|trunc)/);
      assert.doesNotMatch(noComments, /supabase\/admin|createAdminClient/);
    }
    assert.doesNotMatch(display.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n"), /\bNumber\(/);
    assert.match(data, /parseMoney\(/);
  });
  it("publisher page links to the earnings page without changing its role check", () => {
    const pub = readSrc("app/dashboard/publisher/page.tsx");
    assert.match(pub, /href="\/dashboard\/publisher\/earnings"/);
    assert.match(pub, /requireRole\(\["publisher"\]\)/);
  });
});
