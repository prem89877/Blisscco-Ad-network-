import { isCampaignStatus, type CampaignDbStatus } from "./constants";
import { isPricingModel, type PricingModel } from "./pricing-rules";

export type Campaign = {
  id: string;
  advertiserId: string;
  name: string;
  description: string | null;
  category: string;
  status: CampaignDbStatus;
  totalBudget: number;
  dailyBudget: number | null;
  startDate: string; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD
  /** Phase 6 Step 4 Part 1: null = purana campaign (platform default rate). Abhi sirf store hota hai, serving me use nahi. */
  pricingModel: PricingModel | null;
  cpmRateUsd: number | null;
  cpcRateUsd: number | null;
  createdAt: string;
  updatedAt: string;
};

/** Form ki raw (text) values. Error aane par wapas bhejte hain taaki user ka likha hua gayab na ho. */
export type FormValues = {
  name: string;
  description: string;
  category: string;
  totalBudget: string;
  dailyBudget: string;
  startDate: string;
  endDate: string;
  /** Pricing optional hai (purane callers / tests ke liye): na ho ya khali = platform default. */
  pricingModel?: string;
  cpmRate?: string;
  cpcRate?: string;
};
export type CampaignFieldName = keyof FormValues;

export type CampaignFormState = {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: Partial<Record<CampaignFieldName, string>>;
  values?: FormValues;
};
export const initialFormState: CampaignFormState = { status: "idle" };

export type RunStateResult = { status: "idle" | "success" | "error"; message?: string };
export const initialRunState: RunStateResult = { status: "idle" };

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

type PricingRead = { pricingModel: PricingModel | null; cpmRateUsd: number | null; cpcRateUsd: number | null };

/**
 * Pricing columns (migration chali na ho toh undefined = purana campaign). Shape database CHECK jaisi: model null => dono rate null;
 * cpm => sirf cpm rate; cpc => sirf cpc rate. Kharab shape => null (caller campaign ko "load fail" maanta hai, guess nahi).
 */
function readPricing(r: Record<string, unknown>): PricingRead | null {
  const rawModel = r.pricing_model;
  const model = rawModel === null || rawModel === undefined ? null : isPricingModel(rawModel) ? rawModel : undefined;
  if (model === undefined) return null;
  const rate = (v: unknown): number | null | undefined => (v === null || v === undefined ? null : num(v) ?? undefined);
  const cpm = rate(r.cpm_rate_usd);
  const cpc = rate(r.cpc_rate_usd);
  if (cpm === undefined || cpc === undefined) return null;
  if (model === null) return cpm === null && cpc === null ? { pricingModel: null, cpmRateUsd: null, cpcRateUsd: null } : null;
  if (model === "cpm") return cpm !== null && cpc === null ? { pricingModel: model, cpmRateUsd: cpm, cpcRateUsd: null } : null;
  return cpc !== null && cpm === null ? { pricingModel: model, cpmRateUsd: null, cpcRateUsd: cpc } : null;
}

/** Database row (unknown) -> typed Campaign. Shape galat ho toh null (kabhi crash nahi). */
export function toCampaign(row: unknown): Campaign | null {
  if (typeof row !== "object" || row === null) return null;
  const r = row as Record<string, unknown>;
  const id = str(r.id);
  const advertiserId = str(r.advertiser_id);
  const name = str(r.name);
  const category = str(r.category);
  const status = r.status;
  const totalBudget = num(r.total_budget);
  const startDate = str(r.start_date);
  const createdAt = str(r.created_at);
  const updatedAt = str(r.updated_at);
  if (!id || !advertiserId || !name || !category || !isCampaignStatus(status)) return null;
  if (totalBudget === null || !startDate || !createdAt || !updatedAt) return null;
  const pricing = readPricing(r);
  if (pricing === null) return null;
  return {
    id,
    advertiserId,
    name,
    description: str(r.description),
    category,
    status,
    totalBudget,
    dailyBudget: r.daily_budget === null || r.daily_budget === undefined ? null : num(r.daily_budget),
    startDate,
    endDate: str(r.end_date),
    ...pricing,
    createdAt,
    updatedAt,
  };
}
