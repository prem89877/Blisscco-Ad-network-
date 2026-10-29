"use client";

import { useActionState } from "react";
import Field from "@/components/auth/Field";
import Notice from "@/components/auth/Notice";
import SubmitButton from "@/components/auth/SubmitButton";
import { requestPayout } from "@/app/dashboard/publisher/payout-actions";
import { initialRunState } from "@/lib/campaigns/types";

type Props = {
  /** Server har page-load par naya random uuid deta hai: wahi form double-submit ho toh database nayi request nahi banata. */
  requestKey: string;
  /** Pehle se bhara amount (available balance, plain "0.0150"). Publisher badal sakta hai. */
  defaultAmount: string;
  availableLabel: string;
};

/**
 * Publisher ka payout request form. Sirf DO cheezein bhejta hai: amount aur requestKey.
 * Koi bank / card / UPI / account field nahi, aur publisher id kabhi form se nahi jaati (database login se khud nikalta hai).
 */
export default function PayoutRequestForm({ requestKey, defaultAmount, availableLabel }: Props) {
  const [state, formAction] = useActionState(requestPayout, initialRunState);

  return (
    <form action={formAction} noValidate className="max-w-sm space-y-4">
      <input type="hidden" name="requestKey" value={requestKey} />
      <Field
        id="payout-amount"
        name="amount"
        label="Amount to request (USD)"
        defaultValue={defaultAmount}
        maxLength={20}
        autoComplete="off"
        hint={`Up to 4 decimal places. Available now: ${availableLabel}.`}
      />
      <SubmitButton pendingText="Sending request…">Request payout</SubmitButton>
      {state.status === "error" && state.message && <Notice tone="error">{state.message}</Notice>}
      {state.status === "success" && state.message && <Notice tone="success">{state.message}</Notice>}
    </form>
  );
}
