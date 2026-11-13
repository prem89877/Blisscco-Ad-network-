import type { NextRequest } from "next/server";
import { handleDiagPost } from "@/lib/diagnostics/diag-handler";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

// F2: sirf login wale user ki report leta hai (logic: lib/diagnostics/diag-handler.ts). Verified user id JWT claims se, bina network ke.
async function getUserId(): Promise<string | null> {
  if (!hasSupabaseEnv()) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    const sub = data?.claims?.sub;
    return error || typeof sub !== "string" || sub.length === 0 ? null : sub;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  return handleDiagPost(request, { getUserId });
}
