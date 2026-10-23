import type { Metadata } from "next";
import Link from "next/link";
import Button from "@/components/ui/Button";
import Panel from "@/components/dashboard/Panel";
import DataTable, { type Column } from "@/components/dashboard/DataTable";
import CampaignStatusBadge from "@/components/campaigns/CampaignStatusBadge";
import Notice from "@/components/auth/Notice";
import { requireRole } from "@/lib/auth/session";
import { getMyAdvertiser, listMyCampaigns } from "@/lib/campaigns/queries";
import { categoryLabel } from "@/lib/campaigns/constants";
import type { Campaign } from "@/lib/campaigns/types";
import { formatDate, formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "My campaigns | Blisscco Dashboard" };
export const dynamic = "force-dynamic";

const columns: Column<Campaign>[] = [
  {
    header: "Campaign",
    cell: (c) => (
      <Link href={`/dashboard/advertiser/campaigns/${c.id}`} className="rounded text-aqua underline-offset-2 hover:underline">
        {c.name}
      </Link>
    ),
  },
  { header: "Category", cell: (c) => categoryLabel(c.category) },
  { header: "Status", cell: (c) => <CampaignStatusBadge status={c.status} /> },
  { header: "Total budget", numeric: true, cell: (c) => formatMoney(c.totalBudget) },
  { header: "Dates", cell: (c) => `${formatDate(c.startDate)} – ${c.endDate ? formatDate(c.endDate) : "no end date"}` },
];

export default async function CampaignsListPage() {
  await requireRole(["advertiser"]);
  const adv = await getMyAdvertiser();

  return (
    <>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">My campaigns</h1>
        <p className="mt-2 max-w-2xl text-sm text-mist/70 sm:text-base">
          Your saved campaigns. Spend, impressions and clicks are not tracked yet because ad serving is not live.
        </p>
      </div>

      {!adv && (
        <Notice tone="error">
          Your advertiser account was not found. Please log out and log in again, or contact support.
        </Notice>
      )}

      {adv && adv.status !== "active" && (
        <Notice tone="info">Your advertiser account is not active, so you can view campaigns but not change them.</Notice>
      )}

      {adv && (
        <CampaignList advertiserId={adv.id} canCreate={adv.status === "active"} />
      )}
    </>
  );
}

async function CampaignList({ advertiserId, canCreate }: { advertiserId: string; canCreate: boolean }) {
  const { campaigns, failed } = await listMyCampaigns(advertiserId);

  return (
    <div className="mt-6 space-y-5">
      {canCreate && (
        <div>
          <Button href="/dashboard/advertiser/campaigns/new">New campaign</Button>
        </div>
      )}

      {failed ? (
        <Notice tone="error">We could not load your campaigns. Please refresh the page.</Notice>
      ) : campaigns.length === 0 ? (
        <Panel title="No campaigns yet">
          <p className="text-sm text-mist/70">
            {canCreate ? "Create your first campaign to get started." : "You have no campaigns."}
          </p>
        </Panel>
      ) : (
        <DataTable caption="Your campaigns" columns={columns} rows={campaigns} rowKey={(c) => c.id} />
      )}
    </div>
  );
}
