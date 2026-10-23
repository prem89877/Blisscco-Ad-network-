import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import CampaignForm from "@/components/campaigns/CampaignForm";
import Notice from "@/components/auth/Notice";
import { requireRole } from "@/lib/auth/session";
import { getMyAdvertiser, getMyCampaign } from "@/lib/campaigns/queries";
import { CATEGORY_EDITABLE_STATUSES, EDIT_LOCKED_STATUSES, STATUS_LABELS, isUuid } from "@/lib/campaigns/constants";
import { updateCampaign } from "../../actions";

export const metadata: Metadata = { title: "Edit campaign | Blisscco Dashboard" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function EditCampaignPage({ params }: Props) {
  await requireRole(["advertiser"]);
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const adv = await getMyAdvertiser();
  if (!adv) notFound();
  const campaign = await getMyCampaign(adv.id, id);
  if (!campaign) notFound();

  const back = `/dashboard/advertiser/campaigns/${campaign.id}`;
  const locked = EDIT_LOCKED_STATUSES.includes(campaign.status);

  return (
    <>
      <div className="mb-6">
        <p className="text-sm">
          <Link href={back} className="rounded text-aqua underline-offset-2 hover:underline">
            &larr; Back to campaign
          </Link>
        </p>
        <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight sm:text-3xl">Edit campaign</h1>
      </div>

      {adv.status !== "active" && (
        <Notice tone="info">Your advertiser account is not active, so this campaign cannot be changed.</Notice>
      )}
      {adv.status === "active" && locked && (
        <Notice tone="info">This campaign is locked while its status is {STATUS_LABELS[campaign.status]}.</Notice>
      )}
      {adv.status === "active" && !locked && (
        <CampaignForm
          mode="edit"
          action={updateCampaign}
          campaign={campaign}
          categoryLocked={!CATEGORY_EDITABLE_STATUSES.includes(campaign.status)}
          cancelHref={back}
        />
      )}
    </>
  );
}
