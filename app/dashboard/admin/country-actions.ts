"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/campaigns/constants";
import { isCountryReviewDecision, mapCountryError, parseCountrySubmission } from "@/lib/regions/publisher-country";
import type { RunStateResult } from "@/lib/campaigns/types";

// Admin publisher ki country approve / reject karta hai. Role server par pehle check hota hai (admin hi), aur database function
// (admin_review_publisher_country) private.is_admin() dobara check karti hai. Admin id database me auth.uid() se likhta hai:
// form se reviewer / status / time kuch nahi liya jaata. expectedCountry = jo country admin ne screen par dekhi (badli ho toh approve nahi hota).

export async function adminReviewPublisherCountry(_prev: RunStateResult, formData: FormData): Promise<RunStateResult> {
  await requireRole(["admin"]);

  const id = formData.get("id");
  const decision = formData.get("decision");
  const expected = formData.get("expectedCountry");
  if (typeof id !== "string" || !isUuid(id) || !isCountryReviewDecision(decision) || typeof expected !== "string") {
    return { status: "error", message: "That request was not understood." };
  }
  const country = parseCountrySubmission(expected.slice(0, 16));
  // Approve sirf ISO-valid country ka. Reject hamesha ho sakta hai (galat/invalid country wapas lena bhi).
  if (decision === "approve" && !country.ok) {
    return { status: "error", message: "This country code is not a valid ISO country code, so it cannot be approved. Reject it instead." };
  }
  const expectedCountry = country.ok ? country.countryCode : expected.trim().toUpperCase().slice(0, 2);

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_review_publisher_country", {
    p_publisher_id: id,
    p_decision: decision,
    p_expected_country: expectedCountry,
  });
  if (error) {
    console.error("[admin] country review failed", { code: error.code ?? null, hint: error.hint ?? null });
    return { status: "error", message: mapCountryError(error) };
  }

  revalidatePath("/dashboard/admin");
  return { status: "success", message: "Done." };
}
