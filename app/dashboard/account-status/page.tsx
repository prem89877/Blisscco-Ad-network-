import type { Metadata } from "next";
import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import Panel from "@/components/dashboard/Panel";
import { getCurrentAccount, requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Account status | Blisscco Dashboard" };
export const dynamic = "force-dynamic";

// Sirf requireUser (requireAccount nahi), warna redirect loop banta.
export default async function AccountStatusPage() {
  await requireUser();
  const account = await getCurrentAccount();
  if (account && account.status === "active") redirect("/dashboard");

  const suspended = account?.status === "suspended";

  return (
    <>
      <PageHeader
        title="Account unavailable"
        description={
          suspended
            ? "This account is currently suspended."
            : "We could not load your account details right now."
        }
      />
      <Panel title="What you can do">
        <p className="text-sm text-mist/75">
          {suspended
            ? "Dashboard pages are not available while an account is suspended. Please contact the Blisscco team if you think this is a mistake."
            : "Please log out and log in again. If the problem continues, try again later."}
        </p>
      </Panel>
    </>
  );
}
