"use client";

import { useActionState } from "react";
import { pauseCampaign, resumeCampaign } from "@/app/dashboard/advertiser/campaigns/actions";
import { initialRunState } from "@/lib/campaigns/types";

type Props = { campaignId: string; mode: "pause" | "resume" };

/** Pause / Resume button. Asli check server action + database trigger me hota hai, yahan sirf UI. */
export default function RunStateButton({ campaignId, mode }: Props) {
  const [state, formAction, pending] = useActionState(mode === "pause" ? pauseCampaign : resumeCampaign, initialRunState);
  const label = mode === "pause" ? "Pause campaign" : "Resume campaign";

  return (
    <form action={formAction}>
      <input type="hidden" name="campaignId" value={campaignId} />
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="inline-flex min-h-11 items-center justify-center rounded-lg border border-aqua/60 px-5 py-2.5 text-base font-medium text-aqua transition-colors hover:bg-aqua/10 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? (mode === "pause" ? "Pausing…" : "Resuming…") : label}
      </button>
      {state.status !== "idle" && state.message && (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={`mt-2 text-sm ${state.status === "error" ? "text-red-300" : "text-aqua"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
