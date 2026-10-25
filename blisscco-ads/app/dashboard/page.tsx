import type { Metadata } from "next";
import PageHeader from "@/components/dashboard/PageHeader";
import Panel from "@/components/dashboard/Panel";
import Button from "@/components/ui/Button";
import { requireAccount } from "@/lib/auth/session";
import { getMyAdvertiser } from "@/lib/campaigns/queries";
import { getMyPublisher } from "@/lib/publisher/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Overview | Blisscco Dashboard" };
export const dynamic = "force-dynamic";

type Step = { text: string; done: boolean };

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="space-y-2 text-sm">
      {steps.map((s, i) => (
        <li key={s.text} className="flex gap-3">
          <span
            aria-hidden="true"
            className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
              s.done ? "bg-aqua text-ink" : "border border-line text-mist/60"
            }`}
          >
            {s.done ? "✓" : i + 1}
          </span>
          <span className={s.done ? "text-mist/60" : "text-mist"}>
            {s.text}
            <span className="sr-only">{s.done ? " (done)" : " (not done yet)"}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

async function pendingCount(table: "advertisers" | "publishers" | "ad_creatives" | "campaigns", status: string): Promise<number | null> {
  try {
    const supabase = await createClient();
    const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).eq("status", status);
    return error || typeof count !== "number" ? null : count;
  } catch {
    return null;
  }
}

export default async function OverviewPage() {
  const account = await requireAccount();

  if (account.role === "advertiser") {
    const adv = await getMyAdvertiser();
    return (
      <>
        <PageHeader demo={false} title="Overview" description="Your next steps to run ads on Blisscco." />
        <Panel title="Getting started">
          <Steps
            steps={[
              { text: "Save your business details", done: adv !== null },
              { text: "Wait for our team to approve your account", done: adv?.status === "active" },
              { text: "Create a campaign", done: false },
              { text: "Add an ad and send it for review", done: false },
              { text: "Our team approves it and it goes live", done: false },
            ]}
          />
          <div className="mt-5">
            <Button href="/dashboard/advertiser/campaigns">{adv ? "Go to my campaigns" : "Set up my business"}</Button>
          </div>
        </Panel>
      </>
    );
  }

  if (account.role === "publisher") {
    const pub = await getMyPublisher();
    return (
      <>
        <PageHeader demo={false} title="Overview" description="Your next steps to show ads in your chatbot." />
        <Panel title="Getting started">
          <Steps
            steps={[
              { text: "Save your platform details", done: pub !== null },
              { text: "Wait for our team to approve your account", done: pub?.status === "active" },
              { text: "Create an API key (shown once)", done: false },
              { text: "Call the ads API from your server and show the ad with a Sponsored label", done: false },
            ]}
          />
          <div className="mt-5">
            <Button href="/dashboard/publisher">{pub ? "Go to publisher page" : "Set up my platform"}</Button>
          </div>
        </Panel>
      </>
    );
  }

  const [advs, pubs, ads, camps] = await Promise.all([
    pendingCount("advertisers", "pending"),
    pendingCount("publishers", "pending"),
    pendingCount("ad_creatives", "pending_review"),
    pendingCount("campaigns", "pending_review"),
  ]);
  const show = (n: number | null) => (n === null ? "?" : String(n));
  return (
    <>
      <PageHeader demo={false} title="Overview" description="What is waiting for your review." />
      <Panel title="Waiting for review">
        <ul className="space-y-1 text-sm text-mist/80">
          <li>Advertiser accounts: {show(advs)}</li>
          <li>Publisher accounts: {show(pubs)}</li>
          <li>Ads: {show(ads)}</li>
          <li>Campaigns: {show(camps)}</li>
        </ul>
        <div className="mt-5">
          <Button href="/dashboard/admin">Open admin review</Button>
        </div>
      </Panel>
    </>
  );
}
