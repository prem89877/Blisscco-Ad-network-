"use client";

import { useActionState, useState } from "react";
import { adminDecision } from "@/app/dashboard/admin/actions";
import type { AdminDecisionKind } from "@/lib/admin/decisions";
import { REJECT_REASON_MAX } from "@/lib/admin/decisions";
import { initialRunState } from "@/lib/campaigns/types";

const btn =
  "inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60";

type Props = {
  kind: AdminDecisionKind;
  id: string;
  decision: string;
  label: string;
  tone?: "good" | "bad";
  /** true => reject se pehle chhota reason maangta hai (creative reject). */
  needsReason?: boolean;
};

/** Admin ka ek button (Approve / Reject / Activate / Suspend). Server action role aur database dobara check karte hain. */
export default function AdminDecisionButton({ kind, id, decision, label, tone = "good", needsReason = false }: Props) {
  const [state, formAction, pending] = useActionState(adminDecision, initialRunState);
  const [asking, setAsking] = useState(false);
  const color = tone === "good" ? "border-aqua/60 text-aqua hover:bg-aqua/10" : "border-red-400/60 text-red-300 hover:bg-red-500/10";

  if (needsReason && !asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className={`${btn} ${color}`}>
        {label}
      </button>
    );
  }

  return (
    <form action={formAction} className="max-w-sm">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="decision" value={decision} />
      {needsReason && (
        <div className="mb-2">
          <label htmlFor={`reason-${id}`} className="mb-1 block text-xs text-mist/70">
            Reason (the advertiser will see this)
          </label>
          <textarea
            id={`reason-${id}`}
            name="reason"
            rows={2}
            maxLength={REJECT_REASON_MAX}
            required
            className="w-full rounded-lg border border-line bg-ink px-3 py-2 text-sm text-mist"
          />
        </div>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} aria-busy={pending} className={`${btn} ${color}`}>
          {pending ? "Please wait…" : label}
        </button>
        {needsReason && (
          <button type="button" disabled={pending} onClick={() => setAsking(false)} className={`${btn} border-line text-mist/80`}>
            Cancel
          </button>
        )}
      </div>
      {state.status === "error" && state.message && (
        <p role="alert" className="mt-2 text-sm text-red-300">
          {state.message}
        </p>
      )}
    </form>
  );
}
