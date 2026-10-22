import Section from "@/components/ui/Section";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import CodeBlock from "@/components/ui/CodeBlock";

/* ---------- Value proposition ---------- */
const VALUES = [
  {
    t: "Contextual",
    d: "Ads are matched to what the conversation is about, not to a profile of the person chatting.",
  },
  {
    t: "Clearly labeled",
    d: "Every placement is marked as sponsored, so people always know what is an ad.",
  },
  {
    t: "Publisher controlled",
    d: "AI publishers decide where ads can appear and which topics stay ad-free.",
  },
];

export function ValueProps() {
  return (
    <Section
      id="value"
      tone="raised"
      title="Relevant ads, without breaking trust"
      intro="Chat is a different place to advertise. Blisscco is built around relevance and transparency."
    >
      <ul className="grid gap-4 md:grid-cols-3">
        {VALUES.map((v) => (
          <Card as="li" key={v.t}>
            <h3 className="font-display text-xl font-semibold">{v.t}</h3>
            <p className="mt-2 text-mist/70">{v.d}</p>
          </Card>
        ))}
      </ul>
    </Section>
  );
}

/* ---------- Audiences ---------- */
function Points({ items }: { items: string[] }) {
  return (
    <ul className="space-y-3 text-mist/80">
      {items.map((i) => (
        <li key={i} className="flex gap-3">
          <span aria-hidden className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet" />
          <span>{i}</span>
        </li>
      ))}
    </ul>
  );
}

const ADVERTISER = [
  "Show your offer when the conversation is already about your category.",
  "Set a budget for each campaign and pause whenever you want.",
  "Track results per campaign ID.",
];
const PUBLISHER = [
  "Earn from free users without adding a paywall.",
  "Block sensitive topics such as health or grief.",
  "Request an ad with one API call and design how it looks in your chat.",
];

export function Audiences() {
  return (
    <>
      <Section id="advertisers" title="For advertisers" intro="Reach people at the moment they are asking about what you offer.">
        <Card className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
          <Points items={ADVERTISER} />
          <Button href="#waitlist" className="w-full md:w-auto">Join as an advertiser</Button>
        </Card>
      </Section>
      <Section id="publishers" tone="raised" title="For AI publishers" intro="Add sponsored placements to your chatbot while keeping control of the experience.">
        <Card className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
          <Points items={PUBLISHER} />
          <Button href="#waitlist" variant="secondary" className="w-full md:w-auto">Join as a publisher</Button>
        </Card>
      </Section>
    </>
  );
}

/* ---------- How it works ---------- */
const STEPS = [
  { t: "The chatbot sends context", d: "The publisher's app sends the topic of the current turn, not the user's identity." },
  { t: "Blisscco picks the best fit", d: "Campaigns are checked for relevance, brand-safety rules and budget." },
  { t: "A labeled ad is returned", d: "The publisher shows it in their own interface, marked as sponsored." },
];

export function HowItWorks() {
  return (
    <Section id="how" title="How an ad gets into a chat">
      <ol className="grid gap-4 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <Card as="li" key={s.t}>
            <p className="font-mono text-sm text-aqua">Step {i + 1}</p>
            <p className="mt-2 text-lg font-medium">{s.t}</p>
            <p className="mt-2 text-mist/70">{s.d}</p>
          </Card>
        ))}
      </ol>
    </Section>
  );
}

/* ---------- Developers ---------- */
const SAMPLE = `POST /v1/ads/match
Authorization: Bearer blc_live_xxxxxxxx

{
  "placement_id": "plc_chat_main",
  "topic": "waterproof jackets for travel",
  "locale": "en-IN"
}

200 OK
{ "campaign_id": "cmp_example", "label": "Sponsored" }`;

export function Developers() {
  return (
    <Section
      id="developers"
      tone="raised"
      title="One request, one ad"
      intro="This is the planned API shape. It is still in design and may change."
    >
      <CodeBlock code={SAMPLE} label="Planned ad match request and response" />
    </Section>
  );
}

/* ---------- Waitlist ---------- */
export function Waitlist() {
  return (
    <Section id="waitlist" title="Get early access" intro="Blisscco is in development. We will open to a small group of advertisers and AI publishers first.">
      <Card className="max-w-xl">
        <p className="text-mist/75">The sign-up form arrives with the next phase. Until then, check back soon.</p>
        <Button href="#top" variant="secondary" className="mt-4">Back to top</Button>
      </Card>
    </Section>
  );
}
