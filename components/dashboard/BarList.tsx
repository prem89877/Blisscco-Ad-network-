type Item = { label: string; value: number; display: string };

/** Horizontal bars with labels. Good for rankings on narrow screens. */
export default function BarList({ items }: { items: Item[] }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="space-y-4">
      {items.map((i) => (
        <li key={i.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-mist/85">{i.label}</span>
            <span className="font-mono text-mist/70">{i.display}</span>
          </div>
          <div className="mt-1.5 h-2 rounded bg-ink">
            <div className="h-2 rounded bg-violet" style={{ width: `${(i.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
