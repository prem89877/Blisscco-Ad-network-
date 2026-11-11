"use client";

import Link from "next/link";
import { useEffect } from "react";
import { handleBoundaryError, isStaleDeploymentError } from "@/lib/actions/guard";

// Koi bhi anjaani dikkat: user ko saaf message + dobara koshish. Technical detail kabhi nahi dikhti.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Diagnostics: error screen aate hi Vercel logs me "[diag] event=error_boundary" (digest ke saath, jo server ke asli error log se milta hai). User ko kuch nahi dikhta.
  useEffect(() => {
    handleBoundaryError(error, "app");
  }, [error]);

  const stale = isStaleDeploymentError(error);

  return (
    <main id="main" className="mx-auto flex min-h-[60dvh] max-w-xl flex-col items-start justify-center px-6 py-16">
      <h1 className="font-display text-3xl font-semibold">Something went wrong</h1>
      <p className="mt-3 text-mist/75">
        {stale
          ? "We just updated the site, so this page is out of date. Refreshing will fix it."
          : "Please try again. If it keeps happening, come back in a few minutes."}
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => (stale ? window.location.reload() : reset())}
          className="inline-flex min-h-11 items-center rounded-lg bg-violet px-5 py-2.5 font-medium text-white hover:bg-[#6444F0]"
        >
          {stale ? "Refresh page" : "Try again"}
        </button>
        <Link href="/" className="inline-flex min-h-11 items-center rounded-lg border border-aqua/60 px-5 py-2.5 font-medium text-aqua hover:bg-aqua/10">
          Home page
        </Link>
      </div>
    </main>
  );
}
