"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { loadMyPublisher } from "@/lib/publisher/queries";
import { issuePublisherKey, listPublisherKeys, revokePublisherKey } from "@/lib/publisher/keys-db";
import { issueFailMessage, isExpiryChoice, keyIsUsable, parseKeyLabel, type KeyActionState } from "@/lib/publisher/keys";
import { isUuid } from "@/lib/campaigns/constants";

// Publisher apni API key khud banata / band karta hai. publisher_id HAMESHA login se nikalta hai (form se kabhi nahi).
// Nayi key ka plain text sirf is jawab me ek baar jaata hai: kahin store ya log nahi hota.

async function requireOwnPublisher(): Promise<{ id: string; status: "pending" | "active" | "suspended" } | { error: string }> {
  await requireRole(["publisher"]);
  const { publisher: pub, failed } = await loadMyPublisher();
  // Database dikkat ko "setup nahi hua" na samjho: alag, sahi message.
  if (failed) return { error: "We could not check your account right now. Please try again." };
  if (!pub) return { error: "Please set up your platform details first." };
  return { id: pub.id, status: pub.status };
}

// Nayi key sirf approved (active) publisher banata hai.
async function requireActivePublisher(): Promise<{ id: string } | { error: string }> {
  const pub = await requireOwnPublisher();
  if ("error" in pub) return pub;
  if (pub.status !== "active") return { error: "Your publisher account is not approved yet, so keys cannot be created." };
  return { id: pub.id };
}

export async function createKey(_prev: KeyActionState, formData: FormData): Promise<KeyActionState> {
  const pub = await requireActivePublisher();
  if ("error" in pub) return { status: "error", message: pub.error };

  const rawLabel = formData.get("label");
  const label = parseKeyLabel(typeof rawLabel === "string" ? rawLabel.slice(0, 200) : "");
  if (!label.ok) return { status: "error", message: label.error };

  const expiry = formData.get("expiry");
  if (!isExpiryChoice(expiry)) return { status: "error", message: "Choose when the key should expire." };

  const result = await issuePublisherKey(pub.id, label.value, expiry);
  if (!result.ok) return { status: "error", message: issueFailMessage(result.reason) };

  revalidatePath("/dashboard/publisher");
  return {
    status: "success",
    message: "Key created. Copy it now: it is shown only once and cannot be shown again.",
    newKey: result.key,
  };
}

/**
 * Rotation: purani key ki jagah nayi key (wahi naam, naya expiry). Purani key CHALTI RAHTI hai jab tak tum use revoke na karo,
 * taaki server badalte waqt downtime na ho. Purani key publisher ki apni honi chahiye (login se nikli publisher id ki list me).
 */
export async function rotateKey(_prev: KeyActionState, formData: FormData): Promise<KeyActionState> {
  const pub = await requireActivePublisher();
  if ("error" in pub) return { status: "error", message: pub.error };

  const oldId = formData.get("rotateKeyId");
  if (typeof oldId !== "string" || !isUuid(oldId)) return { status: "error", message: "Key not found." };

  const expiry = formData.get("expiry");
  if (!isExpiryChoice(expiry)) return { status: "error", message: "Choose when the key should expire." };

  const keys = await listPublisherKeys(pub.id);
  if (keys === null) return { status: "error", message: "We could not check your keys right now. Please try again." };
  const old = keys.find((k) => k.id === oldId);
  if (!old || !keyIsUsable(old, new Date())) {
    return { status: "error", message: "Key not found, or it is already revoked or expired." };
  }

  const result = await issuePublisherKey(pub.id, old.label, expiry);
  if (!result.ok) return { status: "error", message: issueFailMessage(result.reason) };

  revalidatePath("/dashboard/publisher");
  return {
    status: "success",
    message: "New key created. Copy it now (shown only once), switch your server to it, then revoke the old key.",
    newKey: result.key,
  };
}

// Revoke suspended / pending publisher ke liye bhi chalta hai: leaked key hamesha band ho sakti hai (login + apni key zaroori).
export async function revokeKey(_prev: KeyActionState, formData: FormData): Promise<KeyActionState> {
  const pub = await requireOwnPublisher();
  if ("error" in pub) return { status: "error", message: pub.error };

  const keyId = formData.get("keyId");
  if (typeof keyId !== "string" || !isUuid(keyId)) return { status: "error", message: "Key not found." };

  const ok = await revokePublisherKey(pub.id, keyId);
  if (!ok) return { status: "error", message: "That key could not be revoked. It may already be revoked." };

  revalidatePath("/dashboard/publisher");
  return { status: "success", message: "Key revoked. It stops working immediately." };
}
