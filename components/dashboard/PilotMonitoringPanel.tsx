import Panel from "@/components/dashboard/Panel";
import StatCard from "@/components/dashboard/StatCard";
import Notice from "@/components/auth/Notice";
import { CONSISTENCY_FLAG_MESSAGES, formatMonitoringMoney, PILOT_MONITORING_DAYS, type MonitoringResult } from "@/lib/ads/pilot-monitoring";
import { formatNumber, formatPercent } from "@/lib/format";

// Phase 3 Step 4: admin-only pilot monitoring (admin page ke andar). Sirf dikhata hai: koi button, koi auto-pause, koi threshold nahi.
// Data database function (admin-only) se aata hai; yahan role gate dobara admin page (requireRole) ne lagaya hua hai.
// Koi missing metric "0" ban kar nahi dikhta: "—" ya saaf sandesh.

type Props = {
  result: MonitoringResult;
  /** Server flag (PILOT_METRICS_ENABLED) ki sthiti: request ginti band ho toh "0 requests" ko sach-zero na samjha jaye. */
  recordingEnabled: boolean;
};

const NOTE = `Last ${PILOT_MONITORING_DAYS} days (UTC days, including today). No threshold is applied here: thresholds are owner decisions (safety checklist, section 15).`;

export default function PilotMonitoringPanel({ result, recordingEnabled }: Props) {
  if (result.status === "unavailable") return null;

  if (result.status === "error") {
    return (
      <Panel title="Pilot monitoring" note={NOTE}>
        <Notice tone="error">
          Monitoring figures could not be loaded. No figures are shown rather than made-up zeros. If the monitoring SQL has not been applied to this environment yet, apply it to the TEST project first.
        </Notice>
      </Panel>
    );
  }

  const v = result.view;
  const noRequests = v.totalRequests === 0;

  return (
    <Panel title="Pilot monitoring" note={NOTE}>
      {noRequests && (
        <Notice tone="info">
          {recordingEnabled
            ? "No ad requests have been recorded in this period."
            : "Request recording is off on this server, so request counts, fill rate and latency are not recorded. Serves, impressions, clicks and spend below come from existing records."}
        </Notice>
      )}

      <div className="mt-4 space-y-6">
        <section aria-label="Ad requests" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Ad requests" value={noRequests ? "—" : formatNumber(v.totalRequests)} hint="All match requests recorded." />
          <StatCard label="Successful fills" value={noRequests ? "—" : formatNumber(v.fills)} hint="An ad was handed over." />
          <StatCard label="No-fill responses" value={noRequests ? "—" : formatNumber(v.noFills)} hint="Valid request, no ad to show." />
          <StatCard label="API errors" value={noRequests ? "—" : formatNumber(v.apiErrors)} hint={`Server unavailable (503). Caller errors (401, 429, 400): ${noRequests ? "—" : formatNumber(v.callerErrors)}.`} />
          <StatCard
            label="Fill rate"
            value={v.fillRatePct === null ? "—" : formatPercent(v.fillRatePct)}
            hint={v.fillRatePct === null ? "Shown once there is a fill or a no-fill." : "Fills divided by fills plus no-fills."}
          />
          <StatCard
            label="Average latency"
            value={v.avgLatencyMs === null ? "—" : `${formatNumber(v.avgLatencyMs)} ms`}
            hint={v.avgLatencyMs === null ? "No latency recorded." : `Blisscco server side, ${formatNumber(v.latencySamples)} request(s). Publisher timeouts are not visible here.`}
          />
          <StatCard label="Slowest request" value={v.maxLatencyMs === null ? "—" : `${formatNumber(v.maxLatencyMs)} ms`} hint="Longest single request in the period." />
        </section>

        <section aria-label="Tracking" className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Serves" value={formatNumber(v.serves)} hint="Ads recorded as handed over." />
          <StatCard label="Impressions" value={formatNumber(v.impressions)} hint="Recorded impression events." />
          <StatCard label="Clicks" value={formatNumber(v.clicks)} hint="Recorded click events." />
        </section>

        <section aria-label="Money" className="grid gap-4 sm:grid-cols-2">
          <StatCard label="Campaign spend" value={formatMonitoringMoney(v.campaignSpend)} hint="From the daily spend record." />
          <StatCard label="Publisher earnings" value="—" hint="Not part of this panel. Publishers see their own earnings on their earnings page." />
        </section>

        {v.flags.length > 0 ? (
          <ul className="space-y-2" aria-label="Consistency notes">
            {v.flags.map((f) => (
              <li key={f} className="rounded-lg border border-amber-300/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                {CONSISTENCY_FLAG_MESSAGES[f]}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-mist/55">No consistency notes for this period.</p>
        )}
      </div>
    </Panel>
  );
}
