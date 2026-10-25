import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// SIRF server ke liye. Secret key RLS bypass karti hai.
// "server-only" ki wajah se ise client component me import karoge toh build fail hoga.
// Sirf lib/ads/match.ts (purana single-call bridge), lib/ads/candidate-loader.ts (read-only loader), lib/ads/serve-db.ts (authorize + serve record)
// aur lib/publisher/keys-db.ts (publisher key self-service) isse use karte hain. Aur kahin import mat karna.
// Har database call ka time-out (Day 7): Supabase atak jaye toh function latka nahi rehta, jaldi 503 milta hai.
const DB_TIMEOUT_MS = 8000;

// Ek server instance me client ek hi baar banta hai (pehle har rpc par naya banta tha: ek request me 3 baar).
// Client me koi user/session state nahi (persistSession: false), isliye alag requests ke beech share karna surakshit hai.
let cached: { url: string; secretKey: string; client: SupabaseClient } | null = null;

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    // Sirf variable ke NAAM log hote hain, value kabhi nahi: Vercel logs me turant dikhe ki kya chhoot gaya.
    const missing = [!url ? "NEXT_PUBLIC_SUPABASE_URL" : "", !secretKey ? "SUPABASE_SECRET_KEY" : ""].filter(Boolean);
    console.error("[config] missing server env:", missing.join(", "));
    throw new Error("NEXT_PUBLIC_SUPABASE_URL aur SUPABASE_SECRET_KEY set karo.");
  }
  if (cached && cached.url === url && cached.secretKey === secretKey) return cached.client;
  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        const timeout = AbortSignal.timeout(DB_TIMEOUT_MS);
        const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
        return fetch(input, { ...init, signal });
      },
    },
  });
  cached = { url, secretKey, client };
  return client;
}
