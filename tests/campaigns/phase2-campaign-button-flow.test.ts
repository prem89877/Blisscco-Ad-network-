import { fake, type FakeCampaign } from "./action-stubs"; // SABSE PEHLE: nakli modules lagte hain
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { pauseCampaign, resumeCampaign } from "@/app/dashboard/advertiser/campaigns/actions";
import { createActionGuard, isNextControlFlowError } from "@/lib/actions/guard";
import { initialRunState, type RunStateResult } from "@/lib/campaigns/types";

// Phase 2: campaign Pause / Resume buttons guard ke saath. Nakli database (RLS jaisa filter action-stubs me hai).
// Stub ka redirect() plain Error("REDIRECT:...") phekta hai; asli Next.js ka error digest "NEXT_REDIRECT..." wala hota hai.
// Isliye neeche asli jaisa error banakar guard ko diya jata hai.

const CAMP = "11111111-1111-4111-8111-111111111111";
const fd = () => {
  const f = new FormData();
  f.set("campaignId", CAMP);
  return f;
};
const withRealRedirect =
  (action: (p: RunStateResult, f: FormData) => Promise<RunStateResult>) =>
  async (p: RunStateResult, f: FormData): Promise<RunStateResult> => {
    try {
      return await action(p, f);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("REDIRECT:")) throw Object.assign(e, { digest: `NEXT_REDIRECT;replace;${e.message.slice(9)};307;` });
      throw e;
    }
  };
const campaign = (over: Partial<FakeCampaign> = {}): FakeCampaign => ({
  id: CAMP,
  advertiserId: "adv-A",
  name: "Test campaign",
  description: null,
  category: "technology",
  status: "active",
  totalBudget: 100,
  dailyBudget: 10,
  startDate: "2020-01-01",
  endDate: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...over,
});
const writes = () => fake.calls.filter((c) => c.op === "update");

describe("phase 2 | campaign pause / resume through the guard", () => {
  beforeEach(() => {
    fake.reset();
    console.error = () => {};
  });

  it("server-confirmed change: pause redirects to the page with the new status; the guard lets that navigation through", async () => {
    fake.campaigns = [campaign()];
    const g = createActionGuard<RunStateResult>({ action: withRealRedirect(pauseCampaign) });
    assert.equal(g.tryBegin(), true);
    await assert.rejects(g.run(initialRunState, fd()), (e: unknown) => isNextControlFlowError(e));
    assert.equal(writes().length, 1);
    assert.deepEqual(writes()[0].payload, { status: "paused" });
    assert.equal(g.isBusy(), false, "loading clears after the redirect, too");
  });

  it("five rapid pause taps change the campaign once", async () => {
    fake.campaigns = [campaign()];
    const g = createActionGuard<RunStateResult>({ action: withRealRedirect(pauseCampaign) });
    const taps = Array.from({ length: 5 }, () => g.tryBegin());
    await Promise.allSettled(taps.map((won) => (won ? g.run(initialRunState, fd()) : Promise.resolve(initialRunState))));
    assert.equal(writes().length, 1);
  });

  it("a refused change (campaign not paused) shows the server's error message and loading clears", async () => {
    fake.campaigns = [campaign({ status: "draft" })];
    const g = createActionGuard<RunStateResult>({ action: resumeCampaign });
    const r = await g.run(initialRunState, fd());
    assert.equal(r.status, "error");
    assert.ok(r.message && r.message.length > 0);
    assert.equal(writes().length, 0);
    assert.equal(g.isBusy(), false);
  });

  it("a database error becomes an error state with one attempt only", async () => {
    fake.campaigns = [campaign()];
    fake.dbError = { code: "XX000" };
    const g = createActionGuard<RunStateResult>({ action: pauseCampaign });
    const r = await g.run(initialRunState, fd());
    assert.equal(r.status, "error");
    assert.equal(writes().length, 1);
    assert.equal(g.isBusy(), false);
  });

  it("another advertiser's campaign is 'not found' and nothing is written", async () => {
    fake.campaigns = [campaign({ advertiserId: "adv-B" })];
    const g = createActionGuard<RunStateResult>({ action: pauseCampaign });
    const r = await g.run(initialRunState, fd());
    assert.deepEqual(r, { status: "error", message: "Campaign not found." });
    assert.equal(writes().length, 0);
  });

  it("resume reads the campaign, approved ads and spend together and still refuses a campaign with no budget left (spend protection intact)", async () => {
    fake.campaigns = [campaign({ status: "paused" })];
    fake.spend = { spentTotal: 100, spentToday: 0, servesTotal: 1 };
    const g = createActionGuard<RunStateResult>({ action: resumeCampaign });
    const r = await g.run(initialRunState, fd());
    assert.equal(r.status, "error");
    assert.equal(writes().length, 0);
  });

  it("not logged in: requireRole's redirect reaches no database call", async () => {
    fake.campaigns = [campaign()];
    fake.roleFails = true;
    const g = createActionGuard<RunStateResult>({ action: pauseCampaign });
    const r = await g.run(initialRunState, fd());
    assert.equal(r.status, "error");
    assert.equal(writes().length, 0);
  });
});
