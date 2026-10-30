import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import CampaignForm from "@/components/campaigns/CampaignForm";
import Notice from "@/components/auth/Notice";
import CampaignStatusBadge from "@/components/campaigns/CampaignStatusBadge";
import { requireRole } from "@/lib/auth/session";
import { getCampaignSpend, loadMyAdvertiser, loadMyCampaign } from "@/lib/campaigns/queries";
import { CATEGORY_EDITABLE_STATUSES, EDIT_LOCKED_STATUSES, STATUS_LABELS, isUuid } from "@/lib/campaigns/constants";
import { updateCampaign } from "../../actions";

export const metadata: Metadata = { title: "Edit campaign | Blisscco Dashboard" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function EditCampaignPage({ params }: Props) {
  // Speed: role check aur advertiser ki query SAATH me chalti hain (pehle ek ke baad ek). Role galat ho toh redirect pehle hi ho jata hai.
  const [, { advertiser: adv, failed: advertiserFailed }] = await Promise.all([
    requireRole(["advertiser"]),
    loadMyAdvertiser(),
  ]);
  const { id } = await params;
  if (!isUuid(id)) notFound();

  if (advertiserFailed) throw new Error("Advertiser could not be loaded");
  if (!adv) notFound();
  const { campaign, failed } = await loadMyCampaign(adv.id, id);
  if (failed) throw new Error("Campaign could not be loaded");
  if (!campaign) notFound();
  // Kharch (sirf dikhane ke liye hint). Na mile toh hint chhup jata hai; asli rok server action me hai.
  const spend = await getCampaignSpend(campaign.id);

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
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Edit campaign</h1>
          <CampaignStatusBadge status={campaign.status} />
        </div>
        <p className="mt-2 max-w-2xl break-words text-sm text-mist/70 sm:text-base">
          Editing {campaign.name}. Status changes (pause or resume) are done from the campaign page.
        </p>
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
          spentTotal={spend ? spend.spentTotal : null}
          cancelHref={back}
        />
      )}
    </>
  );
}
