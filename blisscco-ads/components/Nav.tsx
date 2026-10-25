"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
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

  // Escape closes the menu and returns focus to the toggle.
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

  // If the screen grows to desktop width, drop the open state so it is closed when shrunk again.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => {
      if (mq.matches) setOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const link = "rounded px-1 py-2 text-sm font-medium text-mist/80 hover:text-aqua";

  return (
    <nav aria-label="Main">
      <div className="hidden items-center gap-7 lg:flex">
        {LINKS.map((l) => (
          <a key={l.href} href={l.href} className={link}>{l.label}</a>
        ))}
        <Link href="/dashboard" className={link}>Demo dashboard</Link>
        <Link href="/login" className={link}>Log in</Link>
        <Button href="/signup" className="!min-h-10 !py-2 text-sm">Sign up</Button>
      </div>

      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? "mobile-menu" : undefined}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-sm font-medium lg:hidden"
      >
        {open ? "Close" : "Menu"}
      </button>
      {open && (
        <div
          id="mobile-menu"
          className="absolute inset-x-0 top-full max-h-[calc(100dvh-4.5rem)] overflow-y-auto border-b border-line bg-ink px-5 pb-5 lg:hidden"
        >
          <ul className="flex flex-col">
            {LINKS.map((l) => (
              <li key={l.href} className="border-b border-line/60">
                <a href={l.href} onClick={() => setOpen(false)} className="block py-3.5 text-base text-mist">
                  {l.label}
                </a>
              </li>
            ))}
            <li className="border-b border-line/60">
              <Link href="/dashboard" onClick={() => setOpen(false)} className="block py-3.5 text-base text-mist">
                Demo dashboard
              </Link>
            </li>
            <li className="border-b border-line/60">
              <Link href="/login" onClick={() => setOpen(false)} className="block py-3.5 text-base text-mist">
                Log in
              </Link>
            </li>
          </ul>
          <Button href="/signup" onClick={() => setOpen(false)} className="mt-4 w-full">Sign up</Button>
        </div>
      )}
    </nav>
  );
}
