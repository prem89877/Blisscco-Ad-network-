import type { CampaignStatus } from "@/lib/types";

const TONES: Record<CampaignStatus, string> = {
  Active: "bg-aqua/15 text-aqua",
  Paused: "bg-amber-400/15 text-amber-300",
  Draft: "bg-mist/10 text-mist/70",
  Completed: "bg-violet/25 text-[#B9AAFF]",
};

export default function StatusBadge({ status }: { status: CampaignStatus }) {
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${TONES[status]}`}>{status}</span>;
}
