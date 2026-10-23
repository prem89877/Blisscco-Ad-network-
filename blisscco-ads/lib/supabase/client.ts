import { createBrowserClient } from "@supabase/ssr";
import { requireSupabaseEnv } from "./env";

// Browser (client components) ke liye. Sirf publishable key use hoti hai.
export function createClient() {
  const { url, key } = requireSupabaseEnv();
  return createBrowserClient(url, key);
}
