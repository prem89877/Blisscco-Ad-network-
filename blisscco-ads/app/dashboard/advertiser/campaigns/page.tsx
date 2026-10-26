import type { Metadata } from "next";
import Link from "next/link";
import Button from "@/components/ui/Button";
import Panel from "@/components/dashboard/Panel";
import DataTable, { type Column } from "@/components/dashboard/DataTable";
import CampaignStatusBadge from "@/components/campaigns/CampaignStatusBadge";
import CampaignFilters from "@/components/campaigns/CampaignFilters";
import Notice from "@/components/auth/Notice";
import { AdvertiserSetupForm } from "@/components/dashboard/AccountSetupForm";
import { requireRole } from "@/lib/auth/session";
import { listMyCampaigns, loadMyAdvertiser } from "@/lib/campaigns/queries";
import { categoryLabel } from "@/lib/campaigns/constants";
import { filtersToHref, hasActiveFilters, parseFilters, type CampaignFilters as Filters } from "@/lib/campaigns/filters";
import type { Campaign } from "@/lib/campaigns/types";
import { formatDate, formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "My campaigns | Blisscco Dashboard" };
export const dynamic = "force-dynamic";

const LIST_PATH = "/dashboard/advertiser/campaigns";
const NEW_PATH = `${LIST_PATH}/new`;

const columns: Column<Campaign>[] = [
  {
    header: "Campaign",
    cell: (c) => (
      <Link href={`${LIST_PATH}/${c.id}`} className="break-words rounded text-aqua underline-offset-2 hover:underline">
        {c.name}
      </Link>
    ),
  },
  { header: "Category", cell: (c) => categoryLabel(c.category) },
  { header: "Status", cell: (c) => <CampaignStatusBadge status={c.status} /> },
  { header: "Total budget", numeric: true, cell: (c) => formatMoney(c.totalBudget) },
  { header: "Start date", cell: (c) => formatDate(c.startDate) },
  { header: "End date", cell: (c) => (c.endDate ? formatDate(c.endDate) : "No end date") },
];

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function CampaignsListPage({ searchParams }: Props) {
  await requireRole(["advertiser"]);
  // URL ke filters server par dobara validate hote hain (lib/campaigns/filters.ts).
  const filters = parseFilters(await searchParams);
  const { advertiser: adv, failed: advertiserFailed } = await loadMyAdvertiser();
  // Database dikkat ko "advertiser nahi hai" (Set up your business form) na samjho: error boundary (Try again).
  if (advertiserFailed) throw new Error("Advertiser could not be loaded");
  const canCreate = adv?.status === "active";

  return (
    <>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">My campaigns</h1>
          <p className="mt-2 max-w-2xl text-sm text-mist/70 sm:text-base">
            Your saved campaigns. Open a campaign to add ads, send it for review and see its spend.
          </p>
        </div>
        {canCreate && (
          <Button href={NEW_PATH} className="shrink-0">
            Create campaign
          </Button>
        )}
      </div>

      {!adv && (
        <Panel title="Set up your business" note="One quick step before you can create campaigns.">
          <AdvertiserSetupForm />
        </Panel>
      )}

      {adv && adv.status === "pending" && (
        <Notice tone="info">
          Thanks! Your business details are saved. Our team will approve your account soon. After that you can create campaigns.
        </Notice>
      )}
      {adv && adv.status === "suspended" && (
        <Notice tone="error">Your advertiser account is suspended, so campaigns cannot be changed. Please contact support.</Notice>
      )}

      {adv && <CampaignList advertiserId={adv.id} canCreate={canCreate} filters={filters} />}
    </>
  );
}

async function CampaignList({
  advertiserId,
  canCreate,
  filters,
}: {
  advertiserId: string;
  canCreate: boolean;
  filters: Filters;
}) {
  const { campaigns, failed, total } = await listMyCampaigns(advertiserId, filters);
  const filtered = hasActiveFilters(filters);
  const noneAtAll = !failed && campaigns.length === 0 && !filtered;

  return (
    <div className="mt-6 space-y-5">
      {/* Pehli baar kuch hai hi nahi toh filters dikhane ka matlab nahi. */}
      {!noneAtAll && <CampaignFilters action={LIST_PATH} filters={filters} />}

      {failed ? (
        <div>
          <Notice tone="error">We could not load your campaigns. Please try again.</Notice>
          <div className="mt-4">
            <Button href={filtersToHref(LIST_PATH, filters)} variant="secondary">
              Try again
            </Button>
          </div>
        </div>
      ) : noneAtAll ? (
        <Panel title="No campaigns yet">
          <p className="text-sm text-mist/70">
            {canCreate ? "Create your first campaign to get started." : "You have no campaigns."}
          </p>
          {canCreate && (
            <div className="mt-4">
              <Button href={NEW_PATH}>Create campaign</Button>
            </div>
          )}
        </Panel>
      ) : campaigns.length === 0 ? (
        <Panel title="No campaigns match your filters">
          <p className="text-sm text-mist/70">Try a different name, status or category.</p>
          <div className="mt-4">
            <Button href={LIST_PATH} variant="secondary">
              Clear filters
            </Button>
          </div>
        </Panel>
      ) : (
        <>
          <p className="text-sm text-mist/60" aria-live="polite">
            {total > campaigns.length
              ? `Showing the latest ${campaigns.length} of ${total} campaigns. Use search or filters to narrow down.`
              : `${total} ${total === 1 ? "campaign" : "campaigns"}${filtered ? " found" : ""}.`}
          </p>
          <DataTable caption="Your campaigns" columns={columns} rows={campaigns} rowKey={(c) => c.id} />
        </>
      )}
    </div>
  );
}
