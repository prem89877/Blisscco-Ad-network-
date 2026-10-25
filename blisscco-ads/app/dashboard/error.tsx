"use client";

import Link from "next/link";

// Koi bhi anjaani dikkat: user ko saaf message + dobara koshish. Technical detail kabhi nahi dikhti.
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto flex min-h-[60dvh] max-w-xl flex-col items-start justify-center py-16">
      <h1 className="font-display text-3xl font-semibold">Something went wrong</h1>
      <p className="mt-3 text-mist/75">Please try again. If it keeps happening, come back in a few minutes.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex min-h-11 items-center rounded-lg bg-violet px-5 py-2.5 font-medium text-white hover:bg-[#6444F0]"
        >
          Try again
        </button>
        <Link href="/" className="inline-flex min-h-11 items-center rounded-lg border border-aqua/60 px-5 py-2.5 font-medium text-aqua hover:bg-aqua/10">
          Home page
        </Link>
      </div>
    </div>
  );
}
