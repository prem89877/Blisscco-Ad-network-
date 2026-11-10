// Pilot limits (owner decision 2026-11-07): $1,000 per campaign aur $2,000 per advertiser (saare campaigns milakar) ab CODE me enforce hote hain.
// Nakli (in-memory) database; koi SQL nahi chalti. review-flow-stubs actions se PEHLE import hona zaroori hai.
import { fake, type FakeCampaign, type CampaignStatus } from "../workflows/review-flow-stubs";
import { createCampaign, updateCampaign } from "@/app/dashboard/advertiser/campaigns/actions";
import { changeCampaignReviewState } from "@/app/dashboard/advertiser/campaigns/creative-actions";
import { beforeEach, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PILOT_MAX_ADVERTISER_TOTAL, PILOT_MAX_CAMPAIGN_BUDGET, MAX_BUDGET } from "@/lib/campaigns/constants";
import { BUDGET_MESSAGES, checkBudgets } from "@/lib/campaigns/budget-rules";
import { PILOT_ADVERTISER_TOTAL_CENTS, advertiserTotalMessage, checkAdvertiserTotal, sumCountedBudgetCents } from "@/lib/campaigns/pilot-limits";

const TODAY = new Date().toISOString().slice(0, 10);
const UPDATED = "2026-10-20T10:00:00.000Z";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function seed(n: number, totalBudget: number, status: CampaignStatus = "draft", advertiserId = "adv-A"): FakeCampaign {
  const c: FakeCampaign = {
    id: id(n), advertiserId, name: `Campaign ${n}`, description: null, category: "lifestyle", status, totalBudget,
    dailyBudget: null, startDate: TODAY, endDate: null, createdAt: UPDATED, updatedAt: UPDATED,
  };
  fake.campaigns.push(c);
  return c;
}
function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}
const createForm = (over: Record<string, string> = {}) =>
  fd({ name: "New sale", description: "", category: "lifestyle", totalBudget: "100", dailyBudget: "", startDate: TODAY, endDate: "", ...over });
const editForm = (c: FakeCampaign, over: Record<string, string> = {}) =>
  fd({
    campaignId: c.id, expectedUpdatedAt: c.updatedAt, name: c.name, description: "", category: c.category,
    totalBudget: c.totalBudget.toFixed(2), dailyBudget: "", startDate: c.startDate, endDate: "", ...over,
  });
async function run<T>(p: Promise<T>): Promise<{ state?: T; redirect?: string }> {
  try {
    return { state: await p };
  } catch (e) {
    const m = /^REDIRECT:(.*)$/.exec(e instanceof Error ? e.message : "");
    if (m) return { redirect: m[1] };
    throw e;
  }
}
type St = { status?: string; message?: string; fieldErrors?: Record<string, string> } | undefined;
const st = (r: { state?: unknown }) => r.state as St;
const create = (over: Record<string, string> = {}) => run(createCampaign({ status: "idle" } as never, createForm(over)));
const edit = (c: FakeCampaign, over: Record<string, string> = {}) => run(updateCampaign({ status: "idle" } as never, editForm(c, over)));
const reopen = (c: FakeCampaign) => run(changeCampaignReviewState({ status: "idle" } as never, fd({ campaignId: c.id, action: "reopen" })));
const campaignWrites = () => fake.writes.filter((w) => w.table === "campaigns");

const realError = console.error;
beforeEach(() => {
  fake.reset();
  console.error = () => {};
});
afterEach(() => {
  console.error = realError;
});

describe("pilot limits: numbers and messages", () => {
  it("owner limits: 1,000 per campaign, 2,000 per advertiser; database max (10,000,000) is untouched", () => {
    assert.equal(PILOT_MAX_CAMPAIGN_BUDGET, 1000);
    assert.equal(PILOT_MAX_ADVERTISER_TOTAL, 2000);
    assert.equal(PILOT_ADVERTISER_TOTAL_CENTS, 200000);
    assert.equal(MAX_BUDGET, 10_000_000);
  });
  it("per campaign: 1,000.00 is allowed, one cent more is not; unchanged old bigger value is not blocked", () => {
    assert.equal(checkBudgets("1000.00", "").errors.totalBudget, undefined);
    assert.equal(checkBudgets("1000.01", "").errors.totalBudget, BUDGET_MESSAGES.totalPilotMax);
    assert.match(BUDGET_MESSAGES.totalPilotMax, /\$1,000\.00/);
    assert.equal(checkBudgets("5000", "", { totalBudget: 5000 }).errors.totalBudget, undefined, "rename of an old big campaign still works");
    assert.equal(checkBudgets("5000.01", "", { totalBudget: 5000 }).errors.totalBudget, BUDGET_MESSAGES.totalPilotMax, "a changed value must fit the limit");
  });
  it("advertiser total: exactly 2,000.00 is allowed, one cent more is not", () => {
    assert.deepEqual(checkAdvertiserTotal(100000, 100000), { ok: true });
    assert.deepEqual(checkAdvertiserTotal(100001, 100000), { ok: false, message: advertiserTotalMessage(100000) });
    assert.match(advertiserTotalMessage(150000), /\$2,000\.00/);
    assert.match(advertiserTotalMessage(150000), /\$1,500\.00/);
    assert.match(advertiserTotalMessage(150000), /at most \$500\.00/);
    assert.match(advertiserTotalMessage(250000), /at most \$0\.00/);
  });
  it("bad numbers fail closed", () => {
    assert.equal(checkAdvertiserTotal(Number.NaN, 0).ok, false);
    assert.equal(checkAdvertiserTotal(100, Number.POSITIVE_INFINITY).ok, false);
  });
  it("sum counts draft/pending/active/paused/completed only; rejected and archived are free; bad rows fail closed", () => {
    const rows = [
      { status: "draft", total_budget: 100 }, { status: "pending_review", total_budget: "200.50" }, { status: "active", total_budget: 300 },
      { status: "paused", total_budget: 400 }, { status: "completed", total_budget: 50 },
      { status: "rejected", total_budget: 999 }, { status: "archived", total_budget: 999 },
    ];
    assert.equal(sumCountedBudgetCents(rows), 105050);
    assert.equal(sumCountedBudgetCents([]), 0);
    assert.equal(sumCountedBudgetCents(null), null);
    assert.equal(sumCountedBudgetCents([{ status: "active", total_budget: "abc" }]), null);
    assert.equal(sumCountedBudgetCents([{ status: "active", total_budget: -5 }]), null);
    assert.equal(sumCountedBudgetCents([null]), null);
  });
});

describe("pilot limits: createCampaign", () => {
  it("one campaign above 1,000 is refused with a field error and nothing is written", async () => {
    const r = await create({ totalBudget: "1000.01" });
    assert.equal(st(r)?.status, "error");
    assert.equal(st(r)?.fieldErrors?.totalBudget, BUDGET_MESSAGES.totalPilotMax);
    assert.equal(fake.writes.length, 0);
  });
  it("1,000.00 is saved when the advertiser has no other campaigns", async () => {
    const r = await create({ totalBudget: "1000.00" });
    assert.match(r.redirect ?? "", /created=1/);
    assert.equal(campaignWrites()[0].payload.total_budget, 1000);
  });
  it("two campaigns of 1,000 are fine; a third one (even 1.00) is refused", async () => {
    seed(1, 1000, "active");
    seed(2, 1000, "draft");
    const r = await create({ totalBudget: "1" });
    assert.equal(st(r)?.status, "error");
    assert.match(st(r)?.fieldErrors?.totalBudget ?? "", /at most \$2,000\.00/);
    assert.equal(fake.writes.length, 0);
  });
  it("boundary: others use 1,500 -> 500.00 saves, 500.01 is refused", async () => {
    seed(1, 1000, "active");
    seed(2, 500, "paused");
    assert.equal(st(await create({ totalBudget: "500.01" }))?.status, "error");
    assert.equal(fake.writes.length, 0);
    assert.match((await create({ totalBudget: "500.00" })).redirect ?? "", /created=1/);
  });
  it("rejected and archived campaigns do not use up the limit", async () => {
    seed(1, 1000, "rejected");
    seed(2, 1000, "archived");
    seed(3, 900, "active");
    assert.match((await create({ totalBudget: "1000" })).redirect ?? "", /created=1/);
  });
  it("another advertiser's campaigns are not counted", async () => {
    seed(1, 1000, "active", "adv-B");
    seed(2, 1000, "active", "adv-B");
    assert.match((await create({ totalBudget: "1000" })).redirect ?? "", /created=1/);
  });
});

describe("pilot limits: updateCampaign", () => {
  it("editing a campaign does not count its own old total twice", async () => {
    const other = seed(1, 1000, "active");
    const mine = seed(2, 900, "draft");
    assert.ok(other);
    assert.match((await edit(mine, { totalBudget: "1000.00" })).redirect ?? "", /updated=1/);
  });
  it("raising the total so that the advertiser goes above 2,000 is refused; nothing is written", async () => {
    seed(1, 1000, "active");
    const mine = seed(2, 500, "draft");
    const r = await edit(mine, { totalBudget: "1000.01" });
    assert.equal(st(r)?.status, "error");
    assert.ok(st(r)?.fieldErrors?.totalBudget);
    assert.equal(campaignWrites().length, 0);
  });
  it("a rename without changing the total is never blocked by the advertiser total (old data keeps working)", async () => {
    seed(1, 1000, "active");
    seed(2, 1000, "active");
    const mine = seed(3, 500, "draft"); // legacy: advertiser is already above 2,000
    assert.match((await edit(mine, { name: "Renamed" })).redirect ?? "", /updated=1/);
  });
  it("lowering the total of a legacy big campaign is allowed only down to the limits", async () => {
    const big = seed(1, 5000, "draft"); // legacy value, created before the pilot limit
    assert.equal(st(await edit(big, { totalBudget: "1500" }))?.status, "error", "1,500 is still above the per-campaign limit");
    assert.match((await edit(big, { totalBudget: "1000" })).redirect ?? "", /updated=1/);
  });
  it("a rejected campaign is checked again when edited, even if its total is unchanged", async () => {
    seed(1, 1000, "active");
    seed(2, 800, "active");
    const rejected = seed(3, 500, "rejected");
    const r = await edit(rejected, { name: "Fixed copy" });
    assert.equal(st(r)?.status, "error");
    assert.match(st(r)?.fieldErrors?.totalBudget ?? "", /\$2,000\.00/);
    assert.equal(campaignWrites().length, 0);
  });
  it("if the other campaigns cannot be read, create and a total increase are refused; a plain rename still works", async () => {
    const mine = seed(1, 100, "draft");
    fake.committedFails = true;
    const c = await create({ totalBudget: "100" });
    assert.equal(st(c)?.status, "error");
    assert.match(st(c)?.fieldErrors?.totalBudget ?? "", /could not check/);
    assert.equal(fake.writes.length, 0);
    assert.equal(st(await edit(mine, { totalBudget: "200" }))?.status, "error");
    assert.equal(campaignWrites().length, 0);
    assert.match((await edit(mine, { name: "Renamed" })).redirect ?? "", /updated=1/, "total unchanged: no limit check needed");
  });
});

describe("pilot limits: rejected -> draft (reopen)", () => {
  it("reopen is refused when the campaign would push the advertiser above 2,000; status stays rejected", async () => {
    seed(1, 1000, "active");
    seed(2, 800, "active");
    const rejected = seed(3, 500, "rejected");
    const r = await reopen(rejected);
    assert.equal(st(r)?.status, "error");
    assert.match(st(r)?.message ?? "", /\$2,000\.00/);
    assert.equal(rejected.status, "rejected");
    assert.equal(campaignWrites().length, 0);
  });
  it("reopen works when it fits", async () => {
    seed(1, 1000, "active");
    const rejected = seed(2, 1000, "rejected");
    assert.match((await reopen(rejected)).redirect ?? "", /review=reopen/);
    assert.equal(rejected.status, "draft");
  });
});

describe("pilot limits: wiring (source)", () => {
  it("create, update and reopen all call the guard; the form shows the pilot limit", () => {
    assert.match(readFileSync("app/dashboard/advertiser/campaigns/actions.ts", "utf8"), /pilotTotalProblem\(adv\.id, v\.totalBudget\)/);
    assert.match(readFileSync("app/dashboard/advertiser/campaigns/actions.ts", "utf8"), /pilotTotalProblem\(adv\.id, v\.totalBudget, current\.id\)/);
    assert.match(readFileSync("app/dashboard/advertiser/campaigns/creative-actions.ts", "utf8"), /action === "reopen"[\s\S]*?pilotTotalProblem\(/);
    assert.match(readFileSync("components/campaigns/CampaignForm.tsx", "utf8"), /PILOT_MAX_CAMPAIGN_BUDGET/);
  });
});
