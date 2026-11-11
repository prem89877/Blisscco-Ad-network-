import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BillingModel, DAY_MS, HOLD_MS, usd, utcDay, type ModelCampaign } from "./event-billing-model";

// Phase 6 Step 4 Part 2: valid impression / valid click billing.
// Do tarah ke tests:
//   (1) SQL ki STATIC jaanch: migration file ka text padhkar (kaun si statement hai / kaun si nahi, kis order me).
//   (2) MODEL tests: BillingModel (tests/ads/event-billing-model.ts) migration ke algorithm ka hath se likha aaina hai.
// LIMIT: migration kisi database par CHALAYI NAHI gayi. (1) sirf text jaanchta hai, (2) sirf model ka niyam jaanchta hai;
// dono Postgres ke asli locks / constraints / rollback ka saboot NAHI hain. Wo tests/integration/phase6-step4-part2-event-billing-db.test.ts
// (TEST database par, aapke chalane par) jaanchta hai.

const ROOT = path.join(__dirname, "..", "..", "..");
const MIGRATION = "supabase/sql/phase6-step4-part2-event-billing.sql";
const rawSql = readFileSync(path.join(ROOT, MIGRATION), "utf8");
/** Comments hata kar (-- se line ke ant tak) sirf asli statements. */
const sql = rawSql
  .split("\n")
  .map((l) => l.replace(/--.*$/, ""))
  .join("\n");

function fnBlock(name: string): string {
  const parts = sql.split(/create or replace function /i).slice(1);
  const hit = parts.find((p) => p.trimStart().startsWith(name));
  assert.ok(hit, `function ${name} must be defined in the migration`);
  const end = hit.indexOf("\n$$;");
  assert.ok(end > 0, `function ${name} body must end with $$;`);
  return hit.slice(0, end);
}

describe("phase 6 step 4 part 2: migration shape (static SQL checks)", () => {
  it("is one forward-only transaction and drops / deletes / rewrites nothing", () => {
    assert.equal((sql.match(/^begin;/gim) ?? []).length, 1);
    assert.equal((sql.match(/^commit;/gim) ?? []).length, 1);
    assert.ok(!/\bdrop\s+(table|column|schema|function|constraint)\b/i.test(sql), "no drop table/column/function/constraint");
    assert.ok(!/\btruncate\b/i.test(sql));
    assert.ok(!/\bdelete\s+from\b/i.test(sql));
    assert.ok(!/\balter\s+table\b[^;]*\bdrop\b/i.test(sql));
    // Spend me sirf EK jagah likha jaata hai: settlement function (values ke saath). Koi backfill / insert-select nahi.
    const spendWrites = sql.match(/insert\s+into\s+public\.campaign_spend_daily/gi) ?? [];
    assert.equal(spendWrites.length, 1, "exactly one writer of campaign_spend_daily");
    assert.ok(fnBlock("private.settle_event_billing(").includes("insert into public.campaign_spend_daily"), "and it is the settlement function");
    assert.ok(!/update\s+public\.campaign_spend_daily/i.test(sql));
  });

  it("does not turn the ledger on and does not touch ledger_settings", () => {
    assert.ok(!/ledger_enabled\s*=\s*true/i.test(sql));
    assert.ok(!/update\s+public\.ledger_settings/i.test(sql));
    assert.ok(!/insert\s+into\s+public\.ledger_settings/i.test(sql));
    assert.ok(!/publisher_share_bps\s*=/i.test(sql));
  });

  it("keeps the migration prerequisites and untouched pieces untouched", () => {
    // Existing tracking security + serve refs + dedupe: in functions ko ye migration dobara define nahi karta.
    for (const untouched of ["replay_serve", "find_idempotent_serve", "lookup_serve_for_event", "lookup_serve_for_click", "click_target", "guard_ad_event", "purge_old_ad_logs", "load_ad_candidates"]) {
      assert.ok(!new RegExp(`create or replace function [a-z_.]*${untouched}\\b`, "i").test(sql), `${untouched} must not be redefined`);
    }
    // 4-arg record_ad_serve (retry wrapper) bhi nahi: sirf 3-arg.
    const serve = fnBlock("public.record_ad_serve(");
    assert.ok(!/p_idempotency_key/i.test(serve));
    assert.ok(!/alter\s+table\s+public\.ad_events/i.test(sql));
    assert.ok(!/alter\s+table\s+public\.ad_serve_log/i.test(sql));
    assert.ok(!/alter\s+table\s+public\.ad_serve_requests/i.test(sql));
    assert.ok(/ad_events_one_per_type_key/.test(sql), "dedupe constraint is still the one used by the event writers");
  });

  it("adds a locked-down reservation table (RLS on, no grants, cascade with serve log, one row per serve)", () => {
    assert.ok(/create table if not exists public\.ad_budget_reservations/i.test(sql));
    assert.ok(/serve_id\s+bigint\s+primary key references public\.ad_serve_log \(id\) on delete cascade/i.test(sql));
    assert.ok(/alter table public\.ad_budget_reservations enable row level security/i.test(sql));
    assert.ok(/revoke all on table public\.ad_budget_reservations from public, anon, authenticated, service_role/i.test(sql));
    assert.ok(!/grant\s+[a-z, ]+\s+on\s+(table\s+)?public\.ad_budget_reservations/i.test(sql), "no grant on the reservation table");
    assert.ok(/amount\s+numeric\(12, 4\)/i.test(sql), "exact decimal money, never float");
    assert.ok(!/\b(float|double precision|real)\b/i.test(sql));
    assert.match(sql, /status in \('held', 'settled', 'released'\)/);
    assert.match(sql, /pricing_model = 'cpm' and billed_event_type = 'impression'/);
    assert.match(sql, /pricing_model = 'cpc' and billed_event_type = 'click'/);
  });

  it("reservation rows only move held -> settled/released and keep amount, model and dates immutable", () => {
    const g = fnBlock("private.guard_budget_reservation()");
    assert.match(g, /old\.status <> 'held'/);
    assert.match(g, /new\.status not in \('settled', 'released'\)/);
    assert.match(g, /new\.amount/);
    assert.match(g, /is distinct from/);
    assert.match(sql, /create trigger ad_budget_reservations_guard\s+before update on public\.ad_budget_reservations/i);
  });

  it("every new or replaced public RPC is service_role only and security definer with an empty search_path", () => {
    const rpcs: [string, string][] = [
      ["public.record_ad_serve(", "public.record_ad_serve(text, uuid, text)"],
      ["public.record_ad_impression(", "public.record_ad_impression(text, uuid)"],
      ["public.record_ad_click(", "public.record_ad_click(text, uuid, uuid)"],
      ["public.release_expired_budget_reservations(", "public.release_expired_budget_reservations(integer)"],
    ];
    for (const [head, sig] of rpcs) {
      const b = fnBlock(head);
      assert.match(b, /security definer/);
      assert.match(b, /set search_path = ''/);
      assert.ok(sql.includes(`revoke all on function ${sig} from public, anon, authenticated;`), `revoke for ${sig}`);
      assert.ok(sql.includes(`grant execute on function ${sig} to service_role;`), `grant for ${sig}`);
      assert.ok(!new RegExp(`grant execute on function ${sig.replace(/[()]/g, "\\$&")} to (anon|authenticated|public)`, "i").test(sql));
    }
    for (const sig of ["private.settle_event_billing(bigint, text)", "private.ledger_record_event(text, uuid, uuid, numeric, text)", "private.guard_budget_reservation()"]) {
      assert.ok(sql.includes(`revoke all on function ${sig} from public, anon, authenticated, service_role;`), `private ${sig} must have no grants`);
    }
  });
});

describe("phase 6 step 4 part 2: serve reserves budget and never charges (static SQL)", () => {
  const serve = fnBlock("public.record_ad_serve(");

  it("record_ad_serve does not write spend and does not call the ledger", () => {
    assert.ok(!/campaign_spend_daily\s*\(/i.test(serve.replace(/from public\.campaign_spend_daily/gi, "")), "no INSERT into campaign_spend_daily");
    assert.ok(!/insert\s+into\s+public\.campaign_spend_daily/i.test(serve));
    assert.ok(!/update\s+public\.campaign_spend_daily/i.test(serve));
    assert.ok(!/ledger/i.test(serve), "serve must not touch the ledger");
  });

  it("checks spent + held + amount against total AND daily budget, under the campaign row lock", () => {
    assert.match(serve, /for update of c;/);
    assert.match(serve, /v_spent_total \+ v_held_total \+ v_amount > v_total/);
    assert.match(serve, /v_spent_today \+ v_held_today \+ v_amount > v_daily/);
    assert.match(serve, /r\.status = 'held' and r\.expires_at > now\(\)/);
    assert.match(serve, /r\.reserve_day = v_today/);
    // lock reservation sums se PEHLE hai
    assert.ok(serve.indexOf("for update of c;") < serve.indexOf("into v_held_total"));
  });

  it("reads pricing from the campaign row (never a parameter) and snapshots the amount into the reservation", () => {
    assert.ok(!/p_amount|p_price|p_rate|p_cpm|p_cpc/i.test(serve), "no money parameter");
    assert.match(serve, /c\.pricing_model, c\.cpm_rate_usd, c\.cpc_rate_usd/);
    assert.match(serve, /v_amount := v_cpc_rate/);
    assert.match(serve, /greatest\(round\(v_cpm \/ 1000\.0, 4\), 0\.0001\)/);
    assert.match(serve, /ad_platform_settings/, "campaigns without pricing keep the platform CPM");
    assert.match(serve, /insert into public\.ad_budget_reservations/i);
    assert.match(serve, /v_served_at \+ interval '24 hours'/);
  });

  it("publisher identity still comes only from the hashed API key", () => {
    assert.match(serve, /from public\.publisher_api_keys k/);
    assert.match(serve, /k\.key_hash = p_key_hash/);
    assert.ok(!/p_publisher_id/.test(serve));
  });

  it("UTC rules: days are UTC dates, never current_date or session time", () => {
    assert.ok(!/\bcurrent_date\b/i.test(sql));
    assert.ok(!/\blocaltimestamp\b|\bcurrent_timestamp\b/i.test(sql));
    for (const name of ["public.record_ad_serve(", "private.guard_campaign_budget()"]) {
      const b = fnBlock(name);
      if (/_today|v_today/.test(b)) assert.match(b, /\(now\(\) at time zone 'utc'\)::date/);
    }
    assert.match(serve, /v_today\s+date := \(now\(\) at time zone 'utc'\)::date/);
  });
});

describe("phase 6 step 4 part 2: impression / click writers settle in the same transaction (static SQL)", () => {
  const imp = fnBlock("public.record_ad_impression(");
  const clk = fnBlock("public.record_ad_click(");
  const settle = fnBlock("private.settle_event_billing(");

  it("signatures are unchanged and take no amount or campaign from the caller", () => {
    assert.ok(imp.startsWith("public.record_ad_impression(p_serve_ref text, p_publisher_id uuid)"));
    assert.ok(clk.startsWith("public.record_ad_click(p_serve_ref text, p_publisher_id uuid, p_creative_id uuid)"));
    for (const b of [imp, clk]) {
      assert.ok(!/p_amount|p_price|p_campaign|p_cpm|p_cpc/i.test(b));
      assert.match(b, /from public\.ad_serve_log s/);
    }
  });

  it("impression: event insert uses the existing unique constraint, duplicate returns before any billing", () => {
    assert.match(imp, /on conflict on constraint ad_events_one_per_type_key do nothing/);
    const dup = imp.indexOf("'duplicate'");
    const bill = imp.indexOf("settle_event_billing");
    assert.ok(dup > 0 && bill > 0 && dup < bill, "duplicate branch comes before settlement");
    assert.ok(imp.indexOf("insert into public.ad_events") < bill, "settlement only after the event row exists");
    assert.match(imp, /settle_event_billing\(v_serve_id, 'impression'\)/);
    assert.match(imp, /now\(\) >= v_served_at \+ interval '24 hours'/);
  });

  it("click: ineligible / not_counted / duplicate all return before billing; D4 impression check is kept", () => {
    const bill = clk.indexOf("settle_event_billing");
    for (const early of ["'ineligible'", "'not_counted'", "'duplicate'", "'rejected'"]) {
      assert.ok(clk.indexOf(early) > 0 && clk.indexOf(early) < bill, `${early} before billing`);
    }
    assert.match(clk, /e\.event_type = 'impression'/);
    assert.match(clk, /private\.click_target\(v_creative\)/);
    assert.match(clk, /settle_event_billing\(v_serve_id, 'click'\)/);
    assert.match(clk, /on conflict on constraint ad_events_one_per_type_key do nothing/);
    assert.match(clk, /now\(\) >= v_served_at \+ interval '24 hours'/);
  });

  it("the billing call is not wrapped in an exception handler (an error must roll the event back)", () => {
    for (const b of [imp, clk, settle]) {
      assert.ok(!/exception\s+when/i.test(b), "no 'exception when' swallowing errors");
    }
  });

  it("settlement: campaign lock first, then reservation lock, guarded by status, expiry and model/event match", () => {
    const campLock = settle.indexOf("from public.campaigns c where c.id = v_res.campaign_id for update");
    const resLock = settle.indexOf("where r.serve_id = p_serve_id for update");
    assert.ok(campLock > 0 && resLock > campLock, "campaign lock before reservation lock (same order as record_ad_serve)");
    assert.match(settle, /v_res\.pricing_model = 'cpm' and p_event_type <> 'impression'/);
    assert.match(settle, /v_res\.pricing_model = 'cpc' and p_event_type <> 'click'/);
    assert.match(settle, /'legacy_serve'/);
    assert.match(settle, /v_res\.status = 'settled'/);
    assert.match(settle, /v_res\.expires_at <= now\(\)/);
    assert.match(settle, /where r\.serve_id = p_serve_id and r\.status = 'held'/);
  });

  it("settlement charges the reservation snapshot on the serve's UTC day and only then calls the ledger", () => {
    assert.match(settle, /values \(v_res\.campaign_id, v_res\.reserve_day, v_res\.amount\)/);
    assert.match(settle, /on conflict \(campaign_id, day\)/);
    assert.ok(!/p_amount/.test(settle));
    const spend = settle.indexOf("insert into public.campaign_spend_daily");
    const ledger = settle.indexOf("private.ledger_record_event(");
    assert.ok(spend > 0 && ledger > spend);
    assert.match(settle, /v_res\.publisher_id/, "publisher comes from the trusted reservation row");
  });

  it("budget guards also count live holds (total_budget edit and resume/approve checks)", () => {
    const g = fnBlock("private.guard_campaign_budget()");
    assert.match(g, /ad_budget_reservations/);
    assert.match(g, /new\.total_budget < v_spent \+ v_held/);
    assert.match(g, /for update/);
    const a = fnBlock("private.campaign_can_afford_serve(");
    assert.match(a, /ad_budget_reservations/);
    assert.match(a, /\(v_total - v_spent - v_held\) >= v_unit/);
    assert.match(a, /private\.is_admin\(\)/, "authorization part of the old function is kept");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// MODEL tests
// ---------------------------------------------------------------------------------------------------------------
const PUB = "pub-1";
const PUB_2 = "pub-2";

function world(over: Partial<ModelCampaign> & { id?: string } = {}): { m: BillingModel; cid: string } {
  const m = new BillingModel();
  const cid = over.id ?? "camp-1";
  m.addCampaign({ id: cid, total: usd("1.00"), daily: null, pricing: { model: "cpm", cpmUnits: usd("2.00") }, status: "active", ...over });
  m.publisherActive.set(PUB, true);
  m.publisherActive.set(PUB_2, true);
  return { m, cid };
}
const serveOk = (m: BillingModel, cid: string, pub = PUB): number => {
  const r = m.serve(cid, pub);
  assert.equal(r.outcome, "ok");
  return r.outcome === "ok" ? r.serveId : -1;
};

describe("model: serving and API responses never charge", () => {
  it("many serves create holds but zero spend, zero events, zero ledger", () => {
    const { m, cid } = world();
    for (let i = 0; i < 20; i += 1) serveOk(m, cid);
    assert.equal(m.totalSpentAll(), 0n);
    assert.equal(m.eventCount(), 0);
    assert.equal(m.ledger.size, 0);
    assert.equal(m.heldTotal(cid), 20n * 20n); // 20 serves x $0.0020
  });

  it("a rejected serve (inactive publisher, paused campaign, unknown campaign) creates nothing", () => {
    const { m, cid } = world();
    m.publisherActive.set(PUB, false);
    assert.equal(m.serve(cid, PUB).outcome, "rejected");
    m.publisherActive.set(PUB, true);
    m.campaigns.get(cid)!.status = "paused";
    assert.equal(m.serve(cid, PUB).outcome, "rejected");
    assert.equal(m.serve("nope", PUB).outcome, "rejected");
    assert.equal(m.heldTotal(cid), 0n);
    assert.equal(m.totalSpentAll(), 0n);
  });
});

describe("model: CPM charges only on the first valid impression", () => {
  it("impression charges exactly CPM/1000 once; the second impression is a duplicate and free", () => {
    const { m, cid } = world();
    const s = serveOk(m, cid);
    const a = m.impression(s, PUB);
    assert.deepEqual(a, { outcome: "recorded", billed: true });
    assert.equal(m.spentTotal(cid), 20n); // $0.0020
    const b = m.impression(s, PUB);
    assert.deepEqual(b, { outcome: "duplicate", billed: false });
    assert.equal(m.spentTotal(cid), 20n);
    assert.equal(m.heldTotal(cid), 0n, "hold became spend (not double counted)");
    assert.equal(m.reservationOf(s)?.status, "settled");
  });

  it("a CPM click is recorded but never charged (and a repeat click is a duplicate)", () => {
    const { m, cid } = world();
    const s = serveOk(m, cid);
    m.impression(s, PUB);
    const spentAfterImpression = m.spentTotal(cid);
    assert.deepEqual(m.click(s, PUB), { outcome: "recorded", billed: false });
    assert.deepEqual(m.click(s, PUB), { outcome: "duplicate", billed: false });
    assert.equal(m.spentTotal(cid), spentAfterImpression);
  });

  it("campaign without pricing (legacy null) uses the platform CPM", () => {
    const { m, cid } = world({ pricing: { model: null } });
    m.platformCpmUnits = usd("5.00");
    const s = serveOk(m, cid);
    m.impression(s, PUB);
    assert.equal(m.spentTotal(cid), 50n); // 5.00 / 1000 = 0.0050
  });

  it("tiny CPM is floored at one unit ($0.0001); campaign CPM overrides the platform CPM", () => {
    const { m, cid } = world({ pricing: { model: "cpm", cpmUnits: usd("0.10") } });
    m.platformCpmUnits = usd("500.00");
    m.impression(serveOk(m, cid), PUB);
    assert.equal(m.spentTotal(cid), 1n);
  });
});

describe("model: CPC charges only on the first valid click", () => {
  const cpc = { model: "cpc", cpcUnits: usd("0.0150") } as const;

  it("an impression on a CPC campaign is free; the first click after it charges the CPC rate once", () => {
    const { m, cid } = world({ pricing: cpc });
    const s = serveOk(m, cid);
    assert.deepEqual(m.impression(s, PUB), { outcome: "recorded", billed: false });
    assert.equal(m.spentTotal(cid), 0n);
    assert.deepEqual(m.click(s, PUB), { outcome: "recorded", billed: true });
    assert.equal(m.spentTotal(cid), usd("0.0150"));
    assert.deepEqual(m.click(s, PUB), { outcome: "duplicate", billed: false });
    assert.equal(m.spentTotal(cid), usd("0.0150"));
  });

  it("a click without a prior impression is not_counted: no event, no charge; it counts after the impression arrives", () => {
    const { m, cid } = world({ pricing: cpc });
    const s = serveOk(m, cid);
    assert.deepEqual(m.click(s, PUB), { outcome: "not_counted", billed: false });
    assert.equal(m.eventCount("click"), 0);
    assert.equal(m.spentTotal(cid), 0n);
    m.impression(s, PUB);
    assert.deepEqual(m.click(s, PUB), { outcome: "recorded", billed: true });
  });

  it("a click on a paused / ended campaign is ineligible and free", () => {
    const { m, cid } = world({ pricing: cpc });
    const s = serveOk(m, cid);
    m.impression(s, PUB);
    m.campaigns.get(cid)!.status = "paused";
    assert.deepEqual(m.click(s, PUB), { outcome: "ineligible", billed: false });
    assert.equal(m.spentTotal(cid), 0n);
  });

  it("the rate is a snapshot of serve time: a later rate change does not change the charge", () => {
    const { m, cid } = world({ pricing: cpc });
    const s = serveOk(m, cid);
    m.impression(s, PUB);
    m.campaigns.get(cid)!.pricing = { model: "cpc", cpcUnits: usd("0.9000") };
    m.click(s, PUB);
    assert.equal(m.spentTotal(cid), usd("0.0150"));
  });
});

describe("model: CPM / CPC separation across campaigns", () => {
  it("CPM and CPC campaigns side by side bill only on their own event", () => {
    const m = new BillingModel();
    m.publisherActive.set(PUB, true);
    m.addCampaign({ id: "cpm", total: usd("1.00"), daily: null, pricing: { model: "cpm", cpmUnits: usd("2.00") }, status: "active" });
    m.addCampaign({ id: "cpc", total: usd("1.00"), daily: null, pricing: { model: "cpc", cpcUnits: usd("0.0500") }, status: "active" });
    const a = serveOk(m, "cpm");
    const b = serveOk(m, "cpc");
    m.impression(a, PUB);
    m.impression(b, PUB);
    assert.equal(m.spentTotal("cpm"), 20n);
    assert.equal(m.spentTotal("cpc"), 0n);
    m.click(a, PUB);
    m.click(b, PUB);
    assert.equal(m.spentTotal("cpm"), 20n, "CPM click free");
    assert.equal(m.spentTotal("cpc"), usd("0.0500"), "CPC click charged");
    assert.equal(m.reservationOf(a)?.billedEvent, "impression");
    assert.equal(m.reservationOf(b)?.billedEvent, "click");
  });
});

describe("model: invalid events never create charges", () => {
  it("unknown serve, wrong publisher, and legacy (pre-migration) serves are all free", () => {
    const { m, cid } = world();
    const s = serveOk(m, cid);
    assert.equal(m.impression(9999, PUB).outcome, "rejected");
    assert.equal(m.impression(s, PUB_2).outcome, "rejected");
    assert.equal(m.click(s, PUB_2).outcome, "rejected");
    assert.equal(m.click(s, PUB, false).outcome, "rejected", "claimed creative/campaign mismatch");
    assert.equal(m.totalSpentAll(), 0n);
    const legacy = m.addLegacyServe(cid, PUB);
    assert.deepEqual(m.impression(legacy, PUB), { outcome: "recorded", billed: false });
    assert.equal(m.totalSpentAll(), 0n, "legacy serve was charged at serve time already");
  });

  it("an inactive publisher's valid-looking impression is recorded but not billed, and cannot be billed later", () => {
    const { m, cid } = world();
    const s = serveOk(m, cid);
    m.publisherActive.set(PUB, false);
    assert.deepEqual(m.impression(s, PUB), { outcome: "recorded", billed: false });
    m.publisherActive.set(PUB, true);
    assert.deepEqual(m.impression(s, PUB), { outcome: "duplicate", billed: false });
    assert.equal(m.totalSpentAll(), 0n);
  });
});

describe("model: expired events and holds", () => {
  it("an impression at exactly 24h or later is rejected and free; the hold stops counting", () => {
    const { m, cid } = world();
    const s = serveOk(m, cid);
    m.nowMs += HOLD_MS - 1;
    assert.equal(m.heldTotal(cid), 20n, "still live 1ms before expiry");
    m.nowMs += 1;
    assert.equal(m.heldTotal(cid), 0n, "expired hold no longer counts");
    assert.equal(m.impression(s, PUB).outcome, "rejected");
    assert.equal(m.totalSpentAll(), 0n);
    assert.equal(m.eventCount(), 0);
  });

  it("an impression just inside the window still charges", () => {
    const { m, cid } = world();
    const s = serveOk(m, cid);
    m.nowMs += HOLD_MS - 1;
    assert.equal(m.impression(s, PUB).billed, true);
  });

  it("a CPC click after the window is rejected even though the impression was valid", () => {
    const { m, cid } = world({ pricing: { model: "cpc", cpcUnits: usd("0.0150") } });
    const s = serveOk(m, cid);
    m.impression(s, PUB);
    m.nowMs += HOLD_MS;
    assert.equal(m.click(s, PUB).outcome, "rejected");
    assert.equal(m.totalSpentAll(), 0n);
  });

  it("unused reservations are released safely and free up budget for new serves", () => {
    const { m, cid } = world({ total: usd("0.0040") }); // sirf 2 serves ($0.0020 each)
    serveOk(m, cid);
    serveOk(m, cid);
    assert.equal(m.serve(cid, PUB).outcome, "rejected", "budget fully reserved");
    m.nowMs += HOLD_MS;
    assert.equal(m.releaseExpired(), 2);
    assert.equal(m.serve(cid, PUB).outcome, "ok", "released holds free the budget");
    assert.equal(m.totalSpentAll(), 0n, "nothing was ever charged");
    m.assertBudgetInvariant();
  });

  it("settlement after expiry is impossible: the hold is released, not charged", () => {
    const { m, cid } = world();
    const s = serveOk(m, cid);
    m.nowMs += HOLD_MS + 5;
    m.releaseExpired();
    assert.equal(m.reservationOf(s)?.status, "released");
    assert.equal(m.impression(s, PUB).billed, false);
  });
});

describe("model: budget exhaustion and budget protection", () => {
  it("total budget: reservations stop the serves that would overshoot, even before any impression arrives", () => {
    const { m, cid } = world({ total: usd("0.0100") }); // 5 serves
    let ok = 0;
    for (let i = 0; i < 12; i += 1) if (m.serve(cid, PUB).outcome === "ok") ok += 1;
    assert.equal(ok, 5);
    assert.equal(m.totalSpentAll(), 0n);
    m.assertBudgetInvariant();
  });

  it("settling every hold never exceeds the total budget (spent + held stays the same when a hold settles)", () => {
    const { m, cid } = world({ total: usd("0.0100") });
    const ids: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const r = m.serve(cid, PUB);
      if (r.outcome === "ok") ids.push(r.serveId);
    }
    for (const id of ids) {
      const before = m.spentTotal(cid) + m.heldTotal(cid);
      m.impression(id, PUB);
      assert.equal(m.spentTotal(cid) + m.heldTotal(cid), before);
    }
    assert.equal(m.spentTotal(cid), usd("0.0100"));
    assert.ok(m.spentTotal(cid) <= m.campaigns.get(cid)!.total);
  });

  it("daily budget counts holds of today and spend of today (UTC)", () => {
    const { m, cid } = world({ total: usd("1.00"), daily: usd("0.0060") }); // 3 serves per UTC day
    const ids = [serveOk(m, cid), serveOk(m, cid), serveOk(m, cid)];
    assert.equal(m.serve(cid, PUB).outcome, "rejected");
    m.impression(ids[0]!, PUB); // hold -> spend: daily total same, still full
    assert.equal(m.serve(cid, PUB).outcome, "rejected");
    m.assertBudgetInvariant();
  });

  it("spend is booked on the SERVE's UTC day, not the event's day (23:59 UTC serve, 00:01 UTC impression)", () => {
    const { m, cid } = world({ total: usd("1.00"), daily: usd("0.0060") });
    m.nowMs = Date.UTC(2026, 10, 10, 23, 59, 0);
    const day1 = utcDay(m.nowMs);
    const s = serveOk(m, cid);
    m.nowMs = Date.UTC(2026, 10, 11, 0, 1, 0);
    const day2 = utcDay(m.nowMs);
    assert.equal(day2, day1 + 1);
    m.impression(s, PUB);
    assert.equal(m.spentOn(cid, day1), 20n);
    assert.equal(m.spentOn(cid, day2), 0n);
    // New UTC day => fresh daily room, yesterday's spend does not eat it
    for (let i = 0; i < 3; i += 1) serveOk(m, cid);
    assert.equal(m.serve(cid, PUB).outcome, "rejected");
    m.assertBudgetInvariant();
  });

  it("yesterday's live hold does not count against today's daily limit but does count against the total", () => {
    const { m, cid } = world({ total: usd("0.0080"), daily: usd("0.0040") });
    m.nowMs = Date.UTC(2026, 10, 10, 23, 0, 0);
    serveOk(m, cid);
    serveOk(m, cid); // gaya aaj ka daily full (2 x 0.0020 = 0.0040)
    m.nowMs = Date.UTC(2026, 10, 11, 1, 0, 0);
    serveOk(m, cid);
    serveOk(m, cid); // naye din ka daily room mila
    assert.equal(m.serve(cid, PUB).outcome, "rejected", "total budget (4 serves) is the limit now");
    m.assertBudgetInvariant();
  });

  it("a CPC campaign reserves the click rate (not CPM/1000) and rejects when one click no longer fits", () => {
    const { m, cid } = world({ total: usd("0.0400"), pricing: { model: "cpc", cpcUnits: usd("0.0150") } });
    serveOk(m, cid);
    serveOk(m, cid);
    assert.equal(m.serve(cid, PUB).outcome, "rejected", "2 x 0.0150 = 0.0300, third would be 0.0450 > 0.0400");
  });
});

describe("model: concurrent requests (any interleaving is a serialized order under the campaign lock)", () => {
  // Seeded pseudo-random order (reproducible): har run me wahi interleaving.
  function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  }

  for (const model of ["cpm", "cpc"] as const) {
    it(`random mix of serves, duplicate events, late events and releases never breaks the budget (${model})`, () => {
      for (let seed = 1; seed <= 40; seed += 1) {
        const rnd = lcg(seed);
        const { m, cid } = world({
          total: usd("0.0300"),
          daily: seed % 2 === 0 ? usd("0.0200") : null,
          pricing: model === "cpm" ? { model: "cpm", cpmUnits: usd("2.00") } : { model: "cpc", cpcUnits: usd("0.0040") },
        });
        const serves: number[] = [];
        for (let step = 0; step < 120; step += 1) {
          const roll = rnd();
          if (roll < 0.4) {
            const r = m.serve(cid, PUB);
            if (r.outcome === "ok") serves.push(r.serveId);
          } else if (serves.length > 0) {
            const id = serves[Math.floor(rnd() * serves.length)]!;
            if (roll < 0.65) m.impression(id, PUB);
            else if (roll < 0.85) m.click(id, PUB);
            else if (roll < 0.95) m.nowMs += Math.floor(rnd() * (HOLD_MS / 3));
            else m.releaseExpired();
          }
          m.assertBudgetInvariant();
        }
        // Ek serve par kabhi do charge nahi: settled reservations = ginti, har ek ek hi baar.
        let settled = 0;
        for (const id of serves) if (m.reservationOf(id)?.status === "settled") settled += 1;
        const unit = model === "cpm" ? 20n : usd("0.0040");
        assert.equal(m.totalSpentAll(), BigInt(settled) * unit, `seed ${seed}: spend == settled x unit`);
      }
    });
  }

  it("100 parallel serves on a budget for 10: exactly 10 get a hold", () => {
    const { m, cid } = world({ total: usd("0.0200") });
    let ok = 0;
    for (let i = 0; i < 100; i += 1) if (m.serve(cid, i % 2 ? PUB : PUB_2).outcome === "ok") ok += 1;
    assert.equal(ok, 10);
  });

  it("the same impression arriving 50 times at once charges exactly once", () => {
    const { m, cid } = world();
    const s = serveOk(m, cid);
    const results = Array.from({ length: 50 }, () => m.impression(s, PUB));
    assert.equal(results.filter((r) => r.outcome === "recorded").length, 1);
    assert.equal(results.filter((r) => r.billed).length, 1);
    assert.equal(m.spentTotal(cid), 20n);
  });

  it("the same click arriving 50 times at once charges exactly once", () => {
    const { m, cid } = world({ pricing: { model: "cpc", cpcUnits: usd("0.0150") } });
    const s = serveOk(m, cid);
    m.impression(s, PUB);
    const results = Array.from({ length: 50 }, () => m.click(s, PUB));
    assert.equal(results.filter((r) => r.billed).length, 1);
    assert.equal(m.spentTotal(cid), usd("0.0150"));
  });
});

describe("model: transaction rollback", () => {
  it("if settlement fails after the event insert + spend, event, spend and hold all roll back; a retry then works", () => {
    const { m, cid } = world();
    const s = serveOk(m, cid);
    m.failSettlement = true;
    assert.throws(() => m.impression(s, PUB), /settlement failed/);
    assert.equal(m.eventCount(), 0, "event insert rolled back");
    assert.equal(m.totalSpentAll(), 0n, "spend rolled back");
    assert.equal(m.reservationOf(s)?.status, "held", "hold intact");
    m.failSettlement = false;
    assert.deepEqual(m.impression(s, PUB), { outcome: "recorded", billed: true });
    assert.equal(m.spentTotal(cid), 20n);
  });

  it("a failing CPC click settlement rolls back the click too, so the retry is not a duplicate", () => {
    const { m, cid } = world({ pricing: { model: "cpc", cpcUnits: usd("0.0150") } });
    const s = serveOk(m, cid);
    m.impression(s, PUB);
    m.failSettlement = true;
    assert.throws(() => m.click(s, PUB));
    assert.equal(m.eventCount("click"), 0);
    m.failSettlement = false;
    assert.deepEqual(m.click(s, PUB), { outcome: "recorded", billed: true });
  });

  it("DAY_MS sanity: one UTC day is 24h (the model's day maths)", () => {
    assert.equal(DAY_MS, 24 * 3_600_000);
    assert.equal(utcDay(Date.UTC(2026, 10, 10, 23, 59, 59)), utcDay(Date.UTC(2026, 10, 10, 0, 0, 0)));
  });
});
