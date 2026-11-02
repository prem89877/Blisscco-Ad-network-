import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MAX_EXCLUDE_IDS, MAX_FALLBACK_TOPICS } from "@/lib/ads/validation";
import { DEFAULT_TTL_SECONDS } from "@/lib/ads/tracking-token";

// Day 29 Part 4: trust and privacy clarity. The privacy page, terms page and publisher guide must describe what the code
// really does, and must not carry unsupported guarantees, compliance claims or secret-like values.
// The repo's test build does not compile .tsx, so the pages are checked from source (JSX text, whitespace and entities normalised).

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const code = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
// Plain text view of a page: no comment lines, entities decoded, whitespace collapsed.
const text = (f: string) =>
  code(read(f))
    .replace(/&rsquo;|&apos;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&larr;/g, "<-")
    .replace(/\s+/g, " ");

const PRIVACY = "app/privacy/page.tsx";
const TERMS = "app/terms/page.tsx";
const GUIDE = "app/dashboard/publisher/guide/page.tsx";
const PAGES = [PRIVACY, TERMS, GUIDE];

describe("day 29 part 4: privacy page describes the implemented data handling", () => {
  const t = text(PRIVACY);

  it("has a section for account information, publisher API requests, ad events and contextual matching", () => {
    for (const title of ["Account information", "Publisher API requests", "Ad events", "Contextual matching", "What we do not collect", "Keeping and deleting your data"]) {
      assert.match(t, new RegExp(`title: "${title}"`), title);
    }
  });

  it("account information: auth data, advertiser and publisher records, key records, hosting logs", () => {
    assert.match(t, /stored only in hashed form/);
    assert.match(t, /Google shares your email address/);
    assert.match(t, /campaigns you create \(name, description, category, budgets and dates\)/);
    assert.match(t, /headline, ad text, button text and destination URL/);
    assert.match(t, /a short prefix, the last four characters/);
    assert.match(t, /standard server logs/);
  });

  it("publisher API requests: topic only, rejected extra fields, what is stored", () => {
    assert.match(t, /one category slug/);
    assert.match(t, new RegExp(`up to ${["zero", "one", "two"][MAX_FALLBACK_TOPICS]} fallback topics`));
    assert.match(t, new RegExp(`up to ${MAX_EXCLUDE_IDS} ids of ads`));
    assert.match(t, /accepts no other field/);
    assert.match(t, /A request that includes a prompt, a message or a user identifier is rejected/);
    assert.match(t, /does not receive, store or log chatbot prompts, conversations or user identifiers/);
    assert.match(t, /serve record: which publisher received which ad from which campaign, for which topic, and when/);
    assert.match(t, /about 48 hours/);
    assert.match(t, /Only a one-way hash of an API key is stored/);
    assert.match(t, /held in server memory for about a minute/);
    assert.match(t, /does not write it to our database/);
  });

  it("ad events: three event kinds, the fields they hold, and the fields they do not have", () => {
    assert.match(t, /a serve .*an impression .*and a click/);
    assert.match(t, /no field for a prompt, IP address, user agent, user id or referrer/);
    assert.match(t, /signed token that expires/);
    assert.equal(DEFAULT_TTL_SECONDS, 3600);
    assert.match(t, /one hour after the serve by default/);
    assert.match(t, /Blisscco click link/);
    assert.match(t, /advertiser's own privacy practices apply/);
    assert.match(t, /depend on the publisher reporting them honestly/);
  });

  it("contextual matching: topic only, no profile, sensitive topics return no ad", () => {
    assert.match(t, /Matching works on the topic alone/);
    assert.match(t, /returns at most one ad, or no ad/);
    assert.match(t, /does not read conversations, build a profile of a person/);
    assert.match(t, /Sensitive topics, for example health, religion or politics, are not matched and return no ad/);
    assert.match(t, /publisher's responsibility/);
  });

  it("retention wording matches the database cleanup (about 90 days for serve and event logs, 48 hours for retry records)", () => {
    const sql = read("supabase/sql/day-12-2-ad-events.sql");
    assert.match(sql, /purge_old_ad_logs\(p_keep_days integer default 90\)/);
    assert.match(sql, /ad_serve_requests where created_at < now\(\) - interval '48 hours'/);
    assert.match(t, /set up to be removed by a cleanup routine once they are about 90 days old/);
    assert.doesNotMatch(t, /(automatically|always) (deleted|removed) after/i);
  });

  it("event and serve tables hold no prompt, IP, user agent, user id or referrer column", () => {
    const events = read("supabase/sql/day-12-2-ad-events.sql");
    const create = events.slice(events.indexOf("create table if not exists public.ad_events"), events.indexOf("constraint ad_events_event_id_key"));
    assert.doesNotMatch(create, /\b(prompt|message|ip_address|\bip\b|user_agent|user_id|referrer|referer)\b/i);
    const serve = read("supabase/sql/day-5-3-delivery-tables.sql");
    const log = serve.slice(serve.indexOf("create table if not exists public.ad_serve_log"), serve.indexOf("comment on table public.ad_serve_log"));
    assert.doesNotMatch(log, /\b(prompt|message|ip_address|\bip\b|user_agent|user_id|referrer|referer)\b/i);
  });

  it("keeps the legal page structure and the contact-email handling", () => {
    const src = read(PRIVACY);
    assert.ok(src.includes("legal-h-${i}"));
    assert.match(src, /process\.env\.NEXT_PUBLIC_CONTACT_EMAIL/);
    assert.match(src, /A contact email for privacy requests will be listed here\./);
    assert.doesNotMatch(src, /sample data only/i);
  });
});

describe("day 29 part 4: terms page states usage expectations that match the service", () => {
  const t = text(TERMS);

  it("covers sponsored content, advertisers, publishers, API keys and campaign eligibility", () => {
    for (const title of ["Sponsored content", "For advertisers", "For publishers", "No guarantees", "Suspending or closing accounts"]) {
      assert.match(t, new RegExp(`title: "${title}"`), title);
    }
    assert.match(t, /must be shown with a visible "Sponsored" label/);
    assert.match(t, /Blisscco does not endorse an advertiser's products or claims/);
    assert.match(t, /destination URL that is a secure https link/);
    assert.match(t, /A new campaign starts as a draft/);
    assert.match(t, /each ad is checked by our team/);
    assert.match(t, /active, has at least one approved ad, is inside its start and end dates, and has budget left/);
    assert.match(t, /Spend is counted when an ad is handed to a publisher, not when a person sees or clicks it/);
    assert.match(t, /Your API key is secret\. Keep it on your server only/);
    assert.match(t, /responsible for requests made with your keys/);
    assert.match(t, /responsible for your own chatbot interface and for the disclosures you make to your users/);
    assert.match(t, /Report an impression only after the ad was really shown/);
    assert.match(t, /payouts are reviewed and sent manually by our team/);
  });

  it("no longer says tracking or payments do not exist, and keeps the early-access wording", () => {
    assert.doesNotMatch(t, /impressions, clicks and results are not tracked yet/i);
    assert.doesNotMatch(t, /no payments are taken/i);
    assert.match(t, /in early access/);
    assert.match(t, /not ready for production use/);
  });

  it("keeps the legal page structure and links to the privacy policy", () => {
    const src = read(TERMS);
    assert.ok(src.includes("legal-h-${i}"));
    assert.match(src, /href="\/privacy"/);
    assert.doesNotMatch(src, /sample data only/i);
  });
});

describe("day 29 part 4: publisher guide explains disclosure and publisher responsibility", () => {
  const t = text(GUIDE);

  it("has section 6a, placed after the Sponsored label section and before no-fill handling", () => {
    const six = t.indexOf('title="6. Showing the ad with a Sponsored label"');
    const sixA = t.indexOf('title="6a. Disclosure and your responsibilities"');
    const seven = t.indexOf('title="7. Handling no-fill without breaking the chat"');
    assert.ok(six > -1 && sixA > six && seven > sixA);
  });

  it("tells publishers to disclose sponsored placements and own their chatbot UI and user-facing disclosures", () => {
    assert.match(t, /Disclose sponsored placements/);
    assert.match(t, /the minimum, not a replacement for any disclosure you owe your users/);
    assert.match(t, /You own your chatbot UI/);
    assert.match(t, /is your decision and your responsibility/);
    assert.match(t, /You own your user-facing disclosures/);
    assert.match(t, /say so in your own terms or privacy notice/);
    assert.match(t, /a click opens a Blisscco link that redirects to the advertiser's site/);
    assert.match(t, /Blisscco does not review your interface, and this guide is not legal advice/);
    assert.match(t, /Share only the topic/);
  });

  it("makes no promise of fill, earnings or legal compliance", () => {
    assert.match(t, /this guide does not promise ad fill or earnings/);
    assert.match(t, /does not promise that the integration meets any law or platform rule/);
  });

  it("existing guide behaviour is untouched: still a server component with the three routes and the Sponsored rules", () => {
    const src = read(GUIDE);
    assert.doesNotMatch(src, /^["']use client["']/m);
    assert.match(src, /POST \/api\/v1\/ads\/match/);
    assert.match(src, /POST \/api\/v1\/ads\/impression/);
    assert.match(src, /GET \/api\/v1\/ads\/click/);
    assert.match(src, /requireAccount\(\)/);
    assert.match(src, /Not ready for production use/);
  });
});

describe("day 29 part 4: no unsupported guarantees, compliance or Revive claims", () => {
  // Positive claims that must never appear. Negated wording ("does not guarantee ...") is allowed and does not match these.
  const FORBIDDEN: [RegExp, string][] = [
    [/\bwe guarantee\b|\bguaranteed (earnings|income|revenue|fill|fill rate|delivery|impressions|clicks|results|payouts?)\b/i, "guarantee"],
    [/\b(GDPR|CCPA|CPRA|HIPAA|COPPA|SOC ?2|ISO ?27001|PCI[- ]?DSS)\b/i, "regulation or certification name"],
    [/\b(fully |completely |100% )?(gdpr|ccpa|privacy)[- ]?(compliant|certified)\b|\bcompliant with\b|\bcomplies with\b|\bregulatory compliance\b/i, "compliance claim"],
    [/\b(100% secure|unhackable|unbreakable|bank-level|military-grade|end-to-end encrypt)/i, "security overclaim"],
    [/\bnever (fails|breaks|goes down)\b|\bzero downtime\b|\b99\.\d+% uptime\b/i, "availability claim"],
  ];

  for (const f of PAGES) {
    it(`${f}: none of the forbidden claims appear`, () => {
      const t = text(f);
      for (const [re, label] of FORBIDDEN) assert.doesNotMatch(t, re, `${f}: ${label}`);
    });
  }

  it("no live Revive compatibility claim on the privacy page, the terms page or the new guide section", () => {
    const REVIVE = /\b(live|production|real) Revive|Revive[^.]{0,40}\b(compatible|certified|integrated|live)\b/i;
    const g = text(GUIDE);
    const section6a = g.slice(g.indexOf('title="6a. Disclosure and your responsibilities"'), g.indexOf('title="7. Handling no-fill without breaking the chat"'));
    assert.ok(section6a.length > 200);
    for (const [name, t] of [[PRIVACY, text(PRIVACY)], [TERMS, text(TERMS)], ["guide section 6a", section6a]] as const) {
      assert.doesNotMatch(t, REVIVE, name);
      assert.doesNotMatch(t, /revive/i, name);
    }
  });

  it("raw chatbot prompts, conversations or messages are never described as stored, kept or logged without a negation", () => {
    for (const f of [PRIVACY, TERMS]) {
      const sentences = text(f).split(/(?<=[.!?])\s+/);
      for (const s of sentences) {
        if (/\b(stor(e|es|ed|ing)|keep|keeps|kept|logs?|logged|sav(e|es|ed)|collect(s|ed)?|retain(s|ed)?)\b[^.]{0,80}\b(prompts?|conversations?|transcripts?|chat messages?)\b/i.test(s)) {
          assert.match(s, /\b(not|never|no|cannot|rejects?|rejected)\b/i, `${f}: ${s}`);
        }
      }
    }
  });

  it("the Ad API really rejects prompt-like fields, so the privacy claim is backed by code", () => {
    const v = read("lib/ads/validation.ts");
    assert.match(v, /ALLOWED_KEYS/);
    assert.match(v, /unknown_field/);
    for (const k of ["prompt", "messages", "user_id"]) assert.doesNotMatch(v.slice(v.indexOf("ALLOWED_KEYS"), v.indexOf("ALLOWED_KEYS") + 160), new RegExp(`"${k}"`));
  });
});

describe("day 29 part 4: no secret-like values in the three pages", () => {
  const SECRET_LIKE: [RegExp, string][] = [
    [/blc_live_[0-9a-f]{16,}/i, "publisher key"],
    [/\bsk[-_](live|test|ant)[-_A-Za-z0-9]{8,}/i, "secret key"],
    [/\bsb_(secret|publishable)_[A-Za-z0-9_]{6,}/i, "Supabase key"],
    [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/, "JWT"],
    [/\bb[tc]1\.(?!EXAMPLE)[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, "real-looking tracking token or click ref"],
    [/Bearer\s+(?!YOUR_|\$|"|'|\+|<)[A-Za-z0-9._-]{20,}/, "bearer value"],
    [/\b[0-9a-f]{32,}\b/i, "long hex string"],
    [/AKIA[0-9A-Z]{16}/, "cloud access key"],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key block"],
    [/(AD_TRACKING_SECRET|SUPABASE_SECRET_KEY|SERVICE_ROLE)\s*[=:]\s*["']?[A-Za-z0-9]/, "secret assigned a value"],
    [/\b[\w.+-]+@(?!example\.)[\w-]+\.[A-Za-z]{2,}\b/, "hardcoded email address"],
  ];

  for (const f of PAGES) {
    it(`${f}: no secret-like value`, () => {
      const src = code(read(f));
      for (const [re, label] of SECRET_LIKE) assert.doesNotMatch(src, re, `${f}: ${label}`);
    });
  }

  it("the contact email on the legal pages still comes from the environment, not from the code", () => {
    for (const f of [PRIVACY, TERMS]) {
      const src = read(f);
      assert.match(src, /process\.env\.NEXT_PUBLIC_CONTACT_EMAIL \?\? ""/, f);
      assert.doesNotMatch(src, /mailto:[^$]/, f);
    }
  });
});

describe("day 29 part 4: scope - text pages only", () => {
  it("none of the three pages imports auth changes, database clients, actions or financial code", () => {
    for (const f of PAGES) {
      const imports = read(f).split("\n").filter((l) => /^import /.test(l)).join("\n");
      assert.doesNotMatch(imports, /supabase|@\/lib\/ads\/|ledger|payout|earnings|actions/i, f);
    }
  });

  it("the legal pages stay public server components and the guide still requires an account", () => {
    for (const f of [PRIVACY, TERMS]) {
      const src = read(f);
      assert.doesNotMatch(src, /^["']use client["']/m, f);
      assert.doesNotMatch(src, /requireAccount|requireRole/, f);
    }
    assert.match(read(GUIDE), /await requireAccount\(\)/);
  });
});
