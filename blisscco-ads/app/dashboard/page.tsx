import type { Metadata } from "next";
import Link from "next/link";
import PageHeader from "@/components/dashboard/PageHeader";
import StatCard from "@/components/dashboard/StatCard";
import Panel from "@/components/dashboard/Panel";
import BarChart from "@/components/dashboard/BarChart";
import BarList from "@/components/dashboard/BarList";
import CampaignTable from "@/components/dashboard/CampaignTable";
import Card from "@/components/ui/Card";
import { CAMPAIGNS, DAILY, PAYOUT_SHARE, PUBLISHERS, sumMetrics, weekDelta } from "@/lib/demo-data";
import { formatCompact, formatCurrency, formatDay, formatNumber, formatPercent } from "@/lib/format";

export const metadata: Metadata = { title: "Overview | Blisscco Dashboard" };

const LINKS = [
  { href: "/dashboard/advertiser", t: "Advertiser view", d: "Budget, spend and relevance for one advertiser." },
  { href: "/dashboard/publisher", t: "Publisher view", d: "Earnings and fill rate across AI platforms." },
  { href: "/dashboard/campaigns", t: "Campaigns", d: "Filter and sort every campaign." },
  { href: "/dashboard/analytics", t: "Analytics", d: "Trends over 7, 14 or 30 days." },
];

export default function OverviewPage() {
  const last14 = DAILY.slice(-14);
  const t = sumMetrics(last14);
  const topCampaigns = [...CAMPAIGNS].sort((a, b) => b.spend - a.spend).slice(0, 4);
  const topPublishers = [...PUBLISHERS].sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  return (
    <>
      <PageHeader
        title="Overview"
        description="A snapshot of the whole network over the last 14 days. Every number on this page is sample data."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Impressions" value={formatCompact(t.impressions)} delta={weekDelta("impressions")} />
        <StatCard label="CTR" value={formatPercent(t.ctr)} delta={weekDelta("ctr")} />
        <StatCard label="Advertiser spend" value={formatCurrency(t.spend)} delta={weekDelta("spend")} />
        <StatCard
          label="Publisher payouts"
          value={formatCurrency(t.spend * PAYOUT_SHARE)}
          hint={`Demo: ${Math.round(PAYOUT_SHARE * 100)}% of spend`}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Panel title="Impressions per day" note="Last 14 days" className="lg:col-span-2">
          <BarChart
            data={last14.map((d) => ({ label: formatDay(d.date), value: d.impressions }))}
            label="Impressions per day, last 14 days"
            format={formatNumber}
          />
        </Panel>
        <Panel title="Top publishers" note="By earnings (sample)">
          <BarList items={topPublishers.map((p) => ({ label: p.name, value: p.revenue, display: formatCurrency(p.revenue) }))} />
        </Panel>
      </div>

      <section aria-labelledby="top-campaigns" className="mt-8">
        <h2 id="top-campaigns" className="mb-4 font-display text-lg font-semibold">Top campaigns by spend</h2>
        <CampaignTable rows={topCampaigns} caption="Top campaigns by spend" />
      </section>

      <section aria-labelledby="explore" className="mt-8">
        <h2 id="explore" className="mb-4 font-display text-lg font-semibold">Explore</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="block rounded-xl">
                <Card className="h-full transition-colors hover:border-aqua/60">
                  <p className="font-medium text-aqua">{l.t}</p>
                  <p className="mt-1 text-sm text-mist/70">{l.d}</p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
