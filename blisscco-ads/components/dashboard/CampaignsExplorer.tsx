"use client";

import { useMemo, useState } from "react";
import CampaignTable from "@/components/dashboard/CampaignTable";
import { CAMPAIGNS, STATUSES, ctrOf } from "@/lib/demo-data";
import type { CampaignStatus } from "@/lib/types";

type Filter = "All" | CampaignStatus;
type Sort = "spend" | "impressions" | "ctr";

const FILTERS: Filter[] = ["All", ...STATUSES];

export default function CampaignsExplorer() {
  const [filter, setFilter] = useState<Filter>("All");
  const [sort, setSort] = useState<Sort>("spend");

  const rows = useMemo(() => {
    const list = CAMPAIGNS.filter((c) => filter === "All" || c.status === filter);
    const key = (c: (typeof CAMPAIGNS)[number]) =>
      sort === "spend" ? c.spend : sort === "impressions" ? c.impressions : ctrOf(c.clicks, c.impressions);
    return [...list].sort((a, b) => key(b) - key(a));
  }, [filter, sort]);

  return (
    <div>
      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`min-h-11 rounded-lg border px-4 text-sm font-medium ${
                filter === f ? "border-aqua bg-aqua/10 text-aqua" : "border-line text-mist/75 hover:border-aqua/50"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <label className="text-sm text-mist/70">
          <span className="mr-2">Sort by</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="min-h-11 rounded-lg border border-line bg-surface px-3 text-mist"
          >
            <option value="spend">Spend</option>
            <option value="impressions">Impressions</option>
            <option value="ctr">CTR</option>
          </select>
        </label>
      </div>
      <p aria-live="polite" className="mb-3 text-sm text-mist/60">
        {rows.length} {rows.length === 1 ? "campaign" : "campaigns"}
      </p>
      {rows.length > 0 ? (
        <CampaignTable rows={rows} caption="Campaign list" />
      ) : (
        <p className="rounded-xl border border-line bg-surface p-6 text-mist/70">No campaigns with this status.</p>
      )}
    </div>
  );
}
