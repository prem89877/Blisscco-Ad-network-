import type { Metadata } from "next";
import PageHeader from "@/components/dashboard/PageHeader";
import AnalyticsView from "@/components/dashboard/AnalyticsView";

export const metadata: Metadata = { title: "Analytics | Blisscco Dashboard" };

export default function AnalyticsPage() {
  return (
    <>
      <PageHeader title="Analytics" description="Demo trends for the whole network. Pick a date range to update the charts." />
      <AnalyticsView />
    </>
  );
}
