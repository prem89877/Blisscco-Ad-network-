"use client";

import { useActionState, useId, useState } from "react";
import { pauseCampaign, resumeCampaign } from "@/app/dashboard/advertiser/campaigns/actions";
import { DELIVERY_NOTE } from "@/lib/campaigns/run-state";
import { initialRunState } from "@/lib/campaigns/types";

type Props = { campaignId: string; mode: "pause" | "resume" };

const btn =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-5 py-2.5 text-base font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60";
const outline = `${btn} border border-aqua/60 text-aqua hover:bg-aqua/10`;

/**
 * Pause / Resume. Pause se pehle confirmation. Submit ke dauran buttons disabled (double submit nahi).
 * Asli check server action + database trigger me hota hai, yahan sirf UI. Success par server redirect karta hai
 * (success notice page par dikhta hai); error yahin dikhta hai.
 */
export default function RunStateButton({ campaignId, mode }: Props) {
  const [state, formAction, pending] = useActionState(mode === "pause" ? pauseCampaign : resumeCampaign, initialRunState);
  const [confirming, setConfirming] = useState(false);
  const headingId = useId();

  const error = state.status === "error" && state.message ? (
    <p role="alert" className="mt-2 text-sm text-red-300">
      {state.message}
    </p>
  ) : null;

  if (mode === "resume") {
    return (
      <form action={formAction}>
        <input type="hidden" name="campaignId" value={campaignId} />
        <button type="submit" disabled={pending} aria-busy={pending} className={outline}>
          {pending ? "Resuming…" : "Resume campaign"}
        </button>
        {error}
      </form>
    );
  }

  if (!confirming) {
    return (
      <div>
        <button type="button" onClick={() => setConfirming(true)} className={outline}>
          Pause campaign
        </button>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      role="group"
      aria-labelledby={headingId}
      className="max-w-md rounded-lg border border-amber-400/40 bg-amber-400/5 p-4"
    >
      <input type="hidden" name="campaignId" value={campaignId} />
      <p id={headingId} className="text-sm font-medium text-mist">
        Pause this campaign?
      </p>
      <p className="mt-1 text-sm text-mist/70">
        It will be marked as paused and nothing is deleted. You can resume it later. {DELIVERY_NOTE}
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className={`${btn} border border-amber-400/60 text-amber-300 hover:bg-amber-400/10`}
        >
          {pending ? "Pausing…" : "Yes, pause campaign"}
        </button>
        <button
          type="button"
          autoFocus
          disabled={pending}
          onClick={() => setConfirming(false)}
          className={`${btn} border border-line text-mist/80 hover:text-aqua`}
        >
          Cancel
        </button>
      </div>
      {error}
    </form>
  );
}
