"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/campaigns/constants";
import {
  PAYOUT_REASON_MAX,
  REVIEW_OUTCOME_MESSAGES,
  REVIEW_SUCCESS,
  isAdminPayoutAction,
  parsePayoutReason,
  parseReviewOutcome,
} from "@/lib/payouts/rules";
import type { RunStateResult } from "@/lib/campaigns/types";

// Admin payout request ko approve / reject / "paid" mark karta hai.
//
//  * Role server par check hota hai (sirf "admin"), AUR database function bhi dobara private.is_admin() check karti hai (42501). UI ka chhupa button koi rok nahi.
//  * Admin ko apne session (RLS / auth.uid()) se bulaya jata hai: service-role key yahan nahi.
//  * "paid" SIRF record hai ki admin ne paisa bahar se manually bhej diya. Yahan koi transfer, koi payment provider, koi ledger entry nahi.
//  * Valid transitions DATABASE ka guard trigger tay karta hai (requested -> approved | rejected, approved -> paid | rejected).

export async function adminPayoutAction(_prev: RunStateResult, formData: FormData): Promise<RunStateResult> {
  await requireRole(["admin"]);

  const id = formData.get("id");
  const action = formData.get("action");
  const rawReason = formData.get("reason");
  if (typeof id !== "string" || !isUuid(id) || !isAdminPayoutAction(action)) {
    return { status: "error", message: "That request was not understood." };
  }

  const supabase = await createClient();
  let result: { data: unknown; error: { code?: string | null } | null };

  if (action === "paid") {
    result = await supabase.rpc("admin_mark_payout_paid", { p_request_id: id });
  } else if (action === "approve") {
    result = await supabase.rpc("admin_review_payout_request", { p_request_id: id, p_decision: "approve", p_reason: null });
  } else {
    const reason = parsePayoutReason(typeof rawReason === "string" ? rawReason.slice(0, PAYOUT_REASON_MAX + 1) : "");
    if (!reason.ok) return { status: "error", message: reason.message };
    result = await supabase.rpc("admin_review_payout_request", { p_request_id: id, p_decision: "reject", p_reason: reason.value });
  }

  if (result.error) {
    console.error("[admin] payout action failed", { action, code: result.error.code ?? null });
    return { status: "error", message: result.error.code === "42501" ? REVIEW_OUTCOME_MESSAGES.forbidden : "Something went wrong. Please try again." };
  }

  const outcome = parseReviewOutcome(result.data);
  if (!outcome) {
    console.error("[admin] payout action returned an unexpected shape", { action });
    return { status: "error", message: "We could not confirm the change. Refresh the page and check the status." };
  }

  if (REVIEW_SUCCESS.has(outcome.outcome)) {
    revalidatePath("/dashboard/admin");
    return { status: "success", message: REVIEW_OUTCOME_MESSAGES[outcome.outcome] };
  }
  return { status: "error", message: REVIEW_OUTCOME_MESSAGES[outcome.outcome] };
}
