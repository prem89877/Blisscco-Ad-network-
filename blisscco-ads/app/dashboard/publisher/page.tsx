import type { Metadata } from "next";
import PageHeader from "@/components/dashboard/PageHeader";
import Panel from "@/components/dashboard/Panel";
import IntegrationSteps from "@/components/dashboard/IntegrationSteps";
import PublisherKeyManager from "@/components/dashboard/PublisherKeyManager";
import { PublisherSetupForm } from "@/components/dashboard/AccountSetupForm";
import Notice from "@/components/auth/Notice";
import Button from "@/components/ui/Button";
import { requireRole } from "@/lib/auth/session";
import { loadMyPublisher } from "@/lib/publisher/queries";
import { categoryLabel } from "@/lib/campaigns/constants";
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
  // Role check aur publisher ki query SAATH me (role galat ho toh redirect pehle hi ho jata hai).
  const [, { publisher: pub, failed }] = await Promise.all([requireRole(["publisher"]), loadMyPublisher()]);
  const sp = await searchParams;
  // Database dikkat ko "publisher nahi hai" (Set up your platform form) na samjho: error boundary (Try again).
  if (failed) throw new Error("Publisher could not be loaded");
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

        {pub && (
          <Panel title="Your platform" note="The details you saved when you joined.">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-mist/55">Name</dt>
                <dd className="mt-0.5 break-words text-mist">{pub.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-mist/55">Account status</dt>
                <dd className="mt-0.5">
                  <span
                    className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                      pub.status === "active"
                        ? "bg-aqua/15 text-aqua"
                        : pub.status === "pending"
                          ? "bg-amber-400/15 text-amber-300"
                          : "bg-red-500/15 text-red-300"
                    }`}
                  >
                    {pub.status === "active" ? "Approved" : pub.status === "pending" ? "Waiting for approval" : "Suspended"}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-mist/55">Website</dt>
                <dd className="mt-0.5 break-all text-mist">{pub.websiteUrl ?? "Not added"}</dd>
              </div>
              <div>
                <dt className="text-xs text-mist/55">Main topic</dt>
                <dd className="mt-0.5 text-mist">{pub.category ? categoryLabel(pub.category) : "Not sure / mixed"}</dd>
              </div>
            </dl>
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
