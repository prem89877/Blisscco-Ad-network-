import type { Metadata } from "next";
import AuthShell from "@/components/auth/AuthShell";
import LoginForm from "@/components/auth/LoginForm";
import { safeNextPath } from "@/lib/auth/redirect";

export const metadata: Metadata = {
  title: "Log in | Blisscco",
  robots: { index: false, follow: false },
};

// URL ke ?message / ?error se sirf ye fixed text dikhte hain, kuch aur nahi (phishing/XSS se bachav).
const NOTICES: Record<string, { tone: "success" | "info" | "error"; text: string }> = {
  signed_out: { tone: "info", text: "You have been logged out." },
  confirm_failed: {
    tone: "error",
    text: "That verification link is invalid or has expired. Try logging in; if your email is not verified, we can send a new link.",
  },
  config: { tone: "error", text: "Sign-in is not set up on this site yet. Please try again later." },
};

type Props = { searchParams: Promise<{ next?: string; message?: string; error?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const sp = await searchParams;
  const next = safeNextPath(sp.next);
  const key = sp.error ?? sp.message;
  const notice = key && Object.hasOwn(NOTICES, key) ? NOTICES[key] : undefined;

  return (
    <AuthShell title="Log in" description="Welcome back. Log in to open your Blisscco dashboard.">
      <LoginForm next={next} notice={notice} />
    </AuthShell>
  );
}
