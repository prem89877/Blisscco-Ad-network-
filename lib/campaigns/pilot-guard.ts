import { getCommittedBudgetCents } from "@/lib/campaigns/queries";
import { checkAdvertiserTotal, PILOT_TOTAL_UNKNOWN_MESSAGE } from "./pilot-limits";
import { dollarsToCents } from "./money";

// Pilot limit (advertiser ke saare campaigns ka total <= PILOT_MAX_ADVERTISER_TOTAL) ka server-side check.
// Create, edit (total badle ya rejected campaign) aur rejected -> draft (reopen) par yahi chalta hai.
// Fail-closed: baaki campaigns ka total padh na paye toh kaam rukta hai, chupchap pass nahi hota.

/** null = theek hai; warna user ko dikhane layak message. */
export async function pilotTotalProblem(advertiserId: string, totalBudget: number, excludeCampaignId?: string): Promise<string | null> {
  const newCents = dollarsToCents(totalBudget);
  const othersCents = await getCommittedBudgetCents(advertiserId, excludeCampaignId);
  if (newCents === null || othersCents === null) return PILOT_TOTAL_UNKNOWN_MESSAGE;
  const r = checkAdvertiserTotal(newCents, othersCents);
  return r.ok ? null : r.message;
}
