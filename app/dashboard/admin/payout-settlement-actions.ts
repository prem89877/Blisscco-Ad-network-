"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/campaigns/constants";
import {
  PAYOUT_REASON_MAX,
  SETTLEMENT_OUTCOME_MESSAGES,
  SETTLEMENT_SUCCESS,
  isSettlementAction,
  parseExternalReference,
  parsePayoutReason,
  parseSettlementOutcome,
} from "@/lib/payouts/rules";
import type { RunStateResult } from "@/lib/campaigns/types";

// Phase 5 Step 5: admin payout ka bahar ka anjaam record karta hai (complete with reference / failed / reversed).
//  * Role server par (sirf admin) + database function dobara private.is_admin() (42501). Admin ka apna session: service-role key yahan nahi.
//  * "complete" = tumne paisa bahar se bhej diya aur uska payment reference likha. Blisscco koi paisa nahi bhejta, koi provider call nahi.
//  * Payouts band (payout_settings.payouts_enabled = false) ho toh database "payouts_disabled" deta hai aur kuch nahi likhta.
//  * Reference / reason log nahi hote (sirf action ka naam + error code).

export async function adminPayoutSettlementAction(_prev: RunStateResult, formData: FormData): Promise<RunStateResult> {
  await requireRole(["admin"]);

  const id = formData.get("id");
  const action = formData.get("action");
  if (typeof id !== "string" || !isUuid(id) || !isSettlementAction(action)) {
    return { status: "error", message: "That request was not understood." };
  }

  const supabase = await createClient();
  let result: { data: unknown; error: { code?: string | null } | null };

  if (action === "complete") {
    const ref = parseExternalReference(typeof formData.get("reference") === "string" ? String(formData.get("reference")).slice(0, 101) : "");
    if (!ref.ok) return { status: "error", message: ref.message };
    result = await supabase.rpc("admin_complete_payout", { p_request_id: id, p_external_reference: ref.value });
  } else {
    const raw = formData.get("reason");
    const reason = parsePayoutReason(typeof raw === "string" ? raw.slice(0, PAYOUT_REASON_MAX + 1) : "");
    if (!reason.ok) return { status: "error", message: reason.message };
    result =
      action === "fail"
        ? await supabase.rpc("admin_record_payout_failure", { p_request_id: id, p_reason: reason.value })
        : await supabase.rpc("admin_reverse_payout", { p_request_id: id, p_reason: reason.value });
  }

  if (result.error) {
    console.error("[admin] payout settlement action failed", { action, code: result.error.code ?? null });
    return { status: "error", message: result.error.code === "42501" ? SETTLEMENT_OUTCOME_MESSAGES.forbidden : "Something went wrong. Please try again." };
  }

  const outcome = parseSettlementOutcome(result.data);
  if (!outcome) {
    console.error("[admin] payout settlement action returned an unexpected shape", { action });
    return { status: "error", message: "We could not confirm the change. Refresh the page and check the status." };
  }
  if (SETTLEMENT_SUCCESS.has(outcome)) {
    revalidatePath("/dashboard/admin");
    return { status: "success", message: SETTLEMENT_OUTCOME_MESSAGES[outcome] };
  }
  return { status: "error", message: SETTLEMENT_OUTCOME_MESSAGES[outcome] };
}
