"use client";

import { useState } from "react";
import { adminPayoutSettlementAction } from "@/app/dashboard/admin/payout-settlement-actions";
import { useGuardedAction } from "@/lib/actions/use-guarded-action";
import { PAYOUT_REASON_MAX, type SettlementAction } from "@/lib/payouts/rules";
import { initialRunState } from "@/lib/campaigns/types";
import Spinner from "@/components/ui/Spinner";

const btn =
  "inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60";

type Props = { id: string; action: SettlementAction; label: string; tone?: "good" | "bad" };

/**
 * Phase 5 Step 5: settlement ke teen buttons. complete = bahar ka payment reference maangta hai; fail / reverse = wajah.
 * Sirf suvidha: asli rok server action (admin) + database function (is_admin, payouts_enabled, unique reference).
 */
export default function PayoutSettlementButton({ id, action, label, tone = "good" }: Props) {
  const { state, formAction, pending, onSubmit } = useGuardedAction(adminPayoutSettlementAction, initialRunState);
  const [asking, setAsking] = useState(false);
  const color = tone === "good" ? "border-aqua/60 text-aqua hover:bg-aqua/10" : "border-red-400/60 text-red-300 hover:bg-red-500/10";

  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className={`${btn} ${color}`}>
        {label}
      </button>
    );
  }

  return (
    <form action={formAction} onSubmit={onSubmit} className="max-w-sm">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value={action} />
      {action === "complete" ? (
        <div className="mb-2">
          <label htmlFor={`settle-ref-${id}`} className="mb-1 block text-xs text-mist/70">
            Payment reference of the transfer you sent, for example the Payoneer payment ID (6 to 100 characters). Do not write bank, card or UPI details.
          </label>
          <input id={`settle-ref-${id}`} name="reference" type="text" required minLength={6} maxLength={100} autoComplete="off" autoFocus className="w-full rounded-lg border border-line bg-ink px-3 py-2 text-sm text-mist" />
        </div>
      ) : (
        <div className="mb-2">
          <label htmlFor={`settle-reason-${id}`} className="mb-1 block text-xs text-mist/70">
            Reason (3 to {PAYOUT_REASON_MAX} characters). Do not write bank, card or UPI details.
          </label>
          <textarea id={`settle-reason-${id}`} name="reason" rows={2} maxLength={PAYOUT_REASON_MAX} required autoFocus className="w-full rounded-lg border border-line bg-ink px-3 py-2 text-sm text-mist" />
        </div>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} aria-busy={pending} className={`${btn} ${color}`}>
          {pending ? <><Spinner size="sm" className="mr-2" />Please wait…</> : label}
        </button>
        <button type="button" disabled={pending} onClick={() => setAsking(false)} className={`${btn} border-line text-mist/80`}>
          Cancel
        </button>
      </div>
      {state.status === "error" && state.message && <p role="alert" className="mt-2 text-sm text-red-300">{state.message}</p>}
      {state.status === "success" && state.message && <p role="status" className="mt-2 text-sm text-aqua">{state.message}</p>}
    </form>
  );
}
