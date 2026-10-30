import Panel from "@/components/dashboard/Panel";
import StatCard from "@/components/dashboard/StatCard";
import { formatCtr, formatNumber } from "@/lib/format";
import type { CampaignPerformance } from "@/lib/ads/campaign-performance";

type Props = { performance: CampaignPerformance };

const NOTE = "Recorded events still retained (about 90 days). Spend is shown under Details.";

/** Ek campaign ki impressions / clicks / CTR. Zero events (sach me 0) aur fail hui query alag dikhte hain. */
export default function CampaignPerformancePanel({ performance }: Props) {
  if (performance.status === "error") {
    return (
      <Panel title="Performance">
        <p role="alert" className="text-sm text-red-300">
          Performance could not be loaded. Please refresh the page. No figures are shown rather than made-up zeros.
        </p>
      </Panel>
    );
  }

  if (performance.status === "unavailable") {
    return (
      <Panel title="Performance">
        <p className="text-sm text-mist/70">Performance is not available for this campaign.</p>
      </Panel>
    );
  }

  return (
    <Panel title="Performance" note={NOTE}>
      {!performance.hasEvents && (
        <p role="status" className="mb-4 text-sm text-mist/70">
          No impressions or clicks have been recorded for this campaign yet. The zeros below are real counts.
        </p>
      )}
      <section aria-label="Campaign performance" className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Impressions" value={formatNumber(performance.impressions)} hint="Ads recorded as shown." />
        <StatCard label="Clicks" value={formatNumber(performance.clicks)} hint="Clicks recorded on your ads." />
        <StatCard
          label="CTR"
          value={performance.impressions > 0 ? formatCtr(performance.ctr) : "—"}
          hint={performance.impressions > 0 ? "Clicks divided by impressions." : "Shown once there is at least one impression."}
        />
      </section>
    </Panel>
  );
}
