import Container from "@/components/ui/Container";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";

export default function Hero() {
  return (
    <section id="top" className="pb-16 pt-12 sm:pb-24 sm:pt-20">
      <Container className="grid gap-12 md:grid-cols-2 md:items-center">
        <div>
          <h1 className="font-display text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
            Advertising Built for the AI Conversation Era
          </h1>
          <p className="mt-5 max-w-lg text-lg text-mist/75">
            Blisscco connects advertisers with AI chatbot publishers through contextual, relevant, and clearly labeled
            sponsored advertising.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button href="#advertisers">I&apos;m an Advertiser</Button>
            <Button href="#publishers" variant="secondary">I&apos;m an AI Publisher</Button>
          </div>
        </div>

        <figure>
          <Card className="space-y-3">
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-violet px-4 py-3 text-sm text-white">
              Which waterproof jacket works for a rainy week in the hills?
            </p>
            <p className="max-w-[90%] rounded-2xl rounded-bl-sm bg-line/60 px-4 py-3 text-sm text-mist/90">
              Look for taped seams, an adjustable hood and a breathable membrane. Packable shells are easiest to carry.
            </p>
            <div className="rounded-xl border border-aqua/40 bg-aqua/[0.07] p-4">
              <div className="flex items-center justify-between">
                <Badge>Sponsored</Badge>
                <span className="font-mono text-xs text-aqua">cmp_example</span>
              </div>
              <p className="mt-2 font-medium">Example Outdoor Brand: lightweight rain shell</p>
              <p className="text-sm text-mist/70">Shown because the chat is about rain gear.</p>
            </div>
          </Card>
          <figcaption className="mt-3 text-sm text-mist/60">
            Illustration only. This is not a real advertiser or a real conversation.
          </figcaption>
        </figure>
      </Container>
    </section>
  );
}
