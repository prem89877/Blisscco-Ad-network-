// Budget ke pure niyam (koi database/env nahi, isliye bina database ke test hota hai).
// Server action aur page dono yahi use karte hain.

/** Kharch 4 decimal tak aata hai (serve ki keemat $0.0001 tak). Float ki galti se bachne ke liye integer micro-dollar me tulna. */
function micro(n: number): number {
  return Math.round(n * 10_000);
}

/**
 * true = naya total budget ab tak ke kharch se kam hai (aisa edit rokna hai).
 * Koi number NaN/Infinity ho toh bhi true (fail-closed): galat data par edit chupchap nahi chalta.
 */
export function isBelowSpend(newTotalBudget: number, spentTotal: number): boolean {
  if (!Number.isFinite(newTotalBudget) || !Number.isFinite(spentTotal)) return true;
  return micro(newTotalBudget) < micro(spentTotal);
}

/** Campaign me kitna budget bacha (kabhi negative nahi). */
export function remainingBudget(totalBudget: number, spentTotal: number): number {
  const left = micro(totalBudget) - micro(spentTotal);
  return left > 0 ? left / 10_000 : 0;
}

export const BELOW_SPEND_MESSAGE = (spent: string) =>
  `This campaign has already spent ${spent}. The total budget cannot be lower than that.`;

export const SPEND_UNKNOWN_MESSAGE = "We could not check this campaign's spend right now. Please try again in a moment.";
