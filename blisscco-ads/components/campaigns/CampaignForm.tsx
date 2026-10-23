"use client";

import { useActionState } from "react";
import Link from "next/link";
import Notice from "@/components/auth/Notice";
import SubmitButton from "@/components/auth/SubmitButton";
import { CATEGORY_OPTIONS, NAME_MAX, categoryLabel } from "@/lib/campaigns/constants";
import { initialFormState, type Campaign, type CampaignFieldName, type CampaignFormState, type FormValues } from "@/lib/campaigns/types";

type Props = {
  mode: "create" | "edit";
  action: (prev: CampaignFormState, formData: FormData) => Promise<CampaignFormState>;
  campaign?: Campaign;
  categoryLocked?: boolean;
  /** Sirf naye campaign me: browser ke date picker ki min date (asli check server karta hai). */
  minStartDate?: string;
  cancelHref: string;
};

const inputBase =
  "min-h-11 w-full rounded-lg border bg-ink px-3.5 py-2 text-base text-mist placeholder:text-mist/40 disabled:cursor-not-allowed disabled:opacity-60";

function defaultsFrom(campaign?: Campaign): FormValues {
  return {
    name: campaign?.name ?? "",
    category: campaign?.category ?? "",
    totalBudget: campaign ? campaign.totalBudget.toFixed(2) : "",
    dailyBudget: campaign?.dailyBudget != null ? campaign.dailyBudget.toFixed(2) : "",
    startDate: campaign?.startDate ?? "",
    endDate: campaign?.endDate ?? "",
  };
}

type FieldShellProps = {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: (describedBy: string | undefined, invalid: boolean) => React.ReactNode;
};

function FieldShell({ id, label, hint, error, children }: FieldShellProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : "", error ? errorId : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-mist">
        {label}
      </label>
      {children(describedBy, Boolean(error))}
      {hint && (
        <p id={hintId} className="mt-1.5 text-xs text-mist/60">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1.5 text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

export default function CampaignForm({ mode, action, campaign, categoryLocked = false, minStartDate, cancelHref }: Props) {
  const [state, formAction] = useActionState(action, initialFormState);
  const v = state.values ?? defaultsFrom(campaign);
  const err = (f: CampaignFieldName) => state.fieldErrors?.[f];
  const border = (f: CampaignFieldName) => (err(f) ? "border-red-400" : "border-line");

  // Purane data ki category list me na ho toh bhi select me dikhe (badalna zaroori nahi).
  const extraCategory =
    v.category !== "" && !CATEGORY_OPTIONS.some((o) => o.value === v.category) ? v.category : null;

  return (
    <form action={formAction} className="max-w-xl space-y-5" noValidate>
      {campaign && <input type="hidden" name="campaignId" value={campaign.id} />}
      {state.status === "error" && state.message && <Notice tone="error">{state.message}</Notice>}

      <FieldShell id="name" label="Campaign name" error={err("name")} hint={`Up to ${NAME_MAX} characters.`}>
        {(d, invalid) => (
          <input
            id="name"
            name="name"
            type="text"
            required
            maxLength={NAME_MAX}
            defaultValue={v.name}
            aria-invalid={invalid || undefined}
            aria-describedby={d}
            className={`${inputBase} ${border("name")}`}
          />
        )}
      </FieldShell>

      <FieldShell
        id="category"
        label="Category"
        error={err("category")}
        hint={categoryLocked ? "Category can only be changed while the campaign is a draft or rejected." : undefined}
      >
        {(d, invalid) => (
          <select
            id="category"
            name="category"
            required
            disabled={categoryLocked}
            defaultValue={v.category}
            aria-invalid={invalid || undefined}
            aria-describedby={d}
            className={`${inputBase} ${border("category")}`}
          >
            <option value="">Choose a category</option>
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            {extraCategory && <option value={extraCategory}>{categoryLabel(extraCategory)}</option>}
          </select>
        )}
      </FieldShell>

      <div className="grid gap-5 sm:grid-cols-2">
        <FieldShell id="totalBudget" label="Total budget (USD)" error={err("totalBudget")} hint="For example 2500 or 2500.50.">
          {(d, invalid) => (
            <input
              id="totalBudget"
              name="totalBudget"
              type="text"
              inputMode="decimal"
              required
              defaultValue={v.totalBudget}
              aria-invalid={invalid || undefined}
              aria-describedby={d}
              className={`${inputBase} ${border("totalBudget")}`}
            />
          )}
        </FieldShell>
        <FieldShell id="dailyBudget" label="Daily budget (USD, optional)" error={err("dailyBudget")} hint="Leave empty for no daily limit.">
          {(d, invalid) => (
            <input
              id="dailyBudget"
              name="dailyBudget"
              type="text"
              inputMode="decimal"
              defaultValue={v.dailyBudget}
              aria-invalid={invalid || undefined}
              aria-describedby={d}
              className={`${inputBase} ${border("dailyBudget")}`}
            />
          )}
        </FieldShell>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <FieldShell id="startDate" label="Start date" error={err("startDate")}>
          {(d, invalid) => (
            <input
              id="startDate"
              name="startDate"
              type="date"
              required
              min={mode === "create" ? minStartDate : undefined}
              defaultValue={v.startDate}
              aria-invalid={invalid || undefined}
              aria-describedby={d}
              className={`${inputBase} ${border("startDate")}`}
            />
          )}
        </FieldShell>
        <FieldShell id="endDate" label="End date (optional)" error={err("endDate")} hint="Leave empty for no end date.">
          {(d, invalid) => (
            <input
              id="endDate"
              name="endDate"
              type="date"
              defaultValue={v.endDate}
              aria-invalid={invalid || undefined}
              aria-describedby={d}
              className={`${inputBase} ${border("endDate")}`}
            />
          )}
        </FieldShell>
      </div>

      <p className="text-xs text-mist/55">Budgets are in US dollars. Dates use UTC.</p>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="sm:w-56">
          <SubmitButton pendingText={mode === "create" ? "Creating…" : "Saving…"}>
            {mode === "create" ? "Create campaign" : "Save changes"}
          </SubmitButton>
        </div>
        <Link
          href={cancelHref}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line px-5 py-2.5 text-base text-mist/80 hover:text-aqua"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
