import { NextResponse } from "next/server";
import { hasSupabaseEnv, requireSupabaseEnv } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

// Optional config check (server par chalta hai). Koi table/DB query/login nahi.
// Sirf Supabase Auth ki public settings ping karta hai.
export async function GET() {
  if (!hasSupabaseEnv()) {
    return NextResponse.json({ configured: false, reachable: false });
  }
  try {
    const { url, key } = requireSupabaseEnv();
    const res = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: key },
      cache: "no-store",
    });
    return NextResponse.json({ configured: true, reachable: res.ok, status: res.status });
  } catch {
    return NextResponse.json({ configured: false, reachable: false });
  }
}
