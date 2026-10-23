import type { Metadata } from "next";
import PageHeader from "@/components/dashboard/PageHeader";
import AnalyticsView from "@/components/dashboard/AnalyticsView";
import { requireAccount } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Analytics | Blisscco Dashboard" };

export default async function AnalyticsPage() {
  await requireAccount();
  return (
    <>
      <PageHeader title="Analytics" description="Demo impressions, clicks, click-through rate and spending for the whole network. Pick a date range to update the charts. These are sample numbers, not real results." />
      <AnalyticsView />
    </>
  );
}
