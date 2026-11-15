import type { Metadata } from "next";
import Link from "next/link";
import PageHeader from "@/components/dashboard/PageHeader";
import TwoFactorPanel from "@/components/admin/TwoFactorPanel";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getMfaStatus, type MfaApi } from "@/lib/auth/mfa";

export const metadata: Metadata = { title: "Security | Blisscco Dashboard" };
export const dynamic = "force-dynamic";

export default async function AdminSecurityPage() {
  // Sirf admin. Baaki roles => /dashboard (requireRole). Layout par bharosa nahi.
  await requireRole(["admin"]);
  const supabase = await createClient();
  const result = await getMfaStatus(supabase.auth.mfa as unknown as MfaApi);

  return (
    <>
      <PageHeader
        title="Two-factor authentication"
        description="Protect your admin account with a one-time code from an authenticator app."
      />
      <p className="mb-4 text-sm">
        <Link href="/dashboard/admin" className="text-aqua hover:underline">
          Back to admin review
        </Link>
      </p>
      <TwoFactorPanel status={result.ok ? result.status : null} />
    </>
  );
}
