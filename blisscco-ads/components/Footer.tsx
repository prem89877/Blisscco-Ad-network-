import Link from "next/link";
import Container from "@/components/ui/Container";
import Logo from "@/components/Logo";
import Badge from "@/components/ui/Badge";

const NAV = [
  { href: "#advertisers", label: "Advertisers" },
  { href: "#publishers", label: "AI Publishers" },
  { href: "#how", label: "How it works" },
  { href: "#trust", label: "Transparency and trust" },
  { href: "#waitlist", label: "Get started" },
];

/** Placeholders are plain text, not links, because these pages do not exist yet. */
const PENDING = [
  { label: "Contact", note: "Contact details will be added before launch." },
];

export default function Footer() {
  return (
    <footer className="border-t border-line py-12">
      <Container className="grid gap-10 md:grid-cols-3">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-mist/60">
            Online Ad Network for AI chatbot platforms. Currently in development.
          </p>
        </div>

        <nav aria-label="Footer">
          <h2 className="font-display text-base font-semibold">Navigate</h2>
          <ul className="mt-3">
            {NAV.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="inline-block rounded py-2 text-sm text-mist/75 hover:text-aqua">
                  {l.label}
                </a>
              </li>
            ))}
            <li>
              <Link href="/dashboard" className="inline-block rounded py-2 text-sm text-mist/75 hover:text-aqua">
                Demo dashboard (sample data)
              </Link>
            </li>
          </ul>
        </nav>

        <div>
          <h2 className="font-display text-base font-semibold">Contact and legal</h2>
          <ul className="mt-3 space-y-3">
            <li className="text-sm">
              <Link href="/privacy" className="inline-block rounded py-1 text-mist/90 hover:text-aqua">
                Privacy Policy
              </Link>
            </li>
            <li className="text-sm">
              <Link href="/terms" className="inline-block rounded py-1 text-mist/90 hover:text-aqua">
                Terms of Service
              </Link>
            </li>
            {PENDING.map((p) => (
              <li key={p.label} className="text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-mist/90">{p.label}</span>
                  <Badge tone="violet">Coming soon</Badge>
                </div>
                <p className="mt-1 text-mist/60">{p.note}</p>
              </li>
            ))}
          </ul>
        </div>
      </Container>

      <Container className="mt-10 border-t border-line/60 pt-6">
        <p className="text-xs text-mist/50">
          &copy; Blisscco. The network is in development; no services are live yet.
        </p>
      </Container>
    </footer>
  );
}
