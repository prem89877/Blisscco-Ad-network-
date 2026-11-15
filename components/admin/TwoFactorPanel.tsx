"use client";

import { useEffect, useState, startTransition } from "react";
import { beginMfaEnrollment, cancelMfaEnrollment, verifyMfaEnrollment } from "@/app/dashboard/admin/security/actions";
import { useGuardedAction } from "@/lib/actions/use-guarded-action";
import { initialMfaState, type MfaStatus } from "@/lib/auth/mfa";
import Panel from "@/components/dashboard/Panel";
import Spinner from "@/components/ui/Spinner";

const btn =
  "inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60";

type Setup = { factorId: string; qrCode: string; secret: string };

/** status null = load nahi hua (button nahi dikhta). */
export default function TwoFactorPanel({ status }: { status: MfaStatus | null }) {
  const start = useGuardedAction(beginMfaEnrollment, initialMfaState);
  const verify = useGuardedAction(verifyMfaEnrollment, initialMfaState);
  const [setup, setSetup] = useState<Setup | null>(null);

  useEffect(() => {
    const s = start.state;
    if (s.status === "enrolling" && s.factorId && s.qrCode && s.secret) setSetup({ factorId: s.factorId, qrCode: s.qrCode, secret: s.secret });
  }, [start.state]);
  useEffect(() => {
    if (verify.state.status === "success") setSetup(null);
  }, [verify.state]);

  const enabled = status === "enabled";
  const cancel = () => {
    const fd = new FormData();
    if (setup) fd.set("factorId", setup.factorId);
    setSetup(null);
    startTransition(() => {
      void cancelMfaEnrollment(initialMfaState, fd);
    });
  };

  return (
    <Panel title="Authenticator app (TOTP)" note="Works with Google Authenticator, Authy, 1Password and similar apps.">
      {status === null ? (
        <p role="alert" className="text-sm text-amber-300">
          Two-factor status could not be loaded. Please refresh the page.
        </p>
      ) : (
        <p className={`text-sm font-medium ${enabled ? "text-aqua" : "text-amber-300"}`}>Status: {enabled ? "Enabled" : "Disabled"}</p>
      )}

      {verify.state.status === "success" && verify.state.message && (
        <p role="status" className="mt-2 text-sm text-aqua">
          {verify.state.message}
        </p>
      )}

      {status === "disabled" && !setup && (
        <form action={start.formAction} onSubmit={start.onSubmit} className="mt-4">
          <button type="submit" disabled={start.pending} aria-busy={start.pending} className={`${btn} border-aqua/60 text-aqua hover:bg-aqua/10`}>
            {start.pending ? <><Spinner size="sm" className="mr-2" />Please wait…</> : "Enable two-factor authentication"}
          </button>
          {start.state.status === "error" && start.state.message && (
            <p role="alert" className="mt-2 text-sm text-red-300">
              {start.state.message}
            </p>
          )}
        </form>
      )}

      {status === "disabled" && setup && (
        <div className="mt-4 max-w-sm">
          <p className="text-sm text-mist/80">1. Scan this QR code with your authenticator app.</p>
          {/* Supabase se aaya SVG data URI: img tag me chalta hai (script nahi chalti). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qrCode} alt="QR code for your authenticator app" width={192} height={192} className="mt-2 rounded-lg bg-white p-2" />
          <p className="mt-3 text-sm text-mist/80">Can&apos;t scan? Enter this key manually (time-based, 6 digits):</p>
          <code className="mt-1 block break-all rounded-lg border border-line bg-ink px-3 py-2 text-sm text-mist">{setup.secret}</code>

          <form action={verify.formAction} onSubmit={verify.onSubmit} className="mt-4">
            <input type="hidden" name="factorId" value={setup.factorId} />
            <label htmlFor="mfa-code" className="mb-1 block text-sm text-mist/80">
              2. Enter the 6-digit code
            </label>
            <input
              id="mfa-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,7}"
              maxLength={7}
              required
              className="mb-3 min-h-11 w-full rounded-lg border border-line bg-ink px-3.5 py-2 text-base tracking-widest text-mist"
            />
            <div className="flex flex-wrap gap-3">
              <button type="submit" disabled={verify.pending} aria-busy={verify.pending} className={`${btn} border-aqua/60 text-aqua hover:bg-aqua/10`}>
                {verify.pending ? <><Spinner size="sm" className="mr-2" />Verifying…</> : "Verify and enable"}
              </button>
              <button type="button" onClick={cancel} disabled={verify.pending} className={`${btn} border-line text-mist/80 hover:bg-mist/5`}>
                Cancel
              </button>
            </div>
            {verify.state.status === "error" && verify.state.message && (
              <p role="alert" className="mt-2 text-sm text-red-300">
                {verify.state.message}
              </p>
            )}
          </form>
        </div>
      )}

      {enabled && (
        <p className="mt-3 text-xs text-mist/60">
          Your account has an authenticator app linked. Recovery codes are not available yet. Keep access to your authenticator app.
        </p>
      )}
    </Panel>
  );
}
