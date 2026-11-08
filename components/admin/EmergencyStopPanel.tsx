"use client";

import { setAdServingStopped } from "@/app/dashboard/admin/safety-actions";
import { useGuardedAction } from "@/lib/actions/use-guarded-action";
import { STOP_REASON_MAX, type AdminSafetyState, type StopEnvDiagnostic } from "@/lib/ads/emergency-stop";
import { initialRunState } from "@/lib/campaigns/types";
import Panel from "@/components/dashboard/Panel";
import Spinner from "@/components/ui/Spinner";

const btn =
  "inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60";

type Props = {
  /** null = state load nahi hui (page "could not be loaded" dikhata hai, button nahi). */
  state: AdminSafetyState | null;
  /** Server env EMERGENCY_STOP_ENFORCED = "1" hai ya nahi. Nahi hai toh button flag badalta hai par match endpoint use padhta nahi. */
  enforced: boolean;
  /** Sirf tab dikhta hai jab enforced nahi: server ne variable dekha ya nahi (value nahi, sirf lambai). */
  diagnostic?: StopEnvDiagnostic;
};

/** Admin ka emergency stop: sab ad serving rokna / dobara chalu karna. Reason zaroori. Resume sirf is button se (apne aap kabhi nahi). */
export default function EmergencyStopPanel({ state, enforced, diagnostic }: Props) {
  const { state: result, formAction, pending, onSubmit } = useGuardedAction(setAdServingStopped, initialRunState);

  return (
    <Panel title="Emergency stop" note="Stops all new ads at once. Nothing is refunded or paid out by this switch. Ads start again only when an admin presses Resume.">
      {state === null ? (
        <p role="alert" className="text-sm text-amber-300">
          The switch state could not be loaded. Please refresh the page.
        </p>
      ) : (
        <>
          <p className={`text-sm font-medium ${state.stopped ? "text-red-300" : "text-aqua"}`}>
            {state.stopped ? "Ad serving is STOPPED" : "Ad serving is running"}
          </p>
          {state.stopped && state.reason && <p className="mt-1 break-words text-xs text-mist/70">Reason: {state.reason}</p>}
          {!enforced && (
            <p role="status" className="mt-2 text-sm text-amber-300">
              Warning: EMERGENCY_STOP_ENFORCED is not set to 1 on this server, so the ad endpoint does not read this switch yet.
            </p>
          )}
          {!enforced && diagnostic && (
            <p className="mt-1 break-words text-xs text-mist/60">
              Check: variable {diagnostic.present ? "present" : "NOT present"}, length {diagnostic.length}, equals 1: {diagnostic.equalsOne ? "yes" : "no"}; similar names: {diagnostic.similarKeys.length ? diagnostic.similarKeys.join(", ") : "none"}; environment {diagnostic.vercelEnv}; commit {diagnostic.commit}; deployment {diagnostic.deployment}
            </p>
          )}

          <form action={formAction} onSubmit={onSubmit} className="mt-4 max-w-sm">
            <input type="hidden" name="action" value={state.stopped ? "resume" : "stop"} />
            <label htmlFor="emergency-stop-reason" className="mb-1 block text-xs text-mist/70">
              Reason (saved in the audit log)
            </label>
            <textarea
              id="emergency-stop-reason"
              name="reason"
              rows={2}
              minLength={3}
              maxLength={STOP_REASON_MAX}
              required
              className="mb-3 w-full rounded-lg border border-line bg-ink px-3 py-2 text-sm text-mist"
            />
            <button
              type="submit"
              disabled={pending}
              aria-busy={pending}
              className={`${btn} ${state.stopped ? "border-aqua/60 text-aqua hover:bg-aqua/10" : "border-red-400/60 text-red-300 hover:bg-red-500/10"}`}
            >
              {pending ? <><Spinner size="sm" className="mr-2" />Please wait…</> : state.stopped ? "Resume ad serving" : "Stop all ad serving"}
            </button>
            {result.status === "error" && result.message && (
              <p role="alert" className="mt-2 text-sm text-red-300">
                {result.message}
              </p>
            )}
            {result.status === "success" && result.message && (
              <p role="status" className="mt-2 text-sm text-aqua">
                {result.message}
              </p>
            )}
          </form>

          {state.recent.length > 0 && (
            <ul className="mt-4 space-y-1 text-xs text-mist/60">
              {state.recent.map((a, i) => (
                <li key={`${a.at}-${i}`} className="break-words">
                  {a.at.slice(0, 16).replace("T", " ")} UTC · {a.action === "ad_serving_stopped" ? "Stopped" : "Resumed"} · {a.reason}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}
