import Section from "@/components/ui/Section";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import CodeBlock from "@/components/ui/CodeBlock";

/* ---------- Shared ---------- */
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

/* ---------- 1. How it works ---------- */
const STEPS = [
  {
    t: "Advertisers create campaigns",
    d: "An advertiser chooses the topics their offer fits, writes a short sponsored message and sets a budget.",
  },
  {
    t: "Blisscco matches ads to relevant topics",
    d: "When a chat is about a matching topic, Blisscco selects a campaign that fits it and follows the publisher's rules.",
  },
  {
    t: "AI publishers show labeled ads",
    d: "Integrated AI publishers display the ad inside their chat, clearly marked as sponsored.",
  },
];

export function HowItWorks() {
  return (
    <Section id="how" title="How it works" intro="Three steps from campaign to conversation.">
      <ol className="grid gap-4 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <Card as="li" key={s.t}>
            <p className="font-mono text-sm text-aqua">Step {i + 1}</p>
            <h3 className="mt-2 text-lg font-medium">{s.t}</h3>
            <p className="mt-2 text-mist/70">{s.d}</p>
          </Card>
        ))}
      </ol>
      <p className="mt-6 text-sm text-mist/60">
        This describes how Blisscco is designed to work. The network is still in development.
      </p>
    </Section>
  );
}

/* ---------- 2. For advertisers ---------- */
const CATEGORIES = [
  { name: "Gaming", example: "Chats about game picks, hardware or strategy." },
  { name: "Technology", example: "Questions about gadgets, apps and comparisons." },
  { name: "Education", example: "Study help, courses and learning tools." },
  { name: "Developer Tools", example: "Coding questions, frameworks and hosting." },
];

export function Advertisers() {
  return (
    <Section
      id="advertisers"
      tone="raised"
      title="For advertisers"
      intro="Contextual advertising shows an ad based on what is being discussed right now, instead of who the person is. In a chatbot, that means your offer can appear next to a conversation about your category."
    >
      <h3 className="font-display text-xl font-semibold">Example categories</h3>
      <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {CATEGORIES.map((c) => (
          <Card as="li" key={c.name}>
            <p className="font-medium text-aqua">{c.name}</p>
            <p className="mt-2 text-sm text-mist/70">{c.example}</p>
          </Card>
        ))}
      </ul>
      <p className="mt-4 text-sm text-mist/60">
        Examples of topics we plan to support. No advertiser is running in these categories yet.
      </p>
      <div className="mt-8">
        <Button href="#advertiser-pilot" className="w-full sm:w-auto">Express interest in a pilot</Button>
      </div>
    </Section>
  );
}

/* Placeholder: no backend yet, so no form and nothing is sent or stored. */
export function AdvertiserPilot() {
  return (
    <Section id="advertiser-pilot" title="Advertiser pilot">
      <Card className="max-w-2xl">
        <Badge tone="violet">Coming later</Badge>
        <h3 className="mt-3 font-display text-xl font-semibold">Advertiser onboarding is not open yet</h3>
        <p className="mt-2 text-mist/75">
          Blisscco is still being built, and no advertisers have joined. There is no sign-up form on this page, and
          nothing you do here is sent or saved. A pilot campaign sign-up will be added in a later phase.
        </p>
        <Button href="#advertisers" variant="secondary" className="mt-5 w-full sm:w-auto">
          Back to advertisers
        </Button>
      </Card>
    </Section>
  );
}

/* ---------- 3. Intended benefits of topic-based matching ---------- */
const BENEFITS = [
  {
    t: "Relevance to the moment",
    d: "An ad that fits the topic is more likely to feel useful than one chosen at random.",
  },
  {
    t: "Less personal data",
    d: "Matching on topic does not require building a profile of the person chatting.",
  },
  {
    t: "Clear context for reporting",
    d: "Results can be read per campaign and per topic, so advertisers can see where an ad was shown.",
  },
  {
    t: "Fewer unwelcome placements",
    d: "Publishers can keep sensitive topics ad-free, which helps protect the chat experience.",
  },
];

export function Benefits() {
  return (
    <Section
      id="value"
      tone="raised"
      title="Why match ads by topic"
      intro="These are the benefits topic-based matching is designed to offer."
    >
      <ul className="grid gap-4 sm:grid-cols-2">
        {BENEFITS.map((b) => (
          <Card as="li" key={b.t}>
            <h3 className="font-display text-xl font-semibold">{b.t}</h3>
            <p className="mt-2 text-mist/70">{b.d}</p>
          </Card>
        ))}
      </ul>
      <p className="mt-6 max-w-2xl text-sm text-mist/60">
        Blisscco does not guarantee clicks, engagement or revenue. Results depend on the campaign, the topic and the
        publisher.
      </p>
    </Section>
  );
}

/* ---------- For AI publishers ---------- */
const PUBLISHER = [
  "Add sponsored placements without adding a paywall.",
  "Block sensitive topics such as health or grief.",
  "Request an ad with one API call and design how it looks in your chat.",
];

export function Publishers() {
  return (
    <Section id="publishers" title="For AI publishers" intro="Add sponsored placements to your chatbot while keeping control of the experience.">
      <Card className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
        <Points items={PUBLISHER} />
        <Button href="#waitlist" variant="secondary" className="w-full md:w-auto">Join as a publisher</Button>
      </Card>
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

/* ---------- Waitlist (placeholder) ---------- */
export function Waitlist() {
  return (
    <Section id="waitlist" title="Get early access" intro="Blisscco is in development. We plan to open to a small group of advertisers and AI publishers first.">
      <Card className="max-w-xl">
        <p className="text-mist/75">The sign-up form arrives with the next phase. Until then, check back soon.</p>
        <Button href="#top" variant="secondary" className="mt-4">Back to top</Button>
      </Card>
    </Section>
  );
}
