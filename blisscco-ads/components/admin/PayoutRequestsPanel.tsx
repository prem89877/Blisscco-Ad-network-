import Panel from "@/components/dashboard/Panel";
import PayoutActionButton from "@/components/admin/PayoutActionButton";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { formatUsdUnits } from "@/lib/ledger/display";
import { fetchAdminPayoutRequests } from "@/lib/payouts/data";
import { PAYOUT_STATUS_LABEL, adminActionsFor, isOpenStatus } from "@/lib/payouts/rules";

const STATUS_TONE = {
  requested: "text-amber-300",
  approved: "text-aqua",
  rejected: "text-red-300",
  paid: "text-mist/80",
} as const;

/**
 * Admin page ka payout panel. Sirf admin page me dikhta hai (page requireRole(["admin"]) karta hai) AUR database list sirf admin ko deti hai.
 * Yahan ke buttons sirf suvidha hain: asli rok server action + database function (private.is_admin) hai.
 * "Mark as paid" ka matlab: tumne paisa bahar se manually bhej diya. Blisscco koi paisa nahi bhejta.
 */
export default async function PayoutRequestsPanel() {
  const supabase = await createClient();
  const result = await fetchAdminPayoutRequests(supabase);

  return (
    <Panel
      title="Publisher payout requests"
      note="Approve, then send the money yourself outside Blisscco, then mark it as paid. Blisscco never sends money and never asks for bank, card or UPI details here."
    >
      {result.status !== "ok" ? (
        <p role="alert" className="text-sm text-red-300">
          Payout requests could not be loaded. Please refresh the page.
        </p>
      ) : result.data.length === 0 ? (
        <p className="text-sm text-mist/70">No payout requests yet.</p>
      ) : (
        <ul className="space-y-3">
          {result.data.map((r) => {
            const actions = adminActionsFor(r.status);
            return (
              <li key={r.id} className="rounded-xl border border-line p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium text-mist">
                      {r.publisherName} · {formatUsdUnits(r.amount)}
                    </p>
                    <p className="mt-1 text-xs text-mist/60">
                      Requested {formatDate(r.createdAt.slice(0, 10))}
                      {r.reviewedAt ? ` · Reviewed ${formatDate(r.reviewedAt.slice(0, 10))}` : ""}
                      {r.paidAt ? ` · Marked paid ${formatDate(r.paidAt.slice(0, 10))}` : ""} (UTC)
                    </p>
                    <p className={`mt-1 text-xs ${STATUS_TONE[r.status]}`}>{PAYOUT_STATUS_LABEL[r.status]}</p>
                    {r.rejectionReason && <p className="mt-1 break-words text-xs text-mist/70">Reason: {r.rejectionReason}</p>}
                    {isOpenStatus(r.status) && !r.ledgerCovers && (
                      <p className="mt-2 text-sm text-amber-300">
                        This publisher&apos;s ledger balance no longer covers their requests (for example after a reversal). Approving or paying is blocked; reject it.
                      </p>
                    )}
                  </div>
                  {actions.length > 0 && (
                    <div className="flex flex-col gap-2">
                      {actions.includes("approve") && <PayoutActionButton id={r.id} action="approve" label="Approve" />}
                      {actions.includes("paid") && <PayoutActionButton id={r.id} action="paid" label="Mark as paid (sent manually)" />}
                      {actions.includes("reject") && <PayoutActionButton id={r.id} action="reject" label="Reject" tone="bad" />}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
