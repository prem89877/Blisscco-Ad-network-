type Step = { title: string; text: string };

export const INTEGRATION_STEPS: Step[] = [
  { title: "Register a publisher", text: "Create a publisher account and describe the AI product you want to monetise." },
  { title: "Obtain an API key", text: "Keys will be issued by a future secure backend. Nothing is generated in this demo." },
  { title: "Integrate the API", text: "Call the Blisscco advertising API from your own application, on your own server." },
  { title: "Test ad requests", text: "Send test requests and check the responses before going live." },
  { title: "Display ads with a Sponsored label", text: "Show every returned ad with a clear Sponsored label, separate from the AI's own answer." },
];

/** Numbered list of the planned integration process. Real <ol> so screen readers announce the order. */
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
