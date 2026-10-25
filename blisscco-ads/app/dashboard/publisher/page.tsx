import type { Metadata } from "next";
import PageHeader from "@/components/dashboard/PageHeader";
import Panel from "@/components/dashboard/Panel";
import IntegrationSteps from "@/components/dashboard/IntegrationSteps";
import PublisherKeyManager from "@/components/dashboard/PublisherKeyManager";
import { PublisherSetupForm } from "@/components/dashboard/AccountSetupForm";
import Notice from "@/components/auth/Notice";
import Button from "@/components/ui/Button";
import { requireRole } from "@/lib/auth/session";
import { getMyPublisher } from "@/lib/publisher/queries";
import { listPublisherKeys } from "@/lib/publisher/keys-db";

export const metadata: Metadata = { title: "Publisher | Blisscco Dashboard" };
export const dynamic = "force-dynamic";

const PRIVACY_POINTS: string[] = [
  "Every ad is shown with a clear Sponsored label.",
  "Ads are matched to a topic category chosen by the publisher's server, not to a personal profile. Conversation text is not sent to Blisscco.",
  "Publishers choose to integrate the API into their own products. Nothing is added without them.",
  "Sensitive topics such as health, religion and politics never return an ad, and publishers can skip the request entirely.",
  "API keys are shown once when created. Only a scrambled (hashed) copy is stored, so we can never show a key again.",
];

type Props = { searchParams: Promise<{ setup?: string }> };

export default async function PublisherPage({ searchParams }: Props) {
  await requireRole(["publisher"]);
  const sp = await searchParams;
  const pub = await getMyPublisher();
  const keys = pub && pub.status === "active" ? await listPublisherKeys(pub.id) : null;

  return (
    <>
      <PageHeader
        demo={false}
        title="Publisher"
        description="Blisscco is a contextual advertising network for AI chatbot developers who choose to integrate its advertising API into their own products."
      />

      {sp.setup === "1" && pub && <Notice tone="success">Your details are saved.</Notice>}

      <div className="mt-6 space-y-6">
        {!pub && (
          <Panel title="Set up your platform" note="One quick step before you can get an API key.">
            <PublisherSetupForm />
          </Panel>
        )}

        {pub && pub.status === "pending" && (
          <Notice tone="info">
            Thanks! &quot;{pub.name}&quot; is saved. Our team will approve your account soon. After that you can create API keys here.
          </Notice>
        )}
        {pub && pub.status === "suspended" && (
          <Notice tone="error">Your publisher account is suspended, so keys do not work. Please contact support.</Notice>
        )}

        {pub && pub.status === "active" && (
          <Panel title="API keys" note="Use a key on your server to ask for ads. You can have up to 5 active keys.">
            {keys === null ? (
              <p className="text-sm text-red-300">Keys could not be loaded. Please refresh the page.</p>
            ) : (
              <PublisherKeyManager keys={keys} nowIso={new Date().toISOString()} />
            )}
          </Panel>
        )}

        <Panel title="Integration Guide" note="Covers requests, errors, the Sponsored label and known limitations.">
          <IntegrationSteps />
          <div className="mt-6">
            <Button href="/dashboard/publisher/guide" variant="secondary">
              Open the integration guide
            </Button>
          </div>
        </Panel>

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
