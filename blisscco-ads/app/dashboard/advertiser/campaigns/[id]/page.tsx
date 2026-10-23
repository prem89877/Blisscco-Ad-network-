import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Button from "@/components/ui/Button";
import Panel from "@/components/dashboard/Panel";
import Notice from "@/components/auth/Notice";
import CampaignStatusBadge from "@/components/campaigns/CampaignStatusBadge";
import RunStateButton from "@/components/campaigns/RunStateButton";
import { requireRole } from "@/lib/auth/session";
import { getCreativeSummary, getMyAdvertiser, getMyCampaign } from "@/lib/campaigns/queries";
import { EDIT_LOCKED_STATUSES, STATUS_HELP, categoryLabel, isUuid } from "@/lib/campaigns/constants";
import { formatDate, formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Campaign | Blisscco Dashboard" };
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; updated?: string }>;
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="w-44 shrink-0 text-sm text-mist/60">{label}</dt>
      <dd className="text-sm text-mist">{children}</dd>
    </div>
  );
}

export default async function CampaignDetailPage({ params, searchParams }: Props) {
  await requireRole(["advertiser"]);
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();

  const adv = await getMyAdvertiser();
  if (!adv) notFound();
  // Na mila / kisi aur ka: dono me same notFound (existence leak nahi).
  const campaign = await getMyCampaign(adv.id, id);
  if (!campaign) notFound();

  const creatives = await getCreativeSummary(campaign.id);
  const locked = EDIT_LOCKED_STATUSES.includes(campaign.status);
  const canChange = adv.status === "active";

  return (
    <>
      <div className="mb-6">
        <p className="text-sm">
          <Link href="/dashboard/advertiser/campaigns" className="rounded text-aqua underline-offset-2 hover:underline">
            &larr; My campaigns
          </Link>
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{campaign.name}</h1>
          <CampaignStatusBadge status={campaign.status} />
        </div>
        <p className="mt-2 max-w-2xl text-sm text-mist/70 sm:text-base">{STATUS_HELP[campaign.status]}</p>
      </div>

      {sp.created === "1" && <Notice tone="success">Campaign created as a draft.</Notice>}
      {sp.updated === "1" && <Notice tone="success">Changes saved.</Notice>}

      <div className="mt-6 space-y-5">
        <Panel title="Details">
          <dl className="space-y-3">
            <Row label="Description">
              {campaign.description ? (
                <span className="block whitespace-pre-line break-words">{campaign.description}</span>
              ) : (
                "No description"
              )}
            </Row>
            <Row label="Category">{categoryLabel(campaign.category)}</Row>
            <Row label="Total budget">{formatMoney(campaign.totalBudget)}</Row>
            <Row label="Daily budget">
              {campaign.dailyBudget !== null ? formatMoney(campaign.dailyBudget) : "No daily limit"}
            </Row>
            <Row label="Start date">{formatDate(campaign.startDate)}</Row>
            <Row label="End date">{campaign.endDate ? formatDate(campaign.endDate) : "No end date"}</Row>
            <Row label="Ad creatives">
              {creatives ? `${creatives.approved} approved of ${creatives.total}` : "Could not be loaded"}
            </Row>
            <Row label="Spend, impressions, clicks">Not tracked yet (ad serving is not live).</Row>
          </dl>
        </Panel>

        {canChange && !locked && (
          <Panel title="Actions">
            <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start">
              <Button href={`/dashboard/advertiser/campaigns/${campaign.id}/edit`} variant="secondary">Edit campaign</Button>
              {campaign.status === "active" && <RunStateButton campaignId={campaign.id} mode="pause" />}
              {campaign.status === "paused" && (
                <div>
                  <RunStateButton campaignId={campaign.id} mode="resume" />
                  {creatives && creatives.approved === 0 && (
                    <p className="mt-2 max-w-sm text-xs text-mist/60">
                      Resuming needs at least one approved creative.
                    </p>
                  )}
                </div>
              )}
            </div>
          </Panel>
        )}

        {!canChange && <Notice tone="info">Your advertiser account is not active, so this campaign cannot be changed.</Notice>}
      </div>
    </>
  );
}
