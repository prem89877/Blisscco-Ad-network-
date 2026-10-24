import type { Metadata } from "next";
import PageHeader from "@/components/dashboard/PageHeader";
import StatCard from "@/components/dashboard/StatCard";
import Panel from "@/components/dashboard/Panel";
import PropertyCard from "@/components/dashboard/PropertyCard";
import IntegrationSteps from "@/components/dashboard/IntegrationSteps";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { PUBLISHER_PROPERTIES } from "@/lib/demo-data";
import { formatNumber, formatPercent } from "@/lib/format";
import { requireRole } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Publisher | Blisscco Dashboard" };

const PRIVACY_POINTS: string[] = [
  "Every ad is shown with a clear Sponsored label.",
  "Ads are matched to a topic category chosen by the publisher's server, not to a personal profile. Conversation text is not sent to Blisscco.",
  "Publishers choose to integrate the API into their own products. Nothing is added without them.",
  "Sensitive topics such as health, religion and politics never return an ad, and publishers can skip the request entirely.",
  "The figures on this page are demo data. No API keys are created, shown or stored in this dashboard.",
];

export default async function PublisherPage() {
  await requireRole(["publisher", "admin"]);
  const properties = PUBLISHER_PROPERTIES;
  const requests = properties.reduce((a, p) => a + p.adRequests, 0);
  const impressions = properties.reduce((a, p) => a + p.impressions, 0);
  const fillRate = requests > 0 ? (impressions / requests) * 100 : 0;

  return (
    <>
      <PageHeader
        title="AI Publisher Dashboard"
        description="Blisscco is a contextual advertising network for AI chatbot developers who choose to integrate its advertising API into their own products. This page previews how a publisher could track their properties. Everything shown is demo data."
      />

      <section aria-labelledby="summary">
        <h2 id="summary" className="sr-only">Summary (demo data)</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Publisher properties" value={formatNumber(properties.length)} hint="Demo data" />
          <StatCard label="Ad requests" value={formatNumber(requests)} hint="Demo data" />
          <StatCard label="Impressions" value={formatNumber(impressions)} hint="Demo data" />
          <StatCard label="Fill rate" value={formatPercent(fillRate, 1)} hint="Demo data" />
        </div>
      </section>

      <section aria-labelledby="properties" className="mt-8">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 id="properties" className="font-display text-lg font-semibold">Example properties</h2>
          <Badge tone="violet">Demo data</Badge>
        </div>
        <p className="mb-4 max-w-2xl text-sm text-mist/65">
          These are fictional examples. No publisher is actually integrated with Blisscco.
        </p>
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {properties.map((p) => (
            <PropertyCard key={p.id} property={p} />
          ))}
        </ul>
      </section>

      <div className="mt-8">
        <Panel
          title="Integration Guide"
          note="Access to the API is limited and manual, and it is not ready for production use."
        >
          <IntegrationSteps />
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button href="/dashboard/publisher/guide" variant="secondary">
              Open the integration guide
            </Button>
            <span className="text-xs text-mist/55">Covers requests, errors, the Sponsored label and known limitations.</span>
          </div>
        </Panel>
      </div>

      <div className="mt-8">
        <Panel title="Privacy and transparency" note="How Blisscco is designed to treat users and publishers.">
          <ul className="space-y-2 text-sm text-mist/80">
            {PRIVACY_POINTS.map((t) => (
              <li key={t} className="flex gap-2">
                <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-aqua" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
