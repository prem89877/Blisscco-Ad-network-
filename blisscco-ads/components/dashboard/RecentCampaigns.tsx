import DataTable, { type Column } from "@/components/dashboard/DataTable";
import StatusBadge from "@/components/dashboard/StatusBadge";
import { formatCurrency } from "@/lib/format";
import type { Campaign } from "@/lib/types";

const columns: Column<Campaign>[] = [
  { header: "Campaign", cell: (c) => c.name },
  { header: "Category", cell: (c) => c.topic },
  { header: "Status", cell: (c) => <StatusBadge status={c.status} /> },
  { header: "Budget", numeric: true, cell: (c) => formatCurrency(c.budget) },
];

/** Name, category, status and budget for a short list of sample campaigns. */
export default function RecentCampaigns({ rows }: { rows: Campaign[] }) {
  return <DataTable caption="Recent sample campaigns" columns={columns} rows={rows} rowKey={(c) => c.id} />;
}
