// Publisher API key ke pure helpers (koi database/random/clock nahi: bahar se aate hain). Plain key sirf banate waqt ek baar dikhti hai.

import { hasBadNameChars } from "@/lib/accounts/validation";

export const KEY_PREFIX = "blc_live_";
export const KEY_LABEL_MAX = 60;

export type ExpiryChoice = "30" | "90" | "365" | "never";
export const EXPIRY_CHOICES: { value: ExpiryChoice; label: string }[] = [
  { value: "90", label: "90 days (recommended)" },
  { value: "30", label: "30 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "No expiry" },
];

export function isExpiryChoice(v: unknown): v is ExpiryChoice {
  return v === "30" || v === "90" || v === "365" || v === "never";
}

/** 64 hex characters (32 random bytes) se key + pehchaan ke hisse. Format galat ho toh null. */
export function buildKeyParts(hex64: string): { key: string; prefix: string; hint: string } | null {
  if (!/^[0-9a-f]{64}$/.test(hex64)) return null;
  const key = `${KEY_PREFIX}${hex64}`;
  return { key, prefix: key.slice(0, 13), hint: hex64.slice(-4) };
}

/** Expiry ka din -> ISO time (UTC). "never" => null. */
export function expiryIso(choice: ExpiryChoice, now: Date): string | null {
  if (choice === "never") return null;
  const days = Number(choice);
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

export function parseKeyLabel(raw: string): { ok: true; value: string | null } | { ok: false; error: string } {
  const label = raw.replace(/\s+/g, " ").trim();
  // Control aur chhupe hue characters (zero-width, text-direction override) dono band.
  if (hasBadNameChars(label)) return { ok: false, error: "Remove special control characters." };
  if (label.length > KEY_LABEL_MAX) return { ok: false, error: `Use at most ${KEY_LABEL_MAX} characters.` };
  return { ok: true, value: label.length > 0 ? label : null };
}

export type PublisherKey = {
  id: string;
  label: string | null;
  prefix: string;
  hint: string | null;
  status: "active" | "revoked";
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
};

export type IssueFailReason = "limit" | "daily" | "error";

/**
 * Key banane ka database error -> kaaran. day-10-2 migration hint deti hai ("key_limit", "key_daily_limit", "invalid_*").
 * Migration se pehle (hint nahi) 22023 purane jaise "limit" maana jata hai: dono order me deploy safe.
 */
export function issueFailReason(error: { code?: string | null; hint?: string | null } | null | undefined): IssueFailReason {
  if (!error || error.code !== "22023") return "error";
  const hint = typeof error.hint === "string" ? error.hint : "";
  if (hint === "key_daily_limit") return "daily";
  if (hint.startsWith("invalid_")) return "error";
  return "limit";
}

export function issueFailMessage(reason: IssueFailReason): string {
  if (reason === "limit") return "You already have 5 active keys. Revoke an old key first.";
  if (reason === "daily") return "You created too many keys today. Please try again tomorrow.";
  return "We could not create the key. Please try again.";
}

/** Key abhi chalti hai ya nahi (revoked ya expired = nahi). */
export function keyIsUsable(k: Pick<PublisherKey, "status" | "expiresAt">, now: Date): boolean {
  if (k.status !== "active") return false;
  return k.expiresAt === null || new Date(k.expiresAt).getTime() > now.getTime();
}

export function toPublisherKey(row: unknown): PublisherKey | null {
  if (typeof row !== "object" || row === null) return null;
  const r = row as Record<string, unknown>;
  const s = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const id = s(r.id);
  const prefix = s(r.key_prefix);
  const createdAt = s(r.created_at);
  if (!id || !prefix || !createdAt) return null;
  if (r.status !== "active" && r.status !== "revoked") return null;
  return {
    id,
    label: s(r.label),
    prefix,
    hint: s(r.key_hint),
    status: r.status,
    createdAt,
    lastUsedAt: s(r.last_used_at),
    expiresAt: s(r.expires_at),
  };
}

export type KeyActionState = {
  status: "idle" | "error" | "success";
  message?: string;
  /** Sirf banate waqt ek baar (kabhi store/log nahi). */
  newKey?: string;
};
export const initialKeyState: KeyActionState = { status: "idle" };
