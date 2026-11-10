"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { mapCountryError, parseCountrySubmission } from "@/lib/regions/publisher-country";
import type { RunStateResult } from "@/lib/campaigns/types";

// Publisher apni country bhejta hai. Hamesha "pending" banti hai: publisher kabhi apni country verify nahi kar sakta.
// Publisher kaun hai ye login se (database function me auth.uid()); form se sirf country code lete hain,
// status / verified / admin / publisher id jaisa koi field kabhi nahi padhte ya bhejte.

export async function submitPublisherCountry(_prev: RunStateResult, formData: FormData): Promise<RunStateResult> {
  await requireRole(["publisher"]);

  const raw = formData.get("country");
  const checked = parseCountrySubmission(typeof raw === "string" ? raw.slice(0, 16) : "");
  if (!checked.ok) return { status: "error", message: checked.message };

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_publisher_country", { p_country_code: checked.countryCode });
  if (error) {
    console.error("[publisher] country submit failed", { code: error.code ?? null, hint: error.hint ?? null });
    return { status: "error", message: mapCountryError(error) };
  }

  revalidatePath("/dashboard/publisher");
  return { status: "success", message: "Country saved. It will be used for regional ads after our team verifies it." };
}
