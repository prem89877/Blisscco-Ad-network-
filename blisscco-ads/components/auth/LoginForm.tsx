"use client";

import { useActionState } from "react";
import Link from "next/link";
import { resendVerification, signIn } from "@/app/auth/actions";
import { initialAuthState } from "@/lib/auth/types";
import Field from "@/components/auth/Field";
import Notice from "@/components/auth/Notice";
import SubmitButton from "@/components/auth/SubmitButton";
import GoogleButton from "@/components/auth/GoogleButton";

type Props = {
  next: string;
  /** Server ne fixed list se chuna hua message (URL ka text kabhi seedha nahi dikhate). */
  notice?: { tone: "success" | "info" | "error"; text: string };
};

export default function LoginForm({ next, notice }: Props) {
  const [state, formAction] = useActionState(signIn, initialAuthState);
  const [resendState, resendAction] = useActionState(resendVerification, initialAuthState);

  return (
    <>
      {notice && state.status === "idle" && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {state.status === "error" && state.message && <Notice tone="error">{state.message}</Notice>}

      <form action={formAction} className="mt-6 space-y-5">
        <input type="hidden" name="next" value={next} />
        <Field
          id="login-email"
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          defaultValue={state.email}
          error={state.fieldErrors?.email}
        />
        <Field
          id="login-password"
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          error={state.fieldErrors?.password}
        />
        <SubmitButton pendingText="Logging in…">Log in</SubmitButton>
      </form>

      <GoogleButton />

      {state.needsVerification && (
        <form action={resendAction} className="mt-4">
          <input type="hidden" name="email" value={state.email ?? ""} />
          <SubmitButton variant="secondary" pendingText="Sending…">
            Resend verification email
          </SubmitButton>
          {resendState.status !== "idle" && resendState.message && (
            <Notice tone={resendState.status === "success" ? "success" : "error"}>{resendState.message}</Notice>
          )}
        </form>
      )}

      <p className="mt-6 text-center text-sm text-mist/70">
        New to Blisscco?{" "}
        <Link href="/signup" className="rounded font-medium text-aqua underline-offset-2 hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
