import type { IntegrationStatus } from "@/lib/types";

const TONES: Record<IntegrationStatus, string> = {
  Demo: "bg-violet/25 text-[#B9AAFF]",
  "Pending Integration": "bg-amber-400/15 text-amber-300",
  "Not Connected": "bg-mist/10 text-mist/70",
};

/** Text label (never colour alone) for a property's integration status. */
export default function PropertyStatusBadge({ status }: { status: IntegrationStatus }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${TONES[status]}`}>
      {status}
    </span>
  );
}
