"use client";

import { adminReviewPublisherCountry } from "@/app/dashboard/admin/country-actions";
import { useGuardedAction } from "@/lib/actions/use-guarded-action";
import { initialRunState } from "@/lib/campaigns/types";
import Spinner from "@/components/ui/Spinner";

const btn =
  "inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60";

type Props = { publisherId: string; expectedCountry: string; decision: "approve" | "reject"; label: string; tone?: "good" | "bad" };

/** Country Approve / Reject button. expectedCountry = screen par dikhi country (badli ho toh database approve nahi karta). */
export default function PublisherCountryReviewButton({ publisherId, expectedCountry, decision, label, tone = "good" }: Props) {
  const { state, formAction, pending, onSubmit } = useGuardedAction(adminReviewPublisherCountry, initialRunState);
  const color = tone === "good" ? "border-aqua/60 text-aqua hover:bg-aqua/10" : "border-red-400/60 text-red-300 hover:bg-red-500/10";
  return (
    <form action={formAction} onSubmit={onSubmit} className="max-w-sm">
      <input type="hidden" name="id" value={publisherId} />
      <input type="hidden" name="decision" value={decision} />
      <input type="hidden" name="expectedCountry" value={expectedCountry} />
      <button type="submit" disabled={pending} aria-busy={pending} className={`${btn} ${color}`}>
        {pending ? <><Spinner size="sm" className="mr-2" />Please wait…</> : label}
      </button>
      {state.status === "error" && state.message && (
        <p role="alert" className="mt-2 text-sm text-red-300">
          {state.message}
        </p>
      )}
      {state.status === "success" && state.message && (
        <p role="status" className="mt-2 text-sm text-aqua">
          {state.message}
        </p>
      )}
    </form>
  );
}
