import { NextResponse } from "next/server";
import { hasSupabaseEnv, requireSupabaseEnv } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

// Public health check. Sirf ek fixed jawab: "ok" ya "unavailable".
// Ye database tak ek chhota round-trip karta hai (public.health_ping(), jo sirf `true` lautata hai).
// Koi table/user data nahi padhta, aur kabhi error text, status code, URL ya config details bahar nahi bhejta
// (taaki koi bahari vyakti hamare setup ke baare me kuch na jaan sake). Detail sirf server logs me.
// Pehle supabase/sql/day-3-7-health-check.sql Supabase me chalana zaroori hai.
const HEADERS = { "Cache-Control": "no-store" };
const TIMEOUT_MS = 4000;

export async function GET() {
  let ok = false;

  if (hasSupabaseEnv()) {
    const timer = new AbortController();
    const timeoutId = setTimeout(() => timer.abort(), TIMEOUT_MS);
    try {
      const { url, key } = requireSupabaseEnv();
      const res = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/rpc/health_ping`, {
        method: "POST",
        headers: { apikey: key, "Content-Type": "application/json" },
        body: "{}",
        cache: "no-store",
        signal: timer.signal,
      });
      ok = res.ok && (await res.json()) === true;
      if (!ok) console.error("[health] db ping failed", { status: res.status });
    } catch {
      console.error("[health] db ping error");
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return NextResponse.json({ status: ok ? "ok" : "unavailable" }, { status: ok ? 200 : 503, headers: HEADERS });
}
