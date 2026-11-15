// Admin-only TOTP MFA (Supabase Auth). PURA logic, koi Next.js / Supabase import nahi: auth client andar se aata hai (tests me nakli client).
// Rules: recovery codes yahan NAHI (Supabase Auth MFA abhi recovery codes support nahi karta). Login par AAL2 force NAHI hota (admin lock-out nahi).
// Secret / QR kabhi log nahi hote; sirf enrollment ke dauran admin ko dikhane ke liye wapas jaate hain.

export type MfaFactorLike = { id: string; factor_type?: string; status?: string };

/** supabase.auth.mfa ka wo hissa jo hum use karte hain (SupabaseClient.auth.mfa isse match karta hai). */
export type MfaApi = {
  listFactors(): Promise<{ data: { all?: MfaFactorLike[]; totp?: MfaFactorLike[] } | null; error: { message?: string } | null }>;
  enroll(params: { factorType: "totp"; friendlyName?: string; issuer?: string }): Promise<{
    data: { id: string; totp?: { qr_code?: string; secret?: string; uri?: string } } | null;
    error: { message?: string } | null;
  }>;
  challenge(params: { factorId: string }): Promise<{ data: { id: string } | null; error: { message?: string } | null }>;
  verify(params: { factorId: string; challengeId: string; code: string }): Promise<{ data: unknown; error: { message?: string } | null }>;
  unenroll(params: { factorId: string }): Promise<{ data: unknown; error: { message?: string } | null }>;
};

export type MfaStatus = "enabled" | "disabled";
export type MfaStatusResult = { ok: true; status: MfaStatus } | { ok: false };

export type MfaState = {
  status: "idle" | "enrolling" | "success" | "error";
  message?: string;
  factorId?: string;
  qrCode?: string;
  secret?: string;
};
export const initialMfaState: MfaState = { status: "idle" };

export const MFA_ISSUER = "Blisscco";
export const OTP_LENGTH = 6;

export const MSG = {
  load: "Could not load two-factor status. Please refresh the page.",
  already: "Two-factor authentication is already enabled for this account.",
  start: "Could not start setup. Please try again.",
  badCode: "Enter the 6-digit code from your authenticator app.",
  wrongCode: "That code is not correct or has expired. Check your app and try again.",
  expired: "Setup session not found. Please start again.",
  done: "Two-factor authentication is now enabled.",
} as const;

/** Sirf 6 digit (spaces hata kar). Kuch aur => null. */
export function parseOtp(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.replace(/\s+/g, "");
  return /^\d{6}$/.test(code) ? code : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isFactorId = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

const isTotp = (f: MfaFactorLike) => f.factor_type === undefined || f.factor_type === "totp";
export const isVerified = (f: MfaFactorLike) => f.status === "verified";

/** Enabled = kam se kam ek VERIFIED TOTP factor. Load fail => ok:false (UI "unknown" dikhata hai, kuch badalta nahi). */
export async function getMfaStatus(mfa: MfaApi): Promise<MfaStatusResult> {
  try {
    const { data, error } = await mfa.listFactors();
    if (error || !data) return { ok: false };
    const all = data.all ?? data.totp ?? [];
    return { ok: true, status: all.some((f) => isTotp(f) && isVerified(f)) ? "enabled" : "disabled" };
  } catch {
    return { ok: false };
  }
}

/** Naya enrollment: pehle se verified factor ho toh rok (doosra factor nahi). Purane ADHURE (unverified) factors saaf, phir enroll. */
export async function startEnrollment(mfa: MfaApi, uniqueSuffix: string): Promise<MfaState> {
  try {
    const list = await mfa.listFactors();
    if (list.error || !list.data) return { status: "error", message: MSG.start };
    const all = list.data.all ?? list.data.totp ?? [];
    if (all.some((f) => isTotp(f) && isVerified(f))) return { status: "error", message: MSG.already };
    for (const f of all) {
      if (isTotp(f) && !isVerified(f)) await mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await mfa.enroll({ factorType: "totp", friendlyName: `blisscco-admin-${uniqueSuffix}`, issuer: MFA_ISSUER });
    if (error || !data?.totp?.qr_code || !data.totp.secret) return { status: "error", message: MSG.start };
    return { status: "enrolling", factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
  } catch {
    return { status: "error", message: MSG.start };
  }
}

/** Code verify. factorId is user ka apna UNVERIFIED totp factor hona chahiye (list se check), warna kuch nahi hota. */
export async function confirmEnrollment(mfa: MfaApi, factorId: unknown, codeInput: unknown): Promise<MfaState> {
  if (!isFactorId(factorId)) return { status: "error", message: MSG.expired };
  const code = parseOtp(codeInput);
  if (!code) return { status: "error", factorId, message: MSG.badCode };
  try {
    const list = await mfa.listFactors();
    const all = list.data?.all ?? list.data?.totp ?? [];
    const factor = all.find((f) => f.id === factorId && isTotp(f));
    if (list.error || !factor || isVerified(factor)) return { status: "error", message: MSG.expired };
    const ch = await mfa.challenge({ factorId });
    if (ch.error || !ch.data) return { status: "error", factorId, message: MSG.wrongCode };
    const v = await mfa.verify({ factorId, challengeId: ch.data.id, code });
    if (v.error) return { status: "error", factorId, message: MSG.wrongCode };
    return { status: "success", message: MSG.done };
  } catch {
    return { status: "error", factorId, message: MSG.wrongCode };
  }
}

/** Adhura enrollment cancel: sirf apna UNVERIFIED factor hatta hai. Verified factor yahan se kabhi nahi hatta. */
export async function cancelEnrollment(mfa: MfaApi, factorId: unknown): Promise<MfaState> {
  if (!isFactorId(factorId)) return { status: "idle" };
  try {
    const list = await mfa.listFactors();
    const f = (list.data?.all ?? list.data?.totp ?? []).find((x) => x.id === factorId);
    if (f && isTotp(f) && !isVerified(f)) await mfa.unenroll({ factorId });
  } catch {
    // cancel fail hone par bhi UI wapas shuru state par; agla enroll purana adhura factor khud saaf karta hai
  }
  return { status: "idle" };
}
