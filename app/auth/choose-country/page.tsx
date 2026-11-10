import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AuthShell from "@/components/auth/AuthShell";
import { AdvertiserSetupForm, PublisherSetupForm } from "@/components/dashboard/AccountSetupForm";
import AdvertiserCountryForm from "@/components/dashboard/AdvertiserCountryForm";
import PublisherCountryForm from "@/components/dashboard/PublisherCountryForm";
import { getCurrentAccount, requireUser } from "@/lib/auth/session";
import { loadCountryPromptMode } from "@/lib/regions/country-prompt-queries";
import { countryOptions } from "@/lib/regions/publisher-country";
import { skipCountryPrompt } from "./actions";

export const metadata: Metadata = {
  title: "Choose your country | Blisscco",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

// Login ke baad, dashboard khulne se pehle. Sirf advertiser / publisher jinhone country nahi chuni. Baaki sab seedha /dashboard par.
// Country chunne par seedha dashboard; "Do it later" par bhi dashboard (is login ke liye). Naya login => dobara poochta hai.
export default async function ChooseCountryPage() {
  await requireUser();
  const account = await getCurrentAccount();
  if (!account) redirect("/dashboard");
  if (account.roleChoicePending) redirect("/auth/choose-role");
  const mode = await loadCountryPromptMode(account.role);
  if (!mode) redirect("/dashboard");

  const options = countryOptions();
  const isAdvertiser = account.role === "advertiser";

  return (
    <AuthShell
      title="Choose your country"
      description={
        mode === "setup"
          ? "Tell us about your account and choose your country. You can also do it later."
          : "Choose your country to finish your account. You can also do it later."
      }
    >
      <div className="mt-6">
        {mode === "setup" ? (
          isAdvertiser ? (
            <AdvertiserSetupForm countryOptions={options} />
          ) : (
            <PublisherSetupForm countryOptions={options} />
          )
        ) : isAdvertiser ? (
          <AdvertiserCountryForm options={options} currentCode={null} submitLabel="Save and continue" continueToDashboard />
        ) : (
          <PublisherCountryForm options={options} currentCode={null} submitLabel="Submit and continue" continueToDashboard />
        )}
      </div>
      {!isAdvertiser && (
        <p className="mt-4 text-xs text-mist/60">Our team verifies your country. Until it is verified you may receive no regional ads.</p>
      )}
      <form action={skipCountryPrompt} className="mt-5">
        <button
          type="submit"
          className="min-h-11 w-full rounded-lg border border-line px-4 py-2 text-sm font-medium text-mist hover:border-aqua hover:text-aqua"
        >
          Do it later
        </button>
      </form>
    </AuthShell>
  );
}
