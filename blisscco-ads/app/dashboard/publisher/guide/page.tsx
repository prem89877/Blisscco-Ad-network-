import type { Metadata } from "next";
import Link from "next/link";
import PageHeader from "@/components/dashboard/PageHeader";
import Panel from "@/components/dashboard/Panel";
import IntegrationSteps from "@/components/dashboard/IntegrationSteps";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { requireAccount } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Integration Guide | Blisscco Dashboard" };

export default async function PublisherGuidePage() {
  await requireAccount();
  return (
    <>
      <p className="mb-3 text-sm">
        <Link href="/dashboard/publisher" className="text-aqua hover:underline">
          &larr; Back to publisher dashboard
        </Link>
      </p>

      <PageHeader
        title="Integration Guide"
        description="Placeholder page. The full guide will be published when the Blisscco advertising API and secure backend are ready."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Status">
          <div className="flex items-center gap-2">
            <Badge tone="neutral">Coming soon</Badge>
          </div>
          <p className="mt-3 text-sm text-mist/75">
            There is no live API, no API key issuing and no backend in this project yet. Nothing on this page
            connects to a server.
          </p>
        </Panel>

        <Panel title="Planned steps">
          <IntegrationSteps />
        </Panel>
      </div>

      <section aria-labelledby="sponsored" className="mt-6">
        <Panel title="Sponsored label (example)" note="Illustration only. This is not a real ad.">
          <div className="max-w-md rounded-lg border border-line bg-ink p-4">
            <span className="inline-block rounded bg-mist/10 px-2 py-0.5 text-xs font-medium text-mist/80">
              Sponsored
            </span>
            <p className="mt-2 text-sm font-medium">Sample Advertiser: example headline</p>
            <p className="mt-1 text-sm text-mist/65">Example ad text shown after the assistant&apos;s own answer.</p>
          </div>
        </Panel>
      </section>

      <div className="mt-6">
        <Button href="/dashboard/publisher" variant="secondary">Back to publisher dashboard</Button>
      </div>
    </>
  );
}
