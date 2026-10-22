import type { Metadata } from "next";
import PageHeader from "@/components/dashboard/PageHeader";
import StatCard from "@/components/dashboard/StatCard";
import Panel from "@/components/dashboard/Panel";
import BarList from "@/components/dashboard/BarList";
import DataTable, { type Column } from "@/components/dashboard/DataTable";
import Badge from "@/components/ui/Badge";
import { PUBLISHERS, ctrOf } from "@/lib/demo-data";
import { formatCompact, formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import type { Publisher } from "@/lib/types";

export const metadata: Metadata = { title: "Publisher | Blisscco Dashboard" };

const fill = (p: Publisher) => (p.adRequests > 0 ? (p.impressions / p.adRequests) * 100 : 0);

const columns: Column<Publisher>[] = [
  { header: "Platform", cell: (p) => p.name },
  { header: "Category", cell: (p) => p.category },
  { header: "Ad requests", numeric: true, cell: (p) => formatNumber(p.adRequests) },
  { header: "Fill rate", numeric: true, cell: (p) => formatPercent(fill(p), 1) },
  { header: "CTR", numeric: true, cell: (p) => formatPercent(ctrOf(p.clicks, p.impressions)) },
  { header: "Earnings", numeric: true, cell: (p) => formatCurrency(p.revenue) },
];

export default function PublisherPage() {
  const revenue = PUBLISHERS.reduce((a, p) => a + p.revenue, 0);
  const impressions = PUBLISHERS.reduce((a, p) => a + p.impressions, 0);
  const requests = PUBLISHERS.reduce((a, p) => a + p.adRequests, 0);
  const clicks = PUBLISHERS.reduce((a, p) => a + p.clicks, 0);
  const sorted = [...PUBLISHERS].sort((a, b) => b.revenue - a.revenue);

  return (
    <>
      <PageHeader
        title="AI publisher dashboard"
        description="Sample view for a publisher running several AI chatbot platforms. Earnings are demo numbers, not real payouts."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Earnings" value={formatCurrency(revenue)} />
        <StatCard label="Impressions" value={formatCompact(impressions)} />
        <StatCard label="Fill rate" value={formatPercent(requests ? (impressions / requests) * 100 : 0, 1)} hint="Requests that got an ad" />
        <StatCard label="CTR" value={formatPercent(ctrOf(clicks, impressions))} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel title="Earnings by platform">
          <BarList items={sorted.map((p) => ({ label: p.name, value: p.revenue, display: formatCurrency(p.revenue) }))} />
        </Panel>
        <Panel title="Publisher controls">
          <div className="flex items-center gap-2">
            <Badge tone="violet">Preview</Badge>
            <span className="text-sm text-mist/70">Not live yet</span>
          </div>
          <ul className="mt-3 space-y-2 text-sm text-mist/80">
            <li>Every ad is clearly labelled as sponsored.</li>
            <li>Ads are matched to the topic of the conversation.</li>
            <li>Planned: blocked categories and frequency limits per platform.</li>
          </ul>
        </Panel>
      </div>

      <section aria-labelledby="platforms" className="mt-8">
        <h2 id="platforms" className="mb-4 font-display text-lg font-semibold">Your platforms</h2>
        <DataTable caption="Publisher platforms" columns={columns} rows={sorted} rowKey={(p) => p.id} />
      </section>
    </>
  );
}
