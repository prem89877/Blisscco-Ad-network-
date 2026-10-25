"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/campaigns/constants";
import { isAdminDecisionKind, validateAdminDecision, REJECT_REASON_MAX } from "@/lib/admin/decisions";
import type { RunStateResult } from "@/lib/campaigns/types";

// Admin ke faisle. Role server par check hota hai, aur database function bhi dobara admin check karti hai (private.is_admin()).
// Admin ko apne session (RLS) se hi bulaya jaata hai: service-role key yahan nahi.

export async function adminDecision(_prev: RunStateResult, formData: FormData): Promise<RunStateResult> {
  await requireRole(["admin"]);

  const kind = formData.get("kind");
  const id = formData.get("id");
  const decision = formData.get("decision");
  const rawReason = formData.get("reason");
  const reason = typeof rawReason === "string" ? rawReason.slice(0, REJECT_REASON_MAX + 1) : "";

  if (!isAdminDecisionKind(kind) || typeof id !== "string" || !isUuid(id) || typeof decision !== "string") {
    return { status: "error", message: "That request was not understood." };
  }
  const checked = validateAdminDecision(kind, decision, reason);
  if (!checked.ok) return { status: "error", message: checked.message };

  const supabase = await createClient();
  let error: { code?: string | null } | null = null;

  switch (kind) {
    case "advertiser":
      ({ error } = await supabase.rpc("admin_set_advertiser_status", { p_advertiser_id: id, p_status: checked.value }));
      break;
    case "publisher":
      ({ error } = await supabase.rpc("admin_set_publisher_status", { p_publisher_id: id, p_status: checked.value }));
      break;
    case "creative":
      ({ error } = await supabase.rpc("admin_review_creative", {
        p_creative_id: id,
        p_decision: checked.value,
        p_reason: checked.reason,
      }));
      break;
    case "campaign":
      ({ error } = await supabase.rpc("admin_review_campaign", { p_campaign_id: id, p_decision: checked.value }));
      break;
  }

  if (error) {
    console.error("[admin] decision failed", { kind, code: error.code ?? null });
    if (error.code === "42501") return { status: "error", message: "Only an admin can do this." };
    if (error.code === "22023") {
      return { status: "error", message: "The database did not allow this change (for example, a campaign needs an approved ad first)." };
    }
    return { status: "error", message: "Something went wrong. Please try again." };
  }

  revalidatePath("/dashboard/admin");
  return { status: "success", message: "Done." };
}
