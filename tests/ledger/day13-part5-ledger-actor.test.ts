import { ledgerSession, DEFAULT_ADMIN_ID } from "./ledger-session-stub"; // SABSE PEHLE: nakli login session lagta hai
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { addLedgerAdjustment, reverseLedgerEntry } from "@/lib/ledger/ledger-db";

// Day 13 Part 5: ledger ki admin service (reversal / adjustment) ab actor ka bharosa caller par NAHI karti.
// Ye service-role se chalti hai (RLS bypass), isliye asli rok yahin hai: login session se verify, database call se PEHLE.
// LIMIT: nakli session / nakli database. Asli role-status database se aata hai (lib/auth/session.ts); asli SQL behaviour sirf denim par day-13-14 chalane se milega.

const OTHER_ADMIN = "99999999-9999-4999-8999-999999999999";
const PUB = "33333333-3333-4333-8333-333333333333";
const SECRET_AMOUNT = "7.7777";

type RpcCall = { name: string; args: Record<string, unknown> };
function installFake(): RpcCall[] {
  const calls: RpcCall[] = [];
  (globalThis as { __TEST_SUPABASE__?: unknown }).__TEST_SUPABASE__ = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data: { outcome: "recorded", id: 5, entry_id: "e-5" }, error: null };
    },
  };
  return calls;
}

const reversal = { actorProfileId: DEFAULT_ADMIN_ID, entryId: 9, idempotencyKey: "reverse-9-0001", reason: "Duplicate charge found" };
const adjustment = { actorProfileId: DEFAULT_ADMIN_ID, account: "publisher" as const, amount: SECRET_AMOUNT, idempotencyKey: "adjust-pub-0001", reason: "Manual correction", publisherId: PUB };

describe("day 13 part 5 | ledger service verifies the actor from the login session", () => {
  let logged: unknown[][] = [];
  const realError = console.error;
  beforeEach(() => {
    ledgerSession.reset();
    logged = [];
    console.error = (...a: unknown[]) => void logged.push(a);
  });
  afterEach(() => {
    console.error = realError;
    delete (globalThis as { __TEST_SUPABASE__?: unknown }).__TEST_SUPABASE__;
  });

  const wrongSessions: [string, () => void][] = [
    ["nobody logged in", () => { ledgerSession.account = null; }],
    ["a publisher", () => { ledgerSession.account = { user: { id: DEFAULT_ADMIN_ID }, role: "publisher", status: "active" }; }],
    ["an advertiser", () => { ledgerSession.account = { user: { id: DEFAULT_ADMIN_ID }, role: "advertiser", status: "active" }; }],
    ["a suspended admin", () => { ledgerSession.account = { user: { id: DEFAULT_ADMIN_ID }, role: "admin", status: "suspended" }; }],
    ["a session lookup that fails", () => { ledgerSession.throws = true; }],
    ["a different admin than the one named as actor", () => { ledgerSession.account = { user: { id: OTHER_ADMIN }, role: "admin", status: "active" }; }],
  ];

  for (const [label, arrange] of wrongSessions) {
    it(`refuses reversal and adjustment for ${label}, before any database call`, async () => {
      arrange();
      const calls = installFake();
      assert.deepEqual(await reverseLedgerEntry(reversal), { outcome: "forbidden" });
      assert.deepEqual(await addLedgerAdjustment(adjustment), { outcome: "forbidden" });
      assert.equal(calls.length, 0);
    });
  }

  it("an admin cannot write in another admin's name (actor must equal the signed-in admin)", async () => {
    ledgerSession.account = { user: { id: OTHER_ADMIN }, role: "admin", status: "active" };
    const calls = installFake();
    assert.deepEqual(await reverseLedgerEntry({ ...reversal, actorProfileId: DEFAULT_ADMIN_ID }), { outcome: "forbidden" });
    assert.equal(calls.length, 0);
    // Wahi admin apne naam par likh sakta hai, aur database ko session wali id jaati hai.
    const ok = await reverseLedgerEntry({ ...reversal, actorProfileId: OTHER_ADMIN });
    assert.equal(ok.outcome, "recorded");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args.p_actor, OTHER_ADMIN);
  });

  it("authorization is checked BEFORE validation: a non-admin learns nothing about the input rules", async () => {
    ledgerSession.account = { user: { id: DEFAULT_ADMIN_ID }, role: "publisher", status: "active" };
    installFake();
    assert.deepEqual(await reverseLedgerEntry({ ...reversal, entryId: 0 }), { outcome: "forbidden" });
    assert.deepEqual(await addLedgerAdjustment({ ...adjustment, amount: "0.00005" }), { outcome: "forbidden" });
  });

  it("garbage input never throws and never reaches the database (fail closed)", async () => {
    const calls = installFake();
    for (const bad of [undefined, null, {}, { actorProfileId: 5 }, { actorProfileId: ["x"] }, "admin"]) {
      assert.deepEqual(await reverseLedgerEntry(bad as never), { outcome: "forbidden" });
      assert.deepEqual(await addLedgerAdjustment(bad as never), { outcome: "forbidden" });
    }
    assert.equal(calls.length, 0);
  });

  it("a verified admin still gets the normal validation answers (invalid input is 'invalid', not forbidden)", async () => {
    const calls = installFake();
    assert.deepEqual(await reverseLedgerEntry({ ...reversal, entryId: 0 }), { outcome: "invalid", field: "entryId" });
    assert.deepEqual(await addLedgerAdjustment({ ...adjustment, amount: "0.00005" }), { outcome: "invalid", field: "amount" });
    assert.deepEqual(await addLedgerAdjustment({ ...adjustment, amount: "0" }), { outcome: "invalid", field: "amount" });
    assert.equal(calls.length, 0);
  });

  it("a verified admin's writes carry exactly the expected arguments: exact decimal text, no currency, no extra field", async () => {
    const calls = installFake();
    await addLedgerAdjustment({ ...adjustment, amount: "-0.5" });
    await reverseLedgerEntry(reversal);
    assert.deepEqual(calls.map((c) => c.name), ["ledger_add_adjustment", "ledger_reverse_entry"]);
    assert.deepEqual(Object.keys(calls[0].args).sort(), ["p_account", "p_actor", "p_advertiser_id", "p_amount", "p_campaign_id", "p_idempotency_key", "p_publisher_id", "p_reason"]);
    assert.equal(calls[0].args.p_amount, "-0.5000");
    assert.equal(typeof calls[0].args.p_amount, "string");
    assert.deepEqual(Object.keys(calls[1].args).sort(), ["p_actor", "p_entry_id", "p_idempotency_key", "p_reason"]);
    assert.equal(calls[0].args.p_actor, DEFAULT_ADMIN_ID);
  });

  it("the session is consulted once per write", async () => {
    installFake();
    await reverseLedgerEntry(reversal);
    await addLedgerAdjustment(adjustment);
    assert.equal(ledgerSession.calls, 2);
  });

  it("a refusal logs no ids, no amounts and no reasons", async () => {
    ledgerSession.account = null;
    installFake();
    await addLedgerAdjustment(adjustment);
    await reverseLedgerEntry(reversal);
    const text = JSON.stringify(logged);
    assert.ok(logged.length >= 1);
    for (const secret of [DEFAULT_ADMIN_ID, PUB, SECRET_AMOUNT, "Manual correction", "Duplicate charge found", "adjust-pub-0001"]) {
      assert.ok(!text.includes(secret), `log leaks ${secret}`);
    }
  });
});
