import { payoutFake } from "./payout-stubs"; // SABSE PEHLE: nakli modules lagte hain
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { requestPayout } from "@/app/dashboard/publisher/payout-actions";
import { adminPayoutAction } from "@/app/dashboard/admin/payout-actions";
import { createActionGuard } from "@/lib/actions/guard";
import { initialRunState, type RunStateResult } from "@/lib/campaigns/types";

// Phase 2: payout buttons ka flow guard ke saath (nakli database; asli SQL ke niyam day-13 SQL tests me hain).
// Dekhna: (1) server ka jawab hi UI state banta hai, (2) rapid taps se ek hi request, (3) failure par error + loading clear,
// (4) timeout par action dobara blindly nahi chalta, (5) ledger / balance ki guard wali jagah (RPC) untouched.

const KEY = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("phase 2 | publisher payout button through the guard", () => {
  beforeEach(() => {
    payoutFake.reset();
    console.error = () => {};
  });

  it("server-confirmed 'requested' is what the UI gets (success message from the database outcome)", async () => {
    payoutFake.rpcData = { outcome: "requested", id: ID, status: "requested", amount: "0.0150" };
    const g = createActionGuard<RunStateResult>({ action: requestPayout });
    assert.equal(g.tryBegin(), true);
    const r = await g.run(initialRunState, form({ amount: "0.015", requestKey: KEY }));
    assert.equal(r.status, "success");
    assert.ok(r.message && r.message.length > 0);
    assert.equal(g.isBusy(), false);
    assert.deepEqual(payoutFake.revalidated, ["/dashboard/publisher/payouts"]);
  });

  it("five rapid taps send ONE payout request, and the key is the one from the page (database also dedupes by it)", async () => {
    payoutFake.rpcData = { outcome: "requested", id: ID, status: "requested", amount: "0.0150" };
    const g = createActionGuard<RunStateResult>({ action: requestPayout });
    const taps = Array.from({ length: 5 }, () => g.tryBegin());
    assert.equal(taps.filter(Boolean).length, 1);
    await Promise.all(taps.map((won) => (won ? g.run(initialRunState, form({ amount: "0.015", requestKey: KEY })) : Promise.resolve(initialRunState))));
    assert.equal(payoutFake.rpcCalls.length, 1);
    assert.equal(payoutFake.rpcCalls[0].name, "request_my_payout");
    assert.deepEqual(payoutFake.rpcCalls[0].args, { p_amount: "0.0150", p_request_key: KEY });
  });

  it("insufficient balance: the database answer is shown as an error, nothing is revalidated, loading clears", async () => {
    payoutFake.rpcData = { outcome: "insufficient", id: null, status: null, amount: null, available: "0.0100" };
    const g = createActionGuard<RunStateResult>({ action: requestPayout });
    const r = await g.run(initialRunState, form({ amount: "5", requestKey: KEY }));
    assert.equal(r.status, "error");
    assert.match(r.message ?? "", /more than your available earnings/);
    assert.equal(payoutFake.revalidated.length, 0);
    assert.equal(g.isBusy(), false);
  });

  it("a request that fails in the database shows an error and is NOT retried by the guard", async () => {
    payoutFake.rpcError = { code: "XX000" };
    const g = createActionGuard<RunStateResult>({ action: requestPayout });
    const r = await g.run(initialRunState, form({ amount: "0.015", requestKey: KEY }));
    assert.equal(r.status, "error");
    assert.equal(payoutFake.rpcCalls.length, 1, "exactly one attempt");
    assert.equal(g.isBusy(), false);
  });

  it("a slow server: guard gives up waiting (loading clears + message), makes no second attempt, and claims no success", async () => {
    const slowAction = async (prev: RunStateResult, fd: FormData): Promise<RunStateResult> => {
      await sleep(120);
      return requestPayout(prev, fd);
    };
    payoutFake.rpcData = { outcome: "requested", id: ID, status: "requested", amount: "0.0150" };
    let refreshes = 0;
    const g = createActionGuard<RunStateResult>({ action: slowAction, timeoutMs: 30, refresh: () => void (refreshes += 1) });
    const r = await g.run(initialRunState, form({ amount: "0.015", requestKey: KEY }));
    assert.equal(r.status, "error");
    assert.match(r.message ?? "", /before trying again/);
    assert.equal(g.isBusy(), false);
    assert.equal(refreshes, 1);
    await sleep(150);
    assert.equal(payoutFake.rpcCalls.length, 1, "the slow request completes once on the server; no duplicate");
  });

  it("wrong role never reaches the database, even through the guard", async () => {
    payoutFake.role = "advertiser";
    const g = createActionGuard<RunStateResult>({ action: requestPayout });
    const r = await g.run(initialRunState, form({ amount: "1", requestKey: KEY }));
    assert.equal(r.status, "error");
    assert.equal(payoutFake.rpcCalls.length, 0);
  });
});

describe("phase 2 | admin payout button through the guard", () => {
  beforeEach(() => {
    payoutFake.reset();
    payoutFake.role = "admin";
    console.error = () => {};
  });

  it("approve: one rapid-tap burst = one database call; success message comes from the database outcome", async () => {
    payoutFake.rpcData = { outcome: "approved", id: ID, status: "approved" };
    const g = createActionGuard<RunStateResult>({ action: adminPayoutAction });
    const taps = Array.from({ length: 4 }, () => g.tryBegin());
    await Promise.all(taps.map((won) => (won ? g.run(initialRunState, form({ id: ID, action: "approve" })) : Promise.resolve(initialRunState))));
    assert.equal(payoutFake.rpcCalls.length, 1);
    assert.equal(payoutFake.rpcCalls[0].name, "admin_review_payout_request");
    assert.deepEqual(payoutFake.revalidated, ["/dashboard/admin"]);
  });

  it("mark as paid only records the status (rpc), and a failure shows an error without a retry", async () => {
    payoutFake.rpcError = { code: "XX000" };
    const g = createActionGuard<RunStateResult>({ action: adminPayoutAction });
    const r = await g.run(initialRunState, form({ id: ID, action: "paid" }));
    assert.equal(r.status, "error");
    assert.equal(payoutFake.rpcCalls.length, 1);
    assert.equal(payoutFake.rpcCalls[0].name, "admin_mark_payout_paid");
  });
});
