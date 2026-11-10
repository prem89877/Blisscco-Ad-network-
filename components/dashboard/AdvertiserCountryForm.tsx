"use client";

import { useGuardedAction } from "@/lib/actions/use-guarded-action";
import SubmitButton from "@/components/auth/SubmitButton";
import Notice from "@/components/auth/Notice";
import { updateAdvertiserCountry } from "@/app/dashboard/advertiser/country-actions";
import type { CountryOption } from "@/lib/regions/publisher-country";
import { initialRunState } from "@/lib/campaigns/types";

type Props = { currentCode: string | null; submitLabel: string; /** Login ke baad wale screen par: save ke baad seedha dashboard. */ continueToDashboard?: boolean; /** Server page se aate hain (server aur browser ke Intl naam alag hon toh hydration mismatch na ho). */ options: CountryOption[] };

/** Advertiser business country form (pehli baar / badalna). Purane advertisers yahin se country jod sakte hain. */
export default function AdvertiserCountryForm({ currentCode, submitLabel, options, continueToDashboard = false }: Props) {
  const { state, formAction, onSubmit } = useGuardedAction(updateAdvertiserCountry, initialRunState);
  return (
    <form action={formAction} onSubmit={onSubmit} noValidate className="max-w-xl space-y-4">
      {continueToDashboard && <input type="hidden" name="continue" value="dashboard" />}
      <div>
        <label htmlFor="adv-country-update" className="mb-1.5 block text-sm font-medium text-mist">
          Business country
        </label>
        <select
          id="adv-country-update"
          name="country"
          defaultValue={currentCode ?? ""}
          required
          className="min-h-11 w-full rounded-lg border border-line bg-ink px-3.5 py-2 text-base text-mist"
        >
          <option value="" disabled>
            Choose your country
          </option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {state.status === "error" && state.message && <Notice tone="error">{state.message}</Notice>}
      {state.status === "success" && state.message && <Notice tone="success">{state.message}</Notice>}
      <SubmitButton pendingText="Saving…">{submitLabel}</SubmitButton>
    </form>
  );
}
