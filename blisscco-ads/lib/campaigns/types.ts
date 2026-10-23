import { isCampaignStatus, type CampaignDbStatus } from "./constants";

export type Campaign = {
  id: string;
  advertiserId: string;
  name: string;
  category: string;
  status: CampaignDbStatus;
  totalBudget: number;
  dailyBudget: number | null;
  startDate: string; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD
  createdAt: string;
  updatedAt: string;
};

/** Form ki raw (text) values. Error aane par wapas bhejte hain taaki user ka likha hua gayab na ho. */
export type FormValues = {
  name: string;
  category: string;
  totalBudget: string;
  dailyBudget: string;
  startDate: string;
  endDate: string;
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
  return {
    id,
    advertiserId,
    name,
    category,
    status,
    totalBudget,
    dailyBudget: r.daily_budget === null || r.daily_budget === undefined ? null : num(r.daily_budget),
    startDate,
    endDate: str(r.end_date),
    createdAt,
    updatedAt,
  };
}
