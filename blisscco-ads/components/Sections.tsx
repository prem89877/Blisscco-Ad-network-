const STEPS = [
  { n: "1", t: "Chat platform sends context", d: "Your app sends the topic of the current turn, not the user's identity." },
  { n: "2", t: "Blisscco picks the best fit", d: "Campaigns are scored on relevance, brand-safety rules and budget." },
  { n: "3", t: "A labelled ad is returned", d: "You render it in your own UI. We count the impression and the click." },
];

export function HowItWorks() {
  return (
    <section id="how" className="bg-mist py-20 text-ink">
      <div className="mx-auto max-w-6xl px-5">
        <h2 className="font-display text-3xl font-semibold sm:text-4xl">How an ad gets into a chat</h2>
        <ol className="mt-10 grid gap-5 md:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="border-l-4 border-violet pl-5">
              <p className="font-mono text-sm text-violet">Step {s.n}</p>
              <p className="mt-1 text-lg font-medium">{s.t}</p>
              <p className="mt-2 text-ink/70">{s.d}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function Audiences() {
  return (
    <section className="mx-auto grid max-w-6xl gap-10 px-5 py-20 md:grid-cols-2">
      <div id="platforms">
        <h2 className="font-display text-2xl font-semibold">For chatbot platforms</h2>
        <ul className="mt-4 space-y-2 text-mist/75">
          <li>Earn from free users without a paywall.</li>
          <li>Block topics you never want ads near, such as health or grief.</li>
          <li>One API call, and you control how the ad looks.</li>
        </ul>
      </div>
      <div id="advertisers">
        <h2 className="font-display text-2xl font-semibold">For advertisers</h2>
        <ul className="mt-4 space-y-2 text-mist/75">
          <li>Reach people while they are deciding, in their own words.</li>
          <li>Set a budget per campaign and pause any time.</li>
          <li>See which topics produce clicks, per campaign ID.</li>
        </ul>
      </div>
    </section>
  );
}

const SAMPLE = `POST /v1/ads/match
Authorization: Bearer blc_live_••••••••

{
  "placement_id": "plc_chat_main",
  "topic": "waterproof jackets for travel",
  "locale": "en-IN"
}

200 OK
{ "campaign_id": "cmp_8f3a21", "label": "Sponsored", "click_url": "https://…" }`;

export function Developers() {
  return (
    <section id="developers" className="border-y border-white/10 bg-white/[0.03] py-20">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 md:grid-cols-2 md:items-center">
        <div>
          <h2 className="font-display text-3xl font-semibold">One request, one ad</h2>
          <p className="mt-4 max-w-md text-mist/75">
            Send the topic, get back a campaign to show. The API is in design; this is the planned shape and may change.
          </p>
        </div>
        <pre className="overflow-x-auto rounded-xl border border-white/10 bg-ink p-5 font-mono text-[13px] leading-6 text-aqua">
          <code>{SAMPLE}</code>
        </pre>
      </div>
    </section>
  );
}

export function Waitlist() {
  return (
    <section id="waitlist" className="mx-auto max-w-2xl px-5 py-24 text-center">
      <h2 className="font-display text-3xl font-semibold sm:text-4xl">Get early access</h2>
      <p className="mt-4 text-mist/75">We are onboarding a small group of platforms and advertisers first.</p>
      <p className="mt-8 rounded-lg border border-dashed border-white/20 p-4 text-sm text-mist/60">
        Waitlist form connects to Supabase in the next phase.
      </p>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-white/10 py-8 text-center text-sm text-mist/60">
      <span className="font-display font-semibold text-mist">Blisscco</span> Online Ad Network
    </footer>
  );
}
