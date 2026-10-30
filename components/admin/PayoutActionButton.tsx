"use client";

import { useActionState, useState } from "react";
import { adminPayoutAction } from "@/app/dashboard/admin/payout-actions";
import { PAYOUT_REASON_MAX, type AdminPayoutAction } from "@/lib/payouts/rules";
import { initialRunState } from "@/lib/campaigns/types";

const btn =
  "inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60";

type Props = {
  id: string;
  action: AdminPayoutAction;
  label: string;
  tone?: "good" | "bad";
};

/**
 * Admin ka ek payout button (Approve / Reject / Mark as paid). Reject par wajah maangta hai.
 * Ye sirf suvidha hai: server action requireRole(["admin"]) karta hai aur database function dobara admin check karti hai.
 */
export default function PayoutActionButton({ id, action, label, tone = "good" }: Props) {
  const [state, formAction, pending] = useActionState(adminPayoutAction, initialRunState);
  const [asking, setAsking] = useState(false);
  const needsReason = action === "reject";
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
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value={action} />
      {needsReason && (
        <div className="mb-2">
          <label htmlFor={`payout-reason-${id}`} className="mb-1 block text-xs text-mist/70">
            Reason (the publisher will see this). Do not write bank, card or UPI details.
          </label>
          <textarea
            id={`payout-reason-${id}`}
            name="reason"
            rows={2}
            maxLength={PAYOUT_REASON_MAX}
            required
            autoFocus
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
      {state.status === "success" && state.message && (
        <p role="status" className="mt-2 text-sm text-aqua">
          {state.message}
        </p>
      )}
    </form>
  );
}
