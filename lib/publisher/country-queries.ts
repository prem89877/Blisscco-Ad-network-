import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { toPublisherCountry, type PublisherCountry } from "@/lib/regions/publisher-country";

// Logged-in publisher ki apni country state (Phase 6 Step 2 Part 1). loadMyPublisher se ALAG hai jaan-boojh kar:
// naye columns (SQL abhi apply na hui ho) ki wajah se publisher page ya key flow kabhi nahi tootta. Error => null ("could not load").
// profile_id ka filter EXPLICIT hai aur RLS alag se rokti hai.

export const loadMyPublisherCountry = cache(async (): Promise<PublisherCountry | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("publishers")
      .select("country_code, country_status, country_submitted_at, country_reviewed_at")
      .eq("profile_id", user.id)
      .maybeSingle();
    if (error || !data) return null;
    return toPublisherCountry(data);
  } catch {
    return null;
  }
});
