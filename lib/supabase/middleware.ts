import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv, requireSupabaseEnv } from "./env";
import { hardenCookieOptions } from "./cookie-options";
import { safeNextPath } from "@/lib/auth/redirect";
import { diagLog, isDiagVerbose, logIfSlow } from "@/lib/diagnostics/log";

// Production me config chhoot jaye toh protected pages band (fail closed) ho jaate hain. Wajah Vercel logs me ek baar (har instance) dikhe,
// sirf variable ke NAAM (value kabhi nahi), taaki "login error=config" ka sabab turant mile.
let warnedConfig = false;
function warnConfigUnusableOnce() {
  if (warnedConfig) return;
  warnedConfig = true;
  const names = [
    process.env.NEXT_PUBLIC_SUPABASE_URL ? "" : "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ? "" : "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ].filter(Boolean);
  console.error(
    "[config] public supabase env unusable; /dashboard is blocked.",
    names.length > 0 ? `missing: ${names.join(", ")}` : "values present but invalid (URL format ya secret key public variable me)"
  );
}

/**
 * Har matching request par:
 *  1. session cookie refresh (token expire hone se pehle),
 *  2. protected routes par getClaims() (JWT signature local verify, JWKS cached: koi network call nahi); /login aur /signup par getUser()
 *     (Supabase Auth server se asli check),
 *  3. /dashboard bina login ke => /login?next=..., login ke baad /login,/signup => /dashboard.
 * NOTE: ye pehli rok hai. Asli protection server components/actions me bhi hai (requireUser).
 */
export async function updateSession(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isProtected = pathname === "/dashboard" || pathname.startsWith("/dashboard/");
  const isAuthPage = pathname === "/login" || pathname === "/signup";

  let env: { url: string; key: string } | null = null;
  if (hasSupabaseEnv()) {
    try {
      env = requireSupabaseEnv();
    } catch {
      env = null;
    }
  }
  if (!env) warnConfigUnusableOnce();

  if (!env) {
    if (isProtected) {
      const to = request.nextUrl.clone();
      to.pathname = "/login";
      to.search = "?error=config";
      return NextResponse.redirect(to);
    }
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.url, env.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, hardenCookieOptions(options)));
      },
    },
  });

  // Is call aur createServerClient ke beech koi aur code mat likhna (session refresh toot sakta hai).
  //
  // /dashboard/*: getClaims() (asymmetric ES256 key ki signature local verify; expire token yahin refresh hota hai). Ye sirf pehli rok hai:
  // ye revoke hua session expiry tak valid maan sakta hai, isliye asli, revoke-aware check har page / action me getUser() (lib/auth/session.ts) karta hai.
  // /login, /signup: getUser() (network) hi. Warna revoked session par /dashboard -> /login -> /dashboard ka loop ban jata
  // (dashboard use bahar bhejta, middleware use wapas andar). Ye pages kam khulte hain, isliye yahan extra network call ka farq nahi padta.
  const authStartedAt = Date.now();
  let user: unknown = null;
  if (isAuthPage) {
    user = (await supabase.auth.getUser()).data.user;
  } else {
    user = (await supabase.auth.getClaims()).data?.claims ?? null;
  }

  // Diagnostics: session check dheema (3s+) ho toh Vercel logs me "[diag] event=request_slow label=middleware_session_check".
  // DIAG_VERBOSE=1 par har /dashboard request ki ek line: rsc / prefetch / conditional (if-none-match = 304 ka sambhaw) dikhta hai.
  const authMs = logIfSlow("middleware_session_check", authStartedAt, { path: pathname });
  if (isDiagVerbose() && (isProtected || isAuthPage)) {
    diagLog("request_trace", {
      path: pathname,
      method: request.method,
      authMs,
      loggedIn: Boolean(user),
      rsc: request.headers.get("rsc") === "1",
      prefetch: Boolean(request.headers.get("next-router-prefetch")),
      conditional: Boolean(request.headers.get("if-none-match") || request.headers.get("if-modified-since")),
    });
  }

  const redirectWithCookies = (to: URL) => {
    const redirectResponse = NextResponse.redirect(to);
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  };

  if (!user && isProtected) {
    const to = request.nextUrl.clone();
    to.pathname = "/login";
    to.search = `?next=${encodeURIComponent(pathname + search)}`;
    return redirectWithCookies(to);
  }

  if (user && isAuthPage) {
    const to = request.nextUrl.clone();
    const next = safeNextPath(request.nextUrl.searchParams.get("next"));
    const target = new URL(next, request.nextUrl.origin);
    to.pathname = target.pathname;
    to.search = target.search;
    return redirectWithCookies(to);
  }

  return response;
}
