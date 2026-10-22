"use client";

import { useRef, useState } from "react";
import StatCard from "@/components/dashboard/StatCard";
import StatusBadge from "@/components/dashboard/StatusBadge";
import DataTable, { type Column } from "@/components/dashboard/DataTable";
import CreateCampaignForm, { type NewCampaignInput } from "@/components/dashboard/CreateCampaignForm";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { ADVERTISER_CAMPAIGNS } from "@/lib/demo-data";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { AdvertiserCampaign } from "@/lib/types";

const columns: Column<AdvertiserCampaign>[] = [
  {
    header: "Campaign",
    cell: (c) => (
      <span>
        {c.name}
        {c.createdThisSession && <span className="block text-xs font-normal text-aqua">Created this session</span>}
      </span>
    ),
  },
  { header: "Category", cell: (c) => c.category },
  { header: "Budget", numeric: true, cell: (c) => formatCurrency(c.budget) },
  { header: "Demo spending", numeric: true, cell: (c) => formatCurrency(c.spend) },
  { header: "Status", cell: (c) => <StatusBadge status={c.status} /> },
];

const CREATE_BUTTON_ID = "create-campaign-button";

export default function AdvertiserWorkspace() {
  const [campaigns, setCampaigns] = useState<AdvertiserCampaign[]>(ADVERTISER_CAMPAIGNS);
  const [formOpen, setFormOpen] = useState(false);
  const [message, setMessage] = useState("");
  const nextId = useRef(1);

  const active = campaigns.filter((c) => c.status === "Active").length;
  const spend = campaigns.reduce((a, c) => a + c.spend, 0);
  const impressions = campaigns.reduce((a, c) => a + c.impressions, 0);

  function closeForm() {
    setFormOpen(false);
    document.getElementById(CREATE_BUTTON_ID)?.focus();
  }

  function handleCreate(input: NewCampaignInput) {
    const id = `demo_new_${nextId.current}`;
    nextId.current += 1;
    // New demo campaigns start as drafts with no spend: nothing is delivered.
    setCampaigns((list) => [
      { id, name: input.name, category: input.category, budget: input.budget, spend: 0, impressions: 0, status: "Draft", createdThisSession: true },
      ...list,
    ]);
    setMessage(`Added demo campaign "${input.name}" as a draft.`);
    closeForm();
  }

  function clearList() {
    setCampaigns([]);
    setMessage("Cleared the demo campaign list.");
  }

  function restoreSamples() {
    setCampaigns(ADVERTISER_CAMPAIGNS);
    setMessage("Restored the sample campaigns.");
  }

  return (
    <>
      <aside
        aria-label="Demo notice"
        className="mb-6 rounded-xl border border-amber-300/40 bg-amber-300/10 p-4 text-sm text-amber-100"
      >
        <p className="font-medium">Real advertiser accounts are not connected yet.</p>
        <p className="mt-1 text-amber-100/80">
          Every campaign and number on this page is demo data. Nothing is saved, no ads are delivered, and campaigns you
          add disappear when you refresh the page.
        </p>
      </aside>

      <section aria-labelledby="advertiser-summary">
        <h2 id="advertiser-summary" className="sr-only">Summary of demo campaigns</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Total campaigns" value={formatNumber(campaigns.length)} hint="Demo data" />
          <StatCard label="Active campaigns" value={formatNumber(active)} hint="Demo data" />
          <StatCard label="Demo spending" value={formatCurrency(spend)} hint="Demo data" />
          <StatCard label="Demo impressions" value={formatNumber(impressions)} hint="Demo data" />
        </div>
      </section>

      <section aria-labelledby="advertiser-campaigns" className="mt-8">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="advertiser-campaigns" className="font-display text-lg font-semibold">Campaigns</h2>
            <Badge tone="violet">Demo data</Badge>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              id={CREATE_BUTTON_ID}
              aria-expanded={formOpen}
              aria-controls="create-campaign-form"
              onClick={() => setFormOpen(true)}
            >
              Create campaign
            </Button>
            {campaigns.length > 0 && (
              <Button variant="secondary" onClick={clearList}>Clear list</Button>
            )}
          </div>
        </div>

        <p role="status" className="mb-3 min-h-5 text-sm text-aqua">{message}</p>

        {formOpen && (
          <div className="mb-6">
            <CreateCampaignForm onCreate={handleCreate} onCancel={closeForm} />
          </div>
        )}

        {campaigns.length > 0 ? (
          <DataTable caption="Demo campaigns" columns={columns} rows={campaigns} rowKey={(c) => c.id} />
        ) : (
          <div className="rounded-xl border border-dashed border-line bg-surface p-6 text-center sm:p-10">
            <h3 className="font-display text-lg font-semibold">No demo campaigns yet</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-mist/70">
              Use Create campaign to add a sample one, or bring back the example list. Nothing here is real.
            </p>
            <div className="mt-5 flex flex-col justify-center gap-3 sm:flex-row">
              <Button onClick={() => setFormOpen(true)}>Create campaign</Button>
              <Button variant="secondary" onClick={restoreSamples}>Restore sample campaigns</Button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
