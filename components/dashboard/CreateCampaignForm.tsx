"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Button from "@/components/ui/Button";
import { CAMPAIGN_CATEGORIES, type CampaignCategory } from "@/lib/types";

export type NewCampaignInput = { name: string; category: CampaignCategory; budget: number };

type Field = "name" | "category" | "budget";
type Errors = Partial<Record<Field, string>>;

const MAX_BUDGET = 1_000_000;

function isCategory(v: string): v is CampaignCategory {
  return (CAMPAIGN_CATEGORIES as readonly string[]).includes(v);
}

function validate(name: string, category: string, budget: string): { errors: Errors; value?: NewCampaignInput } {
  const errors: Errors = {};
  const n = name.trim();
  if (n.length === 0) errors.name = "Enter a campaign name.";
  else if (n.length < 3) errors.name = "Use at least 3 characters.";
  else if (n.length > 60) errors.name = "Use 60 characters or fewer.";

  if (!isCategory(category)) errors.category = "Choose a category.";

  const b = budget.trim().replace(/,/g, "");
  let amount = 0;
  if (b.length === 0) errors.budget = "Enter a budget.";
  else if (!/^\d+(\.\d{1,2})?$/.test(b)) errors.budget = "Enter a number like 2500 or 2500.50. No symbols or minus sign.";
  else {
    amount = Number(b);
    if (amount <= 0) errors.budget = "Budget must be more than 0.";
    else if (amount > MAX_BUDGET) errors.budget = "Demo budgets can be up to 1,000,000.";
  }

  if (Object.keys(errors).length > 0 || !isCategory(category)) return { errors };
  return { errors, value: { name: n, category, budget: amount } };
}

const inputCls =
  "mt-1.5 block min-h-11 w-full rounded-lg border bg-ink px-3 text-base text-mist placeholder:text-mist/40";

type Props = { onCreate: (input: NewCampaignInput) => void; onCancel: () => void };

/** Inline form. Nothing is sent anywhere: the parent keeps the new campaign in React state only. */
export default function CreateCampaignForm({ onCreate, onCancel }: Props) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [budget, setBudget] = useState("");
  const [errors, setErrors] = useState<Errors>({});

  const nameRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLSelectElement>(null);
  const budgetRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const { errors: found, value } = validate(name, category, budget);
    setErrors(found);
    if (value) {
      onCreate(value);
      return;
    }
    // Move focus to the first field with a problem.
    if (found.name) nameRef.current?.focus();
    else if (found.category) categoryRef.current?.focus();
    else budgetRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key === "Escape") onCancel();
  }

  const border = (f: Field) => (errors[f] ? "border-rose-400" : "border-line");
  const errorCount = Object.keys(errors).length;

  return (
    <form
      id="create-campaign-form"
      aria-labelledby="create-campaign-title"
      noValidate
      onSubmit={onSubmit}
      onKeyDown={onKeyDown}
      className="rounded-xl border border-aqua/40 bg-surface p-5 sm:p-6"
    >
      <h2 id="create-campaign-title" className="font-display text-lg font-semibold">Create demo campaign</h2>
      <p className="mt-1 text-sm text-mist/65">
        This only adds a sample row to this page. It is not saved and no ads are delivered. All fields are required.
      </p>

      {errorCount > 0 && (
        <p role="alert" className="mt-4 rounded-lg border border-rose-400/60 bg-rose-400/10 px-3 py-2 text-sm text-rose-300">
          {errorCount === 1 ? "Fix 1 field to continue." : `Fix ${errorCount} fields to continue.`}
        </p>
      )}

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="cc-name" className="text-sm font-medium">Campaign name</label>
          <input
            id="cc-name"
            ref={nameRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            maxLength={80}
            placeholder="e.g. Summer Coding Course"
            aria-required="true"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "cc-name-error" : undefined}
            className={`${inputCls} ${border("name")}`}
          />
          {errors.name && <p id="cc-name-error" className="mt-1.5 text-sm text-rose-300">{errors.name}</p>}
        </div>

        <div>
          <label htmlFor="cc-category" className="text-sm font-medium">Category</label>
          <select
            id="cc-category"
            ref={categoryRef}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-required="true"
            aria-invalid={errors.category ? true : undefined}
            aria-describedby={errors.category ? "cc-category-error" : undefined}
            className={`${inputCls} ${border("category")}`}
          >
            <option value="">Choose a category</option>
            {CAMPAIGN_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          {errors.category && <p id="cc-category-error" className="mt-1.5 text-sm text-rose-300">{errors.category}</p>}
        </div>

        <div>
          <label htmlFor="cc-budget" className="text-sm font-medium">Budget (USD)</label>
          <input
            id="cc-budget"
            ref={budgetRef}
            type="text"
            inputMode="decimal"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            autoComplete="off"
            placeholder="2500"
            aria-required="true"
            aria-invalid={errors.budget ? true : undefined}
            aria-describedby={errors.budget ? "cc-budget-error cc-budget-hint" : "cc-budget-hint"}
            className={`${inputCls} ${border("budget")}`}
          />
          <p id="cc-budget-hint" className="mt-1.5 text-xs text-mist/55">Demo amount, from 0.01 to 1,000,000.</p>
          {errors.budget && <p id="cc-budget-error" className="mt-1 text-sm text-rose-300">{errors.budget}</p>}
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Button type="submit">Add demo campaign</Button>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
