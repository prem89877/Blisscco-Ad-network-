"use client";

import { signInWithGoogle } from "@/app/auth/actions";
import SubmitButton from "@/components/auth/SubmitButton";

/** "or" divider + Continue with Google (server action; koi secret browser me nahi). */
type Props = { intent: "login" | "signup"; accountType?: "advertiser" | "publisher" };

export default function GoogleButton({ intent, accountType = "advertiser" }: Props) {
  return (
    <div className="mt-6">
      <div className="mb-4 flex items-center gap-3 text-xs text-mist/50" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>
      <form action={signInWithGoogle}>
        <input type="hidden" name="intent" value={intent} />
        {intent === "signup" && <input type="hidden" name="accountType" value={accountType} />}
        <SubmitButton variant="secondary" pendingText="Opening Google…">
          Continue with Google
        </SubmitButton>
      </form>
    </div>
  );
}
