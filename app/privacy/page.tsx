import type { Metadata } from "next";
import Link from "next/link";
import Container from "@/components/ui/Container";
import Logo from "@/components/Logo";

export const metadata: Metadata = {
  title: "Privacy Policy | Blisscco",
  description: "How Blisscco handles account data, publisher API requests, ad events and contextual matching.",
};

const LAST_UPDATED = "2 November 2026";

// Apna public contact email Vercel env me NEXT_PUBLIC_CONTACT_EMAIL se set karo (code me hardcode nahi).
// Set nahi hai toh page sach batata hai ki contact abhi listed nahi hai (koi jhootha detail nahi).
const rawContact = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "";
const CONTACT_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawContact) ? rawContact : "";

type Section = { title: string; body: React.ReactNode };

const SECTIONS: Section[] = [
  {
    title: "Where Blisscco stands today",
    body: (
      <>
        <p>
          Blisscco is an online ad network for AI chatbot platforms that is in early access. Ads are served only to
          publishers our team has approved, and the dashboard on this site shows your own account data.
        </p>
        <p>
          This policy describes how the current product handles data: account information, requests from publishers to the
          Ad API, ad events, and contextual matching. It describes what the service does today. It is not a statement
          that Blisscco meets the requirements of any particular privacy law or certification.
        </p>
      </>
    ),
  },
  {
    title: "Account information",
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
          <strong className="font-medium text-mist">Advertiser details</strong>: the campaigns you create (name,
          description, category, budgets and dates) and your ads (headline, ad text, button text and destination URL).
        </li>
        <li>
          <strong className="font-medium text-mist">Publisher details</strong>: the platform name, website and category
          you save, your API key records (a name, a short prefix, the last four characters, and created, last used and
          expiry times), and any earnings and payout request records shown in your dashboard.
        </li>
        <li>
          <strong className="font-medium text-mist">Technical data</strong> that any website receives, such as IP
          address and browser type, which our hosting provider may keep in standard server logs.
        </li>
      </ul>
    ),
  },
  {
    title: "Publisher API requests",
    body: (
      <>
        <p>
          Publishers call the Ad API from their own servers. A request carries the publisher&rsquo;s API key in a header
          and a topic: one category slug such as <code>gaming</code>, chosen by the publisher&rsquo;s own code. It may also carry up
          to two fallback topics, up to 20 ids of ads the publisher already showed, and a random retry key.
        </p>
        <p>
          The API accepts no other field. A request that includes a prompt, a message or a user identifier is rejected
          with an error. Blisscco does not receive, store or log chatbot prompts, conversations or user identifiers
          through the Ad API.
        </p>
        <p>What Blisscco keeps from a request that returns an ad:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>A serve record: which publisher received which ad from which campaign, for which topic, and when.</li>
          <li>
            A retry record that links the publisher and the retry key to the ad that was chosen, so a repeated request
            does not count twice. These records are set up to be removed after about 48 hours.
          </li>
          <li>
            Only a one-way hash of an API key is stored. The full key is shown once when it is created and cannot be shown
            again.
          </li>
        </ul>
        <p>
          To limit abuse, the ad endpoints use a best-effort rate limit. For this, the requesting IP address is held in
          server memory for about a minute. This limit does not write it to our database.
        </p>
      </>
    ),
  },
  {
    title: "Ad events",
    body: (
      <>
        <p>
          Blisscco records three kinds of ad events, each linked to one serve record: a serve (the ad was handed to the
          publisher), an impression (the publisher reports that the ad was shown) and a click. An event record holds the
          publisher, campaign and ad it belongs to, the event type, where it was reported from, and timestamps. It has no
          field for a prompt, IP address, user agent, user id or referrer.
        </p>
        <p>
          Impressions are reported by the publisher&rsquo;s server using a signed token that expires, one hour after the
          serve by default. A click goes through a Blisscco click link: the person&rsquo;s browser contacts Blisscco, which
          checks the link and redirects to the advertiser&rsquo;s destination. As with any website, our hosting provider
          may keep standard server logs of that visit (see Technical data above). Once the person reaches the advertiser&rsquo;s
          site, the advertiser&rsquo;s own privacy practices apply.
        </p>
        <p>
          Impression and click counts depend on the publisher reporting them honestly. We use event data for counts and
          reporting in dashboards, and to keep the service working and secure.
        </p>
      </>
    ),
  },
  {
    title: "Contextual matching",
    body: (
      <>
        <p>
          Matching works on the topic alone. Blisscco compares the topic with the category of eligible, approved
          campaigns and returns at most one ad, or no ad. It does not read conversations, build a profile of a person,
          use a person&rsquo;s history, or send anything to an external AI service.
        </p>
        <p>
          Sensitive topics, for example health, religion or politics, are not matched and return no ad. Publishers
          are asked not to request ads in sensitive conversations in the first place.
        </p>
        <p>
          Publishers run their own chatbot products. What a publisher shows to its users, and what it tells them about
          sponsored placements, is the publisher&rsquo;s responsibility.
        </p>
      </>
    ),
  },
  {
    title: "What we do not collect",
    body: (
      <p>
        The website does not collect or store chatbot conversations, and it does not sell your personal data. The
        website itself does not currently use advertising or analytics trackers.
      </p>
    ),
  },
  {
    title: "How we use it",
    body: (
      <p>
        We use your information to create your account, log you in, send account emails such as email
        verification, run campaigns and the Ad API, show you your own counts and earnings, keep the service secure,
        and prevent misuse. We do not use it for any other purpose without telling you first.
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
      <>
        <p>
          We keep your account information while your account exists. You can ask us to delete your account and
          the data linked to it at any time using the contact below.
        </p>
        <p>
          Serve and event records are set up to be removed by a cleanup routine once they are about 90 days old.
          Spend and earnings totals are kept separately from these logs.
        </p>
      </>
    ),
  },
  {
    title: "Security",
    body: (
      <p>
        Connections to this site use HTTPS. API keys are stored only as hashes, and tracking tokens are signed and
        expire. We take reasonable steps to protect your data, but no online service can promise perfect security.
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
