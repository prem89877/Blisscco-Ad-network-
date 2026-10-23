import "server-only";
import { createClient } from "@supabase/supabase-js";

// SIRF server ke liye. Secret key RLS bypass karti hai.
// "server-only" ki wajah se ise client component me import karoge toh build fail hoga.
// Abhi kahin use nahi ho raha.
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
