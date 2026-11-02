type Step = {
  title: string;
  text: string;
  /** Real route this step calls (method + path), taken from app/api/v1/ads/*. Shown as code. */
  route?: string;
  /** Required request pieces of that route, exactly as the route handlers accept them. */
  required?: string;
};

// Day 29 Part 1: quick-start sequence. Routes and required fields come from the real handlers:
// app/api/v1/ads/match, impression and click (lib/ads/validation.ts, impression.ts, click.ts). Nothing here is invented.
// tests/publisher/day29-part1-quick-start.test.ts checks every route and field below against that code.
export const INTEGRATION_STEPS: Step[] = [
  {
    title: "Create a publisher key",
    text: "After your account is approved, create a key on the Publisher page. It is shown only once, so copy it straight into the server environment variable BLISSCCO_PUBLISHER_API_KEY. Never in browser code.",
  },
  {
    title: "Configure the API base URL",
    text: "Set BLISSCCO_API_BASE_URL on your server to the API host Blisscco gives you. Neither variable gets a public prefix such as NEXT_PUBLIC_.",
  },
  {
    title: "Request an ad",
    text: "Call this from your own backend, once per ad placement. No ad (no-fill), a timeout or any error means: show nothing and let the chatbot answer as normal.",
    route: "POST /api/v1/ads/match",
    required: "Header Authorization: Bearer <your key>, header Content-Type: application/json, body field topic. Optional: Idempotency-Key header, X-Blisscco-Tracking: 1 header (returns tracking.token and tracking.click_ref), fallback_topics and exclude_ad_ids body fields.",
  },
  {
    title: "Render the sponsored item",
    text: "On fill:true show the five ad fields (id, headline, body, cta_text, destination_url) with a clear Sponsored label, separate from the AI's own answer. Escape every text field.",
  },
  {
    title: "Send the impression",
    text: "Only after the ad was really displayed. Use the tracking.token from the match response. No API key is sent to this route.",
    route: "POST /api/v1/ads/impression",
    required: "Header Content-Type: application/json, body fields token and event (the value impression). No other field.",
  },
  {
    title: "Send the click",
    text: "Build the link from tracking.click_ref, never from destination_url. The person's browser follows it and Blisscco redirects to the verified destination. No API key is sent to this route.",
    route: "GET /api/v1/ads/click",
    required: "Query parameter ref (the click_ref value, URL-encoded), exactly once. No other parameter.",
  },
];

/** Numbered list of the integration process. Real <ol> so screen readers announce the order. */
export default function IntegrationSteps({ steps = INTEGRATION_STEPS }: { steps?: Step[] }) {
  return (
    <ol className="space-y-4">
      {steps.map((s, i) => (
        <li key={s.title} className="flex gap-3">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet/25 text-sm font-semibold text-[#B9AAFF]"
          >
            {i + 1}
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold sm:text-base">
              <span className="sr-only">Step {i + 1}: </span>
              {s.title}
            </h3>
            <p className="mt-0.5 text-sm text-mist/70">{s.text}</p>
            {s.route && (
              <p className="mt-1 text-sm text-mist/70">
                <code>{s.route}</code>
              </p>
            )}
            {s.required && (
              <p className="mt-0.5 text-xs text-mist/55">
                <span className="font-medium">Required:</span> {s.required}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
