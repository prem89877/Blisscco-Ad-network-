"use client";

import Button from "@/components/ui/Button";
import Notice from "@/components/auth/Notice";

// Unexpected error par: raw message kabhi nahi dikhate (sirf safe reference code).
export default function CampaignsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Something went wrong</h1>
      <Notice tone="error">
        We could not show this page. Please try again. If it keeps happening, contact support
        {error.digest ? ` and mention reference ${error.digest}` : ""}.
      </Notice>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <Button onClick={() => reset()}>Try again</Button>
        <Button href="/dashboard/advertiser/campaigns" variant="secondary">
          Back to my campaigns
        </Button>
      </div>
    </div>
  );
}
