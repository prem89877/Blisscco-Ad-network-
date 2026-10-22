import Section from "@/components/ui/Section";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import CodeBlock from "@/components/ui/CodeBlock";

const STEPS = [
  { t: "Chat platform sends context", d: "Your app sends the topic of the current turn, not the user's identity." },
  { t: "Blisscco picks the best fit", d: "Campaigns are scored on relevance, brand-safety rules and budget." },
  { t: "A labelled ad is returned", d: "You render it in your own UI. We count the impression and the click." },
];

export function HowItWorks() {
  return (
    <Section id="how" title="How an ad gets into a chat" tone="raised">
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

const PLATFORM = [
  "Earn from free users without a paywall.",
  "Block topics you never want ads near, such as health or grief.",
  "One API call, and you control how the ad looks.",
];
const ADVERTISER = [
  "Reach people while they are deciding, in their own words.",
  "Set a budget per campaign and pause any time.",
  "See which topics produce clicks, per campaign ID.",
];

function Points({ items }: { items: string[] }) {
  return (
    <ul className="mt-4 space-y-3 text-mist/75">
      {items.map((i) => (
        <li key={i} className="flex gap-3">
          <span aria-hidden className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet" />
          <span>{i}</span>
        </li>
      ))}
    </ul>
  );
}

export function Audiences() {
  return (
    <Section title="Built for both sides of the chat">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h3 id="platforms" className="font-display text-xl font-semibold">For chatbot platforms</h3>
          <Points items={PLATFORM} />
        </Card>
        <Card>
          <h3 id="advertisers" className="font-display text-xl font-semibold">For advertisers</h3>
          <Points items={ADVERTISER} />
        </Card>
      </div>
    </Section>
  );
}

const SAMPLE = `POST /v1/ads/match
Authorization: Bearer blc_live_xxxxxxxx

{
  "placement_id": "plc_chat_main",
  "topic": "waterproof jackets for travel",
  "locale": "en-IN"
}

200 OK
{ "campaign_id": "cmp_8f3a21", "label": "Sponsored" }`;

export function Developers() {
  return (
    <Section
      id="developers"
      tone="raised"
      title="One request, one ad"
      intro="Send the topic, get back a campaign to show. The API is in design, so this shape may change."
    >
      <CodeBlock code={SAMPLE} label="Example ad match request and response" />
    </Section>
  );
}

export function Waitlist() {
  return (
    <Section id="waitlist" title="Get early access" intro="We are onboarding a small group of platforms and advertisers first.">
      <Card className="max-w-xl">
        <p className="text-mist/75">The sign-up form arrives with the database phase. Until then, check back soon.</p>
        <Button href="#top" variant="secondary" className="mt-4">Back to top</Button>
      </Card>
    </Section>
  );
}
