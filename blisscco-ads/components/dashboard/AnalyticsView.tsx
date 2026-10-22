"use client";

import { useState } from "react";
import BarChart from "@/components/dashboard/BarChart";
import BarList from "@/components/dashboard/BarList";
import LineChart from "@/components/dashboard/LineChart";
import Panel from "@/components/dashboard/Panel";
import StatCard from "@/components/dashboard/StatCard";
import { CAMPAIGNS, DAILY, ctrOf, spendByTopic, sumMetrics } from "@/lib/demo-data";
import { formatCompact, formatCtr, formatCurrency, formatDay, formatNumber } from "@/lib/format";

const RANGES = [7, 14, 30] as const;
type Range = (typeof RANGES)[number];

export default function AnalyticsView() {
  const [range, setRange] = useState<Range>(14);
  const days = DAILY.slice(-range);
  const totals = sumMetrics(days);
  const labels = days.map((d) => formatDay(d.date));
  const categorySpend = spendByTopic(CAMPAIGNS);

  return (
    <div>
      <p className="mb-4 rounded-lg border border-line bg-surface px-4 py-3 text-sm text-mist/75">
        Every number and chart on this page is <strong className="font-semibold text-mist">demo data</strong>. It does
        not come from real traffic, revenue or campaign performance.
      </p>

      <div role="group" aria-label="Date range" className="mb-6 flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={range === r}
            onClick={() => setRange(r)}
            className={`min-h-11 rounded-lg border px-4 text-sm font-medium ${
              range === r ? "border-aqua bg-aqua/10 text-aqua" : "border-line text-mist/75 hover:border-aqua/50"
            }`}
          >
            Last {r} days
          </button>
        ))}
      </div>

      <section aria-labelledby="totals">
        <h2 id="totals" className="sr-only">Demo totals for the last {range} days</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Demo impressions" value={formatCompact(totals.impressions)} hint="Demo data" />
          <StatCard label="Demo clicks" value={formatNumber(totals.clicks)} hint="Demo data" />
          <StatCard label="Demo CTR" value={formatCtr(totals.ctr)} hint="Clicks ÷ impressions × 100" />
          <StatCard label="Demo spending" value={formatCurrency(totals.spend)} hint="Demo data" />
        </div>
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel title="Impressions per day" note="Demo data">
          <LineChart
            values={days.map((d) => d.impressions)}
            labels={labels}
            label={`Demo impressions per day, last ${range} days`}
            format={formatNumber}
          />
        </Panel>
        <Panel title="Click-through rate per day" note="Demo data. CTR = clicks ÷ impressions × 100; shown as 0% when there are no impressions.">
          <LineChart
            values={days.map((d) => ctrOf(d.clicks, d.impressions))}
            labels={labels}
            label={`Demo click-through rate per day, last ${range} days`}
            format={formatCtr}
          />
        </Panel>
        <Panel title="Clicks per day" note="Demo data" className="lg:col-span-2">
          <BarChart
            data={days.map((d) => ({ label: formatDay(d.date), value: d.clicks }))}
            label={`Demo clicks per day, last ${range} days`}
            format={formatNumber}
          />
        </Panel>
        <Panel
          title="Demo spending by category"
          note="Based on the sample campaigns list, not on the date range above. Demo data."
          className="lg:col-span-2"
        >
          <BarList items={categorySpend.map((c) => ({ label: c.label, value: c.value, display: formatCurrency(c.value) }))} />
        </Panel>
      </div>
    </div>
  );
}
