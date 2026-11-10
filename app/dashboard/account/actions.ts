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
import { parseCountrySubmission } from "@/lib/regions/publisher-country";
import { parseAdvertiserCountry } from "@/lib/regions/advertiser-country";

// Naye user ka business/platform ka record banana. profile_id HAMESHA login se aata hai (form se kabhi nahi).
// Naya record "pending" se shuru hota hai: admin approve kare tab hi kaam chalta hai.
// Database ka RLS + CHECK alag se rokta hai (sirf apni row, sirf https URL).

function text(fd: FormData, key: string, max: number): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.slice(0, max) : "";
}

export async function setupAdvertiser(_prev: SetupState<AdvertiserFields>, formData: FormData): Promise<SetupState<AdvertiserFields>> {
  const account = await requireRole(["advertiser"]);
  // Phase 6 Step 3 Part 1: country optional hai. Form me na ho toh values / insert bilkul pehle jaise (country key tab hi aati hai jab bheji gayi).
  const countryInput = text(formData, "country", 16).trim();
  const values = {
    companyName: text(formData, "companyName", 400),
    websiteUrl: text(formData, "websiteUrl", 2100),
    ...(countryInput.length > 0 ? { country: countryInput } : {}),
  };

  const parsed = parseAdvertiserSetup({ companyName: values.companyName, websiteUrl: values.websiteUrl });
  // Di ho toh officially assigned ISO 3166-1 alpha-2 code hi chalega (central region module se). Galat code => error, koi silent region nahi.
  const country = countryInput.length > 0 ? parseAdvertiserCountry(countryInput) : null;
  if (!parsed.ok || (country !== null && !country.ok)) {
    const fieldErrors = { ...(parsed.ok ? {} : parsed.errors), ...(country !== null && !country.ok ? { country: country.message } : {}) };
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors, values };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("advertisers").insert({
    profile_id: account.user.id,
    company_name: parsed.value.companyName,
    website_url: parsed.value.websiteUrl,
  });

  // 23505 = record pehle se hai (do baar click): wahi maan lo, error nahi. Purani row / country nahi badalti.
  if (error && error.code !== "23505") {
    console.error("[account] advertiser setup failed", { code: error.code ?? null });
    return { status: "error", message: "We could not save your details. Please try again.", values };
  }

  // Country (optional) signup insert ke BAAD alag update se jaati hai: insert pehle jaisa rehta hai (naya column na ho tab bhi account banta hai).
  // Country save na ho toh account ban chuka hai: campaigns page par dobara chun sakta hai.
  if (!error && country !== null && country.ok) {
    const { error: countryError } = await supabase.from("advertisers").update({ country_code: country.countryCode }).eq("profile_id", account.user.id);
    if (countryError) console.error("[account] advertiser country save failed", { code: countryError.code ?? null });
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
    country: text(formData, "country", 16),
  };

  const parsed = parsePublisherSetup({ name: values.name, websiteUrl: values.websiteUrl, category: values.category });
  // Phase 6 Step 2 Part 1: country optional hai; di ho toh officially assigned ISO 3166-1 alpha-2 code hi chalega (central region module se).
  const countryInput = values.country.trim();
  const country = countryInput.length > 0 ? parseCountrySubmission(countryInput) : null;
  if (!parsed.ok || (country !== null && !country.ok)) {
    const fieldErrors = { ...(parsed.ok ? {} : parsed.errors), ...(country !== null && !country.ok ? { country: country.message } : {}) };
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors, values };
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

  // Phase 6 Step 2 Part 1: country (optional) alag, database function se jaati hai: hamesha "pending" (publisher khud verify nahi kar sakta).
  // Insert me country columns nahi jaate (unka GRANT nahi hai). Country save na ho toh account ban chuka hai: publisher page par dobara bhej sakta hai.
  if (country !== null && country.ok) {
    const { error: countryError } = await supabase.rpc("submit_publisher_country", { p_country_code: country.countryCode });
    if (countryError) console.error("[account] publisher country submit failed", { code: countryError.code ?? null, hint: countryError.hint ?? null });
  }

  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/publisher?setup=1");
}
