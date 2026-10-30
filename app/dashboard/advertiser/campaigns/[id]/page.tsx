import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Button from "@/components/ui/Button";
import Panel from "@/components/dashboard/Panel";
import Notice from "@/components/auth/Notice";
import CampaignStatusBadge from "@/components/campaigns/CampaignStatusBadge";
import DeliveryNote from "@/components/campaigns/DeliveryNote";
import RunStateButton from "@/components/campaigns/RunStateButton";
import CreativeForm from "@/components/campaigns/CreativeForm";
import CreativeActionButton from "@/components/campaigns/CreativeActionButton";
import CampaignReviewButton from "@/components/campaigns/CampaignReviewButton";
import CampaignPerformancePanel from "@/components/dashboard/CampaignPerformancePanel";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadCampaignPerformance } from "@/lib/ads/campaign-performance";
import {
  getCampaignSpend,
  getCreativeSummary,
  listCampaignCreatives,
  loadMyAdvertiser,
  loadMyCampaign,
} from "@/lib/campaigns/queries";
import { remainingBudget } from "@/lib/campaigns/budget";
import { deliveryState } from "@/lib/campaigns/delivery";
import { CREATIVE_STATUS_LABELS, availableCreativeActions } from "@/lib/campaigns/creative-validation";
import { SUBMIT_BLOCK_MESSAGES, checkSubmitCampaign, reviewActionFor } from "@/lib/campaigns/review";
import { EDIT_LOCKED_STATUSES, STATUS_HELP, categoryLabel, isUuid } from "@/lib/campaigns/constants";
import { DELIVERY_NOTE, RESUME_BLOCK_MESSAGES, canPause, checkResume } from "@/lib/campaigns/run-state";
import { utcToday } from "@/lib/campaigns/validation";
import { formatDate, formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Campaign | Blisscco Dashboard" };
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    created?: string;
    updated?: string;
    paused?: string;
    resumed?: string;
    creative?: string;
    review?: string;
  }>;
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="w-44 shrink-0 text-sm text-mist/60">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-mist">{children}</dd>
    </div>
  );
}

export default async function CampaignDetailPage({ params, searchParams }: Props) {
  // Speed: role check aur advertiser ki query SAATH me chalti hain (pehle ek ke baad ek). Role galat ho toh redirect pehle hi ho jata hai.
  const [, { advertiser: adv, failed: advertiserFailed }] = await Promise.all([
    requireRole(["advertiser"]),
    loadMyAdvertiser(),
  ]);
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();

  if (advertiserFailed) throw new Error("Advertiser could not be loaded");
  if (!adv) notFound();
  // Na mila / kisi aur ka: dono me same notFound (existence leak nahi).
  const { campaign, failed } = await loadMyCampaign(adv.id, id);
  // Database error => error boundary (Try again). Sirf sach me na milne par notFound.
  if (failed) throw new Error("Campaign could not be loaded");
  if (!campaign) notFound();

  // Chaaron queries ek dusre par nirbhar nahi: saath chalao (page tezi se khulta hai). Ownership upar campaign load se pakki hai;
  // analytics me bhi database auth.uid() se dobara jaanchta hai (doosre advertiser ka campaign => koi row nahi).
  const [creatives, creativeList, spend, performance] = await Promise.all([
    getCreativeSummary(campaign.id),
    listCampaignCreatives(campaign.id),
    getCampaignSpend(campaign.id),
    loadCampaignPerformance(() => createClient(), campaign.id),
  ]);
  const locked = EDIT_LOCKED_STATUSES.includes(campaign.status);
  const canChange = adv.status === "active";

  // Button sirf tab jab sach me eligible ho (server action dobara check karta hai).
  const today = utcToday();
  const resumeCheck = checkResume(campaign, creatives ? creatives.approved : null, today, spend ? spend.spentTotal : null);
  // "Active" status ke saath sach: kya ye abhi ad dikha sakta hai? (sirf dikhane ki jaankari; database status nahi badalta)
  const delivery =
    campaign.status === "active"
      ? deliveryState({
          status: campaign.status,
          startDate: campaign.startDate,
          endDate: campaign.endDate,
          totalBudget: campaign.totalBudget,
          dailyBudget: campaign.dailyBudget,
          approvedCreatives: creatives ? creatives.approved : null,
          spentTotal: spend ? spend.spentTotal : null,
          spentToday: spend ? spend.spentToday : null,
          todayUtc: today,
          advertiserActive: adv.status === "active",
        })
      : null;
  const showEdit = canChange && !locked;
  const showPause = canChange && canPause(campaign.status);
  const showResume = canChange && campaign.status === "paused" && resumeCheck.ok;
  const resumeBlocked =
    canChange && campaign.status === "paused" && !resumeCheck.ok ? RESUME_BLOCK_MESSAGES[resumeCheck.reason] : null;

  // Review ke liye bhejna / wapas lena (asli rok server action + database trigger me)
  const reviewable = creativeList ? creativeList.filter((c) => c.status === "pending_review" || c.status === "approved").length : null;
  const reviewAction = canChange ? reviewActionFor(campaign.status) : null;
  const submitCheck = checkSubmitCampaign(campaign, reviewable, today);
  const showReview = reviewAction !== null && (reviewAction !== "submit" || submitCheck.ok);
  const reviewBlocked = reviewAction === "submit" && !submitCheck.ok ? SUBMIT_BLOCK_MESSAGES[submitCheck.reason] : null;
  const canAddCreative = canChange && campaign.status !== "archived" && campaign.status !== "completed";
  const usd = (n: number) => `$${n.toFixed(4)}`;

  return (
    <>
      <div className="mb-6">
        <p className="text-sm">
          <Link href="/dashboard/advertiser/campaigns" className="rounded text-aqua underline-offset-2 hover:underline">
            &larr; My campaigns
          </Link>
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 break-words font-display text-2xl font-semibold tracking-tight sm:text-3xl">{campaign.name}</h1>
          <CampaignStatusBadge status={campaign.status} />
        </div>
        <p className="mt-2 max-w-2xl text-sm text-mist/70 sm:text-base">{STATUS_HELP[campaign.status]}</p>
        {delivery && <DeliveryNote state={delivery} />}
      </div>

      {/* Purani URL reload par galat message na dikhe: "created" notice sirf tab jab campaign abhi bhi draft ho. */}
      {sp.created === "1" && campaign.status === "draft" && <Notice tone="success">Campaign created as a draft.</Notice>}
      {sp.updated === "1" && <Notice tone="success">Changes saved.</Notice>}
      {/* Notice sirf tab jab status sach me wahi ho (purani URL reload par galat message na dikhe). */}
      {sp.paused === "1" && campaign.status === "paused" && (
        <Notice tone="success">Campaign paused. {DELIVERY_NOTE}</Notice>
      )}
      {sp.resumed === "1" && campaign.status === "active" && (
        <Notice tone="success">Campaign resumed. {DELIVERY_NOTE}</Notice>
      )}
      {sp.creative === "added" && <Notice tone="success">Ad added as a draft. Send it for review when it is ready.</Notice>}
      {sp.creative === "submit" && <Notice tone="success">Ad sent for review.</Notice>}
      {sp.creative === "withdraw" && <Notice tone="success">Ad taken back to draft.</Notice>}
      {sp.creative === "reopen" && <Notice tone="success">Ad moved back to draft.</Notice>}
      {sp.creative === "archive" && <Notice tone="success">Ad archived.</Notice>}
      {(sp.review === "withdraw" || sp.review === "reopen") && campaign.status === "draft" && (
        <Notice tone="success">Campaign is back in draft. You can edit it now.</Notice>
      )}
      {sp.review === "submit" && campaign.status === "pending_review" && (
        <Notice tone="success">Campaign sent for review. We will approve or reject it soon.</Notice>
      )}

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
            <Row label="Created">{formatDate(campaign.createdAt.slice(0, 10))} (UTC)</Row>
            <Row label="Last updated">{formatDate(campaign.updatedAt.slice(0, 10))} (UTC)</Row>
            <Row label="Spend so far">
              {spend ? `${usd(spend.spentTotal)} (${usd(spend.spentToday)} today, UTC)` : "Could not be loaded"}
            </Row>
            <Row label="Budget left">
              {spend ? formatMoney(remainingBudget(campaign.totalBudget, spend.spentTotal)) : "Could not be loaded"}
            </Row>
            <Row label="Ads served">{spend ? `${spend.servesTotal} (handed to chatbots; older counts may be removed after about 90 days)` : "Could not be loaded"}</Row>
          </dl>
        </Panel>

        <CampaignPerformancePanel performance={performance} />

        <Panel
          title="Ads"
          note="Each ad is checked by our team before it can be shown. Ads always carry a Sponsored label."
        >
          {creativeList === null ? (
            <p className="text-sm text-mist/70">Ads could not be loaded.</p>
          ) : creativeList.length === 0 ? (
            <p className="text-sm text-mist/70">No ads yet. Add your first ad below.</p>
          ) : (
            <ul className="space-y-3">
              {creativeList.map((c) => (
                <li key={c.id} className="rounded-xl border border-line p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium text-mist">{c.headline}</p>
                      <p className="mt-1 whitespace-pre-line break-words text-sm text-mist/80">{c.body}</p>
                      <p className="mt-1 break-all text-xs text-mist/60">
                        {c.ctaText ? `Button: ${c.ctaText} · ` : ""}
                        {c.destinationUrl}
                      </p>
                      <p className="mt-2 text-xs text-aqua">{CREATIVE_STATUS_LABELS[c.status]}</p>
                      {c.status === "rejected" && c.rejectionReason && (
                        <p className="mt-1 break-words text-xs text-red-300">Reason: {c.rejectionReason}</p>
                      )}
                    </div>
                    {canChange && (
                      <div className="flex flex-col gap-2">
                        {availableCreativeActions(c.status).map((a) => (
                          <CreativeActionButton key={a} creativeId={c.id} action={a} />
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {canAddCreative && (
          <Panel title="Add an ad">
            <CreativeForm key={creativeList ? creativeList.length : "unknown"} campaignId={campaign.id} />
          </Panel>
        )}

        {(showReview || reviewBlocked) && (
          <Panel title="Review" note="A campaign goes live only after our team approves it and at least one ad.">
            {showReview && reviewAction && <CampaignReviewButton campaignId={campaign.id} action={reviewAction} />}
            {reviewBlocked && <p className="max-w-md text-sm text-mist/70">{reviewBlocked}</p>}
          </Panel>
        )}

        {(showEdit || showPause || showResume || resumeBlocked) && (
          <Panel title="Actions">
            <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start">
              {showEdit && (
                <Button href={`/dashboard/advertiser/campaigns/${campaign.id}/edit`} variant="secondary">
                  Edit campaign
                </Button>
              )}
              {showPause && <RunStateButton campaignId={campaign.id} mode="pause" />}
              {showResume && <RunStateButton campaignId={campaign.id} mode="resume" />}
            </div>
            {resumeBlocked && <p className="mt-3 max-w-md text-sm text-mist/70">{resumeBlocked}</p>}
            {(showPause || showResume || resumeBlocked) && (
              <p className="mt-3 max-w-md text-xs text-mist/55">{DELIVERY_NOTE}</p>
            )}
          </Panel>
        )}

        {!canChange && <Notice tone="info">Your advertiser account is not approved yet, so this campaign cannot be changed.</Notice>}
      </div>
    </>
  );
}
