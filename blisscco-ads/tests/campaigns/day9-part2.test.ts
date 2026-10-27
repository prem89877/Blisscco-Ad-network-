import { fake, type FakeCampaign } from "./action-stubs"; // SABSE PEHLE: nakli modules lagte hain
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseMoneyCents, formatCents } from "@/lib/campaigns/money";
import { checkBudgets, BUDGET_MESSAGES } from "@/lib/campaigns/budget-rules";
import { parseCampaignForm } from "@/lib/campaigns/validation";
import { BELOW_SPEND_MESSAGE, isBelowSpend, remainingBudget } from "@/lib/campaigns/budget";
import { mapDbError } from "@/lib/campaigns/errors";
import { MAX_BUDGET, MIN_DAILY_BUDGET, MIN_TOTAL_BUDGET } from "@/lib/campaigns/constants";
import { updateCampaign, createCampaign } from "@/app/dashboard/advertiser/campaigns/actions";
import type { FormValues } from "@/lib/campaigns/types";

const read = (f: string) => readFileSync(f, "utf8");
const TODAY = new Date().toISOString().slice(0, 10);
const CAMP_ID = "11111111-1111-4111-8111-111111111111";
const UPDATED = "2026-10-20T10:00:00.000Z";

// ---------- 1. paise integer me ----------
describe("day 9 part 2: money parsing (integer cents, no floats)", () => {
  it("parses whole and decimal amounts exactly", () => {
    assert.deepEqual(parseMoneyCents("2500"), { ok: true, cents: 250000 });
    assert.deepEqual(parseMoneyCents("2500.5"), { ok: true, cents: 250050 });
    assert.deepEqual(parseMoneyCents("2,500.50"), { ok: true, cents: 250050 });
    assert.deepEqual(parseMoneyCents("  7  "), { ok: true, cents: 700 });
    assert.deepEqual(parseMoneyCents("00012"), { ok: true, cents: 1200 });
  });
  it("is exact where floats are not (1.15*100, 4.35*100, 0.1+0.2 style amounts)", () => {
    assert.notEqual(1.15 * 100, 115, "sanity: float is wrong here");
    assert.deepEqual(parseMoneyCents("1.15"), { ok: true, cents: 115 });
    assert.deepEqual(parseMoneyCents("4.35"), { ok: true, cents: 435 });
    assert.deepEqual(parseMoneyCents("8.2"), { ok: true, cents: 820 });
    const a = parseMoneyCents("0.10"), b = parseMoneyCents("0.20");
    assert.ok(a.ok && b.ok);
    if (a.ok && b.ok) assert.equal(a.cents + b.cents, 30, "0.10 + 0.20 is exactly 0.30");
  });
  it("rejects bad formats", () => {
    for (const bad of ["abc", "-5", "+5", "5.", ".5", "1e3", "1,00", "2,5,0,0", "$100", "100 USD", "1 000", "10.005", "NaN", "Infinity", "0x10", "١٢٣", "5,00.00"]) {
      const r = parseMoneyCents(bad);
      assert.equal(r.ok, false, JSON.stringify(bad));
    }
    assert.deepEqual(parseMoneyCents(""), { ok: false, reason: "empty" });
    assert.deepEqual(parseMoneyCents("   "), { ok: false, reason: "empty" });
  });
  it("huge numbers are 'too_large', never Infinity or a wrong number", () => {
    assert.deepEqual(parseMoneyCents("9".repeat(400)), { ok: false, reason: "too_large" });
    assert.deepEqual(parseMoneyCents("1" + "0".repeat(15)), { ok: false, reason: "too_large" });
  });
  it("formatCents always shows 2 decimals", () => {
    assert.equal(formatCents(250050), "$2,500.50");
    assert.equal(formatCents(5), "$0.05");
    assert.equal(formatCents(1000000000), "$10,000,000.00");
  });
});

// ---------- 2. budget niyam: valid / invalid / boundary ----------
describe("day 9 part 2: budget rules (valid, invalid, boundary)", () => {
  const ok = (t: string, d = "", ex?: Parameters<typeof checkBudgets>[2]) => checkBudgets(t, d, ex);

  it("valid budgets pass", () => {
    assert.deepEqual(ok("500", "50").errors, {});
    assert.deepEqual(ok("2500.50", "").errors, {});
    assert.equal(ok("2500.50", "").totalCents, 250050);
    assert.equal(ok("500", "").dailyCents, null, "daily is optional");
  });
  it("total must be a positive number", () => {
    assert.equal(ok("").errors.totalBudget, BUDGET_MESSAGES.totalEmpty);
    assert.equal(ok("0").errors.totalBudget, BUDGET_MESSAGES.totalPositive);
    assert.equal(ok("0.00").errors.totalBudget, BUDGET_MESSAGES.totalPositive);
    assert.equal(ok("-1").errors.totalBudget, BUDGET_MESSAGES.totalFormat);
    assert.equal(ok("abc").errors.totalBudget, BUDGET_MESSAGES.totalFormat);
    assert.equal(ok("10.005").errors.totalBudget, BUDGET_MESSAGES.totalFormat, "3 decimals rejected, not rounded");
  });
  it("boundary: minimum total", () => {
    assert.equal(ok(MIN_TOTAL_BUDGET.toFixed(2)).errors.totalBudget, undefined);
    assert.equal(ok("0.99").errors.totalBudget, BUDGET_MESSAGES.totalMin);
    assert.equal(ok("0.01").errors.totalBudget, BUDGET_MESSAGES.totalMin);
  });
  it("boundary: maximum total", () => {
    assert.equal(ok(MAX_BUDGET.toFixed(2)).errors.totalBudget, undefined);
    assert.equal(ok("10000000").errors.totalBudget, undefined);
    assert.equal(ok("10000000.01").errors.totalBudget, BUDGET_MESSAGES.totalMax);
    assert.equal(ok("99999999999").errors.totalBudget, BUDGET_MESSAGES.totalMax);
    assert.equal(ok("9".repeat(400)).errors.totalBudget, BUDGET_MESSAGES.totalMax);
  });
  it("daily must be positive, optional, and not more than total", () => {
    assert.equal(ok("100", "0").errors.dailyBudget, BUDGET_MESSAGES.dailyPositive);
    assert.equal(ok("100", "0.00").errors.dailyBudget, BUDGET_MESSAGES.dailyPositive);
    assert.equal(ok("100", "-5").errors.dailyBudget, BUDGET_MESSAGES.dailyFormat);
    assert.equal(ok("100", "abc").errors.dailyBudget, BUDGET_MESSAGES.dailyFormat);
    assert.equal(ok("100", "1.234").errors.dailyBudget, BUDGET_MESSAGES.dailyFormat);
    assert.equal(ok("100", "100.01").errors.dailyBudget, BUDGET_MESSAGES.dailyAboveTotal);
  });
  it("boundary: daily equal to total is allowed, one cent more is not", () => {
    assert.equal(ok("100", "100").errors.dailyBudget, undefined);
    assert.equal(ok("100.00", "100.00").errors.dailyBudget, undefined);
    assert.equal(ok("33.33", "33.33").errors.dailyBudget, undefined);
    assert.equal(ok("33.33", "33.34").errors.dailyBudget, BUDGET_MESSAGES.dailyAboveTotal);
    assert.equal(ok("0.30", "0.30", { totalBudget: 0.3, dailyBudget: 0.3 }).errors.dailyBudget, undefined);
  });
  it("boundary: minimum daily", () => {
    assert.equal(ok("100", MIN_DAILY_BUDGET.toFixed(2)).errors.dailyBudget, undefined);
    assert.equal(ok("100", "0.49").errors.dailyBudget, BUDGET_MESSAGES.dailyMin);
    assert.equal(ok("100", "0.01").errors.dailyBudget, BUDGET_MESSAGES.dailyMin);
  });
  it("daily larger than the maximum is reported even if total is broken", () => {
    assert.equal(ok("", "20000000").errors.dailyBudget, BUDGET_MESSAGES.dailyMax);
  });
  it("old campaigns: an unchanged value below today's minimum is not blocked (rename keeps working)", () => {
    const legacy = { totalBudget: 0.5, dailyBudget: 0.25 };
    assert.deepEqual(ok("0.50", "0.25", legacy).errors, {});
    assert.equal(ok("0.40", "0.25", legacy).errors.totalBudget, BUDGET_MESSAGES.totalMin, "a CHANGED value must meet the minimum");
    assert.equal(ok("0.50", "0.20", legacy).errors.dailyBudget, BUDGET_MESSAGES.dailyMin);
  });
  it("messages are clear, include the real numbers and use USD", () => {
    assert.match(BUDGET_MESSAGES.totalMax, /\$10,000,000\.00/);
    assert.match(BUDGET_MESSAGES.totalMin, /\$1\.00/);
    assert.match(BUDGET_MESSAGES.dailyMin, /\$0\.50/);
    assert.match(BUDGET_MESSAGES.dailyAboveTotal, /cannot be more than the total/);
  });
});

describe("day 9 part 2: full form parse sends exact decimals to the database", () => {
  const good: FormValues = { name: "Diwali sale", description: "", category: "lifestyle", totalBudget: "1.15", dailyBudget: "", startDate: TODAY, endDate: "" };
  it("1.15 stays 1.15 in the JSON that goes to the database", () => {
    const r = parseCampaignForm(good, { todayUtc: TODAY });
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(JSON.stringify({ t: r.value.totalBudget }), '{"t":1.15}');
      assert.equal(r.value.dailyBudget, null);
    }
  });
  it("errors for both fields are returned together", () => {
    const r = parseCampaignForm({ ...good, totalBudget: "0", dailyBudget: "-1" }, { todayUtc: TODAY });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(r.errors.totalBudget);
      assert.ok(r.errors.dailyBudget);
    }
  });
});

// ---------- 3. kharch ke neeche budget ----------
describe("day 9 part 2: total budget vs money already spent", () => {
  it("boundary: equal to spend is allowed, one micro-dollar less is not", () => {
    assert.equal(isBelowSpend(5, 5), false);
    assert.equal(isBelowSpend(4.99, 5), true);
    assert.equal(isBelowSpend(5.01, 5), false);
    assert.equal(isBelowSpend(10, 9.9999), false);
    assert.equal(isBelowSpend(9.99, 9.9999), true);
  });
  it("bad numbers fail closed (edit blocked, never silently allowed)", () => {
    assert.equal(isBelowSpend(Number.NaN, 5), true);
    assert.equal(isBelowSpend(100, Number.NaN), true);
    assert.equal(isBelowSpend(Number.POSITIVE_INFINITY, 5), true);
  });
  it("remaining budget is exact and never negative", () => {
    assert.equal(remainingBudget(10, 9.9999), 0.0001);
    assert.equal(remainingBudget(5, 7), 0);
    assert.equal(remainingBudget(0.3, 0.1), 0.2);
  });
});

// ---------- 4. database error mapping ----------
describe("day 9 part 2: database errors become clear messages (no raw text)", () => {
  it("trigger hint -> budget message", () => {
    assert.match(mapDbError({ code: "23514", hint: "budget_below_spend" }), /already spent/);
  });
  it("CHECK failure -> fixed generic message; the source never reads raw error text", () => {
    assert.match(mapDbError({ code: "23514" }), /not allowed/);
    assert.match(mapDbError({ code: "42501" }), /not allowed/);
    assert.ok(!/error\??\.message|error\??\.details/.test(read("lib/campaigns/errors.ts")));
  });
});

// ---------- 5. server action: asli flow, nakli database ----------
function campaign(over: Partial<FakeCampaign> = {}): FakeCampaign {
  return {
    id: CAMP_ID, advertiserId: "adv-A", name: "Diwali sale", description: null, category: "lifestyle", status: "draft",
    totalBudget: 500, dailyBudget: 50, startDate: TODAY, endDate: null, createdAt: UPDATED, updatedAt: UPDATED, ...over,
  };
}
function form(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    campaignId: CAMP_ID, expectedUpdatedAt: UPDATED, name: "Diwali sale", description: "", category: "lifestyle",
    totalBudget: "500", dailyBudget: "50", startDate: TODAY, endDate: "",
  };
  for (const [k, v] of Object.entries({ ...base, ...over })) fd.set(k, v);
  return fd;
}
async function run(fd: FormData): Promise<{ redirect?: string; state?: Awaited<ReturnType<typeof updateCampaign>> }> {
  try {
    return { state: await updateCampaign({ status: "idle" }, fd) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.startsWith("REDIRECT:")) return { redirect: msg.slice("REDIRECT:".length) };
    throw e;
  }
}
const updates = () => fake.calls.filter((c) => c.table === "campaigns" && c.op === "update");

describe("day 9 part 2: updateCampaign budget flow (owner)", () => {
  beforeEach(() => {
    fake.reset();
    fake.campaigns = [campaign()];
  });

  it("VALID: owner changes budgets -> saved, exact numbers, filtered by own advertiser", async () => {
    const r = await run(form({ totalBudget: "1,250.50", dailyBudget: "100.25" }));
    assert.match(r.redirect ?? "", /updated=1/);
    assert.equal(updates().length, 1);
    const u = updates()[0];
    assert.equal(u.payload.total_budget, 1250.5);
    assert.equal(u.payload.daily_budget, 100.25);
    assert.ok(u.filters.some(([c, v]) => c === "advertiser_id" && v === "adv-A"));
    assert.ok(u.filters.some(([c, v]) => c === "id" && v === CAMP_ID));
  });
  it("VALID: daily budget can be cleared", async () => {
    const r = await run(form({ dailyBudget: "" }));
    assert.match(r.redirect ?? "", /updated=1/);
    assert.equal(updates()[0].payload.daily_budget, null);
  });
  it("INVALID: zero, negative, text, 3 decimals, too big, daily above total -> field error, database never called", async () => {
    const cases: [Record<string, string>, "totalBudget" | "dailyBudget"][] = [
      [{ totalBudget: "0" }, "totalBudget"],
      [{ totalBudget: "-10" }, "totalBudget"],
      [{ totalBudget: "abc" }, "totalBudget"],
      [{ totalBudget: "" }, "totalBudget"],
      [{ totalBudget: "10.005" }, "totalBudget"],
      [{ totalBudget: "10000000.01" }, "totalBudget"],
      [{ totalBudget: "1e5" }, "totalBudget"],
      [{ totalBudget: "100", dailyBudget: "100.01" }, "dailyBudget"],
      [{ dailyBudget: "0" }, "dailyBudget"],
      [{ dailyBudget: "-1" }, "dailyBudget"],
      [{ totalBudget: "100", dailyBudget: "abc" }, "dailyBudget"],
    ];
    for (const [over, field] of cases) {
      const r = await run(form(over));
      assert.equal(r.redirect, undefined, JSON.stringify(over));
      assert.equal(r.state?.status, "error", JSON.stringify(over));
      assert.ok(r.state?.fieldErrors?.[field], `${JSON.stringify(over)} -> ${field}`);
      assert.deepEqual(r.state?.values?.totalBudget, over.totalBudget ?? "500", "user's text is kept");
    }
    assert.equal(updates().length, 0, "no invalid value ever reached the database");
  });
  it("BOUNDARY: total exactly 10,000,000.00 with daily equal to total is saved", async () => {
    const r = await run(form({ totalBudget: "10000000.00", dailyBudget: "10000000.00" }));
    assert.match(r.redirect ?? "", /updated=1/);
    assert.equal(updates()[0].payload.total_budget, 10000000);
  });
  it("BOUNDARY: total below the money already spent is blocked, equal to spend is allowed", async () => {
    fake.campaigns = [campaign({ status: "active", totalBudget: 100, dailyBudget: null })];
    fake.spend = { spentTotal: 5, spentToday: 1, servesTotal: 10 };
    const low = await run(form({ totalBudget: "4.99", dailyBudget: "" }));
    assert.equal(low.state?.fieldErrors?.totalBudget, BELOW_SPEND_MESSAGE("$5.0000"));
    assert.equal(updates().length, 0);
    const equal = await run(form({ totalBudget: "5", dailyBudget: "" }));
    assert.match(equal.redirect ?? "", /updated=1/);
  });
  it("active campaign whose spend cannot be read: budget change is refused (fail closed)", async () => {
    fake.campaigns = [campaign({ status: "active" })];
    fake.spend = null;
    const r = await run(form({ totalBudget: "300", dailyBudget: "30" }));
    assert.equal(r.state?.status, "error");
    assert.match(r.state?.message ?? "", /could not check/i);
    assert.equal(updates().length, 0);
  });
  it("RACE: a serve lands between our check and the save -> database trigger error is shown on the budget field", async () => {
    fake.dbError = { code: "23514", hint: "budget_below_spend" };
    const r = await run(form({ totalBudget: "300", dailyBudget: "30" }));
    assert.equal(r.state?.status, "error");
    assert.match(r.state?.fieldErrors?.totalBudget ?? "", /already spent/);
  });
  it("database CHECK failure shows a fixed, clear message (no raw database text)", async () => {
    fake.dbError = { code: "23514" };
    const r = await run(form({ totalBudget: "300", dailyBudget: "30" }));
    assert.match(r.state?.message ?? "", /not allowed/);
  });
  it("stale form (campaign changed elsewhere) is refused", async () => {
    const r = await run(form({ expectedUpdatedAt: "2020-01-01T00:00:00.000Z", totalBudget: "900" }));
    assert.equal(r.state?.status, "error");
    assert.equal(updates().length, 0);
  });
});

describe("day 9 part 2: unauthorized budget updates", () => {
  beforeEach(() => {
    fake.reset();
    fake.campaigns = [campaign({ advertiserId: "adv-A" })];
  });

  it("another advertiser (B) cannot change A's budget: 'not found', nothing written", async () => {
    fake.me = { id: "adv-B", status: "active" };
    const r = await run(form({ totalBudget: "99999", dailyBudget: "9999" }));
    assert.equal(r.state?.status, "error");
    assert.equal(r.state?.message, "Campaign not found.");
    assert.equal(updates().length, 0);
  });
  it("forged advertiser fields in the form are ignored: the caller's own advertiser decides", async () => {
    fake.me = { id: "adv-B", status: "active" };
    const fd = form({ totalBudget: "99999" });
    fd.set("advertiserId", "adv-A");
    fd.set("advertiser_id", "adv-A");
    const r = await run(fd);
    assert.equal(r.state?.message, "Campaign not found.");
    assert.equal(updates().length, 0);
  });
  it("the update never carries advertiser_id/status/currency, and is always filtered by the logged-in advertiser", async () => {
    const fd = form({ totalBudget: "700" });
    fd.set("advertiser_id", "adv-B");
    fd.set("status", "active");
    fd.set("currency_code", "INR");
    await run(fd);
    const u = updates()[0];
    assert.ok(u, "owner update happened");
    for (const k of ["advertiser_id", "status", "currency_code", "id"]) assert.equal(k in u.payload, false, k);
    assert.ok(u.filters.some(([c, v]) => c === "advertiser_id" && v === "adv-A"));
  });
  it("suspended or pending advertiser cannot change budgets", async () => {
    for (const status of ["suspended", "pending"]) {
      fake.me = { id: "adv-A", status };
      const r = await run(form({ totalBudget: "700" }));
      assert.equal(r.state?.status, "error", status);
    }
    assert.equal(updates().length, 0);
  });
  it("missing advertiser account cannot change budgets", async () => {
    fake.me = null;
    const r = await run(form({ totalBudget: "700" }));
    assert.equal(r.state?.status, "error");
    assert.equal(updates().length, 0);
  });
  it("not logged in / wrong role: stops before anything else (redirect to login)", async () => {
    fake.roleFails = true;
    const r = await run(form({ totalBudget: "700" }));
    assert.equal(r.redirect, "/login");
    assert.equal(updates().length, 0);
  });
  it("locked campaign (pending review) cannot get a new budget", async () => {
    fake.campaigns = [campaign({ status: "pending_review" })];
    const r = await run(form({ totalBudget: "700" }));
    assert.match(r.state?.message ?? "", /locked/);
    assert.equal(updates().length, 0);
  });
  it("a malformed campaign id is refused", async () => {
    const r = await run(form({ campaignId: "not-a-uuid", totalBudget: "700" }));
    assert.equal(r.state?.message, "Campaign not found.");
    assert.equal(updates().length, 0);
  });
});

describe("day 9 part 2: createCampaign budget flow", () => {
  beforeEach(() => fake.reset());
  async function create(over: Record<string, string>) {
    const fd = form(over);
    fd.delete("campaignId");
    fd.delete("expectedUpdatedAt");
    try {
      return { state: await createCampaign({ status: "idle" }, fd) } as { state?: Awaited<ReturnType<typeof createCampaign>>; redirect?: string };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.startsWith("REDIRECT:")) return { redirect: msg.slice(9) };
      throw e;
    }
  }
  it("valid budget creates the campaign for the logged-in advertiser only", async () => {
    const r = await create({ totalBudget: "250.75", dailyBudget: "25" });
    assert.match(r.redirect ?? "", /created=1/);
    const ins = fake.calls.find((c) => c.op === "insert");
    assert.equal(ins?.payload.advertiser_id, "adv-A");
    assert.equal(ins?.payload.total_budget, 250.75);
  });
  it("a forged advertiser id in the form cannot create a campaign for someone else", async () => {
    const fd = form({ totalBudget: "250" });
    fd.delete("campaignId");
    fd.set("advertiser_id", "adv-B");
    fd.set("advertiserId", "adv-B");
    try {
      await createCampaign({ status: "idle" }, fd);
    } catch {
      /* redirect */
    }
    assert.equal(fake.calls.find((c) => c.op === "insert")?.payload.advertiser_id, "adv-A");
  });
  it("invalid budget is stopped before the database", async () => {
    for (const over of [{ totalBudget: "0" }, { totalBudget: "50", dailyBudget: "60" }, { totalBudget: "20000000" }]) {
      const r = await create(over);
      assert.equal(r.state?.status, "error", JSON.stringify(over));
    }
    assert.equal(fake.calls.length, 0);
  });
});

// ---------- 6. frontend/server ek jaise, SQL surakshit ----------
describe("day 9 part 2: frontend and server share one rule set; SQL is safe", () => {
  it("form uses the same checkBudgets as the server and blocks submit on bad budgets", () => {
    const f = read("components/campaigns/CampaignForm.tsx");
    assert.match(f, /from "@\/lib\/campaigns\/budget-rules"/);
    assert.match(f, /checkBudgets\(/);
    assert.match(f, /e\.preventDefault\(\)/);
    assert.match(f, /onBlur=/);
    const v = read("lib/campaigns/validation.ts");
    assert.match(v, /checkBudgets\(/);
    assert.ok(!/parseFloat|Number\(s\)/.test(v), "server no longer parses money with floats");
  });
  it("budget limits come from ONE place (constants.ts)", () => {
    const rules = read("lib/campaigns/budget-rules.ts");
    assert.match(rules, /from "\.\/constants"/);
    assert.ok(!/10_?000_?000/.test(rules), "no second copy of the max number");
  });
  it("migration: max CHECK + spend trigger, no RLS disabling, nothing destructive", () => {
    const sql = read("supabase/sql/day-9-3-budget-rules.sql");
    assert.match(sql, /campaigns_total_budget_max_check/);
    assert.match(sql, /total_budget <= 10000000/);
    assert.match(sql, /create trigger campaigns_guard_budget/);
    assert.match(sql, /before update of total_budget/);
    assert.match(sql, /security definer/);
    assert.match(sql, /set search_path = ''/);
    assert.match(sql, /for update/, "locks the campaign row like record_ad_serve does");
    assert.match(sql, /hint = 'budget_below_spend'/);
    const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    assert.ok(!/disable row level security|drop table|drop column|truncate|delete from|alter table [^;]*drop (?!constraint)/i.test(code));
    assert.ok(!/update public\.campaigns/i.test(code), "migration never rewrites campaign data");
    assert.match(sql, /begin;/);
    assert.match(sql, /commit;/);
  });
  it("the max number in SQL equals MAX_BUDGET in the app", () => {
    assert.equal(MAX_BUDGET, 10_000_000);
  });
  it("SQL test file is rollback-only", () => {
    const t = read("supabase/sql/day-9-4-budget-tests.sql");
    assert.match(t, /raise exception 'DAY9_BUDGET_RESULTS/);
    assert.ok(!/\bcommit\b/i.test(t.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")));
  });
});
