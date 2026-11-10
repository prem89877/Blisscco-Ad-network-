import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { serveAd, type ServeDeps } from "../../lib/ads/serve";
import { regionalGateOutcome, parseCountryStateResult } from "../../lib/ads/regional-eligibility";
import { checkPublisherRegionalEligibility } from "../../lib/ads/publisher-country-db";
import type { SelectionOutcome } from "../../lib/ads/selection";

// Phase 6 Step 2 Part 1: serve ke andar regional gate. Fake dependencies; asli database / clock nahi.
const HASH = "a".repeat(64);
const PUBLISHER_ID = "99999999-9999-4999-8999-999999999999";
const CREATIVE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

type Trace = { gate: string[]; select: number; record: number; replay: number };

function makeDeps(gate?: ServeDeps["checkRegionalEligibility"]): { deps: ServeDeps; trace: Trace } {
  const trace: Trace = { gate: [], select: 0, record: 0, replay: 0 };
  const deps: ServeDeps = {
    authorize: async () => ({ outcome: "ok", publisher: { id: PUBLISHER_ID, status: "active" }, unitCostUsd: 0.002 }),
    select: async (): Promise<SelectionOutcome> => {
      trace.select += 1;
      return { fill: true, ad: { id: CREATIVE, headline: "H", body: "B", ctaText: null, destinationUrl: "https://example.com/x" } } as SelectionOutcome;
    },
    record: async () => {
      trace.record += 1;
      return { outcome: "recorded" };
    },
    lookupReplay: async () => {
      trace.replay += 1;
      return { outcome: "none" };
    },
  };
  if (gate) {
    deps.checkRegionalEligibility = async (id) => {
      trace.gate.push(id);
      return gate(id);
    };
  }
  return { deps, trace };
}
const request = { topic: "gaming", excludeAdIds: [] as string[] };

describe("serveAd regional gate", () => {
  it("no gate dependency => behaviour exactly as before (ad is served)", async () => {
    const { deps, trace } = makeDeps();
    const r = await serveAd(HASH, request, deps);
    assert.equal(r.kind, "ad");
    assert.equal(trace.record, 1);
  });

  it("eligible => ad served; the gate gets the authorized publisher id, never anything from the request", async () => {
    const { deps, trace } = makeDeps(async () => "eligible");
    const r = await serveAd(HASH, { ...request, publisherId: "evil", country: "US" } as typeof request, deps);
    assert.equal(r.kind, "ad");
    assert.deepEqual(trace.gate, [PUBLISHER_ID]);
  });

  it("ineligible (pending / rejected / missing / invalid country) => no-fill, nothing selected, replayed or charged", async () => {
    const { deps, trace } = makeDeps(async () => "ineligible");
    assert.deepEqual(await serveAd(HASH, { ...request, idempotencyKey: "abc-123-xyz" }, deps), { kind: "no_fill" });
    assert.equal(trace.select, 0);
    assert.equal(trace.record, 0);
    assert.equal(trace.replay, 0);
  });

  it("gate error or throw => unavailable (fail closed), nothing selected or charged", async () => {
    for (const gate of [async () => "error" as const, async (): Promise<"eligible"> => { throw new Error("db down"); }]) {
      const { deps, trace } = makeDeps(gate);
      assert.deepEqual(await serveAd(HASH, request, deps), { kind: "unavailable" });
      assert.equal(trace.select, 0);
      assert.equal(trace.record, 0);
    }
  });

  it("unauthorized key never reaches the gate", async () => {
    const { deps, trace } = makeDeps(async () => "eligible");
    deps.authorize = async () => ({ outcome: "unauthorized" });
    assert.deepEqual(await serveAd(HASH, request, deps), { kind: "unauthorized" });
    assert.equal(trace.gate.length, 0);
  });
});

describe("production reader (nakli Supabase)", () => {
  type Rpc = { data: unknown; error: { code?: string } | null };
  const setClient = (result: Rpc | "throw", calls: { name: string; args: unknown }[] = []) => {
    (globalThis as { __TEST_SUPABASE__?: unknown }).__TEST_SUPABASE__ = {
      async rpc(name: string, args: unknown) {
        calls.push({ name, args });
        if (result === "throw") throw new Error("network");
        return result;
      },
    };
  };

  it("asks only get_publisher_country_state with the publisher id; verified country => eligible", async () => {
    const calls: { name: string; args: unknown }[] = [];
    setClient({ data: { country_status: "verified", country_code: "IN" }, error: null }, calls);
    assert.equal(await checkPublisherRegionalEligibility(PUBLISHER_ID), "eligible");
    assert.deepEqual(calls, [{ name: "get_publisher_country_state", args: { p_publisher_id: PUBLISHER_ID } }]);
  });

  it("pending / rejected / missing / non-ISO => ineligible; rpc error / throw / odd shape => error", async () => {
    const original = console.error;
    console.error = () => {};
    try {
      for (const data of [
        { country_status: "pending", country_code: null },
        { country_status: "rejected", country_code: null },
        { country_status: null, country_code: null },
        { country_status: "verified", country_code: "XX" },
      ]) {
        setClient({ data, error: null });
        assert.equal(await checkPublisherRegionalEligibility(PUBLISHER_ID), "ineligible", JSON.stringify(data));
      }
      setClient({ data: null, error: { code: "42883" } });
      assert.equal(await checkPublisherRegionalEligibility(PUBLISHER_ID), "error");
      setClient("throw");
      assert.equal(await checkPublisherRegionalEligibility(PUBLISHER_ID), "error");
      setClient({ data: null, error: null });
      assert.equal(await checkPublisherRegionalEligibility(PUBLISHER_ID), "error");
      assert.equal(regionalGateOutcome(parseCountryStateResult("junk")), "error");
    } finally {
      console.error = original;
    }
  });
});
