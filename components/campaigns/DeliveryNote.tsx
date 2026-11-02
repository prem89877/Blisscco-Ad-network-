import type { DeliveryReason, DeliveryState } from "@/lib/campaigns/delivery";

/**
 * Day 29 Part 3: one line (state.message) + a short "what it means / what you can do" line.
 * Help text is shown only in the full view (not compact), and only for states deliveryState() really returns.
 * Wording never promises delivery: "eligible" means no known blocker, not "ads are being shown".
 * Database status badalta nahi; ye sirf dikhane ki jaankari hai. Sirf active campaigns par bulao.
 */
export const DELIVERY_HELP: Record<DeliveryReason | "serving", string> = {
  serving:
    "No blocker is known right now. This does not guarantee ads: an ad is shown only when a request matches your category and your ad is chosen.",
  campaign_not_active: "Only active campaigns can show ads.",
  advertiser_not_active: "Campaigns cannot show ads while your advertiser account is not active.",
  ended: "It can only be eligible again if its end date is changed to a later date. The usual checks still apply.",
  not_started: "It can become eligible on the start date (UTC) if nothing else blocks it.",
  no_approved_creative: "At least one approved ad is needed. Check the Ads section for the status of each ad.",
  total_budget_used: "The total budget has no room left for another ad. A higher total budget is set through Edit campaign and follows the usual budget checks.",
  daily_budget_used: "It can be eligible again after midnight UTC if nothing else blocks it.",
};

export default function DeliveryNote({ state, compact = false }: { state: DeliveryState; compact?: boolean }) {
  const tone = state.serving ? "text-aqua" : "text-amber-300";
  const helpKey = state.serving ? "serving" : state.reason;
  const help = !compact && helpKey ? DELIVERY_HELP[helpKey] : null;
  return (
    <>
      <p className={`${compact ? "mt-1 text-xs" : "mt-2 text-sm"} ${tone}`} data-delivery={state.serving ? "serving" : state.reason ?? "blocked"}>
        {state.message}
      </p>
      {help && (
        <p className="mt-1 max-w-2xl text-xs text-mist/60" data-delivery-help={helpKey}>
          {help}
        </p>
      )}
    </>
  );
}
