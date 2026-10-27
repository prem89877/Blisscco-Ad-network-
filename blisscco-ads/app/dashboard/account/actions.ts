"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  mapPublisherSetupError,
  parseAdvertiserSetup,
  parsePublisherSetup,
  type AdvertiserFields,
  type PublisherFields,
  type SetupState,
} from "@/lib/accounts/validation";

// Naye user ka business/platform ka record banana. profile_id HAMESHA login se aata hai (form se kabhi nahi).
// Naya record "pending" se shuru hota hai: admin approve kare tab hi kaam chalta hai.
// Database ka RLS + CHECK alag se rokta hai (sirf apni row, sirf https URL).

function text(fd: FormData, key: string, max: number): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.slice(0, max) : "";
}

export async function setupAdvertiser(_prev: SetupState<AdvertiserFields>, formData: FormData): Promise<SetupState<AdvertiserFields>> {
  const account = await requireRole(["advertiser"]);
  const values = { companyName: text(formData, "companyName", 400), websiteUrl: text(formData, "websiteUrl", 2100) };

  const parsed = parseAdvertiserSetup(values);
  if (!parsed.ok) {
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors: parsed.errors, values };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("advertisers").insert({
    profile_id: account.user.id,
    company_name: parsed.value.companyName,
    website_url: parsed.value.websiteUrl,
  });

  // 23505 = record pehle se hai (do baar click): wahi maan lo, error nahi.
  if (error && error.code !== "23505") {
    console.error("[account] advertiser setup failed", { code: error.code ?? null });
    return { status: "error", message: "We could not save your details. Please try again.", values };
  }

  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/advertiser/campaigns?setup=1");
}

export async function setupPublisher(_prev: SetupState<PublisherFields>, formData: FormData): Promise<SetupState<PublisherFields>> {
  const account = await requireRole(["publisher"]);
  const values = {
    name: text(formData, "name", 400),
    websiteUrl: text(formData, "websiteUrl", 2100),
    category: text(formData, "category", 100),
  };

  const parsed = parsePublisherSetup(values);
  if (!parsed.ok) {
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors: parsed.errors, values };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("publishers").insert({
    profile_id: account.user.id,
    name: parsed.value.name,
    website_url: parsed.value.websiteUrl,
    category: parsed.value.category,
  });

  // 23505 = publisher record pehle se hai (do baar click ya doosre tab se). Purani row nahi badalti, isliye
  // "details saved" ka banner nahi dikhate: seedha publisher page, jo asli saved details aur status dikhata hai.
  if (error && error.code === "23505") {
    revalidatePath("/dashboard", "layout");
    redirect("/dashboard/publisher");
  }
  if (error) {
    console.error("[account] publisher setup failed", { code: error.code ?? null });
    const failure = mapPublisherSetupError(error);
    return { status: "error", message: failure.message, fieldErrors: failure.fieldErrors, values };
  }

  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/publisher?setup=1");
}
