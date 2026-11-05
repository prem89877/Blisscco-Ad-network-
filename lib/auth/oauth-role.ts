import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { CHOOSE_ROLE_PATH, type OAuthIntent } from "./oauth-intent";

// Naye Google user ke liye account type. Sirf server (secret key) se; browser se kabhi nahi.
// Rok database me hai: mark_role_choice_pending / set_initial_account_role (sirf service_role).
// Kuch bhi fail ho toh login nahi rukta (user mojooda default par rehta hai aur error log hota hai).

export type NewGoogleUserResult = "done" | "choose" | "skip";

export async function handleNewGoogleUser(userId: string, intent: OAuthIntent): Promise<NewGoogleUserResult> {
  try {
    const admin = createAdminClient();
    const marked = await admin.rpc("mark_role_choice_pending", { p_user_id: userId });
    if (marked.error || marked.data !== true) {
      console.error("[auth] role choice could not be marked", { code: marked.error?.code ?? null });
      return "skip";
    }
    if (intent.kind !== "signup") return "choose";

    const set = await admin.rpc("set_initial_account_role", { p_user_id: userId, p_role: intent.role });
    if (set.error) {
      console.error("[auth] initial role could not be set", { code: set.error.code ?? null });
      return "choose";
    }
    return "done";
  } catch {
    console.error("[auth] new google user handling failed");
    return "skip";
  }
}

export async function setChosenRole(userId: string, role: "advertiser" | "publisher"): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.rpc("set_initial_account_role", { p_user_id: userId, p_role: role });
    if (error) console.error("[auth] choose role failed", { code: error.code ?? null });
    return !error;
  } catch {
    console.error("[auth] choose role failed");
    return false;
  }
}

export { CHOOSE_ROLE_PATH };
