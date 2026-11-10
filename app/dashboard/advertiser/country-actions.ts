"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { mapAdvertiserCountryError, parseAdvertiserCountry } from "@/lib/regions/advertiser-country";
import type { RunStateResult } from "@/lib/campaigns/types";

// Advertiser apni business country chunta / badalta hai. Advertiser kaun hai ye login se (profile_id filter);
// form se sirf country code lete hain: status / id / profile_id / region jaisa koi field kabhi nahi padhte ya bhejte.
// Region store nahi hota (central mapping se nikalta hai). Pricing / billing (USD) is action ko nahi chhoote.

export async function updateAdvertiserCountry(_prev: RunStateResult, formData: FormData): Promise<RunStateResult> {
  const account = await requireRole(["advertiser"]);

  const raw = formData.get("country");
  const checked = parseAdvertiserCountry(typeof raw === "string" ? raw.slice(0, 16) : "");
  if (!checked.ok) return { status: "error", message: checked.message };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("advertisers")
    .update({ country_code: checked.countryCode })
    .eq("profile_id", account.user.id)
    .select("id");
  if (error) {
    console.error("[advertiser] country update failed", { code: error.code ?? null });
    return { status: "error", message: mapAdvertiserCountryError(error) };
  }
  if (!data || data.length === 0) return { status: "error", message: "Please set up your business details first." };

  revalidatePath("/dashboard/advertiser/campaigns");
  return { status: "success", message: "Country saved." };
}
