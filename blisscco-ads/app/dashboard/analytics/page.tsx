import type { Metadata } from "next";
import PageHeader from "@/components/dashboard/PageHeader";
import Panel from "@/components/dashboard/Panel";
import { requireAccount } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Analytics | Blisscco Dashboard" };

export default async function AnalyticsPage() {
  await requireAccount();
  return (
    <>
      <PageHeader demo={false} title="Analytics" description="Charts for impressions, clicks and results are coming later." />
      <Panel title="Not available yet">
        <p className="max-w-2xl text-sm text-mist/80">
          Impressions and clicks are not tracked yet, so there is nothing real to chart. Advertisers can already see
          spend and the number of ads shown on each campaign page.
        </p>
      </Panel>
    </>
  );
}
