"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/campaigns/constants";
import { formatMoney } from "@/lib/ledger/decimal";
import {
  REQUEST_SUCCESS,
  amountErrorMessage,
  parsePayoutAmount,
  parseRequestOutcome,
  requestOutcomeMessage,
} from "@/lib/payouts/rules";
import type { RunStateResult } from "@/lib/campaigns/types";

// Publisher apna payout REQUEST karta hai. Ye sirf request likhta hai: paisa nahi bhejta, koi payment provider nahi.
//
//  * Role server par check hota hai (sirf "publisher"). Admin / advertiser yahan nahi pahunch sakte.
//  * Publisher id form se KABHI nahi aati: database function request_my_payout logged-in user (auth.uid()) ka apna publisher khud nikalti hai.
//  * Amount text se exact units (BigInt) me, phir 4-decimal TEXT me database ko jaata hai: float kahin nahi.
//  * Asli niyam (apna hi balance, khula request, balance se zyada nahi, ek balance do baar reserve nahi) database function me hain.
//  * Session wala client: service-role key yahan nahi.

export async function requestPayout(_prev: RunStateResult, formData: FormData): Promise<RunStateResult> {
  await requireRole(["publisher"]);

  const rawAmount = formData.get("amount");
  const rawKey = formData.get("requestKey");
  if (typeof rawAmount !== "string" || typeof rawKey !== "string" || !isUuid(rawKey)) {
    return { status: "error", message: "That request was not understood. Please reload the page and try again." };
  }

  const amount = parsePayoutAmount(rawAmount.slice(0, 40));
  if (!amount.ok) return { status: "error", message: amountErrorMessage(amount.reason) };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_my_payout", {
    p_amount: formatMoney(amount.units),
    p_request_key: rawKey,
  });
  if (error) {
    console.error("[payouts] request failed", { code: error.code ?? null }); // amount / id kabhi log nahi
    return { status: "error", message: "We could not send your request right now. Please try again." };
  }

  const outcome = parseRequestOutcome(data);
  if (!outcome) {
    console.error("[payouts] request returned an unexpected shape");
    return { status: "error", message: "We could not confirm your request. Please check the list below before trying again." };
  }

  if (REQUEST_SUCCESS.has(outcome.outcome)) {
    revalidatePath("/dashboard/publisher/payouts");
    return { status: "success", message: requestOutcomeMessage(outcome) };
  }
  return { status: "error", message: requestOutcomeMessage(outcome) };
}
