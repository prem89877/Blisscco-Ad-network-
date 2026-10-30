import type { Metadata } from "next";
import AuthShell from "@/components/auth/AuthShell";
import SignupForm from "@/components/auth/SignupForm";

export const metadata: Metadata = {
  title: "Create account | Blisscco",
  robots: { index: false, follow: false },
};

export default function SignupPage() {
  return (
    <AuthShell title="Create your account" description="Sign up with your email and a password.">
      <SignupForm />
    </AuthShell>
  );
}
