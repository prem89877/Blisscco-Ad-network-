import { DESC_MAX, MAX_CAMPAIGN_DAYS, NAME_MAX, NAME_MIN, START_MAX_DAYS_AHEAD, isCategory } from "./constants";
import { checkBudgets, toDbAmount } from "./budget-rules";
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
  /**
   * Edit ke waqt: purani values. Jo value badli nahi, uspar naye (sakht) niyam nahi lagte, taaki purana campaign
   * sirf naam badalne par bhi atak na jaye. Budget/endDate optional hain (purane callers ke liye).
   */
  existing?: {
    startDate: string;
    category: string;
    categoryLocked: boolean;
    totalBudget?: number;
    dailyBudget?: number | null;
    endDate?: string | null;
  };
};

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

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

export function parseCampaignForm(values: FormValues, opts: ParseOptions): ParseResult {
  const errors: Partial<Record<CampaignFieldName, string>> = {};

  // Naam ek line ka text: kai spaces/tab/newline ek space ban jate hain, aur chhupe control characters reject.
  const rawName = values.name;
  const name = rawName.replace(/\s+/g, " ").trim();
  if (CONTROL_CHARS.test(rawName.replace(/[\t\n\r]/g, " "))) errors.name = "Remove special control characters.";
  else if (name.length === 0) errors.name = "Enter a campaign name.";
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

  // Budget: poori jaanch budget-rules.ts me (integer cents; browser form bhi wahi use karta hai).
  const budget = checkBudgets(values.totalBudget, values.dailyBudget, {
    totalBudget: opts.existing?.totalBudget,
    dailyBudget: opts.existing?.dailyBudget,
  });
  Object.assign(errors, budget.errors);
  const total = budget.totalCents === null ? null : toDbAmount(budget.totalCents);
  const daily = budget.dailyCents === null ? null : toDbAmount(budget.dailyCents);

  const startDate = values.startDate.trim();
  if (startDate === "") errors.startDate = "Choose a start date.";
  else if (!isRealDate(startDate)) errors.startDate = "Choose a valid start date.";
  else if (startDate !== opts.existing?.startDate && startDate < minStartDateForNew(opts.todayUtc)) {
    errors.startDate = "Start date cannot be in the past.";
  } else if (startDate !== opts.existing?.startDate && startDate > addDays(opts.todayUtc, START_MAX_DAYS_AHEAD)) {
    errors.startDate = `Start date can be at most ${START_MAX_DAYS_AHEAD} days from today.`;
  }

  const endRaw = values.endDate.trim();
  let endDate: string | null = null;
  if (endRaw !== "") {
    if (!isRealDate(endRaw)) errors.endDate = "Choose a valid end date, or leave it empty.";
    else if (errors.startDate === undefined && startDate !== "" && endRaw < startDate) {
      errors.endDate = "End date must be on or after the start date.";
    } else if (
      errors.startDate === undefined &&
      startDate !== "" &&
      endRaw > addDays(startDate, MAX_CAMPAIGN_DAYS) &&
      (endRaw !== (opts.existing?.endDate ?? null) || startDate !== opts.existing?.startDate)
    ) {
      errors.endDate = `A campaign can run for at most ${MAX_CAMPAIGN_DAYS} days.`;
    } else endDate = endRaw;
  }

  if (Object.keys(errors).length > 0 || total === null) return { ok: false, errors };
  return { ok: true, value: { name, description, category, totalBudget: total, dailyBudget: daily, startDate, endDate } };
}
