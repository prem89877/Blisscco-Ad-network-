import type { Metadata } from "next";
import PageHeader from "@/components/dashboard/PageHeader";
import Panel from "@/components/dashboard/Panel";
import Button from "@/components/ui/Button";
import { requireAccount } from "@/lib/auth/session";
import { getMyAdvertiser, listMyCampaigns } from "@/lib/campaigns/queries";
import { loadMyPublisher } from "@/lib/publisher/queries";
import Notice from "@/components/auth/Notice";
import { listPublisherKeys } from "@/lib/publisher/keys-db";
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
    // Steps asli data se: campaign hai? review me gaya? live hai? (load fail ho toh "not done" hi dikhta hai, galat tick nahi)
    const list = adv ? await listMyCampaigns(adv.id) : null;
    const statuses = list && !list.failed ? list.campaigns.map((c) => c.status) : [];
    const hasCampaign = statuses.length > 0;
    const sentForReview = statuses.some((s) => s === "pending_review" || s === "active" || s === "paused" || s === "completed");
    const isLive = statuses.includes("active");
    return (
      <>
        <PageHeader demo={false} title="Overview" description="Your next steps to run ads on Blisscco." />
        <Panel title="Getting started">
          <Steps
            steps={[
              { text: "Save your business details", done: adv !== null },
              { text: "Wait for our team to approve your account", done: adv?.status === "active" },
              { text: "Create a campaign", done: hasCampaign },
              { text: "Add an ad and send the campaign for review", done: sentForReview },
              { text: "Our team approves it and it goes live", done: isLive },
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
    const { publisher: pub, failed: publisherFailed } = await loadMyPublisher();
    // Database dikkat par galat "Set up my platform" step nahi dikhate.
    if (publisherFailed) {
      return (
        <>
          <PageHeader demo={false} title="Overview" description="Your next steps to show ads in your chatbot." />
          <Notice tone="error">We could not load your account details. Please refresh the page.</Notice>
        </>
      );
    }
    const keys = pub && pub.status === "active" ? await listPublisherKeys(pub.id) : null;
    const hasKey = keys !== null && keys.length > 0;
    return (
      <>
        <PageHeader demo={false} title="Overview" description="Your next steps to show ads in your chatbot." />
        <Panel title="Getting started">
          <Steps
            steps={[
              { text: "Save your platform details", done: pub !== null },
              { text: "Wait for our team to approve your account", done: pub?.status === "active" },
              { text: "Create an API key (shown once)", done: hasKey },
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
  const show = (n: number | null) => (n === null ? "could not be loaded" : String(n));
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
