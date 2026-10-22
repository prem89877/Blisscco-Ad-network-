import Card from "@/components/ui/Card";
import { formatDelta } from "@/lib/format";

type Props = { label: string; value: string; delta?: number; hint?: string };

export default function StatCard({ label, value, delta, hint }: Props) {
  return (
    <Card className="!p-4 sm:!p-5">
      <p className="text-sm text-mist/65">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold tracking-tight sm:text-3xl">{value}</p>
      {delta !== undefined && (
        <p className={`mt-1 text-xs font-medium ${delta >= 0 ? "text-aqua" : "text-rose-400"}`}>
          {formatDelta(delta)} <span className="font-normal text-mist/50">vs previous 7 days</span>
        </p>
      )}
      {hint && <p className="mt-1 text-xs text-mist/50">{hint}</p>}
    </Card>
  );
}
