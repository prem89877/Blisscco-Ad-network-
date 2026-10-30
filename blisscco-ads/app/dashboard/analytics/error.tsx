"use client";

import Button from "@/components/ui/Button";
import Notice from "@/components/auth/Notice";

// Analytics page par koi bhi anjaani dikkat: safe message + kaam karta "Try again".
// Error ka koi bhi hissa (text, digest, stack) kabhi render nahi hota, taaki database ya SQL detail leak na ho. `error` prop jaanbujhkar use nahi hota.
export default function AnalyticsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Analytics</h1>
      <Notice tone="error">
        Analytics could not be loaded right now. Please try again. If it keeps happening, come back in a few minutes. No figures are shown rather than made-up zeros.
      </Notice>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <Button onClick={() => reset()}>Try again</Button>
        <Button href="/dashboard" variant="secondary">
          Back to dashboard
        </Button>
      </div>
    </div>
  );
}
