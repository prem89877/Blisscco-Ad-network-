import { fake, type FakeCampaign } from "./action-stubs"; // SABSE PEHLE: nakli modules lagte hain
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { checkBudgets, BUDGET_MESSAGES } from "@/lib/campaigns/budget-rules";
import { addDays, isRealDate, minStartDateForNew, parseCampaignForm, utcToday } from "@/lib/campaigns/validation";
import { MAX_CAMPAIGN_DAYS, START_MAX_DAYS_AHEAD } from "@/lib/campaigns/constants";
import { checkResume } from "@/lib/campaigns/run-state";
import { deliveryState } from "@/lib/campaigns/delivery";
import { createCampaign, pauseCampaign, resumeCampaign, updateCampaign } from "@/app/dashboard/advertiser/campaigns/actions";
import type { FormValues } from "@/lib/campaigns/types";

// Day 9 Part 5: campaign create/edit edge cases. Nakli database (action-stubs), asli database kabhi nahi chhuta.
// Naye tests sirf jodte hain: purane tests (day9-part1/2/4) jaise ke taise hain.

const FIXED_TODAY = "2026-10-27";
const TODAY = utcToday();
const CAMP_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_CAMP_ID = "22222222-2222-4222-8222-222222222222";
const UPDATED = "2026-10-20T10:00:00.000Z";

function values(over: Partial<FormValues> = {}): FormValues {
  return {
    name: "Winter launch",
    description: "",
    category: "gaming",
    totalBudget: "500",
    dailyBudget: "50",
    startDate: FIXED_TODAY,
    endDate: "",
    ...over,
  };
}

function parse(over: Partial<FormValues> = {}, existing?: Parameters<typeof parseCampaignForm>[1]["existing"]) {
  return parseCampaignForm(values(over), { todayUtc: FIXED_TODAY, existing });
}

function errorsOf(over: Partial<FormValues>, existing?: Parameters<typeof parseCampaignForm>[1]["existing"]) {
  const r = parse(over, existing);
  assert.equal(r.ok, false, `expected rejection for ${JSON.stringify(over)}`);
  return r.ok ? {} : r.errors;
}

// ---------------------------------------------------------------------------
// 1. Zero / invalid budgets (pure rules)
// ---------------------------------------------------------------------------
describe("day 9 part 5: zero and invalid budgets", () => {
  it("every spelling of zero is rejected as 'more than 0' for total", () => {
    for (const v of ["0", "0.0", "0.00", "00", "000.00"]) {
      assert.equal(checkBudgets(v, "").errors.totalBudget, BUDGET_MESSAGES.totalPositive, v);
      assert.equal(checkBudgets(v, "").totalCents, null, v);
    }
  });

  it("every spelling of zero is rejected for daily, and nothing valid is returned for it", () => {
    for (const v of ["0", "0.0", "0.00", "000"]) {
      const r = checkBudgets("100", v);
      assert.equal(r.errors.dailyBudget, BUDGET_MESSAGES.dailyPositive, v);
      assert.equal(r.dailyCents, null, v);
    }
  });

  it("empty and whitespace-only total is 'empty', not 'zero'", () => {
    for (const v of ["", "   ", "\t", "\n"]) {
      assert.equal(checkBudgets(v, "").errors.totalBudget, BUDGET_MESSAGES.totalEmpty, JSON.stringify(v));
    }
  });

  it("whitespace-only daily budget means 'no daily limit', not an error", () => {
    const r = checkBudgets("100", "   ");
    assert.deepEqual(r.errors, {});
    assert.equal(r.dailyCents, null);
  });

  it("negative, signed, symbol, exponent, hex, trailing dot and 3-decimal values never become a budget", () => {
    for (const v of ["-1", "-0", "+5", "$5", "5$", "1e3", "1E3", "0x10", "5.", ".5", "5.005", "1 000", "5,00", "NaN", "Infinity", "−5"]) {
      const r = checkBudgets(v, "");
      assert.ok(r.errors.totalBudget, `total ${JSON.stringify(v)} must be rejected`);
      assert.equal(r.totalCents, null, v);
    }
  });

  it("invalid total does not also produce a misleading daily-above-total error", () => {
    const r = checkBudgets("abc", "999");
    assert.ok(r.errors.totalBudget);
    assert.equal(r.errors.dailyBudget, undefined);
  });

  it("a budget error never returns half-valid cents", () => {
    const r = checkBudgets("100", "0");
    assert.equal(r.totalCents, 100_00);
    assert.equal(r.dailyCents, null);
    assert.ok(r.errors.dailyBudget);
  });
});

// ---------------------------------------------------------------------------
// 2. Daily budget vs total budget
// ---------------------------------------------------------------------------
describe("day 9 part 5: daily budget exceeding total budget", () => {
  it("one cent above total is rejected, equal is accepted, one cent below is accepted", () => {
    assert.equal(checkBudgets("100.00", "100.01").errors.dailyBudget, BUDGET_MESSAGES.dailyAboveTotal);
    assert.deepEqual(checkBudgets("100.00", "100.00").errors, {});
    assert.deepEqual(checkBudgets("100.00", "99.99").errors, {});
  });

  it("comparison is in exact cents (no float drift) for awkward amounts", () => {
    assert.deepEqual(checkBudgets("1.15", "1.15").errors, {});
    assert.equal(checkBudgets("1.15", "1.16").errors.dailyBudget, BUDGET_MESSAGES.dailyAboveTotal);
    assert.deepEqual(checkBudgets("4.35", "4.35").errors, {});
    assert.deepEqual(checkBudgets("1.30", "1.30").errors, {});
    assert.equal(checkBudgets("1.30", "1.31").errors.dailyBudget, BUDGET_MESSAGES.dailyAboveTotal);
  });

  it("full form: daily above total is a daily field error, total field stays clean, nothing is returned as valid", () => {
    const errors = errorsOf({ totalBudget: "50", dailyBudget: "50.01" });
    assert.equal(errors.dailyBudget, BUDGET_MESSAGES.dailyAboveTotal);
    assert.equal(errors.totalBudget, undefined);
  });

  it("edit: lowering total below the OLD daily budget is rejected (daily is re-checked against the new total)", () => {
    const errors = errorsOf({ totalBudget: "20", dailyBudget: "50" }, { startDate: FIXED_TODAY, category: "gaming", categoryLocked: false, totalBudget: 500, dailyBudget: 50 });
    assert.equal(errors.dailyBudget, BUDGET_MESSAGES.dailyAboveTotal);
  });

  it("edit: old campaign whose saved daily is below today's minimum can be saved unchanged, but a new tiny value cannot", () => {
    const existing = { startDate: FIXED_TODAY, category: "gaming", categoryLocked: false, totalBudget: 500, dailyBudget: 0.25 };
    assert.equal(parse({ dailyBudget: "0.25" }, existing).ok, true);
    assert.equal(errorsOf({ dailyBudget: "0.30" }, existing).dailyBudget, BUDGET_MESSAGES.dailyMin);
  });
});

// ---------------------------------------------------------------------------
// 3. Schedules
// ---------------------------------------------------------------------------
describe("day 9 part 5: schedule edge cases (UTC dates)", () => {
  it("isRealDate: leap years, month ends and malformed text", () => {
    for (const d of ["2028-02-29", "2000-02-29", "2026-12-31", "2026-01-01", "2026-04-30"]) assert.equal(isRealDate(d), true, d);
    for (const d of ["2026-02-29", "2100-02-29", "2026-04-31", "2026-13-01", "2026-00-10", "2026-10-00", "2026-1-1", "26-10-27", "2026/10/27", "2026-10-27T00:00", " 2026-10-27", "", "abcd-ef-gh"]) {
      assert.equal(isRealDate(d), false, JSON.stringify(d));
    }
  });

  it("addDays crosses month, year and leap-day boundaries correctly", () => {
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addDays("2028-02-28", 1), "2028-02-29");
    assert.equal(addDays("2027-02-28", 1), "2027-03-01");
    assert.equal(addDays("2026-01-01", -1), "2025-12-31");
    assert.equal(addDays("2026-10-27", 0), "2026-10-27");
  });

  it("utcToday uses UTC even when the local clock is on another date", () => {
    assert.equal(utcToday(new Date("2026-10-27T23:59:59.999Z")), "2026-10-27");
    assert.equal(utcToday(new Date("2026-10-28T00:00:00.000Z")), "2026-10-28");
    assert.equal(utcToday(new Date("2026-10-27T00:00:00.000Z")), "2026-10-27");
  });

  it("start date: today and yesterday (timezone grace) are allowed; two days ago is not", () => {
    assert.equal(parse({ startDate: FIXED_TODAY }).ok, true);
    assert.equal(parse({ startDate: minStartDateForNew(FIXED_TODAY) }).ok, true);
    assert.equal(errorsOf({ startDate: addDays(FIXED_TODAY, -2) }).startDate, "Start date cannot be in the past.");
  });

  it("start date: exactly 365 days ahead is allowed, 366 is not", () => {
    assert.equal(parse({ startDate: addDays(FIXED_TODAY, START_MAX_DAYS_AHEAD) }).ok, true);
    assert.match(errorsOf({ startDate: addDays(FIXED_TODAY, START_MAX_DAYS_AHEAD + 1) }).startDate ?? "", /at most 365 days/);
  });

  it("start date: empty, fake and impossible dates are rejected with the right message", () => {
    assert.equal(errorsOf({ startDate: "" }).startDate, "Choose a start date.");
    assert.equal(errorsOf({ startDate: "   " }).startDate, "Choose a start date.");
    for (const d of ["2026-02-30", "2026-13-01", "tomorrow", "27/10/2026"]) {
      assert.equal(errorsOf({ startDate: d }).startDate, "Choose a valid start date.", d);
    }
  });

  it("end date: same day as start is a valid one-day campaign; one day before start is rejected", () => {
    const ok = parse({ startDate: "2026-11-01", endDate: "2026-11-01" });
    assert.equal(ok.ok && ok.value.endDate, "2026-11-01");
    assert.equal(errorsOf({ startDate: "2026-11-01", endDate: "2026-10-31" }).endDate, "End date must be on or after the start date.");
  });

  it("end date: exactly 730 days after start is allowed, 731 is not", () => {
    const start = "2026-11-01";
    assert.equal(parse({ startDate: start, endDate: addDays(start, MAX_CAMPAIGN_DAYS) }).ok, true);
    assert.match(errorsOf({ startDate: start, endDate: addDays(start, MAX_CAMPAIGN_DAYS + 1) }).endDate ?? "", /at most 730 days/);
  });

  it("end date: impossible date is rejected; empty end date means open-ended", () => {
    assert.equal(errorsOf({ endDate: "2026-02-30" }).endDate, "Choose a valid end date, or leave it empty.");
    const open = parse({ endDate: "" });
    assert.equal(open.ok && open.value.endDate, null);
  });

  it("a bad start date does not pile a second, confusing error on the end date", () => {
    const errors = errorsOf({ startDate: "nope", endDate: "2026-01-01" });
    assert.ok(errors.startDate);
    assert.equal(errors.endDate, undefined);
  });

  it("edit: an old campaign keeps its past start date and old long end date when neither is touched", () => {
    const existing = { startDate: "2026-01-05", category: "gaming", categoryLocked: false, totalBudget: 500, dailyBudget: 50, endDate: "2029-01-05" };
    const r = parse({ startDate: "2026-01-05", endDate: "2029-01-05", name: "Renamed only" }, existing);
    assert.equal(r.ok, true);
  });

  it("edit: moving the start of an old campaign into the past is blocked, and so is stretching the end past the limit", () => {
    const existing = { startDate: "2026-10-10", category: "gaming", categoryLocked: false, totalBudget: 500, dailyBudget: 50, endDate: "2026-12-31" };
    assert.equal(errorsOf({ startDate: "2026-10-01", endDate: "2026-12-31" }, existing).startDate, "Start date cannot be in the past.");
    assert.match(errorsOf({ startDate: "2026-10-10", endDate: addDays("2026-10-10", MAX_CAMPAIGN_DAYS + 1) }, existing).endDate ?? "", /at most 730 days/);
  });

  it("edit: changing only the start date re-checks the old end date against the 730-day limit", () => {
    const existing = { startDate: "2026-10-27", category: "gaming", categoryLocked: false, totalBudget: 500, dailyBudget: 50, endDate: addDays("2026-10-27", 730) };
    assert.match(errorsOf({ startDate: "2026-10-26", endDate: existing.endDate }, existing).endDate ?? "", /at most 730 days/);
  });
});

// ---------------------------------------------------------------------------
// 4. Name / description / category (create and edit)
// ---------------------------------------------------------------------------
describe("day 9 part 5: other create/edit fields", () => {
  it("name: boundaries, whitespace collapsing and hidden control characters", () => {
    assert.equal(parse({ name: "abc" }).ok, true);
    assert.equal(errorsOf({ name: "ab" }).name, "Use at least 3 characters.");
    assert.equal(parse({ name: "a".repeat(150) }).ok, true);
    assert.equal(errorsOf({ name: "a".repeat(151) }).name, "Use 150 characters or fewer.");
    assert.equal(errorsOf({ name: "   " }).name, "Enter a campaign name.");
    const spaced = parse({ name: "  Big   sale \n now " });
    assert.equal(spaced.ok && spaced.value.name, "Big sale now");
    assert.equal(errorsOf({ name: "bad\u0000name" }).name, "Remove special control characters.");
    assert.equal(errorsOf({ name: "bad\u0007name" }).name, "Remove special control characters.");
  });

  it("description: optional, normalised line endings, NUL removed, length limit enforced", () => {
    const r = parse({ description: "  line1\r\nline2\u0000  " });
    assert.equal(r.ok && r.value.description, "line1\nline2");
    const empty = parse({ description: "   " });
    assert.equal(empty.ok && empty.value.description, null);
    assert.equal(parse({ description: "d".repeat(1000) }).ok, true);
    assert.equal(errorsOf({ description: "d".repeat(1001) }).description, "Use 1000 characters or fewer.");
  });

  it("category: unknown, empty and near-miss slugs are rejected on create; case matters", () => {
    for (const c of ["", "Gaming", "gaming ", "game", "beauty", "gaming;drop table campaigns"]) {
      assert.equal(errorsOf({ category: c }).category, "Choose a category.", JSON.stringify(c));
    }
  });

  it("category: when locked, the form value is ignored even if it is garbage", () => {
    const r = parse({ category: "<script>" }, { startDate: FIXED_TODAY, category: "finance", categoryLocked: true, totalBudget: 500, dailyBudget: 50 });
    assert.equal(r.ok && r.value.category, "finance");
  });

  it("category: an old category no longer in the list may be kept unchanged on edit (legacy data)", () => {
    const r = parse({ category: "beauty" }, { startDate: FIXED_TODAY, category: "beauty", categoryLocked: false, totalBudget: 500, dailyBudget: 50 });
    assert.equal(r.ok, true);
  });
});

// ---------------------------------------------------------------------------
// 5. Server actions: create / edit with ownership, status locks, DB failures
// ---------------------------------------------------------------------------
function campaign(over: Partial<FakeCampaign> = {}): FakeCampaign {
  return {
    id: CAMP_ID,
    advertiserId: "adv-A",
    name: "Winter launch",
    description: null,
    category: "gaming",
    status: "draft",
    totalBudget: 500,
    dailyBudget: 50,
    startDate: TODAY,
    endDate: null,
    createdAt: UPDATED,
    updatedAt: UPDATED,
    ...over,
  };
}

function form(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    campaignId: CAMP_ID,
    expectedUpdatedAt: UPDATED,
    name: "Winter launch",
    description: "",
    category: "gaming",
    totalBudget: "500",
    dailyBudget: "50",
    startDate: TODAY,
    endDate: "",
  };
  for (const [k, v] of Object.entries({ ...base, ...over })) fd.set(k, v);
  return fd;
}

type ActionOutcome<T> = { state?: T; redirect?: string };

async function settle<T>(fn: () => Promise<T>): Promise<ActionOutcome<T>> {
  try {
    return { state: await fn() };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.startsWith("REDIRECT:")) return { redirect: msg.slice("REDIRECT:".length) };
    throw e;
  }
}

const edit = (over: Record<string, string> = {}) => settle(() => updateCampaign({ status: "idle" }, form(over)));
function create(over: Record<string, string> = {}) {
  const fd = form(over);
  fd.delete("campaignId");
  fd.delete("expectedUpdatedAt");
  return settle(() => createCampaign({ status: "idle" }, fd));
}
const msgOf = (s: { message?: string } | undefined): string => s?.message ?? "";
const writes = () => fake.calls.filter((c) => c.table === "campaigns");

describe("day 9 part 5: createCampaign", () => {
  beforeEach(() => fake.reset());

  it("a valid create inserts exactly once, for the logged-in advertiser, and carries no status/review fields", () => {
    return create({ totalBudget: "100", dailyBudget: "100" }).then((r) => {
      assert.match(r.redirect ?? "", /created=1/);
      const inserts = writes().filter((c) => c.op === "insert");
      assert.equal(inserts.length, 1);
      const keys = Object.keys(inserts[0].payload).sort();
      assert.deepEqual(keys, ["advertiser_id", "category", "daily_budget", "description", "end_date", "name", "start_date", "total_budget"]);
      assert.equal(inserts[0].payload.advertiser_id, "adv-A");
    });
  });

  it("forged status / advertiser / spend fields in the form are never copied into the insert", async () => {
    const fd = form();
    fd.delete("campaignId");
    fd.set("status", "active");
    fd.set("advertiser_id", "adv-B");
    fd.set("advertiserId", "adv-B");
    fd.set("spent_total", "0");
    fd.set("review_status", "approved");
    await settle(() => createCampaign({ status: "idle" }, fd));
    const p = writes()[0].payload;
    for (const k of ["status", "spent_total", "review_status", "advertiserId"]) assert.equal(k in p, false, k);
    assert.equal(p.advertiser_id, "adv-A");
  });

  it("zero, negative and daily-above-total budgets never reach the database", async () => {
    for (const over of <Record<string, string>[]>[{ totalBudget: "0" }, { totalBudget: "0.00" }, { totalBudget: "-5" }, { totalBudget: "100", dailyBudget: "0" }, { totalBudget: "100", dailyBudget: "100.01" }]) {
      const r = await create(over);
      assert.equal(r.state?.status, "error", JSON.stringify(over));
      assert.ok(r.state?.status === "error" && r.state.fieldErrors, JSON.stringify(over));
    }
    assert.equal(fake.calls.length, 0);
  });

  it("invalid schedules never reach the database", async () => {
    for (const over of <Record<string, string>[]>[{ startDate: addDays(TODAY, -2) }, { startDate: addDays(TODAY, 366) }, { startDate: addDays(TODAY, 5), endDate: addDays(TODAY, 4) }, { startDate: "2026-02-30" }]) {
      const r = await create(over);
      assert.equal(r.state?.status, "error", JSON.stringify(over));
    }
    assert.equal(fake.calls.length, 0);
  });

  it("an advertiser that is pending, suspended or missing cannot create", async () => {
    for (const me of [{ id: "adv-A", status: "pending" }, { id: "adv-A", status: "suspended" }, null]) {
      fake.reset();
      fake.me = me;
      const r = await create();
      assert.equal(r.state?.status, "error");
      assert.equal(fake.calls.length, 0);
    }
  });

  it("wrong role / expired session redirects to login before any database call", async () => {
    fake.roleFails = true;
    const r = await create();
    assert.equal(r.redirect, "/login");
    assert.equal(fake.calls.length, 0);
  });

  it("failed request: database error shows a fixed message, keeps the typed values, and does NOT redirect as if it worked", async () => {
    for (const [err, expected] of [
      [{ code: "23514" }, "One of the values is not allowed. Please check the form and try again."],
      [{ code: "23505" }, "That already exists."],
      [{ code: "42501" }, "That change is not allowed for this campaign right now."],
      [{ code: "XX000" }, "Something went wrong. Please try again."],
      [{ code: "P0001", hint: "campaign_limit_reached" }, "You have reached the limit of 50 campaigns. Archive an old campaign first."],
    ] as const) {
      fake.reset();
      fake.dbError = { ...err };
      const r = await create({ name: "Typed name" });
      assert.equal(r.redirect, undefined, JSON.stringify(err));
      assert.equal(r.state?.status, "error");
      assert.equal(r.state?.status === "error" && r.state.message, expected);
      assert.equal(r.state?.status === "error" && r.state.values?.name, "Typed name");
    }
  });

  it("a database error never leaks raw text into the message", async () => {
    fake.dbError = { code: "23514", hint: undefined, ...({ message: 'new row violates check constraint "campaigns_budget_check"', details: "Failing row contains (...)" } as object) } as never;
    const r = await create();
    const text = JSON.stringify(r.state);
    assert.equal(/violates|constraint|Failing row/i.test(text), false);
  });

  it("each submit is its own insert: a second click after an error is a fresh, single attempt (no hidden retry loop)", async () => {
    fake.dbError = { code: "XX000" };
    await create();
    await create();
    assert.equal(writes().filter((c) => c.op === "insert").length, 2);
  });
});

describe("day 9 part 5: updateCampaign status locks and ownership", () => {
  beforeEach(() => {
    fake.reset();
    fake.campaigns = [campaign()];
  });

  it("locked statuses (pending review, completed, archived) refuse every edit and write nothing", async () => {
    for (const status of ["pending_review", "completed", "archived"] as const) {
      fake.calls = [];
      fake.campaigns = [campaign({ status })];
      const r = await edit({ name: "Changed" });
      assert.equal(r.state?.status, "error", status);
      assert.match(msgOf(r.state), /locked/, status);
      assert.equal(writes().length, 0, status);
    }
  });

  it("editable statuses (draft, active, paused, rejected) save, and the write is pinned to the status that was read", async () => {
    for (const status of ["draft", "active", "paused", "rejected"] as const) {
      fake.calls = [];
      fake.campaigns = [campaign({ status })];
      const r = await edit({ name: `Edit in ${status}` });
      assert.match(r.redirect ?? "", /updated=1/, status);
      const u = writes()[0];
      assert.ok(u.filters.some(([c, v]) => c === "status" && v === status), status);
      assert.ok(u.filters.some(([c, v]) => c === "updated_at" && v === UPDATED), status);
      assert.ok(u.filters.some(([c, v]) => c === "advertiser_id" && v === "adv-A"), status);
    }
  });

  it("an edit can never smuggle in a status, review or spend column", async () => {
    const fd = form({ name: "Sneaky" });
    fd.set("status", "active");
    fd.set("review_status", "approved");
    fd.set("spent_total", "0");
    await settle(() => updateCampaign({ status: "idle" }, fd));
    const keys = Object.keys(writes()[0].payload);
    for (const k of keys) assert.ok(["name", "description", "total_budget", "daily_budget", "start_date", "end_date", "category"].includes(k), k);
  });

  it("category is changeable only in draft/rejected; for active/paused a forged category is ignored (not even sent)", async () => {
    fake.campaigns = [campaign({ status: "draft" })];
    await edit({ category: "finance" });
    assert.equal(writes()[0].payload.category, "finance");

    for (const status of ["active", "paused"] as const) {
      fake.calls = [];
      fake.campaigns = [campaign({ status })];
      await edit({ category: "finance" });
      assert.equal("category" in writes()[0].payload, false, status);
    }
  });

  it("an invalid category on a draft is rejected before the database", async () => {
    const r = await edit({ category: "not-a-category" });
    assert.equal(r.state?.status, "error");
    assert.equal(writes().length, 0);
  });

  it("another advertiser cannot edit this campaign: looks like 'not found', nothing written", async () => {
    fake.me = { id: "adv-B", status: "active" };
    const r = await edit({ name: "Hijack" });
    assert.equal(r.state?.status === "error" && r.state.message, "Campaign not found.");
    assert.equal(writes().length, 0);
  });

  it("an advertiser editing a campaign id they do not own gets 'not found' even if their own campaign exists", async () => {
    fake.campaigns = [campaign(), campaign({ id: OTHER_CAMP_ID, advertiserId: "adv-B" })];
    const r = await edit({ campaignId: OTHER_CAMP_ID });
    assert.equal(r.state?.status === "error" && r.state.message, "Campaign not found.");
    assert.equal(writes().length, 0);
  });

  it("forged advertiser ids in the edit form change nothing: the filter always uses the logged-in advertiser", async () => {
    const fd = form();
    fd.set("advertiser_id", "adv-B");
    fd.set("advertiserId", "adv-B");
    await settle(() => updateCampaign({ status: "idle" }, fd));
    assert.ok(writes()[0].filters.every(([c, v]) => c !== "advertiser_id" || v === "adv-A"));
    assert.equal("advertiser_id" in writes()[0].payload, false);
  });

  it("malformed or missing campaign ids are 'not found' (no database call)", async () => {
    for (const id of ["", "not-a-uuid", "11111111-1111-4111-8111-11111111111", `${CAMP_ID}'; drop table campaigns;--`]) {
      const r = await edit({ campaignId: id });
      assert.equal(r.state?.status === "error" && r.state.message, "Campaign not found.", JSON.stringify(id));
    }
    assert.equal(writes().length, 0);
  });

  it("stale form: missing or different expectedUpdatedAt is refused, nothing written", async () => {
    const missing = form();
    missing.delete("expectedUpdatedAt");
    const r1 = await settle(() => updateCampaign({ status: "idle" }, missing));
    assert.match(msgOf(r1.state), /changed since you opened/);
    const r2 = await edit({ expectedUpdatedAt: "2026-10-21T10:00:00.000Z" });
    assert.match(msgOf(r2.state), /changed since you opened/);
    assert.equal(writes().length, 0);
  });

  it("zero / daily-above-total edits are refused without touching the database", async () => {
    for (const over of <Record<string, string>[]>[{ totalBudget: "0" }, { totalBudget: "10", dailyBudget: "10.01" }, { dailyBudget: "0" }]) {
      const r = await edit(over);
      assert.equal(r.state?.status, "error", JSON.stringify(over));
    }
    assert.equal(writes().length, 0);
  });

  it("failed request on save: fixed message, form values kept, no success redirect", async () => {
    fake.dbError = { code: "XX000" };
    const r = await edit({ name: "Keep my typing" });
    assert.equal(r.redirect, undefined);
    assert.equal(r.state?.status === "error" && r.state.message, "Something went wrong. Please try again.");
    assert.equal(r.state?.status === "error" && r.state.values?.name, "Keep my typing");
  });

  it("save that matches zero rows (campaign changed or was taken away between read and write) is NOT reported as success", async () => {
    // getCampaignSpend is only read when the total budget changes; we use that moment to simulate the race.
    const original = Object.getOwnPropertyDescriptor(fake, "spend");
    Object.defineProperty(fake, "spend", {
      configurable: true,
      get() {
        fake.campaigns = []; // campaign vanished / changed after we loaded it
        return { spentTotal: 0, spentToday: 0, servesTotal: 0 };
      },
    });
    try {
      const r = await edit({ totalBudget: "600" });
      assert.equal(r.redirect, undefined);
      assert.match(msgOf(r.state), /changed or can no longer be edited/);
    } finally {
      delete (fake as { spend?: unknown }).spend;
      if (original) Object.defineProperty(fake, "spend", original);
    }
  });

  it("suspended or missing advertiser cannot edit; wrong role redirects to login", async () => {
    fake.me = { id: "adv-A", status: "suspended" };
    assert.equal((await edit()).state?.status, "error");
    fake.me = null;
    assert.equal((await edit()).state?.status, "error");
    fake.me = { id: "adv-A", status: "active" };
    fake.roleFails = true;
    assert.equal((await edit()).redirect, "/login");
    assert.equal(writes().length, 0);
  });
});

// ---------------------------------------------------------------------------
// 6. Exhausted budgets: edit and resume
// ---------------------------------------------------------------------------
describe("day 9 part 5: exhausted budgets in edit/resume", () => {
  beforeEach(() => {
    fake.reset();
    fake.campaigns = [campaign({ status: "paused", totalBudget: 50, dailyBudget: null })];
    fake.spend = { spentTotal: 50, spentToday: 0, servesTotal: 25_000 };
  });

  it("renaming an exhausted campaign (total unchanged) does not need a spend read and is allowed", async () => {
    fake.spend = null; // spend unreadable: must not matter when the total is unchanged
    const r = await edit({ name: "Renamed", totalBudget: "50", dailyBudget: "" });
    assert.match(r.redirect ?? "", /updated=1/);
  });

  it("raising the total of an exhausted campaign is allowed", async () => {
    assert.match((await edit({ totalBudget: "80", dailyBudget: "" })).redirect ?? "", /updated=1/);
    assert.equal(writes()[0].payload.total_budget, 80);
  });

  it("lowering the total below money already spent is blocked, even by 0.0001 (spend has 4 decimals); equal to spend is allowed", async () => {
    fake.campaigns = [campaign({ status: "paused", totalBudget: 80, dailyBudget: null })];
    fake.spend = { spentTotal: 50.0001, spentToday: 0, servesTotal: 25_000 };
    const blocked = await edit({ totalBudget: "50", dailyBudget: "" });
    assert.equal(blocked.state?.status, "error");
    assert.ok(blocked.state?.fieldErrors?.totalBudget);
    assert.equal(writes().length, 0);

    fake.spend = { spentTotal: 50, spentToday: 0, servesTotal: 25_000 };
    assert.match((await edit({ totalBudget: "50", dailyBudget: "" })).redirect ?? "", /updated=1/);
  });

  it("resume of an exhausted paused campaign is refused with the budget message and writes nothing", async () => {
    const r = await settle(() => resumeCampaign({ status: "idle" } as never, form()));
    assert.equal(r.redirect, undefined);
    assert.match(JSON.stringify(r.state), /no budget left/);
    assert.equal(writes().length, 0);
  });

  it("checkResume boundaries: last cent left is allowed (database rule decides about unit cost), zero left is blocked, end date today is allowed, yesterday is blocked", () => {
    const c = { status: "paused" as const, endDate: null, totalBudget: 50 };
    assert.deepEqual(checkResume(c, 1, FIXED_TODAY, 49.99), { ok: true });
    assert.deepEqual(checkResume(c, 1, FIXED_TODAY, 50), { ok: false, reason: "budget_used" });
    assert.deepEqual(checkResume(c, 1, FIXED_TODAY, 50.5), { ok: false, reason: "budget_used" });
    assert.deepEqual(checkResume({ ...c, endDate: FIXED_TODAY }, 1, FIXED_TODAY, 0), { ok: true });
    assert.deepEqual(checkResume({ ...c, endDate: addDays(FIXED_TODAY, -1) }, 1, FIXED_TODAY, 0), { ok: false, reason: "ended" });
  });

  it("pause is refused for every status except active (rejected / unapproved / completed campaigns cannot be 'paused' into existence)", async () => {
    for (const status of ["draft", "pending_review", "paused", "completed", "rejected", "archived"] as const) {
      fake.calls = [];
      fake.campaigns = [campaign({ status })];
      const r = await settle(() => pauseCampaign({ status: "idle" } as never, form()));
      assert.equal(r.redirect, undefined, status);
      assert.equal(writes().length, 0, status);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Delivery truth for schedule + budget boundaries
// ---------------------------------------------------------------------------
describe("day 9 part 5: deliveryState boundaries", () => {
  const base = {
    status: "active" as const,
    startDate: "2026-10-01",
    endDate: "2026-12-31",
    totalBudget: 100,
    dailyBudget: 10 as number | null,
    approvedCreatives: 1 as number | null,
    spentTotal: 0 as number | null,
    spentToday: 0 as number | null,
    todayUtc: FIXED_TODAY,
  };

  it("start date == today serves, start date tomorrow does not", () => {
    assert.equal(deliveryState({ ...base, startDate: FIXED_TODAY }).serving, true);
    assert.equal(deliveryState({ ...base, startDate: addDays(FIXED_TODAY, 1) }).reason, "not_started");
  });

  it("end date == today serves, end date yesterday does not", () => {
    assert.equal(deliveryState({ ...base, endDate: FIXED_TODAY }).serving, true);
    assert.equal(deliveryState({ ...base, endDate: addDays(FIXED_TODAY, -1) }).reason, "ended");
  });

  it("exactly one unit left serves; less than one unit does not (total and daily)", () => {
    assert.equal(deliveryState({ ...base, totalBudget: 10, spentTotal: 9.998 }).serving, true);
    assert.equal(deliveryState({ ...base, totalBudget: 10, spentTotal: 9.9985 }).reason, "total_budget_used");
    assert.equal(deliveryState({ ...base, dailyBudget: 1, spentToday: 0.998 }).serving, true);
    assert.equal(deliveryState({ ...base, dailyBudget: 1, spentToday: 0.9985 }).reason, "daily_budget_used");
  });

  it("when everything is wrong, the end date message wins (one clear reason), and zero approved ads blocks", () => {
    assert.equal(deliveryState({ ...base, endDate: "2026-10-01", approvedCreatives: 0, spentTotal: 100 }).reason, "ended");
    assert.equal(deliveryState({ ...base, approvedCreatives: 0 }).reason, "no_approved_creative");
  });
});
