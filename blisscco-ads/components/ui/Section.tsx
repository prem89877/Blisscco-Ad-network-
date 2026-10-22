import Container from "./Container";

type SectionProps = {
  id?: string;
  title?: string;
  intro?: string;
  tone?: "base" | "raised";
  children: React.ReactNode;
};

/** Page section with consistent vertical spacing and optional heading. */
export default function Section({ id, title, intro, tone = "base", children }: SectionProps) {
  const bg = tone === "raised" ? "border-y border-line bg-surface/50" : "";
  return (
    <section id={id} className={`py-16 sm:py-20 ${bg}`}>
      <Container>
        {title && (
          <div className="mb-10 max-w-2xl">
            <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
            {intro && <p className="mt-3 text-base text-mist/75 sm:text-lg">{intro}</p>}
          </div>
        )}
        {children}
      </Container>
    </section>
  );
}
