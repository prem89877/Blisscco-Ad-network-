import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col items-start justify-center px-6 py-16">
      <p className="text-sm text-mist/60">Error 404</p>
      <h1 className="mt-2 font-display text-3xl font-semibold">This page was not found</h1>
      <p className="mt-3 text-mist/75">The link may be old or mistyped.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/" className="inline-flex min-h-11 items-center rounded-lg bg-violet px-5 py-2.5 font-medium text-white hover:bg-[#6444F0]">
          Go to home page
        </Link>
        <Link href="/dashboard" className="inline-flex min-h-11 items-center rounded-lg border border-aqua/60 px-5 py-2.5 font-medium text-aqua hover:bg-aqua/10">
          Open dashboard
        </Link>
      </div>
    </main>
  );
}
