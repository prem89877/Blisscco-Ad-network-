import type { IntegrationStatus } from "@/lib/types";
import { propertyGuidance } from "@/lib/publisher/setup-guidance";

const TONES: Record<IntegrationStatus, string> = {
  Demo: "bg-violet/25 text-[#B9AAFF]",
  "Pending Integration": "bg-amber-400/15 text-amber-300",
  "Not Connected": "bg-mist/10 text-mist/70",
};

/** Text label (never colour alone) for a property's integration status, with a plain-language meaning for screen readers and hover. */
export default function PropertyStatusBadge({ status }: { status: IntegrationStatus }) {
  const g = propertyGuidance(status);
  return (
    <span title={g.short} className={`inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${TONES[status]}`}>
      {status}
      <span className="sr-only"> ({g.short})</span>
    </span>
  );
}
