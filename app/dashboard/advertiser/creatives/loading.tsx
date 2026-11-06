// Ads page load hote waqt. Spinner sirf tab dikhta hai jab load sach me dheema ho (delayed).
import Spinner from "@/components/ui/Spinner";

export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="animate-pulse space-y-5">
      <div className="flex justify-center py-2">
        <Spinner size="lg" delayed />
      </div>
      <div className="h-8 w-56 rounded bg-mist/10" />
      <div className="h-4 w-full max-w-md rounded bg-mist/10" />
      <div className="space-y-3">
        <div className="h-24 rounded-xl border border-line bg-surface" />
        <div className="h-24 rounded-xl border border-line bg-surface" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
