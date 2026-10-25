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

type Titled = { t: string; d: string };

/** Numbered step cards, reused by "How it works" and the publisher workflow. */
function Steps({ items, heading: H = "h3" }: { items: Titled[]; heading?: "h3" | "h4" }) {
  return (
    <ol className="grid gap-4 md:grid-cols-3">
      {items.map((s, i) => (
        <Card as="li" key={s.t}>
          <p className="font-mono text-sm text-aqua">Step {i + 1}</p>
          <H className="mt-2 text-lg font-medium">{s.t}</H>
          <p className="mt-2 text-mist/70">{s.d}</p>
        </Card>
      ))}
    </ol>
  );
}

/** Two-column title + description cards, reused by "Why match ads by topic" and "Transparency and trust". */
function InfoCards({ items }: { items: Titled[] }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {items.map((x) => (
        <Card as="li" key={x.t}>
          <h3 className="font-display text-xl font-semibold">{x.t}</h3>
          <p className="mt-2 text-mist/70">{x.d}</p>
        </Card>
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
      <Steps items={STEPS} />
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
        <Button href="#advertiser-pilot" className="w-full sm:w-auto">See pilot status</Button>
      </div>
    </Section>
  );
}

/* Advertiser pilot: sign-up ab khula hai (account ko team approve karti hai). */
export function AdvertiserPilot() {
  return (
    <Section id="advertiser-pilot" title="Advertiser pilot">
      <Card className="max-w-2xl">
        <Badge tone="violet">Early access</Badge>
        <h3 className="mt-3 font-display text-xl font-semibold">Run a pilot campaign</h3>
        <p className="mt-2 text-mist/75">
          Create an advertiser account, save your business details, and build a campaign with a budget and an ad. Our
          team reviews every account, ad and campaign before anything is shown, and ads always carry a Sponsored label.
        </p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <Button href="/signup" className="w-full sm:w-auto">
            Create an account
          </Button>
          <Button href="#advertisers" variant="secondary" className="w-full sm:w-auto">
            Back to advertisers
          </Button>
        </div>
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
      <InfoCards items={BENEFITS} />
      <p className="mt-6 max-w-2xl text-sm text-mist/60">
        Blisscco does not guarantee clicks, engagement or revenue. Results depend on the campaign, the topic and the
        publisher.
      </p>
    </Section>
  );
}

/* ---------- For AI publishers ---------- */
const PUBLISHER_STEPS = [
  {
    t: "Integrate the API",
    d: "Connect your chatbot backend to Blisscco's advertising API using credentials issued to you after authorization.",
  },
  {
    t: "Request a contextually relevant ad",
    d: "When a conversation fits an allowed topic, your server sends a topic slug, never the conversation, and asks for a matching ad.",
  },
  {
    t: "Display it with clear sponsorship labeling",
    d: "Your product shows the ad inside your own interface, always marked as sponsored so people can tell it apart from the chatbot's answer.",
  },
];

const PUBLISHER_CONTROLS = [
  "You decide where and how an ad appears in your product.",
  "Sensitive topics such as health or grief can be kept ad-free.",
  "You design the display, as long as the sponsored label stays clear.",
];

export function Publishers() {
  return (
    <Section
      id="publishers"
      title="For AI publishers"
      intro="If you build an AI chatbot, you will be able to integrate Blisscco's advertising API into your own product, while keeping control of the experience."
    >
      <Card className="mb-8 max-w-3xl">
        <Badge tone="violet">Early access</Badge>
        <p className="mt-3 text-mist/80">
          Create a publisher account and, once our team approves it, you can create your own API keys from the dashboard.
          The API is in early access, so test it carefully before using it in production. Ads are always labelled
          Sponsored, and keys must stay on your server.
        </p>
      </Card>

      <h3 className="font-display text-xl font-semibold">The intended workflow</h3>
      <div className="mt-4">
        <Steps items={PUBLISHER_STEPS} heading="h4" />
      </div>

      <Card className="mt-8 grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
        <div>
          <h3 className="font-display text-xl font-semibold">Planned publisher controls</h3>
          <div className="mt-4">
            <Points items={PUBLISHER_CONTROLS} />
          </div>
        </div>
        <Button href="#waitlist" variant="secondary" className="w-full md:w-auto">
          Get started
        </Button>
      </Card>
    </Section>
  );
}

/* ---------- Developers ---------- */
const SAMPLE = `POST /api/v1/ads/match
Authorization: Bearer YOUR_PUBLISHER_API_KEY
Content-Type: application/json

{ "topic": "gaming" }

200 OK
{
  "fill": true,
  "sponsored": true,
  "ad": {
    "id": "...",
    "headline": "...",
    "body": "...",
    "cta_text": "...",
    "destination_url": "https://..."
  }
}

200 OK (no eligible ad)
{ "fill": false }`;

export function Developers() {
  return (
    <Section
      id="developers"
      tone="raised"
      title="One request, one ad"
      intro="This is the current request shape of the limited, pre-launch API. Call it from your server only, never from a browser. It may still change."
    >
      <CodeBlock code={SAMPLE} label="Ad match request and responses" />
    </Section>
  );
}

/* ---------- Transparency and trust ---------- */
const TRUST = [
  {
    t: "Ads are labeled as sponsored",
    d: "Every ad must be clearly marked as sponsored, so it is never mistaken for the chatbot's own answer.",
  },
  {
    t: "Matching uses topic or category",
    d: "Ads are matched using topic or category information about the conversation, not a profile of the person.",
  },
  {
    t: "No automatic access to third-party chatbots",
    d: "Blisscco does not automatically access or modify the interface of any third-party chatbot.",
  },
  {
    t: "Authorized integrations only",
    d: "Ads are served only through integrations that a publisher has set up with authorization.",
  },
];

export function Trust() {
  return (
    <Section
      id="trust"
      tone="raised"
      title="Transparency and trust"
      intro="These are the principles Blisscco is being designed around."
    >
      <InfoCards items={TRUST} />
      <p className="mt-6 max-w-2xl text-sm text-mist/60">
        These are design commitments for a network that is still in development. Detailed policies will be published
        before launch.
      </p>
    </Section>
  );
}

/* ---------- Waitlist (placeholder) ---------- */
export function Waitlist() {
  return (
    <Section id="waitlist" title="Get started" intro="Blisscco is in early access. Create an account as an advertiser or an AI publisher. New accounts are approved by our team.">
      <Card className="max-w-xl">
        <Badge tone="violet">Early access</Badge>
        <p className="mt-3 text-mist/75">Sign up takes a minute. You can set up your business or platform right after.</p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <Button href="/signup" className="w-full sm:w-auto">Create an account</Button>
          <Button href="/login" variant="secondary" className="w-full sm:w-auto">Log in</Button>
        </div>
      </Card>
    </Section>
  );
}
