import { NextResponse } from "next/server";
import { hasSupabaseEnv, supabaseUrl, supabasePublishableKey } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

// Connection test: browser me /api/supabase-health kholo.
// Koi table ya login nahi chahiye; sirf Supabase Auth ki public settings ping karta hai.
export async function GET() {
  if (!hasSupabaseEnv()) {
    return NextResponse.json({ configured: false, reachable: false }, { status: 200 });
  }
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: supabasePublishableKey as string },
      cache: "no-store",
    });
    return NextResponse.json({ configured: true, reachable: res.ok, status: res.status });
  } catch {
    return NextResponse.json({ configured: true, reachable: false });
  }
}
