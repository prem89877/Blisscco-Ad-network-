"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { cancelEnrollment, confirmEnrollment, startEnrollment, type MfaApi, type MfaState } from "@/lib/auth/mfa";

// Admin-only TOTP MFA enrollment. Har action pehle requireRole(["admin"]) (server par) bulata hai.
// Admin ke apne session (RLS) se hi: service-role key yahan nahi. Secret / QR / code kabhi log nahi hote.

const mfaApi = async (): Promise<MfaApi> => (await createClient()).auth.mfa as unknown as MfaApi;

export async function beginMfaEnrollment(_prev: MfaState, _formData: FormData): Promise<MfaState> {
  await requireRole(["admin"]);
  return startEnrollment(await mfaApi(), crypto.randomUUID().slice(0, 8));
}

export async function verifyMfaEnrollment(_prev: MfaState, formData: FormData): Promise<MfaState> {
  await requireRole(["admin"]);
  const result = await confirmEnrollment(await mfaApi(), formData.get("factorId"), formData.get("code"));
  if (result.status === "success") revalidatePath("/dashboard/admin/security");
  return result;
}

export async function cancelMfaEnrollment(_prev: MfaState, formData: FormData): Promise<MfaState> {
  await requireRole(["admin"]);
  return cancelEnrollment(await mfaApi(), formData.get("factorId"));
}
