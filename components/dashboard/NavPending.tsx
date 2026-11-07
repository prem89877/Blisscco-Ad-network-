"use client";

import { useLinkStatus } from "next/link";
import Spinner from "@/components/ui/Spinner";

type Variant = "sidebar" | "mobile";

// Tap karte hi (page aane se pehle) teen cheezein ek saath dikhti hain: poore link par background highlight,
// ek spinner, aur ek moti pulse bar. Pehle sirf 2px ki bar thi jisse "tap register hua" ka ehsaas nahi aata tha.
// Spinner delayed nahi hai: tap ka feedback turant dikhna chahiye (fast load par bhi ek jhalak theek hai).
const STYLES: Record<Variant, { overlay: string; bar: string; spinner: string }> = {
  sidebar: {
    overlay: "inset-0 rounded-lg bg-violet/30 ring-1 ring-inset ring-aqua/50",
    bar: "inset-y-1.5 left-0 w-1 rounded-full",
    spinner: "right-3 top-1/2 -translate-y-1/2",
  },
  mobile: {
    overlay: "inset-0 bg-violet/25",
    bar: "inset-x-2 top-0 h-[3px] rounded-full",
    spinner: "right-1.5 top-1.5",
  },
};

/**
 * Link ke ANDAR rakho (parent Link "relative" hona chahiye). Sab kuch pointer-events-none hai: tap kabhi nahi rokta.
 * Screen reader ko "Loading" sunai deta hai (polite, sirf pending ke dauran).
 */
export default function NavPending({ variant }: { variant: Variant }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  const s = STYLES[variant];
  return (
    <span role="status" aria-live="polite" data-nav-pending>
      <span aria-hidden="true" className={`pointer-events-none absolute ${s.overlay}`} />
      <span aria-hidden="true" className={`pointer-events-none absolute animate-pulse bg-aqua ${s.bar}`} />
      <span aria-hidden="true" className={`pointer-events-none absolute flex ${s.spinner}`}>
        <Spinner size="sm" />
      </span>
      <span className="sr-only">Loading…</span>
    </span>
  );
}
