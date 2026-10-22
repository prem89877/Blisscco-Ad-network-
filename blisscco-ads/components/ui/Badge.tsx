type Tone = "aqua" | "violet" | "neutral";
type BadgeProps = { children: React.ReactNode; tone?: Tone };

const TONES: Record<Tone, string> = {
  aqua: "bg-aqua text-ink",
  violet: "bg-violet text-white",
  neutral: "bg-mist/10 text-mist/80",
};

export default function Badge({ children, tone = "aqua" }: BadgeProps) {
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}
