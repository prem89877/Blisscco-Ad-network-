"use client";

import { useState } from "react";
import BarChart from "@/components/dashboard/BarChart";
import LineChart from "@/components/dashboard/LineChart";
import Panel from "@/components/dashboard/Panel";
import StatCard from "@/components/dashboard/StatCard";
import { DAILY, ctrOf, sumMetrics } from "@/lib/demo-data";
import { formatCompact, formatCurrency, formatDay, formatNumber, formatPercent } from "@/lib/format";

const RANGES = [7, 14, 30] as const;
type Range = (typeof RANGES)[number];

export default function AnalyticsView() {
  const [range, setRange] = useState<Range>(14);
  const days = DAILY.slice(-range);
  const totals = sumMetrics(days);
  const labels = days.map((d) => formatDay(d.date));

  return (
    <div>
      <div role="group" aria-label="Date range" className="mb-6 flex gap-2">
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Impressions" value={formatCompact(totals.impressions)} />
        <StatCard label="Clicks" value={formatNumber(totals.clicks)} />
        <StatCard label="CTR" value={formatPercent(totals.ctr)} />
        <StatCard label="Ad spend" value={formatCurrency(totals.spend)} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel title="Impressions per day">
          <LineChart
            values={days.map((d) => d.impressions)}
            labels={labels}
            label={`Impressions per day, last ${range} days`}
            format={formatNumber}
          />
        </Panel>
        <Panel title="Click-through rate per day">
          <LineChart
            values={days.map((d) => ctrOf(d.clicks, d.impressions))}
            labels={labels}
            label={`Click-through rate per day, last ${range} days`}
            format={(n) => formatPercent(n)}
          />
        </Panel>
        <Panel title="Clicks per day" className="lg:col-span-2">
          <BarChart
            data={days.map((d) => ({ label: formatDay(d.date), value: d.clicks }))}
            label={`Clicks per day, last ${range} days`}
            format={formatNumber}
          />
        </Panel>
      </div>
    </div>
  );
}
