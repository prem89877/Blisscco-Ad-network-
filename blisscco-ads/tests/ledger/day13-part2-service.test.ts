import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { chargedUnitCostUsd } from "@/lib/ads/category-matching";
import { addMoney, formatMoney, negateMoney, parseMoney, serveChargeUnitsFromCpm } from "@/lib/ledger/decimal";
import { isValidShareBps, splitCharge } from "@/lib/ledger/revenue-share";
import { validateAdjustment, validateReversal } from "@/lib/ledger/validation";
import { addLedgerAdjustment, parseLedgerWrite, reverseLedgerEntry } from "@/lib/ledger/ledger-db";

// Day 13 Part 2: ledger service. Pure paise ka hisab, input validation, server service (nakli supabase client) aur SQL migration ke TEXT checks.
// LIMIT: SQL kisi database par chalayi nahi gayi (sandbox me Postgres nahi). SQL ke asli behaviour ke liye rollback-only file
// supabase/sql/day-13-6-ledger-service-tests.sql (denim par) chalani hogi. Yahan ke SQL checks sirf text hain.

const ROOT = path.join(__dirname, "..", "..", "..");
const SQL_DIR = path.join(ROOT, "supabase", "sql");
const read = (f: string) => readFileSync(path.join(SQL_DIR, f), "utf8");
const code = (t: string) =>
  t
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .toLowerCase();
const noStrings = (t: string) => t.replace(/'(?:[^']|'')*'/g, "''");

const M = "day-13-4-ledger-service.sql";
const VERIFY = "day-13-5-ledger-service-verify.sql";
const TESTS = "day-13-6-ledger-service-tests.sql";
const sql = code(read(M));

const ADMIN = "11111111-1111-4111-8111-111111111111";
const ADV = "22222222-2222-4222-8222-222222222222";
const PUB = "33333333-3333-4333-8333-333333333333";
const CAMP = "44444444-4444-4444-8444-444444444444";
const units = (s: string): bigint => {
  const p = parseMoney(s);
  if (!p.ok) throw new Error(`bad test money ${s}`);
  return p.units;
};

describe("day 13 part 2 | exact decimal arithmetic", () => {
  it("parses plain decimals to exact 4-decimal units", () => {
    assert.equal(units("0"), 0n);
    assert.equal(units("12"), 120_000n);
    assert.equal(units("0.0020"), 20n);
    assert.equal(units("0.002"), 20n);
    assert.equal(units("-0.5"), -5_000n);
    assert.equal(units("9999999999.9999"), 99_999_999_999_999n);
  });

  it("refuses invalid amounts instead of guessing (float text, signs, spaces, commas, NaN, empty)", () => {
    for (const bad of ["", " 1", "1 ", "1e-3", "1E3", "+1", "1,000", "NaN", "Infinity", ".5", "1.", "-", "--1", "0x10", "１２"]) {
      const r = parseMoney(bad);
      assert.equal(r.ok, false, JSON.stringify(bad));
    }
    assert.deepEqual(parseMoney(""), { ok: false, reason: "empty" });
    assert.deepEqual(parseMoney("1e-3"), { ok: false, reason: "format" });
  });

  it("more than 4 decimals is refused, never silently rounded", () => {
    assert.deepEqual(parseMoney("0.00005"), { ok: false, reason: "too_many_decimals" });
    assert.deepEqual(parseMoney("1.23456"), { ok: false, reason: "too_many_decimals" });
    assert.deepEqual(parseMoney("0.00000"), { ok: false, reason: "too_many_decimals" });
  });

  it("amount beyond numeric(14,4) is refused", () => {
    assert.deepEqual(parseMoney("10000000000"), { ok: false, reason: "too_large" });
    assert.deepEqual(parseMoney("-10000000000.0000"), { ok: false, reason: "too_large" });
  });

  it("0.1 + 0.2 is exactly 0.3 (the float trap does not exist here)", () => {
    assert.notEqual(0.1 + 0.2, 0.3); // proof that floats would be wrong
    assert.equal(formatMoney(addMoney(units("0.1"), units("0.2"))), "0.3000");
    let sum = 0n;
    for (let i = 0; i < 1000; i++) sum = addMoney(sum, units("0.0020"));
    assert.equal(formatMoney(sum), "2.0000"); // 1000 serves x 0.0020
  });

  it("formatting is always 4 decimals, round-trips, and never prints negative zero", () => {
    assert.equal(formatMoney(0n), "0.0000");
    assert.equal(formatMoney(negateMoney(0n)), "0.0000");
    assert.equal(formatMoney(20n), "0.0020");
    assert.equal(formatMoney(-5_000n), "-0.5000");
    for (const v of [1n, 9n, 10n, 99n, 100n, 9_999n, 10_000n, 123_456_789n, -1n, -123_456_789n, 99_999_999_999_999n]) {
      const back = parseMoney(formatMoney(v));
      assert.deepEqual(back, { ok: true, units: v });
    }
  });
});

describe("day 13 part 2 | rounding", () => {
  it("serve charge = CPM / 1000, 4 decimals, half-up, never below 0.0001", () => {
    const f = (cpm: string) => formatMoney(serveChargeUnitsFromCpm(units(cpm)));
    assert.equal(f("2"), "0.0020");
    assert.equal(f("2.5555"), "0.0026"); // 0.0025555 -> up
    assert.equal(f("2.5500"), "0.0026"); // exact half (0.00255) -> up
    assert.equal(f("2.5499"), "0.0025"); // 0.0025499 -> down
    assert.equal(f("0.1"), "0.0001");
    assert.equal(f("0.0001"), "0.0001"); // 0.0000001 -> floor of 1 unit
    assert.equal(f("0.4"), "0.0004");
    assert.throws(() => serveChargeUnitsFromCpm(0n), RangeError);
    assert.throws(() => serveChargeUnitsFromCpm(-1n), RangeError);
  });

  it("matches the existing float pre-filter (chargedUnitCostUsd) on the whole cpm_usd range, including exact halves", () => {
    const cpmValues: bigint[] = [];
    for (let c = 1n; c <= 99_999_999n; c += 9_973n) cpmValues.push(c); // spread over numeric(8,4)
    for (let c = 500n; c <= 5_000_000n; c += 1_000n) cpmValues.push(c); // every exact-half case up to 500.0000
    for (const c of cpmValues) {
      const exact = serveChargeUnitsFromCpm(c);
      const cpm = Number(formatMoney(c));
      const viaFloat = Math.round(chargedUnitCostUsd(cpm / 1000) * 10_000);
      assert.equal(exact, BigInt(viaFloat), `cpm ${formatMoney(c)}`);
    }
  });

  it("revenue split: examples (publisher side truncated, platform keeps the remainder)", () => {
    assert.deepEqual(splitCharge(20n, 7000), { publisherUnits: 14n, platformUnits: 6n }); // 0.0020 -> 0.0014 + 0.0006
    assert.deepEqual(splitCharge(26n, 7000), { publisherUnits: 18n, platformUnits: 8n }); // 18.2 -> 18
    assert.deepEqual(splitCharge(1n, 100), { publisherUnits: 0n, platformUnits: 1n }); // too small: platform keeps all
    assert.deepEqual(splitCharge(1n, 9999), { publisherUnits: 0n, platformUnits: 1n });
    assert.deepEqual(splitCharge(7n, 10_000), { publisherUnits: 7n, platformUnits: 0n });
    assert.deepEqual(splitCharge(7n, 0), { publisherUnits: 0n, platformUnits: 7n });
  });

  it("revenue split: publisher + platform ALWAYS equals the charge exactly, for every bps (no money created or lost)", () => {
    for (const charge of [1n, 2n, 3n, 7n, 26n, 99n, 10_001n, 123_456_789n, 99_999_999_999_999n]) {
      for (let bps = 0; bps <= 10_000; bps++) {
        const { publisherUnits: p, platformUnits: q } = splitCharge(charge, bps);
        assert.equal(p + q, charge);
        assert.ok(p >= 0n && q >= 0n);
        assert.ok(p * 10_000n <= charge * BigInt(bps) && charge * BigInt(bps) < (p + 1n) * 10_000n, "truncated, not rounded up");
      }
    }
  });

  it("share bps: only integers 0..10000 are valid; charge must be positive", () => {
    for (const ok of [0, 1, 7000, 10_000]) assert.equal(isValidShareBps(ok), true);
    for (const bad of [-1, 10_001, 70.5, NaN, Infinity, "7000", null, undefined, 7000n]) assert.equal(isValidShareBps(bad), false, String(bad));
    assert.throws(() => splitCharge(20n, -1), RangeError);
    assert.throws(() => splitCharge(20n, 10_001), RangeError);
    assert.throws(() => splitCharge(20n, 70.5), RangeError);
    assert.throws(() => splitCharge(0n, 7000), RangeError);
    assert.throws(() => splitCharge(-5n, 7000), RangeError);
  });
});

describe("day 13 part 2 | input validation (reversal and adjustment)", () => {
  const rev = { actorProfileId: ADMIN, entryId: 5, idempotencyKey: "reverse-5-0001", reason: "  Wrong advertiser  " };

  it("reversal: valid input is accepted and the reason is trimmed", () => {
    const r = validateReversal(rev);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value.reason, "Wrong advertiser");
  });

  it("reversal: bad actor, bad entry id, bad key or bad reason is refused", () => {
    const bad = (patch: Partial<typeof rev>) => validateReversal({ ...rev, ...patch });
    assert.deepEqual(bad({ actorProfileId: "nope" }), { ok: false, field: "actorProfileId", reason: "uuid" });
    for (const id of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) assert.equal(bad({ entryId: id }).ok, false, String(id));
    assert.equal(bad({ entryId: "5" as unknown as number }).ok, false);
    for (const k of ["", "short", "has space 123", "a".repeat(201), "semi;colon-123"]) assert.equal(bad({ idempotencyKey: k }).ok, false, k);
    for (const r of ["", "ab", "   x  ", "x".repeat(501)]) assert.equal(bad({ reason: r }).ok, false, r);
  });

  const adj = { actorProfileId: ADMIN, account: "advertiser" as const, amount: "-0.5", idempotencyKey: "adjust-credit-01", reason: "Goodwill credit", advertiserId: ADV, campaignId: CAMP };

  it("adjustment: amount is normalised to exact 4-decimal text (never a number)", () => {
    const r = validateAdjustment(adj);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.value.amount, "-0.5000");
      assert.equal(typeof r.value.amount, "string");
    }
  });

  it("adjustment: zero, 5 decimals, float text, number-like junk are all invalid", () => {
    const f = (amount: string) => validateAdjustment({ ...adj, amount });
    assert.deepEqual(f("0"), { ok: false, field: "amount", reason: "zero" });
    assert.deepEqual(f("-0.0000"), { ok: false, field: "amount", reason: "zero" });
    assert.deepEqual(f("0.00005"), { ok: false, field: "amount", reason: "too_many_decimals" });
    assert.deepEqual(f("1e3"), { ok: false, field: "amount", reason: "format" });
    assert.deepEqual(f("abc"), { ok: false, field: "amount", reason: "format" });
    assert.deepEqual(f("99999999999"), { ok: false, field: "amount", reason: "too_large" });
    assert.equal(validateAdjustment({ ...adj, amount: 5 as unknown as string }).ok, false); // a JS number is never accepted
  });

  it("adjustment: account decides which party is required (same as the SQL party check)", () => {
    assert.equal(validateAdjustment({ ...adj, advertiserId: null }).ok, false);
    assert.equal(validateAdjustment({ ...adj, account: "publisher", advertiserId: null, publisherId: null }).ok, false);
    assert.equal(validateAdjustment({ ...adj, account: "publisher", advertiserId: null, publisherId: PUB, campaignId: null }).ok, true);
    assert.equal(validateAdjustment({ ...adj, account: "platform", advertiserId: null, campaignId: null }).ok, true);
    assert.equal(validateAdjustment({ ...adj, account: "bank" as unknown as "platform" }).ok, false);
    assert.equal(validateAdjustment({ ...adj, campaignId: "not-a-uuid" }).ok, false);
    assert.equal(validateAdjustment({ ...adj, reason: "" }).ok, false);
    assert.equal(validateAdjustment({ ...adj, idempotencyKey: "short" }).ok, false);
  });
});

type RpcCall = { name: string; args: Record<string, unknown> };
type Reply = { data: unknown; error: { code?: string; message?: string } | null };
function installFake(handler: (name: string, args: Record<string, unknown>) => Reply | Promise<Reply>): RpcCall[] {
  const calls: RpcCall[] = [];
  (globalThis as { __TEST_SUPABASE__?: unknown }).__TEST_SUPABASE__ = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return handler(name, args);
    },
  };
  return calls;
}

describe("day 13 part 2 | server service (nakli supabase client)", () => {
  let logged: unknown[][] = [];
  const realError = console.error;
  beforeEach(() => {
    logged = [];
    console.error = (...a: unknown[]) => void logged.push(a);
  });
  afterEach(() => {
    console.error = realError;
    delete (globalThis as { __TEST_SUPABASE__?: unknown }).__TEST_SUPABASE__;
  });

  const reversal = { actorProfileId: ADMIN, entryId: 9, idempotencyKey: "reverse-9-0001", reason: "Duplicate charge found" };
  const adjustment = { actorProfileId: ADMIN, account: "platform" as const, amount: "0.25", idempotencyKey: "adjust-plat-0001", reason: "Manual correction" };

  it("reversal goes to the admin rpc with exactly the expected arguments", async () => {
    const calls = installFake(() => ({ data: { outcome: "recorded", id: 12, entry_id: "e-1" }, error: null }));
    const out = await reverseLedgerEntry(reversal);
    assert.deepEqual(out, { outcome: "recorded", id: 12, entryId: "e-1" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "ledger_reverse_entry");
    assert.deepEqual(calls[0].args, { p_actor: ADMIN, p_entry_id: 9, p_idempotency_key: "reverse-9-0001", p_reason: "Duplicate charge found" });
  });

  it("adjustment amount reaches the database as exact TEXT, never as a float number", async () => {
    const calls = installFake(() => ({ data: { outcome: "recorded", id: 3, entry_id: "e-3" }, error: null }));
    await addLedgerAdjustment(adjustment);
    assert.equal(calls[0].name, "ledger_add_adjustment");
    assert.equal(calls[0].args.p_amount, "0.2500");
    assert.equal(typeof calls[0].args.p_amount, "string");
    assert.equal(calls[0].args.p_advertiser_id, null);
  });

  it("invalid input never reaches the database", async () => {
    const calls = installFake(() => ({ data: { outcome: "recorded", id: 1, entry_id: "e" }, error: null }));
    assert.deepEqual(await addLedgerAdjustment({ ...adjustment, amount: "0.00005" }), { outcome: "invalid", field: "amount" });
    assert.deepEqual(await addLedgerAdjustment({ ...adjustment, amount: "0" }), { outcome: "invalid", field: "amount" });
    assert.deepEqual(await reverseLedgerEntry({ ...reversal, entryId: 0 }), { outcome: "invalid", field: "entryId" });
    assert.deepEqual(await reverseLedgerEntry({ ...reversal, reason: "x" }), { outcome: "invalid", field: "reason" });
    assert.equal(calls.length, 0);
  });

  it("duplicate request: the same key twice gives one row, the second answer is 'duplicate' with the same id", async () => {
    const rows = new Map<string, { id: number; entryId: string; payload: string }>();
    const calls = installFake((name, args) => {
      assert.equal(name, "ledger_reverse_entry");
      const key = String(args.p_idempotency_key);
      const payload = JSON.stringify(args);
      const seen = rows.get(key);
      if (!seen) {
        const row = { id: rows.size + 100, entryId: `e-${rows.size}`, payload };
        rows.set(key, row);
        return { data: { outcome: "recorded", id: row.id, entry_id: row.entryId }, error: null };
      }
      if (seen.payload !== payload) return { data: { outcome: "conflict" }, error: null };
      return { data: { outcome: "duplicate", id: seen.id, entry_id: seen.entryId }, error: null };
    });
    const a = await reverseLedgerEntry(reversal);
    const b = await reverseLedgerEntry(reversal);
    const c = await reverseLedgerEntry({ ...reversal, reason: "A different reason" }); // same key, different payload
    assert.equal(a.outcome, "recorded");
    assert.equal(b.outcome, "duplicate");
    assert.ok(a.outcome === "recorded" && b.outcome === "duplicate" && a.id === b.id);
    assert.equal(c.outcome, "conflict");
    assert.equal(rows.size, 1);
    assert.equal(calls.length, 3);
  });

  it("database outcomes map one-to-one (forbidden, not_found, conflict, rejected, invalid)", async () => {
    for (const o of ["forbidden", "not_found", "conflict", "rejected", "invalid"] as const) {
      installFake(() => ({ data: { outcome: o }, error: null }));
      assert.deepEqual(await reverseLedgerEntry(reversal), { outcome: o });
    }
  });

  it("a malformed database answer is an error, never 'recorded'", () => {
    for (const bad of [null, undefined, "recorded", 5, [], {}, { outcome: 1 }, { outcome: "weird" }, { outcome: "recorded" }, { outcome: "recorded", id: 0, entry_id: "e" }, { outcome: "recorded", id: 1.5, entry_id: "e" }, { outcome: "recorded", id: 5 }, { outcome: "duplicate", id: 5, entry_id: "" }]) {
      assert.deepEqual(parseLedgerWrite(bad), { outcome: "error" }, JSON.stringify(bad));
    }
    assert.deepEqual(parseLedgerWrite({ outcome: "recorded", id: "42", entry_id: "e" }), { outcome: "recorded", id: 42, entryId: "e" }); // bigint can arrive as text
  });

  it("failed transaction: an rpc error or a crash is 'error' (nothing is assumed written), and logs carry only a code", async () => {
    installFake(() => ({ data: null, error: { code: "40001", message: `secret ${reversal.reason} ${reversal.idempotencyKey}` } }));
    assert.deepEqual(await reverseLedgerEntry(reversal), { outcome: "error" });
    installFake(() => {
      throw new Error(`boom ${adjustment.reason}`);
    });
    assert.deepEqual(await addLedgerAdjustment(adjustment), { outcome: "error" });
    const text = JSON.stringify(logged);
    assert.ok(logged.length >= 2);
    assert.ok(text.includes("40001"));
    for (const secret of [reversal.reason, reversal.idempotencyKey, adjustment.reason, adjustment.amount, ADMIN]) assert.ok(!text.includes(secret), secret);
  });
});

describe("day 13 part 2 | SQL migration (text checks; SQL not executed)", () => {
  const threeArg = (t: string) => {
    const a = t.indexOf("create or replace function public.record_ad_serve(\n  p_key_hash    text,\n  p_creative_id uuid,\n  p_topic       text\n)");
    assert.ok(a >= 0);
    return t.slice(a, t.indexOf("$$;", a) + 3);
  };
  const stripLedgerLines = (t: string) =>
    t
      .split("\n")
      .filter((l) => !/^\s*--\s*Day 13 Part 2/.test(l) && !/^\s*--\s*(Ledger band|Budget yahan)/.test(l) && !/perform private\.ledger_record_serve/.test(l))
      .join("\n")
      .replace(/\n\n\n+/g, "\n\n");

  it("the three Part 2 SQL files exist and sort after the Part 1 files", () => {
    const files = readdirSync(SQL_DIR).filter((f) => /^day-13-/.test(f)).sort();
    assert.deepEqual(files, ["day-13-1-financial-ledger.sql", "day-13-2-ledger-verify.sql", "day-13-3-ledger-tests.sql", M, VERIFY, TESTS].sort());
    const header = read(M);
    assert.match(header, /chalayi NAHI gayi/);
    assert.match(header, /PEHLE TEST project/);
  });

  it("billing is preserved: the 3-arg record_ad_serve is the Day 12 function plus ONLY the ledger call", () => {
    const before = threeArg(read("day-12-5-serve-ref-return.sql"));
    const after = threeArg(read(M));
    assert.equal((after.match(/perform private\.ledger_record_serve\(v_serve_ref, v_campaign_id, v_publisher_id, v_unit\);/g) ?? []).length, 1);
    assert.equal(stripLedgerLines(after).trim(), before.trim());
  });

  it("the ledger call uses v_unit, the very amount added to campaign_spend_daily (one billing basis, no second deduction)", () => {
    const body = threeArg(read(M));
    assert.match(body, /insert into public\.campaign_spend_daily \(campaign_id, day, spent\)\s+values \(v_campaign_id, v_today, v_unit\)/);
    assert.ok(body.indexOf("campaign_spend_daily") < body.indexOf("perform private.ledger_record_serve"), "ledger is written after spend, in the same function");
    assert.equal((body.match(/insert into public\.campaign_spend_daily/g) ?? []).length, 1);
  });

  it("the 4-arg record_ad_serve and replay_serve are NOT redefined (retry cannot reach the ledger writer)", () => {
    const defs = sql.match(/create or replace function public\.record_ad_serve\(/g) ?? [];
    assert.equal(defs.length, 1);
    assert.doesNotMatch(sql, /replay_serve/);
    assert.doesNotMatch(sql, /p_idempotency_key text\)\s*returns jsonb[\s\S]{0,200}record_ad_serve/);
  });

  it("ledger_record_serve never touches spend, budget or serve tables", () => {
    const a = sql.indexOf("create or replace function private.ledger_record_serve(");
    const body = sql.slice(a, sql.indexOf("$$;", sql.indexOf("$$", a) + 2));
    assert.ok(body.length > 200);
    assert.doesNotMatch(body, /campaign_spend_daily|creative_serve_daily|ad_serve_log|ad_serve_requests|ad_platform_settings|\bupdate\b|\bdelete\b/);
    assert.match(body, /v_enabled is not true[\s\S]*?'disabled'/);
    assert.match(body, /ledger_serve_ref_missing/);
  });

  it("revenue rule: configurable, no default, no hardcoded percentage; truncate for publisher, remainder to platform", () => {
    assert.match(sql, /publisher_share_bps integer,/); // no default
    assert.doesNotMatch(sql, /publisher_share_bps\s+integer\s+(not null\s+)?default/);
    assert.match(sql, /ledger_enabled\s+boolean not null default false/);
    assert.match(sql, /publisher_share_bps is null or publisher_share_bps between 0 and 10000/);
    assert.match(sql, /v_pub_amt\s+:=\s+trunc\(\(p_amount \* v_bps\) \/ 10000, 4\)/);
    assert.match(sql, /v_plat_amt :=\s*p_amount - v_pub_amt/);
    assert.match(sql, /if v_pub_amt > 0 then/);
    assert.match(sql, /if v_plat_amt > 0 then/);
    const exec = noStrings(sql);
    assert.doesNotMatch(exec, /v_bps\s*:=\s*\d/);
    assert.doesNotMatch(exec, /\bshare_bps\s*=\s*\d/);
    assert.doesNotMatch(exec, /\b(float|real|double precision|money)\b/);
  });

  it("charge amount is used as given by record_ad_serve; the ledger keys are per serve + type (retry-safe)", () => {
    assert.match(sql, /'serve:' \|\| p_serve_ref \|\| ':advertiser_charge'/);
    assert.match(sql, /'serve:' \|\| p_serve_ref \|\| ':publisher_earning'/);
    assert.match(sql, /'serve:' \|\| p_serve_ref \|\| ':platform_revenue'/);
  });

  it("bug fix: ledger_append refuses null / >4 decimal / out-of-range amounts with a clear code", () => {
    assert.match(sql, /p_amount is null or p_amount <> round\(p_amount, 4\) or abs\(p_amount\) >= 10000000000/);
    assert.match(sql, /hint = 'ledger_invalid_amount'/);
  });

  it("ledger_settings: RLS on, no policy, every app role loses access; migration inserts no ledger rows", () => {
    assert.match(sql, /alter table public\.ledger_settings enable row level security/);
    assert.match(sql, /revoke all on table public\.ledger_settings from public, anon, authenticated, service_role/);
    assert.doesNotMatch(sql, /create policy/);
    const withoutFunctions = sql.replace(/create or replace function[\s\S]*?\$\$;/g, "");
    assert.doesNotMatch(withoutFunctions, /financial_ledger/); // the migration itself inserts no ledger rows (no backfill)
    assert.doesNotMatch(sql, /\bdelete\s+from|\btruncate\b|\bdrop\s+(table|column|schema|policy|index)\b/);
  });

  it("admin wrappers: service_role only, security definer with empty search_path, actor must be an active admin", () => {
    for (const sig of ["public.ledger_reverse_entry(uuid, bigint, text, text)", "public.ledger_add_adjustment(uuid, text, numeric, text, text, uuid, uuid, uuid)"]) {
      assert.ok(sql.includes(`revoke all on function ${sig} from public, anon, authenticated;`), sig);
      assert.ok(sql.includes(`grant execute on function ${sig} to service_role;`), sig);
    }
    assert.doesNotMatch(sql, /grant[^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/);
    assert.match(sql, /p\.role = 'admin' and p\.status = 'active'/);
    const wrappers = sql.slice(sql.indexOf("create or replace function public.ledger_reverse_entry("));
    assert.equal((wrappers.match(/security definer\s+set search_path = ''/g) ?? []).length, 2);
    assert.equal((wrappers.match(/if sqlstate in \('40001', '40p01', '55p03', '57014'\) then\s+raise;/g) ?? []).length, 2); // transient errors are never swallowed
  });

  it("reversal / adjustment never touch campaign budget or spend", () => {
    const wrappers = sql.slice(sql.indexOf("create or replace function public.ledger_reverse_entry("));
    assert.doesNotMatch(wrappers, /campaign_spend_daily|total_budget|daily_budget|creative_serve_daily/);
  });

  it("no existing (non Day 13) SQL file mentions the new ledger service objects", () => {
    for (const f of readdirSync(SQL_DIR).filter((x) => !/^day-13-/.test(x))) {
      assert.doesNotMatch(read(f), /ledger_settings|ledger_record_serve|ledger_reverse_entry|ledger_add_adjustment/, f);
    }
  });

  it("verify file is read-only and the test file is rollback-only and TEST-project-only", () => {
    const v = code(read(VERIFY));
    assert.doesNotMatch(noStrings(v), /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/);
    const t = read(TESTS);
    assert.match(t, /SIRF TEST project \(denim\)/);
    assert.match(t.trim(), /rollback;$/);
    assert.doesNotMatch(code(t), /\bcommit\b/);
    assert.match(t, /begin;/);
    for (const label of ["retry", "rounding", "ledger fail", "invalid amounts", "reversal"]) assert.ok(t.toLowerCase().includes(label), label);
  });
});

describe("day 13 part 2 | server-only boundary", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "node_modules" || e.name.startsWith(".") ? [] : files(path.join(dir, e.name))) : [path.join(dir, e.name)]));

  it("ledger service imports server-only, and no client component or page imports it", () => {
    assert.match(readFileSync(path.join(ROOT, "lib", "ledger", "ledger-db.ts"), "utf8"), /^import "server-only";/);
    for (const f of [...files(path.join(ROOT, "app")), ...files(path.join(ROOT, "components"))].filter((x) => /\.(tsx?|jsx?)$/.test(x))) {
      const t = readFileSync(f, "utf8");
      if (/^["']use client["']/m.test(t)) assert.doesNotMatch(t, /lib\/ledger\/ledger-db/, f);
    }
  });

  it("money modules use no floating point (no parseFloat / toFixed / Math.round / Number())", () => {
    for (const f of ["decimal.ts", "revenue-share.ts", "validation.ts"]) {
      const t = readFileSync(path.join(ROOT, "lib", "ledger", f), "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
      assert.doesNotMatch(t, /parseFloat|toFixed|Math\.(round|floor|ceil|trunc)|\bNumber\(/, f);
    }
  });

  it("no advertiser charge / earning / revenue writer is exposed to TypeScript (only reversal and adjustment)", () => {
    const t = readFileSync(path.join(ROOT, "lib", "ledger", "ledger-db.ts"), "utf8");
    const exported = t.match(/export (?:async )?function (\w+)/g) ?? [];
    assert.deepEqual(exported.map((x) => x.replace(/export (async )?function /, "")).sort(), ["addLedgerAdjustment", "parseLedgerWrite", "reverseLedgerEntry"]);
    assert.doesNotMatch(t, /advertiser_charge|publisher_earning|platform_revenue|ledger_append|ledger_record_serve|campaign_spend_daily/);
  });
});
