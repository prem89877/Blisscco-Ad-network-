import DataTable, { type Column } from "@/components/dashboard/DataTable";
import StatusBadge from "@/components/dashboard/StatusBadge";
import { ctrOf } from "@/lib/demo-data";
import { formatCtr, formatCurrency, formatNumber } from "@/lib/format";
import type { Campaign } from "@/lib/types";

const columns: Column<Campaign>[] = [
  {
    header: "Campaign",
    cell: (c) => (
      <span>
        {c.name}
        <span className="block font-mono text-xs text-mist/50">{c.id}</span>
      </span>
    ),
  },
  { header: "Category", cell: (c) => c.topic },
  { header: "Status", cell: (c) => <StatusBadge status={c.status} /> },
  { header: "Budget", numeric: true, cell: (c) => formatCurrency(c.budget) },
  { header: "Demo spend", numeric: true, cell: (c) => formatCurrency(c.spend) },
  { header: "Impressions", numeric: true, cell: (c) => formatNumber(c.impressions) },
  { header: "CTR", numeric: true, cell: (c) => formatCtr(ctrOf(c.clicks, c.impressions)) },
];

export default function CampaignTable({ rows, caption }: { rows: Campaign[]; caption: string }) {
  return <DataTable caption={caption} columns={columns} rows={rows} rowKey={(c) => c.id} />;
}
