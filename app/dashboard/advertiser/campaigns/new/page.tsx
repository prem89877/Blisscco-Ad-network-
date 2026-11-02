import type { Metadata } from "next";
import Link from "next/link";
import CampaignForm from "@/components/campaigns/CampaignForm";
import Notice from "@/components/auth/Notice";
import { requireRole } from "@/lib/auth/session";
import { loadMyAdvertiser } from "@/lib/campaigns/queries";
import { MIN_DAILY_BUDGET, MIN_TOTAL_BUDGET } from "@/lib/campaigns/constants";
import { minStartDateForNew, utcToday } from "@/lib/campaigns/validation";
import { createCampaign } from "../actions";

export const metadata: Metadata = { title: "New campaign | Blisscco Dashboard" };
export const dynamic = "force-dynamic";

// Day 29 Part 3: short launch guidance. Text only; the real rules stay in lib/campaigns and the database.
const LAUNCH_GUIDANCE: { title: string; text: string }[] = [
  {
    title: "Category",
    text: "Choose the category that matches what your ad promotes. It can only be changed while the campaign is a draft or rejected.",
  },
  {
    title: "Ad content",
    text: "Ads are added after the campaign is created: a headline, ad text and an optional button. Each ad is checked by our team and always carries a Sponsored label.",
  },
  {
    title: "Destination URL",
    text: "The destination URL is set on each ad, not on the campaign. It must be a secure https link.",
  },
  {
    title: "Budget",
    text: `Total budget: at least $${MIN_TOTAL_BUDGET.toFixed(2)}. Daily budget is optional: at least $${MIN_DAILY_BUDGET.toFixed(2)} and not above the total. Ads stop when a budget is used up, and the total cannot be lowered below what is already spent.`,
  },
  {
    title: "Status",
    text: "A new campaign is a draft and is not live. Send it for review once it has an ad. It can show ads only after our team approves it and at least one ad, and only while it is inside its dates and has budget left. Approval does not guarantee that ads are shown.",
  },
];

export default async function NewCampaignPage() {
  await requireRole(["advertiser"]);
  const { advertiser: adv, failed } = await loadMyAdvertiser();
  if (failed) throw new Error("Advertiser could not be loaded");

  return (
    <>
      <div className="mb-6">
        <p className="text-sm">
          <Link href="/dashboard/advertiser/campaigns" className="rounded text-aqua underline-offset-2 hover:underline">
            &larr; My campaigns
          </Link>
        </p>
        <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight sm:text-3xl">New campaign</h1>
        <p className="mt-2 max-w-2xl text-sm text-mist/70 sm:text-base">
          New campaigns start as drafts. A draft is saved but not live.
        </p>
      </div>

      {!adv && <Notice tone="error">Your advertiser account was not found. Please log out and log in again.</Notice>}
      {adv && adv.status !== "active" && (
        <Notice tone="info">Your advertiser account is not active, so you cannot create campaigns yet.</Notice>
      )}
      {adv && adv.status === "active" && (
        <>
          <section
            aria-labelledby="launch-guidance-title"
            className="mb-6 max-w-xl rounded-xl border border-line bg-surface p-4 sm:p-5"
          >
            <h2 id="launch-guidance-title" className="font-display text-base font-semibold">
              Before you launch
            </h2>
            <dl className="mt-3 space-y-2.5">
              {LAUNCH_GUIDANCE.map((g) => (
                <div key={g.title}>
                  <dt className="text-sm font-medium text-mist">{g.title}</dt>
                  <dd className="text-sm text-mist/70">{g.text}</dd>
                </div>
              ))}
            </dl>
          </section>
          <CampaignForm
            mode="create"
            action={createCampaign}
            minStartDate={minStartDateForNew(utcToday())}
            cancelHref="/dashboard/advertiser/campaigns"
          />
        </>
      )}
    </>
  );
}
