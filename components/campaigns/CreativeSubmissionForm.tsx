"use client";

import { useState } from "react";
import { useGuardedAction } from "@/lib/actions/use-guarded-action";
import { submitCreative } from "@/app/dashboard/advertiser/creatives/actions";
import Notice from "@/components/auth/Notice";
import SubmitButton from "@/components/auth/SubmitButton";
import { ASSET_LIMITS, checkImageMeta, type AssetKind } from "@/lib/campaigns/creative-assets";
import {
  BRAND_MAX,
  CTA_OPTIONS,
  initialSubmissionState,
  readSubmissionValues,
  type SubmissionField,
  type SubmissionValues,
} from "@/lib/campaigns/creative-submission";
import { BODY_MAX, HEADLINE_MAX } from "@/lib/campaigns/creative-validation";

const input = "min-h-11 w-full rounded-lg border bg-ink px-3.5 py-2 text-base text-mist placeholder:text-mist/40";
// Image upload mobile par dheema ho sakta hai: guard ki had 20s se badha kar 60s.
const UPLOAD_TIMEOUT_MS = 60_000;

export type CampaignOption = { id: string; name: string; categoryLabel: string };

type Props = {
  campaigns: CampaignOption[];
  /** Edit / resubmit mode: ad ki id aur bhari hui values. Campaign badla nahi ja sakta. */
  editing?: { creativeId: string; values: SubmissionValues; hasLogo: boolean; hasBanner: boolean } | null;
};

function Err({ id, text }: { id: string; text?: string }) {
  return text ? (
    <p id={id} className="mt-1.5 text-sm text-red-300">
      {text}
    </p>
  ) : null;
}

/** Advertiser ka "Submit an ad" form. Server hi asli jaanch karta hai; yahan ki jaanch sirf jaldi feedback ke liye. */
export default function CreativeSubmissionForm({ campaigns, editing = null }: Props) {
  const { state, formAction, onSubmit } = useGuardedAction(submitCreative, initialSubmissionState, {
    timeoutMs: UPLOAD_TIMEOUT_MS,
    errorState: (prev, message, formData) => ({ ...prev, status: "error" as const, message, values: readSubmissionValues(formData) }),
  });
  const v = state.values ?? editing?.values;
  const e = state.fieldErrors ?? {};
  const border = (f: SubmissionField) => (e[f] ? "border-red-400" : "border-line");
  const [campaignId, setCampaignId] = useState<string>(v?.campaignId ?? "");
  const [fileErrors, setFileErrors] = useState<Partial<Record<AssetKind, string>>>({});
  const selected = campaigns.find((c) => c.id === campaignId) ?? null;

  const onFile = (kind: AssetKind) => (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return setFileErrors((p) => ({ ...p, [kind]: undefined }));
    const r = checkImageMeta(kind, { name: file.name, type: file.type, size: file.size });
    setFileErrors((p) => ({ ...p, [kind]: r.ok ? undefined : r.error }));
  };
  const imageError = (k: AssetKind) => fileErrors[k] ?? e[k];

  return (
    <form action={formAction} onSubmit={onSubmit} noValidate encType="multipart/form-data" className="max-w-xl space-y-5">
      {editing && <input type="hidden" name="creativeId" value={editing.creativeId} />}

      <div>
        <label htmlFor="sc-campaign" className="mb-1.5 block text-sm font-medium text-mist">
          Campaign
        </label>
        {editing ? (
          <>
            <input type="hidden" name="campaignId" value={v?.campaignId ?? ""} />
            <p className="text-sm text-mist/80">{campaigns.find((c) => c.id === v?.campaignId)?.name ?? "This ad's campaign"}</p>
          </>
        ) : (
          <select
            id="sc-campaign"
            name="campaignId"
            value={campaignId}
            onChange={(ev) => setCampaignId(ev.target.value)}
            aria-invalid={e.campaignId ? true : undefined}
            aria-describedby={e.campaignId ? "sc-campaign-err" : undefined}
            className={`${input} ${border("campaignId")}`}
          >
            <option value="">Choose a campaign</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <Err id="sc-campaign-err" text={e.campaignId} />
        <p className="mt-1.5 text-xs text-mist/60">
          Category: {(editing ? campaigns.find((c) => c.id === v?.campaignId) : selected)?.categoryLabel ?? "shown after you choose a campaign"}. It comes
          from the campaign and cannot be changed here.
        </p>
      </div>

      <div>
        <label htmlFor="sc-brand" className="mb-1.5 block text-sm font-medium text-mist">
          Brand / business name
        </label>
        <input
          id="sc-brand"
          name="brandName"
          maxLength={BRAND_MAX}
          defaultValue={v?.brandName}
          aria-invalid={e.brandName ? true : undefined}
          aria-describedby={e.brandName ? "sc-brand-err" : undefined}
          className={`${input} ${border("brandName")}`}
        />
        <Err id="sc-brand-err" text={e.brandName} />
      </div>

      <div>
        <label htmlFor="sc-logo" className="mb-1.5 block text-sm font-medium text-mist">
          Brand logo{editing?.hasLogo ? " (leave empty to keep the current one)" : ""}
        </label>
        <input
          id="sc-logo"
          name="logo"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={onFile("logo")}
          aria-invalid={imageError("logo") ? true : undefined}
          aria-describedby="sc-logo-hint"
          className={`${input} ${imageError("logo") ? "border-red-400" : "border-line"} file:mr-3 file:rounded file:border-0 file:bg-aqua/15 file:px-3 file:py-1 file:text-aqua`}
        />
        <p id="sc-logo-hint" className="mt-1.5 text-xs text-mist/60">
          PNG, JPG or WebP, up to {ASSET_LIMITS.logo.maxBytes / (1024 * 1024)} MB. A square logo works best.
        </p>
        <Err id="sc-logo-err" text={imageError("logo")} />
      </div>

      <div>
        <label htmlFor="sc-banner" className="mb-1.5 block text-sm font-medium text-mist">
          Ad image / banner{editing?.hasBanner ? " (leave empty to keep the current one)" : ""}
        </label>
        <input
          id="sc-banner"
          name="banner"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={onFile("banner")}
          aria-invalid={imageError("banner") ? true : undefined}
          aria-describedby="sc-banner-hint"
          className={`${input} ${imageError("banner") ? "border-red-400" : "border-line"} file:mr-3 file:rounded file:border-0 file:bg-aqua/15 file:px-3 file:py-1 file:text-aqua`}
        />
        <p id="sc-banner-hint" className="mt-1.5 text-xs text-mist/60">
          PNG, JPG or WebP, up to {ASSET_LIMITS.banner.maxBytes / (1024 * 1024)} MB. If the form shows an error, choose your images again.
        </p>
        <Err id="sc-banner-err" text={imageError("banner")} />
      </div>

      <div>
        <label htmlFor="sc-headline" className="mb-1.5 block text-sm font-medium text-mist">
          Ad headline
        </label>
        <input
          id="sc-headline"
          name="headline"
          maxLength={HEADLINE_MAX}
          defaultValue={v?.headline}
          aria-invalid={e.headline ? true : undefined}
          aria-describedby={e.headline ? "sc-headline-err" : undefined}
          className={`${input} ${border("headline")}`}
        />
        <Err id="sc-headline-err" text={e.headline} />
      </div>

      <div>
        <label htmlFor="sc-body" className="mb-1.5 block text-sm font-medium text-mist">
          Ad description
        </label>
        <textarea
          id="sc-body"
          name="body"
          rows={4}
          maxLength={BODY_MAX}
          defaultValue={v?.body}
          aria-invalid={e.body ? true : undefined}
          aria-describedby={e.body ? "sc-body-err" : undefined}
          className={`${input} ${border("body")}`}
        />
        <p className="mt-1.5 text-xs text-mist/60">Up to {BODY_MAX} characters. Be clear and honest. Ads are shown with a Sponsored label.</p>
        <Err id="sc-body-err" text={e.body} />
      </div>

      <div>
        <label htmlFor="sc-cta" className="mb-1.5 block text-sm font-medium text-mist">
          Call-to-action button
        </label>
        <select
          id="sc-cta"
          name="ctaText"
          defaultValue={v?.ctaText ?? ""}
          aria-invalid={e.ctaText ? true : undefined}
          aria-describedby={e.ctaText ? "sc-cta-err" : undefined}
          className={`${input} ${border("ctaText")}`}
        >
          <option value="">Choose a button text</option>
          {CTA_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <Err id="sc-cta-err" text={e.ctaText} />
      </div>

      <div>
        <label htmlFor="sc-url" className="mb-1.5 block text-sm font-medium text-mist">
          Destination URL
        </label>
        <input
          id="sc-url"
          name="destinationUrl"
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={2048}
          defaultValue={v?.destinationUrl}
          placeholder="https://"
          aria-invalid={e.destinationUrl ? true : undefined}
          aria-describedby={e.destinationUrl ? "sc-url-err" : undefined}
          className={`${input} ${border("destinationUrl")}`}
        />
        <Err id="sc-url-err" text={e.destinationUrl} />
      </div>

      <div>
        <label htmlFor="sc-keywords" className="mb-1.5 block text-sm font-medium text-mist">
          Relevant keywords (optional)
        </label>
        <input
          id="sc-keywords"
          name="keywords"
          defaultValue={v?.keywords}
          placeholder="guitar lessons, music, beginners"
          aria-invalid={e.keywords ? true : undefined}
          aria-describedby={e.keywords ? "sc-keywords-err" : "sc-keywords-hint"}
          className={`${input} ${border("keywords")}`}
        />
        <p id="sc-keywords-hint" className="mt-1.5 text-xs text-mist/60">
          Up to 10, separated by commas. Our team reads them during review. They do not change where your ad is shown.
        </p>
        <Err id="sc-keywords-err" text={e.keywords} />
      </div>

      {state.status === "error" && state.message && <Notice tone="error">{state.message}</Notice>}
      <SubmitButton pendingText="Uploading and submitting…">{editing ? "Save and resubmit for review" : "Submit for review"}</SubmitButton>
      <p className="text-xs text-mist/55">Your ad goes to our team for review first. It is never shown until it is approved.</p>
    </form>
  );
}
