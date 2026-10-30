"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv, requireSupabaseEnv } from "@/lib/supabase/env";
import { safeNextPath } from "@/lib/auth/redirect";
import { getSiteUrl } from "@/lib/auth/site-url";
import {
  normalizeEmail,
  readPassword,
  validateEmail,
  validateNewPassword,
} from "@/lib/auth/validation";
import type { AuthFormState } from "@/lib/auth/types";

// SECURITY: passwords, tokens ya poora error object kabhi log nahi karte; sirf error.code/status.

const CONFIG_ERROR = "Sign-in is not set up on this site yet. Please try again later.";

async function getClient() {
  if (!hasSupabaseEnv()) return null;
  try {
    return await createClient();
  } catch {
    return null;
  }
}

type AuthErrorLike = { code?: string; status?: number };

function isRateLimited(error: AuthErrorLike): boolean {
  return (
    error.status === 429 ||
    error.code === "over_request_rate_limit" ||
    error.code === "over_email_send_rate_limit"
  );
}

const RATE_LIMIT_MESSAGE = "Too many attempts. Please wait a minute and try again.";

/* ---------------------------- Log in ---------------------------- */
export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = normalizeEmail(formData.get("email"));
  const password = readPassword(formData.get("password"));
  const next = safeNextPath(formData.get("next"));

  const fieldErrors: NonNullable<AuthFormState["fieldErrors"]> = {};
  const emailError = validateEmail(email);
  if (emailError) fieldErrors.email = emailError;
  if (!password) fieldErrors.password = "Enter your password.";
  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors, email };
  }

  const supabase = await getClient();
  if (!supabase) return { status: "error", message: CONFIG_ERROR, email };

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    console.error("[auth] sign-in failed", { code: error.code, status: error.status });
    if (error.code === "email_not_confirmed") {
      return {
        status: "error",
        message: "Your email is not verified yet. Open the link we emailed you, or request a new one below.",
        needsVerification: true,
        email,
      };
    }
    if (isRateLimited(error)) return { status: "error", message: RATE_LIMIT_MESSAGE, email };
    // Galat password aur unknown email ka message same: koi account-guessing nahi.
    return {
      status: "error",
      message:
        error.code === "invalid_credentials"
          ? "Incorrect email or password."
          : "We could not log you in. Please try again.",
      email,
    };
  }

  redirect(next);
}

/* ---------------------------- Sign up ---------------------------- */
export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = normalizeEmail(formData.get("email"));
  const password = readPassword(formData.get("password"));
  const confirmPassword = readPassword(formData.get("confirmPassword"));
  // Account type sirf shuruaati choice hai. Database trigger sirf advertiser/publisher maanta hai;
  // admin banna yahan se mumkin hi nahi.
  const accountType = formData.get("accountType") === "publisher" ? "publisher" : "advertiser";

  const fieldErrors: NonNullable<AuthFormState["fieldErrors"]> = {};
  const emailError = validateEmail(email);
  if (emailError) fieldErrors.email = emailError;
  const passwordError = validateNewPassword(password);
  if (passwordError) fieldErrors.password = passwordError;
  if (!passwordError && confirmPassword !== password) {
    fieldErrors.confirmPassword = "Passwords do not match.";
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors, email };
  }

  const supabase = await getClient();
  if (!supabase) return { status: "error", message: CONFIG_ERROR, email };

  const siteUrl = await getSiteUrl();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${siteUrl}/auth/confirm`,
      data: { role: accountType },
    },
  });

  if (error) {
    console.error("[auth] sign-up failed", { code: error.code, status: error.status });
    if (isRateLimited(error)) return { status: "error", message: RATE_LIMIT_MESSAGE, email };
    if (error.code === "weak_password") {
      return {
        status: "error",
        message: "Please choose a stronger password.",
        fieldErrors: { password: "This password is too easy to guess. Try a longer or less common one." },
        email,
      };
    }
    return {
      status: "error",
      message: "We could not create your account. If you already have one, log in instead.",
      email,
    };
  }

  // Email verification OFF hai toh session mil jata hai: seedha dashboard.
  if (data.session) redirect("/dashboard");

  // Verification ON: same message naye aur purane email dono ke liye (account-guessing nahi).
  return {
    status: "success",
    message: `We sent a verification link to ${email}. Open it to finish creating your account, then log in.`,
    email,
  };
}

/* ---------------------- Google (OAuth) ---------------------- */
// Flow: yahan se Supabase -> Google -> Supabase -> /auth/confirm?code=... (wahan code exchange hota hai).
// `next` redirectTo me nahi bhejte: Supabase ki allow-list exact URL match karti hai, isliye
// hamesha plain /auth/confirm; login ke baad default /dashboard.
// Naya Google user bhi database trigger se role = advertiser pata hai (admin kabhi nahi).
export async function signInWithGoogle(): Promise<void> {
  const supabase = await getClient();
  if (!supabase) redirect("/login?error=config");

  let target: string | null = null;
  try {
    const siteUrl = await getSiteUrl();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${siteUrl}/auth/confirm` },
    });
    if (error) {
      console.error("[auth] google oauth start failed", { code: error.code, status: error.status });
    } else if (data.url) {
      // Sirf apne Supabase project ka URL maano (open redirect se bachav).
      const expected = new URL(requireSupabaseEnv().url).origin;
      if (new URL(data.url).origin === expected) target = data.url;
    }
  } catch {
    target = null;
  }

  // redirect() try/catch ke bahar
  if (!target) redirect("/login?error=oauth_failed");
  redirect(target);
}

/* ---------------------- Resend verification ---------------------- */
export async function resendVerification(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = normalizeEmail(formData.get("email"));
  const emailError = validateEmail(email);
  if (emailError) return { status: "error", message: emailError, email };

  const supabase = await getClient();
  if (!supabase) return { status: "error", message: CONFIG_ERROR, email };

  const siteUrl = await getSiteUrl();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: `${siteUrl}/auth/confirm` },
  });

  if (error) {
    console.error("[auth] resend failed", { code: error.code, status: error.status });
    if (isRateLimited(error)) return { status: "error", message: RATE_LIMIT_MESSAGE, email };
    return { status: "error", message: "We could not send the email. Please try again later.", email };
  }
  return {
    status: "success",
    message: "If this email is waiting for verification, a new link is on its way.",
    email,
  };
}

/* ---------------------------- Log out ---------------------------- */
export async function signOut(): Promise<void> {
  const supabase = await getClient();
  if (supabase) {
    // scope "local": sirf is device ka session band hota hai (doosre devices logged in rehte hain).
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) console.error("[auth] sign-out failed", { code: error.code, status: error.status });
  }
  redirect("/login?message=signed_out");
}
