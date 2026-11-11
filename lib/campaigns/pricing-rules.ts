// Campaign pricing (CPM / CPC) ke niyam ek jagah (koi database/env nahi). Server (validation.ts) aur browser form (CampaignForm)
// DONO yahi use karte hain, isliye dono me message aur niyam bilkul same hain. Asli check server par hota hai; database CHECK uske neeche hai.
//
// Rate integer "units" me (1 unit = $0.0001), float kabhi nahi: "2.50" seedha 25000 units banta hai. Database numeric(10,4) se mel khata hai.
// Currency hamesha USD (campaigns.currency_code CHECK = 'USD'); form se currency kabhi nahi aati.
//
// Abhi ye rate SIRF store hota hai (Phase 6 Step 4 Part 1). Ad serving / charge ab bhi platform CPM (ad_platform_settings.cpm_usd) se hota hai.
//
// Limits supabase/sql/phase6-step4-part1-campaign-pricing.sql ke CHECK constraints jaisi hain. Badalna ho toh DONO jagah.

export const PRICING_MODELS = ["cpm", "cpc"] as const;
export type PricingModel = (typeof PRICING_MODELS)[number];

export function isPricingModel(v: unknown): v is PricingModel {
  return typeof v === "string" && (PRICING_MODELS as readonly string[]).includes(v);
}

export const PRICING_MODEL_LABELS: Record<PricingModel, string> = {
  cpm: "CPM (cost per 1,000 impressions)",
  cpc: "CPC (cost per click)",
};

export const PRICING_CURRENCY = "USD" as const;

export const RATE_DECIMALS = 4;
export const RATE_SCALE = 10_000; // 1 dollar = 10,000 units
const CENTS_TO_UNITS = RATE_SCALE / 100; // 1 cent = 100 units

// 0.10 CPM = $0.0001 per impression = serve ki keemat ka floor (record_ad_serve: greatest(round(cpm / 1000, 4), 0.0001)).
export const CPM_MIN_UNITS = 1_000; // $0.10
export const CPM_MAX_UNITS = 10_000_000; // $1,000.00 (ad_platform_settings.cpm_usd ki seema jaisi)
export const CPC_MIN_UNITS = 100; // $0.01
export const CPC_MAX_UNITS = 1_000_000; // $100.00

/** Form ka suggested shuruaati CPM (platform ka default 2.00). Sirf form ki value; server isse kabhi default nahi maanta. */
export const SUGGESTED_CPM_RATE = "2.00";

export type PricingFieldName = "pricingModel" | "cpmRate" | "cpcRate";

export type RateParse = { ok: true; units: number } | { ok: false; reason: "empty" | "format" | "too_large" };

const MAX_DOLLAR_DIGITS = 7;

/** "2.5", "0.0150", "1000" -> units. Sirf digits aur ek dot, 4 decimal tak. Koi symbol, comma, minus, plus, space ke beech, e-notation nahi. */
export function parseRateUnits(raw: string): RateParse {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (trimmed === "") return { ok: false, reason: "empty" };
  const m = /^(\d+)(?:\.(\d{1,4}))?$/.exec(trimmed);
  if (!m) return { ok: false, reason: "format" };
  const dollars = m[1].replace(/^0+(?=\d)/, "");
  if (dollars.length > MAX_DOLLAR_DIGITS) return { ok: false, reason: "too_large" };
  const frac = (m[2] ?? "").padEnd(RATE_DECIMALS, "0");
  return { ok: true, units: Number(dollars) * RATE_SCALE + Number(frac) };
}

/** Units -> database ko bhejne wala number (4 decimal tak). */
export function unitsToDbRate(units: number): number {
  return units / RATE_SCALE;
}

/** Database ka number (numeric(10,4)) -> units. Galat/NaN par null. */
export function dbRateToUnits(n: number | null | undefined): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.round(n * RATE_SCALE);
}

/** Units -> "$2.50" / "$0.0150" (kam se kam 2, zyada se zyada 4 decimal). Sirf dikhane ke liye. */
export function formatRateUnits(units: number): string {
  const dollars = Math.floor(units / RATE_SCALE);
  let frac = String(units % RATE_SCALE).padStart(RATE_DECIMALS, "0");
  while (frac.length > 2 && frac.endsWith("0")) frac = frac.slice(0, -1);
  return `$${dollars.toLocaleString("en-US")}.${frac}`;
}

export const PRICING_MESSAGES = {
  chooseModel: "Choose CPM or CPC.",
  cannotRevert: "Choose CPM or CPC. A campaign that already has pricing cannot go back to the platform default.",
  cpmEmpty: "Enter the CPM rate.",
  cpcEmpty: "Enter the CPC rate.",
  cpmFormat: "Enter a number like 2 or 2.50 (USD, at most 4 decimals). No symbols, commas, spaces or minus sign.",
  cpcFormat: "Enter a number like 0.15 or 0.0150 (USD, at most 4 decimals). No symbols, commas, spaces or minus sign.",
  cpmMin: `CPM rate must be at least ${formatRateUnits(CPM_MIN_UNITS)}.`,
  cpmMax: `CPM rate can be at most ${formatRateUnits(CPM_MAX_UNITS)}.`,
  cpcMin: `CPC rate must be at least ${formatRateUnits(CPC_MIN_UNITS)}.`,
  cpcMax: `CPC rate can be at most ${formatRateUnits(CPC_MAX_UNITS)}.`,
  cpcAboveTotal: "CPC rate cannot be more than the total budget.",
  cpcAboveDaily: "CPC rate cannot be more than the daily budget.",
} as const;

export type PricingInput = {
  /** "" / undefined = koi model nahi (platform default). Warna sirf exact "cpm" ya "cpc". */
  pricingModel?: string;
  cpmRate?: string;
  cpcRate?: string;
};

export type PricingExisting = {
  pricingModel?: PricingModel | null;
  cpmRateUsd?: number | null;
  cpcRateUsd?: number | null;
};

export type PricingContext = {
  /** Budget ki jaanch ke natije (cents; budget-rules.checkBudgets). null = budget abhi valid nahi, isliye cross-check nahi lagta. */
  totalCents: number | null;
  dailyCents: number | null;
  /** Edit me: purani saved pricing. Pricing wali campaign wapas "platform default" nahi ban sakti. */
  existing?: PricingExisting;
  /** true = model chunna zaroori (default false: khali = platform default, purane callers / tests jaisa). */
  requirePricing?: boolean;
};

export type PricingValue = {
  pricingModel: PricingModel | null;
  cpmRateUsd: number | null;
  cpcRateUsd: number | null;
};

export type PricingCheck = {
  errors: Partial<Record<PricingFieldName, string>>;
  /** Valid hone par database ke liye value. Error ho toh null. */
  value: PricingValue | null;
};

export const NO_PRICING: PricingValue = Object.freeze({ pricingModel: null, cpmRateUsd: null, cpcRateUsd: null });

/**
 * Pricing ki poori jaanch. Model ke hisaab se SIRF uska rate dekha jaata hai (doosra rate chupchap ignore + null store).
 * Order: model, phir rate ka format, phir range, phir (CPC ke liye) budget se rishta.
 */
export function checkPricing(input: PricingInput, ctx: PricingContext = { totalCents: null, dailyCents: null }): PricingCheck {
  const errors: Partial<Record<PricingFieldName, string>> = {};
  const model = (typeof input.pricingModel === "string" ? input.pricingModel : "").trim();
  const hadPricing = ctx.existing?.pricingModel != null;

  if (model === "") {
    if (hadPricing) errors.pricingModel = PRICING_MESSAGES.cannotRevert;
    else if (ctx.requirePricing) errors.pricingModel = PRICING_MESSAGES.chooseModel;
    return Object.keys(errors).length > 0 ? { errors, value: null } : { errors, value: { ...NO_PRICING } };
  }
  if (!isPricingModel(model)) {
    errors.pricingModel = PRICING_MESSAGES.chooseModel;
    return { errors, value: null };
  }

  if (model === "cpm") {
    const r = parseRateUnits(input.cpmRate ?? "");
    if (!r.ok) {
      errors.cpmRate = r.reason === "empty" ? PRICING_MESSAGES.cpmEmpty : r.reason === "too_large" ? PRICING_MESSAGES.cpmMax : PRICING_MESSAGES.cpmFormat;
    } else if (r.units < CPM_MIN_UNITS) errors.cpmRate = PRICING_MESSAGES.cpmMin;
    else if (r.units > CPM_MAX_UNITS) errors.cpmRate = PRICING_MESSAGES.cpmMax;
    if (errors.cpmRate || !r.ok) return { errors, value: null };
    return { errors, value: { pricingModel: "cpm", cpmRateUsd: unitsToDbRate(r.units), cpcRateUsd: null } };
  }

  const r = parseRateUnits(input.cpcRate ?? "");
  if (!r.ok) {
    errors.cpcRate = r.reason === "empty" ? PRICING_MESSAGES.cpcEmpty : r.reason === "too_large" ? PRICING_MESSAGES.cpcMax : PRICING_MESSAGES.cpcFormat;
  } else if (r.units < CPC_MIN_UNITS) errors.cpcRate = PRICING_MESSAGES.cpcMin;
  else if (r.units > CPC_MAX_UNITS) errors.cpcRate = PRICING_MESSAGES.cpcMax;
  else if (ctx.totalCents !== null && r.units > ctx.totalCents * CENTS_TO_UNITS) errors.cpcRate = PRICING_MESSAGES.cpcAboveTotal;
  else if (ctx.dailyCents !== null && r.units > ctx.dailyCents * CENTS_TO_UNITS) errors.cpcRate = PRICING_MESSAGES.cpcAboveDaily;
  if (errors.cpcRate || !r.ok) return { errors, value: null };
  return { errors, value: { pricingModel: "cpc", cpmRateUsd: null, cpcRateUsd: unitsToDbRate(r.units) } };
}

/** Do pricing values barabar hain? (edit me sirf badli hui pricing database ko bheji jaati hai.) */
export function samePricing(a: PricingValue, b: PricingValue): boolean {
  return a.pricingModel === b.pricingModel && a.cpmRateUsd === b.cpmRateUsd && a.cpcRateUsd === b.cpcRateUsd;
}
