import "server-only";
import { createClient } from "@supabase/supabase-js";

// SIRF server ke liye. Secret key RLS bypass karti hai.
// "server-only" ki wajah se ise client component me import karoge toh build fail hoga.
// Day 5 se sirf lib/ads/match.ts (publisher ad-matching API) aur lib/ads/candidate-loader.ts (read-only loader) isse use karte hain. Aur kahin import mat karna.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL aur SUPABASE_SECRET_KEY set karo.");
  }
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
