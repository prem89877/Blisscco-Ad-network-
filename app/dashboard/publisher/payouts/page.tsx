import type { Metadata } from "next";
import PageHeader from "@/components/dashboard/PageHeader";
import Panel from "@/components/dashboard/Panel";
import StatCard from "@/components/dashboard/StatCard";
import DataTable from "@/components/dashboard/DataTable";
import PayoutRequestForm from "@/components/dashboard/PayoutRequestForm";
import Notice from "@/components/auth/Notice";
import Button from "@/components/ui/Button";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadMyPublisher } from "@/lib/publisher/queries";
import { formatDate } from "@/lib/format";
import { formatUsdUnits } from "@/lib/ledger/display";
import { formatMoney } from "@/lib/ledger/decimal";
import { fetchMyPayoutRequests, fetchMyPayoutSummary, type PayoutRequestRow } from "@/lib/payouts/data";
import { PAYOUT_STATUS_HELP, PAYOUT_STATUS_LABEL } from "@/lib/payouts/rules";

export const metadata: Metadata = { title: "Payouts | Blisscco Dashboard" };
export const dynamic = "force-dynamic";

const STATUS_TONE = {
  requested: "bg-amber-400/15 text-amber-300",
  approved: "bg-aqua/15 text-aqua",
  rejected: "bg-red-500/15 text-red-300",
  paid: "bg-mist/10 text-mist/80",
} as const;

export default async function PublisherPayoutsPage() {
  // Role check aur publisher ki query SAATH me (role galat ho toh redirect pehle hi ho jata hai).
  const [, { publisher: pub, failed }] = await Promise.all([requireRole(["publisher"]), loadMyPublisher()]);
  if (failed) throw new Error("Publisher could not be loaded");

  const header = (
    <PageHeader
      demo={false}
      title="Payouts"
      description="Ask for a payout of your available earnings. Payouts are reviewed and sent manually by the Blisscco team. Amounts are in US dollars (USD)."
    />
  );

  if (!pub) {
    return (
      <>
        {header}
        <Panel title="Set up your platform first" note="Payouts are available once your publisher account exists.">
          <Button href="/dashboard/publisher" variant="secondary">
            Go to Publisher
          </Button>
        </Panel>
      </>
    );
  }

  // Ownership DATABASE me hai: functions caller ki apni session (auth.uid()) se publisher nikalte hain. Yahan koi publisher id bheji hi nahi jaati.
  const supabase = await createClient();
  const [summary, requests] = await Promise.all([fetchMyPayoutSummary(supabase), fetchMyPayoutRequests(supabase, 25)]);

  if (summary.status !== "ok") {
    return (
      <>
        {header}
        <Notice tone="error">
          {summary.status === "not_found" ? "Payouts are not available for this account." : "Payouts could not be loaded. Please refresh the page."}
        </Notice>
      </>
    );
  }

  const s = summary.data;
  const rows: PayoutRequestRow[] = requests.status === "ok" ? requests.data : [];
  const canRequest = s.eligible && !s.hasOpenRequest && s.available > 0n;
  // Har page-load par naya random key: wahi form double-submit ho toh database nayi request nahi banata.
  const requestKey = crypto.randomUUID();

  return (
    <>
      {header}

      <div className="mt-6 space-y-6">
        <section aria-label="Payout figures" className="grid gap-4 sm:grid-cols-2">
          <StatCard label="Available to request" value={formatUsdUnits(s.available)} hint="Ledger balance minus money already requested or paid out." />
          <StatCard label="In requests" value={formatUsdUnits(s.reserved)} hint="Requested or approved, but not paid yet." />
          <StatCard label="Paid out" value={formatUsdUnits(s.paidOut)} hint="Requests the Blisscco team marked as sent manually." />
          <StatCard label="Ledger balance" value={formatUsdUnits(s.ledgerBalance)} hint="Earned + adjustments + reversals. See the Earnings page." />
        </section>

        <Panel title="Request a payout" note="You can have one payout request in progress at a time. There is no automatic transfer.">
          {!s.eligible ? (
            <p className="max-w-2xl text-sm text-mist/80">Your publisher account is not active, so a payout cannot be requested right now.</p>
          ) : s.hasOpenRequest ? (
            <p className="max-w-2xl text-sm text-mist/80">You already have a payout request in progress. You can ask again once it is paid or rejected.</p>
          ) : !canRequest ? (
            <p className="max-w-2xl text-sm text-mist/80">You have no available earnings to request yet.</p>
          ) : (
            <PayoutRequestForm requestKey={requestKey} defaultAmount={formatMoney(s.available)} availableLabel={formatUsdUnits(s.available)} />
          )}
          <p className="mt-4 max-w-2xl text-xs text-mist/55">
            Blisscco does not ask for bank, card or UPI details on this page. Do not send them in a reason or a message. The team will arrange payment with you separately.
          </p>
        </Panel>

        <Panel title="Your payout requests" note={`Latest first, up to 25. Dates are UTC.`}>
          {requests.status !== "ok" ? (
            <p className="text-sm text-red-300">Payout requests could not be loaded. Please refresh the page.</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-mist/70">You have not requested a payout yet.</p>
          ) : (
            <DataTable
              caption="Your payout requests"
              rows={rows}
              rowKey={(r) => r.id}
              columns={[
                { header: "Requested", cell: (r) => formatDate(r.createdAt.slice(0, 10)) },
                { header: "Amount", numeric: true, cell: (r) => formatUsdUnits(r.amount) },
                {
                  header: "Status",
                  cell: (r) => <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_TONE[r.status]}`}>{PAYOUT_STATUS_LABEL[r.status]}</span>,
                },
                {
                  header: "Details",
                  cell: (r) => (r.status === "rejected" && r.rejectionReason ? `Reason: ${r.rejectionReason}` : PAYOUT_STATUS_HELP[r.status]),
                },
              ]}
            />
          )}
        </Panel>

        <Button href="/dashboard/publisher/earnings" variant="secondary">
          Back to earnings
        </Button>
      </div>
    </>
  );
}
