// Analytics page load hote waqt dikhta hai. Layout page jaisa hi: header, 3 stat cards, note line.
// Koi number nahi dikhta (nakli zero nahi). Screen reader ko "Loading analytics" milta hai.
export default function AnalyticsLoading() {
  return (
    <div role="status" aria-busy="true" aria-live="polite" aria-label="Loading analytics" className="animate-pulse">
      <div className="mb-6">
        <div className="h-8 w-40 rounded bg-mist/10 sm:h-9" />
        <div className="mt-3 h-4 w-full max-w-xl rounded bg-mist/10" />
      </div>

      <div className="mt-6 space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="h-28 rounded-xl border border-line bg-surface" />
          <div className="h-28 rounded-xl border border-line bg-surface" />
          <div className="h-28 rounded-xl border border-line bg-surface" />
        </div>
        <div className="h-3 w-full max-w-lg rounded bg-mist/10" />
      </div>

      <span className="sr-only">Loading analytics…</span>
    </div>
  );
}
