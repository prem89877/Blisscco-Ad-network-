import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { safeNextPath } from "@/lib/auth/redirect";
import { OAUTH_INTENT_COOKIE, CHOOSE_ROLE_PATH, isFreshGoogleSignup, parseIntent } from "@/lib/auth/oauth-intent";
import { handleNewGoogleUser } from "@/lib/auth/oauth-role";

// Email verification link yahin aata hai (token_hash flow: link kisi bhi browser/app me khule toh chalta hai).
// Purana ?code= (PKCE) link bhi sambhalta hai. Success => session cookie set + /dashboard.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  const code = params.get("code");
  let next = safeNextPath(params.get("next"));

  if (!hasSupabaseEnv()) redirect("/login?error=config");

  let ok = false;
  try {
    const supabase = await createClient();
    if (tokenHash && (type === "email" || type === "signup")) {
      const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
      ok = !error;
      if (error) console.error("[auth] verifyOtp failed", { code: error.code, status: error.status });
    } else if (code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      ok = !error;
      if (error) console.error("[auth] code exchange failed", { code: error.code, status: error.status });
      // Abhi-abhi bana Google user: account type user ki choice se (signup) ya use poochkar (login). Mojooda users ko nahi chhuta.
      if (!error && isFreshGoogleSignup(data.user)) {
        const jar = await cookies();
        const intent = parseIntent(jar.get(OAUTH_INTENT_COOKIE)?.value);
        jar.delete(OAUTH_INTENT_COOKIE);
        const result = await handleNewGoogleUser(data.user.id, intent);
        if (result === "choose") next = CHOOSE_ROLE_PATH;
      }
    }
  } catch {
    ok = false;
  }

  // redirect() try/catch ke bahar (wo exception ke roop me kaam karta hai)
  if (ok) redirect(next);
  redirect("/login?error=confirm_failed");
}
