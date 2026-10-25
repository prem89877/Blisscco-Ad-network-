import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";

// Logged-in publisher ki apni row (RLS ke saath: user sirf apni row dekh sakta hai).

export type MyPublisher = {
  id: string;
  status: "pending" | "active" | "suspended";
  name: string;
};

export const getMyPublisher = cache(async (): Promise<MyPublisher | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("publishers")
      .select("id, status, name")
      .eq("profile_id", user.id)
      .maybeSingle();
    if (error || !data) return null;
    const r = data as { id?: unknown; status?: unknown; name?: unknown };
    if (typeof r.id !== "string" || typeof r.name !== "string") return null;
    if (r.status !== "pending" && r.status !== "active" && r.status !== "suspended") return null;
    return { id: r.id, status: r.status, name: r.name };
  } catch {
    return null;
  }
});
