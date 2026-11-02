import type { Metadata } from "next";
import Link from "next/link";
import Container from "@/components/ui/Container";
import Logo from "@/components/Logo";

export const metadata: Metadata = {
  title: "Terms of Service | Blisscco",
  description: "The terms for using Blisscco: accounts, sponsored content, API keys and campaign eligibility.",
};

const LAST_UPDATED = "2 November 2026";

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
        Blisscco is an online ad network for AI chatbot platforms that is in early access. Accounts are approved by
        hand, ads can be requested only by publishers our team has approved, and the Ad API is limited and not ready for
        production use. Features may change, pause or be removed as we build. Nothing on this site is a promise that a
        particular service will launch or be available at a given time, or a promise of earnings, ad volume or results.
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
    title: "Sponsored content",
    body: (
      <>
        <p>
          Every ad served through Blisscco is sponsored content and must be shown with a visible &ldquo;Sponsored&rdquo;
          label. A sponsored ad is paid placement. It is not a recommendation from Blisscco or from the publisher&rsquo;s
          chatbot, and Blisscco does not endorse an advertiser&rsquo;s products or claims.
        </p>
        <p>
          Ads are matched by category only. We may review, reject, pause or remove any ad or campaign. More detailed
          content rules may be published as the service develops.
        </p>
      </>
    ),
  },
  {
    title: "For advertisers",
    body: (
      <ul className="list-disc space-y-2 pl-5">
        <li>
          Choose the category that matches what your ad promotes, and give accurate information in your campaign and ads.
        </li>
        <li>
          Each ad needs a headline, ad text and a destination URL that is a secure https link. The destination must lead
          to what the ad describes, must be lawful, and must not mislead or harm people.
        </li>
        <li>
          A new campaign starts as a draft. It is sent for review, and each ad is checked by our team. Campaigns and ads
          that are not approved are not shown.
        </li>
        <li>
          Eligibility: a campaign can show ads only while it is active, has at least one approved ad, is inside its start
          and end dates, and has budget left. Approval does not guarantee that ads are shown, clicked or lead to
          results.
        </li>
        <li>
          Budgets are limits that the service enforces. Spend is counted when an ad is handed to a publisher, not when a
          person sees or clicks it. We may pause or stop a campaign that is not eligible.
        </li>
      </ul>
    ),
  },
  {
    title: "For publishers",
    body: (
      <ul className="list-disc space-y-2 pl-5">
        <li>
          Your API key is secret. Keep it on your server only, never in browser code, a mobile app, git or chat. You are
          responsible for requests made with your keys. Revoke a key at once if it may have leaked.
        </li>
        <li>
          Show the visible word &ldquo;Sponsored&rdquo; on every ad, in its own box, apart from the assistant&rsquo;s own
          answer, and do not change the ad text or present it as the chatbot&rsquo;s own words. Show nothing when no ad is
          returned.
        </li>
        <li>
          You are responsible for your own chatbot interface and for the disclosures you make to your users. Send only the
          topic category your own code chose. Do not send conversation text or anything that identifies a person.
        </li>
        <li>
          Report an impression only after the ad was really shown to a person. Do not create or report fake or repeated
          requests, impressions or clicks.
        </li>
        <li>
          A request may return no ad. We do not guarantee that an ad is available, how many ads you receive, or how
          much you earn. Earnings records and payouts are handled as described in your dashboard, and payouts are reviewed
          and sent manually by our team.
        </li>
      </ul>
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
        uninterrupted or error-free. We do not guarantee ad availability, impressions, clicks, earnings or campaign
        results. To the extent the law allows, Blisscco is not liable for losses that come from
        using, or being unable to use, the site.
      </p>
    ),
  },
  {
    title: "Suspending or closing accounts",
    body: (
      <p>
        We may suspend or close an account, revoke API keys, or pause campaigns and ads, when these terms are broken or
        the site or other people are put at risk. You can ask us to close your account at any time.
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
