"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { validateStopRequest } from "@/lib/ads/emergency-stop";
import type { RunStateResult } from "@/lib/campaigns/types";

// Emergency stop button (Phase 5 Step 4). Role server par check hota hai, aur database function bhi dobara admin check karti hai.
// Admin ke apne session se hi bulaya jaata hai: service-role key yahan nahi. Sirf naya serve rokta / chalu karta hai; billing, ledger, payout nahi.

export async function setAdServingStopped(_prev: RunStateResult, formData: FormData): Promise<RunStateResult> {
  await requireRole(["admin"]);

  const checked = validateStopRequest(formData.get("action"), formData.get("reason"));
  if (!checked.ok) return { status: "error", message: checked.message };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_ad_serving_stopped", { p_stopped: checked.stopped, p_reason: checked.reason });
  if (error) {
    console.error("[admin] ad serving switch failed", { code: error.code ?? null });
    return { status: "error", message: "Could not change the switch. Please try again." };
  }

  revalidatePath("/dashboard/admin");
  return { status: "success", message: checked.stopped ? "Ad serving is stopped." : "Ad serving is running again." };
}
