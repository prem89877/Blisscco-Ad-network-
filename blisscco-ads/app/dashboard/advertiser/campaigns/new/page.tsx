import type { Metadata } from "next";
import Link from "next/link";
import CampaignForm from "@/components/campaigns/CampaignForm";
import Notice from "@/components/auth/Notice";
import { requireRole } from "@/lib/auth/session";
import { loadMyAdvertiser } from "@/lib/campaigns/queries";
import { minStartDateForNew, utcToday } from "@/lib/campaigns/validation";
import { createCampaign } from "../actions";

export const metadata: Metadata = { title: "New campaign | Blisscco Dashboard" };
export const dynamic = "force-dynamic";

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
        <CampaignForm
          mode="create"
          action={createCampaign}
          minStartDate={minStartDateForNew(utcToday())}
          cancelHref="/dashboard/advertiser/campaigns"
        />
      )}
    </>
  );
}
