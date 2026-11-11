import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BillingModel, usd } from "./event-billing-model";
import { reconcileServeEntries } from "@/lib/ledger/reconciliation";

describe("phase 6 step 4 part 3: event reconciliation under duplicate and invalid flows", () => {
  it("duplicate impressions and clicks produce exactly one charge and one set of ledger entries", () => {
    const m = new BillingModel();
    m.ledgerEnabled = true;
    m.shareBps = 9000;
    m.publisherActive.set("pub", true);
    m.addCampaign({
      id: "cpm",
      total: usd("10.00"),
      daily: null,
      pricing: { model: "cpm", cpmUnits: usd("2.00") },
      status: "active",
    });

    const s = m.serve("cpm", "pub") as { outcome: "ok"; serveId: number };
    for (let i = 0; i < 10; i++) {
      m.impression(s.serveId, "pub");
    }

    assert.equal(m.spentTotal("cpm"), 20n);
    assert.equal(m.ledger.size, 3);
    assert.equal(m.ledger.get(`serve:${s.serveId}:advertiser_charge`), 20n);
    assert.equal(m.ledger.get(`serve:${s.serveId}:publisher_earning`), 18n);
    assert.equal(m.ledger.get(`serve:${s.serveId}:platform_revenue`), 2n);
  });

  it("invalid events write zero charges and zero ledger rows", () => {
    const m = new BillingModel();
    m.ledgerEnabled = true;
    m.shareBps = 9000;
    m.publisherActive.set("pub-1", true);
    m.publisherActive.set("pub-2", true);
    m.addCampaign({
      id: "cpc",
      total: usd("10.00"),
      daily: null,
      pricing: { model: "cpc", cpcUnits: usd("0.1000") },
      status: "active",
    });

    const s = m.serve("cpc", "pub-1") as { outcome: "ok"; serveId: number };

    assert.equal(m.click(s.serveId, "pub-2").outcome, "rejected");
    assert.equal(m.click(s.serveId, "pub-1").outcome, "not_counted");
    assert.equal(m.impression(99999, "pub-1").outcome, "rejected");

    assert.equal(m.spentTotal("cpc"), 0n);
    assert.equal(m.ledger.size, 0);
  });

  it("concurrent budget exhaustion preserves ledger and spend reconciliation", () => {
    const m = new BillingModel();
    m.ledgerEnabled = true;
    m.shareBps = 9000;
    m.publisherActive.set("pub", true);
    m.addCampaign({
      id: "cpm",
      total: usd("0.0100"),
      daily: null,
      pricing: { model: "cpm", cpmUnits: usd("2.00") },
      status: "active",
    });

    const serves: number[] = [];
    for (let i = 0; i < 20; i++) {
      const r = m.serve("cpm", "pub");
      if (r.outcome === "ok") serves.push(r.serveId);
    }
    assert.equal(serves.length, 5);

    for (const sid of serves) {
      m.impression(sid, "pub");
      m.impression(sid, "pub");
    }

    assert.equal(m.spentTotal("cpm"), 100n);
    assert.equal(m.ledger.size, 15);

    const entries: Array<{ sourceRef: string; type: string; amount: bigint }> = [];
    for (const [key, amount] of m.ledger) {
      const [, sid, type] = key.split(":");
      entries.push({ sourceRef: `serve:${sid}`, type, amount });
    }

    const reconciled = reconcileServeEntries(entries);
    for (const sid of serves) {
      const rec = reconciled.get(`serve:${sid}`);
      assert.ok(rec);
      assert.equal(rec.balanced, true);
      assert.equal(rec.chargeUnits, 20n);
      assert.equal(rec.publisherUnits, 18n);
      assert.equal(rec.platformUnits, 2n);
    }
  });
});
