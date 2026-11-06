import type { CreativeStatus } from "@/lib/campaigns/creative-validation";

// Advertiser ko Pending / Approved / Rejected saaf dikhana hai (baaki statuses bhi).
const LABELS: Record<CreativeStatus, string> = {
  draft: "Draft",
  pending_review: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  paused: "Paused",
  archived: "Archived",
};
const TONES: Record<CreativeStatus, string> = {
  draft: "bg-mist/10 text-mist/70",
  pending_review: "bg-amber-400/15 text-amber-300",
  approved: "bg-aqua/15 text-aqua",
  rejected: "bg-red-500/15 text-red-300",
  paused: "bg-amber-400/15 text-amber-300",
  archived: "bg-mist/10 text-mist/55",
};

export default function CreativeStatusBadge({ status }: { status: CreativeStatus }) {
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${TONES[status]}`}>{LABELS[status]}</span>;
}
