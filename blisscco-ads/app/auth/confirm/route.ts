import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { safeNextPath } from "@/lib/auth/redirect";

// Email verification link yahin aata hai (token_hash flow: link kisi bhi browser/app me khule toh chalta hai).
// Purana ?code= (PKCE) link bhi sambhalta hai. Success => session cookie set + /dashboard.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  const code = params.get("code");
  const next = safeNextPath(params.get("next"));

  if (!hasSupabaseEnv()) redirect("/login?error=config");

  let ok = false;
  try {
    const supabase = await createClient();
    if (tokenHash && (type === "email" || type === "signup")) {
      const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
      ok = !error;
      if (error) console.error("[auth] verifyOtp failed", { code: error.code, status: error.status });
    } else if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      ok = !error;
      if (error) console.error("[auth] code exchange failed", { code: error.code, status: error.status });
    }
  } catch {
    ok = false;
  }

  // redirect() try/catch ke bahar (wo exception ke roop me kaam karta hai)
  if (ok) redirect(next);
  redirect("/login?error=confirm_failed");
}
