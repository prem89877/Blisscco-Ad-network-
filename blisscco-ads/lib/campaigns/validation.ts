import { DESC_MAX, MAX_BUDGET, NAME_MAX, NAME_MIN, isCategory } from "./constants";
import type { CampaignFieldName, FormValues } from "./types";

// Server-side validation (asli check yahi hai). Browser ki checking sirf suvidha ke liye.

export type ParsedCampaign = {
  name: string;
  description: string | null;
  category: string;
  totalBudget: number;
  dailyBudget: number | null;
  startDate: string;
  endDate: string | null;
};

export type ParseResult =
  | { ok: true; value: ParsedCampaign }
  | { ok: false; errors: Partial<Record<CampaignFieldName, string>> };

export type ParseOptions = {
  /** Aaj ki UTC date (YYYY-MM-DD). */
  todayUtc: string;
  /** Edit ke waqt: purani start date aur category (unchanged values allowed rehti hain). */
  existing?: { startDate: string; category: string; categoryLocked: boolean };
};

const FIELD_MAX = 200;

function readText(fd: FormData, key: string, max: number = FIELD_MAX): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.slice(0, max) : "";
}

export function readFormValues(fd: FormData): FormValues {
  return {
    name: readText(fd, "name"),
    // +1: limit se lamba text ko silently kaatne ki jagah error dikhana hai.
    description: readText(fd, "description", DESC_MAX + 1),
    category: readText(fd, "category"),
    totalBudget: readText(fd, "totalBudget"),
    dailyBudget: readText(fd, "dailyBudget"),
    startDate: readText(fd, "startDate"),
    endDate: readText(fd, "endDate"),
  };
}

export function utcToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Past-date ki chhoot: UTC se peeche wale time zones ke liye ek din pehle tak allowed. */
export function minStartDateForNew(todayUtc: string): string {
  return addDays(todayUtc, -1);
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export function isRealDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** "2500" ya "2,500.50" -> number. Sirf 2 decimal tak, koi symbol ya minus nahi. */
function parseMoney(raw: string): number | null {
  const trimmed = raw.trim();
  // Comma sirf hazaar ke group ke liye ("2,500"); "2,5,0,0" jaisa galat likha hua sahi number nahi banna chahiye.
  if (trimmed.includes(",") && !/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(trimmed)) return null;
  const s = trimmed.replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseCampaignForm(values: FormValues, opts: ParseOptions): ParseResult {
  const errors: Partial<Record<CampaignFieldName, string>> = {};

  const name = values.name.trim();
  if (name.length === 0) errors.name = "Enter a campaign name.";
  else if (name.length < NAME_MIN) errors.name = `Use at least ${NAME_MIN} characters.`;
  else if (name.length > NAME_MAX) errors.name = `Use ${NAME_MAX} characters or fewer.`;

  // Description optional. \r\n -> \n, NUL byte hata do (Postgres text me NUL nahi leta), khali = null.
  const descText = values.description.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim();
  let description: string | null = null;
  if (descText.length > DESC_MAX) errors.description = `Use ${DESC_MAX} characters or fewer.`;
  else if (descText.length > 0) description = descText;

  let category = values.category;
  if (opts.existing?.categoryLocked) {
    category = opts.existing.category; // locked: form ki value ignore
  } else if (!isCategory(category) && category !== opts.existing?.category) {
    errors.category = "Choose a category.";
  }

  let total: number | null = null;
  if (values.totalBudget.trim() === "") errors.totalBudget = "Enter the total budget.";
  else {
    total = parseMoney(values.totalBudget);
    if (total === null) errors.totalBudget = "Enter a number like 2500 or 2500.50. No symbols or minus sign.";
    else if (total <= 0) errors.totalBudget = "Total budget must be more than 0.";
    else if (total > MAX_BUDGET) errors.totalBudget = `Total budget can be up to ${MAX_BUDGET.toLocaleString("en-US")}.`;
  }

  let daily: number | null = null;
  if (values.dailyBudget.trim() !== "") {
    daily = parseMoney(values.dailyBudget);
    if (daily === null) errors.dailyBudget = "Enter a number like 100 or 100.50, or leave it empty.";
    else if (daily <= 0) errors.dailyBudget = "Daily budget must be more than 0, or leave it empty.";
    else if (errors.totalBudget === undefined && total !== null && Math.round(daily * 100) > Math.round(total * 100)) {
      errors.dailyBudget = "Daily budget cannot be more than the total budget.";
    }
  }

  const startDate = values.startDate.trim();
  if (startDate === "") errors.startDate = "Choose a start date.";
  else if (!isRealDate(startDate)) errors.startDate = "Choose a valid start date.";
  else if (startDate !== opts.existing?.startDate && startDate < minStartDateForNew(opts.todayUtc)) {
    errors.startDate = "Start date cannot be in the past.";
  }

  const endRaw = values.endDate.trim();
  let endDate: string | null = null;
  if (endRaw !== "") {
    if (!isRealDate(endRaw)) errors.endDate = "Choose a valid end date, or leave it empty.";
    else if (errors.startDate === undefined && startDate !== "" && endRaw < startDate) {
      errors.endDate = "End date must be on or after the start date.";
    } else endDate = endRaw;
  }

  if (Object.keys(errors).length > 0 || total === null) return { ok: false, errors };
  return { ok: true, value: { name, description, category, totalBudget: total, dailyBudget: daily, startDate, endDate } };
}
