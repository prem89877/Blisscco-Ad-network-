import type { Metadata } from "next";
import PageHeader from "@/components/dashboard/PageHeader";
import Panel from "@/components/dashboard/Panel";
import Button from "@/components/ui/Button";
import { requireAccount } from "@/lib/auth/session";
import { listMyCampaigns, loadMyAdvertiser } from "@/lib/campaigns/queries";
import { loadMyAdvertiserCountry } from "@/lib/advertiser/country-queries";
import { loadMyPublisherCountry } from "@/lib/publisher/country-queries";
import { AdvertiserSetupForm, PublisherSetupForm } from "@/components/dashboard/AccountSetupForm";
import AdvertiserCountryForm from "@/components/dashboard/AdvertiserCountryForm";
import PublisherCountryForm from "@/components/dashboard/PublisherCountryForm";
import { countryOptions } from "@/lib/regions/publisher-country";
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
    const { advertiser: adv, failed: advertiserFailed } = await loadMyAdvertiser();
    // Phase 6 Step 3 Part 2: naya advertiser login karte hi country chun sakta hai; purana (country bina) bhi yahin chun leta hai.
    // Load fail => koi form nahi (galat "setup" form na dikhe). Country load fail => null => prompt nahi.
    const advCountry = adv && adv.status !== "suspended" ? await loadMyAdvertiserCountry() : null;
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
        {!adv && !advertiserFailed && (
          <div className="mt-6">
            <Panel title="Set up your business" note="Add your business name and choose your country. It takes a minute.">
              <AdvertiserSetupForm countryOptions={countryOptions()} />
            </Panel>
          </div>
        )}
        {advCountry !== null && advCountry.countryCode === null && (
          <div className="mt-6">
            <Panel title="Choose your country" note="Your business country. It does not change your prices or billing.">
              <AdvertiserCountryForm options={countryOptions()} currentCode={null} submitLabel="Save country" />
            </Panel>
          </div>
        )}
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
    // Phase 6 Step 3 Part 2: country ka wahi Step 2 workflow (pending -> admin verified / rejected). Load fail => null => prompt nahi.
    const pubCountry = pub && pub.status !== "suspended" ? await loadMyPublisherCountry() : null;
    const needsCountry = pubCountry !== null && (pubCountry.status === null || pubCountry.status === "rejected");
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
        {!pub && (
          <div className="mt-6">
            <Panel title="Set up your platform" note="Add your platform details and choose your country. Our team verifies the country.">
              <PublisherSetupForm countryOptions={countryOptions()} />
            </Panel>
          </div>
        )}
        {needsCountry && (
          <div className="mt-6">
            <Panel
              title={pubCountry?.status === "rejected" ? "Your country was not accepted" : "Choose your country"}
              note="Our team verifies your country. Only a verified country is used for regional ads."
            >
              <PublisherCountryForm
                options={countryOptions()}
                currentCode={pubCountry?.countryCode ?? null}
                submitLabel={pubCountry?.status === "rejected" ? "Submit a different country" : "Submit country"}
              />
            </Panel>
          </div>
        )}
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
