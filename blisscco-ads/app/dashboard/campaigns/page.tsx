import type { Metadata } from "next";
import PageHeader from "@/components/dashboard/PageHeader";
import CampaignsExplorer from "@/components/dashboard/CampaignsExplorer";
import CodeBlock from "@/components/ui/CodeBlock";
import { CAMPAIGNS } from "@/lib/demo-data";
import { requireAccount } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Campaigns | Blisscco Dashboard" };

export default async function CampaignsPage() {
  await requireAccount();
  const c = CAMPAIGNS[0];
  const sample = JSON.stringify({ id: c.id, name: c.name, topic: c.topic, status: c.status, budget: c.budget }, null, 2);
  return (
    <>
      <PageHeader title="Campaigns" description="Demo campaigns only. Search by name, filter by category and status, and sort by demo spend, impressions or CTR. Budget, spend and CTR are sample numbers, not real campaign results." />
      <CampaignsExplorer />
      <section aria-labelledby="sample-object" className="mt-8">
        <h2 id="sample-object" className="mb-3 font-display text-lg font-semibold">Sample campaign object</h2>
        <p className="mb-3 text-sm text-mist/65">How one campaign may look later. Demo only, no API exists yet.</p>
        <CodeBlock code={sample} label="Sample campaign object" />
      </section>
    </>
  );
}
