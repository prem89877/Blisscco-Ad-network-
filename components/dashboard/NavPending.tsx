"use client";

import { useLinkStatus } from "next/link";

/**
 * Link ke ANDAR rakho (parent Link "relative" hona chahiye). Tap karte hi, page aane se pehle,
 * ek chhoti bar dikhti hai taaki user ko turant pata chale ki tap register hua aur page load ho raha hai.
 */
export default function NavPending({ className = "" }: { className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <span aria-hidden="true" className={`pointer-events-none absolute animate-pulse rounded bg-aqua ${className}`} />;
}
