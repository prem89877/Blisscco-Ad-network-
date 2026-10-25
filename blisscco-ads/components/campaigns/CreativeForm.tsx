"use client";

import { useActionState } from "react";
import { createCreative } from "@/app/dashboard/advertiser/campaigns/creative-actions";
import Notice from "@/components/auth/Notice";
import SubmitButton from "@/components/auth/SubmitButton";
import {
  BODY_MAX,
  CTA_MAX,
  HEADLINE_MAX,
  initialCreativeState,
  type CreativeFieldName,
} from "@/lib/campaigns/creative-validation";

const input = "min-h-11 w-full rounded-lg border bg-ink px-3.5 py-2 text-base text-mist placeholder:text-mist/40";

function Err({ id, text }: { id: string; text?: string }) {
  return text ? (
    <p id={id} className="mt-1.5 text-sm text-red-300">
      {text}
    </p>
  ) : null;
}

/** Naya ad (creative) banane ka form. Ad "draft" se shuru hota hai; phir "Send for review". */
export default function CreativeForm({ campaignId }: { campaignId: string }) {
  const [state, formAction] = useActionState(createCreative, initialCreativeState);
  const v = state.values;
  const e = state.fieldErrors ?? {};
  const border = (f: CreativeFieldName) => (e[f] ? "border-red-400" : "border-line");

  return (
    <form action={formAction} noValidate className="max-w-xl space-y-5">
      <input type="hidden" name="campaignId" value={campaignId} />
      <div>
        <label htmlFor="cr-headline" className="mb-1.5 block text-sm font-medium text-mist">
          Headline
        </label>
        <input
          id="cr-headline"
          name="headline"
          maxLength={HEADLINE_MAX}
          defaultValue={v?.headline}
          aria-invalid={e.headline ? true : undefined}
          aria-describedby={e.headline ? "cr-headline-err" : undefined}
          className={`${input} ${border("headline")}`}
        />
        <Err id="cr-headline-err" text={e.headline} />
      </div>
      <div>
        <label htmlFor="cr-body" className="mb-1.5 block text-sm font-medium text-mist">
          Ad text
        </label>
        <textarea
          id="cr-body"
          name="body"
          rows={4}
          maxLength={BODY_MAX}
          defaultValue={v?.body}
          aria-invalid={e.body ? true : undefined}
          aria-describedby={e.body ? "cr-body-err" : undefined}
          className={`${input} ${border("body")}`}
        />
        <p className="mt-1.5 text-xs text-mist/60">Up to {BODY_MAX} characters. Be clear and honest. Ads are shown with a Sponsored label.</p>
        <Err id="cr-body-err" text={e.body} />
      </div>
      <div>
        <label htmlFor="cr-cta" className="mb-1.5 block text-sm font-medium text-mist">
          Button text (optional)
        </label>
        <input
          id="cr-cta"
          name="ctaText"
          maxLength={CTA_MAX}
          defaultValue={v?.ctaText}
          aria-invalid={e.ctaText ? true : undefined}
          aria-describedby={e.ctaText ? "cr-cta-err" : undefined}
          className={`${input} ${border("ctaText")}`}
        />
        <Err id="cr-cta-err" text={e.ctaText} />
      </div>
      <div>
        <label htmlFor="cr-url" className="mb-1.5 block text-sm font-medium text-mist">
          Where the ad goes (web address)
        </label>
        <input
          id="cr-url"
          name="destinationUrl"
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={2048}
          defaultValue={v?.destinationUrl}
          placeholder="https://"
          aria-invalid={e.destinationUrl ? true : undefined}
          aria-describedby={e.destinationUrl ? "cr-url-err" : undefined}
          className={`${input} ${border("destinationUrl")}`}
        />
        <Err id="cr-url-err" text={e.destinationUrl} />
      </div>
      {state.status === "error" && state.message && <Notice tone="error">{state.message}</Notice>}
      <SubmitButton pendingText="Saving…">Add ad</SubmitButton>
    </form>
  );
}
