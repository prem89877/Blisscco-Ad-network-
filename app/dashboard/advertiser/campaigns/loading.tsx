// Campaigns ke kisi bhi page (list, details, new, edit) ke load hote waqt dikhta hai.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="animate-pulse space-y-5">
      <div className="h-8 w-56 rounded bg-mist/10" />
      <div className="h-4 w-full max-w-md rounded bg-mist/10" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr]">
        <div className="h-11 rounded-lg bg-mist/10 sm:col-span-2 lg:col-span-1" />
        <div className="h-11 rounded-lg bg-mist/10" />
        <div className="h-11 rounded-lg bg-mist/10" />
      </div>
      <div className="space-y-3">
        <div className="h-24 rounded-xl border border-line bg-surface" />
        <div className="h-24 rounded-xl border border-line bg-surface" />
        <div className="h-24 rounded-xl border border-line bg-surface" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
