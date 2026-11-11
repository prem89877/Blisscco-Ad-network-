import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BillingModel, usd } from "../ads/event-billing-model";
import { reconcileServeEntries, reconcileSplit } from "@/lib/ledger/reconciliation";

describe("phase 6 step 4 part 3: ledger reconciliation with 9000 shareBps", () => {
  function createWorld() {
    const m = new BillingModel();
    m.publisherActive.set("pub-1", true);
    m.publisherActive.set("pub-2", true);
    m.shareBps = 9000;
    m.addCampaign({
      id: "cpm-camp",
      total: usd("5.00"),
      daily: null,
      pricing: { model: "cpm", cpmUnits: usd("2.00") },
      status: "active",
    });
    m.addCampaign({
      id: "cpc-camp",
      total: usd("5.00"),
      daily: null,
      pricing: { model: "cpc", cpcUnits: usd("0.1234") },
      status: "active",
    });
    return m;
  }

  it("ledger disabled (default): 9000 shareBps does not enable it, spend moves, ledger stays empty", () => {
    const m = createWorld();
    assert.equal(m.ledgerEnabled, false);
    const s = m.serve("cpm-camp", "pub-1");
    assert.equal(s.outcome, "ok");
    m.impression((s as { serveId: number }).serveId, "pub-1");
    assert.equal(m.spentTotal("cpm-camp"), 20n);
    assert.equal(m.ledger.size, 0);
  });

  it("ledger enabled: CPM impression and CPC click reconcile exactly at 90/10", () => {
    const m = createWorld();
    m.ledgerEnabled = true;

    const s1 = m.serve("cpm-camp", "pub-1") as { outcome: "ok"; serveId: number };
    m.impression(s1.serveId, "pub-1");

    const cpmCharge = m.ledger.get(`serve:${s1.serveId}:advertiser_charge`);
    const cpmPub = m.ledger.get(`serve:${s1.serveId}:publisher_earning`);
    const cpmPlat = m.ledger.get(`serve:${s1.serveId}:platform_revenue`);

    assert.equal(cpmCharge, 20n);
    assert.equal(cpmPub, 18n);
    assert.equal(cpmPlat, 2n);
    assert.equal(cpmPub! + cpmPlat!, cpmCharge);

    const s2 = m.serve("cpc-camp", "pub-2") as { outcome: "ok"; serveId: number };
    m.impression(s2.serveId, "pub-2");
    assert.equal(m.ledger.has(`serve:${s2.serveId}:advertiser_charge`), false);

    m.click(s2.serveId, "pub-2");
    const cpcCharge = m.ledger.get(`serve:${s2.serveId}:advertiser_charge`);
    const cpcPub = m.ledger.get(`serve:${s2.serveId}:publisher_earning`);
    const cpcPlat = m.ledger.get(`serve:${s2.serveId}:platform_revenue`);

    assert.equal(cpcCharge, 1234n);
    assert.equal(cpcPub, 1110n);
    assert.equal(cpcPlat, 124n);
    assert.equal(cpcPub! + cpcPlat!, cpcCharge);
  });

  it("reconciliation pure module correctly detects balanced and unbalanced entries", () => {
    const entries = [
      { sourceRef: "bsr_01", type: "advertiser_charge", amount: 20n },
      { sourceRef: "bsr_01", type: "publisher_earning", amount: 18n },
      { sourceRef: "bsr_01", type: "platform_revenue", amount: 2n },

      { sourceRef: "bsr_02", type: "advertiser_charge", amount: 100n },
      { sourceRef: "bsr_02", type: "publisher_earning", amount: 80n },
      { sourceRef: "bsr_02", type: "platform_revenue", amount: 10n },

      { sourceRef: "bsr_03", type: "publisher_earning", amount: 50n },

      { sourceRef: "bsr_04", type: "advertiser_charge", amount: 20n },
      { sourceRef: "bsr_04", type: "advertiser_charge", amount: 20n },
    ];

    const results = reconcileServeEntries(entries);

    assert.equal(results.get("bsr_01")?.balanced, true);
    assert.equal(results.get("bsr_01")?.reason, "ok");

    assert.equal(results.get("bsr_02")?.balanced, false);
    assert.equal(results.get("bsr_02")?.reason, "split_mismatch");

    assert.equal(results.get("bsr_03")?.balanced, false);
    assert.equal(results.get("bsr_03")?.reason, "missing_charge");

    assert.equal(results.get("bsr_04")?.balanced, false);
    assert.equal(results.get("bsr_04")?.reason, "duplicate_charge");
  });

  it("segregates reversals and adjustments without affecting serve event balance", () => {
    const entries = [
      { sourceRef: "bsr_10", type: "advertiser_charge", amount: 20n },
      { sourceRef: "bsr_10", type: "publisher_earning", amount: 18n },
      { sourceRef: "bsr_10", type: "platform_revenue", amount: 2n },
      { sourceRef: "bsr_10", type: "reversal", amount: -18n },
      { sourceRef: "bsr_10", type: "adjustment", amount: 5n },
    ];

    const results = reconcileServeEntries(entries);
    const r = results.get("bsr_10");
    assert.ok(r);
    assert.equal(r.balanced, true);
    assert.equal(r.reversalsCount, 1);
    assert.equal(r.reversalsTotalUnits, -18n);
    assert.equal(r.adjustmentsCount, 1);
    assert.equal(r.adjustmentsTotalUnits, 5n);
  });

  it("forced ledger failure rolls back event, settlement and spend together", () => {
    const m = createWorld();
    m.ledgerEnabled = true;
    m.failLedger = true;

    const s = m.serve("cpm-camp", "pub-1") as { outcome: "ok"; serveId: number };
    assert.throws(() => m.impression(s.serveId, "pub-1"), /ledger failed/);

    assert.equal(m.spentTotal("cpm-camp"), 0n);
    assert.equal(m.eventCount("impression"), 0);
    assert.equal(m.ledger.size, 0);

    m.failLedger = false;
    const retry = m.impression(s.serveId, "pub-1");
    assert.equal(retry.billed, true);
    assert.equal(m.spentTotal("cpm-camp"), 20n);
    assert.equal(m.ledger.size, 3);
  });
});
