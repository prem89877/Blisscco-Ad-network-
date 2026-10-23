import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv, requireSupabaseEnv } from "./env";
import { safeNextPath } from "@/lib/auth/redirect";

/**
 * Har matching request par:
 *  1. session cookie refresh (token expire hone se pehle),
 *  2. getUser() se server par verify,
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
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Is call aur createServerClient ke beech koi aur code mat likhna (session refresh toot sakta hai).
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
