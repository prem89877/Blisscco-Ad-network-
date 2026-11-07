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
export type CurrentAccount = { user: User; role: AccountRole; status: AccountStatus; roleChoicePending: boolean };

function isRole(v: unknown): v is AccountRole {
  return v === "advertiser" || v === "publisher" || v === "admin";
}
function isStatus(v: unknown): v is AccountStatus {
  return v === "active" || v === "suspended";
}

/**
 * Verified user id (JWT ka `sub`), bina network ke: getClaims() ES256 signature JWKS se local verify karta hai.
 * SIRF id yahan se li jati hai (taaki profile query getUser() ke saath parallel shuru ho). Role / status KABHI claims se nahi:
 * wo database se aate hain, aur user ki asli pehchaan (revoke-aware) abhi bhi getCurrentUser() / getUser() se hoti hai.
 */
const getVerifiedUserId = cache(async (): Promise<string | null> => {
  if (!hasSupabaseEnv()) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    const sub = data?.claims?.sub;
    return error || typeof sub !== "string" || sub.length === 0 ? null : sub;
  } catch {
    return null;
  }
});

async function loadProfileRow(userId: string) {
  const supabase = await createClient();
  let { data, error } = await supabase
    .from("profiles")
    .select("role, status, role_choice_pending")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    // role_choice_pending column abhi database me na ho (migration baaki) toh purani query: login band nahi hota.
    ({ data, error } = await supabase.from("profiles").select("role, status").eq("id", userId).maybeSingle());
  }
  return { data, error };
}

/**
 * Logged-in user ka role/status database se (profiles table, RLS ke saath: user sirf apni row dekh sakta hai).
 * Role KABHI user_metadata/JWT claim se nahi liya jata (wo user badal sakta hai).
 * Row na mile ya query fail ho => null (fail closed).
 * Speed: getUser() (network) aur profile query ek saath chalti hain (pehle ek ke baad ek). Dono ka user ek hi hona chahiye
 * (getUser().id == verified claims sub), warna null: getUser() fail / revoked session par profile ka data kabhi use nahi hota.
 */
export const getCurrentAccount = cache(async (): Promise<CurrentAccount | null> => {
  const userId = await getVerifiedUserId();
  if (!userId) return null;
  try {
    const [user, profile] = await Promise.all([getCurrentUser(), loadProfileRow(userId)]);
    if (!user || user.id !== userId) return null;
    const { data, error } = profile;
    if (error || !data) return null;
    const row = data as { role?: unknown; status?: unknown; role_choice_pending?: unknown };
    if (!isRole(row.role) || !isStatus(row.status)) return null;
    return { user, role: row.role, status: row.status, roleChoicePending: row.role_choice_pending === true };
  } catch {
    return null;
  }
});

/**
 * Har protected dashboard PAGE me bulao (sirf layout par bharosa mat karo: Next.js me layout
 * page badalne par dobara nahi chalta). Login nahi => /login. Account suspended/missing => status page.
 */
export async function requireAccount(): Promise<CurrentAccount> {
  // Speed: user ka asli check aur profile query ek saath. requireUser redirect (throw) kare toh wahi redirect aage badhta hai;
  // getCurrentAccount kabhi throw nahi karta (fail closed => null).
  const [, account] = await Promise.all([requireUser(), getCurrentAccount()]);
  if (!account || account.status !== "active") redirect("/dashboard/account-status");
  // Naya Google user jisne abhi account type nahi chuna: pehle wahi (koi dashboard page nahi khulta).
  if (account.roleChoicePending) redirect("/auth/choose-role");
  return account;
}

/** Role-specific page ke liye. Galat role => /dashboard (overview). Admin ko allowed list me khud daalo. */
export async function requireRole(allowed: AccountRole[]): Promise<CurrentAccount> {
  const account = await requireAccount();
  if (!allowed.includes(account.role)) redirect("/dashboard");
  return account;
}
