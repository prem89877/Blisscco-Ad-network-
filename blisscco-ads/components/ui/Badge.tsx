type BadgeProps = { children: React.ReactNode; tone?: "aqua" | "violet" };

export default function Badge({ children, tone = "aqua" }: BadgeProps) {
  const t = tone === "aqua" ? "bg-aqua text-ink" : "bg-violet text-white";
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${t}`}>{children}</span>;
}
