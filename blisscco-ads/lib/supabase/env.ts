// Supabase env variables ek hi jagah se padhte hain.
// NEXT_PUBLIC_ wale browser me bhi chalte hain (publishable key public hoti hai).

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export function hasSupabaseEnv(): boolean {
  return Boolean(supabaseUrl && supabasePublishableKey);
}

export function requireSupabaseEnv(): { url: string; key: string } {
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      "Supabase env missing: NEXT_PUBLIC_SUPABASE_URL aur NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY set karo."
    );
  }
  return { url: supabaseUrl, key: supabasePublishableKey };
}
