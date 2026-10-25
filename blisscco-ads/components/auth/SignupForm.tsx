"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { signUp } from "@/app/auth/actions";
import { initialAuthState } from "@/lib/auth/types";
import Field from "@/components/auth/Field";
import Notice from "@/components/auth/Notice";
import SubmitButton from "@/components/auth/SubmitButton";
import GoogleButton from "@/components/auth/GoogleButton";
import Button from "@/components/ui/Button";

export default function SignupForm() {
  const [state, formAction] = useActionState(signUp, initialAuthState);
  // Controlled: form error ke baad React form reset karta hai, par chuna hua account type bana rehna chahiye.
  const [accountType, setAccountType] = useState<"advertiser" | "publisher">("advertiser");

  if (state.status === "success") {
    return (
      <>
        <Notice tone="success">{state.message}</Notice>
        <p className="mt-4 text-sm text-mist/70">
          Did not get it? Check your spam folder. The link works in any browser.
        </p>
        <Button href="/login" className="mt-6 w-full">
          Go to log in
        </Button>
      </>
    );
  }

  return (
    <>
      {state.status === "error" && state.message && <Notice tone="error">{state.message}</Notice>}

      <form action={formAction} className="mt-6 space-y-5">
        <Field
          id="signup-email"
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          defaultValue={state.email}
          error={state.fieldErrors?.email}
        />
        <Field
          id="signup-password"
          name="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={72}
          hint="8 to 72 characters. Accents and emoji count as more than one."
          error={state.fieldErrors?.password}
        />
        <Field
          id="signup-confirm"
          name="confirmPassword"
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={72}
          error={state.fieldErrors?.confirmPassword}
        />

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-mist">I am joining as</legend>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line px-3 text-sm has-[:checked]:border-aqua has-[:checked]:bg-aqua/10">
              <input
                type="radio"
                name="accountType"
                value="advertiser"
                checked={accountType === "advertiser"}
                onChange={() => setAccountType("advertiser")}
                className="accent-[#20D9E6]"
              />
              Advertiser
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line px-3 text-sm has-[:checked]:border-aqua has-[:checked]:bg-aqua/10">
              <input
                type="radio"
                name="accountType"
                value="publisher"
                checked={accountType === "publisher"}
                onChange={() => setAccountType("publisher")}
                className="accent-[#20D9E6]"
              />
              AI Publisher
            </label>
          </div>
        </fieldset>

        <SubmitButton pendingText="Creating account…">Create account</SubmitButton>
      </form>

      <GoogleButton />
      <p className="mt-2 text-xs text-mist/55">
        Signing up with Google creates an advertiser account. To join as an AI Publisher, use email sign-up above.
      </p>

      <p className="mt-6 text-center text-sm text-mist/70">
        Already have an account?{" "}
        <Link href="/login" className="rounded font-medium text-aqua underline-offset-2 hover:underline">
          Log in
        </Link>
      </p>
    </>
  );
}
