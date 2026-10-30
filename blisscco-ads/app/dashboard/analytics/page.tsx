import type { Metadata } from "next";
import PageHeader from "@/components/dashboard/PageHeader";
import Panel from "@/components/dashboard/Panel";
import StatCard from "@/components/dashboard/StatCard";
import Notice from "@/components/auth/Notice";
import Button from "@/components/ui/Button";
import { requireAccount } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadAdvertiserOverview } from "@/lib/ads/analytics-overview";
import { formatCtr, formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Analytics | Blisscco Dashboard" };
export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const account = await requireAccount();
  // Ownership DATABASE me hai: function caller ki apni session (auth.uid()) se campaigns nikalta hai. Yahan koi id bheji nahi jaati.
  const overview = await loadAdvertiserOverview(account.role, () => createClient());

  const header = (
    <PageHeader
      demo={false}
      title="Analytics"
      description="Impressions, clicks and click-through rate (CTR) recorded for your campaigns."
    />
  );

  if (overview.status === "unavailable") {
    return (
      <>
        {header}
        <Panel title="Not available for this account">
          <p className="max-w-2xl text-sm text-mist/80">
            This overview shows advertiser campaign analytics, so there is nothing to show for your account type here.
          </p>
        </Panel>
      </>
    );
  }

  if (overview.status === "error") {
    return (
      <>
        {header}
        <Notice tone="error">Analytics could not be loaded. Please refresh the page. No figures are shown rather than made-up zeros.</Notice>
      </>
    );
  }

  if (overview.status === "empty") {
    return (
      <>
        {header}
        <Panel title="No campaigns yet" note="Analytics appear once you have created a campaign.">
          <Button href="/dashboard/advertiser/campaigns" variant="secondary">
            Go to Campaigns
          </Button>
        </Panel>
      </>
    );
  }

  const t = overview.totals;
  const noEvents = t.campaignsWithEvents === 0;
  const campaignWord = t.campaigns === 1 ? "campaign" : "campaigns";

  return (
    <>
      {header}

      {noEvents && (
        <Notice tone="info">
          No impressions or clicks have been recorded for your {t.campaigns} {campaignWord} yet. The zeros below are real counts.
        </Notice>
      )}

      <div className="mt-6 space-y-6">
        <section aria-label="Analytics totals" className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Impressions" value={formatNumber(t.impressions)} hint="Ads recorded as shown." />
          <StatCard label="Clicks" value={formatNumber(t.clicks)} hint="Clicks recorded on your ads." />
          <StatCard
            label="CTR"
            value={t.impressions > 0 ? formatCtr(t.ctr) : "—"}
            hint={t.impressions > 0 ? "Total clicks divided by total impressions." : "Shown once there is at least one impression."}
          />
        </section>

        <p className="text-xs text-mist/55">
          Totals across {t.campaigns} {campaignWord}; {t.campaignsWithEvents} with recorded events. Counts cover events still
          retained (about 90 days). Spend and revenue are not part of this overview.
        </p>
      </div>
    </>
  );
}
