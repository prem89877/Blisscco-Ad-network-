import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { toPublisher, type MyPublisher, type PublisherResult } from "./publisher";

// Logged-in publisher ki apni row. profile_id ka filter EXPLICIT hai aur RLS alag se rokti hai
// (user sirf apni row dekh sakta hai; admin ko sab dikhti hain, isliye explicit filter defense in depth hai).

export type { MyPublisher, PublisherResult } from "./publisher";

/**
 * Logged-in user ka publisher. failed = database error (publisher NAHI hai se alag).
 * Pehle error aur "publisher nahi hai" dono null the, isliye database dikkat par asli publisher ko
 * "Set up your platform" form dikh jata tha. Ab pages failed par alag message dikhate hain.
 */
export const loadMyPublisher = cache(async (): Promise<PublisherResult> => {
  const user = await getCurrentUser();
  if (!user) return { publisher: null, failed: false };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("publishers")
      .select("id, status, name, website_url, category")
      .eq("profile_id", user.id)
      .maybeSingle();
    if (error) return { publisher: null, failed: true };
    if (!data) return { publisher: null, failed: false };
    const publisher = toPublisher(data);
    // Row mili par shape galat: ise "nahi hai" nahi, "load fail" maano (galat setup form na dikhe).
    return publisher ? { publisher, failed: false } : { publisher: null, failed: true };
  } catch {
    return { publisher: null, failed: true };
  }
});

/** Purane callers ke liye: sirf publisher ya null. Naye code me loadMyPublisher() use karo (failed alag milta hai). */
export async function getMyPublisher(): Promise<MyPublisher | null> {
  return (await loadMyPublisher()).publisher;
}
