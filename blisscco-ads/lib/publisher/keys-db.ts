import "server-only";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashApiKey } from "@/lib/ads/api-key";
import { buildKeyParts, expiryIso, issueFailReason, toPublisherKey, type ExpiryChoice, type IssueFailReason, type PublisherKey } from "./keys";

// Publisher key banana / dekhna / band karna. Service-role key SIRF createAdminClient() ke andar hai.
// publisher_id HAMESHA server logged-in user se nikalta hai (caller se kabhi nahi aata).
// Plain key return hoti hai (ek baar dikhane ke liye) aur kahin store/log nahi hoti. Log me sirf error code jaata hai.

export type IssueResult = { ok: true; key: string } | { ok: false; reason: IssueFailReason };

export async function issuePublisherKey(
  publisherId: string,
  label: string | null,
  expiry: ExpiryChoice,
): Promise<IssueResult> {
  try {
    const parts = buildKeyParts(randomBytes(32).toString("hex"));
    if (!parts) return { ok: false, reason: "error" };

    const supabase = createAdminClient();
    const { error } = await supabase.rpc("issue_publisher_key_for", {
      p_publisher_id: publisherId,
      p_key_hash: hashApiKey(parts.key),
      p_key_prefix: parts.prefix,
      p_key_hint: parts.hint,
      p_label: label,
      p_expires_at: expiryIso(expiry, new Date()),
    });
    if (error) {
      console.error("[publisher/keys] issue failed", error.code ?? "unknown");
      // 22023 + hint = limit (5 active) / roz ki limit / galat value (issueFailReason)
      return { ok: false, reason: issueFailReason(error) };
    }
    return { ok: true, key: parts.key };
  } catch {
    console.error("[publisher/keys] issue unexpected failure");
    return { ok: false, reason: "error" };
  }
}

export async function listPublisherKeys(publisherId: string): Promise<PublisherKey[] | null> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("list_publisher_keys_for", { p_publisher_id: publisherId });
    if (error || !Array.isArray(data)) {
      console.error("[publisher/keys] list failed", error?.code ?? "unknown");
      return null;
    }
    return (data as unknown[]).map(toPublisherKey).filter((k): k is PublisherKey => k !== null);
  } catch {
    console.error("[publisher/keys] list unexpected failure");
    return null;
  }
}

export async function revokePublisherKey(publisherId: string, keyId: string): Promise<boolean> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("revoke_publisher_key_for", {
      p_publisher_id: publisherId,
      p_key_id: keyId,
    });
    if (error) {
      console.error("[publisher/keys] revoke failed", error.code ?? "unknown");
      return false;
    }
    return data === true;
  } catch {
    console.error("[publisher/keys] revoke unexpected failure");
    return false;
  }
}
