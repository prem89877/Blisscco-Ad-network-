// Dashboard ke kisi bhi page (overview, publisher, admin, guide...) ke load hote waqt dikhta hai.
// Campaigns ka apna loading.tsx alag hai aur wahi pehle dikhta hai.
export default function DashboardLoading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="animate-pulse space-y-5">
      <div className="h-8 w-48 rounded bg-mist/10" />
      <div className="h-4 w-full max-w-md rounded bg-mist/10" />
      <div className="space-y-3">
        <div className="h-28 rounded-xl border border-line bg-surface" />
        <div className="h-28 rounded-xl border border-line bg-surface" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
