import type { Metadata } from "next";
import PageHeader from "@/components/dashboard/PageHeader";
import AdvertiserWorkspace from "@/components/dashboard/AdvertiserWorkspace";
import Button from "@/components/ui/Button";
import { requireRole } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Advertiser | Blisscco Dashboard" };

export default async function AdvertiserPage() {
  const account = await requireRole(["advertiser", "admin"]);
  return (
    <>
      <PageHeader
        title="Advertiser Dashboard"
        description="Preview how an advertiser could manage campaigns. This page uses sample data and a demo form only."
      />
      {account.role === "advertiser" && (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-aqua/40 bg-aqua/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-mist/80">
            <strong className="font-medium text-mist">Real campaigns:</strong> create and manage your saved campaigns. The
            workspace below is a sample only.
          </p>
          <Button href="/dashboard/advertiser/campaigns" variant="secondary" className="shrink-0">
            Manage my campaigns
          </Button>
        </div>
      )}
      <AdvertiserWorkspace />
    </>
  );
}
