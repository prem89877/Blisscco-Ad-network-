import Panel from "@/components/dashboard/Panel";
import PayoutSettlementButton from "@/components/admin/PayoutSettlementButton";
import { createClient } from "@/lib/supabase/server";
import { formatUsdUnits } from "@/lib/ledger/display";
import { fetchAdminPayoutRequests } from "@/lib/payouts/data";
import { fetchAdminSettlements, latestSettlementByRequest } from "@/lib/payouts/settlements";
import { PAYOUT_STATUS_LABEL, settlementActionsFor } from "@/lib/payouts/rules";

/**
 * Phase 5 Step 5: approved / paid payouts ka bahar ka anjaam. Admin page me (requireRole admin) AUR database list sirf admin ko.
 * Payouts abhi band (payout_settings.payouts_enabled = false default): "complete" tab tak "payouts disabled" deta hai. Blisscco koi paisa nahi bhejta.
 * Purana "Mark as paid" button upar wale panel me hai; database ab use akela paid nahi hone deta (reference chahiye). Is panel ka "complete" use karo.
 */
export default async function PayoutSettlementsPanel() {
  const supabase = await createClient();
  const [requests, settlements] = await Promise.all([fetchAdminPayoutRequests(supabase, 100), fetchAdminSettlements(supabase, 200)]);
  const ok = requests.status === "ok" && settlements.status === "ok";
  const byRequest = ok ? latestSettlementByRequest(settlements.data) : new Map();
  const rows = ok ? requests.data.filter((r) => r.status === "approved" || r.status === "paid") : [];

  return (
    <Panel
      title="Payout settlement (outside Blisscco)"
      note="After you send money yourself, record the payment reference here. A payout can only become paid with a reference, and only while payouts are switched on. Failed transfers and reversals are recorded with a reason."
    >
      {!ok ? (
        <p role="alert" className="text-sm text-red-300">Payout settlements could not be loaded. Please refresh the page.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-mist/70">No approved or paid payouts yet.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const s = byRequest.get(r.id) ?? null;
            const actions = settlementActionsFor(r.status, s ? s.status : null);
            return (
              <li key={r.id} className="rounded-xl border border-line p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium text-mist">{r.publisherName} · {formatUsdUnits(r.amount)}</p>
                    <p className="mt-1 text-xs text-mist/60">Request: {PAYOUT_STATUS_LABEL[r.status]}{s ? ` · Settlement: ${s.status}` : " · No settlement yet"}</p>
                    {s && <p className="mt-1 break-all text-xs text-mist/70">Payout reference: {s.payoutReference}</p>}
                  </div>
                  {actions.length > 0 && (
                    <div className="flex flex-col gap-2">
                      {actions.includes("complete") && <PayoutSettlementButton id={r.id} action="complete" label="Record payment reference (mark paid)" />}
                      {actions.includes("fail") && <PayoutSettlementButton id={r.id} action="fail" label="Record failed transfer" tone="bad" />}
                      {actions.includes("reverse") && <PayoutSettlementButton id={r.id} action="reverse" label="Record reversal (money came back)" tone="bad" />}
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
