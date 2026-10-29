import type { Metadata } from "next";
import PageHeader from "@/components/dashboard/PageHeader";
import Panel from "@/components/dashboard/Panel";
import StatCard from "@/components/dashboard/StatCard";
import DataTable from "@/components/dashboard/DataTable";
import Notice from "@/components/auth/Notice";
import Button from "@/components/ui/Button";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadMyPublisher } from "@/lib/publisher/queries";
import { formatDate } from "@/lib/format";
import { formatUsdUnits } from "@/lib/ledger/display";
import {
  ENTRY_TYPE_LABEL,
  UNSUPPORTED_BALANCES,
  earningsAvailability,
  fetchMyEarningsEntries,
  fetchMyEarningsSummary,
  type EarningsEntry,
} from "@/lib/ledger/earnings";

export const metadata: Metadata = { title: "Earnings | Blisscco Dashboard" };
export const dynamic = "force-dynamic";

export default async function PublisherEarningsPage() {
  // Role check aur publisher ki query SAATH me (role galat ho toh redirect pehle hi ho jata hai).
  const [, { publisher: pub, failed }] = await Promise.all([requireRole(["publisher"]), loadMyPublisher()]);
  if (failed) throw new Error("Publisher could not be loaded");

  const header = (
    <PageHeader
      demo={false}
      title="Earnings"
      description="What Blisscco has recorded for your platform. Every figure comes from saved ledger records. Amounts are in US dollars (USD)."
    />
  );

  if (!pub) {
    return (
      <>
        {header}
        <Panel title="Set up your platform first" note="Earnings are shown once your publisher account exists.">
          <Button href="/dashboard/publisher" variant="secondary">
            Go to Publisher
          </Button>
        </Panel>
      </>
    );
  }

  // Ownership DATABASE me hai: dono functions caller ki apni session (auth.uid()) se publisher nikalte hain. Yahan koi publisher id bheji hi nahi jaati.
  const supabase = await createClient();
  const [summary, entries] = await Promise.all([fetchMyEarningsSummary(supabase), fetchMyEarningsEntries(supabase, 25)]);

  if (summary.status !== "ok") {
    return (
      <>
        {header}
        <Notice tone="error">
          {summary.status === "not_found"
            ? "Earnings are not available for this account."
            : "Earnings could not be loaded. Please refresh the page."}
        </Notice>
      </>
    );
  }

  const s = summary.data;
  const availability = earningsAvailability(s);

  if (availability.kind === "not_recording") {
    return (
      <>
        {header}
        <Panel title="Earnings are not being recorded yet">
          <p className="max-w-2xl text-sm text-mist/80">
            {availability.reason === "ledger_off"
              ? "Blisscco has not switched on earnings records yet, so there is nothing real to show. No balance is shown rather than a made-up zero."
              : "Earnings records are on, but the publisher revenue share has not been set yet, so no earnings are being recorded for publishers. No balance is shown rather than a made-up zero."}
          </p>
        </Panel>
        <UnsupportedPanel />
      </>
    );
  }

  const rows: EarningsEntry[] = entries.status === "ok" ? entries.data : [];

  return (
    <>
      {header}

      {!availability.recordingNow && (
        <Notice tone="info">New earnings are not being recorded right now. The figures below are the records saved so far.</Notice>
      )}

      <div className="mt-6 space-y-6">
        <section aria-label="Earnings figures" className="grid gap-4 sm:grid-cols-2">
          <StatCard label="Total earned" value={formatUsdUnits(s.earned)} hint="Earnings recorded for your platform, before adjustments and reversals." />
          <StatCard label="Adjustments" value={formatUsdUnits(s.adjustments)} hint="Manual corrections added by the Blisscco team. Can be positive or negative." />
          <StatCard label="Reversals" value={formatUsdUnits(s.reversals)} hint="Earnings or adjustments that were cancelled. Shown as a negative amount." />
          <StatCard
            label="Ledger balance"
            value={formatUsdUnits(s.balance)}
            hint="Earned + adjustments + reversals. This is a record total, not a payout. Payments are not tracked yet."
          />
        </section>

        <UnsupportedPanel />

        <Panel
          title="Recent ledger entries"
          note={`Latest ${rows.length === 1 ? "entry" : "entries"} first, up to 25. ${s.entryCount} saved in total. Dates are UTC.`}
        >
          {entries.status !== "ok" ? (
            <p className="text-sm text-red-300">Entries could not be loaded. Please refresh the page.</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-mist/70">No earnings have been recorded for your platform yet.</p>
          ) : (
            <DataTable
              caption="Recent ledger entries"
              rows={rows}
              rowKey={(r) => r.entryId}
              columns={[
                { header: "Date", cell: (r) => formatDate(r.createdAt.slice(0, 10)) },
                { header: "Type", cell: (r) => ENTRY_TYPE_LABEL[r.type] },
                { header: "Amount", numeric: true, cell: (r) => formatUsdUnits(r.amount) },
              ]}
            />
          )}
        </Panel>
      </div>
    </>
  );
}

/** Jo figures ledger me hain hi nahi: kabhi 0 ya demo number nahi, saaf "not tracked yet". */
function UnsupportedPanel() {
  return (
    <Panel title="Not tracked yet" note="These are not recorded anywhere yet, so Blisscco shows no number for them instead of guessing.">
      <ul className="grid gap-3 sm:grid-cols-3">
        {UNSUPPORTED_BALANCES.map((b) => (
          <li key={b.key} className="rounded-xl border border-line bg-surface p-4">
            <p className="text-sm text-mist/65">{b.label}</p>
            <p className="mt-1 text-sm font-medium text-mist/80">Not tracked yet</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
