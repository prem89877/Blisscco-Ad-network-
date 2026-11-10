import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { toAdvertiserCountry, type AdvertiserCountry } from "@/lib/regions/advertiser-country";

// Logged-in advertiser ki apni country (Phase 6 Step 3 Part 1). loadMyAdvertiser se ALAG hai jaan-boojh kar:
// naya column (SQL abhi apply na hui ho) ki wajah se campaigns page ya advertiser flow kabhi nahi tootta. Error => null ("could not load").
// profile_id ka filter EXPLICIT hai aur RLS alag se rokti hai.

export const loadMyAdvertiserCountry = cache(async (): Promise<AdvertiserCountry | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("advertisers").select("country_code").eq("profile_id", user.id).maybeSingle();
    if (error || !data) return null;
    return toAdvertiserCountry(data);
  } catch {
    return null;
  }
});
