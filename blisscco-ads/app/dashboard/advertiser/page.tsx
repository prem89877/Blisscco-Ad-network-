import type { Metadata } from "next";
import PageHeader from "@/components/dashboard/PageHeader";
import StatCard from "@/components/dashboard/StatCard";
import Panel from "@/components/dashboard/Panel";
import BarList from "@/components/dashboard/BarList";
import CampaignTable from "@/components/dashboard/CampaignTable";
import Badge from "@/components/ui/Badge";
import { CAMPAIGNS, DEMO_ADVERTISER, ctrOf, spendByTopic } from "@/lib/demo-data";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";

export const metadata: Metadata = { title: "Advertiser | Blisscco Dashboard" };

export default function AdvertiserPage() {
  const mine = CAMPAIGNS.filter((c) => c.advertiser === DEMO_ADVERTISER);
  const budget = mine.reduce((a, c) => a + c.budget, 0);
  const spend = mine.reduce((a, c) => a + c.spend, 0);
  const impressions = mine.reduce((a, c) => a + c.impressions, 0);
  const clicks = mine.reduce((a, c) => a + c.clicks, 0);
  const scored = mine.filter((c) => c.status !== "Draft");
  const avgRelevance = scored.length ? scored.reduce((a, c) => a + c.relevance, 0) / scored.length : 0;
  const lead = mine[0];

  return (
    <>
      <PageHeader
        title="Advertiser dashboard"
        description={`Sample account: ${DEMO_ADVERTISER}. See how budget, relevance and clicks look for one advertiser.`}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total budget" value={formatCurrency(budget)} />
        <StatCard label="Spent so far" value={formatCurrency(spend)} hint={`${formatPercent(budget ? (spend / budget) * 100 : 0, 0)} of budget`} />
        <StatCard label="Clicks" value={formatNumber(clicks)} hint={`CTR ${formatPercent(ctrOf(clicks, impressions))}`} />
        <StatCard label="Relevance score" value={`${Math.round(avgRelevance)}/100`} hint="Topic match, demo score" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel title="Spend by topic">
          <BarList items={spendByTopic(mine).map((s) => ({ label: s.label, value: s.value, display: formatCurrency(s.value) }))} />
        </Panel>
        <Panel title="Ad preview" note="Example of a labelled contextual ad inside a chatbot (mock-up)">
          <div className="rounded-lg border border-line bg-ink p-4">
            <p className="text-sm text-mist/70">User: Any tips to prepare for my exams next month?</p>
            <div className="mt-3 rounded-lg border border-aqua/40 p-3">
              <div className="flex items-center gap-2">
                <Badge>Sponsored</Badge>
                <span className="text-xs text-mist/60">{DEMO_ADVERTISER}</span>
              </div>
              <p className="mt-2 font-medium">{lead ? lead.name : "Your campaign"}</p>
              <p className="mt-1 text-sm text-mist/70">Free practice tests and a 4-week study planner. Sample ad text.</p>
            </div>
          </div>
        </Panel>
      </div>

      <section aria-labelledby="my-campaigns" className="mt-8">
        <h2 id="my-campaigns" className="mb-4 font-display text-lg font-semibold">Your campaigns</h2>
        <CampaignTable rows={mine} caption={`${DEMO_ADVERTISER} campaigns`} />
      </section>
    </>
  );
}
