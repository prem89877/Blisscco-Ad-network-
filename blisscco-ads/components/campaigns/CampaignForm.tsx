"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import Notice from "@/components/auth/Notice";
import SubmitButton from "@/components/auth/SubmitButton";
import { CATEGORY_OPTIONS, DESC_MAX, MAX_BUDGET, MIN_DAILY_BUDGET, MIN_TOTAL_BUDGET, NAME_MAX, categoryLabel } from "@/lib/campaigns/constants";
import { checkBudgets, type BudgetField } from "@/lib/campaigns/budget-rules";
import { BELOW_SPEND_MESSAGE, isBelowSpend } from "@/lib/campaigns/budget";
import { dollarsToCents } from "@/lib/campaigns/money";
import { initialFormState, type Campaign, type CampaignFieldName, type CampaignFormState, type FormValues } from "@/lib/campaigns/types";

type Props = {
  mode: "create" | "edit";
  action: (prev: CampaignFormState, formData: FormData) => Promise<CampaignFormState>;
  campaign?: Campaign;
  categoryLocked?: boolean;
  /** Sirf naye campaign me: browser ke date picker ki min date (asli check server karta hai). */
  minStartDate?: string;
  /** Sirf edit me: ab tak ka kharch (USD), sirf hint ke liye. null/undefined = pata nahi, hint nahi. */
  spentTotal?: number | null;
  cancelHref: string;
};

const inputBase =
  "min-h-11 w-full rounded-lg border bg-ink px-3.5 py-2 text-base text-mist placeholder:text-mist/40 disabled:cursor-not-allowed disabled:opacity-60";

function defaultsFrom(campaign?: Campaign): FormValues {
  return {
    name: campaign?.name ?? "",
    description: campaign?.description ?? "",
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

export default function CampaignForm({ mode, action, campaign, categoryLocked = false, minStartDate, spentTotal, cancelHref }: Props) {
  const [state, formAction] = useActionState(action, initialFormState);
  // Browser ki jaldi jaanch (sirf suvidha): server wale hi niyam (budget-rules.ts) use hote hain. Asli check server + database karta hai.
  const [clientErrors, setClientErrors] = useState<Partial<Record<BudgetField, string>>>({});
  // Jis budget field ko user ne chhua/jaancha, uske liye browser ka naya result dikhta hai (server ka purana error nahi).
  const [checked, setChecked] = useState<Partial<Record<BudgetField, boolean>>>({});
  const v = state.values ?? defaultsFrom(campaign);
  const err = (f: CampaignFieldName) =>
    f === "totalBudget" || f === "dailyBudget"
      ? checked[f]
        ? clientErrors[f]
        : state.fieldErrors?.[f]
      : state.fieldErrors?.[f];

  function budgetProblems(form: HTMLFormElement): Partial<Record<BudgetField, string>> {
    const fd = new FormData(form);
    const total = typeof fd.get("totalBudget") === "string" ? (fd.get("totalBudget") as string) : "";
    const daily = typeof fd.get("dailyBudget") === "string" ? (fd.get("dailyBudget") as string) : "";
    const result = checkBudgets(total, daily, { totalBudget: campaign?.totalBudget, dailyBudget: campaign?.dailyBudget });
    const problems = { ...result.errors };
    // Edit me: total budget ab tak ke kharch se neeche nahi ja sakta.
    if (!problems.totalBudget && result.totalCents !== null && mode === "edit" && typeof spentTotal === "number") {
      const old = dollarsToCents(campaign?.totalBudget);
      if (result.totalCents !== old && isBelowSpend(result.totalCents / 100, spentTotal)) {
        problems.totalBudget = BELOW_SPEND_MESSAGE(`$${spentTotal.toFixed(4)}`);
      }
    }
    return problems;
  }

  function onBudgetBlur(form: HTMLFormElement | null, field: BudgetField) {
    if (!form) return;
    const problems = budgetProblems(form);
    // Khali field par blur karte hi "Enter the total budget" nahi dikhana (submit par dikhega).
    const input = form.elements.namedItem(field) as HTMLInputElement | null;
    if (input && input.value.trim() === "" && field === "totalBudget") delete problems.totalBudget;
    setClientErrors(problems);
    setChecked((c) => ({ ...c, [field]: true }));
  }
  const border = (f: CampaignFieldName) => (err(f) ? "border-red-400" : "border-line");

  // Purane data ki category list me na ho toh bhi select me dikhe (badalna zaroori nahi).
  // Locked category: disabled field form me jaata hi nahi, isliye error ke baad value khali ho jati thi. Asli value dikhao.
  const shownCategory = categoryLocked && campaign ? campaign.category : v.category;
  const extraCategory =
    shownCategory !== "" && !CATEGORY_OPTIONS.some((o) => o.value === shownCategory) ? shownCategory : null;

  return (
    <form
      action={formAction}
      className="max-w-xl space-y-5"
      noValidate
      onSubmit={(e) => {
        const problems = budgetProblems(e.currentTarget);
        setClientErrors(problems);
        setChecked({ totalBudget: true, dailyBudget: true });
        // Galat budget par server ko bhejte hi nahi; preventDefault se form action nahi chalta.
        if (Object.keys(problems).length > 0) e.preventDefault();
      }}
    >
      {campaign && <input type="hidden" name="campaignId" value={campaign.id} />}
      {campaign && <input type="hidden" name="expectedUpdatedAt" value={campaign.updatedAt} />}
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
        id="description"
        label="Description (optional)"
        error={err("description")}
        hint={`What this campaign promotes. Up to ${DESC_MAX} characters.`}
      >
        {(d, invalid) => (
          <textarea
            id="description"
            name="description"
            rows={4}
            maxLength={DESC_MAX}
            defaultValue={v.description}
            aria-invalid={invalid || undefined}
            aria-describedby={d}
            className={`${inputBase} ${border("description")} resize-y`}
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
            defaultValue={shownCategory}
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
        <FieldShell id="totalBudget" label="Total budget (USD)" error={err("totalBudget")} hint={`At least $${MIN_TOTAL_BUDGET.toFixed(2)} and at most $${MAX_BUDGET.toLocaleString("en-US")}.00. For example 2500 or 2500.50.${
            mode === "edit" && typeof spentTotal === "number" && spentTotal > 0 ? ` Already spent: $${spentTotal.toFixed(4)}, so the total cannot go lower.` : ""
          }`}>
          {(d, invalid) => (
            <input
              id="totalBudget"
              name="totalBudget"
              type="text"
              inputMode="decimal"
              required
              defaultValue={v.totalBudget}
              onBlur={(e) => onBudgetBlur(e.currentTarget.form, "totalBudget")}
              aria-invalid={invalid || undefined}
              aria-describedby={d}
              className={`${inputBase} ${border("totalBudget")}`}
            />
          )}
        </FieldShell>
        <FieldShell id="dailyBudget" label="Daily budget (USD, optional)" error={err("dailyBudget")} hint={`At least $${MIN_DAILY_BUDGET.toFixed(2)} and not more than the total budget. Leave empty for no daily limit.`}>
          {(d, invalid) => (
            <input
              id="dailyBudget"
              name="dailyBudget"
              type="text"
              inputMode="decimal"
              defaultValue={v.dailyBudget}
              onBlur={(e) => onBudgetBlur(e.currentTarget.form, "dailyBudget")}
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

      <p className="text-xs text-mist/55">
        Budgets are in US dollars. Dates use UTC: a new day starts at 5:30 AM in India, so a campaign that starts &quot;today&quot; may begin a few hours later.
      </p>

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
