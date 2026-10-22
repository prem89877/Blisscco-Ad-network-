type Props = { values: number[]; labels: string[]; label: string; format: (n: number) => string };

const W = 600;
const H = 180;
const P = 8;

/** SVG line chart with a soft area fill. No chart library needed. */
export default function LineChart({ values, labels, label, format }: Props) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = values.length === 1 ? W / 2 : P + (i / (values.length - 1)) * (W - 2 * P);
    const y = H - P - ((v - min) / span) * (H - 2 * P);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = pts.join(" ");
  const area = `${P},${H - P} ${line} ${W - P},${H - P}`;
  return (
    <figure>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label}. Low ${format(min)}, high ${format(max)}.`}
        className="h-44 w-full"
      >
        <polygon points={area} className="fill-aqua/10" />
        <polyline
          points={line}
          className="fill-none stroke-aqua"
          strokeWidth={2}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption className="mt-2 flex justify-between text-xs text-mist/55">
        <span>{labels[0]}</span>
        <span>Low {format(min)} · High {format(max)}</span>
        <span>{labels[labels.length - 1]}</span>
      </figcaption>
    </figure>
  );
}
