"use client";

import { useActionState } from "react";
import { changeCreativeStatus } from "@/app/dashboard/advertiser/campaigns/creative-actions";
import { CREATIVE_ACTIONS, type CreativeAction } from "@/lib/campaigns/creative-validation";
import { initialRunState } from "@/lib/campaigns/types";

const btn =
  "inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60";

/** Ad ke liye ek chhota button: Send for review / Take back / Move to draft / Archive. Asli check server + database me. */
export default function CreativeActionButton({ creativeId, action }: { creativeId: string; action: CreativeAction }) {
  const [state, formAction, pending] = useActionState(changeCreativeStatus, initialRunState);
  const tone =
    action === "archive"
      ? "border-line text-mist/80 hover:text-aqua"
      : "border-aqua/60 text-aqua hover:bg-aqua/10";
  return (
    <form action={formAction}>
      <input type="hidden" name="creativeId" value={creativeId} />
      <input type="hidden" name="action" value={action} />
      <button type="submit" disabled={pending} aria-busy={pending} className={`${btn} ${tone}`}>
        {pending ? "Please wait…" : CREATIVE_ACTIONS[action].label}
      </button>
      {state.status === "error" && state.message && (
        <p role="alert" className="mt-2 max-w-xs text-sm text-red-300">
          {state.message}
        </p>
      )}
    </form>
  );
}
