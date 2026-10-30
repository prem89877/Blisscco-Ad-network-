import Card from "@/components/ui/Card";
import PropertyStatusBadge from "@/components/dashboard/PropertyStatusBadge";
import { formatNumber, formatPercent } from "@/lib/format";
import type { IntegrationStatus, PublisherProperty } from "@/lib/types";

const STATUS_NOTE: Record<IntegrationStatus, string> = {
  Demo: "Sample metrics for illustration only. Not a live integration.",
  "Pending Integration": "Waiting for the publisher to integrate. No ad requests yet.",
  "Not Connected": "Not connected. No data to show.",
};

const NONE = "\u2014";

/** One publisher property: name, status label and demo metrics. */
export default function PropertyCard({ property }: { property: PublisherProperty }) {
  const hasData = property.status === "Demo";
  const fill = property.adRequests > 0 ? (property.impressions / property.adRequests) * 100 : 0;
  const metrics: { label: string; value: string }[] = [
    { label: "Ad requests", value: hasData ? formatNumber(property.adRequests) : NONE },
    { label: "Impressions", value: hasData ? formatNumber(property.impressions) : NONE },
    { label: "Fill rate", value: hasData ? formatPercent(fill, 1) : NONE },
  ];

  return (
    <Card as="li" className="!p-4 sm:!p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-display text-base font-semibold">{property.name}</h3>
          <p className="text-sm text-mist/60">{property.kind}</p>
        </div>
        <PropertyStatusBadge status={property.status} />
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-3">
        {metrics.map((m) => (
          <div key={m.label}>
            <dt className="text-xs text-mist/55">{m.label}</dt>
            <dd className="mt-0.5 font-mono text-sm text-mist/90">
              {m.value === NONE ? <span aria-label="No data">{m.value}</span> : m.value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs text-mist/55">{STATUS_NOTE[property.status]}</p>
    </Card>
  );
}
