"use client";

import { useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";

const LINKS = [
  { href: "#value", label: "Why Blisscco" },
  { href: "#advertisers", label: "Advertisers" },
  { href: "#publishers", label: "AI Publishers" },
  { href: "#how", label: "How it works" },
  { href: "#trust", label: "Trust" },
];

export default function Nav() {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const link = "rounded px-1 py-2 text-sm font-medium text-mist/80 hover:text-aqua";

  return (
    <nav aria-label="Main">
      <div className="hidden items-center gap-7 md:flex">
        {LINKS.map((l) => (
          <a key={l.href} href={l.href} className={link}>{l.label}</a>
        ))}
        <Button href="#waitlist" className="!min-h-10 !py-2 text-sm">Get early access</Button>
      </div>

      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls="mobile-menu"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-sm font-medium md:hidden"
      >
        {open ? "Close" : "Menu"}
      </button>
      {open && (
        <div id="mobile-menu" className="absolute inset-x-0 top-full border-b border-line bg-ink px-5 pb-5 md:hidden">
          <ul className="flex flex-col">
            {LINKS.map((l) => (
              <li key={l.href} className="border-b border-line/60">
                <a href={l.href} onClick={() => setOpen(false)} className="block py-3.5 text-base text-mist">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <Button href="#waitlist" onClick={() => setOpen(false)} className="mt-4 w-full">Get early access</Button>
        </div>
      )}
    </nav>
  );
}
