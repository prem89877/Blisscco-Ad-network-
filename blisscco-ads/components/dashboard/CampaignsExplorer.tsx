"use client";

import { useMemo, useState } from "react";
import CampaignTable from "@/components/dashboard/CampaignTable";
import { CAMPAIGNS, CAMPAIGN_TOPICS, STATUSES, ctrOf, filterCampaigns } from "@/lib/demo-data";
import type { Campaign, CampaignStatus } from "@/lib/types";

type StatusFilter = "All" | CampaignStatus;
type Sort = "spend" | "impressions" | "ctr";

const STATUS_FILTERS: StatusFilter[] = ["All", ...STATUSES];

const sortKey = (c: Campaign, sort: Sort): number =>
  sort === "spend" ? c.spend : sort === "impressions" ? c.impressions : ctrOf(c.clicks, c.impressions);

const field =
  "min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-base text-mist placeholder:text-mist/40";

export default function CampaignsExplorer() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [status, setStatus] = useState<StatusFilter>("All");
  const [sort, setSort] = useState<Sort>("spend");

  const rows = useMemo(() => {
    const list = filterCampaigns(CAMPAIGNS, { query, category, status });
    return [...list].sort((a, b) => sortKey(b, sort) - sortKey(a, sort));
  }, [query, category, status, sort]);

  const filtersActive = query.trim() !== "" || category !== "All" || status !== "All";
  const clearFilters = () => {
    setQuery("");
    setCategory("All");
    setStatus("All");
  };

  return (
    <div>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <label className="block text-sm text-mist/70 sm:col-span-3 lg:col-span-1">
          <span className="mb-1 block">Search campaign name</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. Workout"
            autoComplete="off"
            className={field}
          />
        </label>
        <label className="block text-sm text-mist/70">
          <span className="mb-1 block">Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={field}>
            <option value="All">All categories</option>
            {CAMPAIGN_TOPICS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-mist/70">
          <span className="mb-1 block">Sort by</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={field}>
            <option value="spend">Demo spend</option>
            <option value="impressions">Impressions</option>
            <option value="ctr">CTR</option>
          </select>
        </label>
      </div>

      <div role="group" aria-label="Filter by status" className="mb-4 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={status === f}
            onClick={() => setStatus(f)}
            className={`min-h-11 rounded-lg border px-4 text-sm font-medium ${
              status === f ? "border-aqua bg-aqua/10 text-aqua" : "border-line text-mist/75 hover:border-aqua/50"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p aria-live="polite" className="text-sm text-mist/60">
          {rows.length} of {CAMPAIGNS.length} demo {CAMPAIGNS.length === 1 ? "campaign" : "campaigns"}
        </p>
        {filtersActive && (
          <button
            type="button"
            onClick={clearFilters}
            className="min-h-11 rounded-lg px-3 text-sm font-medium text-aqua hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {rows.length > 0 ? (
        <CampaignTable rows={rows} caption="Demo campaign list" />
      ) : (
        <div className="rounded-xl border border-line bg-surface p-6 text-center sm:p-8">
          <h2 className="font-display text-lg font-semibold">No campaigns match</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-mist/70">
            Try a shorter search, another category or status, or clear the filters to see all demo campaigns.
          </p>
          <button
            type="button"
            onClick={clearFilters}
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg border border-aqua/60 px-5 text-base font-medium text-aqua hover:bg-aqua/10"
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
