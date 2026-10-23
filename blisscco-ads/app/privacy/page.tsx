import type { Metadata } from "next";
import Link from "next/link";
import Container from "@/components/ui/Container";
import Logo from "@/components/Logo";

export const metadata: Metadata = {
  title: "Privacy Policy | Blisscco",
  description: "How Blisscco handles account and sign-in data.",
};

const LAST_UPDATED = "23 October 2026";

// Apna public contact email Vercel env me NEXT_PUBLIC_CONTACT_EMAIL se set karo (code me hardcode nahi).
// Set nahi hai toh page sach batata hai ki contact abhi listed nahi hai (koi jhootha detail nahi).
const rawContact = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "";
const CONTACT_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawContact) ? rawContact : "";

type Section = { title: string; body: React.ReactNode };

const SECTIONS: Section[] = [
  {
    title: "Where Blisscco stands today",
    body: (
      <p>
        Blisscco is an online ad network for AI chatbot platforms that is still in development. No ads are being
        served yet, and the dashboard on this site shows sample data only. This policy covers what the website
        collects today: account and sign-in information.
      </p>
    ),
  },
  {
    title: "What we collect",
    body: (
      <ul className="list-disc space-y-2 pl-5">
        <li>
          <strong className="font-medium text-mist">Email address and password</strong> when you create an account
          with email. Passwords are handled by our authentication provider and stored only in hashed form. We
          cannot read them.
        </li>
        <li>
          <strong className="font-medium text-mist">Account type and status</strong>: whether you joined as an
          advertiser or an AI publisher, and whether the account is active.
        </li>
        <li>
          <strong className="font-medium text-mist">Google sign-in</strong>: if you choose &ldquo;Continue with
          Google&rdquo;, Google shares your email address with us, and may also share your name and profile
          picture. We use your email address to create and recognise your account. We do not currently use or
          display your name or picture.
        </li>
        <li>
          <strong className="font-medium text-mist">Technical data</strong> that any website receives, such as IP
          address and browser type, which our hosting provider may keep in standard server logs.
        </li>
      </ul>
    ),
  },
  {
    title: "What we do not collect",
    body: (
      <p>
        The website does not collect or store chatbot conversations, and it does not sell your personal data. It
        does not currently use advertising or analytics trackers.
      </p>
    ),
  },
  {
    title: "How we use it",
    body: (
      <p>
        We use your information to create your account, log you in, send account emails such as email
        verification, keep the service secure, and prevent misuse. We do not use it for any other purpose
        without telling you first.
      </p>
    ),
  },
  {
    title: "Cookies",
    body: (
      <p>
        We use only essential cookies that keep you logged in and complete the sign-in process (including the
        temporary steps of signing in with Google). We do not use advertising cookies. Logging out ends the
        session on that device.
      </p>
    ),
  },
  {
    title: "Services that handle data for us",
    body: (
      <ul className="list-disc space-y-2 pl-5">
        <li>Supabase, for authentication and our database.</li>
        <li>Vercel, for hosting this website.</li>
        <li>Google, if you choose to sign in with Google.</li>
      </ul>
    ),
  },
  {
    title: "Keeping and deleting your data",
    body: (
      <p>
        We keep your account information while your account exists. You can ask us to delete your account and
        the data linked to it at any time using the contact below.
      </p>
    ),
  },
  {
    title: "Security",
    body: (
      <p>
        Connections to this site use HTTPS. We take reasonable steps to protect your data, but no online service
        can promise perfect security.
      </p>
    ),
  },
  {
    title: "Children",
    body: <p>Blisscco is a business service and is not directed at children.</p>,
  },
  {
    title: "Changes to this policy",
    body: (
      <p>
        When our services change, we will update this page and the date above. If a change is significant, we
        will make it clear on the site.
      </p>
    ),
  },
  {
    title: "Contact",
    body: CONTACT_EMAIL ? (
      <p>
        For questions about this policy or to request deletion of your data, email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-aqua underline-offset-2 hover:underline">
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    ) : (
      <p>A contact email for privacy requests will be listed here.</p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <div className="min-h-dvh py-8">
      <Container>
        <Link href="/" aria-label="Blisscco landing page" className="inline-block rounded">
          <Logo />
        </Link>

        <main id="main" tabIndex={-1} className="mt-8 max-w-2xl focus-visible:outline-none">
          <h1 className="font-display text-3xl font-semibold tracking-tight">Privacy Policy</h1>
          <p className="mt-2 text-sm text-mist/60">Last updated: {LAST_UPDATED}</p>

          <div className="mt-8 space-y-8">
            {SECTIONS.map((s) => (
              <section key={s.title} aria-labelledby={`h-${s.title}`}>
                <h2 id={`h-${s.title}`} className="font-display text-lg font-semibold">
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
