import Badge from "@/components/ui/Badge";

type Props = { title: string; description: string };

export default function PageHeader({ title, description }: Props) {
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        <Badge tone="violet">Demo data</Badge>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-mist/70 sm:text-base">{description}</p>
    </div>
  );
}
