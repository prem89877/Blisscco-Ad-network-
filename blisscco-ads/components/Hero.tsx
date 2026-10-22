import Container from "@/components/ui/Container";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";

const CANDIDATES = [
  { id: "cmp_8f3a21", brand: "Trailhead Gear", fit: 94 },
  { id: "cmp_41c9be", brand: "Peak Pantry", fit: 81 },
  { id: "cmp_07d5aa", brand: "Daybreak Travel", fit: 66 },
];

export default function Hero() {
  return (
    <section id="top" className="pb-16 pt-12 sm:pb-20 sm:pt-20">
      <Container className="grid gap-10 md:grid-cols-2 md:items-center md:gap-12">
        <div>
          <h1 className="font-display text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
            Ads that answer the question being asked.
          </h1>
          <p className="mt-5 max-w-md text-lg text-mist/75">
            Blisscco matches advertisers to the topic of an AI chat and labels every placement as an ad. No user profiles needed.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button href="#waitlist">Join the waitlist</Button>
            <Button href="#developers" variant="secondary">See the API</Button>
          </div>
        </div>

        <Card className="space-y-3" >
          <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-violet px-4 py-3 text-sm text-white">
            Which waterproof jacket works for a rainy week in Munnar?
          </p>
          <p className="max-w-[90%] rounded-2xl rounded-bl-sm bg-line/60 px-4 py-3 text-sm text-mist/90">
            Look for taped seams, an adjustable hood and a breathable membrane. Packable shells are easiest to carry.
          </p>
          <div className="rounded-xl border border-aqua/40 bg-aqua/[0.07] p-4">
            <div className="flex items-center justify-between">
              <Badge>Sponsored</Badge>
              <span className="font-mono text-xs text-aqua">cmp_8f3a21</span>
            </div>
            <p className="mt-2 font-medium">Trailhead Gear: taped-seam shell, 320 g</p>
            <p className="text-sm text-mist/70">Packs into its own pocket. Free returns.</p>
          </div>
          <div className="border-t border-line pt-3">
            <p className="mb-2 text-xs text-mist/60">Candidates matched to this topic (relevance %)</p>
            <ul className="space-y-1.5">
              {CANDIDATES.map((c) => (
                <li key={c.id} className="flex items-center gap-3 text-xs">
                  <span className="w-24 shrink-0 font-mono text-mist/60">{c.id}</span>
                  <span className="hidden w-28 truncate sm:block">{c.brand}</span>
                  <span className="h-1.5 flex-1 rounded bg-line">
                    <span className="block h-1.5 rounded bg-aqua" style={{ width: `${c.fit}%` }} />
                  </span>
                  <span className="w-7 text-right font-mono text-mist/70">{c.fit}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </Container>
    </section>
  );
}
