import { fake, type FakeCampaign } from "./action-stubs"; // SABSE PEHLE: nakli modules lagte hain
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  CPC_MAX_UNITS,
  CPC_MIN_UNITS,
  CPM_MAX_UNITS,
  CPM_MIN_UNITS,
  NO_PRICING,
  PRICING_CURRENCY,
  PRICING_MESSAGES,
  checkPricing,
  formatRateUnits,
  isPricingModel,
  parseRateUnits,
  samePricing,
  unitsToDbRate,
} from "@/lib/campaigns/pricing-rules";
import { checkBudgets } from "@/lib/campaigns/budget-rules";
import { parseCampaignForm, readFormValues, utcToday } from "@/lib/campaigns/validation";
import { toCampaign, type FormValues } from "@/lib/campaigns/types";
import { createCampaign, updateCampaign } from "@/app/dashboard/advertiser/campaigns/actions";
import { matchCategorySignal, resolveCategory, toPublicAd, type AdCandidate } from "@/lib/ads/category-matching";
import { selectAd } from "@/lib/ads/selection";
import { filterCandidatesByRegion } from "@/lib/ads/campaign-targeting";
import type { RegionId } from "@/lib/regions/country-region";

// Phase 6 Step 4 Part 1: campaign pricing (CPM / CPC). Nakli database (action-stubs); asli database kabhi nahi chhuta.
// Is file ka kaam: pricing validation, legacy campaign compatibility, USD enforcement aur "category matching bilkul nahi badli".

const TODAY = "2026-11-10"; // sirf parseCampaignForm ke todayUtc ke liye (fixed)
const ACTION_TODAY = utcToday(); // server actions asli clock padhte hain
const CAMP_ID = "11111111-1111-4111-8111-111111111111";
const UPDATED = "2026-11-01T10:00:00.000Z";
const ROOT = path.resolve(__dirname, "..", "..", "..");

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

// ---------------------------------------------------------------------------
// 1. Pricing rules (pure)
// ---------------------------------------------------------------------------
describe("phase 6 step 4 part 1: rate parsing (exact, no floats)", () => {
  it("valid spellings become exact integer units (1 unit = $0.0001)", () => {
    const cases: [string, number][] = [
      ["2", 20_000],
      ["2.5", 25_000],
      ["2.50", 25_000],
      ["0.15", 1_500],
      ["0.0150", 150],
      ["0.1", 1_000],
      ["1000", 10_000_000],
      ["00012.5", 125_000],
      ["  3.1415  ", 31_415],
    ];
    for (const [raw, units] of cases) {
      const r = parseRateUnits(raw);
      assert.deepEqual(r, { ok: true, units }, raw);
    }
  });

  it("rejects empty, symbols, commas, minus/plus, e-notation, 5 decimals, spaces inside, words", () => {
    for (const raw of ["", "   ", "$2", "2,50", "1,000", "-1", "+1", "1e3", "2.12345", "2 .5", "2.", ".5", "abc", "NaN", "Infinity", "0x10", "٣"]) {
      const r = parseRateUnits(raw);
      assert.equal(r.ok, false, JSON.stringify(raw));
    }
    assert.deepEqual(parseRateUnits(""), { ok: false, reason: "empty" });
    assert.deepEqual(parseRateUnits("2.12345"), { ok: false, reason: "format" });
    assert.deepEqual(parseRateUnits("99999999"), { ok: false, reason: "too_large" });
  });

  it("units -> database number keeps up to 4 decimals exactly as typed", () => {
    for (const [raw, expected] of [["0.0150", 0.015], ["2.5555", 2.5555], ["999.9999", 999.9999], ["0.1", 0.1]] as const) {
      const r = parseRateUnits(raw);
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(unitsToDbRate(r.units), expected, raw);
    }
  });

  it("formatRateUnits shows 2 to 4 decimals", () => {
    assert.equal(formatRateUnits(25_000), "$2.50");
    assert.equal(formatRateUnits(150), "$0.015");
    assert.equal(formatRateUnits(1_000), "$0.10");
    assert.equal(formatRateUnits(10_000_000), "$1,000.00");
    assert.equal(formatRateUnits(31_415), "$3.1415");
  });
});

describe("phase 6 step 4 part 1: checkPricing", () => {
  it("valid CPM stores only the CPM rate", () => {
    const r = checkPricing({ pricingModel: "cpm", cpmRate: "2.50", cpcRate: "" });
    assert.deepEqual(r.errors, {});
    assert.deepEqual(r.value, { pricingModel: "cpm", cpmRateUsd: 2.5, cpcRateUsd: null });
  });

  it("valid CPC stores only the CPC rate", () => {
    const r = checkPricing({ pricingModel: "cpc", cpmRate: "", cpcRate: "0.15" }, { totalCents: 50_000, dailyCents: 5_000 });
    assert.deepEqual(r.errors, {});
    assert.deepEqual(r.value, { pricingModel: "cpc", cpmRateUsd: null, cpcRateUsd: 0.15 });
  });

  it("only the chosen model's rate is required and looked at: a junk rate for the other model is ignored and never stored", () => {
    const a = checkPricing({ pricingModel: "cpm", cpmRate: "3", cpcRate: "garbage" });
    assert.deepEqual(a.value, { pricingModel: "cpm", cpmRateUsd: 3, cpcRateUsd: null });
    const b = checkPricing({ pricingModel: "cpc", cpmRate: "-5", cpcRate: "0.2" });
    assert.deepEqual(b.value, { pricingModel: "cpc", cpmRateUsd: null, cpcRateUsd: 0.2 });
  });

  it("missing rate for the chosen model is an error on that model's field only", () => {
    assert.deepEqual(checkPricing({ pricingModel: "cpm", cpmRate: "" }).errors, { cpmRate: PRICING_MESSAGES.cpmEmpty });
    assert.deepEqual(checkPricing({ pricingModel: "cpc", cpcRate: " " }).errors, { cpcRate: PRICING_MESSAGES.cpcEmpty });
    assert.equal(checkPricing({ pricingModel: "cpm", cpmRate: "" }).value, null);
  });

  it("CPM range: below 0.10 and above 1000.00 rejected, both edges accepted", () => {
    assert.equal(checkPricing({ pricingModel: "cpm", cpmRate: "0.0999" }).errors.cpmRate, PRICING_MESSAGES.cpmMin);
    assert.equal(checkPricing({ pricingModel: "cpm", cpmRate: "0" }).errors.cpmRate, PRICING_MESSAGES.cpmMin);
    assert.equal(checkPricing({ pricingModel: "cpm", cpmRate: "1000.0001" }).errors.cpmRate, PRICING_MESSAGES.cpmMax);
    assert.equal(checkPricing({ pricingModel: "cpm", cpmRate: "99999999" }).errors.cpmRate, PRICING_MESSAGES.cpmMax);
    assert.equal(checkPricing({ pricingModel: "cpm", cpmRate: "0.10" }).value?.cpmRateUsd, 0.1);
    assert.equal(checkPricing({ pricingModel: "cpm", cpmRate: "1000" }).value?.cpmRateUsd, 1000);
    assert.equal(CPM_MIN_UNITS, 1_000);
    assert.equal(CPM_MAX_UNITS, 10_000_000);
  });

  it("CPC range: below 0.01 and above 100.00 rejected, both edges accepted", () => {
    const big = { totalCents: 1_000_000, dailyCents: null };
    assert.equal(checkPricing({ pricingModel: "cpc", cpcRate: "0.0099" }, big).errors.cpcRate, PRICING_MESSAGES.cpcMin);
    assert.equal(checkPricing({ pricingModel: "cpc", cpcRate: "100.0001" }, big).errors.cpcRate, PRICING_MESSAGES.cpcMax);
    assert.equal(checkPricing({ pricingModel: "cpc", cpcRate: "0.01" }, big).value?.cpcRateUsd, 0.01);
    assert.equal(checkPricing({ pricingModel: "cpc", cpcRate: "100" }, big).value?.cpcRateUsd, 100);
    assert.equal(CPC_MIN_UNITS, 100);
    assert.equal(CPC_MAX_UNITS, 1_000_000);
  });

  it("CPC rate cannot exceed the total budget or the daily budget", () => {
    assert.equal(checkPricing({ pricingModel: "cpc", cpcRate: "5" }, { totalCents: 400, dailyCents: null }).errors.cpcRate, PRICING_MESSAGES.cpcAboveTotal);
    assert.equal(checkPricing({ pricingModel: "cpc", cpcRate: "5" }, { totalCents: 10_000, dailyCents: 400 }).errors.cpcRate, PRICING_MESSAGES.cpcAboveDaily);
    assert.equal(checkPricing({ pricingModel: "cpc", cpcRate: "5" }, { totalCents: 500, dailyCents: 500 }).value?.cpcRateUsd, 5); // equal is fine
    // Budget abhi valid nahi (null) => cross-check nahi lagta; budget ki apni error alag dikhti hai
    assert.deepEqual(checkPricing({ pricingModel: "cpc", cpcRate: "5" }, { totalCents: null, dailyCents: null }).errors, {});
  });

  it("model must be exactly cpm or cpc: no other value, no case tricks, no prototype keys", () => {
    for (const m of ["CPM", "Cpc", "cpv", "free", "cpm,cpc", "0", "__proto__", "constructor", "toString"]) {
      const r = checkPricing({ pricingModel: m, cpmRate: "2", cpcRate: "0.2" }, { totalCents: 10_000, dailyCents: null });
      assert.equal(r.errors.pricingModel, PRICING_MESSAGES.chooseModel, m);
      assert.equal(r.value, null, m);
    }
    assert.equal(isPricingModel("cpm"), true);
    assert.equal(isPricingModel("cpc"), true);
    assert.equal(isPricingModel("CPM"), false);
    assert.equal(isPricingModel(undefined), false);
  });

  it("blank model = platform default (legacy): all null, no error, junk rates ignored", () => {
    for (const input of [{}, { pricingModel: "" }, { pricingModel: "  ", cpmRate: "9", cpcRate: "9" }, { pricingModel: undefined }]) {
      const r = checkPricing(input);
      assert.deepEqual(r.errors, {});
      assert.deepEqual(r.value, NO_PRICING);
    }
  });

  it("requirePricing makes a model mandatory", () => {
    const r = checkPricing({ pricingModel: "" }, { totalCents: 100, dailyCents: null, requirePricing: true });
    assert.equal(r.errors.pricingModel, PRICING_MESSAGES.chooseModel);
    assert.equal(r.value, null);
  });

  it("a campaign that already has pricing cannot go back to the platform default", () => {
    const r = checkPricing(
      { pricingModel: "" },
      { totalCents: 10_000, dailyCents: null, existing: { pricingModel: "cpm", cpmRateUsd: 2, cpcRateUsd: null } },
    );
    assert.equal(r.errors.pricingModel, PRICING_MESSAGES.cannotRevert);
    assert.equal(r.value, null);
  });

  it("samePricing compares model and both rates", () => {
    assert.equal(samePricing(NO_PRICING, { pricingModel: null, cpmRateUsd: null, cpcRateUsd: null }), true);
    assert.equal(samePricing({ pricingModel: "cpm", cpmRateUsd: 2, cpcRateUsd: null }, { pricingModel: "cpm", cpmRateUsd: 2, cpcRateUsd: null }), true);
    assert.equal(samePricing({ pricingModel: "cpm", cpmRateUsd: 2, cpcRateUsd: null }, { pricingModel: "cpm", cpmRateUsd: 2.5, cpcRateUsd: null }), false);
    assert.equal(samePricing({ pricingModel: "cpm", cpmRateUsd: 2, cpcRateUsd: null }, { pricingModel: "cpc", cpmRateUsd: null, cpcRateUsd: 0.2 }), false);
  });
});

// ---------------------------------------------------------------------------
// 2. parseCampaignForm integration + legacy compatibility
// ---------------------------------------------------------------------------
function values(over: Partial<FormValues> = {}): FormValues {
  return { name: "Winter launch", description: "", category: "gaming", totalBudget: "500", dailyBudget: "50", startDate: TODAY, endDate: "", ...over };
}

describe("phase 6 step 4 part 1: parseCampaignForm with pricing", () => {
  it("LEGACY: a form with no pricing fields at all (old callers / old tests) is still valid and yields null pricing", () => {
    const r = parseCampaignForm(values(), { todayUtc: TODAY });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.value.pricingModel, null);
      assert.equal(r.value.cpmRateUsd, null);
      assert.equal(r.value.cpcRateUsd, null);
    }
  });

  it("LEGACY: blank pricing strings (what the form posts when nothing is chosen) are the same as no pricing", () => {
    const r = parseCampaignForm(values({ pricingModel: "", cpmRate: "", cpcRate: "" }), { todayUtc: TODAY });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value.pricingModel, null);
  });

  it("valid CPM and CPC campaigns parse, with USD amounts as exact numbers", () => {
    const cpm = parseCampaignForm(values({ pricingModel: "cpm", cpmRate: "2.50" }), { todayUtc: TODAY });
    assert.equal(cpm.ok, true);
    if (cpm.ok) assert.deepEqual([cpm.value.pricingModel, cpm.value.cpmRateUsd, cpm.value.cpcRateUsd], ["cpm", 2.5, null]);
    const cpc = parseCampaignForm(values({ pricingModel: "cpc", cpcRate: "0.0150" }), { todayUtc: TODAY });
    assert.equal(cpc.ok, true);
    if (cpc.ok) assert.deepEqual([cpc.value.pricingModel, cpc.value.cpmRateUsd, cpc.value.cpcRateUsd], ["cpc", null, 0.015]);
  });

  it("pricing errors are reported on pricing fields and do not hide other field errors", () => {
    const r = parseCampaignForm(values({ name: "x", pricingModel: "cpm", cpmRate: "0.01" }), { todayUtc: TODAY });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.errors.cpmRate, PRICING_MESSAGES.cpmMin);
      assert.ok(r.errors.name, "name error still reported");
    }
  });

  it("CPC is checked against the budgets of the SAME submission", () => {
    const r = parseCampaignForm(values({ totalBudget: "5", dailyBudget: "", pricingModel: "cpc", cpcRate: "6" }), { todayUtc: TODAY });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.errors.cpcRate, PRICING_MESSAGES.cpcAboveTotal);
    const daily = parseCampaignForm(values({ totalBudget: "500", dailyBudget: "5", pricingModel: "cpc", cpcRate: "6" }), { todayUtc: TODAY });
    assert.equal(daily.ok, false);
    if (!daily.ok) assert.equal(daily.errors.cpcRate, PRICING_MESSAGES.cpcAboveDaily);
  });

  it("an invalid budget does not produce a second, confusing CPC budget error", () => {
    const r = parseCampaignForm(values({ totalBudget: "abc", pricingModel: "cpc", cpcRate: "0.2" }), { todayUtc: TODAY });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(r.errors.totalBudget);
      assert.equal(r.errors.cpcRate, undefined);
    }
  });

  it("EDIT of a legacy campaign: leaving pricing blank still works (rename only), and choosing a model also works", () => {
    const existing = { startDate: TODAY, category: "gaming", categoryLocked: false, totalBudget: 500, dailyBudget: 50, pricingModel: null, cpmRateUsd: null, cpcRateUsd: null };
    assert.equal(parseCampaignForm(values({ name: "Renamed", pricingModel: "" }), { todayUtc: TODAY, existing }).ok, true);
    const chosen = parseCampaignForm(values({ pricingModel: "cpm", cpmRate: "4" }), { todayUtc: TODAY, existing });
    assert.equal(chosen.ok, true);
  });

  it("EDIT of a priced campaign: switching CPM -> CPC works, going back to blank is refused", () => {
    const existing = { startDate: TODAY, category: "gaming", categoryLocked: false, totalBudget: 500, dailyBudget: 50, pricingModel: "cpm" as const, cpmRateUsd: 2, cpcRateUsd: null };
    const sw = parseCampaignForm(values({ pricingModel: "cpc", cpcRate: "0.3" }), { todayUtc: TODAY, existing });
    assert.equal(sw.ok, true);
    if (sw.ok) assert.deepEqual([sw.value.pricingModel, sw.value.cpmRateUsd, sw.value.cpcRateUsd], ["cpc", null, 0.3]);
    const blank = parseCampaignForm(values({ pricingModel: "" }), { todayUtc: TODAY, existing });
    assert.equal(blank.ok, false);
    if (!blank.ok) assert.equal(blank.errors.pricingModel, PRICING_MESSAGES.cannotRevert);
  });

  it("EDIT: lowering the total budget below an existing CPC rate is refused on the CPC field", () => {
    const existing = { startDate: TODAY, category: "gaming", categoryLocked: false, totalBudget: 500, dailyBudget: null, pricingModel: "cpc" as const, cpmRateUsd: null, cpcRateUsd: 2 };
    const r = parseCampaignForm(values({ totalBudget: "1.50", dailyBudget: "", pricingModel: "cpc", cpcRate: "2" }), { todayUtc: TODAY, existing });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.errors.cpcRate, PRICING_MESSAGES.cpcAboveTotal);
  });

  it("readFormValues reads only pricingModel / cpmRate / cpcRate (bounded) and never a currency field", () => {
    const fd = new FormData();
    fd.set("name", "n");
    fd.set("pricingModel", "cpm");
    fd.set("cpmRate", "2.5");
    fd.set("currency", "INR");
    fd.set("currencyCode", "EUR");
    fd.set("currency_code", "GBP");
    fd.set("cpmRateUsd", "999");
    fd.set("cpcRate", "9".repeat(500));
    const v = readFormValues(fd);
    assert.equal(v.pricingModel, "cpm");
    assert.equal(v.cpmRate, "2.5");
    assert.equal((v.cpcRate ?? "").length, 40, "rate text is bounded");
    for (const k of Object.keys(v)) assert.equal(/currency/i.test(k), false, k);
    assert.equal(JSON.stringify(v).includes("INR"), false);
  });
});

// ---------------------------------------------------------------------------
// 3. Database row -> Campaign (legacy compatibility)
// ---------------------------------------------------------------------------
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CAMP_ID,
    advertiser_id: "adv-A",
    name: "Winter launch",
    description: null,
    category: "gaming",
    status: "draft",
    total_budget: "500.00",
    daily_budget: "50.00",
    start_date: TODAY,
    end_date: null,
    created_at: UPDATED,
    updated_at: UPDATED,
    ...over,
  };
}

describe("phase 6 step 4 part 1: toCampaign and legacy rows", () => {
  it("LEGACY: a row with no pricing columns at all (migration not applied yet) loads with null pricing", () => {
    const c = toCampaign(row());
    assert.ok(c);
    assert.deepEqual([c.pricingModel, c.cpmRateUsd, c.cpcRateUsd], [null, null, null]);
  });

  it("LEGACY: a row with explicit null pricing columns (migrated old campaign) loads with null pricing", () => {
    const c = toCampaign(row({ pricing_model: null, cpm_rate_usd: null, cpc_rate_usd: null }));
    assert.ok(c);
    assert.deepEqual([c.pricingModel, c.cpmRateUsd, c.cpcRateUsd], [null, null, null]);
  });

  it("priced rows load, numeric strings and numbers both", () => {
    const a = toCampaign(row({ pricing_model: "cpm", cpm_rate_usd: "2.5000", cpc_rate_usd: null }));
    assert.deepEqual([a?.pricingModel, a?.cpmRateUsd, a?.cpcRateUsd], ["cpm", 2.5, null]);
    const b = toCampaign(row({ pricing_model: "cpc", cpm_rate_usd: null, cpc_rate_usd: 0.015 }));
    assert.deepEqual([b?.pricingModel, b?.cpmRateUsd, b?.cpcRateUsd], ["cpc", null, 0.015]);
  });

  it("a row whose pricing shape is wrong (can't happen under the DB CHECK) is refused, never guessed", () => {
    for (const bad of [
      { pricing_model: "cpv", cpm_rate_usd: 1, cpc_rate_usd: null },
      { pricing_model: "cpm", cpm_rate_usd: null, cpc_rate_usd: null },
      { pricing_model: "cpm", cpm_rate_usd: 1, cpc_rate_usd: 1 },
      { pricing_model: "cpc", cpm_rate_usd: 1, cpc_rate_usd: 1 },
      { pricing_model: null, cpm_rate_usd: 1, cpc_rate_usd: null },
      { pricing_model: null, cpm_rate_usd: null, cpc_rate_usd: 1 },
      { pricing_model: "cpm", cpm_rate_usd: "abc", cpc_rate_usd: null },
      { pricing_model: "CPM", cpm_rate_usd: 1, cpc_rate_usd: null },
      { pricing_model: 5, cpm_rate_usd: 1, cpc_rate_usd: null },
    ]) {
      assert.equal(toCampaign(row(bad)), null, JSON.stringify(bad));
    }
  });

  it("the list / detail query selects the three pricing columns", () => {
    const src = read("lib/campaigns/queries.ts");
    for (const col of ["pricing_model", "cpm_rate_usd", "cpc_rate_usd"]) assert.ok(src.includes(col), col);
  });
});

// ---------------------------------------------------------------------------
// 4. Server actions (nakli database)
// ---------------------------------------------------------------------------
function campaign(over: Record<string, unknown> = {}): FakeCampaign {
  return {
    id: CAMP_ID,
    advertiserId: "adv-A",
    name: "Winter launch",
    description: null,
    category: "gaming",
    status: "draft",
    totalBudget: 500,
    dailyBudget: 50,
    startDate: ACTION_TODAY,
    endDate: null,
    createdAt: UPDATED,
    updatedAt: UPDATED,
    ...over,
  } as FakeCampaign;
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
    startDate: ACTION_TODAY,
    endDate: "",
  };
  for (const [k, v] of Object.entries({ ...base, ...over })) fd.set(k, v);
  return fd;
}

type Outcome<T> = { state?: T; redirect?: string };
async function settle<T>(fn: () => Promise<T>): Promise<Outcome<T>> {
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
const writes = () => fake.calls.filter((c) => c.table === "campaigns");
const PRICING_KEYS = ["pricing_model", "cpm_rate_usd", "cpc_rate_usd"];

describe("phase 6 step 4 part 1: createCampaign with pricing", () => {
  beforeEach(() => fake.reset());

  it("LEGACY create (no pricing posted) inserts exactly the same columns as before: no pricing keys", async () => {
    const r = await create();
    assert.match(r.redirect ?? "", /created=1/);
    const p = writes()[0].payload;
    assert.deepEqual(Object.keys(p).sort(), ["advertiser_id", "category", "daily_budget", "description", "end_date", "name", "start_date", "total_budget"]);
  });

  it("CPM create stores model + CPM rate, CPC rate null, and no currency field", async () => {
    const r = await create({ pricingModel: "cpm", cpmRate: "2.50" });
    assert.match(r.redirect ?? "", /created=1/);
    const p = writes()[0].payload;
    assert.equal(p.pricing_model, "cpm");
    assert.equal(p.cpm_rate_usd, 2.5);
    assert.equal(p.cpc_rate_usd, null);
    assert.equal("currency_code" in p, false);
    assert.equal("currency" in p, false);
  });

  it("CPC create stores model + CPC rate, CPM rate null", async () => {
    await create({ pricingModel: "cpc", cpcRate: "0.15" });
    const p = writes()[0].payload;
    assert.deepEqual([p.pricing_model, p.cpm_rate_usd, p.cpc_rate_usd], ["cpc", null, 0.15]);
  });

  it("USD: forged currency fields in the form are never copied into the insert", async () => {
    const fd = form({ pricingModel: "cpm", cpmRate: "2" });
    fd.delete("campaignId");
    fd.set("currency", "INR");
    fd.set("currencyCode", "EUR");
    fd.set("currency_code", "GBP");
    fd.set("pricing_currency", "JPY");
    await settle(() => createCampaign({ status: "idle" }, fd));
    const p = writes()[0].payload;
    assert.equal(JSON.stringify(p).match(/INR|EUR|GBP|JPY/), null);
    for (const k of Object.keys(p)) assert.equal(/currency/i.test(k), false, k);
  });

  it("forged DB column names (cpm_rate_usd etc.) posted directly are ignored: only the form's own fields count", async () => {
    const fd = form({ pricingModel: "cpm", cpmRate: "2" });
    fd.delete("campaignId");
    fd.set("cpm_rate_usd", "999");
    fd.set("cpc_rate_usd", "50");
    fd.set("pricing_model", "cpc");
    await settle(() => createCampaign({ status: "idle" }, fd));
    const p = writes()[0].payload;
    assert.deepEqual([p.pricing_model, p.cpm_rate_usd, p.cpc_rate_usd], ["cpm", 2, null]);
  });

  it("invalid pricing writes NOTHING and returns a field error with the typed values kept", async () => {
    const badCases: Record<string, string>[] = [
      { pricingModel: "cpm", cpmRate: "0.01" },
      { pricingModel: "cpm", cpmRate: "" },
      { pricingModel: "cpc", cpcRate: "500" },
      { pricingModel: "cpc", cpcRate: "600", totalBudget: "1000" },
      { pricingModel: "bogus", cpmRate: "2" },
    ];
    for (const bad of badCases) {
      fake.calls = [];
      const r = await create(bad);
      assert.equal(r.redirect, undefined, JSON.stringify(bad));
      assert.equal(r.state?.status, "error");
      assert.ok(r.state?.fieldErrors?.pricingModel || r.state?.fieldErrors?.cpmRate || r.state?.fieldErrors?.cpcRate, JSON.stringify(bad));
      assert.equal(r.state?.values?.pricingModel, bad.pricingModel);
      assert.equal(writes().length, 0, JSON.stringify(bad));
    }
  });
});

describe("phase 6 step 4 part 1: updateCampaign with pricing", () => {
  beforeEach(() => {
    fake.reset();
    fake.campaigns = [campaign()];
  });

  it("LEGACY campaign, rename only: the update payload carries NO pricing keys (columns untouched)", async () => {
    const r = await edit({ name: "Renamed campaign" });
    assert.match(r.redirect ?? "", /updated=1/);
    const p = writes()[0].payload;
    for (const k of PRICING_KEYS) assert.equal(k in p, false, k);
  });

  it("LEGACY campaign can be given pricing: all three pricing columns are sent together", async () => {
    await edit({ pricingModel: "cpm", cpmRate: "3.25" });
    const p = writes()[0].payload;
    assert.deepEqual([p.pricing_model, p.cpm_rate_usd, p.cpc_rate_usd], ["cpm", 3.25, null]);
  });

  it("priced campaign, rename only (same pricing posted): pricing columns are not re-sent", async () => {
    fake.campaigns = [campaign({ pricingModel: "cpm", cpmRateUsd: 2.5, cpcRateUsd: null })];
    await edit({ name: "Renamed", pricingModel: "cpm", cpmRate: "2.50" });
    const p = writes()[0].payload;
    for (const k of PRICING_KEYS) assert.equal(k in p, false, k);
  });

  it("switching CPM -> CPC sends all three columns, clearing the old CPM rate in the same write (DB shape CHECK)", async () => {
    fake.campaigns = [campaign({ pricingModel: "cpm", cpmRateUsd: 2.5, cpcRateUsd: null })];
    await edit({ pricingModel: "cpc", cpcRate: "0.4" });
    const p = writes()[0].payload;
    assert.deepEqual([p.pricing_model, p.cpm_rate_usd, p.cpc_rate_usd], ["cpc", null, 0.4]);
  });

  it("changing only the rate sends the new rate", async () => {
    fake.campaigns = [campaign({ pricingModel: "cpc", cpmRateUsd: null, cpcRateUsd: 0.2 })];
    await edit({ pricingModel: "cpc", cpcRate: "0.25" });
    const p = writes()[0].payload;
    assert.deepEqual([p.pricing_model, p.cpm_rate_usd, p.cpc_rate_usd], ["cpc", null, 0.25]);
  });

  it("a priced campaign cannot be sent back to the platform default; nothing is written", async () => {
    fake.campaigns = [campaign({ pricingModel: "cpm", cpmRateUsd: 2.5, cpcRateUsd: null })];
    const r = await edit({ pricingModel: "" });
    assert.equal(r.state?.status, "error");
    assert.equal(r.state?.fieldErrors?.pricingModel, PRICING_MESSAGES.cannotRevert);
    assert.equal(writes().length, 0);
  });

  it("locked statuses (pending_review / completed / archived): pricing cannot be edited, nothing written", async () => {
    for (const status of ["pending_review", "completed", "archived"] as const) {
      fake.calls = [];
      fake.campaigns = [campaign({ status })];
      const r = await edit({ pricingModel: "cpm", cpmRate: "9" });
      assert.equal(r.state?.status, "error", status);
      assert.equal(writes().length, 0, status);
    }
  });

  it("CPC rate that does not fit the NEW budgets is refused on the CPC field, nothing written", async () => {
    fake.campaigns = [campaign({ pricingModel: "cpc", cpmRateUsd: null, cpcRateUsd: 2 })];
    const r = await edit({ totalBudget: "1.50", dailyBudget: "", pricingModel: "cpc", cpcRate: "2" });
    assert.equal(r.state?.status, "error");
    assert.equal(r.state?.fieldErrors?.cpcRate, PRICING_MESSAGES.cpcAboveTotal);
    assert.equal(writes().length, 0);
  });

  it("a database CHECK failure on pricing maps to a friendly message, no raw database text", async () => {
    fake.dbError = { code: "23514" };
    const r = await edit({ pricingModel: "cpm", cpmRate: "3" });
    assert.equal(r.state?.status, "error");
    assert.match(r.state?.message ?? "", /not allowed/);
    assert.equal(/campaigns_|violates|constraint/i.test(r.state?.message ?? ""), false);
  });

  it("someone else's campaign: pricing edit writes nothing (ownership unchanged)", async () => {
    fake.campaigns = [campaign({ advertiserId: "adv-B" })];
    const r = await edit({ pricingModel: "cpm", cpmRate: "3" });
    assert.equal(r.state?.status, "error");
    assert.equal(writes().length, 0);
  });
});

// ---------------------------------------------------------------------------
// 5. USD enforcement + forward-only migration (static checks on the SQL file)
// ---------------------------------------------------------------------------
describe("phase 6 step 4 part 1: migration file (forward-only, exact numerics, USD)", () => {
  const sql = read("supabase/sql/phase6-step4-part1-campaign-pricing.sql");
  const code = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--") && !l.trim().toLowerCase().startsWith("comment on"))
    .join("\n")
    .toLowerCase();

  it("uses exact numeric(10, 4) for both rates and never a float type", () => {
    assert.match(code, /add column if not exists cpm_rate_usd\s+numeric\(10, 4\)/);
    assert.match(code, /add column if not exists cpc_rate_usd\s+numeric\(10, 4\)/);
    assert.equal(/\b(float|float4|float8|real|double precision|money)\b/.test(code), false);
  });

  it("columns are nullable with no default and no backfill (old campaigns stay null)", () => {
    assert.match(code, /add column if not exists pricing_model text;/);
    const addColumns = code.split("\n").filter((l) => l.includes("add column"));
    assert.equal(addColumns.length, 3);
    for (const l of addColumns) assert.equal(/default|not null/.test(l), false, l);
    assert.equal(/update\s+public\.campaigns\s+set/.test(code), false, "no backfill");
    assert.equal(/insert\s+into/.test(code), false);
  });

  it("is forward-only: nothing is dropped except its own constraints/trigger, nothing is deleted", () => {
    assert.equal(/drop\s+table|drop\s+column|drop\s+function|drop\s+schema|truncate|delete\s+from/.test(code), false);
    const drops = code.match(/drop\s+(constraint|trigger)\s+if exists\s+(\w+)/g) ?? [];
    for (const d of drops) assert.match(d, /campaigns_(pricing|cpm|cpc)|campaigns_guard_pricing/, d);
  });

  it("USD: explicit pricing USD CHECK, and the original USD-only currency constraint is not touched", () => {
    assert.match(code, /campaigns_pricing_usd_check\s+check \(pricing_model is null or currency_code = 'usd'\)/);
    assert.equal(/currency_code\s*=\s*'(inr|eur|gbp)'/.test(code), false);
    assert.equal(/campaigns_currency_usd_only/.test(code), false, "existing constraint not redefined");
    assert.equal(PRICING_CURRENCY, "USD");
  });

  it("does not touch ad_platform_settings or any ad-serving function (serving unchanged)", () => {
    for (const needle of [
      "ad_platform_settings",
      "load_ad_candidates",
      "record_ad_serve",
      "authorize_publisher_key",
      "match_contextual_ad",
      "guard_campaign_changes",
    ]) {
      assert.equal(code.includes(needle), false, needle);
    }
  });

  it("the SQL limits are the same numbers as the TypeScript limits", () => {
    const cpm = /cpm_rate_usd >= (\d+\.\d+) and cpm_rate_usd <= (\d+\.\d+)/.exec(code);
    const cpc = /cpc_rate_usd >= (\d+\.\d+) and cpc_rate_usd <= (\d+\.\d+)/.exec(code);
    assert.ok(cpm && cpc);
    const units = (s: string) => {
      const r = parseRateUnits(s);
      assert.equal(r.ok, true);
      return r.ok ? r.units : -1;
    };
    assert.equal(units(cpm[1]), CPM_MIN_UNITS);
    assert.equal(units(cpm[2]), CPM_MAX_UNITS);
    assert.equal(units(cpc[1]), CPC_MIN_UNITS);
    assert.equal(units(cpc[2]), CPC_MAX_UNITS);
  });

  it("shape check: model null => both null; cpm => only cpm; cpc => only cpc; CPC <= total and daily budget", () => {
    assert.match(code, /pricing_model is null and cpm_rate_usd is null and cpc_rate_usd is null/);
    assert.match(code, /pricing_model = 'cpm' and cpm_rate_usd is not null and cpc_rate_usd is null/);
    assert.match(code, /pricing_model = 'cpc' and cpc_rate_usd is not null and cpm_rate_usd is null/);
    assert.match(code, /cpc_rate_usd <= total_budget and \(daily_budget is null or cpc_rate_usd <= daily_budget\)/);
  });

  it("pricing is locked in pending_review / completed / archived by its own trigger; admin (postgres) is not blocked", () => {
    assert.match(code, /create or replace function private\.guard_campaign_pricing_changes/);
    assert.match(code, /old\.status in \('pending_review', 'completed', 'archived'\)/);
    assert.match(code, /current_user not in \('anon', 'authenticated'\)/);
    assert.match(code, /create trigger campaigns_guard_pricing\s+before update on public\.campaigns/);
  });

  it("grants are column-wise to authenticated only (no anon, no whole-table grant)", () => {
    assert.match(code, /grant insert \(pricing_model, cpm_rate_usd, cpc_rate_usd\) on public\.campaigns to authenticated/);
    assert.match(code, /grant update \(pricing_model, cpm_rate_usd, cpc_rate_usd\) on public\.campaigns to authenticated/);
    assert.equal(/to anon|to public/.test(code), false);
    assert.equal(/grant (all|select|insert|update) on public\.campaigns/.test(code), false);
  });

  it("is one transaction (begin ... commit)", () => {
    assert.match(code, /^\s*begin;/m);
    assert.match(code, /^\s*commit;/m);
  });

  it("no EXISTING migration file mentions the pricing columns (old migrations untouched)", () => {
    const dir = path.join(ROOT, "supabase", "sql");
    const offenders: string[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".sql") || f === "phase6-step4-part1-campaign-pricing.sql" || f === "phase6-step4-part2-event-billing.sql" || f.startsWith("phase6-step4-part3-")) continue; // Part 2 ne rates ko charge me use kiya (alag test file bandhti hai)
      if (/pricing_model|cpm_rate_usd|cpc_rate_usd/.test(readFileSync(path.join(dir, f), "utf8"))) offenders.push(f);
    }
    assert.deepEqual(offenders, []);
  });
});

// ---------------------------------------------------------------------------
// 6. Category matching + serving: unchanged
// ---------------------------------------------------------------------------
const PUBLISHER = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "active" };

function candidate(n: number, over: Partial<AdCandidate> = {}): AdCandidate {
  const hex = String(n).padStart(12, "0");
  return {
    ad: {
      id: `cccccccc-cccc-4ccc-8ccc-${hex}`,
      headline: `Headline ${n}`,
      body: `Body ${n}`,
      ctaText: "Learn more",
      destinationUrl: `https://example.com/${n}`,
    },
    creativeStatus: "approved",
    campaignId: `dddddddd-dddd-4ddd-8ddd-${hex}`,
    campaignStatus: "active",
    category: "gaming",
    startDate: "2026-01-01",
    endDate: null,
    totalBudget: 100,
    dailyBudget: null,
    spentTotal: 0,
    spentToday: 0,
    advertiserStatus: "active",
    advertiserProfileStatus: "active",
    campaignServesToday: 0,
    creativeServesToday: 0,
    ...over,
  };
}
const CTX = { today: TODAY, unitCostUsd: 0.002, budgetCheck: "enforce" as const };

describe("phase 6 step 4 part 1: contextual category matching is unchanged", () => {
  it("the three matching files were not given any pricing logic", () => {
    for (const f of ["lib/ads/category-matching.ts", "lib/ads/taxonomy.ts", "lib/ads/selection.ts", "lib/ads/campaign-targeting.ts", "lib/ads/regional-eligibility.ts"]) {
      const src = read(f);
      assert.equal(/pricing_model|pricingModel|cpm_rate_usd|cpc_rate_usd|cpmRateUsd|cpcRateUsd|pricing-rules/.test(src), false, f);
    }
  });

  it("exact slug / alias matching: same answers as before", () => {
    const expected: [unknown, string][] = [
      ["gaming", "gaming"],
      ["Games", "gaming"],
      ["video-games", "gaming"],
      [" GAMING ", "gaming"],
      ["fintech", "finance"],
      ["dev tools", "developer_tools"],
      ["developer_tools", "developer_tools"],
      ["tech", "technology"],
      ["e learning", "education"],
      ["lifestyle", "lifestyle"],
    ];
    for (const [raw, slug] of expected) assert.deepEqual(resolveCategory(raw), { ok: true, category: slug }, String(raw));
  });

  it("sensitive topics are rejected with the sensitive reason; unknown / legacy / substring / free text are unsupported or invalid", () => {
    for (const raw of ["health", "Mental Health", "religion", "politics", "union", "sexual orientation", "race"]) {
      assert.deepEqual(resolveCategory(raw), { ok: false, reason: "sensitive_category" }, raw);
    }
    for (const raw of ["beauty", "game", "gaming_pro", "unions", "__proto__", "constructor", "crypto", "dating"]) {
      assert.deepEqual(resolveCategory(raw), { ok: false, reason: "unsupported_category" }, raw);
    }
    assert.deepEqual(resolveCategory("a_b_c_d"), { ok: false, reason: "too_many_words" });
    assert.deepEqual(resolveCategory(""), { ok: false, reason: "empty" });
    assert.deepEqual(resolveCategory(null), { ok: false, reason: "not_a_string" });
    assert.deepEqual(resolveCategory("tell me about my chest pain please"), { ok: false, reason: "too_many_words" });
  });

  it("matching ignores campaign pricing: same winner and same public ad with or without pricing fields on the candidates", () => {
    const plain = [candidate(2), candidate(1), candidate(3, { category: "travel" })];
    const priced = plain.map((c, i) => ({ ...c, pricingModel: i % 2 ? "cpc" : "cpm", cpmRateUsd: 900 - i, cpcRateUsd: 50 + i }) as AdCandidate);
    const a = matchCategorySignal({ publisher: PUBLISHER, category: "gaming" }, plain, CTX);
    const b = matchCategorySignal({ publisher: PUBLISHER, category: "gaming" }, priced, CTX);
    assert.equal(a.status, "matched");
    assert.equal(b.status, "matched");
    if (a.status === "matched" && b.status === "matched") {
      assert.equal(a.selected.ad.id, b.selected.ad.id);
      assert.deepEqual(a.candidates.map((c) => c.ad.id), b.candidates.map((c) => c.ad.id));
      assert.equal(a.selected.ad.id, plain[1].ad.id, "tie-break: lowest campaign id");
      // Publisher ko sirf 5 public fields: pricing kabhi nahi
      assert.deepEqual(Object.keys(toPublicAd(b.selected)).sort(), ["body", "ctaText", "destinationUrl", "headline", "id"]);
    }
  });

  it("category mismatch, inactive publisher and sensitive signal behave as before", () => {
    assert.deepEqual(matchCategorySignal({ publisher: PUBLISHER, category: "travel" }, [candidate(1)], CTX), { status: "no_match", category: "travel", reason: "no_eligible_candidates" });
    assert.deepEqual(matchCategorySignal({ publisher: { ...PUBLISHER, status: "suspended" }, category: "gaming" }, [candidate(1)], CTX), { status: "rejected", reason: "publisher_not_authorized" });
    assert.deepEqual(matchCategorySignal({ publisher: PUBLISHER, category: "health" }, [candidate(1, { category: "health" })], CTX), { status: "rejected", reason: "sensitive_category" });
  });

  it("selectAd: no-fill fallbacks and regional gating unchanged (pricing fields on candidates change nothing)", async () => {
    const loaded = [candidate(1), candidate(2)].map((c) => ({ ...c, pricingModel: "cpc", cpcRateUsd: 99 }) as AdCandidate);
    const deps = { loadCandidates: async () => loaded, now: () => new Date("2026-11-10T12:00:00Z"), unitCostUsd: 0.002, spendTracking: "reliable" as const };
    const ok = await selectAd({ publisher: PUBLISHER, category: "gaming" }, deps);
    assert.equal(ok.fill, true);
    if (ok.fill) assert.equal(ok.ad.id, loaded[0].ad.id);
    assert.deepEqual(await selectAd({ publisher: PUBLISHER, category: "religion" }, deps), { fill: false, reason: "sensitive_category" });
    assert.deepEqual(await selectAd({ publisher: PUBLISHER, category: "crypto" }, deps), { fill: false, reason: "unsupported_category" });
    assert.deepEqual(await selectAd({ publisher: PUBLISHER, category: "travel" }, deps), { fill: false, reason: "no_eligible_candidates" });
    // Region ho par loader na ho => fail closed
    assert.deepEqual(await selectAd({ publisher: PUBLISHER, category: "gaming", publisherRegion: "uk" }, deps), { fill: false, reason: "candidate_load_failed" });
  });

  it("regional targeting: empty target = rest_of_world only; listed regions only; missing row / unknown id fail closed", () => {
    const [c1, c2, c3, c4] = [candidate(1), candidate(2), candidate(3), candidate(4)];
    const targets = new Map<string, readonly unknown[] | null>([
      [c1.campaignId, null],
      [c2.campaignId, ["uk"]],
      [c3.campaignId, ["bogus_region"]],
      // c4: row hi nahi
    ]);
    const ids = (r: RegionId) => filterCandidatesByRegion([c1, c2, c3, c4], targets, r).map((c) => c.ad.id);
    assert.deepEqual(ids("rest_of_world"), [c1.ad.id]);
    assert.deepEqual(ids("uk"), [c2.ad.id]);
    assert.deepEqual(ids("north_america"), []);
  });
});
