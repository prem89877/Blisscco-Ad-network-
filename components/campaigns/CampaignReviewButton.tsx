"use client";

import { useActionState } from "react";
import { changeCampaignReviewState } from "@/app/dashboard/advertiser/campaigns/creative-actions";
import { REVIEW_ACTIONS, type ReviewAction } from "@/lib/campaigns/review";
import { initialRunState } from "@/lib/campaigns/types";

const btn =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-aqua/60 px-5 py-2.5 text-base font-medium text-aqua transition-colors hover:bg-aqua/10 disabled:cursor-not-allowed disabled:opacity-60";

/** Campaign ko review ke liye bhejna / wapas lena / draft me lana. */
export default function CampaignReviewButton({ campaignId, action }: { campaignId: string; action: ReviewAction }) {
  const [state, formAction, pending] = useActionState(changeCampaignReviewState, initialRunState);
  return (
    <form action={formAction}>
      <input type="hidden" name="campaignId" value={campaignId} />
      <input type="hidden" name="action" value={action} />
      <button type="submit" disabled={pending} aria-busy={pending} className={btn}>
        {pending ? "Please wait…" : REVIEW_ACTIONS[action].label}
      </button>
      {state.status === "error" && state.message && (
        <p role="alert" className="mt-2 max-w-md text-sm text-red-300">
          {state.message}
        </p>
      )}
    </form>
  );
}
