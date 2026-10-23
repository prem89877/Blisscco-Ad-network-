"use client";

import { signInWithGoogle } from "@/app/auth/actions";
import SubmitButton from "@/components/auth/SubmitButton";

/** "or" divider + Continue with Google (server action; koi secret browser me nahi). */
export default function GoogleButton() {
  return (
    <div className="mt-6">
      <div className="mb-4 flex items-center gap-3 text-xs text-mist/50" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>
      <form action={signInWithGoogle}>
        <SubmitButton variant="secondary" pendingText="Opening Google…">
          Continue with Google
        </SubmitButton>
      </form>
    </div>
  );
}
