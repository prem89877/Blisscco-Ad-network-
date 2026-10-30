import Panel from "@/components/dashboard/Panel";
import StatCard from "@/components/dashboard/StatCard";
import Notice from "@/components/auth/Notice";
import Button from "@/components/ui/Button";
import { formatCtr, formatNumber } from "@/lib/format";
import type { PublisherOverview } from "@/lib/ads/publisher-overview";

type Props = { overview: PublisherOverview };

/** Publisher ki apni traffic: impressions, clicks, CTR. Zero events (sach me 0) aur fail hui query alag dikhte hain. */
export default function PublisherAnalyticsView({ overview }: Props) {
  if (overview.status === "error") {
    return <Notice tone="error">Analytics could not be loaded. Please refresh the page. No figures are shown rather than made-up zeros.</Notice>;
  }

  if (overview.status === "unavailable") {
    return (
      <Panel title="Not available for this account">
        <p className="max-w-2xl text-sm text-mist/80">This view shows publisher traffic, so there is nothing to show for your account type here.</p>
      </Panel>
    );
  }

  if (overview.status === "not_found") {
    return (
      <Panel title="Set up your platform first" note="Analytics are shown once your active publisher account exists.">
        <Button href="/dashboard/publisher" variant="secondary">
          Go to Publisher
        </Button>
      </Panel>
    );
  }

  return (
    <>
      {!overview.hasEvents && (
        <Notice tone="info">No impressions or clicks have been recorded for your platform yet. The zeros below are real counts.</Notice>
      )}
      <div className="mt-6 space-y-6">
        <section aria-label="Publisher analytics totals" className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Impressions" value={formatNumber(overview.impressions)} hint="Ads recorded as shown on your platform." />
          <StatCard label="Clicks" value={formatNumber(overview.clicks)} hint="Clicks recorded on ads shown on your platform." />
          <StatCard
            label="CTR"
            value={overview.impressions > 0 ? formatCtr(overview.ctr) : "—"}
            hint={overview.impressions > 0 ? "Total clicks divided by total impressions." : "Shown once there is at least one impression."}
          />
        </section>
        <p className="text-xs text-mist/55">
          Totals for your own traffic only. Counts cover events still retained (about 90 days). Earnings are on the Earnings page.
        </p>
      </div>
    </>
  );
}
