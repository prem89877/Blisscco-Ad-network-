import type { Metadata } from "next";
import PageHeader from "@/components/dashboard/PageHeader";
import AdvertiserWorkspace from "@/components/dashboard/AdvertiserWorkspace";

export const metadata: Metadata = { title: "Advertiser | Blisscco Dashboard" };

export default function AdvertiserPage() {
  return (
    <>
      <PageHeader
        title="Advertiser Dashboard"
        description="Preview how an advertiser could manage campaigns. This page uses sample data and a demo form only."
      />
      <AdvertiserWorkspace />
    </>
  );
}
