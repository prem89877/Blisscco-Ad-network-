import { PILOT_COUNTED_STATUSES, PILOT_MAX_ADVERTISER_TOTAL } from "./constants";
import { formatCents } from "./money";

// Pilot limit: ek advertiser ke saare campaigns ka total budget milakar PILOT_MAX_ADVERTISER_TOTAL se zyada nahi.
// Pure functions (database nahi): server action aur tests dono yahi use karte hain. Sab kuch integer cents me.
// Ek campaign ki limit (PILOT_MAX_CAMPAIGN_BUDGET) budget-rules.ts me hai, kyunki browser form bhi wahi use karta hai.

export const PILOT_ADVERTISER_TOTAL_CENTS = Math.round(PILOT_MAX_ADVERTISER_TOTAL * 100);

const COUNTED = new Set<string>(PILOT_COUNTED_STATUSES);

export function isCountedStatus(status: unknown): boolean {
  return typeof status === "string" && COUNTED.has(status);
}

/** Message: kitna limit hai, doosre campaigns ne kitna le liya, is campaign ke liye kitna bacha. */
export function advertiserTotalMessage(othersCents: number): string {
  const left = Math.max(0, PILOT_ADVERTISER_TOTAL_CENTS - othersCents);
  return (
    `During the pilot, all your campaigns together can have at most ${formatCents(PILOT_ADVERTISER_TOTAL_CENTS)} in total budget. ` +
    `Your other campaigns already use ${formatCents(othersCents)}, so this one can be at most ${formatCents(left)}.`
  );
}

export const PILOT_TOTAL_UNKNOWN_MESSAGE = "We could not check your total campaign budget right now. Please try again.";

export type PilotTotalCheck = { ok: true } | { ok: false; message: string };

/** newTotalCents = is campaign ka naya total; othersCents = baaki (ginti me aane wale) campaigns ka total. */
export function checkAdvertiserTotal(newTotalCents: number, othersCents: number): PilotTotalCheck {
  if (!Number.isFinite(newTotalCents) || !Number.isFinite(othersCents)) return { ok: false, message: PILOT_TOTAL_UNKNOWN_MESSAGE };
  if (newTotalCents + othersCents > PILOT_ADVERTISER_TOTAL_CENTS) return { ok: false, message: advertiserTotalMessage(othersCents) };
  return { ok: true };
}

/**
 * Database rows (status, total_budget) -> ginti me aane wale campaigns ka total (cents).
 * Koi row ka shape galat ho toh null (fail-closed: limit check "pata nahi" maana jata hai, chupchap pass nahi hota).
 */
export function sumCountedBudgetCents(rows: unknown): number | null {
  if (!Array.isArray(rows)) return null;
  let sum = 0;
  for (const r of rows as { status?: unknown; total_budget?: unknown }[]) {
    if (r === null || typeof r !== "object") return null;
    if (!isCountedStatus(r.status)) continue;
    const n = typeof r.total_budget === "string" ? Number(r.total_budget) : r.total_budget;
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
    sum += Math.round(n * 100);
  }
  return sum;
}
