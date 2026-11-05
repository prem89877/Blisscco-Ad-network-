import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AuthShell from "@/components/auth/AuthShell";
import ChooseRoleForm from "@/components/auth/ChooseRoleForm";
import { getCurrentAccount, requireUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Choose account type | Blisscco",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

// Sirf naya Google user (role_choice_pending) yahan rukta hai. Baaki sab seedha /dashboard par.
export default async function ChooseRolePage() {
  await requireUser();
  const account = await getCurrentAccount();
  if (!account || !account.roleChoicePending) redirect("/dashboard");

  return (
    <AuthShell title="Choose your account type" description="Tell us how you will use Blisscco. You will see your account type in the dashboard.">
      <ChooseRoleForm />
    </AuthShell>
  );
}
