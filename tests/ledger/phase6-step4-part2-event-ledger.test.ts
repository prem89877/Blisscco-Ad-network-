import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BillingModel, usd } from "../ads/event-billing-model";
import { serveChargeUnitsFromCpm } from "@/lib/ledger/decimal";
import { splitCharge } from "@/lib/ledger/revenue-share";

// Phase 6 Step 4 Part 2: ledger ab EVENT par (valid impression / valid click), serve par nahi.
// LIMIT: migration kisi database par chalayi NAHI gayi. Yahan (1) SQL text ki static jaanch hai aur (2) BillingModel
// (tests/ads/event-billing-model.ts, hath se likha aaina) par ledger ke niyam. Asli Postgres rollback / unique-index behaviour ka saboot
// sirf tests/integration/phase6-step4-part2-event-billing-db.test.ts deta hai (TEST database par). Ledger har jagah BAND (default) rehta hai.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const strip = (s: string) => s.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const migration = strip(read("supabase/sql/phase6-step4-part2-event-billing.sql"));
const ledgerService = strip(read("supabase/sql/day-13-4-ledger-service.sql"));

function fnBlock(sql: string, name: string): string {
  const hit = sql.split(/create or replace function /i).slice(1).find((p) => p.trimStart().startsWith(name));
  assert.ok(hit, `${name} must exist`);
  return hit.slice(0, hit.indexOf("\n$$;"));
}

describe("ledger SQL: event-time recording (static)", () => {
  const evt = fnBlock(migration, "private.ledger_record_event(");
  const oldServe = fnBlock(ledgerService, "private.ledger_record_serve(");

  it("ledger stays disabled: the migration never enables it, and a disabled ledger returns before writing anything", () => {
    assert.ok(!/ledger_enabled\s*=\s*true/i.test(migration));
    assert.ok(!/update\s+public\.ledger_settings/i.test(migration));
    assert.ok(!/publisher_share_bps\s*=/i.test(migration));
    assert.ok(/ledger_enabled\s+boolean not null default false/i.test(ledgerService), "day-13-4 default is still false");
    const disabled = evt.indexOf("'disabled'");
    const firstAppend = evt.indexOf("private.ledger_append(");
    assert.ok(disabled > 0 && disabled < firstAppend, "disabled check comes before any ledger_append");
    assert.match(evt, /if v_enabled is not true then/);
  });

  it("serve no longer reaches the ledger at all; only settlement does", () => {
    const serve = fnBlock(migration, "public.record_ad_serve(");
    assert.ok(!/ledger/i.test(serve));
    const settle = fnBlock(migration, "private.settle_event_billing(");
    assert.match(settle, /perform private\.ledger_record_event\(v_serve_ref, v_res\.campaign_id, v_res\.publisher_id, v_res\.amount, p_event_type\)/);
    // Impression / click functions ledger ko seedha nahi bulate: sirf settlement ke zariye.
    for (const f of ["public.record_ad_impression(", "public.record_ad_click("]) {
      assert.ok(!/ledger_record_event|ledger_append/.test(fnBlock(migration, f)), `${f} must not write the ledger directly`);
    }
    assert.ok(!/ledger_record_serve\(/.test(migration), "the old serve-time ledger hook is not called anywhere in the new migration");
  });

  it("keeps the exact idempotency keys and entry types of the old serve-time ledger (one charge entry per serve, forever)", () => {
    for (const key of ["advertiser_charge", "publisher_earning", "platform_revenue"]) {
      const k = `'serve:' || p_serve_ref || ':${key}'`;
      assert.ok(evt.includes(k), `event ledger key for ${key}`);
      assert.ok(oldServe.includes(k), `old serve ledger used the same key for ${key}`);
    }
    assert.match(evt, /'serve', p_serve_ref/);
    assert.match(read("supabase/sql/day-13-1-financial-ledger.sql"), /\(source_ref, entry_type\)\s*\n?\s*where source_type = 'serve'/);
  });

  it("amount comes from the settlement (trusted reservation), event type is validated, serve_ref is mandatory when ON", () => {
    assert.match(evt, /p_event_type not in \('impression', 'click'\)/);
    assert.match(evt, /p_serve_ref !~ '\^bsr_\[0-9a-f\]\{40\}\$'/);
    assert.match(evt, /ledger_serve_ref_missing/);
    assert.ok(!/client|request|header/i.test(evt));
  });

  it("publisher share math is the same truncate-then-remainder rule as before (no float, sum always equals the charge)", () => {
    assert.match(evt, /v_pub_amt\s+:= trunc\(\(p_amount \* v_bps\) \/ 10000, 4\)/);
    assert.match(evt, /v_plat_amt := p_amount - v_pub_amt/);
    assert.match(oldServe, /v_pub_amt\s+:= trunc\(\(p_amount \* v_bps\) \/ 10000, 4\)/);
  });

  it("the ledger function is not callable by any app role and the old ledger_append / reversal API is unchanged", () => {
    assert.ok(migration.includes("revoke all on function private.ledger_record_event(text, uuid, uuid, numeric, text) from public, anon, authenticated, service_role;"));
    assert.ok(!/create or replace function private\.ledger_append/i.test(migration));
    assert.ok(!/create or replace function public\.ledger_(reverse_entry|add_adjustment)/i.test(migration));
    assert.ok(!/create or replace function private\.ledger_reverse\b/i.test(migration));
  });
});

describe("ledger model: charge is written once, at the billable event", () => {
  const cpc = { model: "cpc", cpcUnits: usd("0.0150") } as const;

  function ledgerWorld(pricing: { model: "cpm"; cpmUnits: bigint } | { model: "cpc"; cpcUnits: bigint }): { m: BillingModel; serveId: number } {
    const m = new BillingModel();
    m.publisherActive.set("pub", true);
    m.addCampaign({ id: "c", total: usd("5.00"), daily: null, pricing, status: "active" });
    const r = m.serve("c", "pub");
    assert.equal(r.outcome, "ok");
    return { m, serveId: r.outcome === "ok" ? r.serveId : -1 };
  }

  it("ledger disabled (default): spend moves on the event but the ledger stays completely empty", () => {
    const { m, serveId } = ledgerWorld({ model: "cpm", cpmUnits: usd("2.00") });
    assert.equal(m.ledgerEnabled, false);
    m.impression(serveId, "pub");
    assert.equal(m.spentTotal("c"), 20n);
    assert.equal(m.ledger.size, 0);
  });

  it("ledger enabled: serving writes nothing; a CPM impression writes the charge exactly once", () => {
    const { m, serveId } = ledgerWorld({ model: "cpm", cpmUnits: usd("2.00") });
    m.ledgerEnabled = true;
    assert.equal(m.ledger.size, 0, "serve = no ledger entry");
    m.impression(serveId, "pub");
    m.impression(serveId, "pub");
    m.impression(serveId, "pub");
    assert.equal(m.ledger.size, 1);
    assert.equal(m.ledger.get(`serve:${serveId}:advertiser_charge`), 20n);
  });

  it("ledger enabled: a CPC campaign writes at the click, never at the impression, and the CPM click writes nothing", () => {
    const a = ledgerWorld(cpc);
    a.m.ledgerEnabled = true;
    a.m.impression(a.serveId, "pub");
    assert.equal(a.m.ledger.size, 0);
    a.m.click(a.serveId, "pub");
    a.m.click(a.serveId, "pub");
    assert.equal(a.m.ledger.size, 1);
    assert.equal(a.m.ledger.get(`serve:${a.serveId}:advertiser_charge`), usd("0.0150"));

    const b = ledgerWorld({ model: "cpm", cpmUnits: usd("2.00") });
    b.m.ledgerEnabled = true;
    b.m.impression(b.serveId, "pub");
    const before = b.m.ledger.size;
    b.m.click(b.serveId, "pub");
    assert.equal(b.m.ledger.size, before, "CPM click adds no ledger entry");
  });

  it("with a revenue share set, publisher + platform entries always add up to the advertiser charge", () => {
    for (const bps of [0, 1, 3333, 7000, 9999, 10_000]) {
      for (const cpm of ["0.10", "1.37", "2.00", "999.9999"]) {
        const { m, serveId } = ledgerWorld({ model: "cpm", cpmUnits: usd(cpm) });
        m.ledgerEnabled = true;
        m.shareBps = bps;
        m.impression(serveId, "pub");
        const charge = m.ledger.get(`serve:${serveId}:advertiser_charge`);
        assert.equal(charge, serveChargeUnitsFromCpm(usd(cpm)));
        const pub = m.ledger.get(`serve:${serveId}:publisher_earning`) ?? 0n;
        const plat = m.ledger.get(`serve:${serveId}:platform_revenue`) ?? 0n;
        assert.equal(pub + plat, charge, `bps ${bps}, cpm ${cpm}`);
        const split = splitCharge(charge!, bps);
        assert.equal(pub, split.publisherUnits, "model split == lib/ledger/revenue-share split");
        assert.equal(plat, split.platformUnits);
      }
    }
  });

  it("duplicate / invalid / expired / not_counted events write no ledger entry", () => {
    const { m, serveId } = ledgerWorld(cpc);
    m.ledgerEnabled = true;
    assert.equal(m.click(serveId, "pub").outcome, "not_counted");
    assert.equal(m.click(serveId, "other").outcome, "rejected");
    m.impression(serveId, "pub");
    m.nowMs += 24 * 3_600_000;
    assert.equal(m.click(serveId, "pub").outcome, "rejected");
    assert.equal(m.ledger.size, 0);
    assert.equal(m.totalSpentAll(), 0n);
  });

  it("if the ledger write fails, the event, the spend and the ledger all roll back together; retry then succeeds", () => {
    const { m, serveId } = ledgerWorld({ model: "cpm", cpmUnits: usd("2.00") });
    m.ledgerEnabled = true;
    m.failLedger = true;
    assert.throws(() => m.impression(serveId, "pub"), /ledger failed/);
    assert.equal(m.eventCount(), 0);
    assert.equal(m.totalSpentAll(), 0n);
    assert.equal(m.ledger.size, 0);
    assert.equal(m.reservationOf(serveId)?.status, "held");
    m.failLedger = false;
    assert.equal(m.impression(serveId, "pub").billed, true);
    assert.equal(m.ledger.size, 1);
    assert.equal(m.totalSpentAll(), 20n, "spend == ledger charge: one source, one amount");
  });

  it("legacy serves (charged at serve time before the migration) never get a second ledger entry from an event", () => {
    const m = new BillingModel();
    m.publisherActive.set("pub", true);
    m.addCampaign({ id: "c", total: usd("5.00"), daily: null, pricing: { model: "cpm", cpmUnits: usd("2.00") }, status: "active" });
    const legacy = m.addLegacyServe("c", "pub");
    m.ledgerEnabled = true;
    assert.equal(m.impression(legacy, "pub").billed, false);
    assert.equal(m.ledger.size, 0);
  });

  it("enabling the ledger between serve and event is safe: the charge simply lands at the event", () => {
    const { m, serveId } = ledgerWorld({ model: "cpm", cpmUnits: usd("2.00") });
    m.ledgerEnabled = false;
    m.ledgerEnabled = true; // alag, jaan-boojh kar diya gaya kadam (yahan sirf model me)
    m.impression(serveId, "pub");
    assert.equal(m.ledger.size, 1);
  });
});
