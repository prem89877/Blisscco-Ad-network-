import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ApplyArgs, PaymentsStore } from "./process-event";
import { isApplyOutcome } from "./process-event";

// SIRF server. Service-role client se sirf do payment functions: payments_apply_verified_event (webhook) aur payments_create_intent.
// Ye functions tables par authenticated / anon ko koi access nahi dete; yahan se bhi koi secret / amount / reference log nahi hota (sirf label + error code).

export const paymentsStore: PaymentsStore = {
  async applyVerifiedEvent(args: ApplyArgs) {
    try {
      const { data, error } = await createAdminClient().rpc("payments_apply_verified_event", {
        p_provider: args.provider,
        p_provider_event_id: args.providerEventId,
        p_event_type: args.eventType,
        p_internal_reference: args.internalReference,
        p_provider_payment_id: args.providerPaymentId,
        p_new_status: args.newStatus,
        p_amount: args.amount,
        p_currency: args.currency,
        p_refunded_total: args.refundedTotal,
        p_payload_sha256: args.payloadSha256,
      });
      if (error) {
        console.error("[payments] apply event failed", { code: error.code ?? null });
        return null;
      }
      const outcome = typeof data === "object" && data !== null ? (data as Record<string, unknown>).outcome : null;
      return isApplyOutcome(outcome) ? { outcome } : null;
    } catch {
      console.error("[payments] apply event unexpected failure");
      return null;
    }
  },
};
