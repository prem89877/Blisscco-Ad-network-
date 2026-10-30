type Point = { label: string; value: number };
type Props = { data: Point[]; label: string; format: (n: number) => string };

/** Simple CSS column chart. `label` is read by screen readers as the chart summary. */
export default function BarChart({ data, label, format }: Props) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const first = data[0];
  const last = data[data.length - 1];
  return (
    <figure>
      <div
        role="img"
        aria-label={`${label}. Highest value ${format(max)}.`}
        className="flex h-44 items-end gap-1 sm:gap-1.5"
      >
        {data.map((d) => (
          <div
            key={d.label}
            title={`${d.label}: ${format(d.value)}`}
            className="min-h-[2px] flex-1 rounded-t bg-violet"
            style={{ height: `${(d.value / max) * 100}%` }}
          />
        ))}
      </div>
      {first && last && (
        <figcaption className="mt-2 flex justify-between text-xs text-mist/55">
          <span>{first.label}</span>
          <span>{last.label}</span>
        </figcaption>
      )}
    </figure>
  );
}
