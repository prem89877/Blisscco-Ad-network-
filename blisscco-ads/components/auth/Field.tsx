"use client";

import { useState } from "react";

type FieldProps = {
  id: string;
  name: string;
  label: string;
  type?: "text" | "email" | "password";
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  defaultValue?: string;
  hint?: string;
  error?: string;
};

const inputBase =
  "min-h-11 w-full rounded-lg border bg-ink px-3.5 py-2 text-base text-mist placeholder:text-mist/40";

/** Label hamesha input se jura hota hai; error/hint aria-describedby se. */
export default function Field({
  id,
  name,
  label,
  type = "text",
  autoComplete,
  required = true,
  minLength,
  maxLength,
  defaultValue,
  hint,
  error,
}: FieldProps) {
  const [show, setShow] = useState(false);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : "", error ? errorId : ""].filter(Boolean).join(" ") || undefined;
  const isPassword = type === "password";

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-mist">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={isPassword && show ? "text" : type}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          maxLength={maxLength}
          defaultValue={defaultValue}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          autoCapitalize={type === "email" ? "none" : undefined}
          spellCheck={type === "email" || isPassword ? false : undefined}
          className={`${inputBase} ${error ? "border-red-400" : "border-line"} ${isPassword ? "pr-16" : ""}`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-pressed={show}
            aria-label={show ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-0 inline-flex min-w-14 items-center justify-center rounded-r-lg px-3 text-sm text-mist/70 hover:text-aqua"
          >
            {show ? "Hide" : "Show"}
          </button>
        )}
      </div>
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
