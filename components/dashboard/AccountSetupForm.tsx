"use client";

import { useActionState } from "react";
import Field from "@/components/auth/Field";
import SubmitButton from "@/components/auth/SubmitButton";
import Notice from "@/components/auth/Notice";
import { setupAdvertiser, setupPublisher } from "@/app/dashboard/account/actions";
import { CATEGORY_OPTIONS } from "@/lib/campaigns/constants";
import { COMPANY_MAX, NAME_MAX, URL_MAX, type AdvertiserFields, type PublisherFields, type SetupState } from "@/lib/accounts/validation";

const idleAdvertiser: SetupState<AdvertiserFields> = { status: "idle" };
const idlePublisher: SetupState<PublisherFields> = { status: "idle" };

/** Advertiser ka pehla step: business ka naam (+ website). Save hone par admin ke approval ka intezaar. */
export function AdvertiserSetupForm() {
  const [state, formAction] = useActionState(setupAdvertiser, idleAdvertiser);
  return (
    <form action={formAction} noValidate className="max-w-xl space-y-5">
      <Field
        id="adv-company"
        name="companyName"
        label="Business name"
        autoComplete="organization"
        maxLength={COMPANY_MAX}
        defaultValue={state.values?.companyName}
        error={state.fieldErrors?.companyName}
      />
      <Field
        id="adv-website"
        name="websiteUrl"
        label="Website (optional)"
        autoComplete="url"
        required={false}
        maxLength={URL_MAX}
        defaultValue={state.values?.websiteUrl}
        hint="Start with https://"
        error={state.fieldErrors?.websiteUrl}
      />
      {state.status === "error" && state.message && <Notice tone="error">{state.message}</Notice>}
      <SubmitButton pendingText="Saving…">Save and continue</SubmitButton>
    </form>
  );
}

/** Publisher ka pehla step: chatbot / platform ka naam, website, category. */
export function PublisherSetupForm() {
  const [state, formAction] = useActionState(setupPublisher, idlePublisher);
  const categoryError = state.fieldErrors?.category;
  return (
    <form action={formAction} noValidate className="max-w-xl space-y-5">
      <Field
        id="pub-name"
        name="name"
        label="Chatbot or platform name"
        maxLength={NAME_MAX}
        defaultValue={state.values?.name}
        error={state.fieldErrors?.name}
      />
      <Field
        id="pub-website"
        name="websiteUrl"
        label="Website (optional)"
        autoComplete="url"
        required={false}
        maxLength={URL_MAX}
        defaultValue={state.values?.websiteUrl}
        hint="Start with https://"
        error={state.fieldErrors?.websiteUrl}
      />
      <div>
        <label htmlFor="pub-category" className="mb-1.5 block text-sm font-medium text-mist">
          Main topic (optional)
        </label>
        <select
          id="pub-category"
          name="category"
          defaultValue={state.values?.category ?? ""}
          aria-invalid={categoryError ? true : undefined}
          aria-describedby={categoryError ? "pub-category-error" : undefined}
          className="min-h-11 w-full rounded-lg border border-line bg-ink px-3.5 py-2 text-base text-mist"
        >
          <option value="">Not sure / mixed</option>
          {CATEGORY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {categoryError && (
          <p id="pub-category-error" className="mt-1.5 text-sm text-red-300">
            {categoryError}
          </p>
        )}
      </div>
      {state.status === "error" && state.message && <Notice tone="error">{state.message}</Notice>}
      <SubmitButton pendingText="Saving…">Save and continue</SubmitButton>
    </form>
  );
}
