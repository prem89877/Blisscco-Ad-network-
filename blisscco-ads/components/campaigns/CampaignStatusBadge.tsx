import { STATUS_LABELS, type CampaignDbStatus } from "@/lib/campaigns/constants";

const TONES: Record<CampaignDbStatus, string> = {
  draft: "bg-mist/10 text-mist/70",
  pending_review: "bg-amber-400/15 text-amber-300",
  active: "bg-aqua/15 text-aqua",
  paused: "bg-amber-400/15 text-amber-300",
  completed: "bg-violet/25 text-[#B9AAFF]",
  rejected: "bg-red-500/15 text-red-300",
  archived: "bg-mist/10 text-mist/55",
};

export default function CampaignStatusBadge({ status }: { status: CampaignDbStatus }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${TONES[status]}`}>{STATUS_LABELS[status]}</span>
  );
}
