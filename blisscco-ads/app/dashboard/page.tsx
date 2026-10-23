import type { Metadata } from "next";
import Link from "next/link";
import PageHeader from "@/components/dashboard/PageHeader";
import StatCard from "@/components/dashboard/StatCard";
import Panel from "@/components/dashboard/Panel";
import BarList from "@/components/dashboard/BarList";
import RecentCampaigns from "@/components/dashboard/RecentCampaigns";
import ActivityList from "@/components/dashboard/ActivityList";
import Card from "@/components/ui/Card";
import { ACTIVITY, CAMPAIGNS, campaignTotals, ctrOf, recentCampaigns } from "@/lib/demo-data";
import { formatCtr, formatNumber } from "@/lib/format";
import { requireAccount } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Overview | Blisscco Dashboard" };

const LINKS = [
  { href: "/dashboard/advertiser", title: "Advertiser dashboard", text: "See a sample advertiser's budget, spend and relevance." },
  { href: "/dashboard/publisher", title: "Publisher dashboard", text: "See sample ad slots and fill rate for demo AI platforms." },
];

export default async function OverviewPage() {
  await requireAccount();
  const totals = campaignTotals(CAMPAIGNS);
  const performance = [...CAMPAIGNS]
    .filter((c) => c.impressions > 0)
    .sort((a, b) => b.impressions - a.impressions)
    .map((c) => ({
      label: c.name,
      value: c.impressions,
      display: `${formatNumber(c.impressions)} · ${formatCtr(ctrOf(c.clicks, c.impressions))} CTR`,
    }));

  return (
    <>
      <PageHeader
        title="Welcome to the Blisscco dashboard"
        description="This is a preview built with sample data. The campaigns, numbers and events here are made up to show how the dashboard will work."
      />

      <section aria-labelledby="summary-heading">
        <h2 id="summary-heading" className="sr-only">Summary of demo campaigns</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Total demo campaigns" value={formatNumber(totals.total)} hint="Demo data" />
          <StatCard label="Active demo campaigns" value={formatNumber(totals.active)} hint="Demo data" />
          <StatCard label="Demo impressions" value={formatNumber(totals.impressions)} hint="Demo data" />
          <StatCard label="Demo clicks" value={formatNumber(totals.clicks)} hint="Demo data" />
        </div>
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        <Panel
          title="Campaign performance"
          note="Demo impressions and click-through rate per sample campaign. Draft campaigns have no data yet."
          className="lg:col-span-3"
        >
          <BarList items={performance} />
        </Panel>
        <Panel title="Recent activity" note="Fictional demo events, not real activity." className="lg:col-span-2">
          <ActivityList events={ACTIVITY} />
        </Panel>
      </div>

      <section aria-labelledby="recent-heading" className="mt-8">
        <h2 id="recent-heading" className="font-display text-lg font-semibold">Recent demo campaigns</h2>
        <p className="mb-4 mt-1 text-xs text-mist/55">Sorted by start date. Sample data.</p>
        <RecentCampaigns rows={recentCampaigns(CAMPAIGNS, 5)} />
      </section>

      <section aria-labelledby="quick-heading" className="mt-8">
        <h2 id="quick-heading" className="mb-4 font-display text-lg font-semibold">Quick links</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="block rounded-xl">
                <Card className="h-full transition-colors hover:border-aqua/60">
                  <p className="font-medium text-aqua">{l.title}</p>
                  <p className="mt-1 text-sm text-mist/70">{l.text}</p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
