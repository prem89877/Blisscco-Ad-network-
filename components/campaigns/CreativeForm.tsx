"use client";

import { useState } from "react";
import { useGuardedAction } from "@/lib/actions/use-guarded-action";
import { createCreative } from "@/app/dashboard/advertiser/campaigns/creative-actions";
import Notice from "@/components/auth/Notice";
import SubmitButton from "@/components/auth/SubmitButton";
import { ASSET_LIMITS, checkImageMeta, type AssetKind } from "@/lib/campaigns/creative-assets";
import {
  BODY_MAX,
  CTA_MAX,
  HEADLINE_MAX,
  initialCreativeState,
  readCreativeValues,
  type CreativeFieldName,
  type CreativeImageFieldName,
} from "@/lib/campaigns/creative-validation";

// Image upload mobile par dheema ho sakta hai: guard ki had 20s se badha kar 60s.
const UPLOAD_TIMEOUT_MS = 60_000;
const fileInput = "file:mr-3 file:rounded file:border-0 file:bg-aqua/15 file:px-3 file:py-1 file:text-aqua";

const input = "min-h-11 w-full rounded-lg border bg-ink px-3.5 py-2 text-base text-mist placeholder:text-mist/40";

function Err({ id, text }: { id: string; text?: string }) {
  return text ? (
    <p id={id} className="mt-1.5 text-sm text-red-300">
      {text}
    </p>
  ) : null;
}

/** Naya ad (creative) banane ka form (logo + ad image optional). Ad "draft" se shuru hota hai; phir "Send for review". */
export default function CreativeForm({ campaignId }: { campaignId: string }) {
  const { state, formAction, onSubmit } = useGuardedAction(createCreative, initialCreativeState, {
    timeoutMs: UPLOAD_TIMEOUT_MS,
    errorState: (prev, message, formData) => ({ ...prev, status: "error" as const, message, values: readCreativeValues(formData) }),
  });
  const v = state.values;
  const e = state.fieldErrors ?? {};
  const border = (f: CreativeFieldName | CreativeImageFieldName) => (e[f] ? "border-red-400" : "border-line");
  const [fileErrors, setFileErrors] = useState<Partial<Record<AssetKind, string>>>({});

  // Browser ki jaanch sirf jaldi feedback ke liye; asli jaanch server action me hoti hai.
  const onFile = (kind: AssetKind) => (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return setFileErrors((p) => ({ ...p, [kind]: undefined }));
    const r = checkImageMeta(kind, { name: file.name, type: file.type, size: file.size });
    setFileErrors((p) => ({ ...p, [kind]: r.ok ? undefined : r.error }));
  };
  const imageError = (k: AssetKind) => fileErrors[k] ?? e[k];

  return (
    <form action={formAction} onSubmit={onSubmit} noValidate encType="multipart/form-data" className="max-w-xl space-y-5">
      <input type="hidden" name="campaignId" value={campaignId} />
      <div>
        <label htmlFor="cr-logo" className="mb-1.5 block text-sm font-medium text-mist">
          Brand logo (optional)
        </label>
        <input
          id="cr-logo"
          name="logo"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={onFile("logo")}
          aria-invalid={imageError("logo") ? true : undefined}
          aria-describedby="cr-logo-hint"
          className={`${input} ${imageError("logo") ? "border-red-400" : "border-line"} ${fileInput}`}
        />
        <p id="cr-logo-hint" className="mt-1.5 text-xs text-mist/60">
          PNG, JPG or WebP, up to {ASSET_LIMITS.logo.maxBytes / (1024 * 1024)} MB. A square logo works best.
        </p>
        <Err id="cr-logo-err" text={imageError("logo")} />
      </div>
      <div>
        <label htmlFor="cr-banner" className="mb-1.5 block text-sm font-medium text-mist">
          Ad image / banner (optional)
        </label>
        <input
          id="cr-banner"
          name="banner"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={onFile("banner")}
          aria-invalid={imageError("banner") ? true : undefined}
          aria-describedby="cr-banner-hint"
          className={`${input} ${imageError("banner") ? "border-red-400" : "border-line"} ${fileInput}`}
        />
        <p id="cr-banner-hint" className="mt-1.5 text-xs text-mist/60">
          PNG, JPG or WebP, up to {ASSET_LIMITS.banner.maxBytes / (1024 * 1024)} MB. If the form shows an error, choose your images again.
        </p>
        <Err id="cr-banner-err" text={imageError("banner")} />
      </div>
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
      <SubmitButton pendingText="Uploading and saving…">Add ad</SubmitButton>
    </form>
  );
}
