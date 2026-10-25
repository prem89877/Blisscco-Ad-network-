// Admin ke faisle ki jaanch (pure). Server action isi se tay karta hai ki kaun sa database function kis value ke saath bulana hai.

export const ADMIN_KINDS = ["advertiser", "publisher", "creative", "campaign"] as const;
export type AdminDecisionKind = (typeof ADMIN_KINDS)[number];
export const REJECT_REASON_MAX = 500;

export function isAdminDecisionKind(v: unknown): v is AdminDecisionKind {
  return typeof v === "string" && (ADMIN_KINDS as readonly string[]).includes(v);
}

export type AdminDecisionCheck =
  | { ok: true; value: string; reason: string | null }
  | { ok: false; message: string };

/**
 * advertiser/publisher: decision = active | suspended
 * creative: approve | reject (reject par reason zaroori)
 * campaign: approve | reject
 */
export function validateAdminDecision(kind: AdminDecisionKind, decision: string, reasonRaw: string): AdminDecisionCheck {
  const reason = reasonRaw.replace(/\s+/g, " ").trim();
  if (kind === "advertiser" || kind === "publisher") {
    if (decision !== "active" && decision !== "suspended") return { ok: false, message: "That request was not understood." };
    return { ok: true, value: decision, reason: null };
  }
  if (decision !== "approve" && decision !== "reject") return { ok: false, message: "That request was not understood." };
  if (kind === "creative" && decision === "reject") {
    if (reason.length === 0) return { ok: false, message: "Write a short reason so the advertiser knows what to fix." };
    if (reason.length > REJECT_REASON_MAX) return { ok: false, message: `Use at most ${REJECT_REASON_MAX} characters for the reason.` };
    return { ok: true, value: decision, reason };
  }
  return { ok: true, value: decision, reason: null };
}
