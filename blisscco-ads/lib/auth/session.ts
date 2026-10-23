import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";

/**
 * Server par user verify karta hai. getUser() Supabase Auth server se token check karta hai.
 * getSession() server par KABHI trust nahi karte (cookie se bina verify padhta hai).
 * cache(): ek request me kai baar bulao toh network call ek hi baar.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  if (!hasSupabaseEnv()) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return data.user;
  } catch {
    return null;
  }
});

/** Protected server code ke liye: login nahi hai toh /login par bhej do. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect(hasSupabaseEnv() ? "/login" : "/login?error=config");
  return user;
}
