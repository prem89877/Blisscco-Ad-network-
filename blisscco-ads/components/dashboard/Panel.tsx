import Card from "@/components/ui/Card";

type Props = { title: string; note?: string; children: React.ReactNode; className?: string };

/** Card with an h2 heading, used for every chart/table block on dashboard pages. */
export default function Panel({ title, note, children, className = "" }: Props) {
  return (
    <Card as="article" className={className}>
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      {note && <p className="mt-1 text-xs text-mist/55">{note}</p>}
      <div className="mt-4">{children}</div>
    </Card>
  );
}
