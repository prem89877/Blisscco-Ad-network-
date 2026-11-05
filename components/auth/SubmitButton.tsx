"use client";

import { useFormStatus } from "react-dom";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";

type Props = { children: React.ReactNode; pendingText: string; variant?: "primary" | "secondary" };

/** Submit ke dauran disabled + "loading" text (double submit nahi hota). */
export default function SubmitButton({ children, pendingText, variant = "primary" }: Props) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      disabled={pending}
      aria-busy={pending}
      className="w-full disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? <><Spinner size="sm" className="mr-2" />{pendingText}</> : children}
    </Button>
  );
}
