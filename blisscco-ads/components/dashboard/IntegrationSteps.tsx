type Step = { title: string; text: string };

export const INTEGRATION_STEPS: Step[] = [
  { title: "Register a publisher", text: "Create a publisher account and ask Blisscco for access. Access is by manual authorization." },
  { title: "Obtain an API key", text: "Keys are not self-service. Blisscco creates them by hand for authorized publishers; nothing is generated in this dashboard." },
  { title: "Integrate on your server", text: "Call POST /api/v1/ads/match from your own backend with the key in a server environment variable. Never in browser code." },
  { title: "Test with a test publisher", text: "Use a test key first and check an ad, a no-fill, 401, 429 and 503 handling before any real users see ads." },
  { title: "Display ads with a Sponsored label", text: "Show every returned ad with a clear Sponsored label, separate from the AI's own answer." },
  { title: "Carry on without an ad", text: "On no-fill, a timeout or any error, show nothing and let the chatbot answer as normal." },
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
          </div>
        </li>
      ))}
    </ol>
  );
}
