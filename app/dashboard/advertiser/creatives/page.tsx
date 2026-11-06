import type { Metadata } from "next";
import Link from "next/link";
import Panel from "@/components/dashboard/Panel";
import PageHeader from "@/components/dashboard/PageHeader";
import Notice from "@/components/auth/Notice";
import CreativePreview from "@/components/campaigns/CreativePreview";
import CreativeStatusBadge from "@/components/campaigns/CreativeStatusBadge";
import CreativeActionButton from "@/components/campaigns/CreativeActionButton";
import CreativeSubmissionForm, { type CampaignOption } from "@/components/campaigns/CreativeSubmissionForm";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listMyCampaigns, loadMyAdvertiser } from "@/lib/campaigns/queries";
import { categoryLabel, isUuid } from "@/lib/campaigns/constants";
import { availableCreativeActions } from "@/lib/campaigns/creative-validation";
import { canEditAndResubmit, type SubmittedCreative } from "@/lib/campaigns/creative-submission";
import { listCreativesForCampaigns, signAssetUrls } from "@/lib/campaigns/creative-submission-queries";

export const metadata: Metadata = { title: "Ads | Blisscco Dashboard" };
export const dynamic = "force-dynamic";

const PATH = "/dashboard/advertiser/creatives";

type Props = { searchParams: Promise<{ result?: string; edit?: string }> };

export default async function AdvertiserCreativesPage({ searchParams }: Props) {
  const [, { advertiser: adv, failed: advertiserFailed }] = await Promise.all([requireRole(["advertiser"]), loadMyAdvertiser()]);
  const sp = await searchParams;
  if (advertiserFailed) throw new Error("Advertiser could not be loaded");

  if (!adv) {
    return (
      <>
        <PageHeader demo={false} title="Ads" description="Submit and track your ads." />
        <Notice tone="info">
          Set up your business first on the <Link href="/dashboard/advertiser/campaigns" className="text-aqua underline-offset-2 hover:underline">campaigns page</Link>.
        </Notice>
      </>
    );
  }

  // Sirf apne campaigns. Creatives bhi sirf in campaign ids ke (RLS ke upar doosri parat): doosre advertiser ka kuch nahi aata.
  const campaignResult = await listMyCampaigns(adv.id);
  if (campaignResult.failed) throw new Error("Campaigns could not be loaded");
  const campaigns = campaignResult.campaigns;
  const names = new Map(campaigns.map((c) => [c.id, c]));
  const creatives = await listCreativesForCampaigns(campaigns.map((c) => c.id));

  const supabase = await createClient();
  const urls = await signAssetUrls(
    supabase,
    (creatives ?? []).flatMap((c) => [c.logoPath, c.bannerPath]),
  );

  const canChange = adv.status === "active";
  const options: CampaignOption[] = campaigns
    .filter((c) => c.status !== "archived" && c.status !== "completed")
    .map((c) => ({ id: c.id, name: c.name, categoryLabel: categoryLabel(c.category) }));

  // Edit mode: sirf apni list me maujood draft / rejected ad
  const editTarget: SubmittedCreative | null =
    sp.edit && isUuid(sp.edit) ? ((creatives ?? []).find((c) => c.id === sp.edit && canEditAndResubmit(c.status)) ?? null) : null;
  const editOption = editTarget ? campaigns.find((c) => c.id === editTarget.campaignId) : null;
  const editOptions: CampaignOption[] = editOption ? [{ id: editOption.id, name: editOption.name, categoryLabel: categoryLabel(editOption.category) }] : [];

  return (
    <>
      <PageHeader
        demo={false}
        title="Ads"
        description="Submit an ad for one of your campaigns and track its review. Every ad is checked by our team before it can be shown."
      />

      {sp.result === "submitted" && <Notice tone="success">Ad submitted. It is pending review and will not be shown until it is approved.</Notice>}
      {sp.result === "resubmitted" && <Notice tone="success">Ad updated and sent for review again. It is pending review.</Notice>}
      {sp.result === "draft" && (
        <Notice tone="info">Your ad was saved as a draft but could not be sent for review. Use “Send for review” on the ad below.</Notice>
      )}

      <div className="mt-6 space-y-5">
        {!canChange && <Notice tone="info">Your advertiser account is not approved yet, so ads cannot be submitted.</Notice>}

        {canChange && (
          <Panel
            title={editTarget ? "Edit and resubmit ad" : "Submit an ad"}
            note={editTarget ? "Changes are saved and the ad goes back to review." : "Choose the campaign this ad belongs to."}
          >
            {editTarget ? (
              <>
                <p className="mb-4 text-sm">
                  <Link href={PATH} className="text-aqua underline-offset-2 hover:underline">
                    Cancel editing
                  </Link>
                </p>
                <CreativeSubmissionForm
                  key={editTarget.id}
                  campaigns={editOptions}
                  editing={{
                    creativeId: editTarget.id,
                    hasLogo: editTarget.logoPath !== null,
                    hasBanner: editTarget.bannerPath !== null,
                    values: {
                      campaignId: editTarget.campaignId,
                      brandName: editTarget.brandName ?? "",
                      headline: editTarget.headline,
                      body: editTarget.body,
                      ctaText: editTarget.ctaText ?? "",
                      destinationUrl: editTarget.destinationUrl,
                      keywords: editTarget.keywords ?? "",
                    },
                  }}
                />
              </>
            ) : options.length === 0 ? (
              <p className="text-sm text-mist/70">
                You need an open campaign first.{" "}
                <Link href="/dashboard/advertiser/campaigns/new" className="text-aqua underline-offset-2 hover:underline">
                  Create a campaign
                </Link>
              </p>
            ) : (
              <CreativeSubmissionForm key={(creatives ?? []).length} campaigns={options} />
            )}
          </Panel>
        )}

        <Panel title="My ads" note="Pending ads are waiting for our team. Only approved ads can be shown.">
          {creatives === null ? (
            <p className="text-sm text-mist/70">Ads could not be loaded. Please refresh the page.</p>
          ) : creatives.length === 0 ? (
            <p className="text-sm text-mist/70">No ads yet. Submit your first ad above.</p>
          ) : (
            <ul className="space-y-3">
              {creatives.map((c) => {
                const campaign = names.get(c.campaignId);
                const actions = availableCreativeActions(c.status).filter((a) => a !== "reopen");
                return (
                  <li key={c.id} className="rounded-xl border border-line p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <CreativeStatusBadge status={c.status} />
                      {campaign && (
                        <Link
                          href={`/dashboard/advertiser/campaigns/${campaign.id}`}
                          className="break-words text-xs text-mist/60 underline-offset-2 hover:text-aqua hover:underline"
                        >
                          {campaign.name} · {categoryLabel(campaign.category)}
                        </Link>
                      )}
                    </div>
                    <div className="mt-3">
                      <CreativePreview
                        brandName={c.brandName}
                        logoUrl={c.logoPath ? (urls.get(c.logoPath) ?? null) : null}
                        bannerUrl={c.bannerPath ? (urls.get(c.bannerPath) ?? null) : null}
                        headline={c.headline}
                        body={c.body}
                        ctaText={c.ctaText}
                        destinationUrl={c.destinationUrl}
                      />
                    </div>
                    <p className="mt-2 break-all text-xs text-mist/60">{c.destinationUrl}</p>
                    {c.keywords && <p className="mt-1 break-words text-xs text-mist/60">Keywords: {c.keywords}</p>}
                    {c.status === "rejected" && (
                      <p className="mt-2 break-words text-sm text-red-300">
                        Rejected{c.rejectionReason ? `: ${c.rejectionReason}` : "."}
                      </p>
                    )}
                    {c.status === "pending_review" && <p className="mt-2 text-xs text-mist/60">Waiting for our team. You can take it back to draft to edit it.</p>}
                    {canChange && (
                      <div className="mt-3 flex flex-wrap items-start gap-2">
                        {canEditAndResubmit(c.status) && (
                          <Link
                            href={`${PATH}?edit=${c.id}`}
                            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-aqua/60 px-4 py-2 text-sm font-medium text-aqua hover:bg-aqua/10"
                          >
                            {c.status === "rejected" ? "Edit and resubmit" : "Edit"}
                          </Link>
                        )}
                        {actions.map((a) => (
                          <CreativeActionButton key={a} creativeId={c.id} action={a} />
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
