"use client";

import { useActionState } from "react";
import { chooseAccountRole } from "@/app/auth/actions";
import { initialAuthState } from "@/lib/auth/types";
import Notice from "@/components/auth/Notice";
import SubmitButton from "@/components/auth/SubmitButton";

const OPTION =
  "flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line px-3 text-sm has-[:checked]:border-aqua has-[:checked]:bg-aqua/10";

/** Naye Google user ke liye: Advertiser ya AI Publisher chuno. Koi default nahi: user ko khud chunna hai. */
export default function ChooseRoleForm() {
  const [state, formAction] = useActionState(chooseAccountRole, initialAuthState);
  return (
    <>
      {state.status === "error" && state.message && <Notice tone="error">{state.message}</Notice>}
      <form action={formAction} className="mt-6 space-y-5">
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-mist">I am joining as</legend>
          <div className="grid grid-cols-2 gap-3">
            <label className={OPTION}>
              <input type="radio" name="accountType" value="advertiser" required className="accent-[#20D9E6]" />
              Advertiser
            </label>
            <label className={OPTION}>
              <input type="radio" name="accountType" value="publisher" required className="accent-[#20D9E6]" />
              AI Publisher
            </label>
          </div>
        </fieldset>
        <SubmitButton pendingText="Saving…">Continue</SubmitButton>
      </form>
    </>
  );
}
