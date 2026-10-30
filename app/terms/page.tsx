import type { Metadata } from "next";
import Link from "next/link";
import Container from "@/components/ui/Container";
import Logo from "@/components/Logo";

export const metadata: Metadata = {
  title: "Terms of Service | Blisscco",
  description: "The terms for using the Blisscco website and account features.",
};

const LAST_UPDATED = "23 October 2026";

// Contact email Vercel env NEXT_PUBLIC_CONTACT_EMAIL se (privacy page jaisa). Set nahi hai toh sach batata hai.
const rawContact = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "";
const CONTACT_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawContact) ? rawContact : "";

type Section = { title: string; body: React.ReactNode };

const SECTIONS: Section[] = [
  {
    title: "About these terms",
    body: (
      <p>
        These terms apply when you use the Blisscco website and create an account. By using the site you agree to
        them. If you do not agree, please do not use it.
      </p>
    ),
  },
  {
    title: "Service status",
    body: (
      <p>
        Blisscco is an online ad network for AI chatbot platforms that is in early access. Ads can be requested
        only by publishers our team has approved, no payments are taken, and impressions, clicks and results are not
        tracked yet. The dashboard shows your own account data. Features may change, pause or be
        removed as we build. Nothing on this site is a promise that a particular service will launch or be
        available at a given time.
      </p>
    ),
  },
  {
    title: "Your account",
    body: (
      <ul className="list-disc space-y-2 pl-5">
        <li>Give accurate information and keep your login details safe.</li>
        <li>You are responsible for activity under your account.</li>
        <li>
          Accounts start as advertiser or AI publisher accounts. Some features may need our approval before they
          are available to you.
        </li>
        <li>You can sign in with email and password or with Google.</li>
      </ul>
    ),
  },
  {
    title: "Acceptable use",
    body: (
      <>
        <p>You agree not to:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>break the law or use the site to harm or mislead others;</li>
          <li>try to access other people&rsquo;s accounts or data, or bypass security or access controls;</li>
          <li>disrupt the site, or send automated or excessive requests to it;</li>
          <li>upload or submit content you do not have the right to use.</li>
        </ul>
      </>
    ),
  },
  {
    title: "Advertising content",
    body: (
      <p>
        When ad features are launched, ads will need to meet our content rules and may be reviewed, rejected,
        paused or removed. We will publish those rules before ad features go live.
      </p>
    ),
  },
  {
    title: "Third-party services",
    body: (
      <p>
        The site relies on services from others, such as Supabase, Vercel and Google sign-in. Their own terms and
        policies apply to their services. How we handle your data is explained in our{" "}
        <Link href="/privacy" className="text-aqua underline-offset-2 hover:underline">
          Privacy Policy
        </Link>
        .
      </p>
    ),
  },
  {
    title: "Our content",
    body: (
      <p>
        The Blisscco name, logo, design and text on this site belong to Blisscco. You may not copy or reuse them
        without permission.
      </p>
    ),
  },
  {
    title: "No guarantees",
    body: (
      <p>
        Because the service is in development, it is provided &ldquo;as is&rdquo;, without promises that it will be
        uninterrupted or error-free. To the extent the law allows, Blisscco is not liable for losses that come from
        using, or being unable to use, the site.
      </p>
    ),
  },
  {
    title: "Suspending or closing accounts",
    body: (
      <p>
        We may suspend or close an account that breaks these terms or puts the site or other people at risk. You
        can ask us to close your account at any time.
      </p>
    ),
  },
  {
    title: "Changes to these terms",
    body: (
      <p>
        We may update these terms as the service develops. We will change the date above when we do. Using the
        site after a change means you accept the updated terms.
      </p>
    ),
  },
  {
    title: "Contact",
    body: CONTACT_EMAIL ? (
      <p>
        For questions about these terms, email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-aqua underline-offset-2 hover:underline">
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    ) : (
      <p>A contact email for questions about these terms will be listed here.</p>
    ),
  },
];

export default function TermsPage() {
  return (
    <div className="min-h-dvh py-8">
      <Container>
        <Link href="/" aria-label="Blisscco landing page" className="inline-block rounded">
          <Logo />
        </Link>

        <main id="main" tabIndex={-1} className="mt-8 max-w-2xl focus-visible:outline-none">
          <h1 className="font-display text-3xl font-semibold tracking-tight">Terms of Service</h1>
          <p className="mt-2 text-sm text-mist/60">Last updated: {LAST_UPDATED}</p>

          <div className="mt-8 space-y-8">
            {SECTIONS.map((s, i) => (
              <section key={s.title} aria-labelledby={`legal-h-${i}`}>
                <h2 id={`legal-h-${i}`} className="font-display text-lg font-semibold">
                  {s.title}
                </h2>
                <div className="mt-2 space-y-3 text-sm leading-relaxed text-mist/75">{s.body}</div>
              </section>
            ))}
          </div>

          <p className="mt-10 text-sm">
            <Link href="/" className="rounded text-aqua underline-offset-2 hover:underline">
              &larr; Back to the Blisscco home page
            </Link>
          </p>
        </main>
      </Container>
    </div>
  );
}
