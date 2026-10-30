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

/* ---------------- Account (role + status) ---------------- */

export type AccountRole = "advertiser" | "publisher" | "admin";
export type AccountStatus = "active" | "suspended";
export type CurrentAccount = { user: User; role: AccountRole; status: AccountStatus };

function isRole(v: unknown): v is AccountRole {
  return v === "advertiser" || v === "publisher" || v === "admin";
}
function isStatus(v: unknown): v is AccountStatus {
  return v === "active" || v === "suspended";
}

/**
 * Logged-in user ka role/status database se (profiles table, RLS ke saath: user sirf apni row dekh sakta hai).
 * Role KABHI user_metadata/JWT claim se nahi liya jata (wo user badal sakta hai).
 * Row na mile ya query fail ho => null (fail closed).
 */
export const getCurrentAccount = cache(async (): Promise<CurrentAccount | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("role, status")
      .eq("id", user.id)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as { role?: unknown; status?: unknown };
    if (!isRole(row.role) || !isStatus(row.status)) return null;
    return { user, role: row.role, status: row.status };
  } catch {
    return null;
  }
});

/**
 * Har protected dashboard PAGE me bulao (sirf layout par bharosa mat karo: Next.js me layout
 * page badalne par dobara nahi chalta). Login nahi => /login. Account suspended/missing => status page.
 */
export async function requireAccount(): Promise<CurrentAccount> {
  await requireUser();
  const account = await getCurrentAccount();
  if (!account || account.status !== "active") redirect("/dashboard/account-status");
  return account;
}

/** Role-specific page ke liye. Galat role => /dashboard (overview). Admin ko allowed list me khud daalo. */
export async function requireRole(allowed: AccountRole[]): Promise<CurrentAccount> {
  const account = await requireAccount();
  if (!allowed.includes(account.role)) redirect("/dashboard");
  return account;
}
