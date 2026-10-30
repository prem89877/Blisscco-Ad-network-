import { MAX_BUDGET, MIN_DAILY_BUDGET, MIN_TOTAL_BUDGET } from "./constants";
import { centsToDollars, dollarsToCents, formatCents, parseMoneyCents } from "./money";

// Budget ke niyam ek jagah (koi database/env nahi). Server (validation.ts) aur browser form (CampaignForm) DONO yahi use karte hain,
// isliye dono me message aur niyam bilkul same hain. Asli check server par hota hai; database ka CHECK + trigger uske neeche hai.

export type BudgetField = "totalBudget" | "dailyBudget";

export type BudgetExisting = {
  /** Edit me: purani saved values (dollar). Jo value badli nahi, uspar naya "minimum" niyam nahi lagta. */
  totalBudget?: number;
  dailyBudget?: number | null;
};

export type BudgetCheck = {
  errors: Partial<Record<BudgetField, string>>;
  /** Valid hone par cents (integer). Error ho toh null. */
  totalCents: number | null;
  dailyCents: number | null;
};

const MAX_CENTS = MAX_BUDGET * 100;
const MIN_TOTAL_CENTS = Math.round(MIN_TOTAL_BUDGET * 100);
const MIN_DAILY_CENTS = Math.round(MIN_DAILY_BUDGET * 100);

export const BUDGET_MESSAGES = {
  totalEmpty: "Enter the total budget.",
  totalFormat: "Enter a number like 2500 or 2500.50. No symbols, spaces or minus sign, and at most 2 decimals.",
  totalPositive: "Total budget must be more than 0.",
  totalMax: `Total budget can be at most ${formatCents(MAX_CENTS)}.`,
  totalMin: `Total budget must be at least ${formatCents(MIN_TOTAL_CENTS)}.`,
  dailyFormat: "Enter a number like 100 or 100.50 (at most 2 decimals), or leave it empty.",
  dailyPositive: "Daily budget must be more than 0, or leave it empty.",
  dailyMax: `Daily budget can be at most ${formatCents(MAX_CENTS)}.`,
  dailyAboveTotal: "Daily budget cannot be more than the total budget.",
  dailyMin: `Daily budget must be at least ${formatCents(MIN_DAILY_CENTS)}, or leave it empty.`,
} as const;

/**
 * Total aur daily budget ki poori jaanch. Sab kuch integer cents me (float ki galti nahi).
 * Order: pehle har field ka apna niyam, phir dono ka rishta (daily <= total).
 */
export function checkBudgets(totalRaw: string, dailyRaw: string, existing?: BudgetExisting): BudgetCheck {
  const errors: Partial<Record<BudgetField, string>> = {};
  const oldTotal = dollarsToCents(existing?.totalBudget ?? null);
  const oldDaily = dollarsToCents(existing?.dailyBudget ?? null);

  let totalCents: number | null = null;
  const t = parseMoneyCents(totalRaw);
  if (!t.ok) {
    errors.totalBudget =
      t.reason === "empty" ? BUDGET_MESSAGES.totalEmpty : t.reason === "too_large" ? BUDGET_MESSAGES.totalMax : BUDGET_MESSAGES.totalFormat;
  } else if (t.cents <= 0) errors.totalBudget = BUDGET_MESSAGES.totalPositive;
  else if (t.cents > MAX_CENTS) errors.totalBudget = BUDGET_MESSAGES.totalMax;
  else if (t.cents < MIN_TOTAL_CENTS && t.cents !== oldTotal) errors.totalBudget = BUDGET_MESSAGES.totalMin;
  else totalCents = t.cents;

  let dailyCents: number | null = null;
  if (dailyRaw.trim() !== "") {
    const d = parseMoneyCents(dailyRaw);
    if (!d.ok) errors.dailyBudget = d.reason === "too_large" ? BUDGET_MESSAGES.dailyMax : BUDGET_MESSAGES.dailyFormat;
    else if (d.cents <= 0) errors.dailyBudget = BUDGET_MESSAGES.dailyPositive;
    else if (totalCents !== null && d.cents > totalCents) errors.dailyBudget = BUDGET_MESSAGES.dailyAboveTotal;
    else if (d.cents > MAX_CENTS) errors.dailyBudget = BUDGET_MESSAGES.dailyMax;
    else if (d.cents < MIN_DAILY_CENTS && d.cents !== oldDaily) errors.dailyBudget = BUDGET_MESSAGES.dailyMin;
    else dailyCents = d.cents;
  }

  return { errors, totalCents, dailyCents };
}

/** Valid cents -> database ko bhejne wala number (2 decimal ka). */
export function toDbAmount(cents: number): number {
  return centsToDollars(cents);
}
