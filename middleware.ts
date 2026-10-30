import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

// Sirf auth se jude routes. Landing page (/) par koi extra network call nahi.
export const config = {
  matcher: ["/dashboard/:path*", "/login", "/signup"],
};
