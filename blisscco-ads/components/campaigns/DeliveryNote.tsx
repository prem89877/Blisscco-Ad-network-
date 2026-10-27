import type { DeliveryState } from "@/lib/campaigns/delivery";

/**
 * "Active" badge ke neeche ek chhoti line: ye campaign abhi sach me ads dikha sakta hai ya nahi (aur agar nahi, toh kyun).
 * Database status badalta nahi; ye sirf dikhane ki jaankari hai. Sirf active campaigns par bulao.
 */
export default function DeliveryNote({ state, compact = false }: { state: DeliveryState; compact?: boolean }) {
  const tone = state.serving ? "text-aqua" : "text-amber-300";
  return (
    <p className={`${compact ? "mt-1 text-xs" : "mt-2 text-sm"} ${tone}`} data-delivery={state.serving ? "serving" : state.reason ?? "blocked"}>
      {state.message}
    </p>
  );
}
