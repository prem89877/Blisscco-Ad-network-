"use client";

import { useFormStatus } from "react-dom";
import { signOut } from "@/app/auth/actions";

function LogoutSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-11 items-center rounded px-1 text-sm font-medium text-mist/75 hover:text-aqua disabled:opacity-60"
    >
      {pending ? "Logging out…" : "Log out"}
    </button>
  );
}

/** POST form + server action (Next.js khud cross-site request check karta hai). */
export default function LogoutButton() {
  return (
    <form action={signOut}>
      <LogoutSubmit />
    </form>
  );
}
