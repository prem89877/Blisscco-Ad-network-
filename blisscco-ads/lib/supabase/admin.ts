import "server-only";
import { createClient } from "@supabase/supabase-js";

// SIRF server ke liye. Secret key RLS bypass karti hai.
// "server-only" ki wajah se ise client component me import karoge toh build fail hoga.
// Sirf lib/ads/match.ts (purana single-call bridge), lib/ads/candidate-loader.ts (read-only loader), lib/ads/serve-db.ts (authorize + serve record)
// aur lib/publisher/keys-db.ts (publisher key self-service) isse use karte hain. Aur kahin import mat karna.
// Har database call ka time-out (Day 7): Supabase atak jaye toh function latka nahi rehta, jaldi 503 milta hai.
const DB_TIMEOUT_MS = 8000;

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL aur SUPABASE_SECRET_KEY set karo.");
  }
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const timeout = AbortSignal.timeout(DB_TIMEOUT_MS);
        const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
        return fetch(input, { ...init, signal });
      },
    },
  });
}
